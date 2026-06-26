import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

let settingsStoreImportCounter = 0;
const stableBrowser = globalThis.browser || { runtime: { id: "test-extension", lastError: null }, storage: {} };

function createChromeSyncMock(initialItems = {}) {
  const storageItems = { ...initialItems };
  const changeListeners = [];
  const getCalls = [];
  const setCalls = [];

  const chromeMock = {
    runtime: { lastError: null },
    storage: {
      sync: {
        get(keys, callback) {
          getCalls.push(keys);
          const resolveResult = () => {
            if (keys && typeof keys === "object" && !Array.isArray(keys)) {
              const result = { ...keys };
              Object.keys(keys).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(storageItems, key)) {
                  result[key] = storageItems[key];
                }
              });
              return result;
            }
            if (typeof keys === "string") {
              return Object.prototype.hasOwnProperty.call(storageItems, keys)
                ? { [keys]: storageItems[keys] }
                : {};
            }
            return { ...storageItems };
          };
          if (typeof callback === "function") {
            callback(resolveResult());
            return;
          }
          return Promise.resolve(resolveResult());
        },
        set(items, callback) {
          setCalls.push(items || {});
          Object.assign(storageItems, items || {});
          if (typeof callback === "function") {
            callback();
            return;
          }
          return Promise.resolve();
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
    setCalls,
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
  const originalBrowser = globalThis.browser;
  globalThis.chrome = chromeMock;
  stableBrowser.runtime = chromeMock?.runtime || { id: "test-extension", lastError: null };
  stableBrowser.storage = chromeMock?.storage || {};
  globalThis.browser = stableBrowser;
  try {
    return await callback();
  } finally {
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
  }
}

async function loadSettingsStoreModule() {
  settingsStoreImportCounter += 1;
  return import(new URL(`../src/common/settings-store.ts?case=${settingsStoreImportCounter}`, import.meta.url));
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
      globalStageBase: "",
      globalAuthContextVersion: ""
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

test("settings store clears token when config endpoint origin changes", async () => {
  const mock = createChromeSyncMock({
    globalConfigEndpoint: "https://old-config.example.test/load",
    globalToken: "secret-token"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { saveGlobalConfigEndpoint } = await loadSettingsStoreModule();
    const result = await saveGlobalConfigEndpoint("https://new-config.example.test/load");

    assert.equal(result.tokenCleared, true);
    assert.equal(mock.storageItems.globalConfigEndpoint, "https://new-config.example.test/load");
    assert.equal(mock.storageItems.globalToken, "");
  });
});

test("settings store preserves token when config endpoint origin is unchanged", async () => {
  const mock = createChromeSyncMock({
    globalConfigEndpoint: "https://config.example.test/load",
    globalToken: "secret-token"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { saveGlobalConfigEndpoint } = await loadSettingsStoreModule();
    const result = await saveGlobalConfigEndpoint("https://config.example.test/save");

    assert.equal(result.tokenCleared, false);
    assert.equal(mock.storageItems.globalToken, "secret-token");
  });
});

test("settings store clears token when AI endpoint origin changes", async () => {
  const mock = createChromeSyncMock({
    globalEndpoint: "https://old-ai.example.test/selectors",
    globalToken: "secret-token"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { saveGlobalEndpoint } = await loadSettingsStoreModule();
    const result = await saveGlobalEndpoint("https://new-ai.example.test/selectors");

    assert.equal(result.tokenCleared, true);
    assert.equal(mock.storageItems.globalToken, "");
  });
});

test("settings store clears token when stage base changes", async () => {
  const mock = createChromeSyncMock({
    globalStageBase: "stage-a.example.test",
    globalToken: "secret-token"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { saveGlobalStageBase } = await loadSettingsStoreModule();
    const result = await saveGlobalStageBase("stage-b.example.test");

    assert.equal(result.tokenCleared, true);
    assert.equal(mock.storageItems.globalToken, "");
  });
});

test("settings store preserves token when stage base matches after normalization", async () => {
  const mock = createChromeSyncMock({
    globalStageBase: "https://Stage.EXAMPLE.test/path",
    globalToken: "secret-token"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { saveGlobalStageBase } = await loadSettingsStoreModule();
    const result = await saveGlobalStageBase("stage.example.test");

    assert.equal(result.tokenCleared, false);
    assert.equal(mock.storageItems.globalToken, "secret-token");
    assert.equal(mock.storageItems.globalStageBase, "stage.example.test");
  });
});

test("settings store saveLoginSettings writes stage base and token", async () => {
  const mock = createChromeSyncMock({});

  await withChromeMock(mock.chromeMock, async () => {
    const { saveLoginSettings } = await loadSettingsStoreModule();
    await saveLoginSettings({
      stageBase: "stage.example.test",
      token: "secret-token"
    });

    const lastCall = mock.setCalls.at(-1);
    assert.equal(lastCall.globalStageBase, "stage.example.test");
    assert.equal(lastCall.globalToken, "secret-token");
    assert.equal(typeof lastCall.globalAuthContextVersion, "string");
    assert.ok(lastCall.globalAuthContextVersion);
  });
});

test("settings store clearGlobalToken only clears token", async () => {
  const mock = createChromeSyncMock({
    globalStageBase: "stage.example.test",
    globalEndpoint: "https://api.example.test",
    globalToken: "secret-token"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { clearGlobalToken } = await loadSettingsStoreModule();
    await clearGlobalToken();

    assert.equal(mock.storageItems.globalToken, "");
    assert.equal(mock.storageItems.globalStageBase, "stage.example.test");
    assert.equal(mock.storageItems.globalEndpoint, "https://api.example.test");
  });
});

test("settings store theme helpers normalize with provided defaults", async () => {
  const mock = createChromeSyncMock({
    globalTheme: "invalid-theme",
    globalThemeMode: "invalid-mode"
  });

  await withChromeMock(mock.chromeMock, async () => {
    const { getThemeSettings, setThemeSettings } = await loadSettingsStoreModule();
    const loaded = await getThemeSettings({
      normalizeThemeValue: (value) => (value === "forest" ? "forest" : "moonlight"),
      normalizeThemeModeValue: (value) => (value === "light" ? "light" : "system")
    });
    assert.deepEqual(loaded, {
      themeValue: "moonlight",
      themeModeValue: "system"
    });

    const saved = await setThemeSettings("forest", "light", {
      normalizeThemeValue: (value) => (value === "forest" ? "forest" : "moonlight"),
      normalizeThemeModeValue: (value) => (value === "light" ? "light" : "system")
    });
    assert.deepEqual(saved, {
      themeValue: "forest",
      themeModeValue: "light"
    });
    assert.deepEqual(mock.setCalls.at(-1), {
      globalTheme: "forest",
      globalThemeMode: "light"
    });
  });
});
