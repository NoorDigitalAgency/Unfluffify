const TAB_STATE_PREFIX = "tabState:";
const DEVICE_EMULATION_PREFIX = "deviceEmulation:";
const SCRIPT_INJECTED_PREFIX = "scriptInjected:";

const DEVICE_SCALE_DEFAULTS = {
  desktop: 0.7,
  mobile: 0.85
};

const DEVICE_EMULATION_PRESETS = {
  desktop: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  },
  mobile: {
    width: 412,
    height: 960,
    deviceScaleFactor: 1,
    mobile: true
  }
};

const storageGet = (area, keys) =>
  new Promise((resolve) => area.get(keys, resolve));
const storageSet = (area, items) =>
  new Promise((resolve) => area.set(items, resolve));
const storageRemove = (area, keys) =>
  new Promise((resolve) => area.remove(keys, resolve));

function getViewportSize(tabId) {
  return new Promise((resolve) => {
    if (!chrome.scripting || !tabId) {
      resolve(null);
      return;
    }
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight
        })
      },
      (results) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (!results || !results.length || !results[0].result) {
          resolve(null);
          return;
        }
        resolve(results[0].result);
      }
    );
  });
}

async function getBestDeviceScale(tabId, mode) {
  const preset = DEVICE_EMULATION_PRESETS[mode] || DEVICE_EMULATION_PRESETS.desktop;
  const viewport = await getViewportSize(tabId);
  if (!viewport || !viewport.width || !viewport.height) {
    return DEVICE_SCALE_DEFAULTS[mode];
  }
  const widthScale = viewport.width / preset.width;
  const heightScale = viewport.height / preset.height;
  const bestScale = Math.min(widthScale, heightScale);
  return normalizeDeviceScale(bestScale, mode);
}

async function getTabState(tabId) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || null;
}

async function setTabState(tabId, state) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
}

async function isScriptInjected(tabId) {
  const key = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return Boolean(result[key]);
}

async function setScriptInjected(tabId, injected) {
  const key = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  if (injected) {
    await storageSet(chrome.storage.session, { [key]: true });
  } else {
    await storageRemove(chrome.storage.session, key);
  }
}

async function injectContentScript(tabId) {
  const alreadyInjected = await isScriptInjected(tabId);
  if (alreadyInjected) {
    return { ok: true, alreadyInjected: true };
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"]
    });
    await setScriptInjected(tabId, true);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || "Script injection failed" };
  }
}

function normalizeDeviceMode(mode) {
  return mode === "mobile" ? "mobile" : "desktop";
}

function normalizeDeviceScale(scale, mode) {
  if (typeof scale !== "number" || !Number.isFinite(scale)) {
    return DEVICE_SCALE_DEFAULTS[mode];
  }
  if (scale < 0.25) {
    return 0.25;
  }
  if (scale > 1) {
    return 1;
  }
  return scale;
}

function normalizeDeviceEmulationState(value) {
  if (!value) {
    return {
      enabled: false,
      mode: "desktop",
      scale: DEVICE_SCALE_DEFAULTS.desktop
    };
  }
  if (typeof value === "string") {
    const mode = normalizeDeviceMode(value);
    return {
      enabled: true,
      mode,
      scale: DEVICE_SCALE_DEFAULTS[mode]
    };
  }
  const mode = normalizeDeviceMode(value.mode);
  return {
    enabled: Boolean(value.enabled),
    mode,
    scale: normalizeDeviceScale(value.scale, mode)
  };
}

async function getDeviceEmulationState(tabId) {
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return normalizeDeviceEmulationState(result[key]);
}

async function setDeviceEmulationState(tabId, state) {
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
}

function attachDebugger(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        const message = chrome.runtime.lastError.message || "Debugger attach failed";
        if (message.toLowerCase().includes("already attached")) {
          resolve({ ok: true, alreadyAttached: true });
          return;
        }
        resolve({ ok: false, error: message });
        return;
      }
      resolve({ ok: true });
    });
  });
}

function sendDebuggerCommand(tabId, method, params) {
  return new Promise((resolve) => {
    chrome.debugger.sendCommand({ tabId }, method, params, () => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Debugger command failed"
        });
        return;
      }
      resolve({ ok: true });
    });
  });
}

