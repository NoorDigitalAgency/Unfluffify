function defaultSendContentMessageToTab() {
  return Promise.resolve({ ok: false, error: "Content message failed" });
}

function defaultEnsureContentMainForTab() {
  return Promise.resolve({ ok: false });
}

function defaultWaitForBackgroundRetryDelay() {
  return Promise.resolve();
}

function defaultUpdateTabRuntime() {}

function defaultCreateManagedTimeoutGroup() {
  return {
    set(fn, ms) {
      return setTimeout(fn, ms);
    },
    clear(handle) {
      clearTimeout(handle);
    },
    clearAll() {}
  };
}

export function createRenderModeInspector(options = {}) {
  const sendContentMessageToTab = typeof options.sendContentMessageToTab === "function"
    ? options.sendContentMessageToTab
    : defaultSendContentMessageToTab;
  const ensureContentMainForTab = typeof options.ensureContentMainForTab === "function"
    ? options.ensureContentMainForTab
    : defaultEnsureContentMainForTab;
  const waitForBackgroundRetryDelay = typeof options.waitForBackgroundRetryDelay === "function"
    ? options.waitForBackgroundRetryDelay
    : defaultWaitForBackgroundRetryDelay;
  const updateTabRuntime = typeof options.updateTabRuntime === "function"
    ? options.updateTabRuntime
    : defaultUpdateTabRuntime;
  const createManagedTimeoutGroup = typeof options.createManagedTimeoutGroup === "function"
    ? options.createManagedTimeoutGroup
    : defaultCreateManagedTimeoutGroup;
  const startTimeoutMs = Number.isFinite(options.startTimeoutMs) && options.startTimeoutMs > 0
    ? Math.trunc(options.startTimeoutMs)
    : 8000;
  const loadTimeoutMs = Number.isFinite(options.loadTimeoutMs) && options.loadTimeoutMs > 0
    ? Math.trunc(options.loadTimeoutMs)
    : 15000;

  function normalizeRenderModeOperationId(payload, tabId) {
    if (payload && typeof payload.operationId === "string" && payload.operationId) {
      return payload.operationId;
    }
    return `render-mode-inspection:${tabId}:${Date.now()}`;
  }

  async function waitForTabLoadStartInBackground(tabId, timeoutMs = startTimeoutMs) {
    if (!tabId) {
      return false;
    }
    return new Promise((resolve) => {
      const timeoutGroup = createManagedTimeoutGroup();
      let settled = false;
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        timeoutGroup.clear(timeoutId);
        timeoutGroup.clearAll();
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(Boolean(value));
      };
      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId) {
          return;
        }
        if (
          (changeInfo && changeInfo.status === "loading") ||
          (changeInfo && typeof changeInfo.url === "string" && changeInfo.url)
        ) {
          finish(true);
        }
      };
      const timeoutId = timeoutGroup.set(() => {
        finish(false);
      }, timeoutMs);
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tabId)
        .then((tab) => {
          if (tab && tab.status === "loading") {
            finish(true);
          }
        })
        .catch(() => {
          finish(false);
        });
    });
  }

  async function waitForTabLoadCompleteInBackground(
    tabId,
    timeoutMs = loadTimeoutMs,
    options = {}
  ) {
    if (!tabId) {
      return false;
    }
    const awaitNextLoad = Boolean(options && options.awaitNextLoad);
    return new Promise((resolve) => {
      const timeoutGroup = createManagedTimeoutGroup();
      let settled = false;
      let sawLoading = !awaitNextLoad;

      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        timeoutGroup.clear(timeoutId);
        timeoutGroup.clearAll();
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(Boolean(value));
      };

      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId) {
          return;
        }
        if (changeInfo && changeInfo.status === "loading") {
          sawLoading = true;
          return;
        }
        if (changeInfo && changeInfo.status === "complete" && sawLoading) {
          finish(true);
        }
      };

      const timeoutId = timeoutGroup.set(() => {
        finish(false);
      }, timeoutMs);

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tabId)
        .then((tab) => {
          if (!awaitNextLoad && tab && tab.status === "complete") {
            finish(true);
          }
        })
        .catch(() => {
          finish(false);
        });
    });
  }

  async function ensureContentReadyForRenderModeInspectionInBackground(tabId) {
    if (!tabId) {
      return false;
    }
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const bootstrap = await ensureContentMainForTab(tabId);
      if (bootstrap && bootstrap.ok) {
        const status = await sendContentMessageToTab(tabId, {
          type: "getInspectionStatus"
        });
        if (status && status.ok) {
          return true;
        }
      }
      if (attempt + 1 < maxAttempts) {
        await waitForBackgroundRetryDelay(250);
      }
    }
    return false;
  }

  async function sendRenderModeInspectionEndWithRetry(tabId, operationId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await ensureContentMainForTab(tabId).catch(() => ({ ok: false }));
      const response = await sendContentMessageToTab(tabId, {
        type: "renderModeInspectionEnd",
        operationId
      });
      if (response && response.ok) {
        return true;
      }
      if (attempt + 1 < 3) {
        await waitForBackgroundRetryDelay(250);
      }
    }
    return false;
  }

  async function runRenderModeInspectionBeginStep(tabId, operationId) {
    const contentReady = await ensureContentReadyForRenderModeInspectionInBackground(tabId);
    if (!contentReady) {
      return { ok: false, error: "Content activation failed" };
    }
    const beginResponse = await sendContentMessageToTab(tabId, {
      type: "renderModeInspectionBegin",
      operationId
    });
    if (!beginResponse || !beginResponse.ok) {
      return { ok: false, error: (beginResponse && beginResponse.error) || "Unable to begin render mode inspection" };
    }
    updateTabRuntime(tabId, {
      mode: "inspection"
    });
    return { ok: true };
  }

  async function runRenderModeRevealFreezeStep(tabId, baseUrl, operationId) {
    const contentReady = await ensureContentReadyForRenderModeInspectionInBackground(tabId);
    if (!contentReady) {
      return { ok: false, error: "Content activation failed" };
    }
    const response = await sendContentMessageToTab(tabId, {
      type: "runRenderModeRevealOnce",
      baseUrl,
      operationId
    });
    if (!response || !response.ok) {
      return { ok: false, error: (response && response.error) || "Unable to inspect page" };
    }
    return {
      ok: true,
      pageUrl: typeof response.pageUrl === "string" ? response.pageUrl : ""
    };
  }

  async function runRenderModeCaptureHtmlStep(tabId, baseUrl, operationId) {
    const contentReady = await ensureContentReadyForRenderModeInspectionInBackground(tabId);
    if (!contentReady) {
      return { ok: false, error: "Content activation failed" };
    }
    const response = await sendContentMessageToTab(tabId, {
      type: "captureRenderModeInspectionHtml",
      baseUrl,
      operationId
    });
    if (!response || !response.ok) {
      return { ok: false, error: (response && response.error) || "Unable to capture render mode HTML" };
    }
    const hideResponse = await sendContentMessageToTab(tabId, {
      type: "hideConsentForInspection"
    });
    return {
      ok: true,
      pageUrl: typeof response.pageUrl === "string" ? response.pageUrl : "",
      renderedHtml: typeof response.renderedHtml === "string" ? response.renderedHtml : "",
      rawHtml: typeof response.rawHtml === "string" ? response.rawHtml : "",
      renderMode: typeof response.renderMode === "string" ? response.renderMode : "",
      hiddenCount: hideResponse && Number.isFinite(hideResponse.hiddenCount)
        ? Number(hideResponse.hiddenCount)
        : 0
    };
  }

  return {
    normalizeRenderModeOperationId,
    waitForTabLoadStartInBackground,
    waitForTabLoadCompleteInBackground,
    ensureContentReadyForRenderModeInspectionInBackground,
    sendRenderModeInspectionEndWithRetry,
    runRenderModeInspectionBeginStep,
    runRenderModeRevealFreezeStep,
    runRenderModeCaptureHtmlStep
  };
}
