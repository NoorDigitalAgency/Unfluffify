import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { REMOTE_SUPPORT_PORT_TRANSPORT } from "../common/remote-support.js";

test("remote support offscreen transport keeps concurrent sessions isolated", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;

  const runtimeMessageListeners = [];
  const connectedPortNames = [];
  const backgroundEvents = [];
  const dataChannels = [];
  const peerConnectionConfigs = [];

  class FakeDataChannel {
    constructor() {
      this.readyState = "open";
      this.binaryType = "arraybuffer";
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
      this.sent = [];

      queueMicrotask(() => {
        if (typeof this.onopen === "function") {
          this.onopen();
        }
      });
    }

    send(rawValue) {
      this.sent.push(JSON.parse(rawValue));
    }

    close() {
      this.readyState = "closed";
      if (typeof this.onclose === "function") {
        this.onclose();
      }
    }
  }

  class FakeRTCPeerConnection {
    constructor(configuration) {
      peerConnectionConfigs.push(configuration);
      this.connectionState = "new";
      this.localDescription = null;
      this.remoteDescription = null;
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
    }

    createDataChannel() {
      const channel = new FakeDataChannel();
      dataChannels.push(channel);
      return channel;
    }

    async createOffer() {
      return { type: "offer", sdp: "offer-sdp" };
    }

    async setLocalDescription(description) {
      this.localDescription = description;
    }

    async setRemoteDescription(description) {
      this.remoteDescription = description;
    }

    async createAnswer() {
      return { type: "answer", sdp: "answer-sdp" };
    }

    async addIceCandidate(candidate) {
      this.iceCandidate = candidate;
    }

    close() {
      this.connectionState = "closed";
    }
  }

  class OpenWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor(url) {
      this.url = url;
      this.readyState = OpenWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;

      queueMicrotask(() => {
        this.readyState = OpenWebSocket.OPEN;
        if (typeof this.onopen === "function") {
          this.onopen();
        }
      });
    }

    send() {}

    close() {
      this.readyState = 3;
      if (typeof this.onclose === "function") {
        this.onclose();
      }
    }
  }

  globalThis.window = {
    addEventListener() {}
  };
  globalThis.chrome = {
    runtime: {
      connect({ name }) {
        connectedPortNames.push(name);
        return {
          onDisconnect: {
            addListener() {}
          }
        };
      },
      onMessage: {
        addListener(listener) {
          runtimeMessageListeners.push(listener);
        }
      },
      sendMessage(message) {
        backgroundEvents.push(message);
        return Promise.resolve({ ok: true });
      }
    }
  };
  globalThis.WebSocket = OpenWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  try {
    await import(`../remote-support-offscreen.js?case=${Date.now()}`);

    assert.deepEqual(connectedPortNames, [REMOTE_SUPPORT_PORT_TRANSPORT]);
    assert.equal(runtimeMessageListeners.length, 1);

    const listener = runtimeMessageListeners[0];

    let startResponseOne;
    let startResponseTwo;

    const handledFirst = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_one",
          supportCode: "111111",
          role: "supporter",
          wsUrl: "wss://api.example.com/webrtc?token=one",
          iceServers: [
            {
              urls: ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
              username: "support-user",
              credential: "support-secret"
            },
            {
              urls: ["stun:stun.cloudflare.com:3478"]
            }
          ]
        }
      },
      {},
      (value) => {
        startResponseOne = value;
      }
    );
    const handledSecond = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_two",
          supportCode: "222222",
          role: "supporter",
          wsUrl: "wss://api.example.com/webrtc?token=two"
        }
      },
      {},
      (value) => {
        startResponseTwo = value;
      }
    );

    assert.equal(handledFirst, true);
    assert.equal(handledSecond, true);

    await delay(0);
    await delay(0);

    assert.deepEqual(startResponseOne, { ok: true });
    assert.deepEqual(startResponseTwo, { ok: true });
    assert.equal(dataChannels.length, 2);
    assert.deepEqual(peerConnectionConfigs[0], {
      iceServers: [
        {
          urls: ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
          username: "support-user",
          credential: "support-secret"
        },
        { urls: ["stun:stun.cloudflare.com:3478"] },
        { urls: ["stun:stun.l.google.com:19302"] },
        { urls: ["stun:stun1.l.google.com:19302"] },
        { urls: ["stun:global.stun.twilio.com:3478"] }
      ],
      iceCandidatePoolSize: 4
    });
    assert.deepEqual(peerConnectionConfigs[1], {
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478"] },
        { urls: ["stun:stun.l.google.com:19302"] },
        { urls: ["stun:stun1.l.google.com:19302"] },
        { urls: ["stun:global.stun.twilio.com:3478"] }
      ],
      iceCandidatePoolSize: 4
    });

    let sendResponseOne;
    let sendResponseTwo;

    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_one",
        messageType: "command",
        payload: { type: "pointer-click", x: 0.2, y: 0.3 }
      },
      {},
      (value) => {
        sendResponseOne = value;
      }
    );
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_two",
        messageType: "command",
        payload: { type: "pointer-click", x: 0.8, y: 0.9 }
      },
      {},
      (value) => {
        sendResponseTwo = value;
      }
    );

    assert.deepEqual(sendResponseOne, { ok: true });
    assert.deepEqual(sendResponseTwo, { ok: true });
    assert.deepEqual(dataChannels[0].sent[0], {
      type: "command",
      payload: { type: "pointer-click", x: 0.2, y: 0.3 }
    });
    assert.deepEqual(dataChannels[1].sent[0], {
      type: "command",
      payload: { type: "pointer-click", x: 0.8, y: 0.9 }
    });

    let stopResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStop",
        sessionId: "sess_one",
        reason: "Session ended"
      },
      {},
      (value) => {
        stopResponse = value;
      }
    );

    await delay(0);

    assert.deepEqual(stopResponse, { ok: true });

    let stoppedSessionSendResponse;
    let remainingSessionSendResponse;

    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_one",
        messageType: "command",
        payload: { type: "pointer-move", x: 0.1, y: 0.1 }
      },
      {},
      (value) => {
        stoppedSessionSendResponse = value;
      }
    );
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_two",
        messageType: "command",
        payload: { type: "pointer-move", x: 0.9, y: 0.9 }
      },
      {},
      (value) => {
        remainingSessionSendResponse = value;
      }
    );

    assert.deepEqual(stoppedSessionSendResponse, { ok: false });
    assert.deepEqual(remainingSessionSendResponse, { ok: true });
    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "channel-open" &&
          message.event.sessionId === "sess_two"
      ),
      true
    );
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
  }
});

