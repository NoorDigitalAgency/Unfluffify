type PopupSpinnerEntry = {
  message?: string;
  persistent?: boolean;
  reason?: string;
  source?: string;
  startedAt?: number;
};

type PopupSpinnerBackgroundResponse = {
  ok?: boolean;
  [key: string]: unknown;
};

type PopupSpinnerTask<T> = (spinnerKey: string | null) => Promise<T>;

type PopupSpinnerDeps = {
  popupSpinnerQueue: Map<string, PopupSpinnerEntry>;
  popupSpinnerKeyTabIds: Map<string, number>;
  popupSpinnerWatchdogByKey: Map<string, ReturnType<typeof setTimeout>>;
  spinnerWatchdogMs: number;
  windowRef: Pick<Window, "setTimeout" | "clearTimeout">;
  cryptoRef: { randomUUID: () => string };
  getCurrentPopupTabId: () => number | null;
  getPopupSpinnerVisible: () => boolean;
  setPopupSpinnerVisible: (value: boolean) => void;
  getPopupSpinnerTimer: () => number;
  setPopupSpinnerTimer: (value: number) => void;
  popSpinner: (key: string) => void;
  logPopupSpinnerDebug: (event: string, payload?: Record<string, unknown>) => void;
  setUiBusyFromCurrentSpinner: () => void;
  syncUiBusyFromBrokerState: () => void;
  syncSpinnerEntryToBackground: (key: string) => Promise<PopupSpinnerBackgroundResponse | null>;
  removeSpinnerEntryFromBackground: (key: string, tabId?: number | null) => Promise<PopupSpinnerBackgroundResponse | null>;
  clearSpinnerQueueInBackground: (tabId?: number | null) => Promise<PopupSpinnerBackgroundResponse | null>;
  scheduleStaleInspectionBusyClear: (tabId?: number | null) => void;
  syncPageBusyFromPopupSpinner?: () => void;
  uiModule: { setUiBusy: (busy: boolean) => void };
};

type PopupSpinnerOptions = {
  persistent?: boolean;
  source?: string;
  reason?: string;
  suppressIfActive?: boolean;
  delayMs?: number;
};

export function currentSpinnerMessage(deps: PopupSpinnerDeps): string {
  const queue = deps.popupSpinnerQueue;
  if (queue.size === 0) {
    return "";
  }
  const entry = [...queue.values()].at(-1) || null;
  return entry && typeof entry.message === "string" ? entry.message : "";
}

export function currentSpinnerSnapshot(deps: PopupSpinnerDeps): { key: string; entry: PopupSpinnerEntry } | null {
  const queue = deps.popupSpinnerQueue;
  if (queue.size === 0) {
    return null;
  }
  const snapshot = [...queue.entries()].at(-1) || null;
  if (!snapshot) {
    return null;
  }
  const [key, entry] = snapshot;
  return { key, entry };
}

export function normalizeSpinnerReason(
  _deps: PopupSpinnerDeps,
  reason?: string,
  key?: string | null,
  message?: string
): string {
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  if (typeof key === "string" && key.trim()) {
    return `spinner:${key.trim()}`;
  }
  if (typeof message === "string" && message.trim()) {
    return `message:${message.trim()}`;
  }
  return "popup-spinner";
}

export function clearSpinnerWatchdog(deps: PopupSpinnerDeps, key?: string | null): void {
  if (!key) {
    return;
  }
  const timer = deps.popupSpinnerWatchdogByKey.get(key);
  if (timer) {
    deps.windowRef.clearTimeout(timer);
    deps.popupSpinnerWatchdogByKey.delete(key);
  }
}

export function armSpinnerWatchdog(deps: PopupSpinnerDeps, key?: string | null): void {
  if (!key) {
    return;
  }
  clearSpinnerWatchdog(deps, key);
  const timer = deps.windowRef.setTimeout(() => {
    deps.popupSpinnerWatchdogByKey.delete(key);
    if (deps.popupSpinnerQueue.has(key)) {
      deps.logPopupSpinnerDebug("spinner-watchdog-failopen", { key });
      deps.popSpinner(key);
    }
  }, deps.spinnerWatchdogMs);
  deps.popupSpinnerWatchdogByKey.set(key, timer);
}

