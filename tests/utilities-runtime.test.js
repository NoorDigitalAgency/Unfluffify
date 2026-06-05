import test from "node:test";
import assert from "node:assert/strict";

import {
  isExtensionContextInvalidatedError,
  sendRuntimeMessage,
  storageGet
} from "../common/utilities.js";

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

test("extension context invalidation is detected from runtime errors and strings", () => {
  assert.equal(
    isExtensionContextInvalidatedError(new Error("Extension context invalidated.")),
    true
  );
  assert.equal(
    isExtensionContextInvalidatedError("Unchecked runtime.lastError: Extension context invalidated."),
    true
  );
  assert.equal(isExtensionContextInvalidatedError(new Error("Permission denied")), false);
});

test("sendRuntimeMessage reports invalidated extension context without throwing", async () => {
  await withChrome({
    runtime: {
      sendMessage() {
        throw new Error("Extension context invalidated.");
      }
    }
  }, async () => {
    const response = await sendRuntimeMessage({ type: "ping" });

    assert.deepEqual(response, {
      ok: false,
      error: "Extension context invalidated.",
      contextInvalidated: true
    });
  });
});

test("sendRuntimeMessage prefers the runtime Promise result when available", async () => {
  const calls = [];
  await withChrome({
    runtime: {
      sendMessage(message) {
        calls.push(message);
        return Promise.resolve({ ok: true, echoedType: message.type });
      }
    }
  }, async () => {
    const response = await sendRuntimeMessage({ type: "ping" });

    assert.deepEqual(response, {
      ok: true,
      echoedType: "ping"
    });
    assert.equal(calls.length, 1);
  });
});

test("storageGet rejects when Chrome storage reports invalidated extension context", async () => {
  await withChrome({
    runtime: {
      lastError: { message: "Extension context invalidated." }
    }
  }, async () => {
    await assert.rejects(
      storageGet({
        get(_keys, callback) {
          callback({});
        }
      }, "globalToken"),
      /Extension context invalidated/
    );
  });
});
