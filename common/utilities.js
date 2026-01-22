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