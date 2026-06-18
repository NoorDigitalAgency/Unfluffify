import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  MessageRequestError,
  requestContent,
  requestRuntime,
  requestTab
} from "../common/async-messaging.js";
import { MESSAGE_ERROR_CODES } from "../common/message-protocol.js";

function withChrome(value, callback) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (typeof originalChrome === "undefined") {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = originalChrome;
      }
    });
}

test("requestRuntime resolves the response result on success", async () => {
  await withChrome({
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback({ id: message.id, ok: true, result: { echoed: message.type } });
      }
    }
  }, async () => {
    const result = await requestRuntime({ type: "runtime:ping" });
    assert.deepEqual(result, { echoed: "runtime:ping" });
  });
});

test("requestRuntime rejects when reply envelope has ok:false", async () => {
  await withChrome({
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        callback({ id: "x", ok: false, code: "handler_failed", error: "nope" });
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

test("requestRuntime rejects on chrome.runtime.lastError", async () => {
  await withChrome({
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        this.lastError = { message: "runtime exploded" };
        callback(undefined);
        this.lastError = null;
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
    await withChrome({
      runtime: {
        lastError: null,
        sendMessage(_message, _callback) {
          // Intentionally never reply to trigger timeout.
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

    await withChrome({
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          callback({ id: message.id, ok: true, result: { ok: true } });
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
  await withChrome({
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        callback(undefined);
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
  await withChrome({
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        callback(undefined);
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
  await withChrome({
    runtime: {
      lastError: null
    },
    tabs: {
      sendMessage(_tabId, _message, _options, callback) {
        globalThis.chrome.runtime.lastError = { message: "tab unreachable" };
        callback(undefined);
        globalThis.chrome.runtime.lastError = null;
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