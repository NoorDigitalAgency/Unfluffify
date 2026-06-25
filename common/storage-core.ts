import { storage, type StorageArea as WxtStorageArea } from "wxt/utils/storage";

const EXTENSION_CONTEXT_INVALIDATED_PATTERN = /extension context invalidated|context invalidated/i;

type StorageKeys = string | string[] | null | Record<string, unknown>;

type ChromeStorageAreaLike = {
  get?: (keys: StorageKeys, callback: (result: Record<string, unknown>) => void) => void;
  set?: (items: Record<string, unknown>, callback: () => void) => void;
  remove?: (keys: StorageKeys, callback: () => void) => void;
  clear?: (callback: () => void) => void;
};

type StorageMethodName = "get" | "set" | "remove" | "clear";
type StorageAreaWithMethod<M extends StorageMethodName> = ChromeStorageAreaLike &
  Required<Pick<ChromeStorageAreaLike, M>>;
type StorageAreaName = WxtStorageArea | "unknown";

type StorageHost = typeof globalThis & {
  browser?: {
    storage?: {
      local?: unknown;
      sync?: unknown;
      session?: unknown;
      managed?: unknown;
      onChanged?: {
        addListener?: (listener: (changes: unknown, areaName: string) => void) => void;
      };
    };
  };
  chrome?: {
    storage?: {
      local?: unknown;
      sync?: unknown;
      session?: unknown;
      managed?: unknown;
      onChanged?: {
        addListener?: (listener: (changes: unknown, areaName: string) => void) => void;
      };
    };
  };
};

function getErrorMessage(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }
  return "";
}

function isExtensionContextInvalidatedError(error: unknown): boolean {
  return EXTENSION_CONTEXT_INVALIDATED_PATTERN.test(getErrorMessage(error));
}

function getChromeRuntimeLastError(): { message?: string } | null {
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

function makeChromeRuntimeError(error: unknown): Error {
  return new Error(getErrorMessage(error) || "Chrome runtime operation failed");
}

function getStorageRoots(): Array<NonNullable<StorageHost["browser"]>["storage"]> {
  const host = globalThis as StorageHost;
  return [host.browser?.storage, host.chrome?.storage].filter(Boolean);
}

function makeStorageItemKey(areaName: WxtStorageArea, key: string): `${WxtStorageArea}:${string}` {
  return `${areaName}:${key}`;
}

function normalizeStorageKeyList(keys: StorageKeys): string[] {
  if (keys == null) {
    return [];
  }
  if (typeof keys === "string") {
    return [keys];
  }
  if (Array.isArray(keys)) {
    return keys.filter((key): key is string => typeof key === "string");
  }
  if (typeof keys === "object") {
    return Object.keys(keys);
  }
  return [];
}

function isNodeLikeRuntime(): boolean {
  const host = globalThis as typeof globalThis & {
    process?: {
      versions?: {
        node?: unknown;
      };
    };
  };
  return Boolean(host.process?.versions?.node);
}

function shouldUseWxtStorage(): boolean {
  return !isNodeLikeRuntime();
}

function isWxtStorageUnavailableError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("'wxt/storage' must be loaded in a web extension environment") ||
    message.includes("You must add the 'storage' permission to your manifest") ||
    message.includes('"browser.storage.') ||
    message.includes("Cannot read properties of undefined")
  );
}

async function storageGetViaWxt(areaName: WxtStorageArea, keys: StorageKeys): Promise<Record<string, unknown>> {
  if (keys === null) {
    return (await storage.snapshot(areaName)) as Record<string, unknown>;
  }

  if (typeof keys === "string") {
    const value = await storage.getItem<unknown>(makeStorageItemKey(areaName, keys));
    return value == null ? {} : { [keys]: value };
  }

  if (Array.isArray(keys)) {
    const results = await storage.getItems(keys.map((key) => makeStorageItemKey(areaName, key)));
    return keys.reduce<Record<string, unknown>>((record, key, index) => {
      const value = results[index]?.value;
      if (value != null) {
        record[key] = value;
      }
      return record;
    }, {});
  }

  const entries = Object.entries(keys);
  const results = await storage.getItems(
    entries.map(([key, fallback]) => ({
      key: makeStorageItemKey(areaName, key),
      options: { fallback }
    }))
  );
  return entries.reduce<Record<string, unknown>>((record, [key], index) => {
    record[key] = results[index]?.value;
    return record;
  }, {});
}