function detachDebugger(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Debugger detach failed"
        });
        return;
      }
      resolve({ ok: true });
    });
  });
}

async function applyDeviceEmulation(tabId, state) {
  const preset = DEVICE_EMULATION_PRESETS[state.mode] || DEVICE_EMULATION_PRESETS.desktop;
  const attachResult = await attachDebugger(tabId);
  if (!attachResult.ok) {
    return attachResult;
  }
  const scale = normalizeDeviceScale(state.scale, state.mode);
  const commandResult = await sendDebuggerCommand(
    tabId,
    "Emulation.setDeviceMetricsOverride",
    {
      ...preset,
      scale
    }
  );
  if (!commandResult.ok) {
    return commandResult;
  }
  return { ok: true };
}

async function clearDeviceEmulation(tabId) {
  await sendDebuggerCommand(tabId, "Emulation.clearDeviceMetricsOverride");
  await detachDebugger(tabId);
  return { ok: true };
}

async function updateDeviceEmulation(tabId, updates) {
  const current = await getDeviceEmulationState(tabId);
  const next = {
    ...current,
    ...updates
  };
  next.mode = normalizeDeviceMode(next.mode);
  next.scale = normalizeDeviceScale(next.scale, next.mode);

  if (!next.enabled) {
    await clearDeviceEmulation(tabId);
    next.enabled = false;
    await setDeviceEmulationState(tabId, next);
    return { ok: true, state: next };
  }

  if (current.enabled && current.mode !== next.mode) {
    await sendDebuggerCommand(tabId, "Emulation.clearDeviceMetricsOverride");
  }

  if (!current.enabled || current.mode !== next.mode) {
    next.scale = await getBestDeviceScale(tabId, next.mode);
  }

  const applyResult = await applyDeviceEmulation(tabId, next);
  if (!applyResult.ok) {
    return applyResult;
  }
  next.enabled = true;
  await setDeviceEmulationState(tabId, next);
  return { ok: true, state: next };
}

async function updateActionForTab(tabId) {
  if (!chrome.action || !tabId) {
    return;
  }
  const state = await getTabState(tabId);
  const enabled = state && state.enabled;
  if (enabled) {
    chrome.action.setIcon({
      tabId,
      path: {
        16: "active/icon16.png",
        32: "active/icon32.png",
        48: "active/icon48.png",
        128: "active/icon128.png"
      }
    });
  } else {
    chrome.action.setIcon({
      tabId,
      path: {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png"
      }
    });
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
    }).catch(() => {
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
    setTabState(message.tabId, state).then(() => {
      updateActionForTab(message.tabId);
      sendResponse({ ok: true });
    }).catch(() => {
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
    }).then((result) => {
      if (!result.ok) {
        sendResponse({ ok: false, error: result.error || "Device emulation failed" });
        return;
      }
      sendResponse({ ok: true, state: result.state });
    }).catch(() => {
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
    }).then((result) => {
      if (!result.ok) {
        sendResponse({ ok: false, error: result.error || "Device emulation failed" });
        return;
      }
      sendResponse({ ok: true, state: result.state });
    }).catch(() => {
      sendResponse({ ok: false, error: "Device emulation failed" });
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
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "injectContentScript") {
    if (!message.tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    injectContentScript(message.tabId).then((result) => {
      sendResponse(result);
    }).catch(() => {
      sendResponse({ ok: false, error: "Script injection failed" });
    });
    return true;
  }

  if (message.type === "isScriptInjected") {
    if (!message.tabId) {
      sendResponse({ injected: false });
      return;
    }
    isScriptInjected(message.tabId).then((injected) => {
      sendResponse({ injected });
    }).catch(() => {
      sendResponse({ injected: false });
    });
    return true;
  }

  if (message.type === "captureScreenshot") {
    const tabId = message.tabId;
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        sendResponse({ ok: false, error: "Tab not found" });
        return;
      }
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message || "Screenshot capture failed" });
          return;
        }
        sendResponse({ ok: true, screenshot: dataUrl });
      });
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
  await setDeviceEmulationState(source.tabId, { ...state, enabled: false });
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
