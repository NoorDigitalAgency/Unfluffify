import test from "node:test";
import assert from "node:assert/strict";

let settingsStoreImportCounter = 0;

function createChromeSyncMock(initialItems = {}) {
  const storageItems = { ...initialItems };
  const changeListeners = [];
  const getCalls = [];

  const chromeMock = {
    runtime: { lastError: null },
    storage: {
      sync: {
        get(keys, callback) {
          getCalls.push(keys);
          if (keys && typeof keys === "object" && !Array.isArray(keys)) {
            const result = { ...keys };
            Object.keys(keys).forEach((key) => {
              if (Object.prototype.hasOwnProperty.call(storageItems, key)) {
                result[key] = storageItems[key];
              }
            });
            callback(result);
            return;
          }
          if (typeof keys === "string") {
            callback(
              Object.prototype.hasOwnProperty.call(storageItems, keys)
                ? { [keys]: storageItems[keys] }
                : {}
            );
            return;
          }
          callback({ ...storageItems });
        }
      },
      onChanged: {
        addListener(listener) {
          changeListeners.push(listener);
        }
      }
    }
  };

  return {
    chromeMock,
    storageItems,
    getCalls,
    emitSyncChange(changes) {
      changeListeners.forEach((listener) => listener(changes, "sync"));
    },
    emitLocalChange(changes) {
      changeListeners.forEach((listener) => listener(changes, "local"));
    }
  };
}

async function withChromeMock(chromeMock, callback) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = chromeMock;
  try {
    return await callback();
  } finally {
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
  }
}

async function loadSettingsStoreModule() {
  settingsStoreImportCounter += 1;
  return import(new URL(`../common/settings-store.js?case=${settingsStoreImportCounter}`, import.meta.url));
}

test("settings store reads global AI settings in one storage call", async () => {
  const mock = createChromeSyncMock({
    globalToken: "token-123",
    globalEndpoint: "https://api.example.test",
    globalConfigEndpoint: "https://config.example.test",
    globalStageBase: "https://stage.example.test"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { getGlobalAiSettings } = await loadSettingsStoreModule();
    const result = await getGlobalAiSettings();

    assert.deepEqual(result, {
      tokenValue: "token-123",
      endpointValue: "https://api.example.test",
      configEndpointValue: "https://config.example.test",
      stageBaseValue: "https://stage.example.test"
    });

    assert.equal(mock.getCalls.length, 1);
    assert.deepEqual(mock.getCalls[0], {
      globalToken: "",
      globalEndpoint: "",
      globalConfigEndpoint: "",
      globalStageBase: ""
    });
  });
});

test("settings store normalizes missing settings to empty strings", async () => {
  const mock = createChromeSyncMock({
    globalToken: "  ",
    globalEndpoint: null
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { getGlobalAiSettings } = await loadSettingsStoreModule();
    const result = await getGlobalAiSettings();

    assert.deepEqual(result, {
      tokenValue: "",
      endpointValue: "",
      configEndpointValue: "",
      stageBaseValue: ""
    });
  });
});

test("settings store returns warm cached values when cache is enabled", async () => {
  const mock = createChromeSyncMock({
    globalToken: "token-123",
    globalEndpoint: "https://api.example.test"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { getGlobalAiSettings } = await loadSettingsStoreModule();

    const first = await getGlobalAiSettings({ useCache: true });
    const second = await getGlobalAiSettings({ useCache: true });

    assert.equal(mock.getCalls.length, 1);
    assert.deepEqual(first, second);
  });
});

test("settings store cache invalidates when sync settings change", async () => {
  const mock = createChromeSyncMock({
    globalToken: "token-123",
    globalStageBase: "https://stage.example.test"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { getGlobalAiSettings } = await loadSettingsStoreModule();

    const first = await getGlobalAiSettings({ useCache: true });
    assert.equal(first.tokenValue, "token-123");
    assert.equal(mock.getCalls.length, 1);

    mock.storageItems.globalToken = "token-456";
    mock.emitSyncChange({
      globalToken: {
        oldValue: "token-123",
        newValue: "token-456"
      }
    });

    const second = await getGlobalAiSettings({ useCache: true });
    assert.equal(second.tokenValue, "token-456");
    assert.equal(mock.getCalls.length, 2);

    mock.storageItems.globalToken = "token-789";
    mock.emitLocalChange({
      globalToken: {
        oldValue: "token-456",
        newValue: "token-789"
      }
    });

    const third = await getGlobalAiSettings({ useCache: true });
    assert.equal(third.tokenValue, "token-456");
    assert.equal(mock.getCalls.length, 2);
  });
});

test("settings store log summary redacts token values", async () => {
  await withChromeMock(createChromeSyncMock().chromeMock, async () => {
    const { summarizeGlobalAiSettingsForLog } = await loadSettingsStoreModule();
    const summary = summarizeGlobalAiSettingsForLog({
      tokenValue: "secret-token",
      endpointValue: "https://api.example.test",
      configEndpointValue: "https://config.example.test",
      stageBaseValue: "https://stage.example.test"
    });

    assert.deepEqual(summary, {
      tokenValue: "[redacted]",
      endpointValue: "https://api.example.test",
      configEndpointValue: "https://config.example.test",
      stageBaseValue: "https://stage.example.test"
    });
  });
});

test("property lock connection settings prefer config endpoint over stage base", async () => {
  const mock = createChromeSyncMock({
    globalToken: "secret-token",
    globalConfigEndpoint: "https://config.example.test",
    globalStageBase: "https://stage.example.test"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { getPropertyLockConnectionSettings } = await loadSettingsStoreModule();
    const settings = await getPropertyLockConnectionSettings();

    assert.deepEqual(settings, {
      endpointBase: "https://config.example.test",
      tokenValue: "secret-token"
    });
  });
});
