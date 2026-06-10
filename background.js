/**
 * @fileoverview Background service worker for the Unfluffify extension.
 * 
 * This service worker manages:
 * - Tab state persistence and retrieval
 * - Device emulation configuration and updates
 * - Content script injection
 * - IndexedDB operations for data storage
 * - Tab lifecycle events and cleanup
 * - Extension action icon updates
 * 
 * Messages handled:
 * - getTabState: Retrieve extension state for a tab
 * - setTabState: Save extension state for a tab
 * - setDeviceEmulation: Enable/disable device emulation for a tab
 * - updateDeviceEmulation: Modify device emulation parameters
 * - getDeviceEmulationState: Get current device emulation state
 * - clearTabState: Clear all state for a tab
 * - unregisterTabAndReload: Disable extension and reload tab
 * - injectContentScript: Inject content script into a tab
 * - isScriptInjected: Check if content script is loaded
 * - idbGet/idbSet/idbRemove: IndexedDB operations
 * - fetchStaticPageHtml: Fetch HTML from external URLs
 */

import * as utils from "./common/utilities.js";
import * as configStore from "./common/config.js";
import { runPageMotionFreezeControl } from "./common/page-motion-freeze-control.js";
import {
  clearDeviceEmulationAfterNavigation,
  ensureDefaultMobileDeviceEmulation,
  getDeviceEmulationState,
  reconcileDeviceEmulationState,
  updateDeviceEmulation
} from "./common/emulation.js";
import {
  FEATURE_DISABLED_REASON,
  isDebugFlagEnabled,
  isFeatureEnabled
} from "./common/feature-flags.js";
import {DEVICE_EMULATION_PREFIX, SCRIPT_INJECTED_PREFIX, TAB_STATE_PREFIX} from "./common/constants.js";
import * as constants from "./common/constants.js";
import { normalizePropertyPageTypes } from "./common/lynx-checklist.js";
import { buildLynxChecklistAssignments } from "./common/lynx-checklist.js";
import {
  PROPERTY_PAGE_TYPES_QUERY,
  URL_SEARCH_INFO_QUERY,
  buildGraphqlEndpointFromStageBase,
  maybeUpdateStoredTokenFromResponse,
  normalizeStageBase,
  normalizeSiteIdValue
} from "./common/lynx-live-pages.js";
import {
  handleRemoteSupportBackgroundMessage,
  handleRemoteSupportTabRemoved,
  initRemoteSupportBackground
} from "./common/remote-support-background.js";
import { installExtensionTelemetry } from "./common/extension-telemetry.js";
import {
  handlePropertyLockBackgroundMessage,
  handlePropertyLockBackgroundTabRemoved,
  initPropertyLockBackground
} from "./common/property-lock-background.js";
import {
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  SPINNER_OWNERS,
  SPINNER_KEYS,
  WORLD_MESSAGE_TYPES,
  WORLD_PORTS,
  isLifecycleTerminalPhase,
  isCurtainBearingLifecycleKind
} from "./common/world-messaging-contract.js";
import {
  AI_RUN_POLL_INTERVAL_MS,
  AI_RUN_PERSIST_KEY,
  AI_RUN_TIMEOUT_MS,
  buildAiSubmissionXpaths,
  getAiRunResumeExpiresAt,
  normalizePersistedAiRunRecord,
  parseAiRunStartResponse,
  parseAiRunStatusResponse
} from "./popup/ai-run.js";
import {
  aiSelectorSetsEqual,
  normalizeAiSelectorSet
} from "./common/selector-set.js";
import {
  appendTabCommandLedger,
  deleteTabRuntime,
  getTabRuntimeSnapshot,
  updateTabRuntime
} from "./background/tab-runtime.js";
import {
  dispatchBackgroundCommand,
  registerBackgroundCommand
} from "./background/command-router.js";
import { createSpinnerOperations } from "./background/spinner-operations.js";
import {
  MESSAGE_ERROR_CODES,
  MESSAGE_SOURCES,
  MESSAGE_TARGETS,
  createFailureEnvelope,
  isRequestEnvelope
} from "./common/message-protocol.js";
import {
  consumeTransferPayload,
  getTransferPayload,
  putTransferPayload,
  removeTransferPayload,
  sweepStaleTransferPayloads
} from "./background/transfer-payload-store.js";

const REMOTE_SUPPORT_MESSAGE_TYPES = new Set([
  "getRemoteSupportState",
  "remoteSupportRequestCode",
  "remoteSupportJoin",
  "remoteSupportEnd",
  "remoteSupportSetDockState",
  "remoteSupportContinueSession",
  "remoteSupportSetLocalMediaEnabled",
  "remoteSupportSetControlOwner",
  "remoteSupportSendCommand",
  "remoteSupportDismissError",
  "remoteSupportExtensionTelemetry",
  "remoteSupportTransportEvent"
]);

function buildFeatureDisabledResponse(featureName) {
  return {
    ok: false,
    reason: FEATURE_DISABLED_REASON,
    feature: featureName,
    error: "Feature disabled"
  };
}

const PROPERTY_LOCK_MESSAGE_TYPES = new Set([
  "getPropertyLockState",
  "propertyLockTakeLock",
  "propertyLockRelease",
  "propertyLockSuggest",
  "propertyLockRespondToSuggestion",
  "propertyLockContinueEditing",
  "propertyLockDraftStatus",
  "pageDraftChanged"
]);

const tabLifecycleStateByTabId = new Map();
const tabSpinnerQueueByTabId = new Map();
const popupStatePortsByTabId = new Map();
const tabWorldTraceStateByTabId = new Map();
const aiComputeLockExpiresAtByTabId = new Map();
const pageMotionFreezeControlQueueByTarget = new Map();
const WORLD_TRACE_EVENT_LIMIT = 160;
const BACKGROUND_COMMANDS = Object.freeze({
  TAB_BOOTSTRAP_CONTENT: "TAB_BOOTSTRAP_CONTENT",
  TAB_CONTENT_REQUEST: "TAB_CONTENT_REQUEST",
  TAB_ACTIVATE_MARKING: "TAB_ACTIVATE_MARKING",
  TAB_DEACTIVATE_MARKING: "TAB_DEACTIVATE_MARKING",
  TAB_APPLY_POST_SAVE_TRANSITION: "TAB_APPLY_POST_SAVE_TRANSITION",
  TAB_APPLY_LOCAL_DISCARD: "TAB_APPLY_LOCAL_DISCARD",
  TAB_SHOW_AI_PREVIEW: "TAB_SHOW_AI_PREVIEW",
  TAB_CLOSE_AI_PREVIEW: "TAB_CLOSE_AI_PREVIEW",
  TAB_SET_AI_PREVIEW_EXPANDED_MODE: "TAB_SET_AI_PREVIEW_EXPANDED_MODE",
  TAB_FOCUS_PREVIEW_ELEMENT: "TAB_FOCUS_PREVIEW_ELEMENT",
  TAB_BEGIN_RENDER_MODE_INSPECTION: "TAB_BEGIN_RENDER_MODE_INSPECTION",
  TAB_RUN_REVEAL_FREEZE: "TAB_RUN_REVEAL_FREEZE",
  TAB_CAPTURE_RENDER_MODE_HTML: "TAB_CAPTURE_RENDER_MODE_HTML",
  TAB_END_RENDER_MODE_INSPECTION: "TAB_END_RENDER_MODE_INSPECTION",
  TAB_RUN_RENDER_MODE_INSPECTION: "TAB_RUN_RENDER_MODE_INSPECTION",
  TAB_RUN_AI: "TAB_RUN_AI",
  POPUP_GET_TAB_VIEW_STATE: "POPUP_GET_TAB_VIEW_STATE"
});
const TAB_SCOPED_BACKGROUND_COMMANDS = new Set([
  BACKGROUND_COMMANDS.TAB_BOOTSTRAP_CONTENT,
  BACKGROUND_COMMANDS.TAB_CONTENT_REQUEST,
  BACKGROUND_COMMANDS.TAB_ACTIVATE_MARKING,
  BACKGROUND_COMMANDS.TAB_DEACTIVATE_MARKING,
  BACKGROUND_COMMANDS.TAB_APPLY_POST_SAVE_TRANSITION,
  BACKGROUND_COMMANDS.TAB_APPLY_LOCAL_DISCARD,
  BACKGROUND_COMMANDS.TAB_SHOW_AI_PREVIEW,
  BACKGROUND_COMMANDS.TAB_CLOSE_AI_PREVIEW,
  BACKGROUND_COMMANDS.TAB_SET_AI_PREVIEW_EXPANDED_MODE,
  BACKGROUND_COMMANDS.TAB_FOCUS_PREVIEW_ELEMENT,
  BACKGROUND_COMMANDS.TAB_BEGIN_RENDER_MODE_INSPECTION,
  BACKGROUND_COMMANDS.TAB_RUN_REVEAL_FREEZE,
  BACKGROUND_COMMANDS.TAB_CAPTURE_RENDER_MODE_HTML,
  BACKGROUND_COMMANDS.TAB_END_RENDER_MODE_INSPECTION,
  BACKGROUND_COMMANDS.TAB_RUN_RENDER_MODE_INSPECTION,
  BACKGROUND_COMMANDS.TAB_RUN_AI,
  BACKGROUND_COMMANDS.POPUP_GET_TAB_VIEW_STATE
]);
const POPUP_TAB_COMMAND_POLICY = Object.freeze({
  allowedSources: [MESSAGE_SOURCES.POPUP],
  tabIdPolicy: "message",
  requireTab: true
});
const RENDER_MODE_INSPECTION_START_TIMEOUT_MS = 8000;
const RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS = 15000;
const UPDATE_SCRAPING_CONDITIONS_MUTATION = `
mutation updateScrapingConditions(
  $domainId: Int!,
  $includeCss: String,
  $excludeCss: String,
  $renderingMode: DomainRenderMode
) {
  updateScrapingConditions(
    domainId: $domainId,
    includeCss: $includeCss,
    excludeCss: $excludeCss,
    renderingMode: $renderingMode
  )
}
`;

function clearBrowsingDataForOrigin(origin) {
  return new Promise((resolve) => {
    if (!origin || typeof origin !== "string") {
      resolve({ ok: false, error: "Missing origin" });
      return;
    }
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
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message || "Unable to clear cache"
            });
            return;
          }
          resolve({ ok: true });
        }
      );
    } catch (error) {
      resolve({
        ok: false,
        error: (error && error.message) || "Unable to clear cache"
      });
    }
  });
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    const normalizedTabId = normalizeBrokerTabId(tabId);
    if (!normalizedTabId) {
      resolve({ ok: false, error: "Missing tab" });
      return;
    }
    try {
      chrome.tabs.reload(normalizedTabId, () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Unable to reload tab"
          });
          return;
        }
        resolve({ ok: true });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: (error && error.message) || "Unable to reload tab"
      });
    }
  });
}

function navigateTabToUrl(tabId, url) {
  return new Promise((resolve) => {
    const normalizedTabId = normalizeBrokerTabId(tabId);
    const targetUrl = typeof url === "string" ? url.trim() : "";
    if (!normalizedTabId || !targetUrl) {
      resolve({ ok: false, error: "Missing tab or URL" });
      return;
    }
    try {
      chrome.tabs.update(normalizedTabId, { url: targetUrl }, () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Unable to navigate tab"
          });
          return;
        }
        resolve({ ok: true });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: (error && error.message) || "Unable to navigate tab"
      });
    }
  });
}

async function getPersistedAiRunRecord() {
  const stored = await utils.storageGet(chrome.storage.session, AI_RUN_PERSIST_KEY);
  return normalizePersistedAiRunRecord(stored && stored[AI_RUN_PERSIST_KEY]);
}

async function savePersistedAiRunRecord(record) {
  const normalized = normalizePersistedAiRunRecord(record);
  if (!normalized) {
    await utils.storageRemove(chrome.storage.session, AI_RUN_PERSIST_KEY);
    return null;
  }
  await utils.storageSet(chrome.storage.session, {
    [AI_RUN_PERSIST_KEY]: normalized
  });
  return normalized;
}

async function clearPersistedAiRunRecord() {
  await utils.storageRemove(chrome.storage.session, AI_RUN_PERSIST_KEY);
}

function sendContentMessageToTab(tabId, message, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const normalizedTabId = normalizeBrokerTabId(tabId);
    if (!normalizedTabId) {
      resolve({ ok: false, error: "Missing tab" });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutId = setTimeout(() => {
      finish({ ok: false, error: "Content message timed out" });
    }, Math.max(1, Number(timeoutMs) || 15000));
    try {
      chrome.tabs.sendMessage(normalizedTabId, message, { frameId: 0 }, (response) => {
        if (chrome.runtime.lastError) {
          finish({
            ok: false,
            error: chrome.runtime.lastError.message || "Content message failed"
          });
          return;
        }
        finish(response && typeof response === "object" ? response : { ok: false });
      });
    } catch (error) {
      finish({
        ok: false,
        error: (error && error.message) || "Content message failed"
      });
    }
  });
}

function waitForBackgroundRetryDelay(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function ensureContentMainForTab(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return { ok: false, error: "Missing tab" };
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await sendContentMessageToTab(normalizedTabId, {
      type: "activateContentMain"
    });
    if (response && response.ok) {
      return { ok: true, tabId: normalizedTabId };
    }
    if (attempt < 4) {
      await waitForBackgroundRetryDelay(150 * (attempt + 1));
    }
  }
  return { ok: false, tabId: normalizedTabId, error: "Content activation failed" };
}

function createBackgroundCommandError(code, message, details = {}) {
  const error = new Error(message || "Background command failed");
  error.code = typeof code === "string" && code ? code : MESSAGE_ERROR_CODES.HANDLER_FAILED;
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function normalizeActivationBaseUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  return utils.normalizeCanonicalBaseUrl(value) || utils.normalizeBaseUrl(value) || value.trim();
}

function normalizeRenderModeOperationId(payload, tabId) {
  if (payload && typeof payload.operationId === "string" && payload.operationId) {
    return payload.operationId;
  }
  return `render-mode-inspection:${tabId}:${Date.now()}`;
}

