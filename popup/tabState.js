import { storageGet, storageSet } from "./storage.js";

export async function getTabState(tabId) {
  const key = `tabState:${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || { enabled: false, baseUrl: "" };
}

export async function setTabState(tabId, state) {
  const key = `tabState:${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
}
