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
  let desktopCaptureRequestCount = 0;

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
      getManifest() {
        return { version: "1.2.3-test" };
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
        if (message && message.type === "remoteSupportViewerTransportStart") {
          transportMessages.push({
            type: "remoteSupportTransportStart",
            session: message.session,
            tabId
          });
          return Promise.resolve({ ok: true });
        }

        if (message && message.type === "remoteSupportViewerTransportSendData") {
          transportMessages.push({
            type: "remoteSupportTransportSendData",
            sessionId: message.sessionId,
            messageType: message.messageType,
            payload: message.payload,
            channelKey: message.channelKey,
            tabId
          });
          return Promise.resolve({ ok: true });
        }

        if (message && message.type === "remoteSupportViewerTransportStop") {
          transportMessages.push({
            type: "remoteSupportTransportStop",
            sessionId: message.sessionId,
            reason: message.reason,
            notifyPeer: Boolean(message.notifyPeer),
            tabId
          });
          return Promise.resolve({ ok: true });
        }

        tabMessages.push({ tabId, message });
        return Promise.resolve();
      }
    },
    desktopCapture: {
      chooseDesktopMedia(sources, targetTab, callback) {
        void targetTab;
        desktopCaptureRequestCount += 1;
        const safeCallback = typeof callback === "function"
          ? callback
          : typeof targetTab === "function"
            ? targetTab
            : null;
        if (safeCallback) {
          safeCallback(`screen-stream-${desktopCaptureRequestCount}`, { canRequestAudioTrack: true, sources });
        }
        return desktopCaptureRequestCount;
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
    assert.equal(transportMessages[0].session.captureSource, "screen");
    assert.equal(transportMessages[0].session.mediaStreamId, "screen-stream-1");
    assert.equal(transportMessages[0].session.canRequestAudioTrack, true);
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

test("remoteSupportRequestCode fails when whole-screen sharing is cancelled", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, transportMessages } = createChromeMock();
  chromeMock.desktopCapture.chooseDesktopMedia = (sources, targetTab, callback) => {
    void sources;
    const safeCallback = typeof callback === "function"
      ? callback
      : typeof targetTab === "function"
        ? targetTab
        : null;
    if (safeCallback) {
      safeCallback("", { canRequestAudioTrack: false });
    }
    return 1;
  };

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_missing_tab_capture",
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
        tabId: 7,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 7 } }
    );

    assert.equal(response.ok, false);
    assert.match(response.error, /Screen sharing was cancelled or unavailable/);
    assert.equal(transportMessages.some((message) => message.type === "remoteSupportTransportStart"), false);
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

test("late offscreen keep-alive replacement does not tear down an active requester session", async () => {
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
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 14,
        pageUrl: "https://example.com/page"
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

    const dismissResponse = await handleRemoteSupportBackgroundMessage(
      { type: "remoteSupportDismissError", tabId: 9 },
      {}
    );

    assert.equal(dismissResponse.ok, true);
    assert.equal(dismissResponse.state.active, false);
    assert.equal(dismissResponse.state.tabId, 9);
    assert.equal(dismissResponse.state.error, "");

    const clearedStateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 9 },
      {}
    );

    assert.equal(clearedStateResponse.ok, true);
    assert.equal(clearedStateResponse.state.error, "");
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remote support dismisses active transport errors and broadcasts the cleared state", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, runtimeEvents, tabMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_active_warning",
        supportCode: "445566",
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
        tabId: 14,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 14 } }
    );

    assert.equal(response.ok, true);

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportTransportEvent",
        source: "remoteSupportOffscreen",
        event: {
          type: "transport-error",
          sessionId: "sess_active_warning",
          error: "Signaling connection interrupted"
        }
      },
      {
        url: chromeMock.runtime.getURL("remote-support-offscreen.html")
      }
    );

    const warningState = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 14 },
      {}
    );

    assert.equal(warningState.ok, true);
    assert.equal(warningState.state.active, true);
    assert.match(warningState.state.error, /Signaling connection interrupted/i);

    const runtimeEventCount = runtimeEvents.length;
    const tabMessageCount = tabMessages.length;
    const dismissResponse = await handleRemoteSupportBackgroundMessage(
      { type: "remoteSupportDismissError", sessionId: "sess_active_warning" },
      {}
    );

    assert.equal(dismissResponse.ok, true);
    assert.equal(dismissResponse.state.active, true);
    assert.equal(dismissResponse.state.tabId, 14);
    assert.equal(dismissResponse.state.error, "");

    const clearedState = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 14 },
      {}
    );

    assert.equal(clearedState.ok, true);
    assert.equal(clearedState.state.active, true);
    assert.equal(clearedState.state.error, "");
    assert.equal(
      runtimeEvents.slice(runtimeEventCount).some(
        (message) =>
          message &&
          message.type === "remoteSupportStateChanged" &&
          message.tabId === 14 &&
          message.state &&
          message.state.error === ""
      ),
      true
    );
    assert.equal(
      tabMessages.slice(tabMessageCount).some(
        ({ tabId, message }) =>
          tabId === 14 &&
          message &&
          message.type === "remoteSupportStateChanged" &&
          message.state &&
          message.state.error === ""
      ),
      true
    );
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
      partnerIdentity: "Requester Person",
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
    assert.equal(transportMessages[1].session.remoteParticipantName, "Requester Person");

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