async function storageSetViaWxt(areaName: WxtStorageArea, items: Record<string, unknown>): Promise<void> {
  await storage.setItems(
    Object.entries(items).map(([key, value]) => ({
      key: makeStorageItemKey(areaName, key),
      value
    }))
  );
}

async function storageRemoveViaWxt(areaName: WxtStorageArea, keys: StorageKeys): Promise<void> {
  const keyList = normalizeStorageKeyList(keys);
  if (keyList.length === 0) {
    return;
  }
  await storage.removeItems(keyList.map((key) => makeStorageItemKey(areaName, key)));
}

const storageGetViaArea = (area: unknown, keys: StorageKeys): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    try {
      assertStorageMethod(area, "get");
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        callback();
      };
      const maybePromise: unknown = area.get(keys, (result) => {
        let lastError = null;
        try {
          lastError = getChromeRuntimeLastError();
        } catch (error) {
          finish(() => reject(error));
          return;
        }
        if (lastError) {
          finish(() => reject(makeChromeRuntimeError(lastError)));
          return;
        }
        finish(() => resolve(result));
      });
      if (maybePromise && typeof (maybePromise as PromiseLike<Record<string, unknown>>).then === "function") {
        void (maybePromise as Promise<Record<string, unknown>>).then(
          (result) => finish(() => resolve((result || {}) as Record<string, unknown>)),
          (error) => finish(() => reject(error))
        );
      }
    } catch (error) {
      reject(error);
    }
  });

const storageSetViaArea = (area: unknown, items: Record<string, unknown>): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      assertStorageMethod(area, "set");
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        callback();
      };
      const maybePromise: unknown = area.set(items, () => {
        let lastError = null;
        try {
          lastError = getChromeRuntimeLastError();
        } catch (error) {
          finish(() => reject(error));
          return;
        }
        if (lastError) {
          finish(() => reject(makeChromeRuntimeError(lastError)));
          return;
        }
        finish(resolve);
      });
      if (maybePromise && typeof (maybePromise as PromiseLike<void>).then === "function") {
        void (maybePromise as Promise<void>).then(
          () => finish(resolve),
          (error) => finish(() => reject(error))
        );
      }
    } catch (error) {
      reject(error);
    }
  });

const storageRemoveViaArea = (area: unknown, keys: StorageKeys): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      assertStorageMethod(area, "remove");
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        callback();
      };
      const maybePromise: unknown = area.remove(keys, () => {
        let lastError = null;
        try {
          lastError = getChromeRuntimeLastError();
        } catch (error) {
          finish(() => reject(error));
          return;
        }
        if (lastError) {
          finish(() => reject(makeChromeRuntimeError(lastError)));
          return;
        }
        finish(resolve);
      });
      if (maybePromise && typeof (maybePromise as PromiseLike<void>).then === "function") {
        void (maybePromise as Promise<void>).then(
          () => finish(resolve),
          (error) => finish(() => reject(error))
        );
      }
    } catch (error) {
      reject(error);
    }
  });

const storageClearViaArea = (area: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      if (!isChromeStorageArea(area) || typeof area.clear !== "function") {
        resolve();
        return;
      }
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        callback();
      };
      const maybePromise: unknown = area.clear(() => {
        let lastError = null;
        try {
          lastError = getChromeRuntimeLastError();
        } catch (error) {
          finish(() => reject(error));
          return;
        }
        if (lastError) {
          finish(() => reject(makeChromeRuntimeError(lastError)));
          return;
        }
        finish(resolve);
      });
      if (maybePromise && typeof (maybePromise as PromiseLike<void>).then === "function") {
        void (maybePromise as Promise<void>).then(
          () => finish(resolve),
          (error) => finish(() => reject(error))
        );
      }
    } catch (error) {
      reject(error);
    }
  });