test("remote support offscreen tears down both sides when the data channel fails or the server ends the session", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;

  const runtimeMessageListeners = [];
  const connectedPortNames = [];
  const backgroundEvents = [];
  const dataChannels = [];
  const sockets = [];

  class FakeDataChannel {
    constructor() {
      this.readyState = "open";
      this.binaryType = "arraybuffer";
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;

      queueMicrotask(() => {
        if (typeof this.onopen === "function") {
          this.onopen();
        }
      });
    }

    send() {}

    close() {
      this.readyState = "closed";
      if (typeof this.onclose === "function") {
        this.onclose();
      }
    }
  }

  class FakeRTCPeerConnection {
    constructor() {
      this.connectionState = "new";
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
    }

    createDataChannel() {
      const channel = new FakeDataChannel();
      dataChannels.push(channel);
      return channel;
    }

    async createOffer() {
      return { type: "offer", sdp: "offer-sdp" };
    }

    async setLocalDescription(description) {
      this.localDescription = description;
    }

    async setRemoteDescription(description) {
      this.remoteDescription = description;
    }

    async createAnswer() {
      return { type: "answer", sdp: "answer-sdp" };
    }

    async addIceCandidate(candidate) {
      this.iceCandidate = candidate;
    }

    close() {
      this.connectionState = "closed";
    }
  }

  class OpenWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor(url) {
      this.url = url;
      this.readyState = OpenWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      sockets.push(this);

      queueMicrotask(() => {
        this.readyState = OpenWebSocket.OPEN;
        if (typeof this.onopen === "function") {
          this.onopen();
        }
      });
    }

    send() {}

    close() {
      this.readyState = 3;
      if (typeof this.onclose === "function") {
        this.onclose();
      }
    }
  }

  globalThis.window = {
    addEventListener() {}
  };
  globalThis.chrome = {
    runtime: {
      connect({ name }) {
        connectedPortNames.push(name);
        return {
          onDisconnect: {
            addListener() {}
          }
        };
      },
      onMessage: {
        addListener(listener) {
          runtimeMessageListeners.push(listener);
        }
      },
      sendMessage(message) {
        backgroundEvents.push(message);
        return Promise.resolve({ ok: true });
      }
    }
  };
  globalThis.WebSocket = OpenWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  try {
    await import(`../remote-support-offscreen.js?case=${Date.now()}-ended`);

    assert.deepEqual(connectedPortNames, [REMOTE_SUPPORT_PORT_TRANSPORT]);
    assert.equal(runtimeMessageListeners.length, 1);

    const listener = runtimeMessageListeners[0];

    let startResponse;
    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_error",
          supportCode: "111111",
          role: "supporter",
          wsUrl: "wss://api.example.com/webrtc?token=one"
        }
      },
      {},
      (value) => {
        startResponse = value;
      }
    );

    assert.equal(handled, true);
    await delay(0);
    await delay(0);
    assert.deepEqual(startResponse, { ok: true });
    assert.equal(dataChannels.length, 1);
    assert.equal(sockets.length, 1);

    dataChannels[0].onerror();
    await delay(0);

    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "transport-error" &&
          message.event.sessionId === "sess_error" &&
          message.event.error === "Remote support data channel failed"
      ),
      true
    );
    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "session-ended" &&
          message.event.sessionId === "sess_error" &&
          message.event.reason === "Remote support data channel failed"
      ),
      true
    );

    let afterErrorSendResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_error",
        messageType: "command",
        payload: { type: "pointer-click", x: 0.5, y: 0.5 }
      },
      {},
      (value) => {
        afterErrorSendResponse = value;
      }
    );

    assert.deepEqual(afterErrorSendResponse, { ok: false });

    backgroundEvents.length = 0;

    let secondStartResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_remote_end",
          supportCode: "222222",
          role: "supporter",
          wsUrl: "wss://api.example.com/webrtc?token=two"
        }
      },
      {},
      (value) => {
        secondStartResponse = value;
      }
    );

    await delay(0);
    await delay(0);
    assert.deepEqual(secondStartResponse, { ok: true });
    assert.equal(sockets.length, 2);

    sockets[1].onmessage({
      data: JSON.stringify({
        type: "session-ended",
        payload: {
          sessionId: "sess_remote_end",
          reason: "requester disconnected"
        }
      })
    });
    await delay(0);

    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "session-ended" &&
          message.event.sessionId === "sess_remote_end" &&
          message.event.reason === "requester disconnected"
      ),
      true
    );

    let afterRemoteEndSendResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_remote_end",
        messageType: "command",
        payload: { type: "pointer-click", x: 0.4, y: 0.4 }
      },
      {},
      (value) => {
        afterRemoteEndSendResponse = value;
      }
    );

    assert.deepEqual(afterRemoteEndSendResponse, { ok: false });
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
  }
});