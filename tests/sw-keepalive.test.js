import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  SW_KEEPALIVE_DEFAULT_INTERVAL_MS,
  createSwKeepAlive
} from "../background/sw-keepalive.js";

function createHarness(overrides = {}) {
  const state = { nextId: 1, intervals: new Map(), pings: 0, lastIntervalMs: null };
  const deps = {
    setIntervalRef: (cb, ms) => {
      const id = state.nextId++;
      state.intervals.set(id, cb);
      state.lastIntervalMs = ms;
      return id;
    },
    clearIntervalRef: (id) => {
      state.intervals.delete(id);
    },
    ping: () => {
      state.pings += 1;
    },
    ...overrides
  };
  return { state, deps };
}

test("acquire starts the keepalive interval and pings immediately", () => {
  const { state, deps } = createHarness();
  const keepAlive = createSwKeepAlive(deps);

  assert.equal(keepAlive.isRunning(), false);
  keepAlive.acquire();

  assert.equal(keepAlive.isRunning(), true);
  assert.equal(keepAlive.getActiveCount(), 1);
  assert.equal(state.intervals.size, 1);
  assert.equal(state.lastIntervalMs, SW_KEEPALIVE_DEFAULT_INTERVAL_MS);
  // Immediate ping on start so the idle timer resets without a full interval wait.
  assert.equal(state.pings, 1);
});

test("the scheduled interval keeps pinging while held", () => {
  const { state, deps } = createHarness();
  const keepAlive = createSwKeepAlive(deps);
  keepAlive.acquire();

  const intervalCallback = [...state.intervals.values()][0];
  intervalCallback();
  intervalCallback();

  assert.equal(state.pings, 3);
});

test("nested acquires share one interval and only the final release stops it", () => {
  const { state, deps } = createHarness();
  const keepAlive = createSwKeepAlive(deps);

  keepAlive.acquire();
  keepAlive.acquire();
  keepAlive.acquire();

  assert.equal(keepAlive.getActiveCount(), 3);
  assert.equal(state.intervals.size, 1);
  // No restart: still a single immediate ping from the first acquire.
  assert.equal(state.pings, 1);

  keepAlive.release();
  keepAlive.release();
  assert.equal(keepAlive.isRunning(), true);
  assert.equal(keepAlive.getActiveCount(), 1);

  keepAlive.release();
  assert.equal(keepAlive.isRunning(), false);
  assert.equal(keepAlive.getActiveCount(), 0);
  assert.equal(state.intervals.size, 0);
});

test("release below zero is a no-op and a later acquire restarts the interval", () => {
  const { state, deps } = createHarness();
  const keepAlive = createSwKeepAlive(deps);

  keepAlive.release();
  assert.equal(keepAlive.getActiveCount(), 0);
  assert.equal(keepAlive.isRunning(), false);
  assert.equal(state.pings, 0);

  keepAlive.acquire();
  assert.equal(keepAlive.isRunning(), true);
  assert.equal(state.pings, 1);
});

test("a throwing ping never propagates out of the keepalive", () => {
  const { deps } = createHarness({
    ping: () => {
      throw new Error("ping failed");
    }
  });
  const keepAlive = createSwKeepAlive(deps);

  assert.doesNotThrow(() => keepAlive.acquire());
  assert.equal(keepAlive.isRunning(), true);
});

test("a custom interval is respected when valid and falls back when not", () => {
  const custom = createHarness();
  const keepAliveCustom = createSwKeepAlive({ ...custom.deps, intervalMs: 5000 });
  keepAliveCustom.acquire();
  assert.equal(custom.state.lastIntervalMs, 5000);

  const invalid = createHarness();
  const keepAliveInvalid = createSwKeepAlive({ ...invalid.deps, intervalMs: 0 });
  keepAliveInvalid.acquire();
  assert.equal(invalid.state.lastIntervalMs, SW_KEEPALIVE_DEFAULT_INTERVAL_MS);
});