async function waitForTabLoadStartInBackground(tabId, timeoutMs = RENDER_MODE_INSPECTION_START_TIMEOUT_MS) {
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
      clearTimeout(timeoutId);
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
    const timeoutId = setTimeout(() => {
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
  timeoutMs = RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS,
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
      clearTimeout(timeoutId);
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

    const timeoutId = setTimeout(() => {
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

function getAiRunCurrentPageEntry(currentConfig, currentPageUrl) {
  if (!currentConfig || typeof currentConfig !== "object") {
    return null;
  }
  const pageMarkings = currentConfig.pageMarkings;
  if (!pageMarkings || typeof pageMarkings !== "object") {
    return null;
  }
  const entry = pageMarkings[currentPageUrl];
  return entry && typeof entry === "object" ? entry : null;
}

function isAiRunCurrentPageSnapshotMissing(currentConfig, currentPageUrl) {
  const entry = getAiRunCurrentPageEntry(currentConfig, currentPageUrl);
  if (!entry) {
    return true;
  }
  if (typeof entry.renderedHtml !== "string" || !entry.renderedHtml) {
    return true;
  }
  if (!Array.isArray(entry.submissionXpaths) || entry.submissionXpaths.length === 0) {
    return true;
  }
  return false;
}

async function refineAiRunPayloadXpathsInBackground(payloadKey) {
  const sourcePayloadKey = typeof payloadKey === "string" ? payloadKey.trim() : "";
  if (!sourcePayloadKey) {
    return { ok: false, error: "Missing AI run payload" };
  }
  const loaded = await getTransferPayload(sourcePayloadKey, {
    expectedType: "object",
    removeInvalid: true
  });
  const payload = loaded && loaded.ok ? loaded.payload : null;
  if (!payload || !Array.isArray(payload.pages)) {
    await removeTransferPayload(sourcePayloadKey);
    return { ok: false, error: "Unable to prepare AI payload" };
  }
  const refinedPayload = {
    ...payload,
    pages: payload.pages.map((page) => {
      const renderedHtml = page && typeof page.renderedHtml === "string" ? page.renderedHtml : "";
      const rawHtml = page && typeof page.rawHtml === "string" ? page.rawHtml : "";
      const renderedXPaths = Array.isArray(page && page.renderedXPaths) ? page.renderedXPaths : [];
      return {
        ...page,
        rawXPaths: refineXPathEntries(renderedHtml, rawHtml, renderedXPaths)
      };
    })
  };
  const stored = await putTransferPayload("ai-run-start-refined", refinedPayload);
  if (!stored.ok) {
    await removeTransferPayload(sourcePayloadKey);
    return { ok: false, error: "Unable to prepare AI payload" };
  }
  await removeTransferPayload(sourcePayloadKey);
  return {
    ok: true,
    payloadKey: stored.payloadKey
  };
}

async function loadAiRunSelectorSetFromPayloadKey(payloadKey) {
  const resultPayloadKey = typeof payloadKey === "string" ? payloadKey.trim() : "";
  if (!resultPayloadKey) {
    return null;
  }
  const loaded = await consumeTransferPayload(resultPayloadKey, { expectedType: "object" });
  const payload = loaded && loaded.ok ? loaded.payload : null;
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray(payload.exclusionSelectors) ||
    !Array.isArray(payload.inclusionSelectors)
  ) {
    return null;
  }
  return normalizeAiSelectorSet(payload);
}

async function runAiCommandForTab(tabId, payload, update) {
  const baseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
  const currentPageUrl = typeof payload?.currentPageUrl === "string"
    ? payload.currentPageUrl.trim()
    : "";
  const pageType = typeof payload?.pageType === "string" ? payload.pageType : "";
  const currentRenderMode = typeof payload?.currentRenderMode === "string"
    ? payload.currentRenderMode.trim()
    : "";
  const endpointValue = typeof payload?.endpointValue === "string"
    ? payload.endpointValue.trim()
    : "";
  const tokenValue = typeof payload?.tokenValue === "string" ? payload.tokenValue : "";
  const requestedSiteId = normalizeSiteIdValue(payload && payload.siteId);
  const requestedDeadlineAt = Number(payload && payload.deadlineAt);
  const deadlineAt = Number.isFinite(requestedDeadlineAt) && requestedDeadlineAt > Date.now()
    ? requestedDeadlineAt
    : Date.now() + AI_RUN_TIMEOUT_MS;

  if (!baseUrl || !currentPageUrl || !endpointValue || !tokenValue) {
    return {
      ok: false,
      reason: "invalid_request",
      error: "Missing AI run parameters"
    };
  }

  let initialLockSet = false;
  try {
    const initialLock = await setAiComputeLockForTab(
      tabId,
      true,
      getAiRunResumeExpiresAt(),
      baseUrl
    );
    if (!initialLock || !initialLock.ok) {
      return {
        ok: false,
        reason: "compute_lock_failed",
        error: (initialLock && initialLock.error) || "AI compute lock failed"
      };
    }
    initialLockSet = true;

    await update({
      message: "Computing selectors...",
      reason: "tab-run-ai-snapshot",
      source: "background-command-router"
    });

    let currentConfig = await configStore.ensureConfig(baseUrl);
    const needsSnapshot = isAiRunCurrentPageSnapshotMissing(currentConfig, currentPageUrl);
    if (needsSnapshot) {
      const snapshotResponse = await sendContentMessageToTab(tabId, {
        type: "capturePageSnapshot",
        baseUrl,
        pageType,
        persist: true
      });
      if (!snapshotResponse || !snapshotResponse.ok) {
        return {
          ok: false,
          reason: "snapshot_capture_failed",
          error: (snapshotResponse && snapshotResponse.error) || "Unable to capture page snapshot",
          reconciliationPending: Boolean(snapshotResponse && snapshotResponse.reconciliationPending),
          locked: Boolean(snapshotResponse && snapshotResponse.locked)
        };
      }
      currentConfig = await configStore.ensureConfig(baseUrl);
      if (isAiRunCurrentPageSnapshotMissing(currentConfig, currentPageUrl)) {
        return {
          ok: false,
          reason: "missing_current_page",
          error: "Current page snapshot is unavailable"
        };
      }
    }

    await update({
      message: "Computing selectors...",
      reason: "tab-run-ai-prepare",
      source: "background-command-router"
    });

    const preparedPayload = await prepareAiRunPayloadSnapshot({
      baseUrl,
      currentPageUrl,
      currentRenderMode
    });
    if (!preparedPayload || preparedPayload.ok !== true || !preparedPayload.payloadKey) {
      return {
        ok: false,
        reason: (preparedPayload && preparedPayload.reason) || "prepare_failed",
        error: "Unable to prepare AI payload"
      };
    }

    let startPayloadKey = preparedPayload.payloadKey;
    if (preparedPayload.requiresRawXPathRefinement) {
      const refined = await refineAiRunPayloadXpathsInBackground(startPayloadKey);
      if (!refined || !refined.ok || !refined.payloadKey) {
        return {
          ok: false,
          reason: "refine_failed",
          error: (refined && refined.error) || "Unable to prepare AI payload"
        };
      }
      startPayloadKey = refined.payloadKey;
    }

    const startResult = await requestAiRunStartSnapshot({
      endpointValue,
      tokenValue,
      payloadKey: startPayloadKey
    });
    if (!startResult || !startResult.ok || !startResult.sessionId) {
      return {
        ok: false,
        reason: "start_failed",
        error: "Unable to start AI run"
      };
    }

    const sessionId = String(startResult.sessionId || "").trim();
    if (!sessionId) {
      return {
        ok: false,
        reason: "start_failed",
        error: "Unable to start AI run"
      };
    }

    const siteId = requestedSiteId || normalizeSiteIdValue(currentConfig && currentConfig.siteId);

    while (Date.now() < deadlineAt) {
      const remainingMs = Math.max(0, deadlineAt - Date.now());
      await waitForBackgroundRetryDelay(Math.min(AI_RUN_POLL_INTERVAL_MS, remainingMs || AI_RUN_POLL_INTERVAL_MS));
      if (siteId) {
        const heartbeat = await refreshAiRunHeartbeat({
          tabId,
          sessionId,
          siteId,
          deadlineAt,
          baseUrl
        }).catch(() => null);
        if (!heartbeat || !heartbeat.ok) {
          return {
            ok: false,
            reason: "heartbeat_failed",
            error: (heartbeat && heartbeat.error) || "AI run heartbeat failed"
          };
        }
      }

      let statusResult = null;
      try {
        statusResult = await requestAiRunStatus({
          endpointValue,
          tokenValue,
          sessionId
        });
      } catch {
        statusResult = { ok: false };
      }
      if (!statusResult || statusResult.notFound) {
        return {
          ok: false,
          reason: "not_found",
          error: "AI run no longer exists"
        };
      }
      if (!statusResult.ok) {
        return {
          ok: false,
          reason: "status_failed",
          error: "Unable to read AI run status"
        };
      }
      if (statusResult.status === "running") {
        continue;
      }
      if (statusResult.status === "error") {
        return {
          ok: false,
          reason: "run_error",
          error: "AI run failed"
        };
      }

      const resultSnapshot = await requestAiRunResultSnapshot({
        endpointValue,
        tokenValue,
        sessionId
      });
      if (!resultSnapshot || resultSnapshot.notFound) {
        return {
          ok: false,
          reason: "not_found",
          error: "AI run no longer exists"
        };
      }
      if (!resultSnapshot.ok || !resultSnapshot.payloadKey) {
        return {
          ok: false,
          reason: "result_failed",
          error: "Unable to fetch AI run result"
        };
      }

      const selectorSet = await loadAiRunSelectorSetFromPayloadKey(resultSnapshot.payloadKey);
      if (!selectorSet) {
        return {
          ok: false,
          reason: "result_invalid",
          error: "AI run result is invalid"
        };
      }

      return {
        ok: true,
        sessionId,
        selectorSet,
        siteId,
        deadlineAt
      };
    }

    return {
      ok: false,
      reason: "timed_out",
      error: "AI run timed out"
    };
  } finally {
    await clearPersistedAiRunRecord().catch(() => null);
    if (initialLockSet) {
      await setAiComputeLockForTab(tabId, false, 0, baseUrl).catch(() => null);
    }
  }
}

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_BOOTSTRAP_CONTENT, async (context) => {
  const result = await ensureContentMainForTab(context.tabId);
  updateTabRuntime(context.tabId, {
    contentReady: Boolean(result && result.ok)
  });
  return {
    ...result,
    runtime: getTabRuntimeSnapshot(context.tabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_CONTENT_REQUEST, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for content command"
    );
  }

  const message = payload && payload.message && typeof payload.message === "object"
    ? payload.message
    : null;
  if (!message) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      "Missing content message payload",
      { tabId: normalizedTabId }
    );
  }

  const timeoutMs = Number(payload && payload.timeoutMs);
  const response = await sendContentMessageToTab(
    normalizedTabId,
    message,
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.trunc(timeoutMs) : 3000
  );
  if (!response) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      "Unable to reach content script",
      { tabId: normalizedTabId, type: message.type || "" }
    );
  }

  return {
    ok: true,
    tabId: normalizedTabId,
    response,
    runtime: getTabRuntimeSnapshot(normalizedTabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.POPUP_GET_TAB_VIEW_STATE, async (context) => {
  appendWorldTraceEvent(context.tabId, "broker", "snapshot-requested", {
    type: BACKGROUND_COMMANDS.POPUP_GET_TAB_VIEW_STATE,
    message: "Popup requested background state"
  });
  return {
    state: buildBrokerState(context.tabId),
    runtime: getTabRuntimeSnapshot(context.tabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_ACTIVATE_MARKING, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for activation command"
    );
  }

  let tab = null;
  try {
    tab = await chrome.tabs.get(normalizedTabId);
  } catch {
    tab = null;
  }
  if (!tab || !tab.id) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Target tab is unavailable",
      { tabId: normalizedTabId }
    );
  }

  const baseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
  const pageType = typeof payload?.pageType === "string" ? payload.pageType : "";
  const tabUrl = typeof tab.url === "string" ? tab.url : "";

  if (!baseUrl) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      "Missing base URL for activation",
      { tabId: normalizedTabId }
    );
  }
  if (!utils.isPageWithinBaseUrl(tabUrl, baseUrl)) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Active tab URL is outside selected base URL",
      {
        tabId: normalizedTabId,
        baseUrl,
        tabUrl
      }
    );
  }
  if (Boolean(payload && payload.desktopPreviewEnabled)) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.FEATURE_DISABLED,
      "Disable desktop preview before enabling marking",
      { tabId: normalizedTabId, desktopPreviewEnabled: true }
    );
  }

  const operationId = typeof payload?.operationId === "string" && payload.operationId
    ? payload.operationId
    : `activation:${normalizedTabId}:${Date.now()}`;

  return withBackgroundTabSpinner(
    normalizedTabId,
    {
      key: `activate-marking:${normalizedTabId}`,
      message: "Inspecting page...",
      owner: SPINNER_OWNERS.POPUP,
      reason: "tab-activate-marking",
      source: "background-command-router",
      persistent: false
    },
    async ({ update }) => {
      await update({
        message: "Applying device emulation...",
        reason: "tab-activate-marking-device",
        source: "background-command-router"
      });

      const mobileState = await ensureDefaultMobileEmulationForTab(normalizedTabId, tabUrl);
      if (!mobileState) {
        throw createBackgroundCommandError(
          MESSAGE_ERROR_CODES.HANDLER_FAILED,
          "Unable to prepare mobile simulation",
          { tabId: normalizedTabId }
        );
      }

      await update({
        message: "Inspecting page...",
        reason: "tab-activate-marking-content",
        source: "background-command-router"
      });

      const bootstrap = await ensureContentMainForTab(normalizedTabId);
      if (!bootstrap || !bootstrap.ok) {
        throw createBackgroundCommandError(
          MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
          (bootstrap && bootstrap.error) || "Content activation failed",
          { tabId: normalizedTabId }
        );
      }

      await utils.setTabState(normalizedTabId, {
        enabled: true,
        baseUrl,
        pageType
      });
      updateTabRuntime(normalizedTabId, {
        contentReady: true,
        mode: "marking"
      });

      updateLifecycleState(normalizedTabId, {
        operationId,
        kind: LIFECYCLE_KINDS.ACTIVATION,
        phase: LIFECYCLE_PHASES.STARTED,
        busy: true,
        message: "Inspecting page..."
      });

      const enableResponse = await sendContentMessageToTab(normalizedTabId, {
        type: "setEnabled",
        enabled: true,
        baseUrl,
        pageType,
        performInitialReveal: true,
        operationId
      });

      if (!enableResponse || !enableResponse.ok) {
        await utils.setTabState(normalizedTabId, {
          enabled: false,
          baseUrl,
          pageType: ""
        });
        updateTabRuntime(normalizedTabId, {
          mode: "silent"
        });
        updateLifecycleState(normalizedTabId, {
          operationId,
          kind: LIFECYCLE_KINDS.ACTIVATION,
          phase: LIFECYCLE_PHASES.FAILED,
          busy: false,
          message: ""
        });
        if (enableResponse && enableResponse.locked) {
          return context.replyFail(
            MESSAGE_ERROR_CODES.FEATURE_DISABLED,
            "Editing is currently locked",
            {
              locked: true,
              tabId: normalizedTabId
            }
          );
        }
        throw createBackgroundCommandError(
          MESSAGE_ERROR_CODES.HANDLER_FAILED,
          (enableResponse && enableResponse.error) || "Unable to activate marking",
          { tabId: normalizedTabId }
        );
      }

      updateLifecycleState(normalizedTabId, {
        operationId,
        kind: LIFECYCLE_KINDS.ACTIVATION,
        phase: LIFECYCLE_PHASES.FINISHED,
        busy: false,
        message: ""
      });

      return {
        ok: true,
        tabId: normalizedTabId,
        baseUrl,
        pageType,
        runtime: getTabRuntimeSnapshot(normalizedTabId),
        state: await utils.getTabState(normalizedTabId)
      };
    }
  );
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_DEACTIVATE_MARKING, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for deactivation command"
    );
  }

  let tab = null;
  try {
    tab = await chrome.tabs.get(normalizedTabId);
  } catch {
    tab = null;
  }
  if (!tab || !tab.id) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Target tab is unavailable",
      { tabId: normalizedTabId }
    );
  }

  const requestedBaseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
  const operationId = typeof payload?.operationId === "string" && payload.operationId
    ? payload.operationId
    : `deactivation:${normalizedTabId}:${Date.now()}`;

  return withBackgroundTabSpinner(
    normalizedTabId,
    {
      key: `deactivate-marking:${normalizedTabId}`,
      message: "Disabling marking...",
      owner: SPINNER_OWNERS.POPUP,
      reason: "tab-deactivate-marking",
      source: "background-command-router",
      persistent: false
    },
    async ({ update }) => {
      await update({
        message: "Disabling marking...",
        reason: "tab-deactivate-marking-content",
        source: "background-command-router"
      });

      updateLifecycleState(normalizedTabId, {
        operationId,
        kind: LIFECYCLE_KINDS.MODE,
        phase: LIFECYCLE_PHASES.STARTED,
        busy: true,
        message: "Disabling marking..."
      });

      const existingState = await utils.getTabState(normalizedTabId);
      const existingBaseUrl = existingState && typeof existingState.baseUrl === "string"
        ? existingState.baseUrl
        : "";
      const baseUrl = requestedBaseUrl || existingBaseUrl;

      await utils.setTabState(normalizedTabId, {
        enabled: false,
        baseUrl,
        pageType: ""
      });
      updateTabRuntime(normalizedTabId, {
        mode: "silent"
      });

      const disableResponse = await sendContentMessageToTab(normalizedTabId, {
        type: "setEnabled",
        enabled: false,
        pageType: "",
        operationId
      });

      updateLifecycleState(normalizedTabId, {
        operationId,
        kind: LIFECYCLE_KINDS.MODE,
        phase: LIFECYCLE_PHASES.FINISHED,
        busy: false,
        message: ""
      });

      return {
        ok: true,
        tabId: normalizedTabId,
        baseUrl,
        pageType: "",
        contentAcknowledged: Boolean(disableResponse && disableResponse.ok),
        runtime: getTabRuntimeSnapshot(normalizedTabId),
        state: await utils.getTabState(normalizedTabId)
      };
    }
  );
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_APPLY_POST_SAVE_TRANSITION, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for save transition"
    );
  }

  const baseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
  const contentReady = await ensureContentMainForTab(normalizedTabId);
  if (!contentReady || !contentReady.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      (contentReady && contentReady.error) || "Content activation failed",
      { tabId: normalizedTabId }
    );
  }

  const configUpdatedResponse = baseUrl
    ? await sendContentMessageToTab(normalizedTabId, {
      type: "configUpdated",
      baseUrl,
      forceReloadPageEntry: true
    })
    : null;
  const disableResponse = await sendContentMessageToTab(normalizedTabId, {
    type: "setEnabled",
    enabled: false,
    pageType: ""
  });

  const existingState = await utils.getTabState(normalizedTabId);
  const existingBaseUrl = existingState && typeof existingState.baseUrl === "string"
    ? existingState.baseUrl
    : "";
  await utils.setTabState(normalizedTabId, {
    ...(existingState && typeof existingState === "object" ? existingState : {}),
    enabled: false,
    baseUrl: baseUrl || existingBaseUrl,
    pageType: ""
  });
  updateTabRuntime(normalizedTabId, {
    contentReady: true,
    mode: "silent"
  });

  return {
    ok: true,
    tabId: normalizedTabId,
    configUpdatedAcknowledged: Boolean(configUpdatedResponse && configUpdatedResponse.ok),
    contentAcknowledged: Boolean(disableResponse && disableResponse.ok),
    runtime: getTabRuntimeSnapshot(normalizedTabId),
    state: await utils.getTabState(normalizedTabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_APPLY_LOCAL_DISCARD, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for discard command"
    );
  }

  const baseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
  const contentReady = await ensureContentMainForTab(normalizedTabId);
  if (!contentReady || !contentReady.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      (contentReady && contentReady.error) || "Content activation failed",
      { tabId: normalizedTabId }
    );
  }

  const response = baseUrl
    ? await sendContentMessageToTab(normalizedTabId, {
      type: "configUpdated",
      baseUrl,
      forceReloadPageEntry: true
    })
    : null;

  return {
    ok: true,
    tabId: normalizedTabId,
    contentAcknowledged: Boolean(response && response.ok),
    runtime: getTabRuntimeSnapshot(normalizedTabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_SHOW_AI_PREVIEW, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for preview command"
    );
  }

  const contentReady = await ensureContentMainForTab(normalizedTabId);
  if (!contentReady || !contentReady.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      (contentReady && contentReady.error) || "Content activation failed",
      { tabId: normalizedTabId }
    );
  }

  const selectorSet = normalizeAiSelectorSet(payload && payload.selectorSet);
  const response = await sendContentMessageToTab(normalizedTabId, {
    type: "showAiPreview",
    selectorSet
  });
  if (!response || !response.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      (response && response.error) || "Unable to open preview",
      { tabId: normalizedTabId }
    );
  }

  return {
    ok: true,
    tabId: normalizedTabId,
    previewState: response,
    runtime: getTabRuntimeSnapshot(normalizedTabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_CLOSE_AI_PREVIEW, async (context) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for preview close command"
    );
  }

  const response = await sendContentMessageToTab(normalizedTabId, { type: "closeAiPreview" });
  if (!response || !response.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      (response && response.error) || "Unable to close preview",
      { tabId: normalizedTabId }
    );
  }

  return {
    ok: true,
    tabId: normalizedTabId,
    previewState: response,
    runtime: getTabRuntimeSnapshot(normalizedTabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_SET_AI_PREVIEW_EXPANDED_MODE, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for preview expansion command"
    );
  }

  const response = await sendContentMessageToTab(normalizedTabId, {
    type: "setAiPreviewExpandedMode",
    active: Boolean(payload && payload.active)
  });
  if (!response || !response.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      (response && response.error) || "Unable to update preview mode",
      { tabId: normalizedTabId }
    );
  }

  return {
    ok: true,
    tabId: normalizedTabId,
    previewState: response,
    runtime: getTabRuntimeSnapshot(normalizedTabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_FOCUS_PREVIEW_ELEMENT, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for preview focus command"
    );
  }

  const xpath = typeof payload?.xpath === "string" ? payload.xpath.trim() : "";
  if (!xpath) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      "Missing xpath for preview focus command",
      { tabId: normalizedTabId }
    );
  }

  const response = await sendContentMessageToTab(normalizedTabId, {
    type: "focusElement",
    xpath
  });
  if (!response || !response.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      (response && response.error) || "Unable to focus element",
      { tabId: normalizedTabId }
    );
  }

  return {
    ok: true,
    tabId: normalizedTabId,
    runtime: getTabRuntimeSnapshot(normalizedTabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_BEGIN_RENDER_MODE_INSPECTION, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for render mode inspection"
    );
  }
  const operationId = normalizeRenderModeOperationId(payload, normalizedTabId);
  const beginResult = await runRenderModeInspectionBeginStep(normalizedTabId, operationId);
  if (!beginResult.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      beginResult.error || "Unable to begin render mode inspection",
      { tabId: normalizedTabId }
    );
  }
  return {
    ok: true,
    tabId: normalizedTabId,
    operationId,
    runtime: getTabRuntimeSnapshot(normalizedTabId)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_RUN_REVEAL_FREEZE, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for render mode reveal"
    );
  }
  const baseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
  if (!baseUrl) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      "Missing base URL for render mode reveal",
      { tabId: normalizedTabId }
    );
  }
  const operationId = normalizeRenderModeOperationId(payload, normalizedTabId);
  const revealResult = await runRenderModeRevealFreezeStep(normalizedTabId, baseUrl, operationId);
  if (!revealResult.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      revealResult.error || "Unable to inspect page",
      { tabId: normalizedTabId }
    );
  }
  return {
    ok: true,
    tabId: normalizedTabId,
    operationId,
    pageUrl: revealResult.pageUrl || ""
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_CAPTURE_RENDER_MODE_HTML, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for render mode capture"
    );
  }
  const baseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
  const operationId = normalizeRenderModeOperationId(payload, normalizedTabId);
  const captureResult = await runRenderModeCaptureHtmlStep(normalizedTabId, baseUrl, operationId);
  if (!captureResult.ok) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      captureResult.error || "Unable to capture render mode HTML",
      { tabId: normalizedTabId }
    );
  }
  return {
    ok: true,
    tabId: normalizedTabId,
    operationId,
    pageUrl: captureResult.pageUrl || "",
    renderedHtml: captureResult.renderedHtml || "",
    rawHtml: captureResult.rawHtml || "",
    renderMode: captureResult.renderMode || "",
    hiddenCount: Number(captureResult.hiddenCount || 0)
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_END_RENDER_MODE_INSPECTION, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for render mode inspection end"
    );
  }
  const operationId = normalizeRenderModeOperationId(payload, normalizedTabId);
  const endAcknowledged = await sendRenderModeInspectionEndWithRetry(normalizedTabId, operationId);
  if (!endAcknowledged) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      "Unable to end render mode inspection",
      { tabId: normalizedTabId }
    );
  }
  const tabState = await utils.getTabState(normalizedTabId);
  updateTabRuntime(normalizedTabId, {
    mode: tabState && tabState.enabled ? "marking" : "silent"
  });
  return {
    ok: true,
    tabId: normalizedTabId,
    operationId,
    endAcknowledged,
    runtime: getTabRuntimeSnapshot(normalizedTabId),
    state: tabState
  };
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_RUN_RENDER_MODE_INSPECTION, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for render mode inspection"
    );
  }
  const baseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
  if (!baseUrl) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      "Missing base URL for render mode inspection",
      { tabId: normalizedTabId }
    );
  }
  const operationId = normalizeRenderModeOperationId(payload, normalizedTabId);
  const javaScriptDisabled = Boolean(payload && payload.javaScriptDisabled);

  return withBackgroundTabSpinner(
    normalizedTabId,
    {
      key: `render-mode-inspection:${normalizedTabId}`,
      message: "Inspecting page...",
      owner: SPINNER_OWNERS.POPUP,
      reason: "tab-render-mode-inspection",
      source: "background-command-router",
      persistent: false
    },
    async ({ update }) => {
      let commandResult = {
        ok: false,
        tabId: normalizedTabId,
        operationId,
        loadStarted: false,
        reloadResult: {
          ok: false,
          error: "Unable to reload page for render mode inspection"
        },
        followUpCompleted: false,
        followUpError: "Unable to inspect page",
        inspectionSnapshot: null,
        endAcknowledged: false
      };

      try {
        const beginResult = await runRenderModeInspectionBeginStep(normalizedTabId, operationId);
        if (!beginResult.ok) {
          commandResult.followUpError = beginResult.error || "Unable to begin render mode inspection";
          return commandResult;
        }

        await update({
          message: "Inspecting page...",
          reason: "tab-render-mode-reload",
          source: "background-command-router"
        });

        const loadStartPromise = waitForTabLoadStartInBackground(
          normalizedTabId,
          RENDER_MODE_INSPECTION_START_TIMEOUT_MS
        );
        const reloadResult = await utils.reloadPageWithJavaScriptControl(
          normalizedTabId,
          javaScriptDisabled
        );
        const loadStarted = await loadStartPromise;

        Object.assign(commandResult, {
          loadStarted,
          reloadResult: reloadResult && typeof reloadResult === "object"
            ? reloadResult
            : { ok: false, error: "Unable to reload page for render mode inspection" }
        });

        if (!commandResult.reloadResult.ok || !loadStarted) {
          commandResult.followUpError =
            (commandResult.reloadResult && commandResult.reloadResult.error) ||
            "Unable to reload page for render mode inspection";
          return commandResult;
        }

        const loadCompleted = await waitForTabLoadCompleteInBackground(
          normalizedTabId,
          RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS
        );
        if (!loadCompleted) {
          commandResult.followUpError = "Render mode inspection timed out while waiting for page load";
          return commandResult;
        }

        await update({
          message: "Inspecting page...",
          reason: "tab-render-mode-reveal",
          source: "background-command-router"
        });

        const revealResult = await runRenderModeRevealFreezeStep(
          normalizedTabId,
          baseUrl,
          operationId
        );
        if (!revealResult.ok) {
          commandResult.followUpError = revealResult.error || "Unable to inspect page";
          return commandResult;
        }

        const captureResult = await runRenderModeCaptureHtmlStep(
          normalizedTabId,
          baseUrl,
          operationId
        );
        if (!captureResult.ok) {
          commandResult.followUpError = captureResult.error || "Unable to capture render mode HTML";
          return commandResult;
        }

        Object.assign(commandResult, {
          ok: true,
          followUpCompleted: true,
          followUpError: "",
          inspectionSnapshot: {
            pageUrl: captureResult.pageUrl || "",
            renderedHtml: captureResult.renderedHtml || "",
            rawHtml: captureResult.rawHtml || "",
            renderMode: captureResult.renderMode || "",
            hiddenCount: Number(captureResult.hiddenCount || 0)
          }
        });
        return commandResult;
      } finally {
        const endAcknowledged = await sendRenderModeInspectionEndWithRetry(
          normalizedTabId,
          operationId
        );
        const tabState = await utils.getTabState(normalizedTabId);
        updateTabRuntime(normalizedTabId, {
          mode: tabState && tabState.enabled ? "marking" : "silent"
        });
        Object.assign(commandResult, {
          endAcknowledged,
          runtime: getTabRuntimeSnapshot(normalizedTabId),
          state: tabState
        });
      }
    }
  );
}, POPUP_TAB_COMMAND_POLICY);

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_RUN_AI, async (context, payload) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for AI run"
    );
  }

  let tab = null;
  try {
    tab = await chrome.tabs.get(normalizedTabId);
  } catch {
    tab = null;
  }
  if (!tab || !tab.id) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Target tab is unavailable",
      { tabId: normalizedTabId }
    );
  }

  return withBackgroundTabSpinner(
    normalizedTabId,
    {
      key: `run-ai:${normalizedTabId}`,
      message: "Computing selectors...",
      owner: SPINNER_OWNERS.POPUP,
      reason: "tab-run-ai",
      source: "background-command-router",
      persistent: false
    },
    async ({ update }) => {
      const result = await runAiCommandForTab(normalizedTabId, payload, update);
      if (!result || !result.ok) {
        return context.replyFail(
          result && result.reason === "timed_out"
            ? MESSAGE_ERROR_CODES.TIMEOUT
            : MESSAGE_ERROR_CODES.HANDLER_FAILED,
          (result && result.error) || "Unable to run AI",
          {
            tabId: normalizedTabId,
            reason: result && result.reason ? result.reason : "handler_failed",
            reconciliationPending: Boolean(result && result.reconciliationPending),
            locked: Boolean(result && result.locked)
          }
        );
      }
      return {
        ok: true,
        tabId: normalizedTabId,
        sessionId: result.sessionId,
        selectorSet: result.selectorSet,
        deadlineAt: result.deadlineAt,
        siteId: result.siteId || null,
        runtime: getTabRuntimeSnapshot(normalizedTabId),
        state: await utils.getTabState(normalizedTabId)
      };
    }
  );
}, POPUP_TAB_COMMAND_POLICY);

