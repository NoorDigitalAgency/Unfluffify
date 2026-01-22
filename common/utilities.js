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

// Tab state utilities
export async function getTabState(tabId) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || null;
}

export async function setTabState(tabId, state) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
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
