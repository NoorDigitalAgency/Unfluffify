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

  function createPort(name, senderTabId = null) {
    const messageListeners = [];
    const disconnectListeners = [];
    return {
      name,
      sender: senderTabId === null ? null : { tab: { id: senderTabId } },
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
    connectPort(name, senderTabId = null) {
      const port = createPort(name, senderTabId);
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
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [
          {
            urls: ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
            username: "support-user",
            credential: "support-secret"
          }
        ]
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
    assert.deepEqual(transportMessages[0].session.iceServers, [
      {
        urls: ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
        username: "support-user",
        credential: "support-secret"
      }
    ]);
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remoteSupportRequestCode upgrades insecure websocket urls returned for https endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_tls_upgrade",
        supportCode: "123456",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "ws://api.example.com/webrtc?token=test"
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
        tabId: 8,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 8 } }
    );

    assert.equal(response.ok, true);
    assert.equal(transportMessages.length, 1);
    assert.equal(transportMessages[0].session.wsUrl, "wss://api.example.com/webrtc?token=token-value");
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
      { type: "getRemoteSupportState", tabId: 9 },
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

test("remote support keeps concurrent sessions isolated by tab", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, transportMessages } = createChromeMock();
  const responses = [
    {
      sessionId: "sess_requester",
      supportCode: "111111",
      expiresAt: "2026-05-24T08:10:00.000Z",
      webrtcWsUrl: "wss://api.example.com/webrtc?token=requester",
      iceServers: [
        {
          urls: ["turn:requester.example.com:3478?transport=udp"],
          username: "requester-user",
          credential: "requester-secret"
        }
      ]
    },
    {
      sessionId: "sess_supporter",
      supportCode: "222222",
      expiresAt: "2026-05-24T08:11:00.000Z",
      webrtcWsUrl: "wss://api.example.com/webrtc?token=supporter",
      iceServers: [
        {
          urls: ["turn:supporter.example.com:3478?transport=tcp"],
          username: "supporter-user",
          credential: "supporter-secret"
        }
      ]
    }
  ];

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return responses.shift();
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    const requesterResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 21,
        pageUrl: "https://example.com/a"
      },
      { tab: { id: 21 } }
    );

    const supporterResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportJoin",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 22,
        supportCode: "222222"
      },
      { tab: { id: 22 } }
    );

    assert.equal(requesterResponse.ok, true);
    assert.equal(supporterResponse.ok, true);
    assert.equal(transportMessages.filter((message) => message.type === "remoteSupportTransportStart").length, 2);
    assert.deepEqual(transportMessages[0].session.iceServers, [
      {
        urls: ["turn:requester.example.com:3478?transport=udp"],
        username: "requester-user",
        credential: "requester-secret"
      }
    ]);
    assert.deepEqual(transportMessages[1].session.iceServers, [
      {
        urls: ["turn:supporter.example.com:3478?transport=tcp"],
        username: "supporter-user",
        credential: "supporter-secret"
      }
    ]);

    const requesterState = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 21 },
      {}
    );
    const supporterState = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 22 },
      {}
    );

    assert.equal(requesterState.state.sessionId, "sess_requester");
    assert.equal(requesterState.state.mode, "being_supported");
    assert.equal(supporterState.state.sessionId, "sess_supporter");
    assert.equal(supporterState.state.mode, "supporting");

    await handleRemoteSupportBackgroundMessage(
      { type: "remoteSupportEnd", tabId: 21 },
      {}
    );

    const endedRequesterState = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 21 },
      {}
    );
    const stillActiveSupporterState = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 22 },
      {}
    );

    assert.equal(endedRequesterState.state.active, false);
    assert.equal(endedRequesterState.state.tabId, 21);
    assert.equal(stillActiveSupporterState.state.active, true);
    assert.equal(stillActiveSupporterState.state.sessionId, "sess_supporter");
    assert.equal(transportMessages.some((message) => message.type === "remoteSupportTransportStop" && message.sessionId === "sess_requester"), true);
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("network devtools panel is the only include-payloads writer for its attached supporting session", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, connectPort, transportMessages } = createChromeMock();

  const responses = [
    {
      sessionId: "sess_supporter_a",
      supportCode: "222333",
      expiresAt: "2026-05-24T08:10:00.000Z",
      webrtcWsUrl: "wss://api.example.com/webrtc?token=a"
    },
    {
      sessionId: "sess_supporter_b",
      supportCode: "333444",
      expiresAt: "2026-05-24T08:10:00.000Z",
      webrtcWsUrl: "wss://api.example.com/webrtc?token=b"
    }
  ];

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return responses.shift();
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

    const secondJoinResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportJoin",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 13,
        supportCode: "333444"
      },
      { tab: { id: 13 } }
    );

    assert.equal(secondJoinResponse.ok, true);

    const consolePort = connectPort("unfluffify-remote-support-console");
    consolePort.emitMessage({ type: "remoteSupportAttach", tabId: 12 });
    consolePort.emitMessage({ type: "setIncludePayloads", enabled: true });

    let stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 12 },
      {}
    );
    assert.equal(stateResponse.state.includePayloads, false);

    const networkPort = connectPort("unfluffify-remote-support-network");
    networkPort.emitMessage({ type: "remoteSupportAttach", tabId: 12 });
    assert.equal(networkPort.postedMessages[0].type, "remoteSupportStateChanged");
    assert.equal(networkPort.postedMessages[0].state.includePayloads, false);

    const secondNetworkPort = connectPort("unfluffify-remote-support-network");
    secondNetworkPort.emitMessage({ type: "remoteSupportAttach", tabId: 13 });

    networkPort.emitMessage({ type: "setIncludePayloads", enabled: true });
    await delay(0);

    stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 12 },
      {}
    );
    const secondStateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 13 },
      {}
    );
    assert.equal(stateResponse.state.includePayloads, true);
    assert.equal(secondStateResponse.state.includePayloads, false);
    assert.equal(transportMessages.at(-1).type, "remoteSupportTransportSendData");
    assert.equal(transportMessages.at(-1).messageType, "control-include-payloads");
    assert.equal(transportMessages.at(-1).sessionId, "sess_supporter_a");
    assert.deepEqual(transportMessages.at(-1).payload, { enabled: true });
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});