test("remote support continue session is requester-only", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock } = createChromeMock();
  const responses = [
    {
      sessionId: "sess_requester_continue",
      supportCode: "555666",
      expiresAt: "2026-05-24T08:10:00.000Z",
      webrtcWsUrl: "wss://api.example.com/webrtc?token=requester",
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
    },
    {
      sessionId: "sess_supporter_continue",
      supportCode: "666777",
      expiresAt: "2026-05-24T08:10:00.000Z",
      webrtcWsUrl: "wss://api.example.com/webrtc?token=supporter",
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
    const requesterResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 41,
        pageUrl: "https://example.com/a"
      },
      { tab: { id: 41 } }
    );
    const supporterResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportJoin",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 42,
        supportCode: "666777"
      },
      { tab: { id: 42 } }
    );

    assert.equal(requesterResponse.ok, true);
    assert.equal(supporterResponse.ok, true);

    const requesterContinue = await handleRemoteSupportBackgroundMessage(
      { type: "remoteSupportContinueSession", tabId: 41 },
      { tab: { id: 41 } }
    );
    const supporterContinue = await handleRemoteSupportBackgroundMessage(
      { type: "remoteSupportContinueSession", tabId: 42 },
      { tab: { id: 42 } }
    );

    assert.equal(requesterContinue.ok, true);
    assert.equal(requesterContinue.state.active, true);
    assert.equal(supporterContinue.ok, false);
    assert.equal(supporterContinue.error, "Only the requester can continue the session");
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("extension telemetry feeds Unfluffify panels and requester remote peer", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, connectPort, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_extension_telemetry",
        supportCode: "889900",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
      };
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    const requestResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 41,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 41 } }
    );

    assert.equal(requestResponse.ok, true);

    const consolePort = connectPort("unfluffify-remote-support-console");
    consolePort.emitMessage({ type: "remoteSupportAttach", tabId: 41 });
    const networkPort = connectPort("unfluffify-remote-support-network");
    networkPort.emitMessage({ type: "remoteSupportAttach", tabId: 41 });

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportExtensionTelemetry",
        tabId: 41,
        channel: "console",
        entry: {
          source: "popup",
          level: "warn",
          message: "selector computation failed"
        }
      },
      {}
    );

    assert.equal(
      consolePort.postedMessages.some(
        (message) =>
          message.type === "remoteSupportConsoleEntry" &&
          message.entry &&
          message.entry.source === "popup" &&
          message.entry.message === "selector computation failed"
      ),
      true
    );
    assert.equal(
      transportMessages.some(
        (message) =>
          message.type === "remoteSupportTransportSendData" &&
          message.sessionId === "sess_extension_telemetry" &&
          message.messageType === "telemetry" &&
          message.payload &&
          message.payload.channel === "console" &&
          message.payload.entry &&
          message.payload.entry.source === "popup"
      ),
      true
    );

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportExtensionTelemetry",
        tabId: 41,
        channel: "console",
        entry: {
          source: "page",
          level: "info",
          message: "page bridge active"
        }
      },
      {}
    );

    assert.equal(
      consolePort.postedMessages.some(
        (message) =>
          message.type === "remoteSupportConsoleEntry" &&
          message.entry &&
          message.entry.source === "page" &&
          message.entry.message === "page bridge active"
      ),
      true
    );
    assert.equal(
      transportMessages.some(
        (message) =>
          message.type === "remoteSupportTransportSendData" &&
          message.sessionId === "sess_extension_telemetry" &&
          message.messageType === "telemetry" &&
          message.payload &&
          message.payload.channel === "console" &&
          message.payload.entry &&
          message.payload.entry.source === "page"
      ),
      true
    );

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportExtensionTelemetry",
        tabId: 41,
        channel: "network",
        entry: {
          source: "worker",
          type: "fetch",
          method: "POST",
          url: "https://api.example.com/save",
          statusCode: 200,
          payload: {
            request: "sensitive-body",
            response: "sensitive-response"
          }
        }
      },
      {}
    );

    assert.equal(
      networkPort.postedMessages.some(
        (message) =>
          message.type === "remoteSupportNetworkEntry" &&
          message.entry &&
          message.entry.source === "worker" &&
          message.entry.url === "https://api.example.com/save" &&
          message.entry.payload === null
      ),
      true,
      "local devtools port should not receive payload when includePayloads is false"
    );
    assert.equal(
      transportMessages.some(
        (message) =>
          message.type === "remoteSupportTransportSendData" &&
          message.sessionId === "sess_extension_telemetry" &&
          message.messageType === "telemetry" &&
          message.payload &&
          message.payload.channel === "network" &&
          message.payload.entry &&
          message.payload.entry.source === "worker" &&
          message.payload.entry.payload === null
      ),
      true
    );
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("console devtools port replays cached popup and worker console entries on attach", async () => {
  const originalChrome = globalThis.chrome;
  const { chromeMock, connectPort } = createChromeMock();

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportExtensionTelemetry",
        channel: "console",
        entry: {
          source: "worker",
          level: "info",
          message: "Unfluffify background worker ready"
        }
      },
      {}
    );

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportExtensionTelemetry",
        tabId: 52,
        channel: "console",
        entry: {
          source: "popup",
          level: "info",
          message: "Unfluffify popup ready"
        }
      },
      {}
    );

    const consolePort = connectPort("unfluffify-remote-support-console");
    consolePort.emitMessage({ type: "remoteSupportAttach", tabId: 52 });

    assert.equal(
      consolePort.postedMessages.some(
        (message) =>
          message.type === "remoteSupportConsoleEntry" &&
          message.entry &&
          message.entry.source === "worker" &&
          message.entry.message === "Unfluffify background worker ready"
      ),
      true,
      "console devtools port should replay cached worker console entries"
    );
    assert.equal(
      consolePort.postedMessages.some(
        (message) =>
          message.type === "remoteSupportConsoleEntry" &&
          message.entry &&
          message.entry.source === "popup" &&
          message.entry.message === "Unfluffify popup ready"
      ),
      true,
      "console devtools port should replay cached popup console entries"
    );

    const otherTabConsolePort = connectPort("unfluffify-remote-support-console");
    otherTabConsolePort.emitMessage({ type: "remoteSupportAttach", tabId: 7 });

    assert.equal(
      otherTabConsolePort.postedMessages.some(
        (message) =>
          message.type === "remoteSupportConsoleEntry" &&
          message.entry &&
          message.entry.source === "worker" &&
          message.entry.message === "Unfluffify background worker ready"
      ),
      true,
      "console devtools port should replay cached worker console entries to any tab"
    );
    assert.equal(
      otherTabConsolePort.postedMessages.some(
        (message) =>
          message.type === "remoteSupportConsoleEntry" &&
          message.entry &&
          message.entry.source === "popup" &&
          message.entry.message === "Unfluffify popup ready"
      ),
      false,
      "console devtools port should not replay cached popup console entries to other tabs"
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("local devtools port receives payload when includePayloads is enabled by incoming control message", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, connectPort } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_payload_enabled",
        supportCode: "445566",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=payload",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
      };
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 42,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 42 } }
    );

    const networkPort = connectPort("unfluffify-remote-support-network");
    networkPort.emitMessage({ type: "remoteSupportAttach", tabId: 42 });

    await handleTransportEvent({
      type: "incoming-message",
      sessionId: "sess_payload_enabled",
      channelKey: "page",
      message: {
        type: "control-include-payloads",
        payload: { enabled: true }
      }
    });

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportExtensionTelemetry",
        tabId: 42,
        channel: "network",
        entry: {
          source: "content",
          type: "fetch",
          method: "GET",
          url: "https://api.example.com/data",
          statusCode: 200,
          payload: {
            request: "",
            response: "api-response-body"
          }
        }
      },
      {}
    );

    assert.equal(
      networkPort.postedMessages.some(
        (message) =>
          message.type === "remoteSupportNetworkEntry" &&
          message.entry &&
          message.entry.source === "content" &&
          message.entry.payload !== null &&
          message.entry.payload &&
          message.entry.payload.response === "api-response-body"
      ),
      true,
      "local devtools port should receive payload when includePayloads is true"
    );
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("local network devtools port can enable payload capture without an active remote support session", async () => {
  const originalChrome = globalThis.chrome;
  const { chromeMock, connectPort, transportMessages } = createChromeMock();

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    const networkPort = connectPort("unfluffify-remote-support-network");
    networkPort.emitMessage({ type: "remoteSupportAttach", tabId: 77 });
    networkPort.emitMessage({ type: "setIncludePayloads", enabled: true });

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportExtensionTelemetry",
        tabId: 77,
        channel: "network",
        entry: {
          source: "popup",
          type: "fetch",
          method: "POST",
          url: "https://api.example.com/popup-save",
          statusCode: 200,
          payload: {
            request: "popup-request-body",
            response: "popup-response-body"
          }
        }
      },
      {}
    );

    assert.equal(
      networkPort.postedMessages.some(
        (message) =>
          message.type === "remoteSupportNetworkEntry" &&
          message.entry &&
          message.entry.source === "popup" &&
          message.entry.payload &&
          message.entry.payload.request === "popup-request-body" &&
          message.entry.payload.response === "popup-response-body"
      ),
      true,
      "local network devtools port should receive payloads after enabling local capture"
    );
    assert.equal(
      transportMessages.some((message) => message.messageType === "control-include-payloads"),
      false,
      "local payload capture without an active supporting session should not send remote control messages"
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("network devtools port disconnect resets includePayloads to false on supporting session", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, connectPort, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_payload_reset",
        supportCode: "556677",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=reset",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
      };
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportJoin",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 43,
        supportCode: "556677"
      },
      { tab: { id: 43 } }
    );

    const networkPort = connectPort("unfluffify-remote-support-network");
    networkPort.emitMessage({ type: "remoteSupportAttach", tabId: 43 });
    networkPort.emitMessage({ type: "setIncludePayloads", enabled: true });
    await delay(0);

    let stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 43 },
      {}
    );
    assert.equal(stateResponse.state.includePayloads, true, "includePayloads should be true after enabling");

    const transportCountBefore = transportMessages.length;
    networkPort.disconnect();
    await delay(0);

    stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 43 },
      {}
    );
    assert.equal(stateResponse.state.includePayloads, false, "includePayloads should reset to false on port disconnect");

    assert.equal(
      transportMessages.slice(transportCountBefore).some(
        (message) =>
          message.type === "remoteSupportTransportSendData" &&
          message.sessionId === "sess_payload_reset" &&
          message.messageType === "control-include-payloads" &&
          message.payload &&
          message.payload.enabled === false
      ),
      true,
      "control-include-payloads: false should be sent to requester on port disconnect"
    );
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("telemetry network entries carry integer header counts", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, transportMessages, connectPort } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_header_counts",
        supportCode: "667788",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=headers",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
      };
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 44,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 44 } }
    );

    const networkPort = connectPort("unfluffify-remote-support-network");
    networkPort.emitMessage({ type: "remoteSupportAttach", tabId: 44 });

    await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportExtensionTelemetry",
        tabId: 44,
        channel: "network",
        entry: {
          source: "content",
          type: "fetch",
          method: "POST",
          url: "https://api.example.com/data",
          statusCode: 200,
          requestHeaderCount: 7,
          responseHeaderCount: 12,
          payload: null
        }
      },
      {}
    );

    const networkEntry = transportMessages.find(
      (message) =>
        message.type === "remoteSupportTransportSendData" &&
        message.messageType === "telemetry" &&
        message.payload &&
        message.payload.channel === "network" &&
        message.payload.entry &&
        message.payload.entry.source === "content"
    );

    assert.ok(networkEntry, "network telemetry entry should be relayed to transport");

    const relayedEntry = networkEntry.payload.entry;

    assert.equal(
      typeof relayedEntry.requestHeaderCount === "number",
      true,
      "requestHeaderCount should be a number"
    );
    assert.equal(relayedEntry.requestHeaderCount, 7, "requestHeaderCount should be preserved as integer");
    assert.equal(
      typeof relayedEntry.responseHeaderCount === "number",
      true,
      "responseHeaderCount should be a number"
    );
    assert.equal(relayedEntry.responseHeaderCount, 12, "responseHeaderCount should be preserved as integer");
    assert.equal(
      "requestHeaders" in relayedEntry,
      false,
      "requestHeaders object should not be present in relayed entry"
    );
    assert.equal(
      "responseHeaders" in relayedEntry,
      false,
      "responseHeaders object should not be present in relayed entry"
    );

    const localNetworkMessage = networkPort.postedMessages.find(
      (message) =>
        message.type === "remoteSupportNetworkEntry" &&
        message.entry &&
        message.entry.source === "content"
    );
    assert.ok(localNetworkMessage, "local devtools port should receive the network entry");
    assert.equal(
      typeof localNetworkMessage.entry.requestHeaderCount === "number",
      true,
      "local devtools entry requestHeaderCount should be a number"
    );
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("supporter sessions can be ended by session id even when the viewer stop request fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock, transportMessages } = createChromeMock();
  const originalSendMessage = chromeMock.tabs.sendMessage;
  chromeMock.tabs.sendMessage = (tabId, message) => {
    if (message && message.type === "remoteSupportViewerTransportStop") {
      transportMessages.push({
        type: "remoteSupportTransportStop",
        sessionId: message.sessionId,
        reason: message.reason,
        notifyPeer: Boolean(message.notifyPeer),
        tabId,
        failed: true
      });
      return Promise.reject(new Error("Remote support viewer unavailable"));
    }

    return originalSendMessage(tabId, message);
  };

  const responses = [
    {
      sessionId: "sess_supporter_end",
      supportCode: "444555",
      expiresAt: "2026-05-24T08:10:00.000Z",
      webrtcWsUrl: "wss://api.example.com/webrtc?token=supporter-end",
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

  try {
    const supporterResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportJoin",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 22,
        supportCode: "444555"
      },
      { tab: { id: 22 } }
    );

    assert.equal(supporterResponse.ok, true);
    assert.equal(
      transportMessages.some(
        (message) =>
          message.type === "remoteSupportTransportStart" &&
          message.session &&
          message.session.sessionId === "sess_supporter_end"
      ),
      true
    );

    const endResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportEnd",
        sessionId: "sess_supporter_end"
      },
      { tab: { id: 999 } }
    );

    assert.equal(endResponse.ok, true);

    const endedSupporterState = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 22 },
      {}
    );

    assert.equal(endedSupporterState.state.active, false);
    assert.equal(endedSupporterState.state.tabId, 22);
    assert.equal(
      transportMessages.some(
        (message) =>
          message.type === "remoteSupportTransportStop" &&
          message.sessionId === "sess_supporter_end" &&
            message.notifyPeer === true &&
          message.failed === true
      ),
      true
    );
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

    let stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 21 },
      {}
    );

    assert.equal(stateResponse.ok, true);
    assert.equal(stateResponse.state.partnerConnected, false);
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

