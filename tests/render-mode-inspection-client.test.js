import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createRenderModeInspectionClient } from "../content/render-mode-inspection-client.js";

function createSessionStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

test("render-mode inspection client reads and writes active flag via session storage", () => {
  const sessionStorage = createSessionStorageMock();
  const client = createRenderModeInspectionClient({
    RENDER_MODE_INSPECTION_SESSION_KEY: "uf_render_mode_inspection_active",
    getWindow: () => ({ sessionStorage })
  });

  assert.equal(client.readActiveFlag(), false);

  client.writeActiveFlag(true);
  assert.equal(sessionStorage.getItem("uf_render_mode_inspection_active"), "1");
  assert.equal(client.readActiveFlag(), true);

  client.writeActiveFlag(false);
  assert.equal(sessionStorage.getItem("uf_render_mode_inspection_active"), null);
  assert.equal(client.readActiveFlag(), false);
});

test("render-mode inspection client arms and clears watchdog using host timers", () => {
  let nextTimerId = 100;
  const timers = new Map();
  const cleared = [];

  const windowMock = {
    sessionStorage: createSessionStorageMock(),
    setTimeout(callback, timeoutMs) {
      const id = nextTimerId++;
      timers.set(id, { callback, timeoutMs });
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      timers.delete(id);
    }
  };

  const client = createRenderModeInspectionClient({
    RENDER_MODE_INSPECTION_SESSION_KEY: "uf_render_mode_inspection_active",
    getWindow: () => windowMock
  });

  let timeoutCalls = 0;
  client.armWatchdog({
    timeoutMs: 32000,
    onTimeout: () => {
      timeoutCalls += 1;
    }
  });

  assert.equal(timers.size, 1);
  const [timerId, timerEntry] = Array.from(timers.entries())[0];
  assert.equal(timerEntry.timeoutMs, 32000);

  timers.delete(timerId);
  timerEntry.callback();
  assert.equal(timeoutCalls, 1);

  client.armWatchdog({ timeoutMs: 10, onTimeout: () => {} });
  const activeTimerId = Array.from(timers.keys())[0];
  client.clearWatchdog();
  assert.equal(timers.has(activeTimerId), false);
  assert.equal(cleared.includes(activeTimerId), true);
  assert.equal(cleared.includes(timerId), false);
});

test("render-mode inspection client tolerates blocked session storage", () => {
  const throwingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    }
  };

  const client = createRenderModeInspectionClient({
    RENDER_MODE_INSPECTION_SESSION_KEY: "uf_render_mode_inspection_active",
    getWindow: () => ({ sessionStorage: throwingStorage })
  });

  assert.equal(client.readActiveFlag(), false);
  assert.doesNotThrow(() => {
    client.writeActiveFlag(true);
    client.writeActiveFlag(false);
  });
});
