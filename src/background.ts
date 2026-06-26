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
import { browser, callBrowserApi, callBrowserApiVoid, type Browser } from "./common/browser.js";
import * as configStore from "./common/config.js";
import { runPageMotionFreezeControl } from "./common/page-motion-freeze-control.js";
import {
  clearDeviceEmulationState,
  clearDeviceEmulationAfterNavigation,
  ensureDefaultMobileDeviceEmulation,
  getDeviceEmulationState,
  reconcileDeviceEmulationState,
  setDeviceEmulationEnabled,
  updateDeviceEmulation
} from "./common/emulation.js";
import {
  FEATURE_DISABLED_REASON,
  isDebugFlagEnabled,
  isFeatureEnabled
} from "./common/feature-flags.js";
import {
  SPINNER_REQUEST_TYPES,
  type SpinnerClearRequestPayload,
  type SpinnerRemoveRequestPayload,
  type SpinnerSetRequestPayload
} from "./common/bus/contracts/spinner.js";
import { REALMS } from "./common/bus/realms.js";
import type { PopupLifecycleState } from "./common/bus/contracts/popup-state.js";
import * as constants from "./common/constants.js";
import {
  normalizeSiteIdValue
} from "./common/lynx-live-pages.js";
import {
  getPropertyLockConnectionDiagnostics,
  handlePropertyLockBackgroundMessage,
  handlePropertyLockBackgroundTabRemoved,
  initPropertyLockBackground
} from "./common/property-lock-background.js";
import {
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  SPINNER_OWNERS,
  isLifecycleTerminalPhase,
  WORLD_MESSAGE_TYPES
} from "./common/world-messaging-contract.js";
import {
  AI_RUN_POLL_INTERVAL_MS,
  AI_RUN_PERSIST_KEY,
  AI_RUN_TIMEOUT_MS,
  buildAiSubmissionXpaths,
  getAiRunResumeExpiresAt,
  normalizePersistedAiRunRecord
} from "./popup/ai-run.js";
import {
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
  createRequestEnvelope,
  createFailureEnvelope,
  isReplyEnvelope,
  isRequestEnvelope,
  type RequestEnvelope
} from "./common/message-protocol.js";
import type {
  RenderModeSnapshotPayload,
  RenderModeEndInspectionPayload,
  RenderModeEndInspectionReply,
  RenderModeRunInspectionOperationReply,
  RenderModeRunInspectionPayload,
} from "./common/bus/contracts/render-mode.js";
import { RENDER_MODE_REQUEST_TYPES } from "./common/bus/contracts/render-mode.js";
import {
  consumeTransferPayload,
  getTransferPayload,
  putTransferPayload,
  removeTransferPayload,
  sweepStaleTransferPayloads
} from "./background/transfer-payload-store.js";
import {
  clearPersistedAiRunRecord,
  getPersistedAiRunRecord,
  savePersistedAiRunRecord
} from "./background/ai-run-record-store.js";
import { redactCommandPayloadForLedger } from "./background/command-ledger.js";
import {
  fetchLivePagePropertyPageTypes,
  resolveLivePageSiteId
} from "./background/live-page-client.js";
import {
  requestAuthLogin,
  resolveBackgroundNetworkCredentials,
  validateAuthToken
} from "./background/network-core.js";
import {
  fetchStaticPageHtmlForBackground,
  loadRemoteConfigSnapshot,
  removeRemotePageMarking,
  requestAiRunResultSnapshot,
  requestAiRunStartSnapshot,
  requestAiRunStatus,
  requestRenderModeDetection,
  saveRemoteConfigSnapshot,
  submitPageTypeAssignments,
  submitSelectorSetGraphqlUpdate
} from "./background/remote-network.js";
import {
  mergeServerConfigIntoLocalSnapshot,
  preparePageTypeAssignmentsSnapshot,
  replaceServerConfigIntoLocalSnapshot
} from "./background/remote-config-sync.js";
import {
  createWorldTrace,
  WORLD_TRACE_EVENT_LIMIT
} from "./background/world-trace.js";
import { createPopupStateBroker } from "./background/popup-state-broker.js";
import type { PopupBrokerState } from "./background/popup-state-broker.js";
import { createRenderModeInspector } from "./background/render-mode-inspector.js";
import { createTabOperationRunner } from "./background/tab-operation-runner.js";
import { createTabInactivityObserver } from "./background/tab-inactivity-observer.js";
import { createAiRunOrchestrator } from "./background/ai-run-orchestrator.js";
import { runBackgroundTask } from "./background/async-tasks.js";
import { createManagedTimeoutGroup } from "./background/managed-timeouts.js";
import { createSwKeepAlive } from "./background/sw-keepalive.js";
import { createBrain } from "./background/brain/index.js";
import {
  aiComputeLockExpiresAtByTabId,
  disposeTabState,
  pageMotionFreezeControlQueueByTarget,
  tabLifecycleStateByTabId,
  tabSpinnerQueueByTabId,
  tabWorldTraceStateByTabId
} from "./background/background-tab-state.js";
import {
  clearRenderModeNoJsHeld,
  isRenderModeNoJsHeld,
  listRenderModeNoJsHeldTabIds,
  setRenderModeNoJsHeld
} from "./common/render-mode-js-state.js";
import {
  clearTrackedTabSessionState as clearStoredTrackedTabSessionState,
  clearTabStateScope,
  getTabState as getStoredTabState,
  parseTabStateStorageKey,
  queueTabSessionWrite,
  setTabState as setStoredTabState
} from "./background/tab-session-store.js";
import { createBusProtocolBridge } from "./common/bus/transport/bus-protocol-bridge.js";
import { BUS_PORT_PREFIX } from "./common/bus/transport/transport-types.js";
import type {
  TabOperationContext,
  TabOperationDescriptor,
  TabOperationSpinnerContext,
  TabOperationResult,
  TabOperationWork,
  TabSpinnerDescriptor
} from "./types/operations.js";
import type { RuntimeMessage, RuntimeMessageReply } from "./types/messaging.js";

type FeatureDisabledResponse = {
  ok: false;
  reason: typeof FEATURE_DISABLED_REASON;
  feature: string;
  error: string;
};

type ContentMessageResponse = {
  ok: boolean;
  error?: string;
  reconciliationPending?: boolean;
  locked?: boolean;
};

type ContentBootstrapResult =
  | { ok: true; tabId: number }
  | { ok: false; tabId?: number; error: string };

type BackgroundCommandError = Error & {
  code: string;
  details: Record<string, unknown>;
};

type RenderModeNoJsRestoreResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

type RenderModeHtmlCaptureResult = {
  ok: boolean;
  pageUrl: string;
  renderedHtml: string;
  rawHtml: string;
  renderMode: string;
  hiddenCount: number;
  error: string;
};

type BackgroundCommandRequest = RequestEnvelope<Record<string, unknown>>;

type BackgroundSpinnerEntry = Record<string, unknown> & {
  reason?: string;
  source?: string;
};

type BackgroundSpinnerQueue = Map<string, BackgroundSpinnerEntry>;

type PageMotionFreezeControlTarget = {
  tabId: number;
  frameIds?: number[];
};

type PageMotionFreezeControlResult = {
  ok: boolean;
  error?: string;
};

type PopupContextSender = Browser.runtime.MessageSender & {
  documentId?: string;
};

type PopupTabContextResult = {
  ok: boolean;
  tab: Browser.tabs.Tab | null;
  source: "debug" | "sidePanel" | "activeTab" | "none";
};

type BackgroundOperationResult = {
  ok: boolean;
  error?: string;
};

type RenderModeRecoveryOptions = {
  waitForDetach?: boolean;
  requireLoadComplete?: boolean;
};

type RenderModeDetachResult = BackgroundOperationResult & {
  keptForDeviceEmulation?: boolean;
  detachPending?: boolean;
};

type RenderModeReloadRecoveryResult = BackgroundOperationResult & {
  loadCompleted?: boolean;
  detachResult?: RenderModeDetachResult;
};

type TabStateRecord = Record<string, unknown> & {
  active?: boolean;
  enabled?: boolean;
  baseUrl?: string;
  pageType?: string;
  propertyLockOffCandidateDeadlineAt?: number;
  propertyLockRecoverySiteId?: number | null;
  propertyLockRecoveryBaseUrl?: string;
  propertyLockRecoveryClientId?: string;
  propertyLockRecoveryDeadlineAt?: number;
};

type TopLevelNavigationDetails = {
  frameId?: number;
  tabId?: number;
};

type TrackedTabSessionClearOptions = {
  includeDeviceState?: boolean;
};

type SessionStorageChanges = Record<string, unknown>;

type DefaultMobileEmulationState = {
  enabled: boolean;
  mode: "mobile" | "desktop";
  scale: number;
};

function buildFeatureDisabledResponse(featureName: string): FeatureDisabledResponse {
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
const RENDER_MODE_NO_JS_INACTIVITY_SCOPE = "render-mode-no-js";
const RENDER_MODE_NO_JS_INACTIVITY_TIMEOUT_MS = 30_000;
const backgroundSpinnerQueueByTabId = tabSpinnerQueueByTabId as Map<number, BackgroundSpinnerQueue>;
const pageMotionFreezeControlQueue =
  pageMotionFreezeControlQueueByTarget as Map<string, Promise<PageMotionFreezeControlResult>>;

function normalizeBrokerTabId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function normalizeSpinnerTabId(value: unknown): number {
  return normalizeBrokerTabId(value) || 0;
}

function asTabStateRecord(value: unknown): TabStateRecord | null {
  return value && typeof value === "object" ? value as TabStateRecord : null;
}

const worldTrace = createWorldTrace({
  traceStateByTabId: tabWorldTraceStateByTabId,
  normalizeTabId: normalizeBrokerTabId,
  isFeatureEnabled,
  isDebugFlagEnabled,
  eventLimit: WORLD_TRACE_EVENT_LIMIT
});
const ensureTraceState = worldTrace.ensureTraceState;
const isWorldTraceEnabled = worldTrace.isWorldTraceEnabled;
const appendWorldTraceEvent = worldTrace.appendWorldTraceEvent;
const busProtocolBridge = createBusProtocolBridge();
const brain = createBrain({ logger: console });
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
  TAB_RUN_AI: "TAB_RUN_AI"
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
  BACKGROUND_COMMANDS.TAB_RUN_AI
]);
const POPUP_TAB_COMMAND_POLICY = Object.freeze({
  allowedSources: [MESSAGE_SOURCES.POPUP],
  tabIdPolicy: "message",
  requireTab: true
});
const RENDER_MODE_INSPECTION_START_TIMEOUT_MS = 8000;
const RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS = 15000;
const RENDER_MODE_INSPECTION_OPERATION_TIMEOUT_MS = 60000;

