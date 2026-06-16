import test from "node:test";
import assert from "node:assert/strict";

import {
  clearRenderModeNoJsHeld,
  isRenderModeNoJsHeld,
  listRenderModeNoJsHeldTabIds,
  renderModeNoJsHeldStorageKey,
  setRenderModeNoJsHeld
} from "../common/render-mode-js-state.js";

function makeMockSession() {
  const store = new Map();
  return {
    store,
    async get(keys) {
      if (keys === null) {
        return Object.fromEntries(store.entries());
      }
      const keyList = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of keyList) {
        if (store.has(key)) {
          out[key] = store.get(key);
        }
      }
      return out;
    },
    async set(obj) {
      for (const [key, value] of Object.entries(obj)) {
        store.set(key, value);
      }
    },
    async remove(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) {
        store.delete(key);
      }
    }
  };
}

test("render mode no-JS held key is tab-scoped and rejects invalid ids", () => {
  assert.equal(renderModeNoJsHeldStorageKey(7), "renderModeNoJsHeld:7");
  assert.equal(renderModeNoJsHeldStorageKey("12"), "renderModeNoJsHeld:12");
  assert.equal(renderModeNoJsHeldStorageKey(0), "");
  assert.equal(renderModeNoJsHeldStorageKey(null), "");
  assert.equal(renderModeNoJsHeldStorageKey(-3), "");
});

test("render mode no-JS held state round-trips through chrome.storage.session", async () => {
  const session = makeMockSession();
  globalThis.chrome = { storage: { session } };

  assert.equal(await isRenderModeNoJsHeld(7), false);

  await setRenderModeNoJsHeld(7, true);
  assert.equal(await isRenderModeNoJsHeld(7), true);
  assert.equal(session.store.get("renderModeNoJsHeld:7"), true);

  await clearRenderModeNoJsHeld(7);
  assert.equal(await isRenderModeNoJsHeld(7), false);
  assert.equal(session.store.has("renderModeNoJsHeld:7"), false);

  // setRenderModeNoJsHeld(tabId, false) clears as well.
  await setRenderModeNoJsHeld(7, true);
  await setRenderModeNoJsHeld(7, false);
  assert.equal(await isRenderModeNoJsHeld(7), false);

  // Held state is per-tab.
  await setRenderModeNoJsHeld(7, true);
  await setRenderModeNoJsHeld(12, true);
  assert.equal(await isRenderModeNoJsHeld(8), false);
  assert.deepEqual(await listRenderModeNoJsHeldTabIds(), [7, 12]);
});

test("render mode no-JS held state ignores invalid ids and missing session storage", async () => {
  const session = makeMockSession();
  globalThis.chrome = { storage: { session } };

  await setRenderModeNoJsHeld(0, true);
  assert.equal(session.store.size, 0);
  assert.equal(await isRenderModeNoJsHeld(0), false);

  globalThis.chrome = { storage: {} };
  assert.equal(await isRenderModeNoJsHeld(7), false);
  assert.deepEqual(await listRenderModeNoJsHeldTabIds(), []);
  await setRenderModeNoJsHeld(7, true);
  await clearRenderModeNoJsHeld(7);
});
