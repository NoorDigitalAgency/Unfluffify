export function currentSpinnerMessage(deps) {
  const queue = deps.popupSpinnerQueue;
  if (queue.size === 0) {
    return "";
  }
  return [...queue.values()].at(-1).message;
}

export function currentSpinnerSnapshot(deps) {
  const queue = deps.popupSpinnerQueue;
  if (queue.size === 0) {
    return null;
  }
  const [key, entry] = [...queue.entries()].at(-1);
  return { key, entry };
}

export function normalizeSpinnerReason(_deps, reason, key, message) {
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

export function clearSpinnerWatchdog(deps, key) {
  const timer = deps.popupSpinnerWatchdogByKey.get(key);
  if (timer) {
    deps.windowRef.clearTimeout(timer);
    deps.popupSpinnerWatchdogByKey.delete(key);
  }
}

export function armSpinnerWatchdog(deps, key) {
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

export function pushSpinner(deps, key, message, options = {}) {
  const effectiveKey = (typeof key === "string" && key) ? key : deps.cryptoRef.randomUUID();
  const msg = (typeof message === "string" && message.trim()) ? message.trim() : "";
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

  const delayMs = (!isUpdate && Number.isFinite(options.delayMs))
    ? Math.max(0, Math.trunc(options.delayMs))
    : 0;

  if (isUpdate) {
    const existing = deps.popupSpinnerQueue.get(effectiveKey);
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
      } else {
        deps.setUiBusyFromCurrentSpinner();
      }
    } else if (deps.getPopupSpinnerVisible()) {
      const topKey = [...deps.popupSpinnerQueue.keys()].at(-1);
      if (topKey === effectiveKey) {
        deps.setUiBusyFromCurrentSpinner();
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
  if (tabId) {
    deps.popupSpinnerKeyTabIds.set(effectiveKey, tabId);
  }
  deps.syncSpinnerEntryToBackground(effectiveKey).catch(() => {});
  return effectiveKey;
}

export function setSpinnerMessage(deps, key, message) {
  if (!key || typeof key !== "string" || typeof message !== "string" || !message.trim()) {
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
    }
  }
}

export function popSpinner(deps, key) {
  if (!key || typeof key !== "string") {
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
  }
  deps.scheduleStaleInspectionBusyClear(mappedTabId || tabId);
}

export async function runWithSpinner(deps, key, message, task, options = {}) {
  const pushed = pushSpinner(deps, key, message, options);
  try {
    return await task(pushed);
  } finally {
    popSpinner(deps, pushed);
  }
}
