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
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const runtimeMessageListeners = [];
  const connectedPortNames = [];
  const backgroundEvents = [];
  const dataChannels = [];
  const peerConnectionConfigs = [];
  const sockets = [];

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
      this.sent = [];
      sockets.push(this);

      queueMicrotask(() => {
        this.readyState = OpenWebSocket.OPEN;
        if (typeof this.onopen === "function") {
          this.onopen();
        }
      });
    }

    send(rawValue) {
      this.sent.push(JSON.parse(rawValue));
    }

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
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getDisplayMedia() { return fakeDisplayStream; },
        async getUserMedia() { throw new Error("optional camera unavailable"); }
      }
    }
  });
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
        reason: "Session ended",
        notifyPeer: true
      },
      {},
      (value) => {
        stopResponse = value;
      }
    );

    await delay(0);

    assert.deepEqual(stopResponse, { ok: true });
    assert.equal(
      sockets[0].sent.some(
        (message) =>
          message.type === "session-ended" &&
          message.payload &&
          message.payload.sessionId === "sess_one" &&
          message.payload.role === "supporter" &&
          message.payload.reason === "Session ended"
      ),
      true
    );

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
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  }
});

test("requester media control messages toggle camera, microphone, and shared sound tracks", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const runtimeMessageListeners = [];
  const backgroundEvents = [];

  const displayVideoTrack = {
    kind: "video",
    enabled: true,
    stop() {},
    addEventListener() {}
  };
  const displayAudioTrack = {
    kind: "audio",
    enabled: true,
    stop() {}
  };
  const cameraVideoTrack = {
    kind: "video",
    enabled: true,
    stop() {}
  };
  const microphoneTrack = {
    kind: "audio",
    enabled: true,
    stop() {}
  };

  const fakeDisplayStream = {
    getTracks() {
      return [displayVideoTrack, displayAudioTrack];
    },
    getVideoTracks() {
      return [displayVideoTrack];
    },
    getAudioTracks() {
      return [displayAudioTrack];
    }
  };

  const fakeCameraStream = {
    getTracks() {
      return [cameraVideoTrack, microphoneTrack];
    },
    getVideoTracks() {
      return [cameraVideoTrack];
    },
    getAudioTracks() {
      return [microphoneTrack];
    }
  };

  class FakeRTCPeerConnection {
    constructor() {
      this.connectionState = "new";
      this.onicecandidate = null;
      this.onicecandidateerror = null;
      this.oniceconnectionstatechange = null;
      this.onicegatheringstatechange = null;
      this.onsignalingstatechange = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
    }

    addTrack() {
      return {
        getParameters() {
          return {};
        },
        async setParameters() {}
      };
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
    addEventListener() {},
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
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

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          if (constraints && constraints.video && constraints.video.mandatory) {
            return fakeDisplayStream;
          }

          return fakeCameraStream;
        }
      }
    }
  });

  globalThis.WebSocket = OpenWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  try {
    await import(`../remote-support-offscreen.js?case=${Date.now()}-requester-media-controls`);

    assert.equal(runtimeMessageListeners.length, 1);
    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_requester_media_controls",
          supportCode: "111111",
          role: "requester",
          wsUrl: "wss://api.example.com/webrtc?token=requester-media",
          mediaStreamId: "stream-22",
          captureSource: "screen",
          canRequestAudioTrack: true,
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
          dataChannels: [{ key: "page", label: "remote-support-page" }]
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
    assert.equal(
      backgroundEvents.some(
        (message) =>
          message &&
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "media-state" &&
          message.event.mediaState &&
          message.event.mediaState.cameraAvailable === true &&
          message.event.mediaState.microphoneAvailable === true &&
          message.event.mediaState.soundAvailable === true
      ),
      true
    );

    let cameraResponse;
    const handledCamera = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSetMediaState",
        sessionId: "sess_requester_media_controls",
        control: "camera",
        enabled: false
      },
      {},
      (value) => {
        cameraResponse = value;
      }
    );

    assert.equal(handledCamera, false);
    assert.equal(cameraVideoTrack.enabled, false);
    assert.equal(cameraResponse.ok, true);
    assert.equal(cameraResponse.mediaState.cameraEnabled, false);

    let microphoneResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSetMediaState",
        sessionId: "sess_requester_media_controls",
        control: "microphone",
        enabled: false
      },
      {},
      (value) => {
        microphoneResponse = value;
      }
    );

    assert.equal(microphoneTrack.enabled, false);
    assert.equal(microphoneResponse.ok, true);
    assert.equal(microphoneResponse.mediaState.microphoneEnabled, false);

    let soundResponse;
    listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportSetMediaState",
        sessionId: "sess_requester_media_controls",
        control: "sound",
        enabled: false
      },
      {},
      (value) => {
        soundResponse = value;
      }
    );

    assert.equal(displayAudioTrack.enabled, false);
    assert.equal(soundResponse.ok, true);
    assert.equal(soundResponse.mediaState.soundEnabled, false);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  }
});

