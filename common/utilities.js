import {SCRIPT_INJECTED_PREFIX, TAB_STATE_PREFIX} from "./constants.js";

/**
 * Checks if the content script has been injected into a specific tab.
 * @async
 * @param {number} tabId - The Chrome tab ID to check
 * @returns {Promise<boolean>} True if the script is injected, false otherwise
 */
export async function isScriptInjected(tabId) {
  const key = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return Boolean(result[key]);
}

/**
 * Marks a tab as having the content script injected (internal use only).
 * @async
 * @private
 * @param {number} tabId - The Chrome tab ID
 * @param {boolean} injected - Whether the script is injected
 * @returns {Promise<void>}
 */
async function setScriptInjected(tabId, injected) {
  const key = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  if (injected) {
    await storageSet(chrome.storage.session, { [key]: true });
  } else {
    await storageRemove(chrome.storage.session, key);
  }
}

/**
 * Injects the content script into a specific tab. Checks if it's already injected to avoid duplicates.
 * @async
 * @param {number} tabId - The Chrome tab ID to inject the script into
 * @returns {Promise<{ok: boolean, alreadyInjected?: boolean, error?: string}>} Result of injection attempt
 */
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

const EXTENSION_CONTEXT_INVALIDATED_PATTERN = /extension context invalidated|context invalidated/i;

function getErrorMessage(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value.message === "string") {
    return value.message;
  }
  return "";
}

export function isExtensionContextInvalidatedError(error) {
  return EXTENSION_CONTEXT_INVALIDATED_PATTERN.test(getErrorMessage(error));
}

function getChromeRuntimeLastError() {
  try {
    if (!globalThis.chrome || !chrome.runtime) {
      return null;
    }
    return chrome.runtime.lastError || null;
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      return { message: getErrorMessage(error) || "Extension context invalidated." };
    }
    throw error;
  }
}

function makeChromeRuntimeError(error) {
  return new Error(getErrorMessage(error) || "Chrome runtime operation failed");
}

function makeInvalidatedRuntimeResponse(error) {
  return {
    ok: false,
    error: getErrorMessage(error) || "Extension context invalidated.",
    contextInvalidated: true
  };
}

export function sendRuntimeMessage(message) {
  try {
    const promise = chrome.runtime.sendMessage(message);
    if (promise && typeof promise.then === "function") {
      return promise.catch((error) => {
        if (isExtensionContextInvalidatedError(error)) {
          return makeInvalidatedRuntimeResponse(error);
        }
        throw error;
      });
    }
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      return Promise.resolve(makeInvalidatedRuntimeResponse(error));
    }
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        let lastError = null;
        try {
          lastError = getChromeRuntimeLastError();
        } catch (error) {
          reject(error);
          return;
        }
        if (lastError) {
          resolve({
            ok: false,
            error: getErrorMessage(lastError),
            contextInvalidated: isExtensionContextInvalidatedError(lastError)
          });
          return;
        }
        resolve(response);
      });
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        resolve(makeInvalidatedRuntimeResponse(error));
        return;
      }
      reject(error);
    }
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

export function parseBaseUrl(value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) {
    return null;
  }
  try {
    return new URL(normalized);
  } catch (error) {
    return null;
  }
}

function parseHttpUrl(value) {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

export function normalizeBaseUrl(value) {
  const parsed = parseHttpUrl(value);
  if (!parsed) {
    return "";
  }
  const rawHostname = (parsed.hostname || "").toLowerCase();
  const hostname =
    rawHostname.startsWith("www.") && rawHostname.length > 4
      ? rawHostname.slice(4)
      : rawHostname;
  if (!hostname) {
    return "";
  }
  const pathname = normalizePathForMatch(parsed.pathname);
  return `${parsed.protocol}//${hostname}${pathname === "/" ? "" : pathname}`;
}

export function normalizeCanonicalBaseUrl(value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) {
    return "";
  }
  const parsed = parseHttpUrl(normalized);
  if (!parsed) {
    return normalized;
  }
  const hostname = (parsed.hostname || "").toLowerCase();
  if (!hostname) {
    return normalized;
  }
  const canonicalHostname =
    hostname.startsWith("www.") && hostname.length > 4
      ? hostname.slice(4)
      : hostname;
  const pathname = normalizePathForMatch(parsed.pathname);
  return `${parsed.protocol}//${canonicalHostname}${pathname === "/" ? "" : pathname}`;
}

