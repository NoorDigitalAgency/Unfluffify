import { browser } from "../common/browser.js";
import {
  RENDER_MODE_REQUEST_TYPES,
  type RenderModeContentBeginPayload,
  type RenderModeContentBeginReply,
  type RenderModeContentCaptureHtmlPayload,
  type RenderModeContentCaptureHtmlReply,
  type RenderModeContentEndPayload,
  type RenderModeContentHideConsentReply,
} from "../common/bus/contracts/render-mode.js";

type ContentMessageResult = Record<string, unknown>;
type TabUpdatedChangeInfo = { status?: string; url?: string };

type ManagedTimeoutGroup = {
  set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (handle: ReturnType<typeof setTimeout>) => void;
  clearAll: () => void;
};

type RenderModeInspectorOptions = {
  sendContentMessageToTab?: (tabId: number, message: Record<string, unknown>) => Promise<ContentMessageResult>;
  requestContentRenderMode?: <TPayload extends Record<string, unknown>, TReply extends Record<string, unknown>>(
    type: string,
    payload: TPayload,
    tabId: number,
  ) => Promise<TReply>;
  ensureContentMainForTab?: (tabId: number) => Promise<{ ok?: boolean }>;
  waitForBackgroundRetryDelay?: (ms: number) => Promise<void>;
  updateTabRuntime?: (tabId: number, patch: Record<string, unknown>) => void;
  createManagedTimeoutGroup?: () => ManagedTimeoutGroup;
  startTimeoutMs?: number | null;
  loadTimeoutMs?: number | null;
};

function defaultSendContentMessageToTab() {
  return Promise.resolve({ ok: false, error: "Content message failed" });
}

function defaultRequestContentRenderMode() {
  return Promise.reject(new Error("Render-mode content bus unavailable"));
}

function defaultEnsureContentMainForTab() {
  return Promise.resolve({ ok: false });
}

function defaultWaitForBackgroundRetryDelay() {
  return Promise.resolve();
}

function defaultUpdateTabRuntime() {}

function defaultCreateManagedTimeoutGroup(): ManagedTimeoutGroup {
  return {
    set(fn: () => void, ms: number) {
      return setTimeout(fn, ms);
    },
    clear(handle: ReturnType<typeof setTimeout>) {
      clearTimeout(handle);
    },
    clearAll() {}
  };
}

