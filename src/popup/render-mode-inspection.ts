import type { Config } from "../types/config.ts";
import type {
  PopupState,
  RenderModeInspectionSnapshot
} from "../types/popup-state.ts";
import type { Browser } from "../common/browser";

type BrowserApi = typeof import("../common/browser").browser;

type RenderModeDetectionResult = {
  result: string;
  accuracy: number;
};

type RenderModeDetectionPayload = {
  accuracy?: number | string | null;
  rendered?: boolean;
};

type RenderModeEndpointOptions = {
  endpointValue?: string;
  tokenValue?: string;
  rawHtml?: string;
  renderedHtml?: string;
};

type WaitForTabLoadOptions = {
  awaitNextLoad?: boolean;
};

type TransferPayloadStoreResult = {
  ok: boolean;
  reason?: string;
  payloadKey: string;
};

interface RenderModeDetectionResponse {
  ok?: boolean;
  status?: string;
  httpStatus?: number;
  payload?: RenderModeDetectionPayload;
}

type RenderModeInspectionHtmlResponse = RenderModeInspectionSnapshot & {
  ok?: boolean;
  pageUrl?: string;
};

interface RenderModeInspectionDeps {
  state: PopupState;
  config: {
    getConfigRenderMode(config: Config | null): string;
    normalizeRenderMode(value: unknown): string;
  };
  PopupText: Record<string, Record<string, string>>;
  RENDER_MODE_DETECTION_MAX_ATTEMPTS: number;
  RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY: number;
  RENDER_MODE_INSPECTION_START_TIMEOUT_MS: number;
  RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS: number;
  RENDER_MODE_UNDETERMINED: string;
  windowRef: Window;
  browserRef: BrowserApi;
  messages: {
    sendRuntimeMessage(
      message: { type: string; payloadKey?: string }
    ): Promise<RenderModeDetectionResponse | null>;
    sendTabMessageToTab(
      tabId: number,
      message: { type: string; baseUrl?: string; operationId?: string }
    ): Promise<RenderModeInspectionHtmlResponse | null>;
  };
  shouldAutoDetectRenderMode(config: Config | null): boolean;
  getCurrentRenderModeInspectionSnapshot(
    detectionKey: string
  ): RenderModeInspectionSnapshot | null;
  getSuggestedRenderModeForPage(pageUrl: string | null | undefined): string;
  loadGlobalAiSettings(): Promise<{ tokenValue: string; endpointValue: string }>;
  markRenderModeUndetermined(detectionKey: string): void;
  runWithSpinner<T>(
    spinnerTarget: string | null,
    message: string,
    task: (spinnerKey: string | null) => Promise<T>,
    options?: { delayMs?: number }
  ): Promise<T>;
  buildTransferPayloadKey(label: string): string;
  putTransferPayload(
    kind: string,
    payload: Record<string, unknown>,
    options: { payloadKey?: string }
  ): Promise<TransferPayloadStoreResult>;
  waitForRetryDelay(delayMs?: number): Promise<void>;
  getRetryDelayMs(attempt: number, minDelayMs: number, maxDelayMs: number): number;
  isRetryableHttpStatus(status: unknown): boolean;
  ensureContentReadyForRenderModeInspection(tabId: number): Promise<boolean>;
  hideConsentForRenderModeInspection(tabId: number): Promise<boolean>;
  captureRenderModeInspectionHtml(
    tabId: number,
    baseUrl: string,
    operationId: string
  ): Promise<RenderModeInspectionHtmlResponse | null>;
  rememberRenderModeInspectionSnapshot(
    baseUrl: string,
    pageUrl: string,
    response: RenderModeInspectionHtmlResponse
  ): void;
  reconcilePropertyLockAfterRenderModeReload(): Promise<void>;
  scheduleStaleInspectionBusyClear(
    tabId: number,
    baseUrl: string,
    options: { reconcileRenderModeNavSpinner?: boolean }
  ): void;
}

export function normalizeRenderModeDetectionResult(
  deps: RenderModeInspectionDeps,
  payload: unknown
): RenderModeDetectionResult {
  if (!payload || typeof payload !== "object") {
    return { result: "", accuracy: Number.NaN };
  }
  const payloadRecord = payload as RenderModeDetectionPayload;
  const accuracy = Number(payloadRecord.accuracy);
  if (!Number.isFinite(accuracy)) {
    return { result: "", accuracy: Number.NaN };
  }
  if (accuracy < deps.RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY) {
    return { result: "unsure", accuracy };
  }
  if (typeof payloadRecord.rendered !== "boolean") {
    return { result: "", accuracy: Number.NaN };
  }
  return {
    result: payloadRecord.rendered ? "rendered" : "static",
    accuracy
  };
}