function maybeGetCommandPayloadForLedger(message) {
  if (!isDebugFlagEnabled("fullWorldMessagingLogging")) {
    return undefined;
  }
  if (!message || !message.payload || typeof message.payload !== "object") {
    return undefined;
  }
  return redactCommandPayloadForLedger(message.payload);
}

const LEDGER_SENSITIVE_KEY_PATTERN = /(token|password|secret|authorization|cookie|jwt|api[_-]?key|bearer|credential)/i;
const LEDGER_BODY_KEY_PATTERN = /(html|body|payload|content|config|raw|rendered)/i;
const LEDGER_MAX_STRING_LENGTH = 160;
const LEDGER_MAX_ARRAY_PREVIEW = 5;
const LEDGER_MAX_OBJECT_KEYS = 20;

function looksLikeJwtToken(value) {
  if (typeof value !== "string" || !value) {
    return false;
  }
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function summarizeLargeString(value) {
  const normalized = typeof value === "string" ? value : "";
  if (normalized.length <= LEDGER_MAX_STRING_LENGTH) {
    return normalized;
  }
  return `[truncated:${normalized.length}] ${normalized.slice(0, LEDGER_MAX_STRING_LENGTH)}`;
}

function redactCommandPayloadValueForLedger(key, value, depth = 0) {
  const normalizedKey = typeof key === "string" ? key : "";
  if (LEDGER_SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
    return "[redacted]";
  }
  if (normalizedKey === "payloadKey") {
    return "[redacted:payload-key]";
  }
  if (typeof value === "string") {
    if (looksLikeJwtToken(value)) {
      return "[redacted:jwt]";
    }
    if (LEDGER_BODY_KEY_PATTERN.test(normalizedKey) && value.length > 64) {
      return `[redacted:${normalizedKey}:${value.length}]`;
    }
    return summarizeLargeString(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 1) {
      return `[array:${value.length}]`;
    }
    return {
      summary: `[array:${value.length}]`,
      preview: value.slice(0, LEDGER_MAX_ARRAY_PREVIEW).map((entry) => redactCommandPayloadValueForLedger(normalizedKey, entry, depth + 1))
    };
  }
  if (!value || typeof value !== "object") {
    return `[${typeof value}]`;
  }
  if (depth >= 1) {
    return `[object:${Object.keys(value).length}]`;
  }
  return redactCommandPayloadForLedger(value, depth + 1);
}

function redactCommandPayloadForLedger(payload, depth = 0) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const entries = Object.entries(payload).slice(0, LEDGER_MAX_OBJECT_KEYS);
  const redacted = {};
  for (const [key, value] of entries) {
    redacted[key] = redactCommandPayloadValueForLedger(key, value, depth);
  }
  const totalKeys = Object.keys(payload).length;
  if (totalKeys > entries.length) {
    redacted.__truncatedKeys = totalKeys - entries.length;
  }
  return redacted;
}

