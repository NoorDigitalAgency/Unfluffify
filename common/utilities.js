import {SCRIPT_INJECTED_PREFIX, TAB_STATE_PREFIX} from "./constants.js";

// Scripting utilities
export async function isScriptInjected(tabId) {
  const key = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return Boolean(result[key]);
}

export async function setScriptInjected(tabId, injected) {
  const key = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  if (injected) {
    await storageSet(chrome.storage.session, { [key]: true });
  } else {
    await storageRemove(chrome.storage.session, key);
  }
}

export async function injectContentScript(tabId) {
  const alreadyInjected = await isScriptInjected(tabId);
  if (alreadyInjected) {
    return { ok: true, alreadyInjected: true };
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-loader.js"]
    });
    await setScriptInjected(tabId, true);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || "Script injection failed" };
  }
}

// Browser utilities
export async function disableExtensionForTab(tabId) {
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
export const tabsQuery = (query) =>
    new Promise((resolve) => chrome.tabs.query(query, resolve));

export function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

// General utilities
export function arraysEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

export function isHeadingXPath(value) {
  if (typeof value !== "string") {
    return false;
  }
  return /\/h[1-6]\[\d+\]\s*$/i.test(value);
}

export function parseBaseUrl(value) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch (error) {
    return null;
  }
}

export function getOriginFromUrl(url) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch (error) {
    return null;
  }
}

export function findMatchingBaseUrl(pageUrl, configs) {
  if (!pageUrl) {
    return "";
  }
  let match = "";
  Object.keys(configs).forEach((baseUrl) => {
    if (pageUrl.startsWith(baseUrl) && baseUrl.length > match.length) {
      match = baseUrl;
    }
  });
  return match;
}

export function looksLikeBaseUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function makeSafeFilename(value) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

// Storage utilities
export const storageGet = (area, keys) =>
    new Promise((resolve) => area.get(keys, resolve));
export const storageSet = (area, items) =>
    new Promise((resolve) => area.set(items, resolve));
export const storageRemove = (area, keys) =>
    new Promise((resolve) => area.remove(keys, resolve));

const IDB_NAME = "unfluffify";
const IDB_VERSION = 1;
const IDB_STORE = "kv";
let idbPromise = null;

function getExtensionOrigin() {
  try {
    if (chrome && chrome.runtime && chrome.runtime.getURL) {
      return new URL(chrome.runtime.getURL("")).origin;
    }
  } catch (error) {
    // Ignore origin detection errors
  }
  return "";
}

function isExtensionContext() {
  const extensionOrigin = getExtensionOrigin();
  if (!extensionOrigin) {
    return true;
  }
  if (typeof location === "undefined" || !location.origin) {
    return true;
  }
  return location.origin === extensionOrigin;
}

function openIdb() {
  if (idbPromise) {
    return idbPromise;
  }
  idbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
  return idbPromise;
}

function normalizeIdbKeys(keys) {
  if (keys === null || keys === undefined) {
    return { keys: null, defaults: null };
  }
  if (Array.isArray(keys)) {
    return { keys, defaults: null };
  }
  if (typeof keys === "string") {
    return { keys: [keys], defaults: null };
  }
  if (typeof keys === "object") {
    return { keys: Object.keys(keys), defaults: { ...keys } };
  }
  return { keys: null, defaults: null };
}

async function idbGetAll() {
  const db = await openIdb();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const result = {};
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(result);
        return;
      }
      result[cursor.key] = cursor.value;
      cursor.continue();
    };
    request.onerror = () => resolve(result);
    tx.onabort = () => resolve(result);
  });
}

export async function idbGet(keys) {
  if (!isExtensionContext()) {
    const response = await sendRuntimeMessage({ type: "idbGet", keys });
    return response && response.ok ? response.result || {} : {};
  }
  const normalized = normalizeIdbKeys(keys);
  if (!normalized.keys) {
    return idbGetAll();
  }
  const db = await openIdb();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const result = normalized.defaults ? { ...normalized.defaults } : {};
    let pending = normalized.keys.length;
    if (!pending) {
      resolve(result);
      return;
    }
    const finish = () => {
      pending -= 1;
      if (pending <= 0) {
        resolve(result);
      }
    };
    normalized.keys.forEach((key) => {
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result !== undefined) {
          result[key] = request.result;
        }
        finish();
      };
      request.onerror = () => finish();
    });
    tx.onabort = () => resolve(result);
  });
}

export async function idbSet(items) {
  if (!items || typeof items !== "object") {
    return;
  }
  if (!isExtensionContext()) {
    await sendRuntimeMessage({ type: "idbSet", items });
    return;
  }
  const db = await openIdb();
  await new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    Object.entries(items).forEach(([key, value]) => {
      store.put(value, key);
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function idbRemove(keys) {
  if (keys === null || keys === undefined) {
    return;
  }
  if (!isExtensionContext()) {
    await sendRuntimeMessage({ type: "idbRemove", keys });
    return;
  }
  const normalized = normalizeIdbKeys(keys);
  if (!normalized.keys || !normalized.keys.length) {
    return;
  }
  const db = await openIdb();
  await new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    normalized.keys.forEach((key) => {
      store.delete(key);
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

// Tab state utilities
export async function getTabState(tabId, scope = null) {
  const key = `${TAB_STATE_PREFIX}${(scope ? `:${scope}` : '')}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || null;
}

export async function setTabState(tabId, state, scope = null) {
  const key = `${TAB_STATE_PREFIX}${(scope ? `:${scope}` : '')}${tabId}`;
  await storageSet(chrome.storage.session, {[key]: state});
}

export async function clearTabState(tabId) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  await storageRemove(chrome.storage.session, key);
}

// Action icon utilities
export async function updateActionForTab(tabId) {
  if (!chrome.action || !tabId) {
    return;
  }
  const state = await getTabState(tabId);
  const enabled = state && state.enabled;
  const path = enabled
      ? {
        16: "icons/active/icon16.png",
        32: "icons/active/icon32.png",
        48: "icons/active/icon48.png",
        128: "icons/active/icon128.png"
      }
      : {
        16: "icons/default/icon16.png",
        32: "icons/default/icon32.png",
        48: "icons/default/icon48.png",
        128: "icons/default/icon128.png"
      };
  chrome.action.setIcon({tabId, path}, () => {
    void chrome.runtime.lastError;
  });
}