test("requester popup camera previews sample video frames at the configured interval", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const runtimeMessageListeners = [];
  const previewCallbacks = [];
  const previewMessages = [];
  const pendingTimers = [];

  const displayVideoTrack = {
    kind: "video",
    contentHint: "",
    readyState: "live",
    enabled: true,
    stop() {},
    addEventListener() {}
  };
  const displayAudioTrack = {
    kind: "audio",
    enabled: true,
    stop() {}
  };
  const cameraVideoTrack = {
    kind: "video",
    contentHint: "",
    readyState: "live",
    enabled: true,
    stop() {}
  };
  const microphoneTrack = {
    kind: "audio",
    enabled: true,
    stop() {}
  };
  const sidebarTrack = {
    kind: "video",
    contentHint: "",
    readyState: "live",
    enabled: true,
    stop() {},
    requestFrame() {}
  };

  const fakeDisplayStream = {
    getTracks() {
      return [displayVideoTrack, displayAudioTrack];
    },
    getVideoTracks() {
      return [displayVideoTrack];
    },
    getAudioTracks() {
      return [displayAudioTrack];
    }
  };
  const fakeCameraStream = {
    getTracks() {
      return [cameraVideoTrack, microphoneTrack];
    },
    getVideoTracks() {
      return [cameraVideoTrack];
    },
    getAudioTracks() {
      return [microphoneTrack];
    }
  };

  class FakeRTCPeerConnection {
    constructor() {
      this.connectionState = "new";
      this.localDescription = null;
      this.remoteDescription = null;
      this.onicecandidate = null;
      this.onicecandidateerror = null;
      this.oniceconnectionstatechange = null;
      this.onicegatheringstatechange = null;
      this.onsignalingstatechange = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
      this.ontrack = null;
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

    async addIceCandidate() {}

    addTrack() {
      return {
        getParameters() {
          return {};
        },
        async setParameters() {}
      };
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

  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
    }

    postMessage(message) {
      if (this.name === "unfluffify-remote-support-popup-media") {
        previewMessages.push(message);
      }
    }

    close() {}
  }

  function flushNextTimer() {
    const timer = pendingTimers.shift();
    if (!timer || timer.cleared) {
      return;
    }
    timer.callback();
  }

  globalThis.setTimeout = (callback, delay = 0) => {
    const timer = { callback, delay, cleared: false };
    pendingTimers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };

  globalThis.window = {
    addEventListener() {},
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  };
  globalThis.document = {
    createElement(tagName) {
      if (tagName === "video") {
        return {
          muted: false,
          playsInline: false,
          autoplay: false,
          srcObject: null,
          videoWidth: 640,
          videoHeight: 360,
          play() {
            return Promise.resolve();
          },
          requestVideoFrameCallback(callback) {
            previewCallbacks.push(callback);
            return previewCallbacks.length;
          }
        };
      }

      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              clearRect() {},
              drawImage() {},
              fillRect() {},
              fillStyle: "#000"
            };
          },
          captureStream() {
            return {
              getTracks() {
                return [sidebarTrack];
              },
              getVideoTracks() {
                return [sidebarTrack];
              }
            };
          }
        };
      }

      throw new Error(`Unexpected element requested: ${tagName}`);
    }
  };
  globalThis.BroadcastChannel = FakeBroadcastChannel;
  globalThis.createImageBitmap = async () => ({
    width: 160,
    height: 90,
    close() {}
  });
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
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          if (constraints && constraints.video && constraints.video.mandatory) {
            return fakeDisplayStream;
          }

          return fakeCameraStream;
        }
      }
    }
  });
  globalThis.WebSocket = OpenWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  try {
    await import(`../remote-support-offscreen.js?case=${Date.now()}-preview-throttle`);

    assert.equal(runtimeMessageListeners.length, 1);
    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_requester_preview_throttle",
          supportCode: "111111",
          role: "requester",
          tabId: 22,
          wsUrl: "wss://api.example.com/webrtc?token=requester-preview",
          mediaStreamId: "stream-22",
          captureSource: "screen",
          canRequestAudioTrack: true,
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
          dataChannels: [{ key: "page", label: "remote-support-page" }]
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
    assert.equal(previewCallbacks.length, 1);
    assert.equal(pendingTimers.length, 0);

    await previewCallbacks[0](0);

    assert.equal(previewMessages.length, 1);
    assert.equal(previewCallbacks.length, 1);
    assert.equal(pendingTimers.length, 1);
    assert.equal(pendingTimers[0].delay, 100);

    flushNextTimer();

    assert.equal(previewCallbacks.length, 2);
    assert.equal(pendingTimers.length, 0);

    await previewCallbacks[1](100);

    assert.equal(previewMessages.length, 2);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.BroadcastChannel = originalBroadcastChannel;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
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

test("remote support offscreen reports screen sharing unavailable when no display capture API exists", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const runtimeMessageListeners = [];
  const backgroundEvents = [];

  class FakeRTCPeerConnection {
    constructor() {
      this.connectionState = "new";
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
      this.localDescription = null;
      this.remoteDescription = null;
    }

    createDataChannel() {
      return {
        readyState: "open",
        binaryType: "arraybuffer",
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
        send() {},
        close() {}
      };
    }

    async createOffer() {
      return { type: "offer", sdp: "offer-sdp" };
    }

    async setLocalDescription(description) {
      this.localDescription = description;
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
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() { throw new Error("optional camera unavailable"); }
      }
    }
  });
  globalThis.WebSocket = OpenWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  try {
    await import(`../remote-support-offscreen.js?case=${Date.now()}-missing-display-capture`);

    assert.equal(runtimeMessageListeners.length, 1);

    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_missing_display_capture",
          supportCode: "111111",
          role: "requester",
          wsUrl: "wss://api.example.com/webrtc?token=missing-display-capture",
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
    assert.equal(
      backgroundEvents.some(
        (message) =>
          message.type === "remoteSupportTransportEvent" &&
          message.event &&
          message.event.type === "transport-error" &&
          message.event.sessionId === "sess_missing_display_capture" &&
          message.event.error === "Remote support screen sharing is unavailable"
      ),
      true
    );
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
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
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const runtimeMessageListeners = [];
  const backgroundEvents = [];
  const peerConnections = [];
  const fakeDisplayTrack = { contentHint: "", addEventListener() {}, stop() {} };
  const fakeDisplayStream = {
    getTracks() { return [fakeDisplayTrack]; },
    getVideoTracks() { return [fakeDisplayTrack]; }
  };

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
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getDisplayMedia() { return fakeDisplayStream; },
        async getUserMedia() { throw new Error("optional camera unavailable"); }
      }
    }
  });
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
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  }
});

