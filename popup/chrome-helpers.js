const CLEAR_BROWSING_DATA_TIMEOUT_MS = 20000;
const RELOAD_TAB_TIMEOUT_MS = 10000;

export function clearBrowsingDataForOrigin(origin) {
  return new Promise((resolve) => {
    if (!origin || typeof origin !== "string") {
      resolve({ ok: false, error: "Missing origin" });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutId = window.setTimeout(() => {
      finish({ ok: false, error: "Timed out while clearing cache" });
    }, CLEAR_BROWSING_DATA_TIMEOUT_MS);
    try {
      chrome.browsingData.remove(
        { origins: [origin] },
        {
          cookies: true,
          cacheStorage: true,
          localStorage: true,
          indexedDB: true,
          serviceWorkers: true
        },
        () => {
          if (chrome.runtime.lastError) {
            finish({
              ok: false,
              error: chrome.runtime.lastError.message || "Unable to clear cache"
            });
            return;
          }
          finish({ ok: true });
        }
      );
    } catch (error) {
      finish({
        ok: false,
        error: (error && error.message) || "Unable to clear cache"
      });
    }
  });
}

export function reloadTab(tabId) {
  return new Promise((resolve) => {
    if (!tabId) {
      resolve({ ok: false, error: "Missing tab" });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutId = window.setTimeout(() => {
      finish({ ok: false, error: "Timed out while reloading tab" });
    }, RELOAD_TAB_TIMEOUT_MS);
    try {
      chrome.tabs.reload(tabId, () => {
        if (chrome.runtime.lastError) {
          finish({
            ok: false,
            error: chrome.runtime.lastError.message || "Unable to reload tab"
          });
          return;
        }
        finish({ ok: true });
      });
    } catch (error) {
      finish({
        ok: false,
        error: (error && error.message) || "Unable to reload tab"
      });
    }
  });
}
