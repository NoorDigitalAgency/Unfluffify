const TAB_STATE_PREFIX = "tabState:";
const DEVICE_EMULATION_PREFIX = "deviceEmulation:";

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

async function getTabState(tabId) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || null;
}

async function setTabState(tabId, state) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
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
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const deviceKey = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  storageRemove(chrome.storage.session, [key, deviceKey]);
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
