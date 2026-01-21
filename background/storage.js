export const storageGet = (area, keys) =>
  new Promise((resolve) => area.get(keys, resolve));

export const storageSet = (area, items) =>
  new Promise((resolve) => area.set(items, resolve));

export const storageRemove = (area, keys) =>
  new Promise((resolve) => area.remove(keys, resolve));