function recordBackgroundCommandLedger(message, sender, reply, startedAt, resolvedContextTabId = null) {
  if (!message || typeof message !== "object") {
    return;
  }
  const tabId = normalizeBrokerTabId(resolvedContextTabId) || getMessageTabId(message, sender);
  if (!tabId) {
    return;
  }
  const finishedAt = Date.now();
  appendTabCommandLedger(tabId, {
    id: typeof message.id === "string" ? message.id : "",
    type: typeof message.type === "string" ? message.type : "",
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    status: reply && reply.ok ? "ok" : "error",
    errorCode: reply && !reply.ok && typeof reply.code === "string" ? reply.code : "",
    payload: maybeGetCommandPayloadForLedger(message)
  });
}

function handleBackgroundCommandEnvelope(message, sender, sendResponse) {
  if (!isRequestEnvelope(message) || message.target !== MESSAGE_TARGETS.BACKGROUND) {
    return false;
  }
  const startedAt = Date.now();
  const expectsReply = message.expectsReply !== false;
  let resolvedContextTabId = null;
  const dispatch = dispatchBackgroundCommand(message, sender, {
    requireTabForTypes: TAB_SCOPED_BACKGROUND_COMMANDS,
    onDispatched(context) {
      if (context && Number.isFinite(context.tabId)) {
        resolvedContextTabId = context.tabId;
      }
    }
  });

  if (!expectsReply) {
    dispatch
      .then((reply) => {
        recordBackgroundCommandLedger(message, sender, reply, startedAt, resolvedContextTabId);
        sendResponse(undefined);
      })
      .catch((error) => {
        const reply = createFailureEnvelope(
          message,
          MESSAGE_ERROR_CODES.HANDLER_FAILED,
          (error && error.message) || "Background command failed"
        );
        recordBackgroundCommandLedger(message, sender, reply, startedAt, resolvedContextTabId);
        sendResponse(undefined);
      });
    return true;
  }

  dispatch
    .then((reply) => {
      recordBackgroundCommandLedger(message, sender, reply, startedAt, resolvedContextTabId);
      sendResponse(reply);
    })
    .catch((error) => {
      const reply = createFailureEnvelope(
        message,
        MESSAGE_ERROR_CODES.HANDLER_FAILED,
        (error && error.message) || "Background command failed"
      );
      recordBackgroundCommandLedger(message, sender, reply, startedAt, resolvedContextTabId);
      sendResponse(reply);
    });
  return true;
}

async function setAiComputeLockForTab(tabId, active, expiresAt = 0, baseUrl = "") {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return { ok: false, active: Boolean(active), error: "Missing tab" };
  }
  const normalizedExpiresAt = Number(expiresAt);
  if (active) {
    const nextExpiresAt =
      Number.isFinite(normalizedExpiresAt) && normalizedExpiresAt > Date.now()
        ? normalizedExpiresAt
        : Date.now() + 30_000;
    aiComputeLockExpiresAtByTabId.set(normalizedTabId, nextExpiresAt);
  } else {
    aiComputeLockExpiresAtByTabId.delete(normalizedTabId);
  }
  const normalizedBaseUrl = typeof baseUrl === "string" ? baseUrl : "";
  if (active && normalizedBaseUrl) {
    const existingTabState = await utils.getTabState(normalizedTabId);
    const nextTabState = {
      ...(existingTabState && typeof existingTabState === "object" ? existingTabState : {}),
      enabled: true,
      baseUrl: normalizedBaseUrl
    };
    await utils.setTabState(normalizedTabId, nextTabState);
    utils.updateActionForTab(normalizedTabId).then();
  }
  if (active) {
    const activationResult = await ensureContentMainForTab(normalizedTabId);
    if (!activationResult.ok) {
      return {
        ok: false,
        active: true,
        tabId: normalizedTabId,
        error: activationResult.error || "Content activation failed"
      };
    }
  }
  const response = await sendContentMessageToTab(normalizedTabId, {
    type: "setAiComputeLock",
    active: Boolean(active),
    expiresAt: Number(expiresAt) || 0
  });
  if (!active && (!response || !response.ok)) {
    return { ok: true, active: false, tabId: normalizedTabId };
  }
  return response && response.ok
    ? { ok: true, active: Boolean(active), tabId: normalizedTabId }
    : {
      ok: false,
      active: Boolean(active),
      tabId: normalizedTabId,
      error: (response && response.error) || "AI compute lock failed"
    };
}

function isAiComputeLockActiveForTab(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return false;
  }
  const expiresAt = aiComputeLockExpiresAtByTabId.get(normalizedTabId);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    aiComputeLockExpiresAtByTabId.delete(normalizedTabId);
    return false;
  }
  return true;
}

async function refreshAiRunHeartbeat(options = {}) {
  const tabId = normalizeBrokerTabId(options.tabId);
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  const siteId = normalizeSiteIdValue(options.siteId);
  const deadlineAt = Number(options.deadlineAt);
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : "";
  if (!tabId || !sessionId || !siteId || !Number.isFinite(deadlineAt) || deadlineAt <= 0) {
    return { ok: false, record: null, expiresAt: 0, lockApplied: false };
  }
  const expiresAt = getAiRunResumeExpiresAt();
  const record = await savePersistedAiRunRecord({
    sessionId,
    siteId,
    expiresAt,
    deadlineAt
  });
  if (!record) {
    return { ok: false, record: null, expiresAt: 0, lockApplied: false };
  }
  const lockResult = await setAiComputeLockForTab(tabId, true, expiresAt, baseUrl);
  if (!lockResult.ok) {
    await clearPersistedAiRunRecord();
    return {
      ok: false,
      record: null,
      expiresAt: 0,
      lockApplied: false,
      error: lockResult.error || "AI compute lock failed"
    };
  }
  return { ok: true, record, expiresAt, lockApplied: true };
}

function resolveBackgroundEndpoint(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch (error) {
    return "";
  }
}

function createBackgroundJsonHeaders(tokenValue = "") {
  const headers = { "Content-Type": "application/json" };
  const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function buildValidateEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/validate`;
}

function buildLoginEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/login`;
}

async function requestAiRunStatus(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  const statusUrl = sessionId
    ? resolveBackgroundEndpoint(endpointValue, `/get_selectors/status/${encodeURIComponent(sessionId)}`)
    : "";
  if (!statusUrl) {
    return { ok: false };
  }
  const response = await fetch(statusUrl, {
    method: "GET",
    headers: createBackgroundJsonHeaders(tokenValue)
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  if (response.status === 404) {
    return { ok: false, notFound: true };
  }
  if (!response.ok) {
    return { ok: false };
  }
  const parsed = parseAiRunStatusResponse(await response.json());
  if (!parsed || parsed.sessionId !== sessionId) {
    return { ok: false };
  }
  return { ok: true, status: parsed.status };
}

async function removeRemotePageMarking(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const normalizedSiteId = normalizeSiteIdValue(options.siteId);
  const pageUrl = typeof options.url === "string" ? options.url.trim() : "";
  const removeUrl = resolveBackgroundEndpoint(endpointValue, "/remove");
  if (!removeUrl || !normalizedSiteId || !pageUrl) {
    return { ok: false, skipped: true };
  }
  const response = await fetch(removeUrl, {
    method: "POST",
    headers: createBackgroundJsonHeaders(tokenValue),
    body: JSON.stringify({
      siteId: normalizedSiteId,
      url: pageUrl
    })
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  return { ok: response.ok, status: response.status || 0 };
}

async function validateAuthToken(options = {}) {
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const validateUrl = buildValidateEndpointFromStageBase(stageBase);
  if (!validateUrl || !tokenValue.trim()) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(validateUrl, {
      method: "GET",
      headers: createBackgroundJsonHeaders(tokenValue)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      return { ok: true, valid: false, status: response.status || 0 };
    }
    return { ok: true, valid: true, status: response.status || 0 };
  } catch {
    return { ok: false };
  }
}

async function requestAuthLogin(options = {}) {
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const email = typeof options.email === "string" ? options.email.trim() : "";
  const password = typeof options.password === "string" ? options.password : "";
  const loginUrl = buildLoginEndpointFromStageBase(stageBase);
  if (!loginUrl || !email || !password.trim()) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(""),
      body: JSON.stringify({ email, password })
    });
    await maybeUpdateStoredTokenFromResponse(response, "");
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return {
      ok: response.ok,
      status: response.status || 0,
      payload: payload && typeof payload === "object" ? payload : null
    };
  } catch {
    return { ok: false };
  }
}

async function submitSelectorSetGraphqlUpdate(options = {}) {
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const normalizedSiteId = normalizeSiteIdValue(options.siteId);
  const includeCss = typeof options.includeCss === "string" ? options.includeCss : "";
  const excludeCss = typeof options.excludeCss === "string" ? options.excludeCss : "";
  const renderMode = typeof options.renderMode === "string" ? options.renderMode : "";
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!graphqlEndpoint || !normalizedSiteId) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify({
        query: UPDATE_SCRAPING_CONDITIONS_MUTATION,
        variables: {
          domainId: normalizedSiteId,
          includeCss,
          excludeCss,
          renderingMode: renderMode || null
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return {
      ok: response.ok,
      status: response.status || 0,
      payload: payload && typeof payload === "object" ? payload : null
    };
  } catch {
    return { ok: false };
  }
}

function collectStoredPageMarkingItems(pageMarkings, baseUrl = "") {
  const items = [];
  Object.entries(pageMarkings && typeof pageMarkings === "object" ? pageMarkings : {}).forEach(([url, entry]) => {
    if (!url || !entry || typeof entry !== "object") {
      return;
    }
    if (baseUrl && !utils.isPageWithinBaseUrl(url, baseUrl)) {
      return;
    }
    const excludedCount = Array.isArray(entry.xpaths)
      ? entry.xpaths.filter((item) => item && item.excluded && item.xpath).length
      : 0;
    const includedCount = Array.isArray(entry.includeXpaths)
      ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath).length
      : 0;
    items.push({
      url,
      title: entry.title || url,
      pageType: entry.pageType || "",
      count: excludedCount + includedCount
    });
  });
  return items;
}

function mergeSelectorsIntoConfig(targetConfig, incomingConfig) {
  if (!targetConfig || typeof targetConfig !== "object") {
    return false;
  }
  const merged = configStore.mergeConfigSelectorStateByTimestamp(
    targetConfig.selectors,
    targetConfig.selectorsUpdatedAt,
    targetConfig.submittedSelectorsFingerprint,
    incomingConfig && typeof incomingConfig === "object" ? incomingConfig.selectors : null,
    incomingConfig && typeof incomingConfig === "object"
      ? incomingConfig.selectorsUpdatedAt
      : null,
    incomingConfig && typeof incomingConfig === "object"
      ? incomingConfig.submittedSelectorsFingerprint
      : ""
  );
  const currentSelectorSet = normalizeAiSelectorSet(targetConfig.selectors);
  const currentUpdatedAt = configStore.normalizeEntryTimestamp(targetConfig.selectorsUpdatedAt);
  const currentSubmittedFingerprint =
    typeof targetConfig.submittedSelectorsFingerprint === "string"
      ? targetConfig.submittedSelectorsFingerprint.trim()
      : "";
  const didChange =
    !aiSelectorSetsEqual(currentSelectorSet, merged.selectorSet) ||
    currentUpdatedAt !== merged.updatedAt ||
    currentSubmittedFingerprint !== merged.submittedFingerprint;
  if (didChange) {
    targetConfig.selectors = merged.selectorSet;
    targetConfig.selectorsUpdatedAt = merged.updatedAt;
    targetConfig.submittedSelectorsFingerprint = merged.submittedFingerprint;
  }
  return didChange;
}

function getRemoteManagedConfigSignature(baseUrl, sourceConfig) {
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl) {
    return "";
  }
  const normalizedConfig = configStore.normalizeConfig(
    normalizedBaseUrl,
    sourceConfig || configStore.createDefaultConfig(normalizedBaseUrl)
  ).config;
  return JSON.stringify(configStore.createConfigSyncPayload(normalizedBaseUrl, normalizedConfig));
}

function getNormalizedPageEntrySignature(pageUrl, entry) {
  if (!pageUrl) {
    return "null";
  }
  const normalizedEntry = configStore.normalizePageMarkings({ [pageUrl]: entry }).normalized[pageUrl] || null;
  return JSON.stringify(normalizedEntry);
}

async function replaceServerConfigIntoLocalSnapshot(options = {}) {
  const payloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  let rawPayload = options.payload;
  try {
    if (payloadKey) {
      const payloadStore = await utils.storageGet(chrome.storage.session, payloadKey).catch(() => ({}));
      rawPayload = payloadStore && typeof payloadStore === "object"
        ? payloadStore[payloadKey]
        : null;
    }
  } finally {
    if (payloadKey) {
      await utils.storageRemove(chrome.storage.session, payloadKey).catch(() => null);
    }
  }
  const normalizedPayload = configStore.normalizeConfigSyncPayload(rawPayload, "");
  const currentPageUrl = typeof options.currentPageUrl === "string" ? options.currentPageUrl.trim() : "";
  if (!normalizedPayload.baseUrl) {
    return {
      ok: false,
      changed: false,
      replacedCurrentPage: false,
      baseUrl: ""
    };
  }

  const baseUrl = normalizedPayload.baseUrl;
  const allConfigs = await configStore.getConfigs();
  const existingRaw = allConfigs[baseUrl];
  const existingConfig = configStore.normalizeConfig(baseUrl, existingRaw).config;
  const normalizedIncomingSiteId = normalizeSiteIdValue(normalizedPayload.siteId);
  const fallbackSiteId = normalizeSiteIdValue(options.siteId);
  const nextConfig = configStore.normalizeConfig(baseUrl, {
    ...existingConfig,
    ...normalizedPayload,
    baseUrl,
    siteId: normalizedIncomingSiteId || normalizeSiteIdValue(existingConfig.siteId) || fallbackSiteId || null,
    pageMarkings: configStore.normalizePageMarkings(normalizedPayload.pageMarkings).normalized,
    selectors: normalizeAiSelectorSet(normalizedPayload.selectors),
    selectorsUpdatedAt: configStore.normalizeEntryTimestamp(normalizedPayload.selectorsUpdatedAt),
    submittedSelectorsFingerprint:
      typeof normalizedPayload.submittedSelectorsFingerprint === "string"
        ? normalizedPayload.submittedSelectorsFingerprint
        : ""
  }).config;

  const previousSignature = getRemoteManagedConfigSignature(baseUrl, existingConfig);
  const nextSignature = getRemoteManagedConfigSignature(baseUrl, nextConfig);
  const changed = previousSignature !== nextSignature;
  const replacedCurrentPage = Boolean(
    currentPageUrl &&
      getNormalizedPageEntrySignature(currentPageUrl, existingConfig.pageMarkings?.[currentPageUrl]) !==
        getNormalizedPageEntrySignature(currentPageUrl, nextConfig.pageMarkings?.[currentPageUrl])
  );

  if (!existingRaw || changed) {
    allConfigs[baseUrl] = nextConfig;
    await configStore.saveConfigs(allConfigs);
  }
  await configStore.setBackendSavedPageMarkings(baseUrl, nextConfig.pageMarkings);

  return {
    ok: true,
    changed: Boolean(!existingRaw || changed),
    replacedCurrentPage,
    baseUrl
  };
}

