import { isDebugFlagEnabled } from "./feature-flags.js";
import {
  addStorageChangeListener,
  getStorageAreaName,
  isChromeStorageArea,
  storageClear,
  storageGet,
  storageRemove,
  storageSet
} from "./storage-core.js";
import {
  clearScriptInjected as clearStoredScriptInjectedState,
  clearTabStateScope,
  clearTabState as clearTabSessionState,
  getTabState as getStoredTabState,
  isScriptInjected as getScriptInjectedState,
  setScriptInjected as setStoredScriptInjectedState,
  setTabState as setStoredTabState
} from "../background/tab-session-store.js";

export {
  addStorageChangeListener,
  getStorageAreaName,
  isChromeStorageArea,
  storageClear,
  storageGet,
  storageRemove,
  storageSet
};

/**
 * Checks if the content script has been injected into a specific tab.
 * @async
 * @param {number} tabId - The Chrome tab ID to check
 * @returns {Promise<boolean>} True if the script is injected, false otherwise
 */
export async function isScriptInjected(tabId: any) {
  return getScriptInjectedState(tabId);
}

/**
 * Injects the content script into a specific tab. Checks if it's already injected to avoid duplicates.
 * @async
 * @param {number} tabId - The Chrome tab ID to inject the script into
 * @returns {Promise<{ok: boolean, alreadyInjected?: boolean, error?: string}>} Result of injection attempt
 */
export async function injectContentScript(tabId: any, options = {}) {
  const optionsAny = options as any;
  const force = Boolean(optionsAny && optionsAny.force);
  const alreadyInjected = await isScriptInjected(tabId);
  if (alreadyInjected && !force) {
    return { ok: true, alreadyInjected: true };
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-loader.js"]
    });
    await setStoredScriptInjectedState(tabId, true);
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error.message || "Script injection failed" };
  }
}

// Browser utilities
export async function disableExtensionForTab(tabId: any) {
  await Promise.all([
    clearTabStateScope(tabId),
    clearStoredScriptInjectedState(tabId)
  ]);
  await updateActionForTab(tabId);
  try {
    await chrome.tabs.sendMessage(tabId, { type: "setEnabled", enabled: false });
  } catch (error) {
    // Content script may not be loaded
  }
}
export const tabsQuery = (query: any) =>
    new Promise((resolve) => chrome.tabs.query(query, resolve));

const EXTENSION_CONTEXT_INVALIDATED_PATTERN = /extension context invalidated|context invalidated/i;

function getErrorMessage(value: any) {
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

export function isExtensionContextInvalidatedError(error: any) {
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

function makeChromeRuntimeError(error: any) {
  return new Error(getErrorMessage(error) || "Chrome runtime operation failed");
}

function makeInvalidatedRuntimeResponse(error: any) {
  return {
    ok: false,
    error: getErrorMessage(error) || "Extension context invalidated.",
    contextInvalidated: true
  };
}

function isFullWorldMessagingLoggingEnabled() {
  return isDebugFlagEnabled("fullWorldMessagingLogging");
}

function getMessageTypeForLog(message: any) {
  return message && typeof message.type === "string" ? message.type : "";
}

function logRuntimeMessage(direction: any, message: any, details = {}) {
  if (!isFullWorldMessagingLoggingEnabled()) {
    return;
  }
  try {
    console.debug("[world-trace][runtime]", direction, {
      type: getMessageTypeForLog(message),
      ...details
    });
  } catch {
    // Logging must never affect message delivery.
  }
}

export function sendRuntimeMessage(message: any) {
  logRuntimeMessage("send", message);
  try {
    const promise = chrome.runtime.sendMessage(message);
    if (promise && typeof promise.then === "function") {
      return promise
        .then((response) => {
          logRuntimeMessage("response", message, {
            ok: Boolean(response && response.ok),
            contextInvalidated: Boolean(response && response.contextInvalidated)
          });
          return response;
        })
        .catch((error) => {
          if (isExtensionContextInvalidatedError(error)) {
            const invalidatedResponse = makeInvalidatedRuntimeResponse(error);
            logRuntimeMessage("response", message, {
              ok: false,
              contextInvalidated: true,
              error: invalidatedResponse.error
            });
            return invalidatedResponse;
          }
          logRuntimeMessage("error", message, {
            ok: false,
            contextInvalidated: false,
            error: getErrorMessage(error)
          });
          throw error;
        });
    }
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      const invalidatedResponse = makeInvalidatedRuntimeResponse(error);
      logRuntimeMessage("response", message, {
        ok: false,
        contextInvalidated: true,
        error: invalidatedResponse.error
      });
      return Promise.resolve(invalidatedResponse);
    }
    logRuntimeMessage("error", message, {
      ok: false,
      contextInvalidated: false,
      error: getErrorMessage(error)
    });
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
          const failureResponse = {
            ok: false,
            error: getErrorMessage(lastError),
            contextInvalidated: isExtensionContextInvalidatedError(lastError)
          };
          logRuntimeMessage("response", message, {
            ok: false,
            contextInvalidated: Boolean(failureResponse.contextInvalidated),
            error: failureResponse.error
          });
          resolve(failureResponse);
          return;
        }
        logRuntimeMessage("response", message, {
          ok: Boolean(response && response.ok),
          contextInvalidated: Boolean(response && response.contextInvalidated)
        });
        resolve(response);
      });
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        const invalidatedResponse = makeInvalidatedRuntimeResponse(error);
        logRuntimeMessage("response", message, {
          ok: false,
          contextInvalidated: true,
          error: invalidatedResponse.error
        });
        resolve(invalidatedResponse);
        return;
      }
      logRuntimeMessage("error", message, {
        ok: false,
        contextInvalidated: false,
        error: getErrorMessage(error)
      });
      reject(error);
    }
  });
}

