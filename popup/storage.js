export const storageGet = (area, keys) =>
  new Promise((resolve) => area.get(keys, resolve));

export const storageSet = (area, items) =>
  new Promise((resolve) => area.set(items, resolve));

export const tabsQuery = (query) =>
  new Promise((resolve) => chrome.tabs.query(query, resolve));