async function mergeServerConfigIntoLocalSnapshot(options = {}) {
  const payloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  let payload = options && typeof options === "object" ? options.payload : null;
  try {
    if (payloadKey) {
      const payloadStore = await utils.storageGet(chrome.storage.session, payloadKey).catch(() => ({}));
      payload = payloadStore && typeof payloadStore === "object"
        ? payloadStore[payloadKey]
        : null;
    }
  } finally {
    if (payloadKey) {
      await utils.storageRemove(chrome.storage.session, payloadKey).catch(() => null);
    }
  }
  const invalidLoadedUrls = configStore.collectInvalidPageMarkingUrls(
    payload && typeof payload === "object" ? payload.pageMarkings : null
  );
  const currentPageUrl = typeof options.currentPageUrl === "string" ? options.currentPageUrl.trim() : "";
  const confirmedPageMarkings = configStore.normalizePageMarkings(
    options && options.confirmedPageMarkings
  ).normalized;
  const preferConfirmedPageMarkings = Boolean(options && options.preferConfirmedPageMarkings);
  const applyConfirmedToBackendSaved = Boolean(options && options.applyConfirmedToBackendSaved);
  const normalizedPayload = configStore.normalizeConfigSyncPayload(payload, "");
  if (!normalizedPayload.baseUrl) {
    return {
      ok: false,
      changed: false,
      replacedCurrentPage: false,
      baseUrl: "",
      invalidLoadedUrls: []
    };
  }
  const baseUrl = normalizedPayload.baseUrl;
  const allConfigs = await configStore.getConfigs();
  const existingRaw = allConfigs[baseUrl];
  const normalizedLocal = configStore.normalizeConfig(baseUrl, existingRaw);
  const localConfig = normalizedLocal.config;
  const incomingSiteId = normalizeSiteIdValue(normalizedPayload.siteId);
  const siteIdChanged =
    Boolean(incomingSiteId) && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId;
  if (incomingSiteId && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId) {
    localConfig.siteId = incomingSiteId;
  }
  const mergedRenderMode = configStore.mergeRenderModeByTimestamp(
    localConfig.renderMode,
    localConfig.renderModeUpdatedAt,
    normalizedPayload.renderMode,
    normalizedPayload.renderModeUpdatedAt
  );
  const renderModeChanged =
    configStore.getConfigRenderMode(localConfig) !== mergedRenderMode.renderMode ||
    configStore.normalizeEntryTimestamp(localConfig.renderModeUpdatedAt) !== mergedRenderMode.updatedAt;
  if (renderModeChanged) {
    localConfig.renderMode = mergedRenderMode.renderMode;
    localConfig.renderModeUpdatedAt = mergedRenderMode.updatedAt;
  }
  const incomingPageMarkings = configStore.normalizePageMarkings(normalizedPayload.pageMarkings).normalized;
  const existingBackendSavedPageMarkings = await configStore.getBackendSavedPageMarkings(baseUrl);
  let mergedBackendSavedPageMarkings = configStore.mergePageMarkingsByTimestamp(
    existingBackendSavedPageMarkings,
    incomingPageMarkings
  ).pageMarkings;
  if (applyConfirmedToBackendSaved) {
    mergedBackendSavedPageMarkings = configStore.mergePageMarkingsByTimestamp(
      mergedBackendSavedPageMarkings,
      confirmedPageMarkings,
      { preferIncomingOnTimestampTie: true }
    ).pageMarkings;
    if (preferConfirmedPageMarkings) {
      Object.entries(confirmedPageMarkings).forEach(([url, entry]) => {
        mergedBackendSavedPageMarkings[url] =
          configStore.normalizePageMarkings({ [url]: entry }).normalized[url];
      });
    }
  }
  if (
    Object.keys(incomingPageMarkings).length > 0 ||
    (applyConfirmedToBackendSaved && Object.keys(confirmedPageMarkings).length > 0)
  ) {
    await configStore.setBackendSavedPageMarkings(baseUrl, mergedBackendSavedPageMarkings);
  }
  const previousPageMarkingsSignature = JSON.stringify(
    configStore.normalizePageMarkings(localConfig.pageMarkings).normalized
  );
  const incomingPageMarkingsMergeResult = configStore.mergePageMarkingsByTimestamp(
    localConfig.pageMarkings,
    incomingPageMarkings
  );
  const confirmedPageMarkingsMergeResult = configStore.mergePageMarkingsByTimestamp(
    incomingPageMarkingsMergeResult.pageMarkings,
    confirmedPageMarkings,
    { preferIncomingOnTimestampTie: true }
  );
  let mergedPageMarkings = confirmedPageMarkingsMergeResult.pageMarkings;
  if (preferConfirmedPageMarkings) {
    mergedPageMarkings = { ...mergedPageMarkings };
    Object.entries(confirmedPageMarkings).forEach(([url, entry]) => {
      mergedPageMarkings[url] = configStore.normalizePageMarkings({ [url]: entry }).normalized[url];
    });
  }
  const mergedPageMarkingsSignature = JSON.stringify(mergedPageMarkings);
  const pageMarkingsChanged = previousPageMarkingsSignature !== mergedPageMarkingsSignature;
  const confirmedCurrentPageSignature = currentPageUrl && Object.prototype.hasOwnProperty.call(confirmedPageMarkings, currentPageUrl)
    ? getNormalizedPageEntrySignature(currentPageUrl, confirmedPageMarkings[currentPageUrl])
    : "";
  const finalCurrentPageSignature = currentPageUrl
    ? getNormalizedPageEntrySignature(currentPageUrl, mergedPageMarkings[currentPageUrl])
    : "";
  const replacedCurrentPage = Boolean(
    currentPageUrl &&
      (
        confirmedCurrentPageSignature
          ? finalCurrentPageSignature !== confirmedCurrentPageSignature
          :
        incomingPageMarkingsMergeResult.replacedExistingUrls.includes(currentPageUrl) ||
        confirmedPageMarkingsMergeResult.replacedExistingUrls.includes(currentPageUrl)
      )
  );
  localConfig.pageMarkings = mergedPageMarkings;
  const selectorStateChanged = mergeSelectorsIntoConfig(localConfig, normalizedPayload);
  const shouldSave =
    !existingRaw ||
    normalizedLocal.changed ||
    siteIdChanged ||
    renderModeChanged ||
    selectorStateChanged ||
    pageMarkingsChanged;
  if (shouldSave) {
    allConfigs[baseUrl] = localConfig;
    await configStore.saveConfigs(allConfigs);
  }
  return {
    ok: true,
    changed: shouldSave,
    replacedCurrentPage,
    baseUrl,
    invalidLoadedUrls
  };
}

async function loadRemoteConfigSnapshot(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const normalizedSiteId = normalizeSiteIdValue(options.siteId);
  const loadUrl = resolveBackgroundEndpoint(endpointValue, "/load");
  if (!loadUrl || !normalizedSiteId) {
    return { ok: false, skipped: true };
  }
  try {
    const response = await fetch(loadUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify({ siteId: normalizedSiteId })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      return { ok: true, status: "auth_error", payloadKey: "" };
    }
    if (response.status === 404) {
      return { ok: true, status: "not_found", payloadKey: "" };
    }
    if (!response.ok) {
      return { ok: true, status: "error", payloadKey: "" };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const stored = await putTransferPayload("load", payload);
    if (!stored.ok) {
      return { ok: false };
    }
    return { ok: true, status: "ok", payloadKey: stored.payloadKey };
  } catch {
    return { ok: false };
  }
}

async function saveRemoteConfigSnapshot(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const requestPayloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  const saveUrl = resolveBackgroundEndpoint(endpointValue, "/save");
  if (!saveUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  let requestPayload = null;
  try {
    const loaded = await getTransferPayload(requestPayloadKey, { expectedType: "object" });
    requestPayload = loaded && loaded.ok ? loaded.payload : null;
    if (!requestPayload || typeof requestPayload !== "object") {
      return { ok: false, skipped: true };
    }
    const response = await fetch(saveUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(requestPayload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      return { ok: true, status: "auth_error", payloadKey: "" };
    }
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0, payloadKey: "" };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== "object") {
      return { ok: true, status: "empty", payloadKey: "" };
    }
    const stored = await putTransferPayload("save-response", payload);
    if (!stored.ok) {
      return { ok: false };
    }
    return { ok: true, status: "ok", payloadKey: stored.payloadKey };
  } catch {
    return { ok: false };
  } finally {
    await removeTransferPayload(requestPayloadKey);
  }
}

async function requestRenderModeDetection(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const requestPayloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  const detectUrl = resolveBackgroundEndpoint(endpointValue, "/is_js_rendered");
  if (!detectUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const loaded = await getTransferPayload(requestPayloadKey, { expectedType: "object" });
    const payload = loaded && loaded.ok ? loaded.payload : null;
    if (!payload || typeof payload !== "object") {
      return { ok: false, skipped: true };
    }
    const response = await fetch(detectUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(payload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0, payload: null };
    }
    let payloadResponse = null;
    try {
      payloadResponse = await response.json();
    } catch {
      payloadResponse = null;
    }
    return { ok: true, status: "ok", payload: payloadResponse };
  } catch {
    return { ok: false };
  } finally {
    await removeTransferPayload(requestPayloadKey);
  }
}

async function submitPageTypeAssignments(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const requestPayloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  const assignPageTypesUrl = resolveBackgroundEndpoint(endpointValue, "/assign_page_types");
  if (!assignPageTypesUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const loaded = await getTransferPayload(requestPayloadKey, { expectedType: "array" });
    const payload = loaded && loaded.ok ? loaded.payload : null;
    if (!Array.isArray(payload) || !payload.length) {
      return { ok: false, skipped: true };
    }
    const response = await fetch(assignPageTypesUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(payload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0 };
    }
    return { ok: true, status: "ok" };
  } catch {
    return { ok: false };
  } finally {
    await removeTransferPayload(requestPayloadKey);
  }
}

async function requestAiRunStartSnapshot(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const requestPayloadKey = typeof options.payloadKey === "string" ? options.payloadKey.trim() : "";
  const computeSelectorsUrl = resolveBackgroundEndpoint(endpointValue, "/get_selectors");
  if (!computeSelectorsUrl || !requestPayloadKey) {
    return { ok: false, skipped: true };
  }
  try {
    const loaded = await getTransferPayload(requestPayloadKey, { expectedType: "object" });
    const payload = loaded && loaded.ok ? loaded.payload : null;
    const response = await fetch(computeSelectorsUrl, {
      method: "POST",
      headers: createBackgroundJsonHeaders(tokenValue),
      body: JSON.stringify(payload || {})
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      return { ok: true, status: "error", httpStatus: response.status || 0 };
    }
    const sessionId = parseAiRunStartResponse(await response.json());
    if (!sessionId) {
      return { ok: false };
    }
    return { ok: true, status: "ok", sessionId };
  } catch {
    return { ok: false };
  } finally {
    await removeTransferPayload(requestPayloadKey);
  }
}

async function requestAiRunResultSnapshot(options = {}) {
  const endpointValue = typeof options.endpointValue === "string" ? options.endpointValue.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue : "";
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  const resultUrl = sessionId
    ? resolveBackgroundEndpoint(endpointValue, `/get_selectors/result/${encodeURIComponent(sessionId)}`)
    : "";
  if (!resultUrl) {
    return { ok: false };
  }
  try {
    const response = await fetch(resultUrl, {
      method: "GET",
      headers: createBackgroundJsonHeaders(tokenValue)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 404) {
      return { ok: false, notFound: true };
    }
    if (!response.ok) {
      return { ok: false };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray(payload.exclusionSelectors) ||
      !Array.isArray(payload.inclusionSelectors)
    ) {
      return { ok: false };
    }
    const stored = await putTransferPayload("ai-run-result", payload);
    if (!stored.ok) {
      return { ok: false };
    }
    return { ok: true, payloadKey: stored.payloadKey };
  } catch {
    return { ok: false };
  }
}

async function fetchStaticPageHtmlForBackground(url) {
  const targetUrl = typeof url === "string" ? url.trim() : "";
  let parsedUrl = null;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { ok: false, error: "Unsupported URL" };
  }
  try {
    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status || 0,
        error: "Static HTML request failed"
      };
    }
    return {
      ok: true,
      status: response.status || 200,
      url: response.url || parsedUrl.toString(),
      html: await response.text()
    };
  } catch {
    return { ok: false, error: "Static HTML request failed" };
  }
}

async function prepareAiRunPayloadSnapshot(options = {}) {
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
  const currentPageUrl = typeof options.currentPageUrl === "string" ? options.currentPageUrl.trim() : "";
  const currentRenderMode = typeof options.currentRenderMode === "string" ? options.currentRenderMode.trim() : "";
  if (!baseUrl || !currentPageUrl) {
    return { ok: false };
  }
  try {
    const currentConfig = await configStore.ensureConfig(baseUrl);
    const pageMarkings =
      currentConfig && currentConfig.pageMarkings && typeof currentConfig.pageMarkings === "object"
        ? currentConfig.pageMarkings
        : {};
    const storedPageEntries = Object.entries(pageMarkings)
      .filter(([url, entry]) => {
        if (!url || !entry || typeof entry !== "object") {
          return false;
        }
        if (baseUrl && !utils.isPageWithinBaseUrl(url, baseUrl)) {
          return false;
        }
        if (typeof entry.renderedHtml !== "string" || !entry.renderedHtml) {
          return false;
        }
        if (!Array.isArray(entry.submissionXpaths) || entry.submissionXpaths.length === 0) {
          return false;
        }
        return true;
      });
    if (!storedPageEntries.some(([url]) => url === currentPageUrl)) {
      return { ok: false, reason: "missing_current_page" };
    }
    if (!storedPageEntries.length) {
      return { ok: false, reason: "missing_saved_pages" };
    }
    const urlsMissingRawHtml = storedPageEntries
      .map(([url, entry]) => ({ url, entry }))
      .filter(({ entry }) => typeof entry.rawHtml !== "string" || !entry.rawHtml);
    const backfillResults = await Promise.all(
      urlsMissingRawHtml.map(async ({ url }) => {
        const response = await fetchStaticPageHtmlForBackground(url);
        if (!response.ok || typeof response.html !== "string" || !response.html) {
          return null;
        }
        return { url, rawHtml: response.html };
      })
    );
    const successfulBackfills = backfillResults.filter(Boolean);
    if (successfulBackfills.length) {
      await configStore.updateConfig(baseUrl, (targetConfig) => {
        if (!targetConfig.pageMarkings || typeof targetConfig.pageMarkings !== "object") {
          return;
        }
        successfulBackfills.forEach((item) => {
          const targetEntry = targetConfig.pageMarkings[item.url];
          if (!targetEntry || typeof targetEntry !== "object") {
            return;
          }
          targetEntry.rawHtml = item.rawHtml;
        });
      });
    }
    const rawHtmlBackfills = new Map();
    successfulBackfills.forEach((item) => {
      rawHtmlBackfills.set(item.url, item.rawHtml);
    });
    const pages = storedPageEntries.map(([url, entry]) => {
      const rawHtml =
        entry && typeof entry.rawHtml === "string" && entry.rawHtml
          ? entry.rawHtml
          : rawHtmlBackfills.get(url) || "";
      return {
        url,
        renderedHtml: typeof entry.renderedHtml === "string" ? entry.renderedHtml : "",
        rawHtml: currentRenderMode === "static" ? rawHtml : undefined,
        renderedXPaths: buildAiSubmissionXpaths(entry)
      };
    });
    const payload = {
      baseUrl,
      renderMode: currentRenderMode,
      defaultExclusionSelectors: constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
      pages
    };
    const stored = await putTransferPayload("ai-run-prepare", payload);
    if (!stored.ok) {
      return { ok: false };
    }
    return {
      ok: true,
      payloadKey: stored.payloadKey,
      requiresRawXPathRefinement: currentRenderMode === "static"
    };
  } catch {
    return { ok: false };
  }
}