async function getBrowserTab(tabId: number): Promise<Browser.tabs.Tab | undefined> {
  return callBrowserApi<Browser.tabs.Tab | undefined>(
    (api, callback) => api.tabs.get(tabId, callback),
    (api) => api.tabs.get(tabId)
  );
}

async function queryBrowserTabs(query: Browser.tabs.QueryInfo): Promise<Browser.tabs.Tab[]> {
  return callBrowserApi<Browser.tabs.Tab[]>(
    (api, callback) => api.tabs.query(query, callback),
    (api) => api.tabs.query(query)
  );
}

async function reloadBrowserTab(tabId: number) {
  return callBrowserApiVoid(
    (api, callback) => api.tabs.reload(tabId, callback),
    (api) => api.tabs.reload(tabId)
  );
}

async function updateBrowserTab(tabId: number, updateProperties: Browser.tabs.UpdateProperties): Promise<Browser.tabs.Tab | undefined> {
  return callBrowserApi<Browser.tabs.Tab | undefined>(
    (api, callback) => api.tabs.update(tabId, updateProperties, callback),
    (api) => api.tabs.update(tabId, updateProperties)
  );
}

async function sendBrowserTabMessage(
  tabId: number,
  message: unknown,
  options: { frameId?: number } | undefined = undefined
): Promise<object | undefined> {
  return callBrowserApi<object | undefined>(
    (api, callback) => (
      options
        ? api.tabs.sendMessage(tabId, message, options, callback)
        : api.tabs.sendMessage(tabId, message, callback)
    ),
    (api) => (
      options
        ? api.tabs.sendMessage(tabId, message, options)
        : api.tabs.sendMessage(tabId, message)
    )
  );
}

async function getBrowserWindow(windowId: number): Promise<Browser.windows.Window> {
  return callBrowserApi<Browser.windows.Window>(
    (api, callback) => api.windows.get(windowId, callback),
    (api) => api.windows.get(windowId)
  );
}

async function sendBrowserDebuggerCommand(
  target: { tabId: number },
  method: string,
  params?: Record<string, unknown>
): Promise<object | undefined> {
  return callBrowserApi<object | undefined>(
    (api, callback) => api.debugger.sendCommand(target, method, params, callback),
    (api) => api.debugger.sendCommand(target, method, params)
  );
}

async function setBrowserSidePanelOptions(options: { tabId?: number; path?: string; enabled?: boolean }) {
  return callBrowserApiVoid(
    (api, callback) => api.sidePanel.setOptions(options, callback),
    (api) => Promise.resolve(api.sidePanel.setOptions(options))
  );
}

async function openBrowserSidePanel(options: { tabId: number }) {
  return callBrowserApiVoid(
    (api, callback) => api.sidePanel.open(options, callback),
    (api) => Promise.resolve(api.sidePanel.open(options))
  );
}

function clearBrowsingDataForOrigin(origin: unknown): Promise<BackgroundOperationResult> {
  if (!origin || typeof origin !== "string") {
    return Promise.resolve({ ok: false, error: "Missing origin" });
  }
  return callBrowserApiVoid(
    (api, callback) => api.browsingData.remove(
      { origins: [origin] },
      {
        cookies: true,
        cacheStorage: true,
        localStorage: true,
        indexedDB: true,
        serviceWorkers: true
      },
      callback
    ),
    (api) => api.browsingData.remove(
      { origins: [origin] },
      {
        cookies: true,
        cacheStorage: true,
        localStorage: true,
        indexedDB: true,
        serviceWorkers: true
      }
    )
  )
    .then(() => ({ ok: true }))
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to clear cache"
    }));
}

function reloadTab(tabId: unknown) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return Promise.resolve({ ok: false, error: "Missing tab" });
  }
  return reloadBrowserTab(normalizedTabId)
    .then(() => ({ ok: true }))
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to reload tab"
    }));
}

function navigateTabToUrl(tabId: unknown, url: unknown) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  const targetUrl = typeof url === "string" ? url.trim() : "";
  if (!normalizedTabId || !targetUrl) {
    return Promise.resolve({ ok: false, error: "Missing tab or URL" });
  }
  return updateBrowserTab(normalizedTabId, { url: targetUrl })
    .then(() => ({ ok: true }))
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to navigate tab"
    }));
}

function sendContentMessageToTab(
  tabId: unknown,
  message: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<ContentMessageResponse> {
  return new Promise<ContentMessageResponse>((resolve) => {
    const normalizedTabId = normalizeBrokerTabId(tabId);
    if (!normalizedTabId) {
      resolve({ ok: false, error: "Missing tab" });
      return;
    }
    let settled = false;
    const finish = (result: ContentMessageResponse) => {
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
    sendBrowserTabMessage(
      normalizedTabId,
      message,
      { frameId: 0 }
    )
      .then((response) => {
        finish(response && typeof response === "object"
          ? response as ContentMessageResponse
          : { ok: false });
      })
      .catch((error) => {
        finish({
          ok: false,
          error: error instanceof Error ? error.message : "Content message failed"
        });
      });
  });
}

function waitForBackgroundRetryDelay(delayMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function ensureContentMainForTab(tabId: unknown): Promise<ContentBootstrapResult> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return { ok: false, error: "Missing tab" };
  }
  brain.updateActivationBootstrapState(normalizedTabId, {
    contentReady: false,
    bootstrapStatus: "bootstrapping",
    lastError: ""
  }, "background:ensure-content-main:start");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await sendContentMessageToTab(normalizedTabId, {
      type: "activateContentMain"
    });
    if (response && response.ok) {
      brain.updateActivationBootstrapState(normalizedTabId, {
        contentReady: true,
        bootstrapStatus: "ready",
        lastError: ""
      }, "background:ensure-content-main:ready");
      return { ok: true, tabId: normalizedTabId };
    }
    const injection = await utils.injectContentScript(normalizedTabId, { force: true });
    if (injection && injection.ok) {
      const retryResponse = await sendContentMessageToTab(normalizedTabId, {
        type: "activateContentMain"
      });
      if (retryResponse && retryResponse.ok) {
        brain.updateActivationBootstrapState(normalizedTabId, {
          contentReady: true,
          bootstrapStatus: "ready",
          lastError: ""
        }, "background:ensure-content-main:ready");
        return { ok: true, tabId: normalizedTabId };
      }
    }
    if (attempt < 4) {
      await waitForBackgroundRetryDelay(150 * (attempt + 1));
    }
  }
  brain.updateActivationBootstrapState(normalizedTabId, {
    contentReady: false,
    bootstrapStatus: "failed",
    lastError: "Content activation failed"
  }, "background:ensure-content-main:failed");
  return { ok: false, tabId: normalizedTabId, error: "Content activation failed" };
}

function createBackgroundCommandError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): BackgroundCommandError {
  const error = new Error(message || "Background command failed") as BackgroundCommandError;
  error.code = typeof code === "string" && code ? code : MESSAGE_ERROR_CODES.HANDLER_FAILED;
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function normalizeActivationBaseUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return utils.normalizeCanonicalBaseUrl(value) || utils.normalizeBaseUrl(value) || value.trim();
}

const renderModeInspector = createRenderModeInspector({
  sendContentMessageToTab,
  requestContentRenderMode: (type, payload, tabId) => brain.bus.request(type, payload, {
    target: REALMS.CONTENT,
    tab: tabId,
  }),
  ensureContentMainForTab,
  waitForBackgroundRetryDelay,
  updateTabRuntime,
  createManagedTimeoutGroup,
  startTimeoutMs: RENDER_MODE_INSPECTION_START_TIMEOUT_MS,
  loadTimeoutMs: RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS
});
const normalizeRenderModeOperationId = renderModeInspector.normalizeRenderModeOperationId;
const waitForTabLoadStartInBackground = renderModeInspector.waitForTabLoadStartInBackground;
const waitForTabLoadCompleteInBackground = renderModeInspector.waitForTabLoadCompleteInBackground;
const ensureContentReadyForRenderModeInspectionInBackground = renderModeInspector.ensureContentReadyForRenderModeInspectionInBackground;
const sendRenderModeInspectionEndWithRetry = renderModeInspector.sendRenderModeInspectionEndWithRetry;
const runRenderModeInspectionBeginStep = renderModeInspector.runRenderModeInspectionBeginStep;
const runRenderModeRevealFreezeStep = renderModeInspector.runRenderModeRevealFreezeStep;
const runRenderModeHideConsentStep = renderModeInspector.runRenderModeHideConsentStep;
const runRenderModeCaptureHtmlStep = renderModeInspector.runRenderModeCaptureHtmlStep;

const tabInactivityObserver = createTabInactivityObserver({
  defaultTimeoutMs: RENDER_MODE_NO_JS_INACTIVITY_TIMEOUT_MS
});

async function isTabActiveInFocusedWindow(tabId: unknown): Promise<boolean> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return false;
  }
  try {
    const tab = await getBrowserTab(normalizedTabId);
    if (!tab || !tab.active || !Number.isFinite(tab.windowId)) {
      return false;
    }
    const windowInfo = await getBrowserWindow(tab.windowId);
    return Boolean(windowInfo && windowInfo.focused);
  } catch {
    return false;
  }
}

async function updateRenderModeNoJsInactivityWatch(tabId: unknown): Promise<void> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return;
  }
  if (!(await isRenderModeNoJsHeld(normalizedTabId))) {
    await tabInactivityObserver.clearTab(normalizedTabId, {
      scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE
    });
    return;
  }
  if (await isTabActiveInFocusedWindow(normalizedTabId)) {
    await tabInactivityObserver.clearTab(normalizedTabId, {
      scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE
    });
    return;
  }
  await tabInactivityObserver.scheduleInactive(normalizedTabId, {
    scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE,
    reason: "render-mode-no-js-held-inactive",
    timeoutMs: RENDER_MODE_NO_JS_INACTIVITY_TIMEOUT_MS
  });
}

async function updateRenderModeNoJsInactivityWatches() {
  const heldTabIds = await listRenderModeNoJsHeldTabIds();
  await Promise.all(heldTabIds.map((tabId) => updateRenderModeNoJsInactivityWatch(tabId)));
}

