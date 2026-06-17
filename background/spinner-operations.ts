// @ts-nocheck
import {
  SPINNER_OWNERS,
  WORLD_MESSAGE_TYPES
} from "../common/world-messaging-contract.js";

function defaultNormalizeTabId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : 0;
}

function randomSpinnerKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `spinner:${Date.now()}:${Math.floor(Math.random() * 1e6)}`;
}

function normalizeSpinnerEntry(key, entry = {}, previous = null) {
  return {
    message: typeof entry.message === "string"
      ? entry.message
      : (previous && typeof previous.message === "string" ? previous.message : ""),
    persistent: Object.prototype.hasOwnProperty.call(entry, "persistent")
      ? Boolean(entry.persistent)
      : Boolean(previous && previous.persistent),
    owner: typeof entry.owner === "string"
      ? entry.owner
      : (previous && typeof previous.owner === "string" ? previous.owner : SPINNER_OWNERS.POPUP),
    reason: typeof entry.reason === "string" && entry.reason
      ? entry.reason
      : (previous && typeof previous.reason === "string" && previous.reason
        ? previous.reason
        : `spinner:${String(key)}`),
    source: typeof entry.source === "string" && entry.source
      ? entry.source
      : (previous && typeof previous.source === "string" && previous.source
        ? previous.source
        : "background-spinner-broker"),
    startedAt: Number.isFinite(entry.startedAt)
      ? Number(entry.startedAt)
      : (previous && Number.isFinite(previous.startedAt) ? Number(previous.startedAt) : Date.now()),
    progress: Number.isFinite(entry.progress)
      ? Number(entry.progress)
      : (previous && Number.isFinite(previous.progress) ? Number(previous.progress) : 0)
  };
}