// function syncPageBusyFromPopupSpinner(deps)
function syncPageBusyFromPopupSpinner(deps: PopupSpinnerDeps): void {
  if (typeof deps.syncPageBusyFromPopupSpinner !== "function") {
    return;
  }
  try {
    deps.syncPageBusyFromPopupSpinner();
  } catch {
    // Page-busy mirroring is best effort; popup spinner state remains authoritative.
  }
}

// export function pushSpinner(deps, key, message, options = {}) {
export function pushSpinner(
  deps: PopupSpinnerDeps,
  key: string | null,
  message: string,
  options: PopupSpinnerOptions = {}
): string | null {
  const effectiveKey = key ? key : deps.cryptoRef.randomUUID();
  const msg = message.trim();
  const persistent = Boolean(options.persistent);
  const source = typeof options.source === "string" && options.source.trim()
    ? options.source.trim()
    : "popup-spinner";
  const reason = normalizeSpinnerReason(deps, options.reason, effectiveKey, msg);
  const startedAt = Date.now();
  const isUpdate = deps.popupSpinnerQueue.has(effectiveKey);
  const tabId = deps.getCurrentPopupTabId();

  if (!isUpdate) {
    const suppressIfActive = Boolean(options.suppressIfActive);
    if (suppressIfActive && (deps.popupSpinnerQueue.size > 0 || deps.getPopupSpinnerVisible() || deps.getPopupSpinnerTimer())) {
      return null;
    }
  }

  const delayValue = Number(options.delayMs);
  const delayMs = (!isUpdate && Number.isFinite(delayValue))
    ? Math.max(0, Math.trunc(delayValue))
    : 0;

  if (isUpdate) {
    const existing = deps.popupSpinnerQueue.get(effectiveKey) || {};
    if (msg) {
      existing.message = msg;
    }
    existing.persistent = persistent;
    existing.reason = reason;
    existing.source = source;
    if (deps.getPopupSpinnerTimer()) {
      deps.windowRef.clearTimeout(deps.getPopupSpinnerTimer());
      deps.setPopupSpinnerTimer(0);
      if (!deps.getPopupSpinnerVisible()) {
        deps.setPopupSpinnerVisible(true);
        deps.setUiBusyFromCurrentSpinner();
        syncPageBusyFromPopupSpinner(deps);
      } else {
        deps.setUiBusyFromCurrentSpinner();
        syncPageBusyFromPopupSpinner(deps);
      }
    } else if (deps.getPopupSpinnerVisible()) {
      const topKey = [...deps.popupSpinnerQueue.keys()].at(-1);
      if (topKey === effectiveKey) {
        deps.setUiBusyFromCurrentSpinner();
        syncPageBusyFromPopupSpinner(deps);
      }
    }
    if (tabId) {
      deps.popupSpinnerKeyTabIds.set(effectiveKey, tabId);
    }
    armSpinnerWatchdog(deps, effectiveKey);
    deps.syncSpinnerEntryToBackground(effectiveKey).catch(() => {});
    return effectiveKey;
  }

  deps.popupSpinnerQueue.set(effectiveKey, { message: msg, persistent, reason, source, startedAt });
  armSpinnerWatchdog(deps, effectiveKey);
  if (tabId) {
    deps.popupSpinnerKeyTabIds.set(effectiveKey, tabId);
  }

  if (deps.getPopupSpinnerVisible()) {
    deps.logPopupSpinnerDebug("push:update-visible", { key: effectiveKey, message: msg, persistent, reason, source, startedAt });
    deps.setUiBusyFromCurrentSpinner();
    syncPageBusyFromPopupSpinner(deps);
    deps.syncSpinnerEntryToBackground(effectiveKey).catch(() => {});
    return effectiveKey;
  }

  if (delayMs > 0) {
    if (!deps.getPopupSpinnerTimer()) {
      deps.setPopupSpinnerTimer(deps.windowRef.setTimeout(() => {
        deps.setPopupSpinnerTimer(0);
        if (deps.popupSpinnerQueue.size === 0 || deps.getPopupSpinnerVisible()) {
          return;
        }
        deps.setPopupSpinnerVisible(true);
        deps.logPopupSpinnerDebug("push:delayed-show", { key: effectiveKey, message: msg, persistent, reason, source, startedAt });
        deps.setUiBusyFromCurrentSpinner();
        syncPageBusyFromPopupSpinner(deps);
        deps.syncSpinnerEntryToBackground(effectiveKey).catch(() => {});
      }, delayMs));
    }
    return effectiveKey;
  }

  if (deps.getPopupSpinnerTimer()) {
    deps.windowRef.clearTimeout(deps.getPopupSpinnerTimer());
    deps.setPopupSpinnerTimer(0);
  }
  deps.setPopupSpinnerVisible(true);
  deps.logPopupSpinnerDebug("push:show", { key: effectiveKey, message: msg, persistent, reason, source, startedAt });
  deps.setUiBusyFromCurrentSpinner();
  syncPageBusyFromPopupSpinner(deps);
  if (tabId) {
    deps.popupSpinnerKeyTabIds.set(effectiveKey, tabId);
  }
  deps.syncSpinnerEntryToBackground(effectiveKey).catch(() => {});
  return effectiveKey;
}