async function preparePageTypeAssignmentsSnapshot(options = {}) {
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
  const normalizedChecklist = normalizePropertyPageTypes(options.checklistPageTypes);
  const checklistPageTypes = normalizedChecklist && Array.isArray(normalizedChecklist.pageTypes)
    ? normalizedChecklist.pageTypes
    : [];
  if (!baseUrl || !checklistPageTypes.length) {
    return { ok: false };
  }
  try {
    const currentConfig = await configStore.ensureConfig(baseUrl);
    const pageMarkings =
      currentConfig && currentConfig.pageMarkings && typeof currentConfig.pageMarkings === "object"
        ? currentConfig.pageMarkings
        : {};
    const storedPageMarkingItems = collectStoredPageMarkingItems(pageMarkings, baseUrl);
    const assignments = buildLynxChecklistAssignments({
      pageTypes: checklistPageTypes,
      markedPages: storedPageMarkingItems
    });
    if (!assignments.length) {
      return { ok: true, skipped: true, payloadKey: "" };
    }
    const urlsMissingRawHtml = assignments
      .map((item) => item.url)
      .filter((url) => {
        const entry = pageMarkings[url];
        return !entry || typeof entry.rawHtml !== "string" || !entry.rawHtml;
      });
    const backfillResults = await Promise.all(
      urlsMissingRawHtml.map(async (url) => {
        const response = await fetchStaticPageHtmlForBackground(url);
        if (!response.ok || typeof response.html !== "string" || !response.html) {
          return null;
        }
        return {
          url,
          rawHtml: response.html
        };
      })
    );
    const successfulBackfills = backfillResults.filter(Boolean);
    if (successfulBackfills.length) {
      await configStore.updateConfig(baseUrl, (targetConfig) => {
        if (!targetConfig.pageMarkings || typeof targetConfig.pageMarkings !== "object") {
          return;
        }
        successfulBackfills.forEach((item) => {
          const targetEntry = targetConfig.pageMarkings[item.url];
          if (!targetEntry || typeof targetEntry !== "object") {
            return;
          }
          targetEntry.rawHtml = item.rawHtml;
        });
      });
    }
    const rawHtmlBackfills = new Map();
    successfulBackfills.forEach((item) => {
      rawHtmlBackfills.set(item.url, item.rawHtml);
    });
    const payload = assignments.map((item) => {
      const entry = pageMarkings[item.url];
      return {
        url: item.url,
        rawHtml:
          entry && typeof entry.rawHtml === "string" && entry.rawHtml
            ? entry.rawHtml
            : rawHtmlBackfills.get(item.url) || "",
        renderedHtml: entry && typeof entry.renderedHtml === "string" ? entry.renderedHtml : "",
        pageType: item.pageType
      };
    });
    const stored = await putTransferPayload("assign-page-types-prepare", payload);
    if (!stored.ok) {
      return { ok: false };
    }
    return { ok: true, payloadKey: stored.payloadKey };
  } catch {
    return { ok: false };
  }
}

function ensureTraceState(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return { events: [] };
  }
  if (!tabWorldTraceStateByTabId.has(normalizedTabId)) {
    tabWorldTraceStateByTabId.set(normalizedTabId, {
      events: []
    });
  }
  return tabWorldTraceStateByTabId.get(normalizedTabId);
}

function isWorldTraceEnabled() {
  return isFeatureEnabled("traceDiagnostics") && isDebugFlagEnabled("worldTraceEnabled");
}

function appendWorldTraceEvent(tabId, channel, event, payload = null) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || !isWorldTraceEnabled()) {
    return;
  }
  const traceState = ensureTraceState(normalizedTabId);
  const traceEvent = {
    at: Date.now(),
    channel: typeof channel === "string" ? channel : "broker",
    event: typeof event === "string" ? event : "event",
    payload: payload && typeof payload === "object"
      ? {
        type: payload.type || "",
        kind: payload.kind || "",
        phase: payload.phase || "",
        operationId: payload.operationId || "",
        busy: Object.prototype.hasOwnProperty.call(payload, "busy") ? Boolean(payload.busy) : undefined,
        message: typeof payload.message === "string" ? payload.message : "",
        reason: typeof payload.reason === "string" ? payload.reason : "",
        source: typeof payload.source === "string" ? payload.source : "",
        key: typeof payload.key === "string" ? payload.key : ""
      }
      : null
  };
  traceState.events.push(traceEvent);
  if (traceState.events.length > WORLD_TRACE_EVENT_LIMIT) {
    traceState.events.splice(0, traceState.events.length - WORLD_TRACE_EVENT_LIMIT);
  }
  try {
    console.debug("[world-trace][background]", normalizedTabId, traceEvent.channel, traceEvent.event, traceEvent.payload || {});
  } catch {
    // Trace logging must never break runtime behavior.
  }
}

function normalizeBrokerTabId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function getMessageTabId(message, sender) {
  return normalizeBrokerTabId(message && message.tabId) ||
    normalizeBrokerTabId(sender && sender.tab && sender.tab.id);
}

function getPageMotionFreezeControlTarget(message, sender) {
  const tabId = getMessageTabId(message, sender);
  if (!tabId) {
    return null;
  }
  const target = { tabId };
  if (Number.isInteger(sender && sender.frameId) && sender.frameId >= 0) {
    target.frameIds = [sender.frameId];
  }
  return target;
}

function getPageMotionFreezeControlTargetKey(target) {
  const frameId = Array.isArray(target.frameIds) && target.frameIds.length
    ? target.frameIds[0]
    : "all";
  return `${target.tabId}:${frameId}`;
}

async function executePageMotionFreezeControlNow(target, command, details) {
  if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    return { ok: false, error: "Scripting API unavailable" };
  }
  await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: runPageMotionFreezeControl,
    args: [command, details]
  });
  return { ok: true };
}

async function executePageMotionFreezeControl(message, sender) {
  const target = getPageMotionFreezeControlTarget(message, sender);
  if (!target) {
    return { ok: false, error: "Missing tab" };
  }
  const command = typeof message.command === "string" && message.command
    ? message.command
    : "setPaused";
  const details = message.details && typeof message.details === "object"
    ? message.details
    : null;
  const queueKey = getPageMotionFreezeControlTargetKey(target);
  const previous = pageMotionFreezeControlQueueByTarget.get(queueKey) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => executePageMotionFreezeControlNow(target, command, details));
  pageMotionFreezeControlQueueByTarget.set(queueKey, next);
  try {
    return await next;
  } finally {
    if (pageMotionFreezeControlQueueByTarget.get(queueKey) === next) {
      pageMotionFreezeControlQueueByTarget.delete(queueKey);
    }
  }
}

function getExtensionContextWindowId(context) {
  return Number.isFinite(context && context.windowId) ? Math.trunc(context.windowId) : null;
}

async function resolvePopupSidePanelBoundTab(sender = {}) {
  if (
    !chrome.runtime ||
    typeof chrome.runtime.getContexts !== "function" ||
    !chrome.tabs ||
    typeof chrome.tabs.get !== "function"
  ) {
    return null;
  }
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["SIDE_PANEL"],
      documentUrls: [chrome.runtime.getURL("popup.html")]
    });
    if (!Array.isArray(contexts)) {
      return null;
    }
    const senderDocumentId = typeof sender.documentId === "string" ? sender.documentId : "";
    const senderContext = senderDocumentId
      ? contexts.find((context) => context && context.documentId === senderDocumentId)
      : null;
    const senderWindowId = getExtensionContextWindowId(senderContext);
    const boundContext = contexts.find((context) => (
      Number.isFinite(context && context.tabId) &&
      (!senderWindowId || getExtensionContextWindowId(context) === senderWindowId)
    ));
    if (!boundContext) {
      return null;
    }
    return await chrome.tabs.get(Math.trunc(boundContext.tabId));
  } catch {
    return null;
  }
}

async function resolvePopupTabContext(message = {}, sender = {}) {
  const debugTabId = normalizeBrokerTabId(message.debugTabId);
  if (debugTabId) {
    try {
      const tab = await chrome.tabs.get(debugTabId);
      if (tab && tab.id) {
        return { ok: true, tab, source: "debug" };
      }
    } catch {
      // Fall through to normal tab resolution if the debug tab is gone.
    }
  }

  const sidePanelBoundTab = await resolvePopupSidePanelBoundTab(sender);
  if (sidePanelBoundTab && sidePanelBoundTab.id) {
    return { ok: true, tab: sidePanelBoundTab, source: "sidePanel" };
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) {
      tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
  } catch {
    tabs = [];
  }
  return { ok: Boolean(tabs[0] && tabs[0].id), tab: tabs[0] || null, source: tabs[0] ? "activeTab" : "none" };
}

function getSpinnerQueueForTab(tabId) {
  return spinnerOperations.getSpinnerQueueForTab(tabId);
}

function serializeSpinnerQueue(tabId) {
  const queue = tabSpinnerQueueByTabId.get(tabId);
  if (!queue || queue.size === 0) {
    return [];
  }
  return [...queue.entries()].map(([key, entry]) => ({
    key,
    message: entry && typeof entry.message === "string" ? entry.message : "",
    persistent: Boolean(entry && entry.persistent),
    owner: entry && typeof entry.owner === "string" ? entry.owner : "",
    reason: entry && typeof entry.reason === "string" ? entry.reason : "",
    source: entry && typeof entry.source === "string" ? entry.source : "",
    startedAt: entry && Number.isFinite(entry.startedAt) ? entry.startedAt : 0
  }));
}

function buildBrokerState(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  const traceState = ensureTraceState(normalizedTabId);
  return {
    ok: Boolean(normalizedTabId),
    tabId: normalizedTabId,
    lifecycle: normalizedTabId ? (tabLifecycleStateByTabId.get(normalizedTabId) || null) : null,
    spinnerQueue: normalizedTabId ? serializeSpinnerQueue(normalizedTabId) : [],
    traceEnabled: isWorldTraceEnabled(),
    traceEvents: traceState && Array.isArray(traceState.events) ? [...traceState.events] : []
  };
}

const spinnerOperations = createSpinnerOperations({
  queueByTabId: tabSpinnerQueueByTabId,
  normalizeTabId: normalizeBrokerTabId,
  appendTrace: appendWorldTraceEvent,
  broadcastState: broadcastBrokerState,
  buildState: buildBrokerState,
  updateRuntimeSpinnerQueue(tabId, queue) {
    updateTabRuntime(tabId, {
      spinnerQueue: queue
    });
  }
});

function broadcastBrokerState(tabId) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return;
  }
  const ports = popupStatePortsByTabId.get(normalizedTabId);
  if (!ports || ports.size === 0) {
    return;
  }
  const state = buildBrokerState(normalizedTabId);
  ports.forEach((port) => {
    try {
      port.postMessage({ type: WORLD_MESSAGE_TYPES.BACKGROUND_STATE, state });
    } catch {
      ports.delete(port);
    }
  });
}

function updateLifecycleState(tabId, event = {}) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || !event || typeof event !== "object") {
    return buildBrokerState(normalizedTabId);
  }
  const previous = tabLifecycleStateByTabId.get(normalizedTabId) || {};
  const eventOperationId = typeof event.operationId === "string" && event.operationId
    ? event.operationId
    : "";
  const eventPhase = typeof event.phase === "string" && event.phase ? event.phase : "";
  const eventKind = typeof event.kind === "string" && event.kind ? event.kind : "";
  const isTerminalEvent = isLifecycleTerminalPhase(eventPhase);
  if (
    eventOperationId &&
    previous.operationId &&
    eventOperationId !== previous.operationId &&
    isTerminalEvent
  ) {
    // Superseded terminal lifecycle events must not tear down the current
    // operation's navigation-inspection curtain. Ignore stale terminal events
    // entirely and keep the active operation authoritative.
    return buildBrokerState(normalizedTabId);
  }
  // Authoritative curtain teardown: a terminal curtain-bearing event
  // (inspection/activation finished/failed) means that operation's persistent
  // navigation-inspection curtain is now stale, so drop it for this tab.
  // Routine terminal kinds (content-ready, which fires on every load) are
  // excluded so unrelated curtains are untouched.
  const clearsCurtain = isTerminalEvent && isCurtainBearingLifecycleKind(eventKind);
  if (clearsCurtain) {
    clearNavInspectCurtain(normalizedTabId);
  }
  const operationId = eventOperationId
    ? event.operationId
    : previous.operationId || `lifecycle:${normalizedTabId}:${Date.now()}`;
  const hasBusy = Object.prototype.hasOwnProperty.call(event, "busy");
  const next = {
    ...previous,
    ...event,
    operationId,
    kind: typeof event.kind === "string" && event.kind ? event.kind : previous.kind || LIFECYCLE_KINDS.UNKNOWN,
    phase: eventPhase || previous.phase || LIFECYCLE_PHASES.UNKNOWN,
    message: typeof event.message === "string" ? event.message : previous.message || "",
    busy: hasBusy ? Boolean(event.busy) : Boolean(previous.busy),
    updatedAt: Date.now()
  };
  tabLifecycleStateByTabId.set(normalizedTabId, next);
  updateTabRuntime(normalizedTabId, {
    lifecycle: next
  });
  appendWorldTraceEvent(normalizedTabId, "lifecycle", "state-update", next);
  broadcastBrokerState(normalizedTabId);
  return buildBrokerState(normalizedTabId);
}

// Drop the persistent navigation-inspection curtain spinner for a tab. Returns
// true if an entry was actually removed. Used by the authoritative
// terminal-lifecycle curtain teardown in updateLifecycleState.
function clearNavInspectCurtain(normalizedTabId) {
  const queue = tabSpinnerQueueByTabId.get(normalizedTabId);
  if (!queue || !queue.delete(SPINNER_KEYS.NAV_INSPECT)) {
    return false;
  }
  if (queue.size === 0) {
    tabSpinnerQueueByTabId.delete(normalizedTabId);
  }
  updateTabRuntime(normalizedTabId, {
    spinnerQueue: queue
  });
  appendWorldTraceEvent(normalizedTabId, "spinner", "remove", {
    type: WORLD_MESSAGE_TYPES.SPINNER_REMOVE,
    message: SPINNER_KEYS.NAV_INSPECT,
    reason: "lifecycle-terminal"
  });
  return true;
}

function setBackgroundSpinnerEntry(tabId, key, entry = {}) {
  return spinnerOperations.setBackgroundSpinnerEntry(tabId, key, {
    ...entry,
    reason: typeof entry.reason === "string" && entry.reason ? entry.reason : `spinner:${String(key)}`,
    source: typeof entry.source === "string" && entry.source ? entry.source : "background-spinner-broker"
  });
}

function removeBackgroundSpinnerEntry(tabId, key) {
  return spinnerOperations.removeBackgroundSpinnerEntry(tabId, key);
}

function clearBackgroundSpinnerQueue(tabId, options = {}) {
  return spinnerOperations.clearBackgroundSpinnerQueue(tabId, options);
}

async function withBackgroundTabSpinner(tabId, descriptor, work) {
  return spinnerOperations.withTabSpinner(tabId, descriptor, work);
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port || typeof port.name !== "string" || !port.name.startsWith(WORLD_PORTS.POPUP_STATE_PREFIX)) {
    return;
  }
  const tabId = normalizeBrokerTabId(port.name.slice(WORLD_PORTS.POPUP_STATE_PREFIX.length));
  if (!tabId) {
    try {
      port.disconnect();
    } catch {
      // Ignore invalid popup state ports.
    }
    return;
  }
  if (!popupStatePortsByTabId.has(tabId)) {
    popupStatePortsByTabId.set(tabId, new Set());
  }
  const ports = popupStatePortsByTabId.get(tabId);
  ports.add(port);
  try {
    port.postMessage({ type: WORLD_MESSAGE_TYPES.BACKGROUND_STATE, state: buildBrokerState(tabId) });
  } catch {
    ports.delete(port);
  }
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (ports.size === 0) {
      popupStatePortsByTabId.delete(tabId);
      clearBackgroundSpinnerQueue(tabId, { transientOnly: true });
    }
  });
});

initRemoteSupportBackground();
if (isFeatureEnabled("propertyLockCollaboration")) {
  initPropertyLockBackground();
}
installExtensionTelemetry({
  source: "worker",
  sendTelemetry(message) {
    if (!isFeatureEnabled("remoteSupport")) {
      return Promise.resolve(buildFeatureDisabledResponse("remoteSupport"));
    }
    return handleRemoteSupportBackgroundMessage(message, {});
  }
});
console.info("Unfluffify background worker ready");

