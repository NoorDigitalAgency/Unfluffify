import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  handleTransportEvent,
  initRemoteSupportBackground,
  handleRemoteSupportBackgroundMessage,
  terminateRemoteSupportSession
} from "../common/remote-support-background.js";

function createChromeMock(options = {}) {
  const { autoConnectOffscreenKeepAlive = true, offscreenResponse = null } = options;
  const runtimeConnectListeners = [];
  const runtimeEvents = [];
  const tabMessages = [];
  const transportMessages = [];
  const runtimeConnectCalls = [];
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
          return Promise.resolve(typeof offscreenResponse === "function" ? offscreenResponse(message) : { ok: true });
        }
        runtimeEvents.push(message);
        return Promise.resolve({ ok: true });
      },
      connect(connectInfo) {
        const port = createPort(connectInfo && connectInfo.name ? connectInfo.name : "");
        runtimeConnectCalls.push({
          name: port.name,
          port
        });
        return port;
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
        if (autoConnectOffscreenKeepAlive) {
          keepAlivePort = createPort("unfluffify-remote-support-transport");
          runtimeConnectListeners.forEach((listener) => listener(keepAlivePort));
        }
      },
      async closeDocument() {
        offscreenDocumentOpen = false;
        if (keepAlivePort) {
          keepAlivePort.disconnect();
        }
      }
    },
    tabs: {
      sendMessage(tabId, message) {
        tabMessages.push({ tabId, message });
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
    runtimeConnectCalls,
    runtimeEvents,
    tabMessages,
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

test("remoteSupportRequestCode reuses the offscreen keep-alive port created during document bootstrap", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, runtimeConnectCalls } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_keepalive_reuse",
        supportCode: "123456",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
        tabId: 10,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 10 } }
    );

    assert.equal(response.ok, true);
    assert.equal(runtimeConnectCalls.length, 0);
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remoteSupportRequestCode does not restart an unchanged active transport session", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_reuse_same_transport",
        supportCode: "123456",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
      };
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    const firstResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 16,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 16 } }
    );

    const secondResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 16,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 16 } }
    );

    assert.equal(firstResponse.ok, true);
    assert.equal(secondResponse.ok, true);
    assert.equal(transportMessages.filter((message) => message.type === "remoteSupportTransportStart").length, 1);
    assert.equal(transportMessages.some((message) => message.type === "remoteSupportTransportStop"), false);
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remoteSupportRequestCode falls back to the endpoint websocket url when the server omits webrtcWsUrl", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_fallback_ws",
        supportCode: "123456",
        expiresAt: "2026-05-24T08:10:00.000Z",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
        tabId: 11,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 11 } }
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

