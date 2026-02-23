import {
  DEVICE_EMULATION_PREFIX,
  DEVICE_EMULATION_PRESETS,
  DEVICE_SCALE_DEFAULTS
} from "./constants.js";
import { storageGet, storageSet } from "./utilities.js";

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

async function getTabViewportSize(tabId) {
  return new Promise((resolve) => {
    if (!chrome.tabs || !tabId) {
      resolve(null);
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        resolve(null);
        return;
      }
      const width = Number(tab.width);
      const height = Number(tab.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        resolve(null);
        return;
      }
      resolve({ width, height });
    });
  });
}

async function getPageViewportSize(tabId) {
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

async function getViewportSize(tabId) {
  const [tabViewport, pageViewport] = await Promise.all([
    getTabViewportSize(tabId),
    getPageViewportSize(tabId)
  ]);
  if (tabViewport && pageViewport) {
    // Prefer the smaller dimensions. When the page is not yet emulated, pageViewport
    // reflects the real content area (excluding the side panel) more accurately.
    // When the page is already emulated, pageViewport is often inflated to the
    // emulated width (e.g. 1920), so tabViewport wins naturally.
    return {
      width: Math.min(tabViewport.width, pageViewport.width),
      height: Math.min(tabViewport.height, pageViewport.height)
    };
  }
  return tabViewport || pageViewport;
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

export async function getDeviceEmulationState(tabId) {
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

export async function updateDeviceEmulation(tabId, updates) {
  const current = await getDeviceEmulationState(tabId);
  const next = {
    ...current,
    ...updates
  };
  const shouldRecalculateScale = Boolean(updates && updates.recalculateScale);
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

  if (shouldRecalculateScale || !current.enabled || current.mode !== next.mode) {
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

export function normalizeDeviceEmulationStateForUi(value) {
  return normalizeDeviceEmulationState(value);
}