async function resolveLivePageSiteId(options = {}) {
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const pageUrl = typeof options.pageUrl === "string" ? options.pageUrl.trim() : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue.trim() : "";
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!graphqlEndpoint || !pageUrl) {
    return { ok: false, siteId: null };
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {})
      },
      body: JSON.stringify({
        query: URL_SEARCH_INFO_QUERY,
        variables: {
          url: pageUrl,
          includePageInfo: false
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
      const notFound = payload.errors.some((item) => {
        const code =
          item &&
          item.extensions &&
          typeof item.extensions.code === "string"
            ? item.extensions.code
            : "";
        return code === "NotFound";
      });
      if (notFound) {
        return { ok: true, siteId: null, baseUrl: "", notFound: true };
      }
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    if (!response.ok || !payload) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    const urlSearchInfo = payload && payload.data ? payload.data.urlSearchInfo : null;
    const siteId = normalizeSiteIdValue(urlSearchInfo && urlSearchInfo.domainId);
    const baseUrl = normalizeBaseUrlFromDomainName(
      urlSearchInfo && urlSearchInfo.domainName,
      pageUrl
    );
    if (!siteId) {
      return { ok: true, siteId: null, baseUrl, notFound: true };
    }
    if (!baseUrl) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    return {
      ok: true,
      siteId,
      baseUrl,
      notFound: false
    };
  } catch {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
}

function normalizeBaseUrlFromDomainName(domainName, pageUrl = "") {
  if (typeof domainName !== "string") {
    return "";
  }
  const raw = domainName.trim();
  if (!raw) {
    return "";
  }
  let protocol = "https:";
  try {
    const page = new URL(pageUrl);
    if (page.protocol === "http:" || page.protocol === "https:") {
      protocol = page.protocol;
    }
  } catch {
    // Use HTTPS default.
  }
  let parsed = null;
  try {
    parsed = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(`${protocol}//${raw.replace(/^\/+/, "")}`);
  } catch {
    return "";
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return "";
  }
  const hostname = (parsed.hostname || "").trim().toLowerCase();
  if (!hostname) {
    return "";
  }
  let pathname = parsed.pathname || "/";
  pathname = pathname.replace(/\/+$/, "");
  if (!pathname) {
    pathname = "/";
  }
  const normalized = `${parsed.protocol}//${hostname}${pathname === "/" ? "" : pathname}`;
  return utils.normalizeCanonicalBaseUrl(normalized) || normalized;
}

function buildPropertyPageTypesSignature(pageTypes) {
  return JSON.stringify(
    Array.isArray(pageTypes)
      ? pageTypes.map((pageType) => [
          pageType && typeof pageType.key === "string" ? pageType.key : "",
          Array.isArray(pageType && pageType.candidates)
            ? pageType.candidates.map((candidate) => [
                candidate && typeof candidate.url === "string" ? candidate.url : "",
                Number.isFinite(candidate && candidate.wordsCount) ? candidate.wordsCount : 0,
                Boolean(candidate && candidate.duplicate) ? 1 : 0
              ])
            : []
        ])
      : []
  );
}

async function fetchLivePagePropertyPageTypes(options = {}) {
  const normalizedSiteId = normalizeSiteIdValue(options.siteId);
  const stageBase = typeof options.stageBase === "string" ? options.stageBase : "";
  const tokenValue = typeof options.tokenValue === "string" ? options.tokenValue.trim() : "";
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!normalizedSiteId || !graphqlEndpoint) {
    return {
      ok: false,
      pageTypes: [],
      reason: "Unable to verify Live Page candidates."
    };
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {})
      },
      body: JSON.stringify({
        query: PROPERTY_PAGE_TYPES_QUERY,
        variables: {
          domainId: normalizedSiteId
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || !payload || Array.isArray(payload.errors)) {
      return {
        ok: false,
        pageTypes: [],
        reason: "Unable to verify Live Page candidates."
      };
    }
    const normalized = normalizePropertyPageTypes(
      payload && payload.data
        ? payload.data.propertyPageTypes
        : null
    );
    return {
      ok: true,
      pageTypes: normalized.pageTypes || [],
      duplicateUrls: normalized.duplicateUrls || [],
      signature: buildPropertyPageTypesSignature(normalized.pageTypes)
    };
  } catch {
    return {
      ok: false,
      pageTypes: [],
      reason: "Unable to verify Live Page candidates."
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (isDebugFlagEnabled("fullWorldMessagingLogging")) {
    try {
      console.debug("[world-trace][background] runtime:inbound", {
        type: message.type,
        tabId: Number.isFinite(sender && sender.tab && sender.tab.id)
          ? Math.trunc(sender.tab.id)
          : null,
        frameId: Number.isFinite(sender && sender.frameId)
          ? Math.trunc(sender.frameId)
          : null
      });
    } catch {
      // Debug logging must never break runtime behavior.
    }
  }

  if (handleBackgroundCommandEnvelope(message, sender, sendResponse)) {
    return true;
  }

  if (REMOTE_SUPPORT_MESSAGE_TYPES.has(message.type)) {
    if (!isFeatureEnabled("remoteSupport")) {
      sendResponse(buildFeatureDisabledResponse("remoteSupport"));
      return;
    }
    handleRemoteSupportBackgroundMessage(message, sender)
      .then((result) => {
        sendResponse(result || { ok: false, error: "Remote support request failed" });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Remote support request failed" });
      });
    return true;
  }

  if (PROPERTY_LOCK_MESSAGE_TYPES.has(message.type)) {
    if (!isFeatureEnabled("propertyLockCollaboration")) {
      sendResponse(buildFeatureDisabledResponse("propertyLockCollaboration"));
      return;
    }
    handlePropertyLockBackgroundMessage(message, sender)
      .then((result) => {
        sendResponse(result || { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "resolvePopupTabContext") {
    resolvePopupTabContext(message, sender)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, tab: null, source: "error" }));
    return true;
  }

  if (message.type === "clearBrowsingDataForOrigin") {
    if (!isFeatureEnabled("cacheAndUnregisterTools")) {
      sendResponse(buildFeatureDisabledResponse("cacheAndUnregisterTools"));
      return;
    }
    const spinnerTabId = message.tabId || (sender && sender.tab && sender.tab.id);
    const runClear = spinnerTabId
      ? withBackgroundTabSpinner(
        spinnerTabId,
        {
          key: "clear-cache",
          message: "Clearing cache...",
          owner: SPINNER_OWNERS.POPUP,
          reason: "clear-cache",
          source: "background-command"
        },
        async () => clearBrowsingDataForOrigin(message.origin)
      )
      : clearBrowsingDataForOrigin(message.origin);
    runClear
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "Unable to clear cache" }));
    return true;
  }

  if (message.type === "reloadTab") {
    reloadTab(message.tabId || (sender.tab && sender.tab.id))
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "Unable to reload tab" }));
    return true;
  }

  if (message.type === "navigateTabToUrl") {
    navigateTabToUrl(message.tabId || (sender.tab && sender.tab.id), message.url)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "Unable to navigate tab" }));
    return true;
  }

  if (message.type === "getPersistedAiRunRecord") {
    getPersistedAiRunRecord()
      .then((record) => sendResponse({ ok: true, record }))
      .catch(() => sendResponse({ ok: false, record: null }));
    return true;
  }

  if (message.type === "savePersistedAiRunRecord") {
    savePersistedAiRunRecord(message.record)
      .then((record) => sendResponse({ ok: true, record }))
      .catch(() => sendResponse({ ok: false, record: null }));
    return true;
  }

  if (message.type === "clearPersistedAiRunRecord") {
    clearPersistedAiRunRecord()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "setAiComputeLockForTab") {
    setAiComputeLockForTab(
      message.tabId || (sender.tab && sender.tab.id),
      message.active,
      message.expiresAt,
      message.baseUrl
    )
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "AI compute lock failed" }));
    return true;
  }

  if (message.type === "refreshAiRunHeartbeat") {
    refreshAiRunHeartbeat({
      tabId: message.tabId || (sender.tab && sender.tab.id),
      sessionId: message.sessionId,
      siteId: message.siteId,
      deadlineAt: message.deadlineAt,
      baseUrl: message.baseUrl
    })
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, record: null, expiresAt: 0, lockApplied: false }));
    return true;
  }

  if (message.type === "requestAiRunStatus") {
    requestAiRunStatus({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      sessionId: message.sessionId
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "removeRemotePageMarking") {
    removeRemotePageMarking({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      siteId: message.siteId,
      url: message.url
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "validateAuthToken") {
    validateAuthToken({
      stageBase: message.stageBase,
      tokenValue: message.tokenValue
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "requestAuthLogin") {
    requestAuthLogin({
      stageBase: message.stageBase,
      email: message.email,
      password: message.password
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "submitSelectorSetGraphqlUpdate") {
    submitSelectorSetGraphqlUpdate({
      stageBase: message.stageBase,
      tokenValue: message.tokenValue,
      siteId: message.siteId,
      includeCss: message.includeCss,
      excludeCss: message.excludeCss,
      renderMode: message.renderMode
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "loadRemoteConfigSnapshot") {
    loadRemoteConfigSnapshot({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      siteId: message.siteId
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "saveRemoteConfigSnapshot") {
    saveRemoteConfigSnapshot({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      payloadKey: message.payloadKey
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "replaceServerConfigIntoLocalSnapshot") {
    replaceServerConfigIntoLocalSnapshot({
      payload: message.payload,
      payloadKey: message.payloadKey,
      currentPageUrl: message.currentPageUrl,
      siteId: message.siteId
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "mergeServerConfigIntoLocalSnapshot") {
    mergeServerConfigIntoLocalSnapshot({
      payload: message.payload,
      payloadKey: message.payloadKey,
      currentPageUrl: message.currentPageUrl,
      confirmedPageMarkings: message.confirmedPageMarkings,
      preferConfirmedPageMarkings: message.preferConfirmedPageMarkings,
      applyConfirmedToBackendSaved: message.applyConfirmedToBackendSaved
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "requestRenderModeDetection") {
    if (!isFeatureEnabled("renderModeAutoDetection")) {
      sendResponse(buildFeatureDisabledResponse("renderModeAutoDetection"));
      return;
    }
    requestRenderModeDetection({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      payloadKey: message.payloadKey
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "submitPageTypeAssignments") {
    submitPageTypeAssignments({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      payloadKey: message.payloadKey
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "requestAiRunStartSnapshot") {
    requestAiRunStartSnapshot({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      payloadKey: message.payloadKey
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "requestAiRunResultSnapshot") {
    requestAiRunResultSnapshot({
      endpointValue: message.endpointValue,
      tokenValue: message.tokenValue,
      sessionId: message.sessionId
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "prepareAiRunPayloadSnapshot") {
    prepareAiRunPayloadSnapshot({
      baseUrl: message.baseUrl,
      currentPageUrl: message.currentPageUrl,
      currentRenderMode: message.currentRenderMode
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "preparePageTypeAssignmentsSnapshot") {
    preparePageTypeAssignmentsSnapshot({
      baseUrl: message.baseUrl,
      checklistPageTypes: message.checklistPageTypes
    })
      .then((result) => sendResponse(result || { ok: false }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === WORLD_MESSAGE_TYPES.LIFECYCLE_EVENT) {
    const tabId = getMessageTabId(message, sender);
    const state = updateLifecycleState(tabId, message.event || {});
    sendResponse(state);
    return;
  }

  if (message.type === WORLD_MESSAGE_TYPES.SPINNER_SET) {
    sendResponse(setBackgroundSpinnerEntry(
      getMessageTabId(message, sender),
      message.key,
      {
        message: message.message,
        persistent: message.persistent,
        owner: message.owner,
        reason: message.reason,
        source: message.source,
        startedAt: message.startedAt
      }
    ));
    return;
  }

  if (message.type === WORLD_MESSAGE_TYPES.SPINNER_REMOVE) {
    sendResponse(removeBackgroundSpinnerEntry(getMessageTabId(message, sender), message.key));
    return;
  }

  if (message.type === WORLD_MESSAGE_TYPES.SPINNER_CLEAR) {
    sendResponse(clearBackgroundSpinnerQueue(getMessageTabId(message, sender), {
      transientOnly: Boolean(message.transientOnly)
    }));
    return;
  }

  if (message.type === "pageMotionFreezeControl") {
    executePageMotionFreezeControl(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: (error && error.message) || "Page motion control failed"
        });
      });
    return true;
  }

  if (message.type === "getTabState") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ enabled: false, baseUrl: "" });
      return;
    }
    const scope = typeof message.scope === "string" && message.scope ? message.scope : null;
    utils.getTabState(tabId, scope)
      .then((state) => {
        if (!state && message.nullIfMissing) {
          sendResponse(null);
          return;
        }
        sendResponse(state ? { ...state, tabId } : { enabled: false, baseUrl: "", tabId });
      })
      .catch(() => {
        sendResponse({ enabled: false, baseUrl: "", tabId });
      });
    return true;
  }

  if (message.type === "clearReloadRestoreTabState") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false });
      return;
    }
    clearReloadRestoreTabState(tabId)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "setTabState") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false });
      return;
    }
    const scope = typeof message.scope === "string" && message.scope ? message.scope : null;
    utils.getTabState(tabId, scope)
      .then((existingState) => {
        const existing = existingState && typeof existingState === "object"
          ? existingState
          : {};
        let nextState;
        if (message.state && typeof message.state === "object") {
          nextState = { ...existing };
          if (Object.prototype.hasOwnProperty.call(message.state, "active")) {
            nextState.active = Boolean(message.state.active);
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "enabled")) {
            nextState.enabled = Boolean(message.state.enabled);
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "baseUrl")) {
            nextState.baseUrl = typeof message.state.baseUrl === "string" ? message.state.baseUrl : "";
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "pageType")) {
            nextState.pageType = typeof message.state.pageType === "string" ? message.state.pageType : "";
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "desktopPreviewEnabled")) {
            nextState.desktopPreviewEnabled = isFeatureEnabled("desktopPreview") &&
              Boolean(message.state.desktopPreviewEnabled);
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "propertyLockOffCandidateDeadlineAt")) {
            if (isFeatureEnabled("propertyLockCollaboration")) {
              nextState.propertyLockOffCandidateDeadlineAt = Number.isFinite(message.state.propertyLockOffCandidateDeadlineAt)
                ? Number(message.state.propertyLockOffCandidateDeadlineAt)
                : 0;
            } else {
              nextState.propertyLockOffCandidateDeadlineAt = 0;
            }
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "propertyLockRecoverySiteId")) {
            if (isFeatureEnabled("propertyLockCollaboration")) {
              nextState.propertyLockRecoverySiteId = Number.isFinite(message.state.propertyLockRecoverySiteId)
                ? Number(message.state.propertyLockRecoverySiteId)
                : null;
            } else {
              nextState.propertyLockRecoverySiteId = null;
            }
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "propertyLockRecoveryBaseUrl")) {
            if (isFeatureEnabled("propertyLockCollaboration")) {
              nextState.propertyLockRecoveryBaseUrl = typeof message.state.propertyLockRecoveryBaseUrl === "string"
                ? message.state.propertyLockRecoveryBaseUrl
                : "";
            } else {
              nextState.propertyLockRecoveryBaseUrl = "";
            }
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "propertyLockRecoveryClientId")) {
            if (isFeatureEnabled("propertyLockCollaboration")) {
              nextState.propertyLockRecoveryClientId = typeof message.state.propertyLockRecoveryClientId === "string"
                ? message.state.propertyLockRecoveryClientId
                : "";
            } else {
              nextState.propertyLockRecoveryClientId = "";
            }
          }
          if (Object.prototype.hasOwnProperty.call(message.state, "propertyLockRecoveryDeadlineAt")) {
            if (isFeatureEnabled("propertyLockCollaboration")) {
              nextState.propertyLockRecoveryDeadlineAt = Number.isFinite(message.state.propertyLockRecoveryDeadlineAt)
                ? Number(message.state.propertyLockRecoveryDeadlineAt)
                : 0;
            } else {
              nextState.propertyLockRecoveryDeadlineAt = 0;
            }
          }
        } else {
          nextState = {
            ...existing,
            enabled: Boolean(message.enabled),
            baseUrl: message.baseUrl || ""
          };
          if (Object.prototype.hasOwnProperty.call(message, "pageType")) {
            nextState.pageType = typeof message.pageType === "string" ? message.pageType : "";
          }
        }
        return utils.setTabState(tabId, nextState, scope)
          .then(() => {
            if (scope) {
              return;
            }
            // Per the editor-mobile-only contract, marking enabled state does
            // not survive a navigation/refresh. Skip mirroring into the reload
            // restore scope; always clear any stale restore entry instead.
            return clearReloadRestoreTabState(tabId);
          });
      })
      .then(() => {
        utils.updateActionForTab(tabId).then();
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "setDeviceEmulation") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    const mode = message.mode === "mobile" ? "mobile" : "desktop";
    updateDeviceEmulation(tabId, {
      enabled: true,
      mode
    })
      .then((result) => {
        if (!result.ok) {
          sendResponse({
            ok: false,
            error: result.error || "Device emulation failed",
            reason: result.reason || (result.feature ? FEATURE_DISABLED_REASON : undefined),
            feature: result.feature
          });
          return;
        }
        sendResponse({ ok: true, state: result.state });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation failed" });
      });
    return true;
  }

  if (message.type === "updateDeviceEmulation") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    updateDeviceEmulation(tabId, {
      enabled: typeof message.enabled === "boolean" ? message.enabled : undefined,
      mode: message.mode,
      scale: message.scale,
      recalculateScale: Boolean(message.recalculateScale)
    })
      .then((result) => {
        if (!result.ok) {
          sendResponse({
            ok: false,
            error: result.error || "Device emulation failed",
            reason: result.reason || (result.feature ? FEATURE_DISABLED_REASON : undefined),
            feature: result.feature
          });
          return;
        }
        sendResponse({ ok: true, state: result.state });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation failed" });
      });
    return true;
  }

  if (message.type === "getDeviceEmulationState") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    reconcileDeviceEmulationState(tabId)
      .then((deviceState) => {
        sendResponse({ ok: true, state: deviceState });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation state unavailable" });
      });
    return true;
  }

  if (message.type === "clearTabState") {
    if (!message.tabId) {
      sendResponse({ ok: false });
      return;
    }
    utils.clearTabState(message.tabId)
      .then(() => clearReloadRestoreTabState(message.tabId))
      .then(() => {
        utils.updateActionForTab(message.tabId).then();
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "unregisterTabAndReload") {
    if (!isFeatureEnabled("cacheAndUnregisterTools")) {
      sendResponse(buildFeatureDisabledResponse("cacheAndUnregisterTools"));
      return;
    }
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    (async () => {
      try {
        await utils.disableExtensionForTab(tabId);
      } catch (error) {
        // Continue with hard state cleanup below.
      }
      await clearTrackedTabSessionState(tabId);
      await utils.updateActionForTab(tabId);
      try {
        await chrome.sidePanel.setOptions({
          tabId,
          path: "popup.html",
          enabled: false
        });
      } catch (error) {
        // Side panel may already be disabled for this tab.
      }
      await new Promise((resolve, reject) => {
        chrome.tabs.reload(tabId, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || "Unable to reload tab"));
            return;
          }
          resolve();
        });
      });
      sendResponse({ ok: true });
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: (error && error.message) || "Unable to unregister current tab"
      });
    });
    return true;
  }

  if (message.type === "injectContentScript") {
    if (!message.tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    utils.injectContentScript(message.tabId)
      .then((result) => {
        sendResponse(result);
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Script injection failed" });
      });
    return true;
  }

  if (message.type === "isScriptInjected") {
    if (!message.tabId) {
      sendResponse({ injected: false });
      return;
    }
    utils.isScriptInjected(message.tabId)
      .then((injected) => {
        sendResponse({ injected });
      })
      .catch(() => {
        sendResponse({ injected: false });
      });
    return true;
  }

  if (message.type === "idbGet") {
    utils.idbGet(message.keys)
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "IndexedDB get failed" });
      });
    return true;
  }

  if (message.type === "idbSet") {
    utils.idbSet(message.items)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "IndexedDB set failed" });
      });
    return true;
  }

  if (message.type === "idbRemove") {
    utils.idbRemove(message.keys)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "IndexedDB remove failed" });
      });
    return true;
  }

  if (message.type === "resolveLivePageSiteId") {
    resolveLivePageSiteId({
      stageBase: message.stageBase,
      pageUrl: message.pageUrl,
      tokenValue: message.tokenValue
    })
      .then((result) => {
        sendResponse(result || { ok: false, siteId: null });
      })
      .catch(() => {
        sendResponse({ ok: false, siteId: null });
      });
    return true;
  }

  if (message.type === "fetchLivePagePropertyPageTypes") {
    fetchLivePagePropertyPageTypes({
      siteId: message.siteId,
      stageBase: message.stageBase,
      tokenValue: message.tokenValue
    })
      .then((result) => {
        sendResponse(result || {
          ok: false,
          pageTypes: [],
          reason: "Unable to verify Live Page candidates."
        });
      })
      .catch(() => {
        sendResponse({
          ok: false,
          pageTypes: [],
          reason: "Unable to verify Live Page candidates."
        });
      });
    return true;
  }

  if (message.type === "fetchStaticPageHtml") {
    const targetUrl = typeof message.url === "string" ? message.url.trim() : "";
    let parsedUrl = null;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (error) {
      sendResponse({ ok: false, error: "Invalid URL" });
      return;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      sendResponse({ ok: false, error: "Unsupported URL" });
      return;
    }
    (async () => {
      try {
        const response = await fetch(parsedUrl.toString(), {
          method: "GET",
          credentials: "include",
          redirect: "follow",
          cache: "no-store"
        });
        if (!response.ok) {
          sendResponse({
            ok: false,
            status: response.status || 0,
            error: "Static HTML request failed"
          });
          return;
        }
        const html = await response.text();
        sendResponse({
          ok: true,
          status: response.status || 200,
          url: response.url || parsedUrl.toString(),
          html
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: (error && error.message) || "Static HTML request failed"
        });
      }
    })();
    return true;
  }

});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTrackedTabSessionState(tabId, { includeDeviceState: true }).then();
  if (isFeatureEnabled("propertyLockCollaboration")) {
    handlePropertyLockBackgroundTabRemoved(tabId);
  }
  handleRemoteSupportTabRemoved(tabId).then();
  tabLifecycleStateByTabId.delete(tabId);
  tabSpinnerQueueByTabId.delete(tabId);
  tabWorldTraceStateByTabId.delete(tabId);
  aiComputeLockExpiresAtByTabId.delete(tabId);
  deleteTabRuntime(tabId);
});