test("remoteSupportRequestCode fails when the support response omits iceServers", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, runtimeConnectCalls, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_missing_ice",
        supportCode: "123456",
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
        tabId: 15,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 15 } }
    );

    assert.equal(response.ok, false);
    assert.equal(response.error, "Support response is missing ICE configuration");
    assert.equal(runtimeConnectCalls.length, 0);
    assert.equal(transportMessages.length, 0);
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("late offscreen keep-alive replacement does not tear down an active support session", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, connectPort, runtimeConnectCalls } = createChromeMock({
    autoConnectOffscreenKeepAlive: false
  });

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_late_keepalive",
        supportCode: "654321",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
        tabId: 14,
        supportCode: "654321"
      },
      { tab: { id: 14 } }
    );

    assert.equal(joinResponse.ok, true);
    assert.equal(runtimeConnectCalls.length, 1);

    connectPort("unfluffify-remote-support-transport");
    await delay(0);

    const stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 14 },
      {}
    );

    assert.equal(stateResponse.ok, true);
    assert.equal(stateResponse.state.active, true);
    assert.equal(stateResponse.state.sessionId, "sess_late_keepalive");
    assert.equal(stateResponse.state.error, "");
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
        webrtcWsUrl: "ws://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
    assert.equal(transportMessages[0].session.wsUrl, "wss://api.example.com/webrtc?token=test");
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
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
      webrtcWsUrl: "wss://api.example.com/webrtc?token=a",
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
    },
    {
      sessionId: "sess_supporter_b",
      supportCode: "333444",
      expiresAt: "2026-05-24T08:10:00.000Z",
      webrtcWsUrl: "wss://api.example.com/webrtc?token=b",
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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

test("supporting sessions wait for the primary transport channel before marking connected", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const { chromeMock, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_primary_channel",
        supportCode: "112233",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
        tabId: 21,
        supportCode: "112233"
      },
      { tab: { id: 21 } }
    );

    assert.equal(joinResponse.ok, true);

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportTransportEvent",
        source: "remoteSupportOffscreen",
        event: {
          type: "channel-open",
          sessionId: "sess_primary_channel",
          channelKey: "sidebar"
        }
      },
      {
        url: chromeMock.runtime.getURL("remote-support-offscreen.html")
      }
    );

    let stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 21 },
      {}
    );

    assert.equal(stateResponse.ok, true);
    assert.equal(stateResponse.state.partnerConnected, true);
    assert.equal(stateResponse.state.connected, false);
    assert.equal(
      transportMessages.some(
        (message) =>
          message.type === "remoteSupportTransportSendData" &&
          message.sessionId === "sess_primary_channel" &&
          message.messageType === "control-include-payloads"
      ),
      false
    );

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportTransportEvent",
        source: "remoteSupportOffscreen",
        event: {
          type: "channel-open",
          sessionId: "sess_primary_channel",
          channelKey: "page"
        }
      },
      {
        url: chromeMock.runtime.getURL("remote-support-offscreen.html")
      }
    );

    stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 21 },
      {}
    );

    assert.equal(stateResponse.ok, true);
    assert.equal(stateResponse.state.connected, true);
    assert.equal(transportMessages.at(-1).type, "remoteSupportTransportSendData");
    assert.equal(transportMessages.at(-1).sessionId, "sess_primary_channel");
    assert.equal(transportMessages.at(-1).messageType, "control-include-payloads");
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remote support handoff updates shared ownership and blocks supporter commands until control returns", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const { chromeMock, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_control_owner",
        supportCode: "112233",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
        tabId: 63,
        supportCode: "112233"
      },
      { tab: { id: 63 } }
    );

    assert.equal(joinResponse.ok, true);

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportTransportEvent",
        source: "remoteSupportOffscreen",
        event: {
          type: "channel-open",
          sessionId: "sess_control_owner",
          channelKey: "page"
        }
      },
      {
        url: chromeMock.runtime.getURL("remote-support-offscreen.html")
      }
    );

    const handoffResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportSetControlOwner",
        tabId: 63,
        controlOwner: "requester"
      },
      { tab: { id: 63 } }
    );

    assert.equal(handoffResponse.ok, true);
    assert.equal(handoffResponse.state.controlOwner, "requester");
    assert.equal(
      transportMessages.some(
        (message) =>
          message.type === "remoteSupportTransportSendData" &&
          message.sessionId === "sess_control_owner" &&
          message.messageType === "control-owner" &&
          message.payload &&
          message.payload.owner === "requester"
      ),
      true
    );

    const blockedCommandResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportSendCommand",
        tabId: 63,
        command: { type: "scroll", deltaY: 80 }
      },
      { tab: { id: 63 } }
    );

    assert.equal(blockedCommandResponse.ok, false);

    const takeControlResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportSetControlOwner",
        tabId: 63,
        controlOwner: "supporter"
      },
      { tab: { id: 63 } }
    );

    assert.equal(takeControlResponse.ok, true);
    assert.equal(takeControlResponse.state.controlOwner, "supporter");

    const allowedCommandResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportSendCommand",
        tabId: 63,
        command: { type: "scroll", deltaY: 80 }
      },
      { tab: { id: 63 } }
    );

    assert.equal(allowedCommandResponse.ok, true);
    assert.equal(
      transportMessages.some(
        (message) =>
          message.type === "remoteSupportTransportSendData" &&
          message.sessionId === "sess_control_owner" &&
          message.messageType === "command" &&
          message.payload &&
          message.payload.type === "scroll"
      ),
      true
    );
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remote support replays cached requester sidebar snapshots on sidebar channel open and forwards incoming sidebar snapshots to the support page", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const { chromeMock, tabMessages, transportMessages } = createChromeMock();
  let requestCount = 0;

  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return {
        ok: true,
        async json() {
          return {
            sessionId: "sess_requester_sidebar",
            supportCode: "112233",
            expiresAt: "2026-05-24T08:10:00.000Z",
            webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
            iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          sessionId: "sess_supporter_sidebar",
          supportCode: "112233",
          expiresAt: "2026-05-24T08:10:00.000Z",
          webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
        };
      }
    };
  };

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    const requestResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 18,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 18 } }
    );

    assert.equal(requestResponse.ok, true);
    assert.deepEqual(
      transportMessages[0].session.dataChannels,
      [{ key: "page" }, { key: "sidebar" }]
    );

    const snapshotResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportUpdateSidebarSnapshot",
        tabId: 18,
        snapshot: {
          active: true,
          currentView: "Marking",
          currentPageUrl: "https://example.com/page",
          summaryRows: [{ label: "Extension", value: "Enabled" }]
        }
      },
      { tab: { id: 18 } }
    );

    assert.equal(snapshotResponse.ok, true);
    const sidebarSendCountBeforeChannelOpen = transportMessages.filter(
      (message) =>
        message.type === "remoteSupportTransportSendData" &&
        message.sessionId === "sess_requester_sidebar" &&
        message.channelKey === "sidebar" &&
        message.messageType === "sidebar-state"
    ).length;

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportTransportEvent",
        source: "remoteSupportOffscreen",
        event: {
          type: "channel-open",
          sessionId: "sess_requester_sidebar",
          channelKey: "sidebar"
        }
      },
      {
        url: chromeMock.runtime.getURL("remote-support-offscreen.html")
      }
    );

    const sidebarSendCountAfterChannelOpen = transportMessages.filter(
      (message) =>
        message.type === "remoteSupportTransportSendData" &&
        message.sessionId === "sess_requester_sidebar" &&
        message.channelKey === "sidebar" &&
        message.messageType === "sidebar-state"
    ).length;

    assert.equal(sidebarSendCountAfterChannelOpen > sidebarSendCountBeforeChannelOpen, true);
    assert.equal(
      transportMessages.some(
        (message) =>
          message.type === "remoteSupportTransportSendData" &&
          message.sessionId === "sess_requester_sidebar" &&
          message.channelKey === "sidebar" &&
          message.messageType === "sidebar-state" &&
          message.payload &&
          message.payload.snapshot &&
          message.payload.snapshot.currentView === "Marking"
      ),
      true
    );

    const joinResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportJoin",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 77,
        supportCode: "112233"
      },
      { tab: { id: 77 } }
    );

    assert.equal(joinResponse.ok, true);

    await handleTransportEvent({
      type: "incoming-message",
      sessionId: "sess_supporter_sidebar",
      channelKey: "sidebar",
      message: {
        type: "sidebar-state",
        payload: {
          snapshot: {
            active: true,
            currentView: "Configuration",
            currentPageUrl: "https://example.com/remote",
            summaryRows: [{ label: "Extension", value: "Disabled" }]
          }
        }
      }
    });

    assert.equal(
      tabMessages.some(
        ({ tabId, message }) =>
          tabId === 77 &&
          message &&
          message.type === "remoteSupportSidebarStateChanged" &&
          message.snapshot &&
          message.snapshot.currentView === "Configuration"
      ),
      true
    );
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remote support forwards runtime state and frames to the bound tab", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const { chromeMock, tabMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_support_page",
        supportCode: "112233",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
        tabId: 42,
        supportCode: "112233"
      },
      { tab: { id: 42 } }
    );

    assert.equal(joinResponse.ok, true);
    assert.equal(
      tabMessages.some(
        ({ tabId, message }) =>
          tabId === 42 &&
          message &&
          message.type === "remoteSupportStateChanged" &&
          message.state &&
          message.state.sessionId === "sess_support_page"
      ),
      true
    );

    await handleTransportEvent({
      type: "incoming-message",
      sessionId: "sess_support_page",
      message: {
        type: "frame",
        payload: {
          dataUrl: "data:image/jpeg;base64,frame-data"
        }
      }
    });

    assert.equal(
      tabMessages.some(
        ({ tabId, message }) =>
          tabId === 42 &&
          message &&
          message.type === "remoteSupportFrame" &&
          message.frame === "data:image/jpeg;base64,frame-data"
      ),
      true
    );
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});