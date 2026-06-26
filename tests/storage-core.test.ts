import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

let storageCoreImportCounter = 0;
const stableBrowser = globalThis.browser || { runtime: { id: "test-extension", lastError: null }, storage: {} };

function withChrome(value, callback) {
  const originalChrome = globalThis.chrome;
  const originalBrowser = globalThis.browser;
  globalThis.chrome = value;
  stableBrowser.runtime = value?.runtime || { id: "test-extension", lastError: null };
  stableBrowser.storage = value?.storage || {};
  globalThis.browser = stableBrowser;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (typeof originalChrome === "undefined") {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = originalChrome;
      }
      if (typeof originalBrowser === "undefined") {
        delete globalThis.browser;
      } else {
        globalThis.browser = originalBrowser;
      }
    });
}

function createStorageArea(overrides = {}) {
  return {
    get(_keys, callback) {
      callback({});
    },
    set(_items, callback) {
      callback();
    },
    remove(_keys, callback) {
      callback();
    },
    ...overrides
  };
}

function createPromiseStorageArea(initialItems = {}) {
  const items = { ...initialItems };
  const changeListeners = [];
  const area = {
    items,
    onChanged: {
      addListener(listener) {
        changeListeners.push(listener);
      }
    },
    async get(keys) {
      if (keys === null || typeof keys === "undefined") {
        return { ...items };
      }
      if (typeof keys === "string") {
        return Object.prototype.hasOwnProperty.call(items, keys) ? { [keys]: items[keys] } : {};
      }
      if (Array.isArray(keys)) {
        return keys.reduce((result, key) => {
          if (Object.prototype.hasOwnProperty.call(items, key)) {
            result[key] = items[key];
          }
          return result;
        }, {});
      }
      const defaults = { ...keys };
      Object.keys(defaults).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(items, key)) {
          defaults[key] = items[key];
        }
      });
      return defaults;
    },
    async set(values) {
      Object.entries(values || {}).forEach(([key, value]) => {
        items[key] = value;
      });
    },
    async remove(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach((key) => {
        delete items[key];
      });
    },
    async clear() {
      Object.keys(items).forEach((key) => {
        delete items[key];
      });
    },
    emitChange(changes, areaName = "sync") {
      changeListeners.forEach((listener) => listener(changes, areaName));
    }
  };
  return area;
}

async function loadStorageCoreModule() {
  storageCoreImportCounter += 1;
  return import(new URL(`../src/common/storage-core.ts?case=${storageCoreImportCounter}`, import.meta.url));
}

test("storageGet resolves successful reads", async () => {
  await withChrome({ runtime: { lastError: null } }, async () => {
    const { storageGet } = await loadStorageCoreModule();
    const result = await storageGet(createStorageArea({
      get(keys, callback) {
        assert.equal(keys, "globalToken");
        callback({ globalToken: "abc" });
      }
    }), "globalToken");

    assert.deepEqual(result, { globalToken: "abc" });
  });
});

test("storageSet resolves successful writes", async () => {
  await withChrome({ runtime: { lastError: null } }, async () => {
    const { storageSet } = await loadStorageCoreModule();
    let received = null;
    await storageSet(createStorageArea({
      set(items, callback) {
        received = items;
        callback();
      }
    }), { globalToken: "abc" });

    assert.deepEqual(received, { globalToken: "abc" });
  });
});

test("storageRemove resolves successful removals", async () => {
  await withChrome({ runtime: { lastError: null } }, async () => {
    const { storageRemove } = await loadStorageCoreModule();
    let received = null;
    await storageRemove(createStorageArea({
      remove(keys, callback) {
        received = keys;
        callback();
      }
    }), ["globalToken"]);

    assert.deepEqual(received, ["globalToken"]);
  });
});

test("storage wrappers reject when chrome.runtime.lastError is set", async () => {
  await withChrome({
    runtime: {
      lastError: { message: "Permission denied" }
    }
  }, async () => {
    const { storageGet } = await loadStorageCoreModule();
    await assert.rejects(
      storageGet(createStorageArea(), "globalToken"),
      /Permission denied/
    );
  });
});

test("storage wrappers reject synchronous storage API throws", async () => {
  await withChrome({ runtime: { lastError: null } }, async () => {
    const { storageSet } = await loadStorageCoreModule();
    await assert.rejects(
      storageSet(createStorageArea({
        set() {
          throw new Error("set exploded");
        }
      }), { globalToken: "abc" }),
      /set exploded/
    );
  });
});

test("storage wrappers reject extension context invalidated runtime errors", async () => {
  await withChrome({
    runtime: {
      get lastError() {
        throw new Error("Extension context invalidated.");
      }
    }
  }, async () => {
    const { storageRemove } = await loadStorageCoreModule();
    await assert.rejects(
      storageRemove(createStorageArea(), ["globalToken"]),
      /Extension context invalidated/
    );
  });
});

test("storage wrappers use wxt storage for known areas", async () => {
  const sync = createPromiseStorageArea({
    globalToken: "abc",
    globalStageBase: "stage.example.test"
  });

  await withChrome({
    runtime: { id: "test-extension", lastError: null },
    storage: { sync }
  }, async () => {
    const {
      getStorageAreaName,
      storageGet,
      storageClear,
      storageRemove,
      storageSet,
      isChromeStorageArea
    } = await loadStorageCoreModule();
    assert.equal(isChromeStorageArea(sync), true);
    assert.equal(getStorageAreaName(sync), "sync");

    assert.deepEqual(await storageGet(sync, "globalToken"), { globalToken: "abc" });
    assert.deepEqual(
      await storageGet(sync, {
        globalToken: "",
        globalStageBase: "",
        globalEndpoint: ""
      }),
      {
        globalToken: "abc",
        globalStageBase: "stage.example.test",
        globalEndpoint: ""
      }
    );

    await storageSet(sync, { globalEndpoint: "https://api.example.test" });
    assert.equal(sync.items.globalEndpoint, "https://api.example.test");

    await storageRemove(sync, ["globalToken"]);
    assert.equal("globalToken" in sync.items, false);

    await storageClear(sync);
    assert.deepEqual(sync.items, {});
  });
});

test("addSyncStorageChangeListener only forwards sync changes", async () => {
  const sync = createPromiseStorageArea();
  const received = [];

  await withChrome({
    runtime: { id: "test-extension", lastError: null },
    storage: { sync, onChanged: sync.onChanged }
  }, async () => {
    const { addSyncStorageChangeListener } = await loadStorageCoreModule();
    assert.equal(
      addSyncStorageChangeListener((changes) => {
        received.push(changes);
      }),
      true
    );

    sync.emitChange({ globalToken: { oldValue: "", newValue: "abc" } }, "sync");
    sync.emitChange({ globalToken: { oldValue: "abc", newValue: "def" } }, "local");

    assert.deepEqual(received, [{ globalToken: { oldValue: "", newValue: "abc" } }]);
  });
});
