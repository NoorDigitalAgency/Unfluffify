const TAB_STATE_PREFIX = "tabState:";

const storageGet = (area, keys) =>
  new Promise((resolve) => area.get(keys, resolve));
const storageSet = (area, items) =>
  new Promise((resolve) => area.set(items, resolve));
const storageRemove = (area, keys) =>
  new Promise((resolve) => area.remove(keys, resolve));

async function getTabState(tabId) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || null;
}

async function setTabState(tabId, state) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
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
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateActionForTab(tabId);
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
  if (chrome.sidePanel && chrome.sidePanel.open && tab && tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});
