import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  TRANSFER_PAYLOAD_KEY_PREFIX,
  buildTransferPayloadKey,
  parseTransferPayloadKey,
  putTransferPayload,
  getTransferPayload,
  consumeTransferPayload,
  removeTransferPayload,
  sweepStaleTransferPayloads,
  sanitizeTransferPayloads,
  summarizeTransferPayloadForLog
} from "../src/background/transfer-payload-store.js";
import { AI_RUN_DEFAULT_TIMEOUT_MS } from "../src/common/bus/contracts/ai-run.js";

function withIdbStore(initialStore, callback) {
  const idbData = { ...(initialStore || {}) };
  const originalChrome = globalThis.chrome;
  const originalLocation = globalThis.location;
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getURL(path = "") {
        return `chrome-extension://unfluffify-test/${path}`;
      },
      async sendMessage(message) {
        if (!message || typeof message.type !== "string") {
          return { ok: false, error: "Invalid runtime message" };
        }
        if (message.type === "idbGet") {
          const keys = message.keys;
          if (keys === null || typeof keys === "undefined") {
            return { ok: true, result: { ...idbData } };
          }
          const list = Array.isArray(keys) ? keys : [keys];
          const result = {};
          list.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(idbData, key)) {
              result[key] = idbData[key];
            }
          });
          return { ok: true, result };
        }
        if (message.type === "idbSet") {
          Object.assign(idbData, message.items || {});
          return { ok: true };
        }
        if (message.type === "idbRemove") {
          const list = Array.isArray(message.keys) ? message.keys : [message.keys];
          list.forEach((key) => {
            delete idbData[key];
          });
          return { ok: true };
        }
        if (message.type === "idbGetAllKeys") {
          return { ok: true, result: Object.keys(idbData) };
        }
        return { ok: false, error: `Unsupported message type: ${message.type}` };
      }
    }
  };
  globalThis.location = { origin: "https://runtime-test.example" };

  return Promise.resolve()
    .then(() => callback(idbData))
    .finally(() => {
      if (typeof originalChrome === "undefined") {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = originalChrome;
      }
      if (typeof originalLocation === "undefined") {
        delete globalThis.location;
      } else {
        globalThis.location = originalLocation;
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
  await withIdbStore({}, async (store) => {
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
  await withIdbStore({}, async (store) => {
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

  await withIdbStore({
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

test("sanitize evicts session-stale non-latest payloads, keeps latest-per-scope, fresh, and unrelated data", async () => {
  const now = 1_000_000_000;
  // Far beyond AI_RUN_DEFAULT_TIMEOUT_MS + margin, so age alone marks these stale.
  const staleOldLoad = `${TRANSFER_PAYLOAD_KEY_PREFIX}load:${now - AI_RUN_DEFAULT_TIMEOUT_MS - 3_600_000}:staleold`;
  const staleLatestLoad = `${TRANSFER_PAYLOAD_KEY_PREFIX}load:${now - AI_RUN_DEFAULT_TIMEOUT_MS - 3_599_000}:stalelatest`;
  const freshAiRun = `${TRANSFER_PAYLOAD_KEY_PREFIX}ai-run-result:${now - 5_000}:fresh`;
  const configKey = "configs";

  await withIdbStore({
    [staleOldLoad]: { a: 1 },
    [staleLatestLoad]: { b: 2 },
    [freshAiRun]: { c: 3 },
    [configKey]: { keep: true }
  }, async (store) => {
    const result = await sanitizeTransferPayloads({ now });
    assert.equal(result.ok, true);
    // Only the stale, non-latest load payload is evicted.
    assert.deepEqual(result.removedKeys, [staleOldLoad]);

    assert.equal(Object.prototype.hasOwnProperty.call(store, staleOldLoad), false);
    // Latest of the load scope is kept as a safeguard even though it is old.
    assert.equal(Object.prototype.hasOwnProperty.call(store, staleLatestLoad), true);
    // Fresh in-flight AI-run payload is never touched.
    assert.equal(Object.prototype.hasOwnProperty.call(store, freshAiRun), true);
    // Unrelated persisted data (config store) is preserved.
    assert.equal(Object.prototype.hasOwnProperty.call(store, configKey), true);
    assert.deepEqual(store[configKey], { keep: true });
  });
});

test("sanitize keeps every fresh in-flight payload regardless of scope", async () => {
  const now = 2_000_000_000;
  const freshLoad = `${TRANSFER_PAYLOAD_KEY_PREFIX}load:${now - 1_000}:l`;
  const freshStartRequest = `${TRANSFER_PAYLOAD_KEY_PREFIX}ai-run-start-request:${now - 2_000}:s`;
  const freshResult = `${TRANSFER_PAYLOAD_KEY_PREFIX}ai-run-result:${now - 3_000}:r`;

  await withIdbStore({
    [freshLoad]: { a: 1 },
    [freshStartRequest]: { b: 2 },
    [freshResult]: { c: 3 }
  }, async (store) => {
    const result = await sanitizeTransferPayloads({ now });
    assert.equal(result.ok, true);
    assert.deepEqual(result.removedKeys, []);
    assert.equal(Object.prototype.hasOwnProperty.call(store, freshLoad), true);
    assert.equal(Object.prototype.hasOwnProperty.call(store, freshStartRequest), true);
    assert.equal(Object.prototype.hasOwnProperty.call(store, freshResult), true);
  });
});

test("payload summary reports type, keys, and byte estimate", () => {
  const summary = summarizeTransferPayloadForLog({ foo: "bar", baz: 1 });
  assert.equal(summary.type, "object");
  assert.deepEqual(summary.keys.sort(), ["baz", "foo"]);
  assert.ok(Number.isFinite(summary.byteEstimate));
});
