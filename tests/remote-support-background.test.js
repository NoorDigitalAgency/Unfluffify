import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  initRemoteSupportBackground,
  handleRemoteSupportBackgroundMessage,
  terminateRemoteSupportSession
} from "../common/remote-support-background.js";

function createChromeMock() {
  const runtimeConnectListeners = [];
  const runtimeEvents = [];
  const transportMessages = [];
  let offscreenDocumentOpen = false;
  let keepAlivePort = null;

  function createPort(name) {
    const messageListeners = [];
    const disconnectListeners = [];
    return {
      name,
      postedMessages: [],
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener);
        }
      },
      onDisconnect: {
        addListener(listener) {
          disconnectListeners.push(listener);
        }
      },
      postMessage(message) {
        this.postedMessages.push(message);
      },
      emitMessage(message) {
        messageListeners.forEach((listener) => listener(message));
      },
      disconnect() {
        disconnectListeners.forEach((listener) => listener());
      }
    };
  }

  const chromeMock = {
    runtime: {
      lastError: null,
      getURL(path) {
        return `chrome-extension://test-id/${path}`;
      },
      async getContexts() {
        return offscreenDocumentOpen
          ? [{ contextType: "OFFSCREEN_DOCUMENT", documentUrl: chromeMock.runtime.getURL("remote-support-offscreen.html") }]
          : [];
      },
      sendMessage(message) {
        if (message && message.target === "remoteSupportOffscreen") {
          transportMessages.push(message);
          return Promise.resolve({ ok: true });
        }
        runtimeEvents.push(message);
        return Promise.resolve({ ok: true });
      },
      onConnect: {
        addListener(listener) {
          runtimeConnectListeners.push(listener);
        }
      }
    },
    offscreen: {
      async createDocument() {
        offscreenDocumentOpen = true;
        keepAlivePort = createPort("unfluffify-remote-support-transport");
        runtimeConnectListeners.forEach((listener) => listener(keepAlivePort));
      },
      async closeDocument() {
        offscreenDocumentOpen = false;
        if (keepAlivePort) {
          keepAlivePort.disconnect();
        }
      }
    },
    tabs: {
      sendMessage() {
        return Promise.resolve();
      }
    },
    webRequest: {
      onBeforeRequest: { addListener() {} },
      onCompleted: { addListener() {} },
      onErrorOccurred: { addListener() {} }
    }
  };

  return {
    chromeMock,
    connectPort(name) {
      const port = createPort(name);
      runtimeConnectListeners.forEach((listener) => listener(port));
      return port;
    },
    runtimeEvents,
    transportMessages
  };
}

test("remoteSupportRequestCode resolves through the offscreen transport bootstrap", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const timeoutMarker = Symbol("timeout");

  const { chromeMock, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_pending",
        supportCode: "123456",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test"
      };
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    const response = await Promise.race([
      handleRemoteSupportBackgroundMessage(
        {
          type: "remoteSupportRequestCode",
          endpointValue: "https://api.example.com",
          tokenValue: "token-value",
          tabId: 7,
          pageUrl: "https://example.com/page"
        },
        { tab: { id: 7 } }
      ),
      delay(100).then(() => timeoutMarker)
    ]);

    assert.notEqual(response, timeoutMarker);
    assert.equal(response.ok, true);
    assert.equal(response.state.active, true);
    assert.equal(response.state.supportCode, "123456");
    assert.equal(response.state.connected, false);
    assert.equal(transportMessages.length, 1);
    assert.equal(transportMessages[0].type, "remoteSupportTransportStart");
    assert.equal(transportMessages[0].session.supportCode, "123456");
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remote support transport events drive session teardown without hanging the popup request", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, runtimeEvents } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_failure",
        supportCode: "654321",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test"
      };
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    const response = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 9,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 9 } }
    );

    assert.equal(response.ok, true);
    assert.equal(runtimeEvents.length > 0, true);

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportTransportEvent",
        source: "remoteSupportOffscreen",
        event: {
          type: "session-ended",
          sessionId: "sess_failure",
          reason: "Connection ended"
        }
      },
      {
        url: chromeMock.runtime.getURL("remote-support-offscreen.html")
      }
    );

    await delay(0);

    const stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState" },
      {}
    );

    assert.equal(stateResponse.ok, true);
    assert.equal(stateResponse.state.active, false);
    assert.equal(stateResponse.state.tabId, 9);
    assert.match(stateResponse.state.error, /Connection ended/i);
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("network devtools panel is the only include-payloads writer for supporting sessions", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, connectPort, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_supporter",
        supportCode: "222333",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test"
      };
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    const joinResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportJoin",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 12,
        supportCode: "222333",
        includePayloads: true
      },
      { tab: { id: 12 } }
    );

    assert.equal(joinResponse.ok, true);
    assert.equal(joinResponse.state.includePayloads, false);

    const consolePort = connectPort("unfluffify-remote-support-console");
    consolePort.emitMessage({ type: "setIncludePayloads", enabled: true });

    let stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState" },
      {}
    );
    assert.equal(stateResponse.state.includePayloads, false);

    const networkPort = connectPort("unfluffify-remote-support-network");
    assert.equal(networkPort.postedMessages[0].type, "remoteSupportStateChanged");
    assert.equal(networkPort.postedMessages[0].state.includePayloads, false);

    networkPort.emitMessage({ type: "setIncludePayloads", enabled: true });

    stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState" },
      {}
    );
    assert.equal(stateResponse.state.includePayloads, true);
    assert.equal(transportMessages.at(-1).type, "remoteSupportTransportSendData");
    assert.equal(transportMessages.at(-1).messageType, "control-include-payloads");
    assert.deepEqual(transportMessages.at(-1).payload, { enabled: true });
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});