import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

function createFakeElement() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    dataset: {},
    hidden: false,
    muted: false,
    srcObject: null,
    textContent: "",
    innerHTML: "",
    classList: {
      toggle() {}
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, event = {}) {
      const listener = listeners.get(type);
      if (typeof listener === "function") {
        listener(event);
      }
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    pause() {},
    play() {
      return Promise.resolve();
    },
    click() {
      this.dispatch("click");
    }
  };
}

function createFakeDocument() {
  const elements = new Map();
  const body = createFakeElement();
  body.dataset = {};
  const head = createFakeElement();

  return {
    body,
    head,
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createFakeElement());
      }
      return elements.get(id);
    }
  };
}

function createFakeControlPort() {
  return {
    started: false,
    postedMessages: [],
    onmessage: null,
    postMessage(message) {
      this.postedMessages.push(message);
    },
    start() {
      this.started = true;
    }
  };
}

test("remote support viewer keeps an established session alive when signaling closes", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  const windowListeners = new Map();
  const document = createFakeDocument();
  const sockets = [];
  const dataChannels = [];
  const parentWindow = {};
  const controlPort = createFakeControlPort();

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
      this.ontrack = null;
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

    async addIceCandidate() {}

    close() {
      this.connectionState = "closed";
    }
  }

  class OpenWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
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
      this.readyState = OpenWebSocket.CLOSED;
      if (typeof this.onclose === "function") {
        this.onclose();
      }
    }
  }

  globalThis.document = document;
  globalThis.window = {
    parent: parentWindow,
    documentPictureInPicture: null,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    }
  };
  globalThis.chrome = {
    runtime: {
      sendMessage() {
        return Promise.resolve({ ok: true });
      }
    }
  };
  globalThis.WebSocket = OpenWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  try {
    await import(`../remote-support-viewer.js?case=${Date.now()}-signaling-close-established`);

    const initListener = windowListeners.get("message");
    assert.equal(typeof initListener, "function");

    initListener({
      source: parentWindow,
      data: { type: "unfluffify:remote-support-viewer-init" },
      ports: [controlPort]
    });

    assert.equal(controlPort.started, true);
    assert.equal(controlPort.postedMessages[0].type, "ready");

    controlPort.onmessage({
      data: {
        type: "request",
        requestId: "start-1",
        requestType: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_viewer_signaling_close",
          supportCode: "111111",
          role: "supporter",
          wsUrl: "wss://api.example.com/webrtc?token=one",
          iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }]
        }
      }
    });

    await delay(0);
    await delay(0);

    assert.equal(dataChannels.length, 1);
    assert.equal(sockets.length, 1);
    assert.deepEqual(controlPort.postedMessages.find((message) => message.type === "response"), {
      type: "response",
      requestId: "start-1",
      response: { ok: true }
    });

    controlPort.postedMessages.length = 0;
    sockets[0].close();
    await delay(0);

    assert.equal(
      controlPort.postedMessages.some(
        (message) =>
          message.type === "transport-event" &&
          message.event &&
          message.event.type === "transport-error" &&
          message.event.sessionId === "sess_viewer_signaling_close" &&
          /Signaling channel closed/.test(message.event.error)
      ),
      true
    );
    assert.equal(
      controlPort.postedMessages.some(
        (message) =>
          message.type === "transport-event" &&
          message.event &&
          message.event.type === "session-ended" &&
          message.event.sessionId === "sess_viewer_signaling_close"
      ),
      false
    );

    let sendResponseMessage = null;
    controlPort.postedMessages.length = 0;
    controlPort.onmessage({
      data: {
        type: "request",
        requestId: "send-1",
        requestType: "remoteSupportTransportSendData",
        sessionId: "sess_viewer_signaling_close",
        messageType: "frame",
        payload: { dataUrl: "data:image/png;base64,abc" }
      }
    });
    sendResponseMessage = controlPort.postedMessages.find((message) => message.type === "response");
    assert.deepEqual(sendResponseMessage, {
      type: "response",
      requestId: "send-1",
      response: { ok: true }
    });
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
