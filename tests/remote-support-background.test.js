import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  handleRemoteSupportBackgroundMessage,
  terminateRemoteSupportSession
} from "../common/remote-support-background.js";

test("remoteSupportRequestCode resolves before signaling socket opens", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalChrome = globalThis.chrome;

  const timeoutMarker = Symbol("timeout");

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

  globalThis.WebSocket = PendingWebSocket;
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage() {
        return Promise.resolve();
      }
    },
    tabs: {
      sendMessage() {
        return Promise.resolve();
      }
    }
  };

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
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    globalThis.chrome = originalChrome;
  }
});

test("remote support startup failure is surfaced through session state instead of hanging", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalChrome = globalThis.chrome;
  const originalPeerConnection = globalThis.RTCPeerConnection;

  class OpeningWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor(url) {
      this.url = url;
      this.readyState = OpeningWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;

      queueMicrotask(() => {
        this.readyState = OpeningWebSocket.OPEN;
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

  globalThis.WebSocket = OpeningWebSocket;
  globalThis.RTCPeerConnection = undefined;
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage() {
        return Promise.resolve();
      }
    },
    tabs: {
      sendMessage() {
        return Promise.resolve();
      }
    }
  };

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
    await delay(0);
    await delay(0);

    const stateResponse = await handleRemoteSupportBackgroundMessage(
      { type: "getRemoteSupportState" },
      {}
    );

    assert.equal(stateResponse.ok, true);
    assert.equal(stateResponse.state.active, false);
    assert.match(stateResponse.state.error, /WebRTC peer connection/i);
  } finally {
    await terminateRemoteSupportSession("Test cleanup");
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    globalThis.chrome = originalChrome;
    globalThis.RTCPeerConnection = originalPeerConnection;
  }
});