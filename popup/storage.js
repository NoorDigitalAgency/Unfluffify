export const storageGet = (area, keys) =>
  new Promise((resolve) => area.get(keys, resolve));

export const storageSet = (area, items) =>
  new Promise((resolve) => area.set(items, resolve));

export const tabsQuery = (query) =>
  new Promise((resolve) => chrome.tabs.query(query, resolve));

export async function getTabState(tabId) {
  const key = `tabState:${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || { enabled: false, baseUrl: "" };
}

export async function setTabState(tabId, state) {
  const key = `tabState:${tabId}`;
  await storageSet(chrome.storage.session, { [key]: state });
}
