import { SCRIPT_INJECTED_PREFIX, TAB_STATE_PREFIX } from "../common/constants.js";
import { storageGet, storageRemove, storageSet } from "../common/storage-core.js";

const TAB_SESSION_WRITE_QUEUE_BY_TAB_ID = new Map();

function normalizeTabId(tabId) {
  const normalized = Number(tabId);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  const truncated = Math.trunc(normalized);
  return truncated > 0 ? truncated : 0;
}

function normalizePathForMatch(pathname) {
  if (typeof pathname !== "string" || !pathname) {
    return "/";
  }
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function normalizeTabStateBaseUrl(value) {
  if (!value) {
    return "";
  }
  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }
  const rawHostname = (parsed.hostname || "").toLowerCase();
  const hostname = rawHostname.startsWith("www.") && rawHostname.length > 4
    ? rawHostname.slice(4)
    : rawHostname;
  if (!hostname) {
    return "";
  }
  const pathname = normalizePathForMatch(parsed.pathname);
  return `${parsed.protocol}//${hostname}${pathname === "/" ? "" : pathname}`;
}

export function getTabStateKey(tabId, scope = null) {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return "";
  }
  const normalizedScope = typeof scope === "string" && scope ? `${scope}:` : "";
  return `${TAB_STATE_PREFIX}${normalizedScope}${normalizedTabId}`;
}

export function getScriptInjectedKey(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return "";
  }
  return `${SCRIPT_INJECTED_PREFIX}${normalizedTabId}`;
}

export function parseTabStateStorageKey(key) {
  if (typeof key !== "string" || !key.startsWith(TAB_STATE_PREFIX)) {
    return null;
  }
  const suffix = key.slice(TAB_STATE_PREFIX.length);
  if (!suffix) {
    return null;
  }
  const separatorIndex = suffix.indexOf(":");
  const scope = separatorIndex > -1 ? suffix.slice(0, separatorIndex) : null;
  const tabIdPart = separatorIndex > -1 ? suffix.slice(separatorIndex + 1) : suffix;
  const tabId = normalizeTabId(tabIdPart);
  if (!tabId) {
    return null;
  }
  return {
    tabId,
    scope: scope || null
  };
}

export function normalizeTabSessionState(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (typeof value.baseUrl !== "string") {
    return value;
  }
  const normalizedBaseUrl = normalizeTabStateBaseUrl(value.baseUrl);
  if (!normalizedBaseUrl && value.baseUrl !== "") {
    return value;
  }
  if (normalizedBaseUrl === value.baseUrl) {
    return value;
  }
  return {
    ...value,
    baseUrl: normalizedBaseUrl
  };
}

export function queueTabSessionWrite(tabId, work) {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId || typeof work !== "function") {
    return Promise.resolve(null);
  }
  const previous = TAB_SESSION_WRITE_QUEUE_BY_TAB_ID.get(normalizedTabId) || Promise.resolve();
  const queued = previous
    .catch(() => {})
    .then(() => work());
  const settled = queued.finally(() => {
    if (TAB_SESSION_WRITE_QUEUE_BY_TAB_ID.get(normalizedTabId) === settled) {
      TAB_SESSION_WRITE_QUEUE_BY_TAB_ID.delete(normalizedTabId);
    }
  });
  TAB_SESSION_WRITE_QUEUE_BY_TAB_ID.set(normalizedTabId, settled);
  return settled;
}

export async function getTabState(tabId, scope = null, options = {}) {
  const key = getTabStateKey(tabId, scope);
  if (!key) {
    return null;
  }
  const useNormalization = options && options.normalize !== false;
  const result = await storageGet(chrome.storage.session, key);
  const value = result[key] || null;
  return useNormalization ? normalizeTabSessionState(value) : value;
}

export async function setTabState(tabId, state, scope = null) {
  const key = getTabStateKey(tabId, scope);
  if (!key) {
    return;
  }
  const normalizedState = normalizeTabSessionState(state);
  await queueTabSessionWrite(tabId, () => storageSet(chrome.storage.session, { [key]: normalizedState }));
}

export async function clearTabState(tabId, options = {}) {
  const includeRestoreScope = Boolean(options && options.includeRestoreScope);
  const keys = [
    getTabStateKey(tabId),
    getTabStateKey(tabId, "initial")
  ];
  if (includeRestoreScope) {
    keys.push(getTabStateKey(tabId, "restore"));
  }
  const keysToRemove = keys.filter((key) => key);
  if (!keysToRemove.length) {
    return;
  }
  await queueTabSessionWrite(tabId, () => storageRemove(chrome.storage.session, keysToRemove));
}

export async function isScriptInjected(tabId) {
  const key = getScriptInjectedKey(tabId);
  if (!key) {
    return false;
  }
  const result = await storageGet(chrome.storage.session, key);
  return Boolean(result[key]);
}

export async function setScriptInjected(tabId, injected) {
  const key = getScriptInjectedKey(tabId);
  if (!key) {
    return;
  }
  if (injected) {
    await queueTabSessionWrite(tabId, () => storageSet(chrome.storage.session, { [key]: true }));
    return;
  }
  await queueTabSessionWrite(tabId, () => storageRemove(chrome.storage.session, key));
}

export async function clearTrackedTabSessionState(tabId, options = {}) {
  const includeScriptInjected = options.includeScriptInjected !== false;
  const includeRestoreScope = Boolean(options.includeRestoreScope);
  const keys = [
    getTabStateKey(tabId),
    getTabStateKey(tabId, "initial")
  ];
  if (includeRestoreScope) {
    keys.push(getTabStateKey(tabId, "restore"));
  }
  if (includeScriptInjected) {
    keys.push(getScriptInjectedKey(tabId));
  }
  const keysToRemove = keys.filter((key) => key);
  if (!keysToRemove.length) {
    return;
  }
  await queueTabSessionWrite(tabId, () => storageRemove(chrome.storage.session, keysToRemove));
}
