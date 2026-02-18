export function clearBrowsingDataForOrigin(origin) {
  return new Promise((resolve) => {
    chrome.browsingData.remove(
      { origins: [origin] },
      {
        cookies: true,
        cache: true,
        cacheStorage: true,
        localStorage: true
      },
      () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Unable to clear cache"
          });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

export function reloadTab(tabId) {
  return new Promise((resolve) => {
    if (!tabId) {
      resolve({ ok: false, error: "Missing tab" });
      return;
    }
    chrome.tabs.reload(tabId, () => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Unable to reload tab"
        });
        return;
      }
      resolve({ ok: true });
    });
  });
}
