import {
  DEVICE_EMULATION_PREFIX,
  DEVICE_EMULATION_PRESETS,
  DEVICE_SCALE_DEFAULTS
} from "./constants.js";
import {
  FEATURE_DISABLED_REASON,
  isFeatureEnabled
} from "./feature-flags.js";
import { storageGet, storageRemove, storageSet } from "./utilities.js";

type DeviceMode = "mobile" | "desktop";
type DeviceState = {
  enabled: boolean;
  mode: DeviceMode;
  scale: number;
};
type ViewportSize = {
  width: number;
  height: number;
};

const deviceEmulationQueueByTabId = new Map();

function normalizeDeviceMode(mode: unknown): DeviceMode {
  return mode === "mobile" ? "mobile" : "desktop";
}

function normalizeDeviceScale(scale: unknown, mode: DeviceMode) {
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

function normalizeDeviceEmulationState(value: any): DeviceState {
  if (!value) {
    return {
      enabled: false,
      mode: "mobile",
      scale: DEVICE_SCALE_DEFAULTS.mobile
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

function buildFeatureDisabledResult(featureName: string, state: DeviceState | null = null) {
  return {
    ok: false,
    reason: FEATURE_DISABLED_REASON,
    feature: featureName,
    error: "Feature disabled",
    state
  };
}

async function getTabViewportSize(tabId: number): Promise<ViewportSize | null> {
  return new Promise((resolve) => {
    if (!chrome.tabs || !tabId) {
      resolve(null);
      return;
    }
    chrome.tabs.get(tabId, (tab: any) => {
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

async function getPageViewportSize(tabId: number): Promise<ViewportSize | null> {
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
      (results: any[]) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (!results || !results.length || !results[0].result) {
          resolve(null);
          return;
        }
        resolve(results[0].result as ViewportSize);
      }
    );
  });
}

async function getViewportSize(tabId: number): Promise<ViewportSize | null> {
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

async function getBestDeviceScale(tabId: number, mode: DeviceMode) {
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

export async function getDeviceEmulationState(tabId: number): Promise<DeviceState> {
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return normalizeDeviceEmulationState(result[key]);
}

export async function hasStoredDeviceEmulationState(tabId: number) {
  if (!tabId) {
    return false;
  }
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return Object.prototype.hasOwnProperty.call(result || {}, key);
}

async function setDeviceEmulationState(tabId: number, state: DeviceState) {
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
}

// @ts-ignore preserve source-contract signature used by device emulation lifecycle tests
export async function setDeviceEmulationEnabled(tabId, enabled) {
  if (!tabId) {
    return null;
  }
  return runDeviceEmulationOperation(tabId, async () => {
    const current = await getDeviceEmulationState(tabId);
    const next = {
      ...current,
      enabled: Boolean(enabled)
    };
    await setDeviceEmulationState(tabId, next);
    return next;
  });
}

// @ts-ignore preserve source-contract signature used by device emulation lifecycle tests
export async function clearDeviceEmulationState(tabId) {
  if (!tabId) {
    return;
  }
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  await runDeviceEmulationOperation(tabId, () => storageRemove(chrome.storage.session, key));
}

function getDeviceEmulationQueueKey(tabId: number) {
  const normalizedTabId = Number(tabId);
  return Number.isFinite(normalizedTabId) && normalizedTabId > 0
    ? String(Math.trunc(normalizedTabId))
    : "";
}

// @ts-ignore preserve source-contract signature used by device emulation lifecycle tests
async function runDeviceEmulationOperation(tabId, operation) {
  const queueKey = getDeviceEmulationQueueKey(tabId);
  if (!queueKey) {
    return operation();
  }
  const previous = deviceEmulationQueueByTabId.get(queueKey) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(operation);
  deviceEmulationQueueByTabId.set(queueKey, next);
  try {
    return await next;
  } finally {
    if (deviceEmulationQueueByTabId.get(queueKey) === next) {
      deviceEmulationQueueByTabId.delete(queueKey);
    }
  }
}

function getDebuggerTargets(): Promise<any[] | null> {
  return new Promise((resolve) => {
    if (!chrome.debugger || !chrome.debugger.getTargets) {
      resolve(null);
      return;
    }
    chrome.debugger.getTargets((targets: any[]) => {
      if (chrome.runtime.lastError || !Array.isArray(targets)) {
        resolve(null);
        return;
      }
      resolve(targets);
    });
  });
}

async function isDebuggerAttachedToTab(tabId: number) {
  if (!tabId) {
    return false;
  }
  const targets = await getDebuggerTargets();
  if (!targets) {
    return null;
  }
  for (const target of targets) {
    if (!target || Number(target.tabId) !== Number(tabId)) {
      continue;
    }
    return Boolean(target.attached);
  }
  return false;
}

export async function reconcileDeviceEmulationState(tabId: number) {
  const current = await getDeviceEmulationState(tabId);
  if (
    (!current.enabled && !isFeatureEnabled("deviceEmulationToggle")) ||
    (current.mode === "desktop" && !isFeatureEnabled("desktopPreview"))
  ) {
    const restored: any = await updateDeviceEmulation(tabId, {
      enabled: true,
      mode: "mobile",
      scale: DEVICE_SCALE_DEFAULTS.mobile,
      recalculateScale: true
    });
    return restored && restored.ok && restored.state ? restored.state : current;
  }
  if (!current.enabled) {
    return current;
  }
  const attached = await isDebuggerAttachedToTab(tabId);
  if (attached !== false) {
    return current;
  }
  const next = {
    ...current,
    enabled: false
  };
  await setDeviceEmulationState(tabId, next);
  return normalizeDeviceEmulationState(next);
}

function attachDebugger(tabId: number) {
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

function sendDebuggerCommand(tabId: number, method: string, params?: Record<string, unknown>) {
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

function detachDebugger(tabId: number) {
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

async function applyDeviceEmulation(tabId: number, state: DeviceState) {
  const preset = DEVICE_EMULATION_PRESETS[state.mode] || DEVICE_EMULATION_PRESETS.desktop;
  const attachResult: any = await attachDebugger(tabId);
  if (!attachResult.ok) {
    return attachResult;
  }
  const scale = normalizeDeviceScale(state.scale, state.mode);
  const commandResult: any = await sendDebuggerCommand(
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

async function clearDeviceEmulation(tabId: number) {
  await sendDebuggerCommand(tabId, "Emulation.clearDeviceMetricsOverride");
  await detachDebugger(tabId);
  return { ok: true };
}

// @ts-ignore preserve source-contract signature used by device emulation lifecycle tests
export async function updateDeviceEmulation(tabId, updates) {
  return runDeviceEmulationOperation(tabId, async () => {
    const current = await getDeviceEmulationState(tabId);
    if (
      updates &&
      Object.prototype.hasOwnProperty.call(updates, "enabled") &&
      updates.enabled === false &&
      !isFeatureEnabled("deviceEmulationToggle")
    ) {
      return buildFeatureDisabledResult("deviceEmulationToggle", current);
    }
    const next: any = {
      ...current,
      ...updates
    };
    const shouldRecalculateScale = Boolean(updates && updates.recalculateScale);
    delete next.recalculateScale;
    next.mode = normalizeDeviceMode(next.mode);
    next.scale = normalizeDeviceScale(next.scale, next.mode);

    if (next.mode === "desktop" && !isFeatureEnabled("desktopPreview")) {
      return buildFeatureDisabledResult("desktopPreview", current);
    }

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

    const applyResult: any = await applyDeviceEmulation(tabId, next);
    if (!applyResult.ok) {
      return applyResult;
    }
    next.enabled = true;
    await setDeviceEmulationState(tabId, next);
    return { ok: true, state: next };
  });
}

export async function ensureDefaultMobileDeviceEmulation(tabId: number) {
  if (!tabId) {
    return { ok: false, error: "Missing tab" };
  }
  if (await hasStoredDeviceEmulationState(tabId)) {
    return {
      ok: true,
      state: await reconcileDeviceEmulationState(tabId),
      alreadyStored: true
    };
  }
  return updateDeviceEmulation(tabId, {
    enabled: true,
    mode: "mobile",
    scale: DEVICE_SCALE_DEFAULTS.mobile,
    recalculateScale: true
  });
}

export function normalizeDeviceEmulationStateForUi(value: unknown) {
  return normalizeDeviceEmulationState(value);
}

// Chrome can re-apply setDeviceMetricsOverride to a newly loaded page even after
// clearDeviceMetricsOverride + detach. Call this after onCompleted to fix the
// new page's renderer if emulation was previously used but is now disabled.
// @ts-ignore preserve source-contract signature used by device emulation lifecycle tests
export async function clearDeviceEmulationAfterNavigation(tabId) {
  return runDeviceEmulationOperation(tabId, async () => {
    const hasState = await hasStoredDeviceEmulationState(tabId);
    if (!hasState) {
      return;
    }
    const state = await getDeviceEmulationState(tabId);
    if (state.enabled) {
      return;
    }
    const attachResult: any = await attachDebugger(tabId);
    if (!attachResult.ok) {
      return;
    }
    await sendDebuggerCommand(tabId, "Emulation.clearDeviceMetricsOverride");
    await detachDebugger(tabId);
  });
}