test("remote support offscreen attaches requester window fallback and camera/mic tracks", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const runtimeMessageListeners = [];
  const peerConnections = [];
  const capturedConstraints = [];
  let senderParameters = null;

  const fakeTrack = {
    contentHint: "",
    addEventListener() {},
    stop() {}
  };
  const fakeStream = {
    getTracks() {
      return [fakeTrack];
    },
    getVideoTracks() {
      return [fakeTrack];
    }
  };

  class FakeRTCPeerConnection {
    constructor() {
      peerConnections.push(this);
      this.connectionState = "new";
      this.localDescription = null;
      this.remoteDescription = null;
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
      this.addedTracks = [];
    }

    addTrack(track, stream) {
      const sender = {
        getParameters() {
          return {};
        },
        async setParameters(parameters) {
          senderParameters = parameters;
        }
      };
      this.addedTracks.push({ track, stream, sender });
      return sender;
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
      sendMessage() {
        return Promise.resolve({ ok: true });
      }
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          capturedConstraints.push(constraints);
          return fakeStream;
        }
      }
    }
  });
  globalThis.WebSocket = OpenWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  try {
    await import(`../remote-support-offscreen.js?case=${Date.now()}-requester-video-track`);

    assert.equal(runtimeMessageListeners.length, 1);
    const listener = runtimeMessageListeners[0];
    let startResponse;

    const handled = listener(
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_requester_video_track",
          supportCode: "111111",
          role: "requester",
          wsUrl: "wss://api.example.com/webrtc?token=requester-video",
          mediaStreamId: "stream-18",
          captureSource: "screen",
          canRequestAudioTrack: false,
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
    assert.equal(peerConnections[0].addedTracks.length, 2);
    assert.equal(peerConnections[0].addedTracks[0].track, fakeTrack);
    assert.equal(peerConnections[0].addedTracks[0].stream, fakeStream);
    assert.equal(peerConnections[0].addedTracks[1].track, fakeTrack);
    assert.equal(peerConnections[0].addedTracks[1].stream, fakeStream);
    assert.equal(capturedConstraints[0].audio, false);
    assert.equal(capturedConstraints[0].video.mandatory.chromeMediaSource, "desktop");
    assert.equal(capturedConstraints[0].video.mandatory.chromeMediaSourceId, "stream-18");
    assert.equal(capturedConstraints[0].video.mandatory.maxFrameRate, 60);
    assert.deepEqual(capturedConstraints[1], { audio: true, video: true });
    assert.equal(fakeTrack.contentHint, "motion");
    assert.equal(senderParameters.degradationPreference, "maintain-framerate");
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  }
});