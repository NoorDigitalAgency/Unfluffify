import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  clearTabState,
  clearTrackedTabSessionState,
  getScriptInjectedKey,
  getTabState,
  getTabStateKey,
  isScriptInjected,
  parseTabStateStorageKey,
  queueTabSessionWrite,
  setScriptInjected,
  setTabState
} from "../src/background/tab-session-store.js";

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

function createSessionStorageArea() {
  const data = {};
  return {
    get(keys, callback) {
      if (keys === null || keys === undefined) {
        callback({ ...data });
        return;
      }
      const normalizedKeys = Array.isArray(keys)
        ? keys
        : (typeof keys === "string" ? [keys] : Object.keys(keys));
      const result = {};
      normalizedKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          result[key] = data[key];
        }
      });
      callback(result);
    },
    set(items, callback) {
      Object.entries(items || {}).forEach(([key, value]) => {
        data[key] = value;
      });
      callback();
    },
    remove(keys, callback) {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys];
      normalizedKeys.forEach((key) => {
        delete data[key];
      });
      callback();
    }
  };
}

function createChrome() {
  return {
    runtime: { lastError: null },
    storage: {
      session: createSessionStorageArea()
    }
  };
}

test("tab-session-store builds tab state and script key formats", () => {
  assert.equal(getTabStateKey(12), "tabState:12");
  assert.equal(getTabStateKey(12, "initial"), "tabState:initial:12");
  assert.equal(getScriptInjectedKey(12), "scriptInjected:12");
  assert.equal(getTabStateKey(0), "");
  assert.equal(getScriptInjectedKey("bad"), "");
});

test("tab-session-store parses tab state storage keys", () => {
  assert.deepEqual(parseTabStateStorageKey("tabState:42"), { tabId: 42, scope: null });
  assert.deepEqual(parseTabStateStorageKey("tabState:initial:42"), { tabId: 42, scope: "initial" });
  assert.deepEqual(parseTabStateStorageKey("tabState:restore:42"), { tabId: 42, scope: "restore" });
  assert.equal(parseTabStateStorageKey("scriptInjected:42"), null);
  assert.equal(parseTabStateStorageKey("tabState:initial:not-a-number"), null);
});

test("tab-session-store normalizes baseUrl on set/get", async () => {
  await withChrome(createChrome(), async () => {
    await setTabState(33, {
      enabled: true,
      baseUrl: "https://www.Example.com/jobs/"
    });

    const state = await getTabState(33);
    assert.equal(state.enabled, true);
    assert.equal(state.baseUrl, "https://example.com/jobs");
  });
});

test("tab-session-store set/get/clear works for live and initial scopes", async () => {
  await withChrome(createChrome(), async () => {
    await setTabState(90, { enabled: true, baseUrl: "https://example.com" });
    await setTabState(90, { active: true }, "initial");

    assert.deepEqual(await getTabState(90), { enabled: true, baseUrl: "https://example.com" });
    assert.deepEqual(await getTabState(90, "initial"), { active: true });

    await clearTabState(90);
    assert.equal(await getTabState(90), null);
    assert.equal(await getTabState(90, "initial"), null);
  });
});

test("tab-session-store clearTrackedTabSessionState removes only target tab keys", async () => {
  await withChrome(createChrome(), async () => {
    await setTabState(101, { enabled: true, baseUrl: "https://example.com" });
    await setTabState(101, { active: true }, "initial");
    await setTabState(101, { enabled: true, baseUrl: "https://example.com" }, "restore");
    await setScriptInjected(101, true);

    await setTabState(202, { enabled: true, baseUrl: "https://other.com" });
    await setTabState(202, { active: true }, "initial");
    await setScriptInjected(202, true);

    await clearTrackedTabSessionState(101, { includeRestoreScope: true, includeScriptInjected: true });

    assert.equal(await getTabState(101), null);
    assert.equal(await getTabState(101, "initial"), null);
    assert.equal(await getTabState(101, "restore"), null);
    assert.equal(await isScriptInjected(101), false);

    assert.deepEqual(await getTabState(202), { enabled: true, baseUrl: "https://other.com" });
    assert.deepEqual(await getTabState(202, "initial"), { active: true });
    assert.equal(await isScriptInjected(202), true);
  });
});

test("tab-session-store queues writes per tab", async () => {
  const order = [];

  const first = queueTabSessionWrite(15, async () => {
    order.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("first:end");
  });
  const second = queueTabSessionWrite(15, async () => {
    order.push("second");
  });

  await Promise.all([first, second]);

  assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("runtime-style queued tab-state merges preserve overlapping field updates", async () => {
  await withChrome(createChrome(), async () => {
    const applyRuntimeLikeStatePatch = (tabId, patch, scope = null) =>
      queueTabSessionWrite(tabId, async () => {
        const existingState = await getTabState(tabId, scope);
        const existing = existingState && typeof existingState === "object"
          ? existingState
          : {};
        await setTabState(tabId, { ...existing, ...patch }, scope, { skipQueue: true });
      });

    await setTabState(303, {
      enabled: true,
      baseUrl: "https://example.com"
    });

    await Promise.all([
      applyRuntimeLikeStatePatch(303, { pageType: "candidate" }),
      applyRuntimeLikeStatePatch(303, { desktopPreviewEnabled: true })
    ]);

    const finalState = await getTabState(303);
    assert.equal(finalState.enabled, true);
    assert.equal(finalState.baseUrl, "https://example.com");
    assert.equal(finalState.pageType, "candidate");
    assert.equal(finalState.desktopPreviewEnabled, true);
  });
});

test("tab-session-store script-injected state toggles per tab", async () => {
  await withChrome(createChrome(), async () => {
    assert.equal(await isScriptInjected(77), false);
    await setScriptInjected(77, true);
    assert.equal(await isScriptInjected(77), true);
    await setScriptInjected(77, false);
    assert.equal(await isScriptInjected(77), false);
  });
});
