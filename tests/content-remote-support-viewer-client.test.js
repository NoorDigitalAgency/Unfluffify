import test from "node:test";
import assert from "node:assert/strict";

import { createRemoteSupportViewerClient } from "../content/remote-support-viewer-client.js";

function installViewerRuntimeHarness() {
  const previousWindow = globalThis.window;
  const previousMessageChannel = globalThis.MessageChannel;

  const frame = {
    dataset: {},
    src: "",
    hidden: true,
    contentWindow: {
      postMessage() {}
    },
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
  };

  const viewerMessages = [];
  const runtimeMessages = [];
  const stateRefreshes = [];
  const frameRenders = [];

  let lastPort1 = null;
  let lastPort2 = null;

  class FakeMessageChannel {
    constructor() {
      this.port1 = {
        onmessage: null,
        posted: [],
        start() {},
        close() {},
        postMessage: (message) => {
          this.port1.posted.push(message);
        }
      };
      this.port2 = {
        start() {},
        close() {}
      };
      lastPort1 = this.port1;
      lastPort2 = this.port2;
    }
  }

  globalThis.window = {
    setTimeout,
    clearTimeout
  };
  globalThis.MessageChannel = FakeMessageChannel;

  const deps = {
    getViewerOrigin: () => "https://example.test",
    getViewerFrame: () => frame,
    getViewerElement: () => frame,
    isSupportPageActive: () => true,
    onFrameMessage: (payload) => {
      viewerMessages.push(payload);
    },
    renderFrame: () => {
      frameRenders.push("render");
    },
    sendRuntimeMessageSafely: (message) => {
      runtimeMessages.push(message);
      return Promise.resolve({ ok: true });
    },
    updateStateFromBackground: () => {
      stateRefreshes.push("refresh");
    },
    REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH: "remote-support-viewer.html",
    REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_REQUEST_TIMEOUT_MS: 10
  };

  const triggerLoad = () => {
    const listener = frame.listeners.get("load");
    assert.ok(listener, "expected load listener to be registered");
    listener();
  };

  return {
    deps,
    frame,
    frameRenders,
    lastPort1: () => lastPort1,
    lastPort2: () => lastPort2,
    runtimeMessages,
    stateRefreshes,
    triggerLoad,
    viewerMessages,
    restore() {
      globalThis.window = previousWindow;
      globalThis.MessageChannel = previousMessageChannel;
    }
  };
}

test("remote support viewer client ready message resolves waiters", async () => {
  const harness = installViewerRuntimeHarness();
  try {
    const client = createRemoteSupportViewerClient(harness.deps);

    const readyPromise = client.waitUntilReady(100);
    await Promise.resolve();
    harness.triggerLoad();
    harness.lastPort1().onmessage({ data: { type: "ready" } });

    assert.equal(await readyPromise, true);
  } finally {
    harness.restore();
  }
});

test("remote support viewer client request timeout resolves with timeout error", async () => {
  const harness = installViewerRuntimeHarness();
  try {
    const client = createRemoteSupportViewerClient(harness.deps);

    client.initializeViewer(harness.frame);
    harness.triggerLoad();
    harness.lastPort1().onmessage({ data: { type: "ready" } });

    const response = await client.sendRequest("remoteSupportTransportStart", {
      session: { id: "abc" }
    });

    assert.deepEqual(response, { ok: false, error: "Remote support viewer timed out" });
  } finally {
    harness.restore();
  }
});

test("remote support viewer client forwards transport events to runtime message handler", () => {
  const harness = installViewerRuntimeHarness();
  try {
    const client = createRemoteSupportViewerClient(harness.deps);

    client.initializeViewer(harness.frame);
    harness.triggerLoad();

    harness.lastPort1().onmessage({
      data: {
        type: "transport-event",
        event: { type: "connected", sessionId: "session-1" }
      }
    });

    assert.deepEqual(harness.runtimeMessages, [{
      type: "remoteSupportTransportEvent",
      source: "remoteSupportViewer",
      event: { type: "connected", sessionId: "session-1" }
    }]);
  } finally {
    harness.restore();
  }
});

test("remote support viewer client video state updates active status and dimensions", () => {
  const harness = installViewerRuntimeHarness();
  try {
    const client = createRemoteSupportViewerClient(harness.deps);

    client.initializeViewer(harness.frame);
    harness.triggerLoad();

    harness.lastPort1().onmessage({
      data: {
        type: "video-state",
        active: true,
        width: 1280,
        height: 720,
        sessionId: "session-2"
      }
    });

    assert.equal(client.isVideoActive(), true);
    assert.equal(client.getIntrinsicWidth(), 1280);
    assert.equal(client.getIntrinsicHeight(), 720);
    assert.equal(harness.frame.hidden, false);
    assert.deepEqual(harness.frameRenders, ["render", "render"]);
    assert.deepEqual(harness.runtimeMessages, [{
      type: "remoteSupportTransportEvent",
      source: "remoteSupportViewer",
      event: {
        type: "video-state",
        sessionId: "session-2",
        active: true
      }
    }]);
  } finally {
    harness.restore();
  }
});
