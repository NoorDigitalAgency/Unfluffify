import { SCRIPT_INJECTED_PREFIX } from "./constants.js";
import { storageGet, storageSet, storageRemove } from "./storage.js";

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
