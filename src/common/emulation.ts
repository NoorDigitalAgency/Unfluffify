import {
  DEVICE_EMULATION_PREFIX,
  DEVICE_EMULATION_PRESETS,
  DEVICE_SCALE_DEFAULTS
} from "./constants";
import {
  FEATURE_DISABLED_REASON,
  isFeatureEnabled
} from "./feature-flags";
import { browser, callBrowserApi, callBrowserApiVoid, type Browser } from "./browser";
import { storageGet, storageRemove, storageSet } from "./utilities";

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
type DeviceEmulationUpdate = {
  enabled?: boolean;
  mode?: DeviceMode | string;
  scale?: number;
  recalculateScale?: boolean;
};
type DebuggerActionResult = {
  ok: boolean;
  error?: string;
  alreadyAttached?: boolean;
};
type DeviceEmulationResult = {
  ok: boolean;
  state?: DeviceState | null;
  reason?: string;
  feature?: string;
  error?: string;
  alreadyAttached?: boolean;
};
type BrowserApi = typeof browser;
type BrowserHost = typeof globalThis & {
  browser?: BrowserApi;
  chrome?: BrowserApi;
};
type DebuggerTargetInfo = Browser.debugger.TargetInfo;

const deviceEmulationQueueByTabId = new Map();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "";
}

function getSessionStorageArea() {
  const host = globalThis as BrowserHost;
  return host.browser?.storage?.session || host.chrome?.storage?.session || browser.storage.session;
}

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

function normalizeDeviceEmulationState(value: unknown): DeviceState {
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
  const record = value as { enabled?: unknown; mode?: unknown; scale?: unknown };
  const mode = normalizeDeviceMode(record.mode);
  return {
    enabled: Boolean(record.enabled),
    mode,
    scale: normalizeDeviceScale(record.scale, mode)
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
  if (!tabId) {
    return null;
  }
  try {
    const tab = await callBrowserApi<Browser.tabs.Tab>(
      (api, callback) => api.tabs.get(tabId, callback),
      (api) => api.tabs.get(tabId)
    );
    if (!tab) {
      return null;
    }
    const width = Number(tab.width);
    const height = Number(tab.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

async function getPageViewportSize(tabId: number): Promise<ViewportSize | null> {
  if (!tabId) {
    return null;
  }
  try {
    const results = await callBrowserApi<Browser.scripting.InjectionResult[]>(
      (api, callback) => api.scripting.executeScript({
        target: { tabId },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight
        })
      }, callback),
      (api) => api.scripting.executeScript({
        target: { tabId },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight
        })
      })
    );
    if (!results || !results.length || !results[0].result) {
      return null;
    }
    return results[0].result as ViewportSize;
  } catch {
    return null;
  }
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
  const result = await storageGet(getSessionStorageArea(), key);
  return normalizeDeviceEmulationState(result[key]);
}

export async function hasStoredDeviceEmulationState(tabId: number) {
  if (!tabId) {
    return false;
  }
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const result = await storageGet(getSessionStorageArea(), key);
  return Object.prototype.hasOwnProperty.call(result || {}, key);
}

async function setDeviceEmulationState(tabId: number, state: DeviceState) {
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  await storageSet(getSessionStorageArea(), { [key]: state });
}

