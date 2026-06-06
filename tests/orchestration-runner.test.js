import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createScenarioBusServer } from "../orchestration/bus-server.mjs";
import { createRunner } from "../orchestration/runner.mjs";
import { loadOrchestrationConfig } from "../orchestration/lib/config.mjs";
import { buildChromeLaunchArgs } from "../orchestration/steps/browser.mjs";

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
        "--capture-source-title", "Screen 1"
      ],
      env: {}
    });
    assert.equal(config.role, "director");
    assert.equal(config.side, "B");
    assert.equal(config.account, "B");
    assert.equal(config.busHost, "10.0.0.2");
    assert.equal(config.busPort, 9010);
    assert.equal(config.busUrl, "ws://10.0.0.2:9010");
    assert.equal(config.testPropertyUrl, "https://prowork.se/");
    assert.equal(config.captureSourceTitle, "Screen 1");
    assert.equal(config.profileDir, path.join(tmp, "profiles/follower"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("browser launch args load only the unpacked extension and enable media automation", () => {
  const args = buildChromeLaunchArgs({
    extensionPath: "/tmp/unfluffify",
    captureSourceTitle: "Entire screen"
  });
  assert.ok(args.includes("--disable-extensions-except=/tmp/unfluffify"));
  assert.ok(args.includes("--load-extension=/tmp/unfluffify"));
  assert.ok(args.includes("--use-fake-ui-for-media-stream"));
  assert.ok(args.includes("--use-fake-device-for-media-stream"));
  assert.ok(args.includes("--auto-select-desktop-capture-source=Entire screen"));
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
