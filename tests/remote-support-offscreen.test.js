import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES,
  REMOTE_SUPPORT_PORT_TRANSPORT
} from "../common/remote-support.js";

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
          wsUrl: "wss://api.example.com/webrtc?token=two",
          iceServers: [
            {
              urls: ["stun:stun.cloudflare.com:3478"]
            }
          ]
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
        { urls: ["stun:stun.cloudflare.com:3478"] }
      ],
      iceCandidatePoolSize: 4
    });
    assert.deepEqual(peerConnectionConfigs[1], {
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478"] }
      ],
      iceCandidatePoolSize: 4
    });

    let duplicateStartResponse;
    listener(
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
        duplicateStartResponse = value;
      }
    );

    await delay(0);

    assert.deepEqual(duplicateStartResponse, { ok: true });
    assert.equal(dataChannels.length, 2);
    assert.equal(peerConnectionConfigs.length, 2);

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

test("remote support offscreen queues ICE candidates received before the remote description", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;

  const runtimeMessageListeners = [];
  const connectedPortNames = [];
  const backgroundEvents = [];
  const sockets = [];
  const peerConnections = [];

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
      this.localDescription = null;
      this.remoteDescription = null;
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
      this.appliedIceCandidates = [];
      peerConnections.push(this);
    }

    createDataChannel() {
      return new FakeDataChannel();
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
      if (!this.remoteDescription) {
        throw new Error("Remote description required before ICE");
      }

      this.appliedIceCandidates.push(candidate);
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
    await import(`../remote-support-offscreen.js?case=${Date.now()}-queued-ice`);

    assert.deepEqual(connectedPortNames, [REMOTE_SUPPORT_PORT_TRANSPORT]);
    assert.equal(runtimeMessageListeners.length, 1);

    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_queued_ice",
          supportCode: "111111",
          role: "supporter",
          wsUrl: "wss://api.example.com/webrtc?token=one",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
    assert.equal(sockets.length, 1);
    assert.equal(peerConnections.length, 1);

    const candidate = {
      candidate: "candidate:1 1 UDP 2122252543 203.0.113.1 3478 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0
    };

    sockets[0].onmessage({
      data: JSON.stringify({
        type: "signal",
        payload: {
          signalType: "ice",
          sessionId: "sess_queued_ice",
          role: "requester",
          candidate
        }
      })
    });

    await delay(0);

    assert.deepEqual(peerConnections[0].appliedIceCandidates, []);
    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "transport-error"
      ),
      false
    );

    sockets[0].onmessage({
      data: JSON.stringify({
        type: "signal",
        payload: {
          signalType: "answer",
          sessionId: "sess_queued_ice",
          role: "requester",
          description: {
            type: "answer",
            sdp: "answer-sdp"
          }
        }
      })
    });

    await delay(0);
    await delay(0);

    assert.deepEqual(peerConnections[0].appliedIceCandidates, [candidate]);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
  }
});

