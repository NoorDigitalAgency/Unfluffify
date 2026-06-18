import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createPopupTimerGroup } from "../popup/timers.js";

test("popup timer group timeout replaces prior key and clears old id", async () => {
  const clearTimeoutCalls = [];
  const callbacks = new Map();
  let nextId = 1;
  const timers = createPopupTimerGroup({
    windowRef: {
      setTimeout: (cb) => {
        const id = nextId;
        nextId += 1;
        callbacks.set(id, cb);
        return id;
      },
      clearTimeout: (id) => {
        clearTimeoutCalls.push(id);
        callbacks.delete(id);
      },
      setInterval: () => 0,
      clearInterval: () => {}
    }
  });

  const firstId = timers.setTimeout("refresh", () => {});
  const secondId = timers.setTimeout("refresh", () => {});

  assert.notEqual(firstId, secondId);
  assert.deepEqual(clearTimeoutCalls, [firstId]);
  assert.equal(timers.has("refresh"), true);

  callbacks.get(secondId)();
  assert.equal(timers.has("refresh"), false);
});

test("popup timer group interval can be cleared by key", () => {
  const clearIntervalCalls = [];
  let nextId = 100;
  const timers = createPopupTimerGroup({
    windowRef: {
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => {
        const id = nextId;
        nextId += 1;
        return id;
      },
      clearInterval: (id) => {
        clearIntervalCalls.push(id);
      }
    }
  });

  const intervalId = timers.setInterval("token-validation", () => {}, 5000);
  assert.equal(timers.has("token-validation"), true);

  timers.clear("token-validation");

  assert.equal(clearIntervalCalls.includes(intervalId), true);
  assert.equal(timers.has("token-validation"), false);
});

test("popup timer group clearAll drains timeout and interval entries", () => {
  const clearedTimeouts = [];
  const clearedIntervals = [];
  const timers = createPopupTimerGroup({
    windowRef: {
      setTimeout: () => 10,
      clearTimeout: (id) => {
        clearedTimeouts.push(id);
      },
      setInterval: () => 20,
      clearInterval: (id) => {
        clearedIntervals.push(id);
      }
    }
  });

  timers.setTimeout("toast", () => {}, 1000);
  timers.setInterval("property-page-types-refresh", () => {}, 120000);

  timers.clearAll();

  assert.equal(timers.has("toast"), false);
  assert.equal(timers.has("property-page-types-refresh"), false);
  assert.deepEqual(clearedTimeouts, [10]);
  assert.deepEqual(clearedIntervals, [20]);
});
