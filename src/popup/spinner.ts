export type PopupSpinnerEntry = {
  blockSurfaces?: {
    page?: boolean;
    popup?: boolean;
  };
  deadlineAt?: number;
  details?: Record<string, unknown>;
  maxDurationMs?: number;
  message?: string;
  operationId?: string;
  operationKind?: string;
  operationPhase?: string;
  persistent?: boolean;
  reason?: string;
  source?: string;
  startedAt?: number;
  timerMode?: string;
  updatedAt?: number;
};

type PopupSpinnerBackgroundResponse = {
  ok?: boolean;
  [key: string]: unknown;
};

type PopupSpinnerTask<T> = (spinnerKey: string | null) => Promise<T>;

type PopupSpinnerDeps = {
  popupSpinnerEntriesByKey: Map<string, PopupSpinnerEntry>;
  popupSpinnerDelayTimersByKey: Map<string, ReturnType<Window["setTimeout"]>>;
  popupSpinnerKeyTabIds: Map<string, number>;
  popupSpinnerWatchdogByKey: Map<string, ReturnType<Window["setTimeout"]>>;
  spinnerWatchdogMs: number;
  windowRef: Pick<Window, "setTimeout" | "clearTimeout">;
  cryptoRef: { randomUUID: () => string };
  getCurrentPopupTabId: () => number | null;
  popSpinner: (key: string) => void;
  logPopupSpinnerDebug: (event: string, payload?: Record<string, unknown>) => void;
  syncSpinnerEntryToBackground: (
    key: string,
    entry: PopupSpinnerEntry
  ) => Promise<PopupSpinnerBackgroundResponse | null>;
  removeSpinnerEntryFromBackground: (key: string, tabId?: number | null) => Promise<PopupSpinnerBackgroundResponse | null>;
  scheduleStaleInspectionBusyClear: (tabId?: number | null) => void;
};

type PopupSpinnerOptions = {
  blockSurfaces?: {
    page?: boolean;
    popup?: boolean;
  };
  deadlineAt?: number;
  details?: Record<string, unknown>;
  maxDurationMs?: number;
  operationId?: string;
  operationKind?: string;
  operationPhase?: string;
  persistent?: boolean;
  source?: string;
  reason?: string;
  suppressIfActive?: boolean;
  delayMs?: number;
  timerMode?: string;
};

function applySpinnerOperationOptions(entry: PopupSpinnerEntry, options: PopupSpinnerOptions): PopupSpinnerEntry {
  if (options.blockSurfaces) {
    entry.blockSurfaces = options.blockSurfaces;
  }
  if (Number.isFinite(options.deadlineAt)) {
    entry.deadlineAt = Number(options.deadlineAt);
  }
  if (options.details && typeof options.details === "object") {
    entry.details = options.details;
  }
  if (Number.isFinite(options.maxDurationMs)) {
    entry.maxDurationMs = Number(options.maxDurationMs);
  }
  if (typeof options.operationId === "string") {
    entry.operationId = options.operationId;
  }
  if (typeof options.operationKind === "string") {
    entry.operationKind = options.operationKind;
  }
  if (typeof options.operationPhase === "string") {
    entry.operationPhase = options.operationPhase;
  }
  if (typeof options.timerMode === "string") {
    entry.timerMode = options.timerMode;
  }
  return entry;
}

function getLastSpinnerEntry(
  deps: PopupSpinnerDeps
): { key: string; entry: PopupSpinnerEntry } | null {
  const snapshot = [...deps.popupSpinnerEntriesByKey.entries()].at(-1) || null;
  if (!snapshot) {
    return null;
  }
  const [key, entry] = snapshot;
  return { key, entry };
}

export function currentSpinnerMessage(deps: PopupSpinnerDeps): string {
  const snapshot = getLastSpinnerEntry(deps);
  return snapshot && typeof snapshot.entry.message === "string" ? snapshot.entry.message : "";
}