type RenderModeEndpointDetection = {
  ok: boolean;
  result: string;
  accuracy: number;
};

export async function detectRenderModeViaEndpoint(deps: RenderModeInspectionDeps, options: RenderModeEndpointOptions = {}): Promise<RenderModeEndpointDetection> {
  const {
    rawHtml = "",
    renderedHtml = ""
  } = options;
  if (!rawHtml || !renderedHtml) {
    return { ok: false, result: "", accuracy: Number.NaN };
  }
  for (let attempt = 0; attempt < deps.RENDER_MODE_DETECTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const requestPayloadKey = deps.buildTransferPayloadKey("render-mode-request");
      const stored = await deps.putTransferPayload("render-mode-request", {
        rawHtml,
        renderedHtml
      }, {
        payloadKey: requestPayloadKey
      });
      if (!stored.ok) {
        throw new Error("Unable to persist render-mode request payload");
      }
      const response = await deps.messages.sendRuntimeMessage({
        type: "requestRenderModeDetection",
        payloadKey: requestPayloadKey
      });
      if (!response || response.ok !== true) {
        if (attempt + 1 < deps.RENDER_MODE_DETECTION_MAX_ATTEMPTS) {
          await deps.waitForRetryDelay(deps.getRetryDelayMs(attempt, 350, 1800));
          continue;
        }
        return { ok: false, result: "", accuracy: Number.NaN };
      }
      if (response.status === "error") {
        if (
          attempt + 1 < deps.RENDER_MODE_DETECTION_MAX_ATTEMPTS &&
          deps.isRetryableHttpStatus(response.httpStatus)
        ) {
          await deps.waitForRetryDelay(deps.getRetryDelayMs(attempt, 350, 1800));
          continue;
        }
        return { ok: false, result: "", accuracy: Number.NaN };
      }
      const normalizedResult = normalizeRenderModeDetectionResult(deps, response.payload);
      if (!normalizedResult.result) {
        return { ok: false, result: "", accuracy: Number.NaN };
      }
      return { ok: true, ...normalizedResult };
    } catch {
      if (attempt + 1 < deps.RENDER_MODE_DETECTION_MAX_ATTEMPTS) {
        await deps.waitForRetryDelay(deps.getRetryDelayMs(attempt, 350, 1800));
        continue;
      }
      return { ok: false, result: "", accuracy: Number.NaN };
    }
  }
  return { ok: false, result: "", accuracy: Number.NaN };
}

export async function maybeAutoDetectRenderMode(
  deps: RenderModeInspectionDeps,
  pageUrl: string | null | undefined
) {
  const { state } = deps;
  if (
    !pageUrl ||
    !state.currentBaseUrl ||
    !state.currentConfig ||
    !deps.shouldAutoDetectRenderMode(state.currentConfig)
  ) {
    const fallbackRenderMode = state.currentBaseUrlHasConfirmedRenderMode
      ? deps.config.getConfigRenderMode(state.currentConfig)
      : deps.RENDER_MODE_UNDETERMINED;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = fallbackRenderMode;
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    return fallbackRenderMode;
  }

  const detectionKey = `${state.currentBaseUrl}|${pageUrl}`;
  const inspectionSnapshot = deps.getCurrentRenderModeInspectionSnapshot(detectionKey);
  if (!inspectionSnapshot) {
    state.renderModeSuggestedKey = detectionKey;
    state.renderModeSuggestedValue = deps.RENDER_MODE_UNDETERMINED;
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeUndeterminedNoticeKey = "";
    return deps.RENDER_MODE_UNDETERMINED;
  }
  if (state.renderModeDetectionInFlight && state.renderModeDetectionKey === detectionKey) {
    return deps.getSuggestedRenderModeForPage(pageUrl);
  }
  if (!state.renderModeDetectionInFlight && state.renderModeDetectionKey === detectionKey) {
    return deps.getSuggestedRenderModeForPage(pageUrl);
  }

  state.renderModeDetectionInFlight = true;
  state.renderModeDetectionKey = detectionKey;
  state.renderModeSuggestedKey = detectionKey;
  state.renderModeDetectionUnsure = false;
  state.renderModeDetectionAccuracy = Number.NaN;
  state.renderModeUndeterminedNoticeKey = "";
  try {
    const { tokenValue, endpointValue } = await deps.loadGlobalAiSettings();
    if (!inspectionSnapshot.renderedHtml || typeof inspectionSnapshot.rawHtml !== "string") {
      deps.markRenderModeUndetermined(detectionKey);
      return deps.RENDER_MODE_UNDETERMINED;
    }

    const detectionResult = await deps.runWithSpinner(
      null,
      deps.PopupText.overlay.detectingRenderMode,
      () => detectRenderModeViaEndpoint(deps, {
        endpointValue,
        tokenValue,
        rawHtml: inspectionSnapshot.rawHtml,
        renderedHtml: inspectionSnapshot.renderedHtml
      }),
      { delayMs: 0 }
    );
    if (!detectionResult.ok) {
      deps.markRenderModeUndetermined(detectionKey);
      return deps.RENDER_MODE_UNDETERMINED;
    }
    if (detectionResult.result === "unsure") {
      deps.markRenderModeUndetermined(detectionKey);
      return deps.RENDER_MODE_UNDETERMINED;
    }
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = detectionResult.accuracy;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeSuggestedValue = deps.config.normalizeRenderMode(detectionResult.result);
    return state.renderModeSuggestedValue;
  } catch {
    deps.markRenderModeUndetermined(detectionKey);
    return deps.RENDER_MODE_UNDETERMINED;
  } finally {
    state.renderModeDetectionInFlight = false;
  }
}

