import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  __resetPageWorldRelayForTests,
  initializePageWorldRelay,
  requestPageWorldCommand
} from "../content/page-world-relay.js";
import {
  PAGE_WORLD_COMMANDS,
  PAGE_WORLD_RELAY_CHANNEL,
  PAGE_WORLD_RELAY_MESSAGE_KINDS
} from "../common/page-world-protocol.js";

const bridgeSource = readFileSync(
  new URL("../common/page-motion-freeze-bridge.js", import.meta.url),
  "utf8"
);

function createRelayHarness() {
  const listeners = new Map();

  function addListener(type, listener) {
    const entries = listeners.get(type) || [];
    entries.push(listener);
    listeners.set(type, entries);
  }

  function removeListener(type, listener) {
    const entries = listeners.get(type) || [];
    listeners.set(type, entries.filter((entry) => entry !== listener));
  }

  function emit(type, event) {
    const entries = listeners.get(type) || [];
    for (const listener of entries) {
      listener(event);
    }
  }

  const documentObject = {
    addEventListener() {},
    removeEventListener() {}
  };

  const windowObject = {
    document: documentObject,
    setTimeout(callback, delay, ...args) {
      return setTimeout(callback, delay, ...args);
    },
    clearTimeout(handle) {
      clearTimeout(handle);
    },
    setInterval(callback, delay, ...args) {
      return setInterval(callback, delay, ...args);
    },
    clearInterval(handle) {
      clearInterval(handle);
    },
    requestAnimationFrame(callback) {
      return this.setTimeout(() => callback(Date.now()), 0);
    },
    cancelAnimationFrame(handle) {
      this.clearTimeout(handle);
    },
    addEventListener(type, listener) {
      addListener(type, listener);
    },
    removeEventListener(type, listener) {
      removeListener(type, listener);
    },
    postMessage(data) {
      emit("message", {
        source: windowObject,
        data
      });
    },
    IntersectionObserver: class FakeIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    ResizeObserver: class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  };

  return {
    windowObject,
    documentObject
  };
}

async function withRelayHarness(options, callback) {
  const { installBridge } = options;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  __resetPageWorldRelayForTests();
  const harness = createRelayHarness();
  globalThis.window = harness.windowObject;
  globalThis.document = harness.documentObject;
  if (installBridge) {
    // eslint-disable-next-line no-eval
    (0, eval)(bridgeSource);
  }
  try {
    await callback(harness);
  } finally {
    __resetPageWorldRelayForTests();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
}

test("page-world relay initializes and executes known commands", async () => {
  await withRelayHarness({ installBridge: true }, async () => {
    const init = await initializePageWorldRelay({ timeoutMs: 40 });
    assert.equal(init.ok, true);

    const applied = await requestPageWorldCommand(
      PAGE_WORLD_COMMANDS.SET_LAZY_LOADING_SUPPRESSED,
      { suppressed: true },
      { timeoutMs: 40 }
    );
    assert.equal(applied.lazyLoadingSuppressed, true);

    const restored = await requestPageWorldCommand(
      PAGE_WORLD_COMMANDS.SET_LAZY_LOADING_SUPPRESSED,
      { suppressed: false },
      { timeoutMs: 40 }
    );
    assert.equal(restored.lazyLoadingSuppressed, false);
  });
});

test("page-world relay rejects unknown commands", async () => {
  await withRelayHarness({ installBridge: true }, async () => {
    await initializePageWorldRelay({ timeoutMs: 40 });
    await assert.rejects(
      requestPageWorldCommand("PAGE_WORLD_UNKNOWN"),
      (error) => error && error.code === "handler_not_found"
    );
  });
});

test("page-world relay rejects requests with nonce mismatch", async () => {
  await withRelayHarness({ installBridge: true }, async () => {
    await initializePageWorldRelay({ timeoutMs: 40 });

    const responses = [];
    const onMessage = (event) => {
      const data = event && event.data;
      if (
        data
        && data.channel === PAGE_WORLD_RELAY_CHANNEL
        && data.kind === PAGE_WORLD_RELAY_MESSAGE_KINDS.RESPONSE
      ) {
        responses.push(data);
      }
    };
    window.addEventListener("message", onMessage);

    try {
      window.postMessage({
        channel: PAGE_WORLD_RELAY_CHANNEL,
        kind: PAGE_WORLD_RELAY_MESSAGE_KINDS.REQUEST,
        id: "forged-request",
        nonce: "mismatched-nonce",
        command: PAGE_WORLD_COMMANDS.SET_MOTION_PAUSED,
        payload: { paused: true }
      }, "*");

      const forgedResponse = responses.find((entry) => entry.id === "forged-request");
      assert.ok(forgedResponse);
      assert.equal(forgedResponse.ok, false);
      assert.equal(forgedResponse.code, "invalid_message");
    } finally {
      window.removeEventListener("message", onMessage);
    }
  });
});

test("page-world relay initialization times out when bridge does not reply", async () => {
  await withRelayHarness({ installBridge: false }, async () => {
    await assert.rejects(
      initializePageWorldRelay({ timeoutMs: 15 }),
      (error) => error && error.code === "timeout"
    );
  });
});