test("remote support is view-only and does not send remote control commands", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const { chromeMock, transportMessages } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_view_only",
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

    const controlResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportSetControlOwner",
        tabId: 63,
        controlOwner: "supporter"
      },
      { tab: { id: 63 } }
    );
    assert.equal(controlResponse.ok, false);
    assert.match(controlResponse.error, /Remote control is not available/);

    const commandResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportSendCommand",
        tabId: 63,
        command: { type: "scroll", deltaY: 80 }
      },
      { tab: { id: 63 } }
    );

    assert.equal(commandResponse.ok, false);
    assert.match(commandResponse.error, /Remote control is not available/);
    assert.equal(
      transportMessages.some((message) => message.type === "remoteSupportTransportSendData" && message.messageType === "command"),
      false
    );
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remote support starts requester and supporter sessions with only the page data channel", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const { chromeMock, transportMessages } = createChromeMock();
  let requestCount = 0;

  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return {
        ok: true,
        async json() {
          return {
            sessionId: "sess_requester_page_channel",
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
          sessionId: "sess_supporter_page_channel",
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
      [{ key: "page" }]
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
    assert.deepEqual(
      transportMessages[1].session.dataChannels,
      [{ key: "page" }]
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

test("remote support updates requester media flags when the supported popup toggles a local media control", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const mediaState = {
    cameraAvailable: true,
    cameraEnabled: true,
    microphoneAvailable: true,
    microphoneEnabled: true,
    soundAvailable: true,
    soundEnabled: true
  };
  const { chromeMock, transportMessages } = createChromeMock({
    offscreenResponse(message) {
      if (message && message.type === "remoteSupportTransportSetMediaState") {
        if (message.control === "camera") {
          mediaState.cameraEnabled = Boolean(message.enabled);
        }
        if (message.control === "microphone") {
          mediaState.microphoneEnabled = Boolean(message.enabled);
        }
        if (message.control === "sound") {
          mediaState.soundEnabled = Boolean(message.enabled);
        }
        return { ok: true, mediaState: { ...mediaState } };
      }

      return { ok: true };
    }
  });

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_requester_media",
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

    const toggleResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportSetLocalMediaEnabled",
        tabId: 18,
        sessionId: "sess_requester_media",
        control: "microphone",
        enabled: false
      },
      { tab: { id: 18 } }
    );

    assert.equal(toggleResponse.ok, true);
    assert.equal(toggleResponse.state.supporteeCameraAvailable, true);
    assert.equal(toggleResponse.state.supporteeCameraEnabled, true);
    assert.equal(toggleResponse.state.supporteeMicrophoneAvailable, true);
    assert.equal(toggleResponse.state.supporteeMicrophoneEnabled, false);
    assert.equal(toggleResponse.state.supporteeAudioAvailable, true);
    assert.equal(toggleResponse.state.supporteeAudioEnabled, true);
    assert.equal(
      transportMessages.some(
        (message) =>
          message &&
          message.type === "remoteSupportTransportSetMediaState" &&
          message.sessionId === "sess_requester_media" &&
          message.control === "microphone" &&
          message.enabled === false
      ),
      true
    );
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("remote support persists dock state updates for the active tab snapshot", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const { chromeMock } = createChromeMock();

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        sessionId: "sess_requester_dock_state",
        supportCode: "778899",
        expiresAt: "2026-05-24T08:10:00.000Z",
        webrtcWsUrl: "wss://api.example.com/webrtc?token=test",
        iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
      };
    }
  });

  globalThis.chrome = chromeMock;
  initRemoteSupportBackground();

  try {
    const requestResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportRequestCode",
        endpointValue: "https://api.example.com",
        tokenValue: "token-value",
        tabId: 61,
        pageUrl: "https://example.com/page"
      },
      { tab: { id: 61 } }
    );

    assert.equal(requestResponse.ok, true);
    assert.equal(requestResponse.state.dockState, "floating_pip");

    const dockResponse = await handleRemoteSupportBackgroundMessage(
      {
        type: "remoteSupportSetDockState",
        tabId: 61,
        sessionId: requestResponse.state.sessionId,
        dockState: "embedded_minimized"
      },
      { tab: { id: 61 } }
    );

    assert.equal(dockResponse.ok, true);
    assert.equal(dockResponse.state.dockState, "embedded_minimized");

    const stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState", tabId: 61 },
      {}
    );
    assert.equal(stateResponse.state.dockState, "embedded_minimized");
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});
