import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGE_TELEMETRY_MESSAGE_MARKER = "unfluffify-page-telemetry";
const PAGE_TELEMETRY_CONTROL_MARKER = "unfluffify-page-telemetry-control";
const PAGE_TELEMETRY_TEST_NONCE = "1234567890abcdef1234567890abcdef";
const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"];

const contentMainSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
const pageTelemetrySource = readFileSync(new URL("../common/page-telemetry.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

function createWindowHarness() {
  const messageListeners = [];
  const postedMessages = [];
  const windowObject = {
    addEventListener(type, listener) {
      if (type === "message") {
        messageListeners.push(listener);
      }
    },
    postMessage(message) {
      postedMessages.push(message);
    }
  };

  return {
    windowObject,
    postedMessages,
    dispatchControl(control = {}) {
      const event = {
        source: windowObject,
        data: {
          __unfluffifyTelemetry: PAGE_TELEMETRY_CONTROL_MARKER,
          ...control
        }
      };

      messageListeners.forEach((listener) => {
        listener(event);
      });
    }
  };
}

function createConsoleStub() {
  const consoleStub = {};
  for (const level of CONSOLE_LEVELS) {
    consoleStub[level] = () => {};
  }
  return consoleStub;
}

async function flushTelemetryTasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function withPageTelemetryEnvironment(callback) {
  const originalWindow = globalThis.window;
  const originalConsole = globalThis.console;
  const originalFetch = globalThis.fetch;
  const originalXmlHttpRequest = globalThis.XMLHttpRequest;
  const originalPageTelemetryInstalled = globalThis.__unfluffifyPageTelemetryInstalled;
  const originalExtensionTelemetryInstalled = globalThis.__unfluffifyExtensionTelemetryInstalled;

  const harness = createWindowHarness();
  globalThis.window = harness.windowObject;
  globalThis.console = createConsoleStub();
  globalThis.fetch = async (input, init = {}) => ({
    status: 200,
    headers: {
      forEach(callback) {
        callback("application/json", "content-type");
      }
    },
    clone() {
      return {
        text: async () => JSON.stringify({ ok: true, input, init })
      };
    }
  });
  globalThis.XMLHttpRequest = undefined;
  delete globalThis.__unfluffifyPageTelemetryInstalled;
  delete globalThis.__unfluffifyExtensionTelemetryInstalled;

  try {
    await callback(harness);
  } finally {
    globalThis.window = originalWindow;
    globalThis.console = originalConsole;
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = originalXmlHttpRequest;

    if (typeof originalPageTelemetryInstalled === "undefined") {
      delete globalThis.__unfluffifyPageTelemetryInstalled;
    } else {
      globalThis.__unfluffifyPageTelemetryInstalled = originalPageTelemetryInstalled;
    }

    if (typeof originalExtensionTelemetryInstalled === "undefined") {
      delete globalThis.__unfluffifyExtensionTelemetryInstalled;
    } else {
      globalThis.__unfluffifyExtensionTelemetryInstalled = originalExtensionTelemetryInstalled;
    }
  }
}

test("page telemetry stays inert until authenticated support control enables it", async () => {
  await withPageTelemetryEnvironment(async ({ postedMessages, dispatchControl }) => {
    await import(`../common/page-telemetry.js?case=${Date.now()}-console`);

    globalThis.console.info("page bridge ready");
    assert.equal(postedMessages.length, 0, "page telemetry should not wrap console before support enable");

    dispatchControl({ enabled: true, includePayloads: false });
    globalThis.console.info("static marker only");
    assert.equal(postedMessages.length, 0, "static control marker without nonce should not enable telemetry");

    dispatchControl({
      nonce: PAGE_TELEMETRY_TEST_NONCE,
      enabled: true,
      includePayloads: false
    });

    globalThis.console.info("page bridge ready");

    const telemetryMessage = postedMessages.find(
      (message) =>
        message &&
        message.__unfluffifyTelemetry === PAGE_TELEMETRY_MESSAGE_MARKER &&
        message.nonce === PAGE_TELEMETRY_TEST_NONCE &&
        message.message &&
        message.message.channel === "console"
    );

    assert.ok(telemetryMessage);
    assert.equal(telemetryMessage.message.type, "remoteSupportExtensionTelemetry");
    assert.equal(telemetryMessage.message.entry.source, "page");
    assert.equal(telemetryMessage.message.entry.level, "info");
    assert.equal(telemetryMessage.message.entry.message, "page bridge ready");
  });
});

test("page telemetry includes fetch payloads only after the control message enables them", async () => {
  await withPageTelemetryEnvironment(async ({ postedMessages, dispatchControl }) => {
    await import(`../common/page-telemetry.js?case=${Date.now()}-payloads`);

    dispatchControl({
      nonce: PAGE_TELEMETRY_TEST_NONCE,
      enabled: true,
      includePayloads: false
    });

    await globalThis.fetch("https://example.com/save", {
      method: "POST",
      body: "request-body"
    });
    await flushTelemetryTasks();

    const firstNetworkMessage = postedMessages.find(
      (message) =>
        message &&
        message.__unfluffifyTelemetry === PAGE_TELEMETRY_MESSAGE_MARKER &&
        message.message &&
        message.message.channel === "network"
    );

    assert.ok(firstNetworkMessage);
    assert.equal(firstNetworkMessage.nonce, PAGE_TELEMETRY_TEST_NONCE);
    assert.equal(firstNetworkMessage.message.entry.source, "page");
    assert.equal(firstNetworkMessage.message.entry.payload, null);

    dispatchControl({
      nonce: "wrong-wrong-wrong-wrong",
      enabled: true,
      includePayloads: true
    });

    await globalThis.fetch("https://example.com/save", {
      method: "POST",
      body: "request-body"
    });
    await flushTelemetryTasks();

    const wrongNonceMessage = postedMessages
      .filter(
        (message) =>
          message &&
          message.__unfluffifyTelemetry === PAGE_TELEMETRY_MESSAGE_MARKER &&
          message.message &&
          message.message.channel === "network"
      )
      .at(-1);
    assert.equal(wrongNonceMessage.message.entry.payload, null);

    dispatchControl({
      nonce: PAGE_TELEMETRY_TEST_NONCE,
      enabled: true,
      includePayloads: true
    });

    await globalThis.fetch("https://example.com/save", {
      method: "POST",
      body: "request-body"
    });
    await flushTelemetryTasks();

    const networkMessages = postedMessages.filter(
      (message) =>
        message &&
        message.__unfluffifyTelemetry === PAGE_TELEMETRY_MESSAGE_MARKER &&
        message.message &&
        message.message.channel === "network"
    );
    const latestNetworkMessage = networkMessages.at(-1);

    assert.ok(latestNetworkMessage);
    assert.deepEqual(latestNetworkMessage.message.entry.payload, {
      request: "request-body",
      response: JSON.stringify({
        ok: true,
        input: "https://example.com/save",
        init: {
          method: "POST",
          body: "request-body"
        }
      })
    });
  });
});

test("page telemetry authenticated disable restores wrapped page APIs", async () => {
  await withPageTelemetryEnvironment(async ({ postedMessages, dispatchControl }) => {
    const originalInfo = globalThis.console.info;
    const originalFetch = globalThis.fetch;
    await import(`../common/page-telemetry.js?case=${Date.now()}-teardown`);

    dispatchControl({
      nonce: PAGE_TELEMETRY_TEST_NONCE,
      enabled: true,
      includePayloads: false
    });

    assert.notEqual(globalThis.console.info, originalInfo);
    assert.notEqual(globalThis.fetch, originalFetch);

    globalThis.console.info("before disable");
    assert.equal(postedMessages.length, 1);

    dispatchControl({
      nonce: PAGE_TELEMETRY_TEST_NONCE,
      enabled: false,
      includePayloads: false
    });

    assert.equal(globalThis.console.info, originalInfo);
    assert.equal(globalThis.fetch, originalFetch);

    globalThis.console.info("after disable");
    assert.equal(postedMessages.length, 1);
  });
});

test("content page telemetry bridge is active-session and nonce gated", () => {
  const mainBlock = extractSourceBlock(
    contentMainSource,
    "export function main()",
    "core.refreshFromTabState().then"
  );
  const applyStateBlock = extractSourceBlock(
    contentMainSource,
    "function applyRemoteSupportSessionState",
    "function sendRuntimeMessageSafely"
  );
  const messageBlock = extractSourceBlock(
    contentMainSource,
    "function handlePageTelemetryWindowMessage",
    "function createPageTelemetryBridgeNonce"
  );
  const forwardBlock = extractSourceBlock(
    contentMainSource,
    "function forwardPageTelemetryMessage",
    "function handlePageTelemetryWindowMessage"
  );
  const ensureBlock = extractSourceBlock(
    contentMainSource,
    "function ensurePageTelemetryBridge",
    "function syncPageTelemetryBridgeLifecycle"
  );

  assert.doesNotMatch(mainBlock, /ensurePageTelemetryBridge\(\)/);
  assert.match(applyStateBlock, /syncPageTelemetryBridgeLifecycle\(\);/);
  assert.match(messageBlock, /remoteSupportMode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED/);
  assert.match(messageBlock, /!pageTelemetryBridgeNonce/);
  assert.match(messageBlock, /data\.nonce !== pageTelemetryBridgeNonce/);
  assert.match(forwardBlock, /type: "remoteSupportExtensionTelemetry"/);
  assert.doesNotMatch(forwardBlock, /sendRuntimeMessageSafely\(message\)/);
  assert.doesNotMatch(forwardBlock, /tabId/);
  assert.match(ensureBlock, /remoteSupportMode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED/);
  assert.match(pageTelemetrySource, /isEnabled: \(\) => enabled && Boolean\(telemetryNonce\)/);
  assert.match(pageTelemetrySource, /telemetryController\.uninstall\(\)/);
});