function normalizeBaseMatchHostname(hostname) {
  if (typeof hostname !== "string") {
    return "";
  }
  const lower = hostname.trim().toLowerCase();
  if (!lower) {
    return "";
  }
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

function hostnamesEquivalentForBaseMatch(leftHostname, rightHostname) {
  if (!leftHostname || !rightHostname) {
    return false;
  }
  if (leftHostname === rightHostname) {
    return true;
  }
  const leftNormalized = normalizeBaseMatchHostname(leftHostname);
  const rightNormalized = normalizeBaseMatchHostname(rightHostname);
  if (!leftNormalized || !rightNormalized) {
    return false;
  }
  if (leftNormalized !== rightNormalized) {
    return false;
  }
  return leftHostname.startsWith("www.") || rightHostname.startsWith("www.");
}

function normalizedHttpPort(parsed) {
  if (!parsed) {
    return "";
  }
  if (parsed.port) {
    return parsed.port;
  }
  if (parsed.protocol === "https:") {
    return "443";
  }
  if (parsed.protocol === "http:") {
    return "80";
  }
  return "";
}

function originsEquivalentForBaseMatch(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left.origin === right.origin) {
    return true;
  }
  if (left.protocol !== right.protocol) {
    return false;
  }
  if (normalizedHttpPort(left) !== normalizedHttpPort(right)) {
    return false;
  }
  return hostnamesEquivalentForBaseMatch(left.hostname, right.hostname);
}