async function disableExtensionOnTopLevelNavigation(details) {
  if (details.frameId !== 0) {
    return;
  }
  const tabId = details.tabId;
  if (!tabId) {
    return;
  }
  if (isAiComputeLockActiveForTab(tabId)) {
    return;
  }
  const state = await utils.getTabState(tabId);
  if (!state || !state.enabled) {
    return;
  }
  // Editor-mobile-only contract: marking never survives a navigation or reload.
  // Every top-level navigation/reload is a fresh start — marking is turned OFF
  // and the tab returns to its just-loaded posture (silent mode if the property
  // has backend-saved markings, otherwise idle). Do NOT preserve enabled state
  // for same-base navigations; preserving it re-seeds a stale marking session on
  // reload and corrupts the clean initial-load reveal/freeze flow.
  await clearReloadRestoreTabState(tabId);
  await utils.disableExtensionForTab(tabId);
}

// Use onCommitted (not onBeforeNavigate) so we only disable marking when the
// navigation actually commits. onBeforeNavigate fires before the browser shows
// the "Leave site?" dialog; if the user clicks "Stay", the navigation is
// cancelled but we would have already torn down the marking session.
chrome.webNavigation.onCommitted.addListener(disableExtensionOnTopLevelNavigation);

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) {
    return;
  }
  const tabId = details.tabId;
  if (!tabId) {
    return;
  }
  try {
    await clearDeviceEmulationAfterNavigation(tabId);
  } catch (error) {
    // Ignore — the tab may have already navigated away or been closed.
  }
});
chrome.webNavigation.onHistoryStateUpdated.addListener(disableExtensionOnTopLevelNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(disableExtensionOnTopLevelNavigation);

chrome.debugger.onDetach.addListener(async (source) => {
  if (!source || !source.tabId) {
    return;
  }
  const tabState = await utils.getTabState(source.tabId);
  if (tabState && tabState.enabled) {
    updateDeviceEmulation(source.tabId, {
      enabled: true,
      mode: "mobile",
      recalculateScale: true
    }).catch(() => {});
    return;
  }
  const initialState = await utils.getTabState(source.tabId, "initial");
  if (initialState && initialState.desktopPreviewEnabled) {
    await utils.setTabState(source.tabId, {
      ...initialState,
      active: Boolean(initialState.active),
      desktopPreviewEnabled: false
    }, "initial");
    updateDeviceEmulation(source.tabId, {
      enabled: true,
      mode: "mobile",
      recalculateScale: true
    }).catch(() => {});
    return;
  }
  const state = await getDeviceEmulationState(source.tabId);
  if (!state.enabled) {
    return;
  }
  await chrome.storage.session.set({
    [`${DEVICE_EMULATION_PREFIX}${source.tabId}`]: { ...state, enabled: false }
  });
});

async function refreshActionIconsForWindow(windowId) {
  if (!windowId || windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch (error) {
    tabs = [];
  }
  await Promise.all(
    tabs
      .map((tab) => (tab && tab.id ? utils.updateActionForTab(tab.id) : null))
      .filter(Boolean)
  );
}

chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  await refreshActionIconsForWindow(windowId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await refreshActionIconsForWindow(windowId);
});

const TAB_RESTORE_SCOPE = "restore";

async function clearTrackedTabSessionState(tabId, options = {}) {
  if (!tabId) {
    return;
  }
  const { includeDeviceState = false } = options;
  await utils.clearTabState(tabId);
  await clearReloadRestoreTabState(tabId);
  const keysToRemove = [
    `${SCRIPT_INJECTED_PREFIX}${tabId}`
  ];
  if (includeDeviceState) {
    keysToRemove.push(`${DEVICE_EMULATION_PREFIX}${tabId}`);
  }
  await utils.storageRemove(chrome.storage.session, keysToRemove);
}

function getReloadRestoreTabStateKey(tabId) {
  return `${TAB_STATE_PREFIX}${TAB_RESTORE_SCOPE}:${tabId}`;
}

async function clearReloadRestoreTabState(tabId) {
  if (!tabId) {
    return;
  }
  await utils.storageRemove(chrome.storage.session, [getReloadRestoreTabStateKey(tabId)]);
}

async function clearReloadRestoreTabStateAfterActivation(tabId, tabState) {
  if (!tabId || !tabState || !tabState.enabled || !tabState.baseUrl) {
    return;
  }
  await clearReloadRestoreTabState(tabId);
}

function requestContentActivation(tabId, attempt = 0) {
  if (!tabId) {
    return;
  }
  chrome.tabs.sendMessage(tabId, { type: "activateContentMain" }, { frameId: 0 }, () => {
    if (chrome.runtime.lastError && attempt < 3) {
      setTimeout(() => requestContentActivation(tabId, attempt + 1), 200);
      return;
    }
    void chrome.runtime.lastError;
  });
}

function restoreEnabledStateForTab(tabId, tabState, attempt = 0) {
  if (!tabId || !tabState || !tabState.enabled || !tabState.baseUrl) {
    return;
  }
  const operationId = `activation:${tabId}:${Date.now()}:${attempt}`;
  updateLifecycleState(tabId, {
    operationId,
    kind: LIFECYCLE_KINDS.ACTIVATION,
    phase: LIFECYCLE_PHASES.STARTED,
    busy: true,
    message: "Inspecting page..."
  });
  chrome.tabs.sendMessage(
    tabId,
    {
      type: "setEnabled",
      enabled: true,
      baseUrl: tabState.baseUrl,
      pageType: typeof tabState.pageType === "string" ? tabState.pageType : "",
      performInitialReveal: true,
      operationId
    },
    { frameId: 0 },
    (response) => {
      if (chrome.runtime.lastError || !response || response.ok === false) {
        if (attempt < 4 && !(response && response.locked)) {
          setTimeout(() => restoreEnabledStateForTab(tabId, tabState, attempt + 1), 200);
        } else {
          updateLifecycleState(tabId, {
            operationId,
            kind: LIFECYCLE_KINDS.ACTIVATION,
            phase: LIFECYCLE_PHASES.FAILED,
            busy: false,
            message: ""
          });
        }
        return;
      }
      void chrome.runtime.lastError;
      clearReloadRestoreTabStateAfterActivation(tabId, tabState).catch(() => {});
    }
  );
}

async function getTabUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return (tab && typeof tab.url === "string") ? tab.url : "";
  } catch (error) {
    return "";
  }
}

async function ensureDefaultMobileEmulationForTab(tabId, tabUrl = "") {
  if (!tabId) {
    return null;
  }
  const resolvedUrl = typeof tabUrl === "string" && tabUrl
    ? tabUrl
    : await getTabUrl(tabId);
  if (!utils.getOriginFromUrl(resolvedUrl)) {
    return null;
  }
  try {
    const result = await ensureDefaultMobileDeviceEmulation(tabId);
    if (!result || !result.ok) {
      if (result && result.error) {
        console.warn("Default mobile emulation failed:", result.error);
      }
      return null;
    }
    return result.state;
  } catch (error) {
    console.warn("Default mobile emulation failed:", error);
    return null;
  }
}

async function activateExtensionForTab(tabId, tabUrl = "") {
  if (!tabId) {
    return { ok: false };
  }
  await utils.setTabState(tabId, { active: true }, "initial");
  await utils.updateActionForTab(tabId);
  await ensureDefaultMobileEmulationForTab(tabId, tabUrl);
  requestContentActivation(tabId);
  return { ok: true };
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tabId || !tab) {
    return;
  }
  if (changeInfo.status !== "complete") {
    return;
  }
  if (!((await utils.getTabState(tabId, 'initial')) || {active: false}).active)
  {
    return;
  }
  // Per the editor-mobile-only contract, marking does not auto-restore on
  // page-load. The restore scope is never populated. We still read live tab
  // state so that the content-activation path (requestContentActivation) can
  // re-inject the content script for already-enabled tabs that navigated
  // within the same base URL.
  const tabState = await utils.getTabState(tabId);
  if (
    tabState &&
    tabState.enabled &&
    tabState.baseUrl &&
    !utils.isPageWithinBaseUrl(tab.url || "", tabState.baseUrl)
  ) {
    await utils.disableExtensionForTab(tabId);
    return;
  }
  requestContentActivation(tabId);
  // restoreEnabledStateForTab is a no-op when tabState is null/disabled (the
  // common case now that auto-restore is retired) but is kept to preserve the
  // activation path for developer-console re-injection scenarios.
  restoreEnabledStateForTab(tabId, tabState);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") {
    return;
  }
  Object.keys(changes).forEach((key) => {
    if (!key.startsWith(TAB_STATE_PREFIX)) {
      return;
    }
    const tabId = Number(key.slice(TAB_STATE_PREFIX.length));
    if (!Number.isNaN(tabId)) {
      utils.updateActionForTab(tabId).then();
    }
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "popup.html",
      enabled: true
    }).then();
    chrome.sidePanel.open({ tabId: tab.id }).then();
  }
});

// Sweep orphaned transfer-payload keys on every service-worker start.
// This keeps session storage tidy when an AI run or config sync was aborted
// mid-flight and did not reach the consume-purge step.
sweepStaleTransferPayloads().then();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "activateContentForTab") {
    return;
  }
  if (isDebugFlagEnabled("fullWorldMessagingLogging")) {
    try {
      console.debug("[world-trace][background] runtime:inbound", {
        type: message.type,
        tabId: Number.isFinite(message && message.tabId)
          ? Math.trunc(message.tabId)
          : (Number.isFinite(sender && sender.tab && sender.tab.id)
            ? Math.trunc(sender.tab.id)
            : null)
      });
    } catch {
      // Debug logging must never break runtime behavior.
    }
  }
  const tabId = message.tabId || (sender.tab && sender.tab.id);
  if (!tabId) {
    sendResponse({ ok: false });
    return;
  }
  (async () => {
    await activateExtensionForTab(
      tabId,
      (sender.tab && sender.tab.url) || message.url || ""
    );
    sendResponse({ ok: true });
  })().catch(() => {
    requestContentActivation(tabId);
    sendResponse({ ok: true });
  });
  return true;
});
