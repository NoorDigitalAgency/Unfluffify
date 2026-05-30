import test from "node:test";
import assert from "node:assert/strict";

const PAGE_TELEMETRY_MESSAGE_MARKER = "unfluffify-page-telemetry";
const PAGE_TELEMETRY_CONTROL_MARKER = "unfluffify-page-telemetry-control";
const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"];

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
    dispatchControl(includePayloads) {
      const event = {
        source: windowObject,
        data: {
          __unfluffifyTelemetry: PAGE_TELEMETRY_CONTROL_MARKER,
          includePayloads
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

test("page telemetry forwards console entries with source page", async () => {
  await withPageTelemetryEnvironment(async ({ postedMessages }) => {
    await import(`../common/page-telemetry.js?case=${Date.now()}-console`);

    globalThis.console.info("page bridge ready");

    const telemetryMessage = postedMessages.find(
      (message) =>
        message &&
        message.__unfluffifyTelemetry === PAGE_TELEMETRY_MESSAGE_MARKER &&
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
    assert.equal(firstNetworkMessage.message.entry.source, "page");
    assert.equal(firstNetworkMessage.message.entry.payload, null);

    dispatchControl(true);

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