function assertStorageMethod<M extends StorageMethodName>(
  area: unknown,
  methodName: M
): asserts area is StorageAreaWithMethod<M> {
  if (!isChromeStorageArea(area)) {
    throw new TypeError("Invalid Chrome storage area");
  }
  if (methodName !== "clear" && typeof area[methodName] !== "function") {
    throw new TypeError("Invalid Chrome storage area");
  }
}

export function isChromeStorageArea(value: unknown): value is ChromeStorageAreaLike {
  return Boolean(value) && typeof value === "object";
}

export function getStorageAreaName(area: unknown): StorageAreaName {
  const storageRoots = getStorageRoots();
  if (storageRoots.some((root) => area === root?.local)) {
    return "local";
  }
  if (storageRoots.some((root) => area === root?.sync)) {
    return "sync";
  }
  if (storageRoots.some((root) => area === root?.session)) {
    return "session";
  }
  if (storageRoots.some((root) => area === root?.managed)) {
    return "managed";
  }
  return "unknown";
}

export const storageGet = (area: unknown, keys: StorageKeys): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    try {
      const areaName = getStorageAreaName(area);
      if (areaName !== "unknown") {
        const readPromise = shouldUseWxtStorage()
          ? storageGetViaWxt(areaName, keys).catch((error) => {
              if (isWxtStorageUnavailableError(error)) {
                return storageGetViaArea(area, keys);
              }
              throw error;
            })
          : storageGetViaArea(area, keys);
        void readPromise.then(resolve, reject);
        return;
      }
      void storageGetViaArea(area, keys).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });

export const storageSet = (area: unknown, items: Record<string, unknown>): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      const areaName = getStorageAreaName(area);
      if (areaName !== "unknown") {
        const writePromise = shouldUseWxtStorage()
          ? storageSetViaWxt(areaName, items).catch((error) => {
              if (isWxtStorageUnavailableError(error)) {
                return storageSetViaArea(area, items);
              }
              throw error;
            })
          : storageSetViaArea(area, items);
        void writePromise.then(resolve, reject);
        return;
      }
      void storageSetViaArea(area, items).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });

export const storageRemove = (area: unknown, keys: StorageKeys): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      const areaName = getStorageAreaName(area);
      if (areaName !== "unknown") {
        const removePromise = shouldUseWxtStorage()
          ? storageRemoveViaWxt(areaName, keys).catch((error) => {
              if (isWxtStorageUnavailableError(error)) {
                return storageRemoveViaArea(area, keys);
              }
              throw error;
            })
          : storageRemoveViaArea(area, keys);
        void removePromise.then(resolve, reject);
        return;
      }
      void storageRemoveViaArea(area, keys).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });

export const storageClear = (area: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      const areaName = getStorageAreaName(area);
      if (areaName !== "unknown") {
        const clearPromise = shouldUseWxtStorage()
          ? storage.clear(areaName).catch((error) => {
              if (isWxtStorageUnavailableError(error)) {
                return storageClearViaArea(area);
              }
              throw error;
            })
          : storageClearViaArea(area);
        void clearPromise.then(resolve, reject);
        return;
      }
      void storageClearViaArea(area).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });

export function addStorageChangeListener(listener: (changes: unknown, areaName: string) => void): boolean {
  const onChanged = getStorageRoots().find((root) => root?.onChanged)?.onChanged;
  if (!onChanged || typeof onChanged.addListener !== "function") {
    return false;
  }
  onChanged.addListener(listener);
  return true;
}

export function addSyncStorageChangeListener(listener: (changes: unknown) => void): boolean {
  return addStorageChangeListener((changes, areaName) => {
    if (areaName === "sync") {
      listener(changes);
    }
  });
}
