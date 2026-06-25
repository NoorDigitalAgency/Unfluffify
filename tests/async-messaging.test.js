import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  MessageRequestError,
  requestContent,
  requestRuntime,
  requestTab
} from "../common/async-messaging.js";
import { MESSAGE_ERROR_CODES } from "../common/message-protocol.js";

function withBrowser(value, callback) {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  globalThis.browser = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (typeof originalBrowser === "undefined") {
        delete globalThis.browser;
      } else {
        globalThis.browser = originalBrowser;
      }
      if (typeof originalChrome === "undefined") {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = originalChrome;
      }
    });
}

test("requestRuntime resolves the response result on success", async () => {
  await withBrowser({
    runtime: {
      id: "test-runtime",
      sendMessage(message) {
        return Promise.resolve({ id: message.id, ok: true, result: { echoed: message.type } });
      }
    }
  }, async () => {
    const result = await requestRuntime({ type: "runtime:ping" });
    assert.deepEqual(result, { echoed: "runtime:ping" });
  });
});

test("requestRuntime rejects when reply envelope has ok:false", async () => {
  await withBrowser({
    runtime: {
      id: "test-runtime",
      sendMessage() {
        return Promise.resolve({ id: "x", ok: false, code: "handler_failed", error: "nope" });
      }
    }
  }, async () => {
    await assert.rejects(
      requestRuntime({ type: "runtime:fail" }),
      (error) => {
        assert.ok(error instanceof MessageRequestError);
        assert.equal(error.code, "handler_failed");
        assert.equal(error.message, "nope");
        return true;
      }
    );
  });
});

test("requestRuntime rejects on browser runtime errors", async () => {
  await withBrowser({
    runtime: {
      id: "test-runtime",
      sendMessage() {
        return Promise.reject(new Error("runtime exploded"));
      }
    }
  }, async () => {
    await assert.rejects(
      requestRuntime({ type: "runtime:last-error" }),
      (error) => {
        assert.ok(error instanceof MessageRequestError);
        assert.equal(error.code, MESSAGE_ERROR_CODES.RUNTIME_ERROR);
        assert.match(error.message, /runtime exploded/);
        return true;
      }
    );
  });
});

test("requestRuntime rejects on timeout and clears timeout after completion", async () => {
  const activeTimers = new Set();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = originalSetTimeout(() => {
      activeTimers.delete(id);
      fn(...args);
    }, ms);
    activeTimers.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    activeTimers.delete(id);
    return originalClearTimeout(id);
  };

  try {
    await withBrowser({
      runtime: {
        id: "test-runtime",
        sendMessage() {
          return new Promise(() => {});
        }
      }
    }, async () => {
      await assert.rejects(
        requestRuntime({ type: "runtime:timeout" }, { timeoutMs: 10 }),
        (error) => {
          assert.ok(error instanceof MessageRequestError);
          assert.equal(error.code, MESSAGE_ERROR_CODES.TIMEOUT);
          assert.equal(error.timeoutMs, 10);
          return true;
        }
      );
    });

    await withBrowser({
      runtime: {
        id: "test-runtime",
        sendMessage(message) {
          return Promise.resolve({ id: message.id, ok: true, result: { ok: true } });
        }
      }
    }, async () => {
      const result = await requestRuntime({ type: "runtime:fast" }, { timeoutMs: 100 });
      assert.deepEqual(result, { ok: true });
      assert.equal(activeTimers.size, 0);
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("requestRuntime rejects when reply is missing for acknowledged request", async () => {
  await withBrowser({
    runtime: {
      id: "test-runtime",
      sendMessage() {
        return Promise.resolve(undefined);
      }
    }
  }, async () => {
    await assert.rejects(
      requestRuntime({ type: "runtime:missing" }),
      (error) => {
        assert.ok(error instanceof MessageRequestError);
        assert.equal(error.code, MESSAGE_ERROR_CODES.MISSING_RESPONSE);
        return true;
      }
    );
  });
});

test("requestRuntime resolves fire-and-forget calls when expectsReply is false", async () => {
  await withBrowser({
    runtime: {
      id: "test-runtime",
      sendMessage() {
        return Promise.resolve(undefined);
      }
    }
  }, async () => {
    const result = await requestRuntime(
      { type: "runtime:notify" },
      { expectsReply: false }
    );
    assert.equal(result, undefined);
  });
});

test("requestTab/requestContent include tab and frame context in failures", async () => {
  await withBrowser({
    runtime: {
      id: "test-runtime"
    },
    tabs: {
      sendMessage() {
        return Promise.reject(new Error("tab unreachable"));
      }
    }
  }, async () => {
    await assert.rejects(
      requestTab(77, { type: "tab:status" }, { frameId: 2 }),
      (error) => {
        assert.ok(error instanceof MessageRequestError);
        assert.equal(error.code, MESSAGE_ERROR_CODES.RUNTIME_ERROR);
        assert.equal(error.tabId, 77);
        assert.equal(error.frameId, 2);
        return true;
      }
    );

    await assert.rejects(
      requestContent(19, { type: "content:status" }),
      (error) => {
        assert.ok(error instanceof MessageRequestError);
        assert.equal(error.tabId, 19);
        assert.equal(error.frameId, 0);
        return true;
      }
    );
  });
});