// General utilities
export function arraysEqual(left: any, right: any) {
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

export function parseBaseUrl(value: any) {
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

function parseHttpUrl(value: any) {
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

export function normalizeBaseUrl(value: any) {
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

export function normalizeCanonicalBaseUrl(value: any) {
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

function normalizeBaseMatchHostname(hostname: any) {
  if (typeof hostname !== "string") {
    return "";
  }
  const lower = hostname.trim().toLowerCase();
  if (!lower) {
    return "";
  }
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

function hostnamesEquivalentForBaseMatch(leftHostname: any, rightHostname: any) {
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

function normalizedHttpPort(parsed: any) {
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

function originsEquivalentForBaseMatch(left: any, right: any) {
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

function normalizePathForMatch(pathname: any) {
  if (typeof pathname !== "string" || !pathname) {
    return "/";
  }
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function getBaseUrlSpecificity(baseUrl: any) {
  const parsed = parseHttpUrl(baseUrl);
  if (!parsed) {
    return 0;
  }
  const normalizedPath = normalizePathForMatch(parsed.pathname);
  return `${parsed.origin}${normalizedPath}`.length;
}

export function isPageWithinBaseUrl(pageUrl: any, baseUrl: any) {
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

export function sameBaseUrl(left: any, right: any) {
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

export function getOriginFromUrl(url: any) {
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

export function findMatchingBaseUrl(pageUrl: any, configs: any) {
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

const IDB_NAME = "unfluffify";
const IDB_VERSION = 1;
const IDB_STORE = "kv";
let idbPromise: Promise<any> | null = null;

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

function normalizeIdbKeys(keys: any) {
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
    const result: any = {};
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

export async function idbGet(keys: any) {
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

export async function idbSet(items: any) {
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
  await new Promise<void>((resolve, reject) => {
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

export async function idbRemove(keys: any) {
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
  await new Promise<void>((resolve, reject) => {
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

// Tab state utilities
export async function getTabState(tabId: any, scope: any = null) {
  return getStoredTabState(tabId, scope);
}

export async function setTabState(tabId: any, state: any, scope: any = null) {
  await setStoredTabState(tabId, state, scope);
}

export async function clearTabState(tabId: any) {
  await clearTabSessionState(tabId);
}

// Action icon utilities
export async function updateActionForTab(tabId: any) {
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
export async function attachDebugger(tabId: any) {
  if (!tabId) {
    return { ok: false, error: "Missing tab ID" };
  }

  try {
    const target = { tabId };
    await chrome.debugger.attach(target, "1.3");
    return { ok: true };
  } catch (error: any) {
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
export async function detachDebugger(tabId: any) {
  if (!tabId) {
    return { ok: false, error: "Missing tab ID" };
  }

  try {
    const target = { tabId };
    await chrome.debugger.detach(target);
    return { ok: true };
  } catch (error: any) {
    const errorMessage = (error && error.message) || "Failed to detach debugger";
    if (/not attached/i.test(errorMessage)) {
      return { ok: true, alreadyDetached: true };
    }
    console.error("Error detaching debugger:", errorMessage);
    return { ok: false, error: errorMessage };
  }
}

export async function setPageJavaScriptExecutionDisabled(tabId: any, disabled: any) {
  if (!tabId) {
    return { ok: false, error: "Missing tab ID" };
  }

  try {
    const target = { tabId };
    const attachResult = await attachDebugger(tabId);
    if (!attachResult.ok && !attachResult.alreadyAttached) {
      return { ok: false, error: attachResult.error };
    }

    await chrome.debugger.sendCommand(target, "Emulation.setScriptExecutionDisabled", {
      value: Boolean(disabled)
    });
    return { ok: true };
  } catch (error: any) {
    const errorMessage = (error && error.message) || "Failed to update JavaScript execution state";
    console.error("Error updating JavaScript execution state:", errorMessage);
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
export async function reloadPageWithJavaScriptControl(tabId: any, javaScriptDisabled = false) {
  if (!tabId) {
    return { ok: false, error: "Missing tab ID" };
  }

  try {
    const target = { tabId };
    const scriptStateResult = await setPageJavaScriptExecutionDisabled(tabId, javaScriptDisabled);
    if (!scriptStateResult.ok) {
      return scriptStateResult;
    }

    // Reload the page
    await chrome.debugger.sendCommand(target, "Page.reload", {
      ignoreCache: true
    });

    console.log(`Page is reloading with JavaScript ${javaScriptDisabled ? "disabled" : "enabled"}.`);

    return { ok: true };
  } catch (error: any) {
    const errorMessage = (error && error.message) || "Failed to reload page";
    console.error("Error reloading page:", errorMessage);
    return { ok: false, error: errorMessage };
  }
}