function normalizePathForMatch(pathname) {
  if (typeof pathname !== "string" || !pathname) {
    return "/";
  }
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function getBaseUrlSpecificity(baseUrl) {
  const parsed = parseHttpUrl(baseUrl);
  if (!parsed) {
    return 0;
  }
  const normalizedPath = normalizePathForMatch(parsed.pathname);
  return `${parsed.origin}${normalizedPath}`.length;
}

export function isPageWithinBaseUrl(pageUrl, baseUrl) {
  const page = parseHttpUrl(pageUrl);
  const base = parseHttpUrl(normalizeBaseUrl(baseUrl) || baseUrl);
  if (!page || !base) {
    return false;
  }
  if (!originsEquivalentForBaseMatch(page, base)) {
    return false;
  }
  const pagePath = normalizePathForMatch(page.pathname);
  const basePath = normalizePathForMatch(base.pathname);
  if (basePath === "/") {
    return true;
  }
  if (pagePath === basePath) {
    return true;
  }
  return pagePath.startsWith(`${basePath}/`);
}

export function sameBaseUrl(left, right) {
  if (!left || !right) {
    return false;
  }
  const normalizedLeft = normalizeBaseUrl(left);
  const normalizedRight = normalizeBaseUrl(right);
  if (normalizedLeft && normalizedRight) {
    if (normalizedLeft === normalizedRight) {
      return true;
    }
    const parsedLeft = parseHttpUrl(normalizedLeft);
    const parsedRight = parseHttpUrl(normalizedRight);
    if (!parsedLeft || !parsedRight) {
      return false;
    }
    return (
      originsEquivalentForBaseMatch(parsedLeft, parsedRight) &&
      normalizePathForMatch(parsedLeft.pathname) === normalizePathForMatch(parsedRight.pathname)
    );
  }
  return String(left).trim() === String(right).trim();
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
  let matchSpecificity = 0;
  Object.keys(configs).forEach((baseUrl) => {
    if (!isPageWithinBaseUrl(pageUrl, baseUrl)) {
      return;
    }
    const specificity = getBaseUrlSpecificity(baseUrl);
    if (specificity > matchSpecificity) {
      match = baseUrl;
      matchSpecificity = specificity;
    }
  });
  return match;
}

// Storage utilities
export const storageGet = (area, keys) =>
    new Promise((resolve, reject) => {
      try {
        area.get(keys, (result) => {
          let lastError = null;
          try {
            lastError = getChromeRuntimeLastError();
          } catch (error) {
            reject(error);
            return;
          }
          if (lastError) {
            reject(makeChromeRuntimeError(lastError));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
export const storageSet = (area, items) =>
    new Promise((resolve, reject) => {
      try {
        area.set(items, () => {
          let lastError = null;
          try {
            lastError = getChromeRuntimeLastError();
          } catch (error) {
            reject(error);
            return;
          }
          if (lastError) {
            reject(makeChromeRuntimeError(lastError));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
export const storageRemove = (area, keys) =>
    new Promise((resolve, reject) => {
      try {
        area.remove(keys, () => {
          let lastError = null;
          try {
            lastError = getChromeRuntimeLastError();
          } catch (error) {
            reject(error);
            return;
          }
          if (lastError) {
            reject(makeChromeRuntimeError(lastError));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });

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
    if (response && response.ok) {
      return response.result || {};
    }
    throw new Error(response && response.error ? response.error : "IndexedDB get failed");
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
    const response = await sendRuntimeMessage({ type: "idbSet", items });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "IndexedDB set failed");
    }
    return;
  }
  const db = await openIdb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    Object.entries(items).forEach(([key, value]) => {
      store.put(value, key);
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB set failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB set aborted"));
  });
}

export async function idbRemove(keys) {
  if (keys === null || keys === undefined) {
    return;
  }
  if (!isExtensionContext()) {
    const response = await sendRuntimeMessage({ type: "idbRemove", keys });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "IndexedDB remove failed");
    }
    return;
  }
  const normalized = normalizeIdbKeys(keys);
  if (!normalized.keys || !normalized.keys.length) {
    return;
  }
  const db = await openIdb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    normalized.keys.forEach((key) => {
      store.delete(key);
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB remove failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB remove aborted"));
  });
}

// Session-scoped key/value storage for property data. Backed by
// chrome.storage.session so it never persists to disk and is cleared when the
// browser session ends. Content scripts cannot reach chrome.storage.session
// directly, so they relay through the background service worker (mirroring the
// idb relay above).
export async function sessionKvGet(keys) {
  if (!isExtensionContext()) {
    const response = await sendRuntimeMessage({ type: "sessionKvGet", keys });
    if (response && response.ok) {
      return response.result || {};
    }
    throw new Error(response && response.error ? response.error : "Session storage get failed");
  }
  return storageGet(chrome.storage.session, keys);
}

export async function sessionKvSet(items) {
  if (!items || typeof items !== "object") {
    return;
  }
  if (!isExtensionContext()) {
    const response = await sendRuntimeMessage({ type: "sessionKvSet", items });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Session storage set failed");
    }
    return;
  }
  await storageSet(chrome.storage.session, items);
}

export async function sessionKvRemove(keys) {
  if (keys === null || keys === undefined) {
    return;
  }
  if (!isExtensionContext()) {
    const response = await sendRuntimeMessage({ type: "sessionKvRemove", keys });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Session storage remove failed");
    }
    return;
  }
  await storageRemove(chrome.storage.session, keys);
}

// Tab state utilities
export async function getTabState(tabId, scope = null) {
  const key = `${TAB_STATE_PREFIX}${(scope ? `${scope}:` : '')}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  const value = result[key] || null;
  if (!value || typeof value !== "object") {
    return value;
  }
  if (typeof value.baseUrl === "string" && value.baseUrl) {
    const normalizedBaseUrl = normalizeBaseUrl(value.baseUrl);
    if (normalizedBaseUrl && normalizedBaseUrl !== value.baseUrl) {
      return { ...value, baseUrl: normalizedBaseUrl };
    }
  }
  return value;
}

export async function setTabState(tabId, state, scope = null) {
  const key = `${TAB_STATE_PREFIX}${(scope ? `${scope}:` : '')}${tabId}`;
  let nextState = state;
  if (nextState && typeof nextState === "object" && typeof nextState.baseUrl === "string") {
    const normalizedBaseUrl = normalizeBaseUrl(nextState.baseUrl);
    if (normalizedBaseUrl || nextState.baseUrl === "") {
      nextState = { ...nextState, baseUrl: normalizedBaseUrl };
    }
  }
  await storageSet(chrome.storage.session, {[key]: nextState});
}

export async function clearTabState(tabId) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const initialKey = `${TAB_STATE_PREFIX}initial:${tabId}`;
  await storageRemove(chrome.storage.session, [key, initialKey]);
}

// Action icon utilities
export async function updateActionForTab(tabId) {
  if (!chrome.action || !tabId) {
    return;
  }
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return;
  }
  const [initialState, tabState] = await Promise.all([
    getTabState(tabId, "initial"),
    getTabState(tabId)
  ]);
  const extensionActiveOnTab = Boolean(
    tab &&
      tab.active &&
      (
        (tabState && typeof tabState === "object" && tabState.enabled) ||
        (initialState && typeof initialState === "object" && initialState.active)
      )
  );
  const path = extensionActiveOnTab
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

/**
 * Attaches the debugger to a tab. Safe to call if already attached.
 * @async
 * @param {number} tabId - The Chrome tab ID to attach to
 * @returns {Promise<{ok: boolean, error?: string, alreadyAttached?: boolean}>} Result of the attach operation
 */
export async function attachDebugger(tabId) {
  if (!tabId) {
    return { ok: false, error: "Missing tab ID" };
  }

  try {
    const target = { tabId };
    await chrome.debugger.attach(target, "1.3");
    return { ok: true };
  } catch (error) {
    // Check if already attached
    if (error && error.message && error.message.includes("already attached")) {
      return { ok: true, alreadyAttached: true };
    }
    const errorMessage = (error && error.message) || "Failed to attach debugger";
    console.error("Error attaching debugger:", errorMessage);
    return { ok: false, error: errorMessage };
  }
}

/**
 * Detaches the debugger from a tab.
 * @async
 * @param {number} tabId - The Chrome tab ID to detach from
 * @returns {Promise<{ok: boolean, alreadyDetached?: boolean, error?: string}>} Result of the detach operation
 */
export async function detachDebugger(tabId) {
  if (!tabId) {
    return { ok: false, error: "Missing tab ID" };
  }

  try {
    const target = { tabId };
    await chrome.debugger.detach(target);
    return { ok: true };
  } catch (error) {
    const errorMessage = (error && error.message) || "Failed to detach debugger";
    if (/not attached/i.test(errorMessage)) {
      return { ok: true, alreadyDetached: true };
    }
    console.error("Error detaching debugger:", errorMessage);
    return { ok: false, error: errorMessage };
  }
}

/**
 * Reloads a page with optional JavaScript execution disabled via debugger.
 * Keeps the debugger attached and leaves the page in the specified state.
 * @async
 * @param {number} tabId - The Chrome tab ID to reload
 * @param {boolean} [javaScriptDisabled=false] - Whether to disable JavaScript during reload
 * @returns {Promise<{ok: boolean, error?: string}>} Result of the reload operation
 */
export async function reloadPageWithJavaScriptControl(tabId, javaScriptDisabled = false) {
  if (!tabId) {
    return { ok: false, error: "Missing tab ID" };
  }

  try {
    const target = { tabId };
    
    // Attach debugger (try to attach if not already attached)
    const attachResult = await attachDebugger(tabId);
    if (!attachResult.ok && !attachResult.alreadyAttached) {
      return { ok: false, error: attachResult.error };
    }

    // Set JavaScript execution state as requested
    await chrome.debugger.sendCommand(target, "Emulation.setScriptExecutionDisabled", {
      value: javaScriptDisabled
    });

    // Reload the page
    await chrome.debugger.sendCommand(target, "Page.reload", {
      ignoreCache: true
    });

    console.log(`Page is reloading with JavaScript ${javaScriptDisabled ? "disabled" : "enabled"}.`);

    return { ok: true };
  } catch (error) {
    const errorMessage = (error && error.message) || "Failed to reload page";
    console.error("Error reloading page:", errorMessage);
    return { ok: false, error: errorMessage };
  }
}