async function restoreRenderModeJavaScriptAfterNoJsInactivity(
  tabId: unknown,
): Promise<RenderModeNoJsRestoreResult> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || !(await isRenderModeNoJsHeld(normalizedTabId))) {
    return { ok: true, skipped: true };
  }
  // The tab may have become active and focused between the alarm firing and this
  // restore running. Never reload a page the user is actively viewing; just drop
  // the watch so it reschedules once the tab goes idle again.
  if (await isTabActiveInFocusedWindow(normalizedTabId)) {
    await tabInactivityObserver.clearTab(normalizedTabId, {
      scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE
    });
    return { ok: true, skipped: true };
  }
  await clearRenderModeNoJsHeld(normalizedTabId);
  brain.recordRenderModeNoJsHold(normalizedTabId, {
    held: false,
    javaScriptDisabled: false
  }, "render-mode:no-js-inactivity:cleared");
  const reloadResult = await utils.reloadPageWithJavaScriptControl(normalizedTabId, false)
    .catch((error) => ({
      ok: false,
      error: (error && error.message) || "Unable to reload page with JavaScript"
    }));
  if (!reloadResult || !reloadResult.ok) {
    const fallback = await utils.setPageJavaScriptExecutionDisabled(normalizedTabId, false)
      .catch(() => null);
    if (!fallback || !fallback.ok) {
      // Both the reload and the direct re-enable failed, so the page is still in
      // no-JS mode. Re-mark it held and reschedule the watch so a later focus
      // change or alarm retries the restore instead of leaving it stuck.
      await setRenderModeNoJsHeld(normalizedTabId, true).catch(() => null);
      brain.recordRenderModeNoJsHold(normalizedTabId, {
        held: true,
        javaScriptDisabled: true
      }, "render-mode:no-js-inactivity:restored-hold");
      await updateRenderModeNoJsInactivityWatch(normalizedTabId);
      return reloadResult || { ok: false, error: "Unable to reload page with JavaScript" };
    }
  }
  const deviceState = await getDeviceEmulationState(normalizedTabId).catch(() => null);
  if (!deviceState || !deviceState.enabled) {
    await utils.detachDebugger(normalizedTabId).catch(() => null);
  }
  return reloadResult || { ok: false, error: "Unable to reload page with JavaScript" };
}

let backgroundStarted = false;

export function startBackground(): void {
  if (backgroundStarted) {
    return;
  }
  backgroundStarted = true;

tabInactivityObserver.subscribe(async (event) => {
  if (!event || event.type !== "inactive" || event.scope !== RENDER_MODE_NO_JS_INACTIVITY_SCOPE) {
    return;
  }
  await restoreRenderModeJavaScriptAfterNoJsInactivity(event.tabId);
});

if (browser.alarms && browser.alarms.onAlarm && typeof browser.alarms.onAlarm.addListener === "function") {
  browser.alarms.onAlarm.addListener((alarm) => {
    tabInactivityObserver.handleAlarm(alarm).catch(() => {});
  });
}

async function captureRenderModeHtmlWithDebugger(tabId: unknown): Promise<RenderModeHtmlCaptureResult> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return { ok: false, pageUrl: "", renderedHtml: "", rawHtml: "", renderMode: "", hiddenCount: 0, error: "Missing tab" };
  }
  const target = { tabId: normalizedTabId };
  let tab: Browser.tabs.Tab | null = null;
  try {
    tab = (await getBrowserTab(normalizedTabId)) || null;
  } catch {
    tab = null;
  }
  const pageUrl = tab && typeof tab.url === "string" ? tab.url : "";
  try {
    const documentResult = await sendBrowserDebuggerCommand(target, "DOM.getDocument", {
      depth: -1,
      pierce: true
    }) as { root?: { nodeId?: number } } | undefined;
    const rootNodeId = documentResult && documentResult.root && Number.isFinite(documentResult.root.nodeId)
      ? documentResult.root.nodeId
      : 0;
    if (!rootNodeId) {
      return {
        ok: false,
        pageUrl,
        renderedHtml: "",
        rawHtml: "",
        renderMode: "",
        hiddenCount: 0,
        error: "Unable to read inspected document"
      };
    }
    const htmlResult = await sendBrowserDebuggerCommand(target, "DOM.getOuterHTML", {
      nodeId: rootNodeId
    }) as { outerHTML?: string } | undefined;
    const renderedHtml = htmlResult && typeof htmlResult.outerHTML === "string"
      ? htmlResult.outerHTML
      : "";
    const rawResult = pageUrl ? await fetchStaticPageHtmlForBackground(pageUrl).catch(() => null) : null;
    const rawHtml = rawResult && rawResult.ok && typeof rawResult.html === "string"
      ? rawResult.html
      : "";
    return {
      ok: Boolean(renderedHtml && rawHtml),
      pageUrl,
      renderedHtml,
      rawHtml,
      renderMode: "",
      hiddenCount: 0,
      error: renderedHtml ? "" : "Unable to capture inspected document HTML"
    };
  } catch (error) {
    return {
      ok: false,
      pageUrl,
      renderedHtml: "",
      rawHtml: "",
      renderMode: "",
      hiddenCount: 0,
      error: error instanceof Error ? error.message : "Unable to capture inspected document HTML"
    };
  }
}

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const OFFSCREEN_MESSAGE_TARGET = "offscreen";
const OFFSCREEN_REFINE_XPATHS_TYPE = "offscreenRefineXPaths";
const OFFSCREEN_REFINE_XPATHS_TIMEOUT_MS = 2_000;
let offscreenDocumentSetup: Promise<void> | null = null;

function createOffscreenRefineTimeout<T>(fallback: T, timeoutMs = OFFSCREEN_REFINE_XPATHS_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return {
    promise,
    clear() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  };
}

async function offscreenDocumentExists(): Promise<boolean> {
  if (typeof browser.runtime.getContexts !== "function") {
    return false;
  }
  try {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [utils.getExtensionResourceUrl(OFFSCREEN_DOCUMENT_PATH)]
    });
    return Array.isArray(contexts) && contexts.length > 0;
  } catch {
    return false;
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (!browser.offscreen || typeof browser.offscreen.createDocument !== "function") {
    throw new Error("Offscreen documents are not supported in this environment");
  }
  if (await offscreenDocumentExists()) {
    return;
  }
  if (!offscreenDocumentSetup) {
    offscreenDocumentSetup = browser.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["DOM_PARSER"],
        justification: "Parse captured page HTML with DOMParser to refine submission XPaths for AI selector computation."
      })
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : String(error);
        if (!messageText.includes("Only a single offscreen document")) {
          throw error;
        }
      })
      .finally(() => {
        offscreenDocumentSetup = null;
      });
  }
  await offscreenDocumentSetup;
}

async function refineXPathEntriesViaOffscreen(
  renderedHtml: string,
  rawHtml: string,
  renderedXPaths: unknown
): Promise<unknown> {
  const items = Array.isArray(renderedXPaths) ? renderedXPaths : [];
  try {
    await ensureOffscreenDocument();
    const stored = await putTransferPayload("offscreen-refine", { renderedHtml, rawHtml });
    if (!stored.ok) {
      return items;
    }
    let response: unknown;
    const timeout = createOffscreenRefineTimeout(null);
    try {
      response = await Promise.race([
        utils.sendRuntimeMessage({
          target: OFFSCREEN_MESSAGE_TARGET,
          type: OFFSCREEN_REFINE_XPATHS_TYPE,
          payloadKey: stored.payloadKey,
          items
        }),
        timeout.promise
      ]);
    } catch {
      await removeTransferPayload(stored.payloadKey);
      return items;
    } finally {
      timeout.clear();
    }
    if (
      response &&
      typeof response === "object" &&
      (response as { ok?: boolean }).ok === true &&
      Array.isArray((response as { items?: unknown }).items)
    ) {
      return (response as { items: unknown[] }).items;
    }
    // Offscreen returned an unexpected or error response; ensure the stored payload is cleaned up.
    await removeTransferPayload(stored.payloadKey);
  } catch {
    // Refinement is best-effort; fall back to the unrefined entries below.
  }
  return items;
}

const aiRunOrchestrator = createAiRunOrchestrator({
  aiComputeLockExpiresAtByTabId,
  normalizeTabId: normalizeBrokerTabId,
  normalizeActivationBaseUrl,
  normalizeSiteIdValue,
  normalizeAiSelectorSet,
  buildAiSubmissionXpaths,
  isPageWithinBaseUrl: utils.isPageWithinBaseUrl,
  resolveBackgroundNetworkCredentials,
  requestAiRunStartSnapshot,
  requestAiRunStatus,
  requestAiRunResultSnapshot,
  fetchStaticPageHtmlForBackground,
  getTransferPayload,
  putTransferPayload,
  removeTransferPayload,
  consumeTransferPayload,
  clearPersistedAiRunRecord,
  savePersistedAiRunRecord,
  sendContentMessageToTab,
  ensureContentMainForTab,
  getTabState: utils.getTabState,
  setTabState: utils.setTabState,
  updateActionForTab: utils.updateActionForTab,
  refineXPathEntries: refineXPathEntriesViaOffscreen,
  getAiRunResumeExpiresAt,
  configStore,
  defaultExcludedImmutableSelectors: constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  aiRunTimeoutMs: AI_RUN_TIMEOUT_MS,
  aiRunPollIntervalMs: AI_RUN_POLL_INTERVAL_MS,
  createManagedTimeoutGroup
});
const getAiRunCurrentPageEntry = aiRunOrchestrator.getAiRunCurrentPageEntry;
const isAiRunCurrentPageSnapshotMissing = aiRunOrchestrator.isAiRunCurrentPageSnapshotMissing;
const refineAiRunPayloadXpathsInBackground = aiRunOrchestrator.refineAiRunPayloadXpathsInBackground;
const loadAiRunSelectorSetFromPayloadKey = aiRunOrchestrator.loadAiRunSelectorSetFromPayloadKey;
const runAiCommandForTab = aiRunOrchestrator.runAiCommandForTab;
const setAiComputeLockForTab = aiRunOrchestrator.setAiComputeLockForTab;
const isAiComputeLockActiveForTab = aiRunOrchestrator.isAiComputeLockActiveForTab;
const refreshAiRunHeartbeat = aiRunOrchestrator.refreshAiRunHeartbeat;
const prepareAiRunPayloadSnapshot = aiRunOrchestrator.prepareAiRunPayloadSnapshot;

