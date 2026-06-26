import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  clearDeviceEmulationAfterNavigation,
  ensureDefaultMobileDeviceEmulation
} from "../src/common/emulation.js";
import { DEVICE_EMULATION_PREFIX } from "../src/common/constants.js";
import { clearBrowsingDataForOrigin, reloadTab } from "../src/popup/chrome-helpers.js";
import { loadActiveTab } from "../src/popup/messages.js";
import { state } from "../src/popup/state.js";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

function createLocationMock(search = "") {
  return { search };
}

function createPromiseBrowserMock({
  runtimeSendMessage = async () => ({ ok: true }),
  tabsById = {},
  currentWindowTabs = [],
  lastFocusedTabs = [],
  storageData = {},
  debuggerTargets = [],
} = {}) {
  const runtimeMessages = [];
  const debuggerCalls = [];

  const browserMock = {
    runtime: {
      id: "test-extension",
      async sendMessage(message) {
        runtimeMessages.push(message);
        return runtimeSendMessage(message);
      },
    },
    tabs: {
      async get(tabId) {
        if (Object.prototype.hasOwnProperty.call(tabsById, tabId)) {
          return tabsById[tabId];
        }
        throw new Error("Missing tab");
      },
      async query(queryInfo) {
        if (queryInfo && queryInfo.currentWindow) {
          return currentWindowTabs;
        }
        if (queryInfo && queryInfo.lastFocusedWindow) {
          return lastFocusedTabs;
        }
        return [];
      },
    },
    storage: {
      session: {
        async get(keys) {
          const normalizedKeys = Array.isArray(keys)
            ? keys
            : (typeof keys === "string" ? [keys] : Object.keys(keys || {}));
          const result = {};
          normalizedKeys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(storageData, key)) {
              result[key] = storageData[key];
            }
          });
          return result;
        },
        async set(items) {
          Object.assign(storageData, items || {});
        },
        async remove(keys) {
          const normalizedKeys = Array.isArray(keys) ? keys : [keys];
          normalizedKeys.forEach((key) => {
            delete storageData[key];
          });
        },
      },
    },
    debugger: {
      async getTargets() {
        debuggerCalls.push({ type: "getTargets" });
        return debuggerTargets;
      },
      async attach(target, version) {
        debuggerCalls.push({ type: "attach", target, version });
      },
      async sendCommand(target, method, params) {
        debuggerCalls.push({ type: "sendCommand", target, method, params });
      },
      async detach(target) {
        debuggerCalls.push({ type: "detach", target });
      },
    },
  };

  return {
    browserMock,
    runtimeMessages,
    storageData,
    debuggerCalls,
  };
}

async function withBrowserEnvironment({ browserMock, locationSearch = "" }, callback) {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;

  globalThis.browser = browserMock;
  delete globalThis.chrome;
  globalThis.window = {
    setTimeout,
    clearTimeout,
  };
  globalThis.location = createLocationMock(locationSearch);

  try {
    return await callback();
  } finally {
    if (typeof originalBrowser === "undefined") {
      delete globalThis.browser;
    } else {
      globalThis.browser = originalBrowser;
    }

    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }

    if (typeof originalWindow === "undefined") {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }

    if (typeof originalLocation === "undefined") {
      delete globalThis.location;
    } else {
      globalThis.location = originalLocation;
    }
  }
}

test("loadActiveTab prefers the background-resolved bound tab and forwards debugTabId", async () => {
  const mock = createPromiseBrowserMock({
    runtimeSendMessage: async () => ({
      ok: true,
      tab: { id: 12, url: "https://example.com/bound" },
    }),
  });

  await withBrowserEnvironment({ browserMock: mock.browserMock, locationSearch: "?debugTabId=12" }, async () => {
    state.currentTab = null;

    await loadActiveTab();

    assert.deepEqual(mock.runtimeMessages, [
      { type: "resolvePopupTabContext", debugTabId: 12 },
    ]);
    assert.deepEqual(state.currentTab, { id: 12, url: "https://example.com/bound" });
  });
});

test("loadActiveTab falls back to the debug tab when popup-context resolution fails", async () => {
  const mock = createPromiseBrowserMock({
    runtimeSendMessage: async () => ({ ok: false }),
    tabsById: {
      21: { id: 21, url: "https://example.com/debug" },
    },
  });

  await withBrowserEnvironment({ browserMock: mock.browserMock, locationSearch: "?debugTabId=21" }, async () => {
    state.currentTab = null;

    await loadActiveTab();

    assert.deepEqual(state.currentTab, { id: 21, url: "https://example.com/debug" });
  });
});

test("loadActiveTab falls back to the active browser tab when no debug tab resolves", async () => {
  const mock = createPromiseBrowserMock({
    runtimeSendMessage: async () => {
      throw new Error("worker unavailable");
    },
    currentWindowTabs: [{ id: 34, url: "https://example.com/current" }],
  });

  await withBrowserEnvironment({ browserMock: mock.browserMock }, async () => {
    state.currentTab = null;

    await loadActiveTab();

    assert.deepEqual(state.currentTab, { id: 34, url: "https://example.com/current" });
  });
});

