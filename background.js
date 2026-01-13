const TAB_STATE_PREFIX = "tabState:";

const storageGet = (area, keys) =>
  new Promise((resolve) => area.get(keys, resolve));
const storageSet = (area, items) =>
  new Promise((resolve) => area.set(items, resolve));
const storageRemove = (area, keys) =>
  new Promise((resolve) => area.remove(keys, resolve));
const tabsQuery = (query) =>
  new Promise((resolve) => chrome.tabs.query(query, resolve));

const PANEL_STATE_KEY = "panelStateByWindow";

async function getTabState(tabId) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || null;
}

async function setTabState(tabId, state) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
}

async function getPanelStateByWindow() {
  const result = await storageGet(chrome.storage.session, PANEL_STATE_KEY);
  return result[PANEL_STATE_KEY] || {};
}

async function setPanelStateByWindow(state) {
  await storageSet(chrome.storage.session, { [PANEL_STATE_KEY]: state });
}

async function updateActionForTab(tabId) {
  if (!chrome.action || !tabId) {
    return;
  }
  const state = await getTabState(tabId);
  const enabled = state && state.enabled;
  if (enabled) {
    chrome.action.setBadgeText({ tabId, text: "ON" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#2e7d32" });
  } else {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
}

async function disableExtensionForTab(tabId) {
  const state = await getTabState(tabId);
  if (state && state.enabled) {
    await setTabState(tabId, { enabled: false, baseUrl: state.baseUrl || "" });
  }
}

async function setPanelForWindow(windowId, activeTabId) {
  const panelState = await getPanelStateByWindow();
  panelState[windowId] = activeTabId;
  await setPanelStateByWindow(panelState);

  const tabs = await tabsQuery({ windowId });
  if (!chrome.sidePanel || !chrome.sidePanel.setOptions) {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      const enabled = tab.id === activeTabId;
      try {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          enabled,
          path: "popup.html"
        });
      } catch (error) {
        return;
      }
      if (!enabled) {
        await disableExtensionForTab(tab.id);
      }
    })
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "getTabState") {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ enabled: false, baseUrl: "" });
      return;
    }
    getTabState(tabId).then((state) => {
      sendResponse(state || { enabled: false, baseUrl: "" });
    });
    return true;
  }

  if (message.type === "setTabState") {
    if (!message.tabId) {
      sendResponse({ ok: false });
      return;
    }
    const state = {
      enabled: Boolean(message.enabled),
      baseUrl: message.baseUrl || ""
    };
    setTabState(message.tabId, state).then(() => {
      updateActionForTab(message.tabId);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "clearTabState") {
    if (!message.tabId) {
      sendResponse({ ok: false });
      return;
    }
    const key = `${TAB_STATE_PREFIX}${message.tabId}`;
    storageRemove(chrome.storage.session, key).then(() => {
      updateActionForTab(message.tabId);
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  chrome.storage.session.remove(key);
  getPanelStateByWindow().then((panelState) => {
    let changed = false;
    Object.keys(panelState).forEach((windowId) => {
      if (panelState[windowId] === tabId) {
        delete panelState[windowId];
        changed = true;
      }
    });
    if (changed) {
      setPanelStateByWindow(panelState);
    }
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await updateActionForTab(tabId);
  const panelState = await getPanelStateByWindow();
  if (chrome.sidePanel && chrome.sidePanel.setOptions) {
    const enabled = panelState[windowId] === tabId;
    chrome.sidePanel.setOptions({
      tabId,
      enabled,
      path: "popup.html"
    });
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") {
    return;
  }
  Object.keys(changes).forEach((key) => {
    if (!key.startsWith(TAB_STATE_PREFIX)) {
      return;
    }
    const tabId = Number(key.slice(TAB_STATE_PREFIX.length));
    if (!Number.isNaN(tabId)) {
      updateActionForTab(tabId);
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.runtime.onStartup.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id || !tab.windowId) {
    return;
  }
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
  setPanelForWindow(tab.windowId, tab.id);
});