export function currentSpinnerSnapshot(deps: PopupSpinnerDeps): { key: string; entry: PopupSpinnerEntry } | null {
  return getLastSpinnerEntry(deps);
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

function clearSpinnerDelay(deps: PopupSpinnerDeps, key?: string | null): void {
  if (!key) {
    return;
  }
  const timer = deps.popupSpinnerDelayTimersByKey.get(key);
  if (timer) {
    deps.windowRef.clearTimeout(timer);
    deps.popupSpinnerDelayTimersByKey.delete(key);
  }
}

export function armSpinnerWatchdog(deps: PopupSpinnerDeps, key?: string | null): void {
  if (!key) {
    return;
  }
  clearSpinnerWatchdog(deps, key);
  const timer = deps.windowRef.setTimeout(() => {
    deps.popupSpinnerWatchdogByKey.delete(key);
    if (deps.popupSpinnerEntriesByKey.has(key)) {
      deps.logPopupSpinnerDebug("spinner-watchdog-failopen", { key });
      deps.popSpinner(key);
    }
  }, deps.spinnerWatchdogMs);
  deps.popupSpinnerWatchdogByKey.set(key, timer);
}

function sendSpinnerEntryToBackground(deps: PopupSpinnerDeps, key: string): void {
  const entry = deps.popupSpinnerEntriesByKey.get(key);
  if (!entry) {
    return;
  }
  deps.syncSpinnerEntryToBackground(key, entry).catch(() => {});
}

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
  const isUpdate = deps.popupSpinnerEntriesByKey.has(effectiveKey);
  const tabId = deps.getCurrentPopupTabId();

  if (!isUpdate && options.suppressIfActive && deps.popupSpinnerEntriesByKey.size > 0) {
    return null;
  }

  const existing = deps.popupSpinnerEntriesByKey.get(effectiveKey) || {};
  const entry = applySpinnerOperationOptions(
    {
      ...existing,
      message: msg || existing.message || "",
      persistent,
      reason,
      source,
      startedAt: isUpdate && Number.isFinite(existing.startedAt)
        ? Number(existing.startedAt)
        : startedAt
    },
    options
  );
  deps.popupSpinnerEntriesByKey.set(effectiveKey, entry);
  if (tabId) {
    deps.popupSpinnerKeyTabIds.set(effectiveKey, tabId);
  }
  clearSpinnerDelay(deps, effectiveKey);
  armSpinnerWatchdog(deps, effectiveKey);

  const delayValue = Number(options.delayMs);
  const delayMs = (!isUpdate && Number.isFinite(delayValue))
    ? Math.max(0, Math.trunc(delayValue))
    : 0;
  if (delayMs > 0) {
    deps.popupSpinnerDelayTimersByKey.set(effectiveKey, deps.windowRef.setTimeout(() => {
      deps.popupSpinnerDelayTimersByKey.delete(effectiveKey);
      sendSpinnerEntryToBackground(deps, effectiveKey);
    }, delayMs));
    return effectiveKey;
  }

  sendSpinnerEntryToBackground(deps, effectiveKey);
  return effectiveKey;
}

export function setSpinnerMessage(deps: PopupSpinnerDeps, key: string | null, message: string): void {
  if (!key || !message.trim()) {
    return;
  }
  const entry = deps.popupSpinnerEntriesByKey.get(key);
  if (!entry) {
    return;
  }
  entry.message = message.trim();
  entry.reason = normalizeSpinnerReason(deps, entry.reason, key, entry.message);
  entry.source = typeof entry.source === "string" && entry.source ? entry.source : "popup-spinner";
  entry.updatedAt = Date.now();
  clearSpinnerDelay(deps, key);
  armSpinnerWatchdog(deps, key);
  deps.logPopupSpinnerDebug("set-message", { key, message: entry.message, reason: entry.reason, source: entry.source });
  sendSpinnerEntryToBackground(deps, key);
}

export function popSpinner(deps: PopupSpinnerDeps, key: string | null): void {
  if (!key) {
    return;
  }
  clearSpinnerDelay(deps, key);
  clearSpinnerWatchdog(deps, key);
  const mappedTabId = deps.popupSpinnerKeyTabIds.get(key);
  const tabId = mappedTabId || deps.getCurrentPopupTabId();
  deps.popupSpinnerKeyTabIds.delete(key);
  deps.popupSpinnerEntriesByKey.delete(key);
  deps.logPopupSpinnerDebug("pop", { key, mappedTabId });
  deps.removeSpinnerEntryFromBackground(key, tabId).catch(() => {});
  deps.scheduleStaleInspectionBusyClear(tabId);
}

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