export async function setDeviceEmulationEnabled(tabId: number, enabled: unknown) {
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

export async function clearDeviceEmulationState(tabId: number) {
  if (!tabId) {
    return;
  }
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  await runDeviceEmulationOperation(tabId, () => storageRemove(getSessionStorageArea(), key));
}

function getDeviceEmulationQueueKey(tabId: number) {
  const normalizedTabId = Number(tabId);
  return Number.isFinite(normalizedTabId) && normalizedTabId > 0
    ? String(Math.trunc(normalizedTabId))
    : "";
}

async function runDeviceEmulationOperation(tabId: number, operation: () => unknown) {
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

async function getDebuggerTargets(): Promise<DebuggerTargetInfo[] | null> {
  if (!browser.debugger || typeof browser.debugger.getTargets !== "function") {
    return null;
  }
  try {
    const targets = await callBrowserApi<DebuggerTargetInfo[]>(
      (api, callback) => api.debugger.getTargets(callback),
      (api) => api.debugger.getTargets()
    );
    return Array.isArray(targets) ? targets : null;
  } catch {
    return null;
  }
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
    const restored = await updateDeviceEmulation(tabId, {
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

function attachDebugger(tabId: number): Promise<DebuggerActionResult> {
  return callBrowserApiVoid(
    (api, callback) => api.debugger.attach({ tabId }, "1.3", callback),
    (api) => api.debugger.attach({ tabId }, "1.3")
  )
    .then(() => ({ ok: true }))
    .catch((error: unknown) => {
      const message = getErrorMessage(error) || "Debugger attach failed";
      if (message.toLowerCase().includes("already attached")) {
        return { ok: true, alreadyAttached: true };
      }
      return { ok: false, error: message };
    });
}

function sendDebuggerCommand(tabId: number, method: string, params?: Record<string, unknown>): Promise<DebuggerActionResult> {
  return callBrowserApiVoid(
    (api, callback) => api.debugger.sendCommand({ tabId }, method, params, callback),
    (api) => api.debugger.sendCommand({ tabId }, method, params)
  )
    .then(() => ({ ok: true }))
    .catch((error: unknown) => ({
      ok: false,
      error: getErrorMessage(error) || "Debugger command failed"
    }));
}

function detachDebugger(tabId: number): Promise<DebuggerActionResult> {
  return callBrowserApiVoid(
    (api, callback) => api.debugger.detach({ tabId }, callback),
    (api) => api.debugger.detach({ tabId })
  )
    .then(() => ({ ok: true }))
    .catch((error: unknown) => ({
      ok: false,
      error: getErrorMessage(error) || "Debugger detach failed"
    }));
}

async function applyDeviceEmulation(tabId: number, state: DeviceState): Promise<DebuggerActionResult> {
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

async function clearDeviceEmulation(tabId: number) {
  await sendDebuggerCommand(tabId, "Emulation.clearDeviceMetricsOverride");
  await detachDebugger(tabId);
  return { ok: true };
}

export async function updateDeviceEmulation(tabId: number, updates: DeviceEmulationUpdate): Promise<DeviceEmulationResult> {
  return runDeviceEmulationOperation(tabId, async (): Promise<DeviceEmulationResult> => {
    const current = await getDeviceEmulationState(tabId);
    if (
      updates &&
      Object.prototype.hasOwnProperty.call(updates, "enabled") &&
      updates.enabled === false &&
      !isFeatureEnabled("deviceEmulationToggle")
    ) {
      return buildFeatureDisabledResult("deviceEmulationToggle", current);
    }
    const next = {
      ...current,
      ...updates
    } as DeviceState & { recalculateScale?: boolean };
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

    const applyResult = await applyDeviceEmulation(tabId, next);
    if (!applyResult.ok) {
      return applyResult;
    }
    next.enabled = true;
    await setDeviceEmulationState(tabId, next);
    return { ok: true, state: next };
  });
}

export async function ensureDefaultMobileDeviceEmulation(
  tabId: number
): Promise<DeviceEmulationResult & { alreadyStored?: boolean }> {
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
export async function clearDeviceEmulationAfterNavigation(tabId: number) {
  return runDeviceEmulationOperation(tabId, async () => {
    const hasState = await hasStoredDeviceEmulationState(tabId);
    if (!hasState) {
      return;
    }
    const state = await getDeviceEmulationState(tabId);
    if (state.enabled) {
      return;
    }
    const attachResult = await attachDebugger(tabId);
    if (!attachResult.ok) {
      return;
    }
    await sendDebuggerCommand(tabId, "Emulation.clearDeviceMetricsOverride");
    await detachDebugger(tabId);
  });
}