export function createSpinnerOperations(options = {}) {
  const queueByTabId = options.queueByTabId instanceof Map ? options.queueByTabId : new Map();
  const normalizeTabId = typeof options.normalizeTabId === "function"
    ? options.normalizeTabId
    : defaultNormalizeTabId;
  const appendTrace = typeof options.appendTrace === "function"
    ? options.appendTrace
    : () => {};
  const broadcastState = typeof options.broadcastState === "function"
    ? options.broadcastState
    : () => {};
  const buildState = typeof options.buildState === "function"
    ? options.buildState
    : (tabId) => ({ ok: Boolean(tabId), tabId, spinnerQueue: [] });
  const updateRuntimeSpinnerQueue = typeof options.updateRuntimeSpinnerQueue === "function"
    ? options.updateRuntimeSpinnerQueue
    : () => {};

  function getSpinnerQueueForTab(tabId) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return null;
    }
    if (!queueByTabId.has(normalizedTabId)) {
      queueByTabId.set(normalizedTabId, new Map());
    }
    return queueByTabId.get(normalizedTabId);
  }

  function serializeSpinnerQueue(tabId) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return [];
    }
    const queue = queueByTabId.get(normalizedTabId);
    if (!queue || queue.size === 0) {
      return [];
    }
    return [...queue.entries()].map(([key, entry]) => ({
      key,
      message: entry && typeof entry.message === "string" ? entry.message : "",
      persistent: Boolean(entry && entry.persistent),
      owner: entry && typeof entry.owner === "string" ? entry.owner : "",
      reason: entry && typeof entry.reason === "string" ? entry.reason : "",
      source: entry && typeof entry.source === "string" ? entry.source : "",
      startedAt: entry && Number.isFinite(entry.startedAt) ? Number(entry.startedAt) : 0,
      progress: entry && Number.isFinite(entry.progress) ? Number(entry.progress) : 0
    }));
  }

  function setBackgroundSpinnerEntry(tabId, key, entry = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !key) {
      return buildState(normalizedTabId);
    }
    const queue = getSpinnerQueueForTab(normalizedTabId);
    const normalizedEntry = normalizeSpinnerEntry(String(key), entry, queue.get(String(key)) || null);
    queue.set(String(key), normalizedEntry);
    updateRuntimeSpinnerQueue(normalizedTabId, queue);
    appendTrace(normalizedTabId, "spinner", "set", {
      type: WORLD_MESSAGE_TYPES.SPINNER_SET,
      key: String(key),
      message: normalizedEntry.message,
      reason: normalizedEntry.reason,
      source: normalizedEntry.source
    });
    broadcastState(normalizedTabId);
    return buildState(normalizedTabId);
  }

  function updateBackgroundSpinnerEntry(tabId, key, patch = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !key) {
      return buildState(normalizedTabId);
    }
    const queue = getSpinnerQueueForTab(normalizedTabId);
    const existing = queue.get(String(key)) || null;
    const nextPatch = { ...patch };
    if (patch && patch.resetStartedAt) {
      nextPatch.startedAt = Date.now();
    }
    return setBackgroundSpinnerEntry(normalizedTabId, String(key), normalizeSpinnerEntry(String(key), nextPatch, existing));
  }

  function removeBackgroundSpinnerEntry(tabId, key) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !key) {
      return buildState(normalizedTabId);
    }
    const queue = getSpinnerQueueForTab(normalizedTabId);
    queue.delete(String(key));
    if (queue.size === 0) {
      queueByTabId.delete(normalizedTabId);
    }
    updateRuntimeSpinnerQueue(normalizedTabId, queue);
    appendTrace(normalizedTabId, "spinner", "remove", {
      type: WORLD_MESSAGE_TYPES.SPINNER_REMOVE,
      key: String(key),
      message: String(key),
      reason: "spinner-removed",
      source: "background-spinner-broker"
    });
    broadcastState(normalizedTabId);
    return buildState(normalizedTabId);
  }

  function clearBackgroundSpinnerQueue(tabId, options = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return buildState(normalizedTabId);
    }
    const queue = queueByTabId.get(normalizedTabId);
    if (!queue) {
      return buildState(normalizedTabId);
    }
    const transientOnly = Boolean(options.transientOnly);
    if (transientOnly) {
      for (const [key, entry] of queue.entries()) {
        if (!entry || !entry.persistent) {
          queue.delete(key);
        }
      }
      if (queue.size === 0) {
        queueByTabId.delete(normalizedTabId);
      }
    } else {
      queueByTabId.delete(normalizedTabId);
    }
    updateRuntimeSpinnerQueue(normalizedTabId, queueByTabId.get(normalizedTabId) || new Map());
    appendTrace(normalizedTabId, "spinner", "clear", {
      type: WORLD_MESSAGE_TYPES.SPINNER_CLEAR,
      message: transientOnly ? "transient-only" : "all",
      reason: transientOnly ? "clear-transient-spinners" : "clear-all-spinners",
      source: "background-spinner-broker"
    });
    broadcastState(normalizedTabId);
    return buildState(normalizedTabId);
  }

  async function withTabSpinner(tabId, descriptor = {}, work) {
    if (typeof work !== "function") {
      throw new TypeError("withTabSpinner requires an async work function");
    }
    const key = typeof descriptor.key === "string" && descriptor.key
      ? descriptor.key
      : randomSpinnerKey();
    await Promise.resolve(setBackgroundSpinnerEntry(tabId, key, {
      ...descriptor,
      key
    }));
    try {
      return await work({
        key,
        update: async (patch = {}) => {
          return updateBackgroundSpinnerEntry(tabId, key, patch);
        }
      });
    } finally {
      await Promise.resolve(removeBackgroundSpinnerEntry(tabId, key));
    }
  }

  return {
    getSpinnerQueueForTab,
    serializeSpinnerQueue,
    setBackgroundSpinnerEntry,
    updateBackgroundSpinnerEntry,
    removeBackgroundSpinnerEntry,
    clearBackgroundSpinnerQueue,
    withTabSpinner
  };
}