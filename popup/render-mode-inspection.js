export function normalizeRenderModeDetectionResult(deps, payload) {
  if (!payload || typeof payload !== "object") {
    return { result: "", accuracy: Number.NaN };
  }
  const accuracy = Number(payload.accuracy);
  if (!Number.isFinite(accuracy)) {
    return { result: "", accuracy: Number.NaN };
  }
  if (accuracy < deps.RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY) {
    return { result: "unsure", accuracy };
  }
  if (typeof payload.rendered !== "boolean") {
    return { result: "", accuracy: Number.NaN };
  }
  return {
    result: payload.rendered ? "rendered" : "static",
    accuracy
  };
}

export async function detectRenderModeViaEndpoint(deps, options = {}) {
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

export async function maybeAutoDetectRenderMode(deps, pageUrl) {
  const { state } = deps;
  if (
    !pageUrl ||
    !state.currentBaseUrl ||
    !state.currentConfig ||
    !deps.shouldAutoDetectRenderMode(state.currentConfig)
  ) {
    const fallbackRenderMode = deps.config.getConfigRenderMode(state.currentConfig);
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

export async function waitForTabLoadStart(deps, tabId, timeoutMs = deps.RENDER_MODE_INSPECTION_START_TIMEOUT_MS) {
  if (!tabId) {
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      deps.windowRef.clearTimeout(timeoutId);
      deps.chromeRef.tabs.onUpdated.removeListener(onUpdated);
      resolve(value);
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

    const timeoutId = deps.windowRef.setTimeout(() => {
      finish(false);
    }, timeoutMs);

    deps.chromeRef.tabs.onUpdated.addListener(onUpdated);
    deps.chromeRef.tabs.get(tabId, (tab) => {
      if (deps.chromeRef.runtime.lastError) {
        finish(false);
        return;
      }
      if (tab && tab.status === "loading") {
        finish(true);
      }
    });
  });
}

export async function waitForTabLoadComplete(
  deps,
  tabId,
  timeoutMs = deps.RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS,
  options = {}
) {
  if (!tabId) {
    return false;
  }

  const awaitNextLoad = Boolean(options && options.awaitNextLoad);

  return new Promise((resolve) => {
    let settled = false;
    let sawLoading = !awaitNextLoad;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      deps.windowRef.clearTimeout(timeoutId);
      deps.chromeRef.tabs.onUpdated.removeListener(onUpdated);
      resolve(value);
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

    const timeoutId = deps.windowRef.setTimeout(() => {
      finish(false);
    }, timeoutMs);

    deps.chromeRef.tabs.onUpdated.addListener(onUpdated);
    deps.chromeRef.tabs.get(tabId, (tab) => {
      if (deps.chromeRef.runtime.lastError) {
        finish(false);
        return;
      }
      if (!awaitNextLoad && tab && tab.status === "complete") {
        finish(true);
      }
    });
  });
}

export async function completeRenderModeInspectionReloadFollowUp(deps, tabId, operationId = "") {
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
  const revealResponse = await deps.messages.sendTabMessageToTab(tabId, {
    type: "runRenderModeRevealOnce",
    baseUrl: deps.state.currentBaseUrl,
    operationId
  });
  if (!revealResponse || !revealResponse.ok) {
    return false;
  }
  const htmlResponse = await deps.messages.sendTabMessageToTab(tabId, {
    type: "captureRenderModeInspectionHtml",
    baseUrl: deps.state.currentBaseUrl,
    operationId
  });
  if (!htmlResponse || !htmlResponse.ok) {
    return false;
  }
  deps.rememberRenderModeInspectionSnapshot(
    deps.state.currentBaseUrl,
    htmlResponse.pageUrl || (deps.state.currentTab && deps.state.currentTab.url) || "",
    htmlResponse
  );
  await deps.hideConsentForRenderModeInspection(tabId);
  await deps.reconcilePropertyLockAfterRenderModeReload();
  deps.scheduleStaleInspectionBusyClear(tabId, deps.state.currentBaseUrl, {
    reconcileRenderModeNavSpinner: true
  });
  return true;
}
