const EXTENSION_CONTEXT_INVALIDATED_PATTERN = /extension context invalidated|context invalidated/i;

function getErrorMessage(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value.message === "string") {
    return value.message;
  }
  return "";
}

function isExtensionContextInvalidatedError(error) {
  return EXTENSION_CONTEXT_INVALIDATED_PATTERN.test(getErrorMessage(error));
}

function getChromeRuntimeLastError() {
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

function makeChromeRuntimeError(error) {
  return new Error(getErrorMessage(error) || "Chrome runtime operation failed");
}

export function isChromeStorageArea(value) {
  return Boolean(value) &&
    typeof value.get === "function" &&
    typeof value.set === "function" &&
    typeof value.remove === "function";
}

export function getStorageAreaName(area) {
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

function assertStorageMethod(area, methodName) {
  if (!area || typeof area[methodName] !== "function") {
    throw new TypeError("Invalid Chrome storage area");
  }
}

export const storageGet = (area, keys) =>
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

export const storageSet = (area, items) =>
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

export const storageRemove = (area, keys) =>
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

export const storageClear = (area) =>
  new Promise((resolve, reject) => {
    try {
      if (!area || typeof area.clear !== "function") {
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

export function addStorageChangeListener(listener) {
  if (!globalThis.chrome || !chrome.storage || !chrome.storage.onChanged) {
    return false;
  }
  if (typeof chrome.storage.onChanged.addListener !== "function") {
    return false;
  }
  chrome.storage.onChanged.addListener(listener);
  return true;
}