test("popup chrome helpers validate required input before messaging", async () => {
  const mock = createPromiseBrowserMock();

  await withBrowserEnvironment({ browserMock: mock.browserMock }, async () => {
    assert.deepEqual(await clearBrowsingDataForOrigin(""), { ok: false, error: "Missing origin" });
    assert.deepEqual(await reloadTab(0), { ok: false, error: "Missing tab" });
    assert.deepEqual(mock.runtimeMessages, []);
  });
});

test("popup chrome helpers route privileged requests through runtime messaging", async () => {
  const mock = createPromiseBrowserMock({
    runtimeSendMessage: async (message) => ({ ok: true, echoedType: message.type }),
  });

  await withBrowserEnvironment({ browserMock: mock.browserMock }, async () => {
    assert.deepEqual(await clearBrowsingDataForOrigin("https://example.com"), {
      ok: true,
      echoedType: "clearBrowsingDataForOrigin",
    });
    assert.deepEqual(await reloadTab(41.9), {
      ok: true,
      echoedType: "reloadTab",
    });
    assert.deepEqual(mock.runtimeMessages, [
      { type: "clearBrowsingDataForOrigin", origin: "https://example.com" },
      { type: "reloadTab", tabId: 41 },
    ]);
  });
});

test("ensureDefaultMobileDeviceEmulation preserves an already stored session choice", async () => {
  const tabId = 52;
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const storedState = {
    enabled: true,
    mode: "mobile",
    scale: 0.9,
  };
  const mock = createPromiseBrowserMock({
    storageData: {
      [key]: storedState,
    },
    debuggerTargets: [{ tabId, attached: true }],
  });

  await withBrowserEnvironment({ browserMock: mock.browserMock }, async () => {
    const result = await ensureDefaultMobileDeviceEmulation(tabId);

    assert.equal(result.ok, true);
    assert.equal(result.alreadyStored, true);
    assert.deepEqual(result.state, storedState);
    assert.deepEqual(mock.storageData[key], storedState);
    assert.deepEqual(mock.debuggerCalls, [{ type: "getTargets" }]);
  });
});

test("clearDeviceEmulationAfterNavigation preserves the stored disabled choice", async () => {
  const tabId = 61;
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const storedState = {
    enabled: false,
    mode: "mobile",
    scale: 0.8,
  };
  const mock = createPromiseBrowserMock({
    storageData: {
      [key]: storedState,
    },
  });

  await withBrowserEnvironment({ browserMock: mock.browserMock }, async () => {
    await clearDeviceEmulationAfterNavigation(tabId);

    assert.deepEqual(mock.storageData[key], storedState);
    assert.deepEqual(mock.debuggerCalls, [
      { type: "attach", target: { tabId }, version: "1.3" },
      { type: "sendCommand", target: { tabId }, method: "Emulation.clearDeviceMetricsOverride", params: undefined },
      { type: "detach", target: { tabId } },
    ]);
  });
});

test("background bootstrap and unregister flows keep device-state ownership explicit", () => {
  assert.match(
    backgroundSource,
    /await utils\.setTabState\(normalizedTabId, \{ active: true \}, "initial"\);[\s\S]*?const mobileState = await ensureDefaultMobileEmulationForTab\(normalizedTabId, tabUrl\);/
  );
  assert.match(
    backgroundSource,
    /if \(message\.type === "unregisterTabAndReload"\) \{[\s\S]*?await utils\.disableExtensionForTab\(tabId\);[\s\S]*?await clearTrackedTabSessionState\(tabId\);/
  );
});

test("background navigation and debugger teardown still route through shared emulation helpers", () => {
  assert.match(
    backgroundSource,
    /browser\.webNavigation\.onCompleted\.addListener\(async \(details\) => \{[\s\S]*?await clearDeviceEmulationAfterNavigation\(tabId\);/
  );
  assert.match(
    backgroundSource,
    /browser\.debugger\.onDetach\.addListener\(async \(source\) => \{[\s\S]*?if \(tabState && tabState\.enabled\) \{[\s\S]*?updateDeviceEmulation\(source\.tabId,[\s\S]*?enabled: true,[\s\S]*?mode: "mobile"/
  );
  assert.match(
    backgroundSource,
    /browser\.debugger\.onDetach\.addListener\(async \(source\) => \{[\s\S]*?if \(initialState && initialState\.desktopPreviewEnabled\) \{[\s\S]*?desktopPreviewEnabled: false[\s\S]*?updateDeviceEmulation\(source\.tabId,[\s\S]*?enabled: true,[\s\S]*?mode: "mobile"/
  );
  assert.match(
    backgroundSource,
    /browser\.debugger\.onDetach\.addListener\(async \(source\) => \{[\s\S]*?const state = await getDeviceEmulationState\(source\.tabId\);[\s\S]*?if \(!state\.enabled\) \{[\s\S]*?return;[\s\S]*?await setDeviceEmulationEnabled\(source\.tabId, false\);/
  );
});