// Keeps the MV3 service worker awake while long-lived work is in flight (AI run
// poll loop, live property-lock connection) so an idle suspension cannot kill
// the operation or its in-memory state when the side panel is closed.
const swKeepAlive = createSwKeepAlive({
  setIntervalRef: (callback, ms) => setInterval(callback, ms),
  clearIntervalRef: (handle) => clearInterval(handle),
  ping: () => {
    callBrowserApi(
      (api, callback) => api.runtime.getPlatformInfo(callback),
      (api) => api.runtime.getPlatformInfo()
    ).catch(() => {
      // The ping only needs to touch an extension API to reset the idle timer.
    });
  }
});

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_BOOTSTRAP_CONTENT, async (context) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for bootstrap command"
    );
  }

  let tab = null;
  try {
    tab = await getBrowserTab(normalizedTabId);
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

  const tabUrl = typeof tab.url === "string" ? tab.url : "";
  await utils.setTabState(normalizedTabId, { active: true }, "initial");
  await utils.updateActionForTab(normalizedTabId);

  const mobileState = await ensureDefaultMobileEmulationForTab(normalizedTabId, tabUrl);
  if (!mobileState) {
    requestContentActivation(normalizedTabId);
    return context.replyFail(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      "Unable to prepare mobile simulation",
      { tabId: normalizedTabId }
    );
  }

  const result = await ensureContentMainForTab(normalizedTabId);
  updateTabRuntime(normalizedTabId, {
    contentReady: Boolean(result && result.ok)
  });
  if (!result || !result.ok) {
    requestContentActivation(normalizedTabId);
    return context.replyFail(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      (result && result.error) || "Content activation failed",
      { tabId: normalizedTabId }
    );
  }

  return {
    ...result,
    runtime: getTabRuntimeSnapshot(normalizedTabId)
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
    ? payload.message as Record<string, unknown>
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
      { tabId: normalizedTabId, type: (message as { type?: string }).type || "" }
    );
  }

  return {
    ok: true,
    tabId: normalizedTabId,
    response,
    runtime: getTabRuntimeSnapshot(normalizedTabId)
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
    tab = await getBrowserTab(normalizedTabId);
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
  if (payload && payload.desktopPreviewEnabled) {
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
      message: "Preparing this page for marking...",
      owner: SPINNER_OWNERS.POPUP,
      reason: "tab-activate-marking",
      source: "background-command-router",
      persistent: false
    },
    async ({ update }) => {
      await update({
        message: "Applying the marking page setup...",
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
        message: "Preparing page content for marking...",
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

      brain.mirrorActivationLifecycle(normalizedTabId, {
        operationId,
        kind: LIFECYCLE_KINDS.ACTIVATION,
        phase: LIFECYCLE_PHASES.STARTED,
        busy: true,
        message: "Preparing page content for marking..."
      }, "background:tab-activate-marking:lifecycle-started");

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
        brain.mirrorActivationLifecycle(normalizedTabId, {
          operationId,
          kind: LIFECYCLE_KINDS.ACTIVATION,
          phase: LIFECYCLE_PHASES.FAILED,
          busy: false,
          message: ""
        }, "background:tab-activate-marking:lifecycle-failed");
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

      await utils.setTabState(normalizedTabId, {
        enabled: true,
        baseUrl,
        pageType
      });
      updateTabRuntime(normalizedTabId, {
        contentReady: true,
        mode: "marking"
      });

      brain.mirrorActivationLifecycle(normalizedTabId, {
        operationId,
        kind: LIFECYCLE_KINDS.ACTIVATION,
        phase: LIFECYCLE_PHASES.FINISHED,
        busy: false,
        message: ""
      }, "background:tab-activate-marking:lifecycle-finished");

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
    tab = await getBrowserTab(normalizedTabId);
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
      message: "Turning off marking on this page...",
      owner: SPINNER_OWNERS.POPUP,
      reason: "tab-deactivate-marking",
      source: "background-command-router",
      persistent: false
    },
    async ({ update }) => {
      await update({
        message: "Returning this page to silent mode...",
        reason: "tab-deactivate-marking-content",
        source: "background-command-router"
      });

      updateLifecycleState(normalizedTabId, {
        operationId,
        kind: LIFECYCLE_KINDS.MODE,
        phase: LIFECYCLE_PHASES.STARTED,
        busy: true,
        message: "Turning off marking on this page..."
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

  const selectorSet = normalizeAiSelectorSet((payload && payload.selectorSet) as Parameters<typeof normalizeAiSelectorSet>[0]);
  const response = await sendContentMessageToTab(normalizedTabId, {
    type: "showAiPreview",
    selectorSet
  }, 30000);
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

registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_CLOSE_AI_PREVIEW, async (context, payload = {}) => {
  const normalizedTabId = normalizeBrokerTabId(context.tabId);
  if (!normalizedTabId) {
    return context.replyFail(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "Missing tab for preview close command"
    );
  }

  const response = await sendContentMessageToTab(normalizedTabId, {
    type: "closeAiPreview",
    previewRestoreToken: Number.isFinite((payload && payload.previewRestoreToken) as number)
      ? Math.trunc(Number((payload && payload.previewRestoreToken) as number))
      : null
  });
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
  brain.recordRenderModeInspection(normalizedTabId, {
    inspecting: true,
    operationId,
    lastError: ""
  }, "render-mode:begin");
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

async function executeRenderModeInspectionEnd(
  normalizedTabId: number,
  payload: RenderModeEndInspectionPayload | Record<string, unknown>,
): Promise<RenderModeEndInspectionReply> {
  const operationId = normalizeRenderModeOperationId(payload, normalizedTabId);
  if (await isRenderModeNoJsHeld(normalizedTabId)) {
    await clearRenderModeNoJsHeld(normalizedTabId);
    brain.recordRenderModeNoJsHold(normalizedTabId, {
      held: false,
      operationId,
      javaScriptDisabled: false
    }, "render-mode:end:cleared-hold");
    await tabInactivityObserver.clearTab(normalizedTabId, {
      scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE
    });
    await utils.setPageJavaScriptExecutionDisabled(normalizedTabId, false).catch(() => null);
    const deviceState = await getDeviceEmulationState(normalizedTabId).catch(() => null);
    if (!deviceState || !deviceState.enabled) {
      await utils.detachDebugger(normalizedTabId).catch(() => null);
    }
  }
  const endAcknowledged = await sendRenderModeInspectionEndWithRetry(normalizedTabId, operationId);
  const tabState = await utils.getTabState(normalizedTabId);
  updateTabRuntime(normalizedTabId, {
    mode: tabState && tabState.enabled ? "marking" : "silent"
  });
  brain.recordRenderModeInspection(normalizedTabId, {
    inspecting: false,
    javaScriptDisabled: false,
    noJsHeld: false,
    operationId,
    lastError: endAcknowledged ? "" : "Unable to end render mode inspection"
  }, "render-mode:end");
  updateLifecycleState(normalizedTabId, {
    operationId,
    kind: LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
    phase: endAcknowledged ? LIFECYCLE_PHASES.FINISHED : LIFECYCLE_PHASES.FAILED,
    busy: false,
    message: ""
  });
  if (!endAcknowledged) {
    throw createBackgroundCommandError(
      MESSAGE_ERROR_CODES.CONTENT_UNAVAILABLE,
      "Unable to end render mode inspection",
      {
        tabId: normalizedTabId,
        runtime: getTabRuntimeSnapshot(normalizedTabId),
        state: tabState
      }
    );
  }
  return {
    ok: true,
    tabId: normalizedTabId,
    operationId,
    endAcknowledged,
    runtime: getTabRuntimeSnapshot(normalizedTabId) || undefined,
    state: tabState || undefined
  };
}

async function executeRenderModeInspection(
  normalizedTabId: number,
  payload: RenderModeRunInspectionPayload | Record<string, unknown>,
): Promise<RenderModeRunInspectionOperationReply> {
  const baseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
  if (!baseUrl) {
    throw createBackgroundCommandError(
      MESSAGE_ERROR_CODES.HANDLER_FAILED,
      "Missing base URL for render mode inspection",
      { tabId: normalizedTabId }
    );
  }
  const operationId = normalizeRenderModeOperationId(payload, normalizedTabId);
  const javaScriptDisabled = Boolean(payload && payload.javaScriptDisabled);

  return await runBackgroundTabOperation(
    normalizedTabId,
    {
      operationId,
      kind: LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
      timeoutMs: RENDER_MODE_INSPECTION_OPERATION_TIMEOUT_MS,
      message: "Capturing this page for render mode inspection...",
      spinner: {
        key: `render-mode-inspection:${normalizedTabId}`,
        owner: SPINNER_OWNERS.POPUP,
        reason: "tab-render-mode-inspection",
        source: "background-command-router",
        persistent: false
      }
    },
  async ({ update, signal }: TabOperationContext) => {
      // Clear any prior "Without JavaScript" hold for this tab before we start.
      // This inspection's own reload also fires webNavigation events, so the tab
      // must NOT be marked held while we reload — it is re-marked in `finally` only
      // after the reload's navigation events have already been dispatched.
      const wasHeldInNoJsMode = await isRenderModeNoJsHeld(normalizedTabId);
      await clearRenderModeNoJsHeld(normalizedTabId);
      brain.recordRenderModeNoJsHold(normalizedTabId, {
        held: false,
        operationId,
        javaScriptDisabled
      }, "render-mode:run:cleared-hold");
      await tabInactivityObserver.clearTab(normalizedTabId, {
        scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE
      });
      brain.recordRenderModeInspection(normalizedTabId, {
        inspecting: true,
        javaScriptDisabled,
        noJsHeld: false,
        operationId,
        baseUrl,
        followUpCompleted: false,
        lastError: ""
      }, "render-mode:run:started");
      const commandResult: {
        ok: boolean;
        tabId: number;
        operationId: string;
        loadStarted: boolean;
        reloadResult: { ok: boolean; error?: string } | null;
        followUpCompleted: boolean;
        followUpError: string;
        inspectionSnapshot: RenderModeSnapshotPayload | null;
        endAcknowledged: boolean;
        runtime?: Record<string, unknown>;
        state?: Record<string, unknown>;
      } = {
        ok: false,
        tabId: normalizedTabId,
        operationId,
        loadStarted: false,
        reloadResult: null,
        followUpCompleted: false,
        followUpError: "Unable to inspect page",
        inspectionSnapshot: null,
        endAcknowledged: false,
      };
      let javaScriptReloadAttempted = false;
      let javaScriptRestored = !javaScriptDisabled;
      const restoreJavaScriptAfterNoJsReload = async () => {
        if (javaScriptRestored) {
          return { ok: true };
        }
        const scriptEnableResult = await utils.setPageJavaScriptExecutionDisabled(
          normalizedTabId,
          false
        );
        if (scriptEnableResult.ok) {
          javaScriptRestored = true;
        }
        return scriptEnableResult;
      };
      const detachRenderModeDebuggerIfIdle = async (
        options: RenderModeRecoveryOptions = {}
      ): Promise<RenderModeDetachResult> => {
        const waitForDetach = options.waitForDetach !== false;
        const deviceState = await getDeviceEmulationState(normalizedTabId).catch(() => null);
        if (deviceState && deviceState.enabled) {
          return { ok: true, keptForDeviceEmulation: true };
        }
        const detachPromise = utils.detachDebugger(normalizedTabId).catch((error) => ({
          ok: false,
          error: (error && error.message) || "Unable to detach debugger"
        }));
        if (!waitForDetach) {
          detachPromise.catch(() => null);
          return { ok: true, detachPending: true };
        }
        return detachPromise;
      };
      const reloadPageWithJavaScriptForRenderModeRecovery = async (
        options: RenderModeRecoveryOptions = {}
      ): Promise<RenderModeReloadRecoveryResult> => {
        const requireLoadComplete = options.requireLoadComplete !== false;
        const loadStartPromise = waitForTabLoadStartInBackground(
          normalizedTabId,
          RENDER_MODE_INSPECTION_START_TIMEOUT_MS
        );
        // Set up the load-complete waiter BEFORE issuing the reload so it observes
        // this reload's loading -> complete cycle. Creating it after the reload (and
        // after the loading event already fired) makes awaitNextLoad wait for a
        // second navigation that never happens, which would time out.
        const loadCompletePromise: Promise<boolean> = requireLoadComplete
          ? waitForTabLoadCompleteInBackground(
            normalizedTabId,
            RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS,
            { awaitNextLoad: true }
          ) as Promise<boolean>
          : Promise.resolve(true);
        const reloadResult = await utils.reloadPageWithJavaScriptControl(
          normalizedTabId,
          false
        );
        javaScriptRestored = Boolean(reloadResult && reloadResult.ok);
        const loadStarted = await loadStartPromise;
        if (!reloadResult || !reloadResult.ok || (requireLoadComplete && !loadStarted)) {
          return {
            ok: false,
            error: (reloadResult && reloadResult.error) || "Unable to reload page with JavaScript"
          };
        }
        let loadCompleted = false;
        if (requireLoadComplete) {
          loadCompleted = await loadCompletePromise;
          if (!loadCompleted) {
            return { ok: false, error: "Timed out while loading page with JavaScript" };
          }
        }
        const detachResult = await detachRenderModeDebuggerIfIdle({
          waitForDetach: requireLoadComplete
        });
        if (!detachResult.ok && requireLoadComplete) {
          return detachResult;
        }
        return { ok: true, loadCompleted, detachResult };
      };

      try {
        if (!javaScriptDisabled) {
          const scriptEnableResult = await utils.setPageJavaScriptExecutionDisabled(
            normalizedTabId,
            false
          );
          if (!scriptEnableResult.ok) {
            commandResult.followUpError = scriptEnableResult.error || "Unable to enable JavaScript for render mode inspection";
            return commandResult;
          }
          if (wasHeldInNoJsMode) {
            // The page was left in "Without JavaScript" mode, so it loaded with
            // JavaScript disabled and never ran content scripts. Reload it with
            // JavaScript now so content is injected at document_start; otherwise
            // the begin handshake below would retry content readiness for tens of
            // seconds against the stale no-JS page and the spinner would appear
            // stuck. After this, the normal begin/reload/capture flow runs against
            // a hydrated page.
            const noJsRecoveryResult = await reloadPageWithJavaScriptForRenderModeRecovery();
            if (!noJsRecoveryResult.ok) {
              commandResult.followUpError = noJsRecoveryResult.error || "Unable to reload page with JavaScript";
              return commandResult;
            }
          }
        }

        let beginResult = await runRenderModeInspectionBeginStep(normalizedTabId, operationId);
        if (!beginResult.ok && beginResult.error === "Content activation failed") {
          const recoveryResult = await reloadPageWithJavaScriptForRenderModeRecovery();
          if (recoveryResult.ok) {
            beginResult = await runRenderModeInspectionBeginStep(normalizedTabId, operationId);
          }
        }
        if (!beginResult.ok) {
          commandResult.followUpError = beginResult.error || "Unable to begin render mode inspection";
          return commandResult;
        }

        await update({
          message: "Reloading the page for render mode inspection...",
          reason: "tab-render-mode-reload",
          source: "background-command-router"
        });

        const loadStartPromise = waitForTabLoadStartInBackground(
          normalizedTabId,
          RENDER_MODE_INSPECTION_START_TIMEOUT_MS
        );
        javaScriptReloadAttempted = true;
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

        const reloadOutcome = commandResult.reloadResult;
        if (!reloadOutcome || !reloadOutcome.ok || !loadStarted) {
          commandResult.followUpError =
            reloadOutcome?.error ||
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

        let hideConsentResult: Awaited<ReturnType<typeof runRenderModeHideConsentStep>> = { ok: true, hiddenCount: 0 };
        let captureResult: RenderModeHtmlCaptureResult | Awaited<ReturnType<typeof runRenderModeCaptureHtmlStep>>;
        if (javaScriptDisabled) {
          captureResult = await captureRenderModeHtmlWithDebugger(normalizedTabId);
        } else {
          await update({
            message: "Hiding consent overlays before capture...",
            reason: "tab-render-mode-consent",
            source: "background-command-router"
          });

          hideConsentResult = await runRenderModeHideConsentStep(normalizedTabId);
          if (!hideConsentResult.ok) {
            commandResult.followUpError = hideConsentResult.error || "Unable to hide consent form";
            return commandResult;
          }

          captureResult = await runRenderModeCaptureHtmlStep(
            normalizedTabId,
            baseUrl,
            operationId
          );
        }
        if (!captureResult.ok) {
          commandResult.followUpError = captureResult.error || "Unable to capture render mode HTML";
          return commandResult;
        }
        if (!javaScriptDisabled) {
          await detachRenderModeDebuggerIfIdle({ waitForDetach: false });
        }

        const inspectionCapture = captureResult;
        Object.assign(commandResult, {
          ok: true,
          followUpCompleted: true,
          followUpError: "",
          inspectionSnapshot: {
            pageUrl: inspectionCapture.pageUrl || "",
            renderedHtml: inspectionCapture.renderedHtml || "",
            rawHtml: inspectionCapture.rawHtml || "",
            renderMode: inspectionCapture.renderMode || "",
            hiddenCount: Number(inspectionCapture.hiddenCount || hideConsentResult.hiddenCount || 0)
          }
        });
        return commandResult;
      } finally {
        if (!javaScriptDisabled && javaScriptReloadAttempted && !javaScriptRestored) {
          await restoreJavaScriptAfterNoJsReload().catch(() => null);
        }
        if (!signal || !signal.aborted) {
          if (javaScriptDisabled && javaScriptReloadAttempted) {
            // The page is now reloaded with JavaScript disabled and is left that
            // way for inspection. Remember the tab so JavaScript is restored on the
            // next genuine top-level navigation (not on this inspection's own reload,
            // which has already fired its navigation events by now), and so the popup
            // can show the page as currently held in "Without JavaScript" mode.
            await setRenderModeNoJsHeld(normalizedTabId, true);
            brain.recordRenderModeNoJsHold(normalizedTabId, {
              held: true,
              operationId,
              javaScriptDisabled: true
            }, "render-mode:run:set-hold");
            updateRenderModeNoJsInactivityWatch(normalizedTabId).catch(() => null);
          }
          const endAcknowledged = javaScriptDisabled
            ? false
            : await sendRenderModeInspectionEndWithRetry(
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
          brain.recordRenderModeInspection(normalizedTabId, {
            inspecting: Boolean(javaScriptDisabled && javaScriptReloadAttempted),
            javaScriptDisabled,
            noJsHeld: Boolean(javaScriptDisabled && javaScriptReloadAttempted),
            operationId,
            baseUrl,
            lastSnapshotPageUrl:
              commandResult.inspectionSnapshot &&
              typeof commandResult.inspectionSnapshot === "object" &&
              typeof commandResult.inspectionSnapshot.pageUrl === "string"
                ? commandResult.inspectionSnapshot.pageUrl
                : "",
            followUpCompleted: Boolean(commandResult.followUpCompleted),
            lastError: commandResult.followUpError || ""
          }, "render-mode:run:finished");
        }
      }
    }
  ) as unknown as RenderModeRunInspectionOperationReply;
}

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
    tab = await getBrowserTab(normalizedTabId);
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

  // Hold the service worker awake for the whole AI run so an idle suspension
  // cannot kill the poll loop mid-run when the side panel is closed.
  swKeepAlive.acquire();
  try {
    return await withBackgroundTabSpinner(
      normalizedTabId,
      {
        key: `run-ai:${normalizedTabId}`,
        message: "Preparing page content for AI...",
        owner: SPINNER_OWNERS.POPUP,
        reason: "tab-run-ai-preparing",
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
  } finally {
    swKeepAlive.release();
  }
}, POPUP_TAB_COMMAND_POLICY);

function maybeGetCommandPayloadForLedger(message: RuntimeMessage) {
  if (!isDebugFlagEnabled("fullWorldMessagingLogging")) {
    return undefined;
  }
  if (!message || !message.payload || typeof message.payload !== "object") {
    return undefined;
  }
  return redactCommandPayloadForLedger(message.payload);
}

function recordBackgroundCommandLedger(message: RuntimeMessage, sender: Browser.runtime.MessageSender, reply: RuntimeMessageReply | null, startedAt: number, resolvedContextTabId: number | null = null) {
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

function handleBackgroundCommandEnvelope(
  message: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (reply: RuntimeMessageReply | undefined) => void
): boolean {
  const dispatch = dispatchBackgroundCommandEnvelope(message, sender);
  if (!dispatch) {
    return false;
  }
  dispatch
    .then((reply) => sendResponse(reply))
    .catch((error) => {
      sendResponse(createFailureEnvelope(
        message,
        MESSAGE_ERROR_CODES.HANDLER_FAILED,
        (error && error.message) || "Background command failed"
      ));
    });
  return true;
}

function dispatchBackgroundCommandEnvelope(
  message: unknown,
  sender: Browser.runtime.MessageSender
): Promise<RuntimeMessageReply | undefined> | null {
  if (!isRequestEnvelope(message) || message.target !== MESSAGE_TARGETS.BACKGROUND) {
    return null;
  }
  const request: BackgroundCommandRequest = message;
  const runtimeRequest: RuntimeMessage = {
    ...request,
    tabId: request.tabId ?? undefined
  };
  const startedAt = Date.now();
  const expectsReply = request.expectsReply !== false;
  let resolvedContextTabId: number | null = null;
  const dispatch = dispatchBackgroundCommand(request, sender, {
    requireTabForTypes: TAB_SCOPED_BACKGROUND_COMMANDS,
    onDispatched(context: { tabId?: unknown } | null) {
      if (context && Number.isFinite(context.tabId)) {
        resolvedContextTabId = Math.trunc(Number(context.tabId));
      }
    }
  }) as Promise<RuntimeMessageReply>;

  return dispatch
    .then((reply) => {
      if (!expectsReply) {
        recordBackgroundCommandLedger(runtimeRequest, sender, reply, startedAt, resolvedContextTabId);
        return undefined;
      }
      recordBackgroundCommandLedger(runtimeRequest, sender, reply, startedAt, resolvedContextTabId);
      return reply;
    })
    .catch((error) => {
      const reply = createFailureEnvelope(
        request,
        MESSAGE_ERROR_CODES.HANDLER_FAILED,
        (error && error.message) || "Background command failed"
      );
      if (!expectsReply) {
        recordBackgroundCommandLedger(runtimeRequest, sender, reply, startedAt, resolvedContextTabId);
        return undefined;
      }
      recordBackgroundCommandLedger(runtimeRequest, sender, reply, startedAt, resolvedContextTabId);
      return reply;
    });
}

brain.bus.registerHandler(RENDER_MODE_REQUEST_TYPES.RUN_INSPECTION, (payload: RenderModeRunInspectionPayload, meta) => {
  const normalizedTabId = normalizeBrokerTabId(meta.tab);
  if (!normalizedTabId) {
    throw createBackgroundCommandError(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "renderMode.runInspection requires a tab id",
    );
  }
  return executeRenderModeInspection(normalizedTabId, payload);
});

brain.bus.registerHandler(RENDER_MODE_REQUEST_TYPES.END_INSPECTION, (payload: RenderModeEndInspectionPayload, meta) => {
  const normalizedTabId = normalizeBrokerTabId(meta.tab);
  if (!normalizedTabId) {
    throw createBackgroundCommandError(
      MESSAGE_ERROR_CODES.INVALID_TAB,
      "renderMode.endInspection requires a tab id",
    );
  }
  return executeRenderModeInspectionEnd(normalizedTabId, payload);
});

function getMessageTabId(
  message: Partial<RuntimeMessage> | null | undefined,
  sender: Browser.runtime.MessageSender
): number | null {
  return normalizeBrokerTabId(message && message.tabId) ||
    normalizeBrokerTabId(sender && sender.tab && sender.tab.id);
}

function getPageMotionFreezeControlTarget(
  message: Partial<RuntimeMessage> | null | undefined,
  sender: Browser.runtime.MessageSender
): PageMotionFreezeControlTarget | null {
  const tabId = getMessageTabId(message, sender);
  if (!tabId) {
    return null;
  }
  const target: PageMotionFreezeControlTarget = { tabId };
  const senderFrameId = sender && sender.frameId;
  if (typeof senderFrameId === "number" && Number.isInteger(senderFrameId) && senderFrameId >= 0) {
    target.frameIds = [senderFrameId];
  }
  return target;
}

function getPageMotionFreezeControlTargetKey(target: PageMotionFreezeControlTarget): string {
  const frameId = Array.isArray(target.frameIds) && target.frameIds.length
    ? target.frameIds[0]
    : "all";
  return `${target.tabId}:${frameId}`;
}

async function executePageMotionFreezeControlNow(
  target: PageMotionFreezeControlTarget,
  command: string,
  details: Record<string, unknown> | null
): Promise<PageMotionFreezeControlResult> {
  if (!browser.scripting || typeof browser.scripting.executeScript !== "function") {
    return { ok: false, error: "Scripting API unavailable" };
  }
  const injection = {
    target: {
      tabId: target.tabId,
      ...(target.frameIds ? { frameIds: target.frameIds } : {})
    },
    world: "MAIN",
    func: runPageMotionFreezeControl,
    args: [command, details]
  } as Parameters<typeof browser.scripting.executeScript>[0];
  await browser.scripting.executeScript(injection);
  return { ok: true };
}

async function executePageMotionFreezeControl(
  message: Partial<RuntimeMessage> | null | undefined,
  sender: Browser.runtime.MessageSender
): Promise<PageMotionFreezeControlResult> {
  const normalizedMessage = message || {};
  const target = getPageMotionFreezeControlTarget(normalizedMessage, sender);
  if (!target) {
    return { ok: false, error: "Missing tab" };
  }
  const command = typeof normalizedMessage.command === "string" && normalizedMessage.command
    ? normalizedMessage.command
    : "setPaused";
  const details = normalizedMessage.details && typeof normalizedMessage.details === "object"
    ? normalizedMessage.details as Record<string, unknown>
    : null;
  const queueKey = getPageMotionFreezeControlTargetKey(target);
  const previous = pageMotionFreezeControlQueue.get(queueKey) || Promise.resolve({ ok: true });
  const next = runBackgroundTask("page-motion-freeze-control-queue", previous, {
    tabId: target.tabId,
    appendTrace: appendWorldTraceEvent
  })
    .then(() => executePageMotionFreezeControlNow(target, command, details));
  pageMotionFreezeControlQueue.set(queueKey, next);
  try {
    return await next;
  } finally {
    if (pageMotionFreezeControlQueue.get(queueKey) === next) {
      pageMotionFreezeControlQueue.delete(queueKey);
    }
  }
}

function getExtensionContextWindowId(context: { windowId?: unknown } | null | undefined): number | null {
  if (!context || !Number.isFinite(context.windowId)) {
    return null;
  }
  return Math.trunc(Number(context.windowId));
}

async function resolvePopupSidePanelBoundTab(sender: PopupContextSender = {}): Promise<Browser.tabs.Tab | null> {
  if (
    !browser.runtime ||
    typeof browser.runtime.getContexts !== "function" ||
    !browser.tabs ||
    typeof browser.tabs.get !== "function"
  ) {
    return null;
  }
  try {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ["SIDE_PANEL"],
      documentUrls: [utils.getExtensionResourceUrl("popup.html")]
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
    const boundTabId = Number.isFinite(boundContext.tabId) ? Math.trunc(Number(boundContext.tabId)) : 0;
    if (!boundTabId) {
      return null;
    }
    return (await getBrowserTab(boundTabId)) || null;
  } catch {
    return null;
  }
}

async function resolvePopupTabContext(
  message: Partial<RuntimeMessage> = {},
  sender: PopupContextSender = {}
): Promise<PopupTabContextResult> {
  const debugTabId = normalizeBrokerTabId(message.debugTabId);
  if (debugTabId) {
    try {
      const tab = await getBrowserTab(debugTabId);
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

  let tabs: Browser.tabs.Tab[] = [];
  try {
    tabs = await queryBrowserTabs({ active: true, currentWindow: true });
    if (!tabs.length) {
      tabs = await queryBrowserTabs({ active: true, lastFocusedWindow: true });
    }
  } catch {
    tabs = [];
  }
  return { ok: Boolean(tabs[0] && tabs[0].id), tab: tabs[0] || null, source: tabs[0] ? "activeTab" : "none" };
}

const popupStateBroker = createPopupStateBroker({
  lifecycleStateByTabId: tabLifecycleStateByTabId,
  spinnerQueueByTabId: tabSpinnerQueueByTabId,
  normalizeTabId: normalizeBrokerTabId,
  appendTrace: appendWorldTraceEvent,
  ensureTraceState,
  isWorldTraceEnabled,
  updateRuntime: updateTabRuntime,
  syncPopupView(tabId: number, state: PopupBrokerState, reason: string) {
    brain.mirrorPopupState(tabId, state, reason);
    brain.syncProjectedSpinnerQueue(tabId, state.spinnerQueue, `${reason}:spinners`);
  }
});
const getSpinnerQueueForTab = popupStateBroker.getSpinnerQueueForTab;
const serializeSpinnerQueue = popupStateBroker.serializeSpinnerQueue;
const buildBrokerState = popupStateBroker.buildBrokerState;
const broadcastBrokerState = popupStateBroker.broadcastBrokerState;
const updateLifecycleState = popupStateBroker.updateLifecycleState;
const clearLifecycleState = popupStateBroker.clearLifecycleState;
const clearNavInspectCurtain = popupStateBroker.clearNavInspectCurtain;
const popupStateSeedTabIds = new Set<number>();
for (const tabId of [...tabLifecycleStateByTabId.keys(), ...tabSpinnerQueueByTabId.keys()]) {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || popupStateSeedTabIds.has(normalizedTabId)) {
    continue;
  }
  popupStateSeedTabIds.add(normalizedTabId);
  const brokerState = buildBrokerState(normalizedTabId);
  brain.mirrorPopupState(normalizedTabId, brokerState, "popup-state-broker:seed");
  brain.syncProjectedSpinnerQueue(normalizedTabId, brokerState.spinnerQueue, "popup-state-broker:seed:spinners");
}

const spinnerOperations = createSpinnerOperations({
  queueByTabId: backgroundSpinnerQueueByTabId,
  normalizeTabId: normalizeSpinnerTabId,
  appendTrace: appendWorldTraceEvent,
  broadcastState: broadcastBrokerState,
  buildState: buildBrokerState,
  updateRuntimeSpinnerQueue(tabId, queue) {
    updateTabRuntime(tabId, {
      spinnerQueue: queue
    });
  },
  syncProjectedSpinnerState(tabId, queue, reason) {
    brain.syncProjectedSpinnerQueue(tabId, queue, `spinner-operations:${reason}`);
  }
});

function setBackgroundSpinnerEntry(tabId: unknown, key: unknown, entry: BackgroundSpinnerEntry = {}) {
  return spinnerOperations.setBackgroundSpinnerEntry(tabId, key, {
    ...entry,
    reason: typeof entry.reason === "string" && entry.reason ? entry.reason : `spinner:${String(key)}`,
    source: typeof entry.source === "string" && entry.source ? entry.source : "background-spinner-broker"
  });
}

function removeBackgroundSpinnerEntry(tabId: unknown, key: unknown) {
  return spinnerOperations.removeBackgroundSpinnerEntry(tabId, key);
}

function isActivationLifecycleKind(kind: unknown): boolean {
  return kind === LIFECYCLE_KINDS.ACTIVATION || kind === LIFECYCLE_KINDS.CONTENT_READY;
}

function isStaleActivationTerminalEvent(
  tabId: number,
  event: PopupLifecycleState = {}
): boolean {
  const eventKind = typeof event.kind === "string" ? event.kind : "";
  const eventPhase = typeof event.phase === "string" ? event.phase : "";
  const eventOperationId = typeof event.operationId === "string" ? event.operationId : "";
  if (
    eventKind !== LIFECYCLE_KINDS.ACTIVATION ||
    !isLifecycleTerminalPhase(eventPhase) ||
    !eventOperationId
  ) {
    return false;
  }
  const currentOperationId = brain.getActivationSnapshot(tabId).lastLifecycle?.operationId || "";
  return Boolean(currentOperationId && currentOperationId !== eventOperationId);
}

function buildRuntimeLifecycleSnapshot(
  tabId: number,
  event: PopupLifecycleState = {}
): Record<string, string | number | boolean | null> {
  const previousRuntime = getTabRuntimeSnapshot(tabId);
  const previous: Record<string, unknown> = previousRuntime &&
    previousRuntime.lifecycle &&
    typeof previousRuntime.lifecycle === "object"
    ? previousRuntime.lifecycle
    : {};
  const eventOperationId = typeof event.operationId === "string" && event.operationId
    ? event.operationId
    : "";
  const eventKind = typeof event.kind === "string" && event.kind ? event.kind : "";
  const eventPhase = typeof event.phase === "string" && event.phase ? event.phase : "";
  const hasBusy = Object.prototype.hasOwnProperty.call(event, "busy");
  return {
    ...previous,
    ...event,
    operationId: eventOperationId
      ? eventOperationId
      : (typeof previous.operationId === "string" && previous.operationId)
        ? previous.operationId
        : `lifecycle:${tabId}:${Date.now()}`,
    kind: eventKind || (typeof previous.kind === "string" ? previous.kind : "") || LIFECYCLE_KINDS.UNKNOWN,
    phase: eventPhase || (typeof previous.phase === "string" ? previous.phase : "") || LIFECYCLE_PHASES.UNKNOWN,
    message: typeof event.message === "string"
      ? event.message
      : (typeof previous.message === "string" ? previous.message : ""),
    busy: hasBusy ? Boolean(event.busy) : Boolean(previous.busy),
    updatedAt: Date.now()
  };
}

function clearBackgroundSpinnerQueue(tabId: unknown, options: { transientOnly?: unknown } = {}) {
  return spinnerOperations.clearBackgroundSpinnerQueue(tabId, options);
}

function withBackgroundTabSpinner<TResult>(
  tabId: number,
  descriptor: TabSpinnerDescriptor,
  work: (context: TabOperationSpinnerContext) => Promise<TResult>
): Promise<TResult> {
  return spinnerOperations.withTabSpinner(
    tabId,
    descriptor,
    (context) => work({ update: context.update })
  ) as Promise<TResult>;
}

brain.bus.registerHandler(SPINNER_REQUEST_TYPES.SET, (payload: SpinnerSetRequestPayload, meta) => {
  if (!meta.tab) {
    throw new Error("spinner.entry.set requires a tab id");
  }
  setBackgroundSpinnerEntry(meta.tab, payload.key, {
    ...payload,
    owner: SPINNER_OWNERS.POPUP
  });
  return brain.getPopupView(meta.tab);
});

brain.bus.registerHandler(SPINNER_REQUEST_TYPES.REMOVE, (payload: SpinnerRemoveRequestPayload, meta) => {
  if (!meta.tab) {
    throw new Error("spinner.entry.remove requires a tab id");
  }
  removeBackgroundSpinnerEntry(meta.tab, payload.key);
  return brain.getPopupView(meta.tab);
});

brain.bus.registerHandler(SPINNER_REQUEST_TYPES.CLEAR, (payload: SpinnerClearRequestPayload, meta) => {
  if (!meta.tab) {
    throw new Error("spinner.queue.clear requires a tab id");
  }
  clearBackgroundSpinnerQueue(meta.tab, {
    transientOnly: Boolean(payload.transientOnly)
  });
  return brain.getPopupView(meta.tab);
});

const tabOperationRunner = createTabOperationRunner({
  normalizeTabId: normalizeSpinnerTabId,
  updateLifecycleState,
  withTabSpinner: withBackgroundTabSpinner
});

async function runBackgroundTabOperation<TResult extends Record<string, unknown> = Record<string, unknown>>(
  tabId: unknown,
  descriptor: TabOperationDescriptor,
  work: TabOperationWork<TResult>
): Promise<TabOperationResult<TResult>> {
  return tabOperationRunner.runTabOperation(
    normalizeSpinnerTabId(tabId),
    descriptor,
    work
  ) as Promise<TabOperationResult<TResult>>;
}

browser.runtime.onConnect.addListener((port) => {
  if (port && typeof port.name === "string" && port.name.startsWith(BUS_PORT_PREFIX)) {
    const tabId = normalizeBrokerTabId(port.name.slice(BUS_PORT_PREFIX.length));
    if (!tabId) {
      try {
        port.disconnect();
      } catch {
        // Ignore invalid bus ports.
      }
      return;
    }
    brain.registerPopupPort(tabId, port);
    return;
  }
});

if (isFeatureEnabled("propertyLockCollaboration")) {
  initPropertyLockBackground({ keepAlive: swKeepAlive });
}
console.info("Unfluffify background worker ready");

// Service-worker lifecycle diagnostics (Phase 0). Gated behind the
// swLifecycleDiagnostics debug flag so production stays silent. MV3 can suspend
// the worker after ~30s idle, tearing down the property-lock WebSocket, the AI
// run poll loop, and the in-memory tab Maps. These logs make suspension and the
// at-risk surface visible when investigating slow/stuck AI-run and preview flows.
function countActiveAiComputeLocks(now = Date.now()): number {
  let active = 0;
  for (const expiresAt of aiComputeLockExpiresAtByTabId.values()) {
    if (typeof expiresAt === "number" && expiresAt > now) {
      active += 1;
    }
  }
  return active;
}

function logSwLifecycleDiagnostic(event: string, extra: Record<string, unknown> = {}): void {
  if (!isDebugFlagEnabled("swLifecycleDiagnostics")) {
    return;
  }
  let propertyLock: Record<string, unknown> = {};
  try {
    propertyLock = getPropertyLockConnectionDiagnostics();
  } catch {
    propertyLock = {};
  }
  try {
    console.debug("[sw-lifecycle]", event, {
      at: Date.now(),
      activeAiComputeLocks: countActiveAiComputeLocks(),
      lifecycleStates: tabLifecycleStateByTabId.size,
      spinnerQueues: tabSpinnerQueueByTabId.size,
      worldTraceStates: tabWorldTraceStateByTabId.size,
      propertyLock,
      ...extra
    });
  } catch {
    // Diagnostics must never break the worker.
  }
}

if (browser.runtime && typeof browser.runtime.onSuspend !== "undefined") {
  browser.runtime.onSuspend.addListener(() => {
    logSwLifecycleDiagnostic("suspend");
  });
}
if (browser.runtime && typeof browser.runtime.onSuspendCanceled !== "undefined") {
  browser.runtime.onSuspendCanceled.addListener(() => {
    logSwLifecycleDiagnostic("suspend-canceled");
  });
}
if (browser.runtime && typeof browser.runtime.onStartup !== "undefined") {
  browser.runtime.onStartup.addListener(() => {
    logSwLifecycleDiagnostic("startup");
  });
}
logSwLifecycleDiagnostic("worker-evaluated");

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (busProtocolBridge.isBusMessage(message)) {
    brain.transport.inbound(message, sender)
      .then((reply) => sendResponse(reply))
      .catch(() => sendResponse(undefined));
    return true;
  }

  if (!message || !message.type) {
    return;
  }

  if (isDebugFlagEnabled("fullWorldMessagingLogging")) {
    try {
      console.debug("[world-trace][background] runtime:inbound", {
        type: message.type,
        tabId: typeof sender?.tab?.id === "number" && Number.isFinite(sender.tab.id)
          ? Math.trunc(sender.tab.id)
          : null,
        frameId: typeof sender?.frameId === "number" && Number.isFinite(sender.frameId)
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

  if (message.type === "pageActivityObserved") {
    const tabId = getMessageTabId(message, sender);
    tabInactivityObserver.recordActivity(tabId, {
      source: "content",
      pageUrl: typeof message.pageUrl === "string" ? message.pageUrl : ""
    })
      .then(() => updateRenderModeNoJsInactivityWatch(tabId))
      .then(() => sendResponse({ ok: Boolean(tabId) }))
      .catch(() => sendResponse({ ok: false }));
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
          message: "Clearing this site's cache...",
          owner: SPINNER_OWNERS.POPUP,
          reason: "clear-cache",
          source: "background-command",
          persistent: false
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
    const normalizedTabId = normalizeBrokerTabId(tabId);
    const event = message.event && typeof message.event === "object"
      ? message.event
      : {};
    const eventKind = typeof event.kind === "string" ? event.kind : "";
    const eventPhase = typeof event.phase === "string" ? event.phase : "";
    if (normalizedTabId && isActivationLifecycleKind(eventKind)) {
      if (isStaleActivationTerminalEvent(normalizedTabId, event)) {
        sendResponse(buildBrokerState(normalizedTabId));
        return;
      }
      const runtimeLifecycle = buildRuntimeLifecycleSnapshot(
        normalizedTabId,
        event
      );
      updateTabRuntime(normalizedTabId, {
        lifecycle: runtimeLifecycle
      });
      appendWorldTraceEvent(normalizedTabId, "lifecycle", "state-update", runtimeLifecycle);
      brain.mirrorActivationLifecycle(
        normalizedTabId,
        event,
        "background:world-lifecycle-event"
      );
      if (
        eventKind === LIFECYCLE_KINDS.ACTIVATION &&
        isLifecycleTerminalPhase(eventPhase)
      ) {
        removeBackgroundSpinnerEntry(normalizedTabId, "navInspect");
      }
      const currentBrokerLifecycle = buildBrokerState(normalizedTabId).lifecycle;
      const currentBrokerLifecycleKind = typeof currentBrokerLifecycle?.kind === "string"
        ? currentBrokerLifecycle.kind
        : "";
      const shouldClearPopupLifecycleAuthority = Boolean(
        !currentBrokerLifecycle ||
        currentBrokerLifecycle.busy !== true ||
        isActivationLifecycleKind(currentBrokerLifecycleKind)
      );
      const state = shouldClearPopupLifecycleAuthority
        ? clearLifecycleState(normalizedTabId, {
          reason: "popup-state-broker:lifecycle-clear:activation",
          runtimeLifecycle
        })
        : buildBrokerState(normalizedTabId);
      sendResponse(state);
      return;
    }
    const state = updateLifecycleState(tabId, event);
    sendResponse(state);
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
    queueTabSessionWrite(tabId, async () => {
        const existingState = await getStoredTabState(tabId, scope);
        const existing = asTabStateRecord(existingState)
          ? asTabStateRecord(existingState)
          : {};
        let nextState: TabStateRecord;
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
        await setStoredTabState(tabId, nextState, scope, { skipQueue: true });
        if (scope) {
          return;
        }
        // Per the editor-mobile-only contract, marking enabled state does
        // not survive a navigation/refresh. Skip mirroring into the reload
        // restore scope; always clear any stale restore entry instead.
        await clearReloadRestoreTabState(tabId);
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
        await setBrowserSidePanelOptions({
          tabId,
          path: "popup.html",
          enabled: false
        });
      } catch (error) {
        // Side panel may already be disabled for this tab.
      }
      await reloadBrowserTab(tabId);
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
      resolveBackgroundNetworkCredentials
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
      tokenValue: message.tokenValue,
      resolveBackgroundNetworkCredentials
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
          error: error instanceof Error ? error.message : "Static HTML request failed"
        });
      }
    })();
    return true;
  }

});

browser.tabs.onRemoved.addListener((tabId) => {
  clearTrackedTabSessionState(tabId, { includeDeviceState: true }).then();
  clearRenderModeNoJsHeld(tabId).catch(() => null);
  brain.recordRenderModeNoJsHold(tabId, {
    held: false,
    javaScriptDisabled: false
  }, "render-mode:tab-removed");
  tabInactivityObserver.clearTab(tabId, {
    scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE
  }).catch(() => null);
  if (isFeatureEnabled("propertyLockCollaboration")) {
    handlePropertyLockBackgroundTabRemoved(tabId);
  }
  disposeTabState(tabId);
  deleteTabRuntime(tabId);
});

async function disableExtensionOnTopLevelNavigation(details: TopLevelNavigationDetails): Promise<void> {
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
browser.webNavigation.onCommitted.addListener(disableExtensionOnTopLevelNavigation);

async function normalizeRenderModeJavaScriptOnTopLevelNavigation(
  details: TopLevelNavigationDetails
): Promise<void> {
  if (details.frameId !== 0 || !details.tabId) {
    return;
  }
  // Only act on tabs that were intentionally left in "Without JavaScript" render
  // mode. The inspection's own reload also fires onBeforeNavigate, but those tabs
  // are not marked held yet, so JavaScript is never re-enabled mid-inspection.
  // It restores JavaScript only when the user navigates away from the no-JS page.
  if (!(await isRenderModeNoJsHeld(details.tabId))) {
    return;
  }
  await clearRenderModeNoJsHeld(details.tabId);
  brain.recordRenderModeNoJsHold(details.tabId, {
    held: false,
    javaScriptDisabled: false
  }, "render-mode:top-level-navigation");
  await tabInactivityObserver.clearTab(details.tabId, {
    scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE
  });
  await utils.setPageJavaScriptExecutionDisabled(details.tabId, false).catch(() => null);
  const deviceState = await getDeviceEmulationState(details.tabId).catch(() => null);
  if (!deviceState || !deviceState.enabled) {
    await utils.detachDebugger(details.tabId).catch(() => null);
  }
}

browser.webNavigation.onBeforeNavigate.addListener(normalizeRenderModeJavaScriptOnTopLevelNavigation);

browser.webNavigation.onCompleted.addListener(async (details) => {
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
browser.webNavigation.onHistoryStateUpdated.addListener(disableExtensionOnTopLevelNavigation);
browser.webNavigation.onReferenceFragmentUpdated.addListener(disableExtensionOnTopLevelNavigation);

browser.debugger.onDetach.addListener(async (source) => {
  if (!source || !source.tabId) {
    return;
  }
  const tabState = await utils.getTabState(source.tabId);
  if (tabState && tabState.enabled) {
    runBackgroundTask(
      "debugger-detach-restore-mobile-enabled-tab",
      updateDeviceEmulation(source.tabId, {
        enabled: true,
        mode: "mobile",
        recalculateScale: true
      }),
      {
        tabId: source.tabId,
        appendTrace: appendWorldTraceEvent
      }
    );
    return;
  }
  const initialState = await utils.getTabState(source.tabId, "initial");
  if (initialState && initialState.desktopPreviewEnabled) {
    await utils.setTabState(source.tabId, {
      ...initialState,
      active: Boolean(initialState.active),
      desktopPreviewEnabled: false
    }, "initial");
    runBackgroundTask(
      "debugger-detach-restore-mobile-initial-state",
      updateDeviceEmulation(source.tabId, {
        enabled: true,
        mode: "mobile",
        recalculateScale: true
      }),
      {
        tabId: source.tabId,
        appendTrace: appendWorldTraceEvent
      }
    );
    return;
  }
  const state = await getDeviceEmulationState(source.tabId);
  if (!state.enabled) {
    return;
  }
  await setDeviceEmulationEnabled(source.tabId, false);
});

async function refreshActionIconsForWindow(windowId: number) {
  if (!windowId || windowId === browser.windows.WINDOW_ID_NONE) {
    return;
  }
  let tabs: Browser.tabs.Tab[] = [];
  try {
    tabs = await queryBrowserTabs({ windowId });
  } catch (error) {
    tabs = [];
  }
  await Promise.all(
    tabs
      .map((tab) => (tab && tab.id ? utils.updateActionForTab(tab.id) : null))
      .filter(Boolean)
  );
}

browser.tabs.onActivated.addListener(async ({ windowId }) => {
  await refreshActionIconsForWindow(windowId);
  await updateRenderModeNoJsInactivityWatches();
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
  await refreshActionIconsForWindow(windowId);
  await updateRenderModeNoJsInactivityWatches();
});

const TAB_RESTORE_SCOPE = "restore";

async function clearTrackedTabSessionState(
  tabId: unknown,
  options: TrackedTabSessionClearOptions = {}
): Promise<void> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return;
  }
  const { includeDeviceState = false } = options;
  await clearStoredTrackedTabSessionState(normalizedTabId, {
    includeRestoreScope: true,
    includeScriptInjected: true
  });
  if (includeDeviceState) {
    await clearDeviceEmulationState(normalizedTabId);
  }
}

async function clearReloadRestoreTabState(tabId: unknown): Promise<void> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return;
  }
  await clearTabStateScope(normalizedTabId, TAB_RESTORE_SCOPE);
}

async function clearReloadRestoreTabStateAfterActivation(
  tabId: unknown,
  tabState: TabStateRecord | null
): Promise<void> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || !tabState || tabState.enabled !== true || typeof tabState.baseUrl !== "string" || !tabState.baseUrl) {
    return;
  }
  await clearReloadRestoreTabState(normalizedTabId);
}

function requestContentActivation(tabId: unknown, attempt = 0): void {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return;
  }
  sendBrowserTabMessage(normalizedTabId, { type: "activateContentMain" }, { frameId: 0 })
    .catch(() => {
      if (attempt < 3) {
        setTimeout(() => requestContentActivation(normalizedTabId, attempt + 1), 200);
      }
    });
}

function restoreEnabledStateForTab(tabId: unknown, tabState: TabStateRecord | null, attempt = 0): void {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId || !tabState || tabState.enabled !== true || typeof tabState.baseUrl !== "string" || !tabState.baseUrl) {
    return;
  }
  const operationId = `activation:${normalizedTabId}:${Date.now()}:${attempt}`;
  brain.mirrorActivationLifecycle(normalizedTabId, {
    operationId,
    kind: LIFECYCLE_KINDS.ACTIVATION,
    phase: LIFECYCLE_PHASES.STARTED,
    busy: true,
    message: "Preparing page content for marking..."
  }, "background:restore-enabled-state:lifecycle-started");
  sendBrowserTabMessage(
    normalizedTabId,
    {
      type: "setEnabled",
      enabled: true,
      baseUrl: tabState.baseUrl,
      pageType: typeof tabState.pageType === "string" ? tabState.pageType : "",
      performInitialReveal: true,
      operationId
    },
    { frameId: 0 }
  )
    .then((response) => {
      const normalizedResponse = response && typeof response === "object"
        ? response as { ok?: boolean; locked?: boolean }
        : undefined;
      if (!normalizedResponse || normalizedResponse.ok === false) {
        if (attempt < 4 && !(normalizedResponse && normalizedResponse.locked)) {
          setTimeout(() => restoreEnabledStateForTab(normalizedTabId, tabState, attempt + 1), 200);
        } else {
          brain.mirrorActivationLifecycle(normalizedTabId, {
            operationId,
            kind: LIFECYCLE_KINDS.ACTIVATION,
            phase: LIFECYCLE_PHASES.FAILED,
            busy: false,
            message: ""
          }, "background:restore-enabled-state:lifecycle-failed");
          removeBackgroundSpinnerEntry(normalizedTabId, "navInspect");
        }
        return;
      }
      runBackgroundTask(
        "clear-reload-restore-tab-state-after-activation",
        clearReloadRestoreTabStateAfterActivation(normalizedTabId, tabState),
        {
          tabId: normalizedTabId,
          appendTrace: appendWorldTraceEvent
        }
      );
    })
    .catch(() => {
      if (attempt < 4) {
        setTimeout(() => restoreEnabledStateForTab(normalizedTabId, tabState, attempt + 1), 200);
        return;
      }
      brain.mirrorActivationLifecycle(normalizedTabId, {
        operationId,
        kind: LIFECYCLE_KINDS.ACTIVATION,
        phase: LIFECYCLE_PHASES.FAILED,
        busy: false,
        message: ""
      }, "background:restore-enabled-state:lifecycle-failed");
      removeBackgroundSpinnerEntry(normalizedTabId, "navInspect");
    });
}

async function getTabUrl(tabId: unknown): Promise<string> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return "";
  }
  try {
    const tab = await getBrowserTab(normalizedTabId);
    return (tab && typeof tab.url === "string") ? tab.url : "";
  } catch (error) {
    return "";
  }
}

async function ensureDefaultMobileEmulationForTab(
  tabId: unknown,
  tabUrl = ""
): Promise<DefaultMobileEmulationState | null> {
  const normalizedTabId = normalizeBrokerTabId(tabId);
  if (!normalizedTabId) {
    return null;
  }
  const resolvedUrl = typeof tabUrl === "string" && tabUrl
    ? tabUrl
    : await getTabUrl(normalizedTabId);
  if (!utils.getOriginFromUrl(resolvedUrl)) {
    return null;
  }
  try {
    const result = await ensureDefaultMobileDeviceEmulation(normalizedTabId);
    if (!result || !result.ok) {
      if (result && result.error) {
        console.warn("Default mobile emulation failed:", result.error);
      }
      return null;
    }
    return result.state || null;
  } catch (error) {
    console.warn("Default mobile emulation failed:", error);
    return null;
  }
}

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
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

utils.addStorageChangeListener((changes, areaName) => {
  if (areaName !== "session") {
    return;
  }
  const sessionChanges: SessionStorageChanges = changes && typeof changes === "object"
    ? changes as SessionStorageChanges
    : {};
  Object.keys(sessionChanges).forEach((key) => {
    const parsed = parseTabStateStorageKey(key);
    if (!parsed || !parsed.tabId) {
      return;
    }
    utils.updateActionForTab(parsed.tabId).then();
  });
});

browser.action.onClicked.addListener((tab) => {
  if (tab.id) {
    setBrowserSidePanelOptions({
      tabId: tab.id,
      path: "popup.html",
      enabled: true
    }).then();
    openBrowserSidePanel({ tabId: tab.id }).then();
  }
});

// Sweep orphaned transfer-payload keys on every service-worker start.
// This keeps session storage tidy when an AI run or config sync was aborted
// mid-flight and did not reach the consume-purge step.
sweepStaleTransferPayloads().then();
updateRenderModeNoJsInactivityWatches().catch(() => {});
}
