import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createScenarioBusServer } from "../orchestration/bus-server.mjs";
import { createRunner } from "../orchestration/runner.mjs";
import { loadOrchestrationConfig } from "../orchestration/lib/config.mjs";
import {
  buildChromeLaunchArgs,
  clearDisabledUnpackedExtensionPreference,
  reloadExtension
} from "../orchestration/steps/browser.mjs";

function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

function waitForMessage(socket, predicate = () => true) {
  return new Promise((resolve) => {
    const listener = (event) => {
      const message = JSON.parse(String(event.data));
      if (!predicate(message)) {
        return;
      }
      socket.removeEventListener("message", listener);
      resolve(message);
    };
    socket.addEventListener("message", listener);
  });
}

function sendJson(socket, message) {
  socket.send(JSON.stringify(message));
}

async function sendHello(socket, role, side) {
  const ackPromise = waitForMessage(socket, (message) => message.type === "report" && message.stepId === "bus:hello");
  sendJson(socket, { channel: "control", type: "hello", role, side });
  return ackPromise;
}

test("orchestration config loader merges local config with CLI overrides", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "unfluffify-config-test-"));
  const configPath = path.join(tmp, "config.json");
  await writeFile(configPath, JSON.stringify({
    role: "follower",
    side: "B",
    account: "B",
    busHost: "10.0.0.2",
    busPort: 9001,
    extensionPath: ".",
    profileDir: "profiles/follower",
    testPropertyUrl: "https://prowork.se/"
  }));

  try {
    const config = await loadOrchestrationConfig({
      cwd: tmp,
      argv: [
        "--config", configPath,
        "--role", "director",
        "--bus-port", "9010",
        "--display-mode", "wayland",
        "--media-mode", "real",
        "--insecure-origins", "https://www.bonliva.no/",
        "--capture-source-title", "Screen 1",
        "--chrome-arg", "--enable-features=WebRTCPipeWireCapturer",
        "--chrome-arg", "--ozone-platform=wayland"
      ],
      env: {}
    });
    assert.equal(config.role, "director");
    assert.equal(config.side, "B");
    assert.equal(config.account, "B");
    assert.equal(config.busHost, "10.0.0.2");
    assert.equal(config.busPort, 9010);
    assert.equal(config.busUrl, "ws://10.0.0.2:9010");
    assert.equal(config.displayMode, "wayland");
    assert.equal(config.mediaMode, "real");
    assert.equal(config.useFakeMedia, false);
    assert.equal(config.testPropertyUrl, "https://prowork.se/");
    assert.deepEqual(config.insecureOrigins, ["https://www.bonliva.no"]);
    assert.equal(config.captureSourceTitle, "Screen 1");
    assert.deepEqual(config.chromeArgs, [
      "--enable-features=WebRTCPipeWireCapturer",
      "--ozone-platform=wayland"
    ]);
    assert.equal(config.profileDir, path.join(tmp, "profiles/follower"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("orchestration config loader reads commented default JSONC config", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "unfluffify-config-jsonc-test-"));
  const orchestrationDir = path.join(tmp, "orchestration");
  const configPath = path.join(orchestrationDir, "config.jsonc");
  await mkdir(orchestrationDir, { recursive: true });
  await writeFile(configPath, `{
    // Runner role for this host.
    "role": "follower",
    // Scenario side label.
    "side": "B",
    // Trailing commas are accepted for hand-edited files.
    "profileDir": "profiles/follower",
  }`);

  try {
    const config = await loadOrchestrationConfig({
      cwd: tmp,
      argv: [],
      env: {}
    });
    assert.equal(config.configPath, configPath);
    assert.equal(config.role, "follower");
    assert.equal(config.side, "B");
    assert.equal(config.profileDir, path.join(tmp, "profiles/follower"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("browser launch args load only the unpacked extension and enable media automation", () => {
  const args = buildChromeLaunchArgs({
    extensionPath: "/tmp/unfluffify",
    testPropertyUrl: "https://www.bonliva.no/",
    captureSourceTitle: "Entire screen",
    chromeArgs: [
      "--enable-features=WebRTCPipeWireCapturer",
      "--ozone-platform=wayland"
    ]
  });
  assert.ok(args.includes("--disable-extensions-except=/tmp/unfluffify"));
  assert.ok(args.includes("--load-extension=/tmp/unfluffify"));
  assert.ok(args.includes("--auto-accept-camera-and-microphone-capture"));
  assert.ok(args.includes("--allow-http-screen-capture"));
  assert.ok(args.includes("--disable-features=MediaRouter"));
  assert.ok(args.includes("--enable-features=WebRTCPipeWireCapturer"));
  assert.ok(args.includes("--use-fake-ui-for-media-stream"));
  assert.ok(args.includes("--use-fake-device-for-media-stream"));
  assert.ok(args.includes("--unsafely-treat-insecure-origin-as-secure=https://www.bonliva.no"));
  assert.ok(args.includes("--auto-select-desktop-capture-source=Entire screen"));
  assert.ok(args.includes("--ozone-platform=wayland"));
});

test("browser launch args can disable fake media for real-desktop smoke runs", () => {
  const args = buildChromeLaunchArgs({
    extensionPath: "/tmp/unfluffify",
    displayMode: "wayland",
    mediaMode: "real",
    insecureOrigins: ["https://staging.noorlynx.test"]
  });
  assert.ok(!args.includes("--use-fake-ui-for-media-stream"));
  assert.ok(!args.includes("--use-fake-device-for-media-stream"));
  assert.ok(args.includes("--ozone-platform=wayland"));
  assert.ok(args.includes("--unsafely-treat-insecure-origin-as-secure=https://staging.noorlynx.test"));
});

test("extension reload starts waiting for the replacement worker before reloading", async () => {
  const calls = [];
  let resolveReplacementWorker;
  const replacementWorker = {
    url: () => "chrome-extension://replacement/background.js"
  };
  const browserContext = {
    waitForEvent(eventName, options) {
      assert.equal(eventName, "serviceworker");
      assert.deepEqual(options, { timeout: 15000 });
      calls.push("wait");
      return new Promise((resolve) => {
        resolveReplacementWorker = resolve;
      });
    },
    serviceWorkers() {
      return [];
    }
  };
  const worker = {
    async evaluate() {
      calls.push("evaluate");
      resolveReplacementWorker(replacementWorker);
    }
  };

  const workerAfterReload = await reloadExtension(browserContext, worker);

  assert.deepEqual(calls, ["wait", "evaluate"]);
  assert.equal(workerAfterReload, replacementWorker);
});

test("extension reload falls back to the active worker when Chrome emits no replacement event", async () => {
  const calls = [];
  const activeWorker = {
    url: () => "chrome-extension://active/background.js"
  };
  const browserContext = {
    waitForEvent(eventName) {
      assert.equal(eventName, "serviceworker");
      calls.push("wait");
      return Promise.reject(new Error("timeout"));
    },
    serviceWorkers() {
      calls.push("workers");
      return [activeWorker];
    }
  };
  const worker = {
    async evaluate() {
      calls.push("evaluate");
    }
  };

  const workerAfterReload = await reloadExtension(browserContext, worker);

  assert.deepEqual(calls, ["wait", "evaluate", "workers"]);
  assert.equal(workerAfterReload, activeWorker);
});

test("browser launch clears disabled metadata for the current unpacked extension only", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "unfluffify-profile-preferences-test-"));
  const extensionPath = path.join(tmp, "extension");
  const defaultProfilePath = path.join(tmp, "profile", "Default");
  const preferencesPath = path.join(defaultProfilePath, "Preferences");
  await mkdir(defaultProfilePath, { recursive: true });
  await writeFile(preferencesPath, JSON.stringify({
    extensions: {
      settings: {
        disabledCurrent: {
          path: extensionPath,
          location: 8,
          disable_reasons: [16777216]
        },
        enabledCurrent: {
          path: extensionPath,
          location: 8,
          state: 1
        },
        disabledOther: {
          path: path.join(tmp, "other-extension"),
          location: 8,
          disable_reasons: [1]
        }
      }
    }
  }));

  try {
    const result = await clearDisabledUnpackedExtensionPreference({
      extensionPath,
      profileDir: path.join(tmp, "profile")
    });
    const preferences = JSON.parse(await readFile(preferencesPath, "utf8"));

    assert.equal(result.ok, true);
    assert.equal(result.cleared, 1);
    assert.deepEqual(result.extensionIds, ["disabledCurrent"]);
    assert.equal(preferences.extensions.settings.disabledCurrent, undefined);
    assert.equal(preferences.extensions.settings.enabledCurrent.state, 1);
    assert.deepEqual(preferences.extensions.settings.disabledOther.disable_reasons, [1]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("runner executes bus step messages and reports structured results", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "unfluffify-runner-test-"));
  const bus = createScenarioBusServer({ runRoot: tmp, runId: "bus" });

  try {
    await bus.listen(0, "127.0.0.1");
    const config = await loadOrchestrationConfig({
      cwd: tmp,
      argv: ["--role", "follower", "--side", "B", "--bus-port", "1"],
      env: {}
    });
    const runner = await createRunner({
      config: {
        ...config,
        busUrl: bus.url,
        runRoot: tmp
      },
      runId: "runner",
      registry: {
        readState: async (params) => ({
          ok: true,
          echoed: params,
          source: "fake-step"
        })
      }
    });
    await runner.start();

    const director = new WebSocket(bus.url);
    await waitForOpen(director);
    await sendHello(director, "director", "A");

    const reportPromise = waitForMessage(director, (message) => message.type === "report" && message.stepId === "step-1");
    sendJson(director, {
      channel: "control",
      type: "step",
      id: "step-1",
      action: "readState",
      params: { tab: "active" }
    });
    const report = await reportPromise;
    assert.equal(report.state.ok, true);
    assert.deepEqual(report.state.echoed, { tab: "active" });
    assert.equal(report.state.source, "fake-step");

    const unknownPromise = waitForMessage(director, (message) => message.type === "report" && message.stepId === "step-2");
    sendJson(director, {
      channel: "control",
      type: "step",
      id: "step-2",
      action: "missingAction"
    });
    const unknown = await unknownPromise;
    assert.equal(unknown.state.ok, false);
    assert.match(unknown.state.error, /Unknown runner action/);

    director.close();
    await runner.stop();
    await bus.close();

    const log = await readFile(runner.logPath, "utf8");
    assert.match(log, /"direction":"start"/);
    assert.match(log, /"direction":"step"/);
    assert.match(log, /"direction":"report"/);
  } finally {
    await bus.close();
    await rm(tmp, { recursive: true, force: true });
  }
});
