import test from "node:test";
import assert from "node:assert/strict";

import {
  TRANSFER_PAYLOAD_KEY_PREFIX,
  buildTransferPayloadKey,
  parseTransferPayloadKey,
  putTransferPayload,
  getTransferPayload,
  consumeTransferPayload,
  removeTransferPayload,
  sweepStaleTransferPayloads,
  summarizeTransferPayloadForLog
} from "../background/transfer-payload-store.js";

function withChromeSession(initialStore, callback) {
  const store = { ...(initialStore || {}) };
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      session: {
        get(keys, done) {
          if (keys === null || typeof keys === "undefined") {
            done({ ...store });
            return;
          }
          if (typeof keys === "string") {
            done(Object.prototype.hasOwnProperty.call(store, keys) ? { [keys]: store[keys] } : {});
            return;
          }
          if (Array.isArray(keys)) {
            const result = {};
            keys.forEach((key) => {
              if (Object.prototype.hasOwnProperty.call(store, key)) {
                result[key] = store[key];
              }
            });
            done(result);
            return;
          }
          done({});
        },
        set(items, done) {
          Object.assign(store, items || {});
          done();
        },
        remove(keys, done) {
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach((key) => {
            delete store[key];
          });
          done();
        }
      }
    }
  };

  return Promise.resolve()
    .then(() => callback(store))
    .finally(() => {
      if (typeof originalChrome === "undefined") {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = originalChrome;
      }
    });
}

test("transfer payload keys include shared prefix and parse metadata", () => {
  const key = buildTransferPayloadKey("ai-run-result");
  assert.match(key, new RegExp(`^${TRANSFER_PAYLOAD_KEY_PREFIX}ai-run-result:`));

  const parsed = parseTransferPayloadKey(key);
  assert.ok(parsed);
  assert.equal(parsed.scope, "ai-run-result");
  assert.equal(parsed.key, key);
  assert.ok(Number.isFinite(parsed.timestamp));

  assert.equal(parseTransferPayloadKey("not-a-transfer-key"), null);
  assert.equal(parseTransferPayloadKey(`${TRANSFER_PAYLOAD_KEY_PREFIX}broken:ts`), null);
});

test("put/get/consume/remove transfer payloads preserve and clean session data", async () => {
  await withChromeSession({}, async (store) => {
    const stored = await putTransferPayload("save-response", { status: "ok" });
    assert.equal(stored.ok, true);
    assert.ok(stored.payloadKey.startsWith(`${TRANSFER_PAYLOAD_KEY_PREFIX}save-response:`));

    const loaded = await getTransferPayload(stored.payloadKey, { expectedType: "object" });
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.payload, { status: "ok" });

    const consumed = await consumeTransferPayload(stored.payloadKey, { expectedType: "object" });
    assert.equal(consumed.ok, true);
    assert.deepEqual(consumed.payload, { status: "ok" });
    assert.equal(Object.prototype.hasOwnProperty.call(store, stored.payloadKey), false);

    const removedMissing = await removeTransferPayload(" ");
    assert.equal(removedMissing.ok, false);
    assert.equal(removedMissing.reason, "missing_key");
  });
});

test("typed reads reject invalid payloads and optionally remove invalid entries", async () => {
  await withChromeSession({}, async (store) => {
    const stored = await putTransferPayload("assign-page-types", { not: "an-array" });
    assert.equal(stored.ok, true);

    const invalidRead = await getTransferPayload(stored.payloadKey, {
      expectedType: "array",
      removeInvalid: true
    });
    assert.equal(invalidRead.ok, false);
    assert.equal(invalidRead.reason, "invalid_payload");
    assert.equal(Object.prototype.hasOwnProperty.call(store, stored.payloadKey), false);
  });
});

test("stale sweep removes only expired transfer payload keys", async () => {
  const now = 2_000_000;
  const staleKey = `${TRANSFER_PAYLOAD_KEY_PREFIX}load:${now - 600_000}:stale`;
  const freshKey = `${TRANSFER_PAYLOAD_KEY_PREFIX}load:${now - 10_000}:fresh`;
  const otherKey = "unrelated:data";

  await withChromeSession({
    [staleKey]: { a: 1 },
    [freshKey]: { b: 2 },
    [otherKey]: true
  }, async (store) => {
    const result = await sweepStaleTransferPayloads({ now, maxAgeMs: 300_000 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.removedKeys, [staleKey]);

    assert.equal(Object.prototype.hasOwnProperty.call(store, staleKey), false);
    assert.equal(Object.prototype.hasOwnProperty.call(store, freshKey), true);
    assert.equal(Object.prototype.hasOwnProperty.call(store, otherKey), true);
  });
});

test("payload summary reports type, keys, and byte estimate", () => {
  const summary = summarizeTransferPayloadForLog({ foo: "bar", baz: 1 });
  assert.equal(summary.type, "object");
  assert.deepEqual(summary.keys.sort(), ["baz", "foo"]);
  assert.ok(Number.isFinite(summary.byteEstimate));
});
