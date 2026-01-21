import {
  DEVICE_EMULATION_PREFIX,
  SCRIPT_INJECTED_PREFIX,
  TAB_STATE_PREFIX
} from "./background/constants.js";
import { storageRemove } from "./background/storage.js";
import { getTabState, setTabState, clearTabState } from "./background/tabState.js";
import { isScriptInjected, injectContentScript } from "./background/scripting.js";
import { getDeviceEmulationState, updateDeviceEmulation } from "./background/deviceEmulation.js";
import { updateActionForTab } from "./background/action.js";

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
    getTabState(tabId)
      .then((state) => {
        sendResponse(state || { enabled: false, baseUrl: "" });
      })
      .catch(() => {
        sendResponse({ enabled: false, baseUrl: "" });
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
    setTabState(message.tabId, state)
      .then(() => {
        updateActionForTab(message.tabId);
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "setDeviceEmulation") {
    if (!message.tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    const mode = message.mode === "mobile" ? "mobile" : "desktop";
    updateDeviceEmulation(message.tabId, {
      enabled: true,
      mode
    })
      .then((result) => {
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error || "Device emulation failed" });
          return;
        }
        sendResponse({ ok: true, state: result.state });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation failed" });
      });
    return true;
  }

  if (message.type === "updateDeviceEmulation") {
    if (!message.tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    updateDeviceEmulation(message.tabId, {
      enabled: typeof message.enabled === "boolean" ? message.enabled : undefined,
      mode: message.mode,
      scale: message.scale
    })
      .then((result) => {
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error || "Device emulation failed" });
          return;
        }
        sendResponse({ ok: true, state: result.state });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation failed" });
      });
    return true;
  }

  if (message.type === "clearTabState") {
    if (!message.tabId) {
      sendResponse({ ok: false });
      return;
    }
    clearTabState(message.tabId)
      .then(() => {
        updateActionForTab(message.tabId);
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "injectContentScript") {
    if (!message.tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    injectContentScript(message.tabId)
      .then((result) => {
        sendResponse(result);
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Script injection failed" });
      });
    return true;
  }

  if (message.type === "isScriptInjected") {
    if (!message.tabId) {
      sendResponse({ injected: false });
      return;
    }
    isScriptInjected(message.tabId)
      .then((injected) => {
        sendResponse({ injected });
      })
      .catch(() => {
        sendResponse({ injected: false });
      });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const deviceKey = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const scriptKey = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  storageRemove(chrome.storage.session, [key, deviceKey, scriptKey]);
});

async function disableExtensionForTab(tabId) {
  const tabKey = `${TAB_STATE_PREFIX}${tabId}`;
  const scriptKey = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  await storageRemove(chrome.storage.session, [tabKey, scriptKey]);
  await updateActionForTab(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, { type: "setEnabled", enabled: false });
  } catch (error) {
    // Content script may not be loaded
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) {
    return;
  }
  const tabId = details.tabId;
  if (!tabId) {
    return;
  }
  const state = await getTabState(tabId);
  if (!state || !state.enabled) {
    return;
  }
  await disableExtensionForTab(tabId);
});

chrome.debugger.onDetach.addListener(async (source) => {
  if (!source || !source.tabId) {
    return;
  }
  const state = await getDeviceEmulationState(source.tabId);
  if (!state.enabled) {
    return;
  }
  await chrome.storage.session.set({
    [`${DEVICE_EMULATION_PREFIX}${source.tabId}`]: { ...state, enabled: false }
  });
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
