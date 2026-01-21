import { TAB_STATE_PREFIX } from "./constants.js";
import { storageGet, storageSet, storageRemove } from "./storage.js";

export async function getTabState(tabId) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || null;
}

export async function setTabState(tabId, state) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
}

export async function clearTabState(tabId) {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  await storageRemove(chrome.storage.session, key);
}