export function createRenderModeInspector(options: RenderModeInspectorOptions = {}) {
  const sendContentMessageToTab = typeof options.sendContentMessageToTab === "function"
    ? options.sendContentMessageToTab
    : defaultSendContentMessageToTab;
  const requestContentRenderMode = typeof options.requestContentRenderMode === "function"
    ? options.requestContentRenderMode
    : defaultRequestContentRenderMode;
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
  const startTimeoutValue = Number(options.startTimeoutMs);
  const startTimeoutMs = Number.isFinite(startTimeoutValue) && startTimeoutValue > 0
    ? Math.trunc(startTimeoutValue)
    : 8000;
  const loadTimeoutValue = Number(options.loadTimeoutMs);
  const loadTimeoutMs = Number.isFinite(loadTimeoutValue) && loadTimeoutValue > 0
    ? Math.trunc(loadTimeoutValue)
    : 15000;

  function normalizeRenderModeOperationId(payload: Record<string, unknown> | null | undefined, tabId: number) {
    if (payload && typeof payload.operationId === "string" && payload.operationId) {
      return payload.operationId;
    }
    return `render-mode-inspection:${tabId}:${Date.now()}`;
  }

  async function waitForTabLoadStartInBackground(tabId: number, timeoutMs = startTimeoutMs) {
    if (!tabId) {
      return false;
    }
    return new Promise((resolve) => {
      const timeoutGroup = createManagedTimeoutGroup();
      let settled = false;
      const finish = (value: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        timeoutGroup.clear(timeoutId);
        timeoutGroup.clearAll();
        browser.tabs.onUpdated.removeListener(onUpdated);
        resolve(Boolean(value));
      };
      const onUpdated = (updatedTabId: number, changeInfo: TabUpdatedChangeInfo) => {
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
      browser.tabs.onUpdated.addListener(onUpdated);
      browser.tabs.get(tabId)
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
    tabId: number,
    timeoutMs = loadTimeoutMs,
    options: { awaitNextLoad?: boolean } = {}
  ) {
    if (!tabId) {
      return false;
    }
    const awaitNextLoad = Boolean(options?.awaitNextLoad);
    return new Promise((resolve) => {
      const timeoutGroup = createManagedTimeoutGroup();
      let settled = false;
      let sawLoading = !awaitNextLoad;

      const finish = (value: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        timeoutGroup.clear(timeoutId);
        timeoutGroup.clearAll();
        browser.tabs.onUpdated.removeListener(onUpdated);
        resolve(Boolean(value));
      };

      const onUpdated = (updatedTabId: number, changeInfo: TabUpdatedChangeInfo) => {
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

      browser.tabs.onUpdated.addListener(onUpdated);
      browser.tabs.get(tabId)
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

  async function ensureContentReadyForRenderModeInspectionInBackground(tabId: number) {
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

  async function requestRenderModeContentStep<TPayload extends Record<string, unknown>, TReply extends ContentMessageResult>(
    type: string,
    payload: TPayload,
    tabId: number,
    fallback: string,
  ): Promise<TReply> {
    try {
      return await requestContentRenderMode<TPayload, TReply>(type, payload, tabId);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error && error.message ? error.message : fallback,
      } as unknown as TReply;
    }
  }

  async function sendRenderModeInspectionEndWithRetry(tabId: number, operationId: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await ensureContentMainForTab(tabId).catch(() => ({ ok: false }));
      const response = await requestRenderModeContentStep<RenderModeContentEndPayload, ContentMessageResult>(
        RENDER_MODE_REQUEST_TYPES.CONTENT_END,
        { operationId },
        tabId,
        "Unable to end render mode inspection",
      );
      if (response && response.ok) {
        return true;
      }
      if (attempt + 1 < 3) {
        await waitForBackgroundRetryDelay(250);
      }
    }
    return false;
  }

  async function runRenderModeInspectionBeginStep(tabId: number, operationId: string) {
    const contentReady = await ensureContentReadyForRenderModeInspectionInBackground(tabId);
    if (!contentReady) {
      return { ok: false, error: "Content activation failed" };
    }
    const beginResponse = await requestRenderModeContentStep<RenderModeContentBeginPayload, RenderModeContentBeginReply>(
      RENDER_MODE_REQUEST_TYPES.CONTENT_BEGIN,
      { operationId },
      tabId,
      "Unable to begin render mode inspection",
    );
    if (!beginResponse || !beginResponse.ok) {
      return { ok: false, error: (beginResponse && beginResponse.error) || "Unable to begin render mode inspection" };
    }
    updateTabRuntime(tabId, {
      mode: "inspection"
    });
    return { ok: true };
  }

  async function runRenderModeRevealFreezeStep(tabId: number, baseUrl: string, operationId: string) {
    const contentReady = await ensureContentReadyForRenderModeInspectionInBackground(tabId);
    if (!contentReady) {
      return { ok: false, error: "Content activation failed" };
    }
    const response = await sendContentMessageToTab(tabId, {
      type: "runRenderModeRevealOnce",
      baseUrl,
      operationId
    });
    const responseRecord = (response || {}) as Record<string, unknown>;
    if (!response || !response.ok) {
      return { ok: false, error: (response && response.error) || "Unable to inspect page" };
    }
    return {
      ok: true,
      pageUrl: typeof responseRecord.pageUrl === "string" ? responseRecord.pageUrl : ""
    };
  }

  // async function runRenderModeHideConsentStep(tabId) {
  async function runRenderModeHideConsentStep(tabId: number) {
    const contentReady = await ensureContentReadyForRenderModeInspectionInBackground(tabId);
    if (!contentReady) {
      return { ok: false, error: "Content activation failed" };
    }
    const response = await requestRenderModeContentStep<Record<string, never>, RenderModeContentHideConsentReply>(
      RENDER_MODE_REQUEST_TYPES.CONTENT_HIDE_CONSENT,
      {},
      tabId,
      "Unable to hide consent form",
    );
    const responseRecord = (response || {}) as Record<string, unknown>;
    if (!response || !response.ok) {
      return { ok: false, error: (response && response.error) || "Unable to hide consent form" };
    }
    return {
      ok: true,
      hiddenCount: Number.isFinite(responseRecord.hiddenCount)
        ? Number(responseRecord.hiddenCount)
        : 0
    };
  }

  // async function runRenderModeCaptureHtmlStep(tabId, baseUrl, operationId) {
  async function runRenderModeCaptureHtmlStep(tabId: number, baseUrl: string, operationId: string) {
    const contentReady = await ensureContentReadyForRenderModeInspectionInBackground(tabId);
    if (!contentReady) {
      return { ok: false, error: "Content activation failed" };
    }
    const response = await requestRenderModeContentStep<RenderModeContentCaptureHtmlPayload, RenderModeContentCaptureHtmlReply>(
      RENDER_MODE_REQUEST_TYPES.CONTENT_CAPTURE_HTML,
      {
        baseUrl,
        operationId,
      },
      tabId,
      "Unable to capture render mode HTML",
    );
    const responseRecord = (response || {}) as Record<string, unknown>;
    if (!response || !response.ok) {
      return { ok: false, error: (response && response.error) || "Unable to capture render mode HTML" };
    }
    return {
      ok: true,
      pageUrl: typeof responseRecord.pageUrl === "string" ? responseRecord.pageUrl : "",
      renderedHtml: typeof responseRecord.renderedHtml === "string" ? responseRecord.renderedHtml : "",
      rawHtml: typeof responseRecord.rawHtml === "string" ? responseRecord.rawHtml : "",
      renderMode: typeof responseRecord.renderMode === "string" ? responseRecord.renderMode : "",
      hiddenCount: Number.isFinite(responseRecord.hiddenCount) ? Number(responseRecord.hiddenCount) : 0,
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
    runRenderModeHideConsentStep,
    runRenderModeCaptureHtmlStep
  };
}
