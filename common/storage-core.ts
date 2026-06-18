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

export function isChromeStorageArea(value: unknown): value is ChromeStorageAreaLike {
  return Boolean(value) && typeof value === "object";
}

export function getStorageAreaName(area: unknown): string {
  if (!globalThis.chrome || !chrome.storage) {
    return "unknown";
  }
  if (area === chrome.storage.local) {
    return "local";
  }
  if (area === chrome.storage.sync) {
    return "sync";
  }
  if (area === chrome.storage.session) {
    return "session";
  }
  if (area === chrome.storage.managed) {
    return "managed";
  }
  return "unknown";
}

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

export const storageGet = (area: unknown, keys: StorageKeys): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    try {
      assertStorageMethod(area, "get");
      area.get(keys, (result) => {
        let lastError = null;
        try {
          lastError = getChromeRuntimeLastError();
        } catch (error) {
          reject(error);
          return;
        }
        if (lastError) {
          reject(makeChromeRuntimeError(lastError));
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });

export const storageSet = (area: unknown, items: Record<string, unknown>): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      assertStorageMethod(area, "set");
      area.set(items, () => {
        let lastError = null;
        try {
          lastError = getChromeRuntimeLastError();
        } catch (error) {
          reject(error);
          return;
        }
        if (lastError) {
          reject(makeChromeRuntimeError(lastError));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });

export const storageRemove = (area: unknown, keys: StorageKeys): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      assertStorageMethod(area, "remove");
      area.remove(keys, () => {
        let lastError = null;
        try {
          lastError = getChromeRuntimeLastError();
        } catch (error) {
          reject(error);
          return;
        }
        if (lastError) {
          reject(makeChromeRuntimeError(lastError));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });

export const storageClear = (area: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      if (!isChromeStorageArea(area) || typeof area.clear !== "function") {
        resolve();
        return;
      }
      area.clear(() => {
        let lastError = null;
        try {
          lastError = getChromeRuntimeLastError();
        } catch (error) {
          reject(error);
          return;
        }
        if (lastError) {
          reject(makeChromeRuntimeError(lastError));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });

export function addStorageChangeListener(listener: (changes: unknown, areaName: string) => void): boolean {
  if (!globalThis.chrome || !chrome.storage || !chrome.storage.onChanged) {
    return false;
  }
  if (typeof chrome.storage.onChanged.addListener !== "function") {
    return false;
  }
  chrome.storage.onChanged.addListener(listener);
  return true;
}
