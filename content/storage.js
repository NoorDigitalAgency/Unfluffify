export const storageGet = (keys) =>
  new Promise((resolve) => chrome.storage.local.get(keys, resolve));

export const storageSet = (items) =>
  new Promise((resolve) => chrome.storage.local.set(items, resolve));