export async function waitForTabLoadStart(
  deps: RenderModeInspectionDeps,
  tabId: number,
  timeoutMs = deps.RENDER_MODE_INSPECTION_START_TIMEOUT_MS
) {
  if (!tabId) {
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      deps.windowRef.clearTimeout(timeoutId);
      deps.browserRef.tabs.onUpdated.removeListener(onUpdated);
      resolve(value);
    };

    const onUpdated = (updatedTabId: number, changeInfo: Browser.tabs.OnUpdatedInfo) => {
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

    const timeoutId = deps.windowRef.setTimeout(() => {
      finish(false);
    }, timeoutMs);

    deps.browserRef.tabs.onUpdated.addListener(onUpdated);
    deps.browserRef.tabs.get(tabId).then((tab: Browser.tabs.Tab) => {
      if (settled) {
        return;
      }
      if (tab && tab.status === "loading") {
        finish(true);
      }
    }).catch(() => {
      if (!settled) {
        finish(false);
      }
    });
  });
}

export async function waitForTabLoadComplete(
  deps: RenderModeInspectionDeps,
  tabId: number,
  timeoutMs = deps.RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS,
  options: WaitForTabLoadOptions = {}
) {
  if (!tabId) {
    return false;
  }

  const awaitNextLoad = Boolean(options && options.awaitNextLoad);

  return new Promise((resolve) => {
    let settled = false;
    let sawLoading = !awaitNextLoad;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      deps.windowRef.clearTimeout(timeoutId);
      deps.browserRef.tabs.onUpdated.removeListener(onUpdated);
      resolve(value);
    };

    const onUpdated = (updatedTabId: number, changeInfo: Browser.tabs.OnUpdatedInfo) => {
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

    const timeoutId = deps.windowRef.setTimeout(() => {
      finish(false);
    }, timeoutMs);

    deps.browserRef.tabs.onUpdated.addListener(onUpdated);
    deps.browserRef.tabs.get(tabId).then((tab: Browser.tabs.Tab) => {
      if (settled) {
        return;
      }
      if (!awaitNextLoad && tab && tab.status === "complete") {
        finish(true);
      }
    }).catch(() => {
      if (!settled) {
        finish(false);
      }
    });
  });
}

export async function completeRenderModeInspectionReloadFollowUp(deps: RenderModeInspectionDeps, tabId: number, operationId = "") {
  const loadCompleted = await waitForTabLoadComplete(
    deps,
    tabId,
    deps.RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS
  );
  if (!loadCompleted) {
    return false;
  }
  const contentReady = await deps.ensureContentReadyForRenderModeInspection(tabId);
  if (!contentReady) {
    return false;
  }
  await deps.hideConsentForRenderModeInspection(tabId);
  const htmlResponse = await deps.captureRenderModeInspectionHtml(
    tabId,
    deps.state.currentBaseUrl,
    operationId,
  );
  if (!htmlResponse || !htmlResponse.ok) {
    return false;
  }
  deps.rememberRenderModeInspectionSnapshot(
    deps.state.currentBaseUrl,
    htmlResponse.pageUrl || (deps.state.currentTab && deps.state.currentTab.url) || "",
    htmlResponse
  );
  await deps.reconcilePropertyLockAfterRenderModeReload();
  deps.scheduleStaleInspectionBusyClear(tabId, deps.state.currentBaseUrl, {
    reconcileRenderModeNavSpinner: true
  });
  return true;
}