export function setSpinnerMessage(deps: PopupSpinnerDeps, key: string | null, message: string): void {
  if (!key || !message.trim()) {
    return;
  }
  const entry = deps.popupSpinnerQueue.get(key);
  if (!entry) {
    return;
  }
  entry.message = message.trim();
  entry.reason = normalizeSpinnerReason(deps, entry.reason, key, entry.message);
  entry.source = typeof entry.source === "string" && entry.source ? entry.source : "popup-spinner";
  armSpinnerWatchdog(deps, key);
  deps.logPopupSpinnerDebug("set-message", { key, message: entry.message, reason: entry.reason, source: entry.source });
  deps.syncSpinnerEntryToBackground(key).catch(() => {});
  if (deps.getPopupSpinnerVisible()) {
    const topKey = [...deps.popupSpinnerQueue.keys()].at(-1);
    if (topKey === key) {
      deps.setUiBusyFromCurrentSpinner();
      syncPageBusyFromPopupSpinner(deps);
    }
  }
}

// export function popSpinner(deps, key) {
export function popSpinner(deps: PopupSpinnerDeps, key: string | null): void {
  if (!key) {
    return;
  }
  clearSpinnerWatchdog(deps, key);
  const mappedTabId = deps.popupSpinnerKeyTabIds.get(key);
  if (!deps.popupSpinnerQueue.has(key)) {
    if (mappedTabId) {
      deps.popupSpinnerKeyTabIds.delete(key);
      deps.removeSpinnerEntryFromBackground(key, mappedTabId).catch(() => {});
    }
    return;
  }
  deps.popupSpinnerKeyTabIds.delete(key);
  deps.popupSpinnerQueue.delete(key);
  deps.logPopupSpinnerDebug("pop", { key, mappedTabId });
  deps.removeSpinnerEntryFromBackground(key, mappedTabId || deps.getCurrentPopupTabId()).catch(() => {});
  if (deps.popupSpinnerQueue.size > 0) {
    if (deps.getPopupSpinnerVisible()) {
      deps.setUiBusyFromCurrentSpinner();
      deps.syncUiBusyFromBrokerState();
      syncPageBusyFromPopupSpinner(deps);
    }
    return;
  }
  if (deps.getPopupSpinnerTimer()) {
    deps.windowRef.clearTimeout(deps.getPopupSpinnerTimer());
    deps.setPopupSpinnerTimer(0);
  }
  const tabId = deps.getCurrentPopupTabId();
  deps.clearSpinnerQueueInBackground(tabId).catch(() => {});
  if (deps.getPopupSpinnerVisible()) {
    deps.setPopupSpinnerVisible(false);
    deps.logPopupSpinnerDebug("pop:hide", { key, mappedTabId });
    deps.uiModule.setUiBusy(false);
    syncPageBusyFromPopupSpinner(deps);
  }
  deps.scheduleStaleInspectionBusyClear(mappedTabId || tabId);
}

// export async function runWithSpinner(deps, key, message, task, options = {}) {
export async function runWithSpinner<T>(
  deps: PopupSpinnerDeps,
  key: string | null,
  message: string,
  task: PopupSpinnerTask<T>,
  options: PopupSpinnerOptions = {}
): Promise<T> {
  const pushed = pushSpinner(deps, key, message, options);
  try {
    return await task(pushed);
  } finally {
    popSpinner(deps, pushed);
  }
}
