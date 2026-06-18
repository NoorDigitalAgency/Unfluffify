import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createSpinnerOperations } from "../background/spinner-operations.js";

function createHarness() {
  const queueByTabId = new Map();
  const traces = [];
  const broadcasts = [];

  const operations = createSpinnerOperations({
    queueByTabId,
    normalizeTabId(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 0;
      }
      const normalized = Math.trunc(numeric);
      return normalized > 0 ? normalized : 0;
    },
    appendTrace(tabId, channel, action, payload) {
      traces.push({ tabId, channel, action, payload });
    },
    broadcastState(tabId) {
      broadcasts.push(tabId);
    },
    buildState(tabId) {
      return {
        ok: Boolean(tabId),
        tabId,
        spinnerQueue: operations.serializeSpinnerQueue(tabId)
      };
    },
    updateRuntimeSpinnerQueue() {
      // Test harness intentionally does not track runtime state.
    }
  });

  return {
    operations,
    queueByTabId,
    traces,
    broadcasts
  };
}

test("withTabSpinner removes spinner after successful work", async () => {
  const { operations, queueByTabId } = createHarness();

  const result = await operations.withTabSpinner(
    10,
    { key: "sync-a", message: "Running" },
    async ({ key }) => {
      const queue = queueByTabId.get(10);
      assert.equal(queue.has(key), true);
      return { ok: true };
    }
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(queueByTabId.has(10), false);
});

test("withTabSpinner removes spinner and rethrows when work fails", async () => {
  const { operations, queueByTabId } = createHarness();

  await assert.rejects(
    operations.withTabSpinner(11, { key: "sync-b", message: "Running" }, async () => {
      throw new Error("boom");
    }),
    /boom/
  );

  assert.equal(queueByTabId.has(11), false);
});

test("spinner update can reset startedAt and progress metadata", async () => {
  const { operations, queueByTabId } = createHarness();

  await operations.withTabSpinner(
    12,
    {
      key: "sync-c",
      message: "Preparing",
      startedAt: 100,
      progress: 0
    },
    async ({ key, update }) => {
      const before = queueByTabId.get(12).get(key);
      assert.equal(before.progress, 0);
      assert.equal(before.startedAt, 100);

      await update({ progress: 60, resetStartedAt: true, message: "Working" });

      const after = queueByTabId.get(12).get(key);
      assert.equal(after.progress, 60);
      assert.equal(after.message, "Working");
      assert.equal(after.startedAt >= 100, true);
      return { done: true };
    }
  );
});

test("same spinner key in different tabs does not conflict", () => {
  const { operations } = createHarness();

  operations.setBackgroundSpinnerEntry(21, "shared", { message: "one" });
  operations.setBackgroundSpinnerEntry(22, "shared", { message: "two" });

  const tab21 = operations.serializeSpinnerQueue(21);
  const tab22 = operations.serializeSpinnerQueue(22);

  assert.equal(tab21.length, 1);
  assert.equal(tab22.length, 1);
  assert.equal(tab21[0].message, "one");
  assert.equal(tab22[0].message, "two");
});

test("persistent spinner survives transient clear but not full clear", () => {
  const { operations } = createHarness();

  operations.setBackgroundSpinnerEntry(31, "persist", {
    message: "Persist",
    persistent: true
  });
  operations.setBackgroundSpinnerEntry(31, "temp", {
    message: "Temp",
    persistent: false
  });

  operations.clearBackgroundSpinnerQueue(31, { transientOnly: true });
  const afterTransientClear = operations.serializeSpinnerQueue(31);
  assert.equal(afterTransientClear.length, 1);
  assert.equal(afterTransientClear[0].key, "persist");

  operations.clearBackgroundSpinnerQueue(31, { transientOnly: false });
  const afterFullClear = operations.serializeSpinnerQueue(31);
  assert.equal(afterFullClear.length, 0);
});