test("remote support offscreen rejects start requests without ICE servers", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;

  const runtimeMessageListeners = [];
  const connectedPortNames = [];

  class FakeRTCPeerConnection {
    constructor() {
      this.connectionState = "new";
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
    }

    createDataChannel() {
      throw new Error("should not create data channel without ICE servers");
    }

    close() {
      this.connectionState = "closed";
    }
  }

  class OpenWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor() {
      this.readyState = OpenWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
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
      sendMessage() {
        return Promise.resolve({ ok: true });
      }
    }
  };
  globalThis.WebSocket = OpenWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  try {
    await import(`../remote-support-offscreen.js?case=${Date.now()}-missing-ice`);

    assert.deepEqual(connectedPortNames, [REMOTE_SUPPORT_PORT_TRANSPORT]);
    assert.equal(runtimeMessageListeners.length, 1);

    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_missing_ice",
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
    assert.deepEqual(startResponse, { ok: false, error: "Missing remote support ICE servers" });
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
          wsUrl: "wss://api.example.com/webrtc?token=one",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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
          wsUrl: "wss://api.example.com/webrtc?token=two",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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

test("remote support offscreen skips sends while the data channel buffer is over the limit", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;

  const runtimeMessageListeners = [];
  const dataChannels = [];

  class FakeDataChannel {
    constructor() {
      this.readyState = "open";
      this.binaryType = "arraybuffer";
      this.bufferedAmount = REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES;
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
    constructor() {
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

    constructor() {
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
      connect() {
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
      sendMessage() {
        return Promise.resolve({ ok: true });
      }
    }
  };
  globalThis.WebSocket = OpenWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  try {
    await import(`../remote-support-offscreen.js?case=${Date.now()}-buffered`);

    assert.equal(runtimeMessageListeners.length, 1);

    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_buffered",
          supportCode: "111111",
          role: "supporter",
          wsUrl: "wss://api.example.com/webrtc?token=one",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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

    let sendResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_buffered",
        messageType: "command",
        payload: { type: "pointer-click", x: 0.2, y: 0.3 }
      },
      {},
      (value) => {
        sendResponse = value;
      }
    );

    assert.deepEqual(sendResponse, { ok: false });
    assert.deepEqual(dataChannels[0].sent, []);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
  }
});

test("remote support offscreen chunks oversized data-channel messages and reassembles them on receipt", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;

  const runtimeMessageListeners = [];
  const backgroundEvents = [];
  const dataChannels = [];

  class FakeDataChannel {
    constructor() {
      this.readyState = "open";
      this.binaryType = "arraybuffer";
      this.bufferedAmount = 0;
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
      this.sent = [];
      this.sentRaw = [];

      queueMicrotask(() => {
        if (typeof this.onopen === "function") {
          this.onopen();
        }
      });
    }

    send(rawValue) {
      this.sentRaw.push(rawValue);
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
    constructor() {
      this.connectionState = "new";
      this.localDescription = null;
      this.remoteDescription = null;
      this.sctp = { maxMessageSize: 160 };
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

    constructor() {
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
      connect() {
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
    await import(`../remote-support-offscreen.js?case=${Date.now()}-chunked`);

    assert.equal(runtimeMessageListeners.length, 1);

    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_chunked",
          supportCode: "111111",
          role: "supporter",
          wsUrl: "wss://api.example.com/webrtc?token=one",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
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

    backgroundEvents.length = 0;

    const largeFrame = `data:image/jpeg;base64,${"a".repeat(2000)}`;
    let sendResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_chunked",
        messageType: "frame",
        payload: { dataUrl: largeFrame }
      },
      {},
      (value) => {
        sendResponse = value;
      }
    );

    assert.deepEqual(sendResponse, { ok: true });
    assert.ok(dataChannels[0].sentRaw.length > 1);
    assert.equal(dataChannels[0].sent.every((entry) => entry.type === "__remoteSupportChunk"), true);

    for (const rawMessage of dataChannels[0].sentRaw) {
      dataChannels[0].onmessage({ data: rawMessage });
    }
    await delay(0);

    const incomingMessageEvent = backgroundEvents.find(
      (message) =>
        message.type === "remoteSupportTransportEvent" &&
        message.event &&
        message.event.type === "incoming-message"
    );

    assert.ok(incomingMessageEvent);
    assert.equal(incomingMessageEvent.event.message.type, "frame");
    assert.equal(incomingMessageEvent.event.message.payload.dataUrl, largeFrame);
    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "transport-error"
      ),
      false
    );
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
  }
});

