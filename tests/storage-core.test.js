import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  storageGet,
  storageSet,
  storageRemove
} from "../common/storage-core.js";

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

test("storageGet resolves successful reads", async () => {
  await withChrome({ runtime: { lastError: null } }, async () => {
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
    await assert.rejects(
      storageGet(createStorageArea(), "globalToken"),
      /Permission denied/
    );
  });
});

test("storage wrappers reject synchronous storage API throws", async () => {
  await withChrome({ runtime: { lastError: null } }, async () => {
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
    await assert.rejects(
      storageRemove(createStorageArea(), ["globalToken"]),
      /Extension context invalidated/
    );
  });
});
