import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { REMOTE_SUPPORT_PORT_TRANSPORT } from "../common/remote-support.js";

test("remote support offscreen document boots and accepts a start message", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;

  const runtimeMessageListeners = [];
  const connectedPortNames = [];
  const sentMessages = [];

  class PendingWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor(url) {
      this.url = url;
      this.readyState = PendingWebSocket.CONNECTING;
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
        sentMessages.push(message);
        return Promise.resolve({ ok: true });
      }
    }
  };
  globalThis.WebSocket = PendingWebSocket;

  try {
    await import("../remote-support-offscreen.js");

    assert.deepEqual(connectedPortNames, [REMOTE_SUPPORT_PORT_TRANSPORT]);
    assert.equal(runtimeMessageListeners.length, 1);

    let response;
    const handled = runtimeMessageListeners[0](
      {
        target: "remoteSupportOffscreen",
        type: "remoteSupportTransportStart",
        session: {
          sessionId: "sess_test",
          supportCode: "123456",
          role: "requester",
          wsUrl: "wss://api.example.com/webrtc?token=test"
        }
      },
      {},
      (value) => {
        response = value;
      }
    );

    assert.equal(handled, true);
    await delay(0);
    assert.deepEqual(response, { ok: true });
    assert.equal(sentMessages.length, 0);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
  }
});