test("remote support offscreen supports multiple named data channels in one session", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;

  const runtimeMessageListeners = [];
  const backgroundEvents = [];
  const dataChannels = [];

  class FakeDataChannel {
    constructor(label) {
      this.label = label;
      this.readyState = "open";
      this.binaryType = "arraybuffer";
      this.bufferedAmount = 0;
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
    constructor() {
      this.connectionState = "new";
      this.localDescription = null;
      this.remoteDescription = null;
      this.sctp = { maxMessageSize: 65536 };
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
    }

    createDataChannel(label) {
      const channel = new FakeDataChannel(label);
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

    constructor() {
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
      connect() {
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
    await import(`../remote-support-offscreen.js?case=${Date.now()}-multi-channel`);

    assert.equal(runtimeMessageListeners.length, 1);

    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_multi_channel",
          supportCode: "111111",
          role: "supporter",
          wsUrl: "wss://api.example.com/webrtc?token=one",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
          dataChannels: [
            { key: "page", label: "remote-support-page" },
            { key: "sidebar", label: "remote-support-sidebar" }
          ]
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
    assert.equal(dataChannels.length, 2);
    assert.deepEqual(
      dataChannels.map((channel) => channel.label),
      ["remote-support-page", "remote-support-sidebar"]
    );
    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "channel-open" &&
          message.event.channelKey === "page"
      ),
      true
    );
    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "channel-open" &&
          message.event.channelKey === "sidebar"
      ),
      true
    );

    let sendResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_multi_channel",
        channelKey: "sidebar",
        messageType: "sidebar-state",
        payload: { section: "todo", expanded: true }
      },
      {},
      (value) => {
        sendResponse = value;
      }
    );

    assert.deepEqual(sendResponse, { ok: true });
    assert.deepEqual(dataChannels[0].sent, []);
    assert.deepEqual(dataChannels[1].sent, [
      {
        type: "sidebar-state",
        payload: { section: "todo", expanded: true }
      }
    ]);

    backgroundEvents.length = 0;
    dataChannels[1].onmessage({
      data: JSON.stringify({
        type: "sidebar-action",
        payload: { type: "toggle-section", section: "todo" }
      })
    });
    await delay(0);

    const incomingMessageEvent = backgroundEvents.find(
      (message) =>
        message.type === "remoteSupportTransportEvent" &&
        message.event &&
        message.event.type === "incoming-message"
    );

    assert.ok(incomingMessageEvent);
    assert.equal(incomingMessageEvent.event.channelKey, "sidebar");
    assert.equal(incomingMessageEvent.event.message.type, "sidebar-action");
    assert.deepEqual(incomingMessageEvent.event.message.payload, {
      type: "toggle-section",
      section: "todo"
    });
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
  }
});

test("remote support offscreen ignores close events from superseded data channels", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;

  const runtimeMessageListeners = [];
  const backgroundEvents = [];
  const peerConnections = [];

  class FakeDataChannel {
    constructor(label) {
      this.label = label;
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
    constructor() {
      peerConnections.push(this);
      this.connectionState = "connected";
      this.iceConnectionState = "connected";
      this.iceGatheringState = "complete";
      this.signalingState = "stable";
      this.localDescription = null;
      this.remoteDescription = null;
      this.sctp = { maxMessageSize: 65536 }; 
      this.onicecandidate = null;
      this.onicecandidateerror = null;
      this.oniceconnectionstatechange = null;
      this.onicegatheringstatechange = null;
      this.onsignalingstatechange = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
    }

    createDataChannel() {
      throw new Error("Requester should not create local data channels in this test");
    }

    async setRemoteDescription(description) {
      this.remoteDescription = description;
    }

    async setLocalDescription(description) {
      this.localDescription = description;
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

    constructor() {
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
      connect() {
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
    await import(`../remote-support-offscreen.js?case=${Date.now()}-stale-channel-close`);

    assert.equal(runtimeMessageListeners.length, 1);

    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_stale_page_channel",
          supportCode: "111111",
          role: "requester",
          wsUrl: "wss://api.example.com/webrtc?token=one",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
          dataChannels: [
            { key: "page", label: "remote-support-page" },
            { key: "sidebar", label: "remote-support-sidebar" }
          ]
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
    assert.equal(peerConnections.length, 1);

    const peerConnection = peerConnections[0];
    const firstPageChannel = new FakeDataChannel("remote-support-page");
    peerConnection.ondatachannel({ channel: firstPageChannel });
    await delay(0);

    const replacementPageChannel = new FakeDataChannel("remote-support-page");
    peerConnection.ondatachannel({ channel: replacementPageChannel });
    await delay(0);
    await delay(0);

    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "transport-error" &&
          message.event.sessionId === "sess_stale_page_channel"
      ),
      false
    );

    let sendResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSendData",
        sessionId: "sess_stale_page_channel",
        channelKey: "page",
        messageType: "command",
        payload: { type: "scroll", deltaY: 20 }
      },
      {},
      (value) => {
        sendResponse = value;
      }
    );

    assert.deepEqual(sendResponse, { ok: true });
    assert.deepEqual(replacementPageChannel.sent, [
      {
        type: "command",
        payload: { type: "scroll", deltaY: 20 }
      }
    ]);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
  }
});