/**
 * @fileoverview Main popup interface for the Unfluffify extension.
 * 
 * This is the entry point for the popup UI. It handles:
 * - Rendering the popup interface with Preact
 * - Managing tab state (enabled/disabled status, base URLs, etc.)
 * - Sending and receiving messages from the content script
 * - Managing AI selector configuration and computation
 * - Handling device emulation/simulation settings
 * - Syncing page markings and exclusions
 * - Caching and persistence of user preferences
 * - API interactions for remote configuration
 * 
 * The UI is built using Preact and manages view states for:
 * - Marking: Main content exclusion/inclusion interface
 * - Configuration: AI selector and rendering mode settings
 * - Consent: Cookie/consent banner detection settings
 * - Silent Highlight: Visual overlay and highlighting modes
 */

import * as chromeHelpers from "./popup/chrome-helpers.js";
import * as config from "./common/config.js";
import * as constants from "./common/constants.js";
import {
  FEATURE_DISABLED_REASON,
  getFeatureFlags,
  isDebugFlagEnabled,
  isFeatureEnabled
} from "./common/feature-flags.js";
import * as emulation from "./popup/emulation.js";
import * as uiModule from "./popup/ui.js";
import {
  buildLynxChecklistPromptState,
  buildLynxChecklistViewModel,
  createInitialLynxChecklistState,
  normalizeCandidatePageUrl,
  normalizePageTypeKey,
  normalizePropertyPageTypes
} from "./common/lynx-checklist.js";
import {
  buildPageSaveUiState
} from "./common/page-save-state.js";
import {
  buildGraphqlEndpointFromStageBase,
  getCurrentPageCandidateState,
  normalizeSiteIdValue,
  normalizeStageBase
} from "./common/lynx-live-pages.js";
import {
  clearGlobalToken,
  getGlobalToken,
  getThemeSettings,
  saveGlobalConfigEndpoint,
  saveGlobalEndpoint,
  saveGlobalStageBase,
  saveLoginSettings,
  setThemeSettings
} from "./common/settings-store.js";
import {
  buildTransferPayloadKey,
  consumeTransferPayload,
  putTransferPayload
} from "./background/transfer-payload-store.js";
import {
  PopupText,
  ViewText,
  formatClearDomainCacheConfirm,
  formatConfigLoadStatusLabel,
  formatLoginFailedStatus,
  formatScalePercent,
  formatSelectorsComputedLocally,
  formatTimestampedStatus,
  propertyLockText
} from "./common/text.js";
import * as utils from "./common/utilities.js";
import * as messages from "./popup/messages.js";
import * as helpers from "./popup/helpers.js";
import {
  AI_RUN_POLL_INTERVAL_MS,
  AI_RUN_TIMEOUT_MS,
  formatAiRunCountdown,
  getAiRunRemainingMs,
  getAiRunResumeExpiresAt,
  normalizePersistedAiRunRecord,
  shouldResumePersistedAiRun
} from "./popup/ai-run.js";
import { resolveRenderModeInspectionReloadOutcome } from "./popup/render-mode.js";
import {
  isRenderModeNoJsHeld,
  renderModeNoJsHeldStorageKey
} from "./common/render-mode-js-state.js";
import * as stateModule from "./popup/state.js";
import {
  logPopupReady
} from "./popup/telemetry.js";
import {
  armSpinnerWatchdog as armSpinnerWatchdogOperation,
  clearSpinnerWatchdog as clearSpinnerWatchdogOperation,
  currentSpinnerMessage as currentSpinnerMessageOperation,
  currentSpinnerSnapshot as currentSpinnerSnapshotOperation,
  normalizeSpinnerReason as normalizeSpinnerReasonOperation,
  popSpinner as popSpinnerOperation,
  pushSpinner as pushSpinnerOperation,
  runWithSpinner as runWithSpinnerOperation,
  setSpinnerMessage as setSpinnerMessageOperation
} from "./popup/spinner.js";
import {
  ensureBaseUrlSiteId as ensureBaseUrlSiteIdOperation,
  ensurePropertyPageTypes as ensurePropertyPageTypesOperation,
  fetchPropertyPageTypesFromGraphql as fetchPropertyPageTypesFromGraphqlOperation,
  mergeConfigEntriesForResolvedBaseUrl as mergeConfigEntriesForResolvedBaseUrlOperation,
  resolveSiteIdFromGraphql as resolveSiteIdFromGraphqlOperation
} from "./popup/site-resolution.js";
import {
  loadRemoteConfigForCurrentPage as loadRemoteConfigForCurrentPageOperation,
  scheduleRemoteConfigRetry as scheduleRemoteConfigRetryOperation,
  syncBaseConfigToServer as syncBaseConfigToServerOperation
} from "./popup/remote-config.js";
import {
  completeRenderModeInspectionReloadFollowUp as completeRenderModeInspectionReloadFollowUpOperation,
  detectRenderModeViaEndpoint as detectRenderModeViaEndpointOperation,
  maybeAutoDetectRenderMode as maybeAutoDetectRenderModeOperation,
  normalizeRenderModeDetectionResult as normalizeRenderModeDetectionResultOperation,
  waitForTabLoadComplete as waitForTabLoadCompleteOperation,
  waitForTabLoadStart as waitForTabLoadStartOperation
} from "./popup/render-mode-inspection.js";
import {
  handlePageRevert as handlePageRevertOperation,
  handlePageSave as handlePageSaveOperation,
  hasCurrentPagePendingChanges as hasCurrentPagePendingChangesOperation
} from "./popup/page-reconciliation.js";
import {
  applyPropertyLockConnectionStatus as applyPropertyLockConnectionStatusOperation,
  applyPropertyLockServerMessage as applyPropertyLockServerMessageOperation,
  applyPropertyLockState as applyPropertyLockStateOperation,
  buildPropertyLockViewState as buildPropertyLockViewStateOperation,
  clearPropertyLockOffCandidateRefreshTimer as clearPropertyLockOffCandidateRefreshTimerOperation,
  clearPropertyLockTransientState as clearPropertyLockTransientStateOperation,
  fetchPropertyLockState as fetchPropertyLockStateOperation,
  isPropertyLockBlockingEditing as isPropertyLockBlockingEditingOperation,
  isPropertyLockCollaborationEnabled as isPropertyLockCollaborationEnabledOperation,
  persistPropertyLockRecoveryMetadata as persistPropertyLockRecoveryMetadataOperation,
  queueEditorBootstrapOnLockTransition as queueEditorBootstrapOnLockTransitionOperation,
  reconcilePropertyLockAfterCommand as reconcilePropertyLockAfterCommandOperation,
  refreshPropertyLockSnapshot as refreshPropertyLockSnapshotOperation,
  resetDisabledPropertyLockState as resetDisabledPropertyLockStateOperation,
  resetPropertyLockState as resetPropertyLockStateOperation,
  sendPropertyLockCommand as sendPropertyLockCommandOperation,
  syncPropertyLockOffCandidateRefreshTimer as syncPropertyLockOffCandidateRefreshTimerOperation
} from "./popup/property-lock-ui.js";
import {
  createPopupTimerGroup
} from "./popup/timers.js";
import {
  refineXPathEntries
} from "./common/xpath-utilities.js";
import {
  normalizeAiSelectorSet,
  combineAiSelectorSet,
  aiSelectorSetsEqual
} from "./common/selector-set.js";
import {
  SPINNER_OWNERS,
  WORLD_MESSAGE_TYPES,
  buildPopupStatePortName
} from "./common/world-messaging-contract.js";
import {
  PROPERTY_LOCK_BACKGROUND_GET_STATE,
  PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
  PROPERTY_LOCK_CONTENT_TAKE_LOCK,
  PROPERTY_LOCK_CONTENT_SUGGEST,
  PROPERTY_LOCK_CONTENT_RESPOND,
  PROPERTY_LOCK_CONTENT_CONTINUE,
  PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
  PROPERTY_LOCK_CONNECTION_CONNECTING,
  PROPERTY_LOCK_CONNECTION_CONNECTED,
  PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
  PROPERTY_LOCK_CONNECTION_INACTIVE,
  PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
  PROPERTY_LOCK_STATE_UNLOCKED,
  PROPERTY_LOCK_STATE_LOCKED,
  PROPERTY_LOCK_STATE_EXPIRY_WARNING,
  PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE,
  PROPERTY_LOCK_STATE_TRANSFER,
  PROPERTY_LOCK_WS_LOCK_STATE,
  PROPERTY_LOCK_WS_DISCONNECT_WARNING,
  PROPERTY_LOCK_WS_INACTIVITY_WARNING,
  PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION,
  PROPERTY_LOCK_WS_SUGGESTION_PENDING,
  PROPERTY_LOCK_WS_SUGGESTION_RESPONSE,
  PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED,
  PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN,
  PROPERTY_LOCK_WS_ERROR,
  createInactiveLockState,
  normalizeLockStateMessage
} from "./common/property-lock.js";

const { state } = stateModule;
const PAGE_SAVE_SYNC_MAX_ATTEMPTS = 5;
const PAGE_SAVE_SYNC_INITIAL_RETRY_DELAY_MS = 1500;
const PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS = 10000;
const AI_PREVIEW_MARKING_RESTORE_HOLD_MS = 5000;

function getPropertyLockUiDeps() {
  return {
    isFeatureEnabled,
    FEATURE_DISABLED_REASON,
    propertyLockText,
    createInactiveLockState,
    normalizeLockStateMessage,
    normalizeSiteIdValue,
    PROPERTY_LOCK_BACKGROUND_GET_STATE,
    PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
    PROPERTY_LOCK_CONNECTION_INACTIVE,
    PROPERTY_LOCK_CONNECTION_CONNECTING,
    PROPERTY_LOCK_CONNECTION_CONNECTED,
    PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
    PROPERTY_LOCK_WS_LOCK_STATE,
    PROPERTY_LOCK_WS_DISCONNECT_WARNING,
    PROPERTY_LOCK_WS_INACTIVITY_WARNING,
    PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION,
    PROPERTY_LOCK_WS_SUGGESTION_PENDING,
    PROPERTY_LOCK_WS_SUGGESTION_RESPONSE,
    PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED,
    PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN,
    PROPERTY_LOCK_WS_ERROR,
    PROPERTY_LOCK_STATE_UNLOCKED,
    PROPERTY_LOCK_STATE_LOCKED,
    PROPERTY_LOCK_STATE_EXPIRY_WARNING,
    PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE,
    PROPERTY_LOCK_STATE_TRANSFER,
    windowRef: window,
// @ts-expect-error
    refreshUi: (options) => refreshUi(options),
// @ts-expect-error
    setTabState: (...args) => messages.setTabState(...args),
// @ts-expect-error
    sendRuntimeMessage: (payload) => messages.sendRuntimeMessage(payload),
// @ts-expect-error
    showToast: (message) => {
      uiModule.showToast(message);
    },
// @ts-expect-error
    setViewState: (viewState) => {
      uiModule.setViewState(viewState);
    },
// @ts-expect-error
    refreshCurrentPageRuntimeStatus: (options) => refreshCurrentPageRuntimeStatus(options),
    isPropertyLockCollaborationEnabled: () => isPropertyLockCollaborationEnabled(),
    resetPropertyLockState: () => resetPropertyLockState(),
    clearPropertyLockTransientState: () => clearPropertyLockTransientState(),
    clearPropertyLockOffCandidateRefreshTimer: () => clearPropertyLockOffCandidateRefreshTimer(),
    resetDisabledPropertyLockState: () => resetDisabledPropertyLockState(),
// @ts-expect-error
    applyPropertyLockState: (lockStateLike) => applyPropertyLockState(lockStateLike),
// @ts-expect-error
    queueEditorBootstrapOnLockTransition: (previousLockState, nextLockState) =>
      queueEditorBootstrapOnLockTransition(previousLockState, nextLockState),
// @ts-expect-error
    applyPropertyLockConnectionStatus: (status, error) =>
      applyPropertyLockConnectionStatus(status, error),
// @ts-expect-error
    fetchPropertyLockState: (siteId) => fetchPropertyLockState(siteId),
// @ts-expect-error
    refreshPropertyLockSnapshot: (siteId, options) => refreshPropertyLockSnapshot(siteId, options),
    buildPropertyLockViewState: () => buildPropertyLockViewState()
  };
}

const isPropertyLockCollaborationEnabled = () =>
  isPropertyLockCollaborationEnabledOperation(getPropertyLockUiDeps());
const resetDisabledPropertyLockState = () =>
  resetDisabledPropertyLockStateOperation(getPropertyLockUiDeps());
const resetPropertyLockState = () =>
  resetPropertyLockStateOperation(getPropertyLockUiDeps());
const clearPropertyLockTransientState = () =>
// @ts-expect-error
  clearPropertyLockTransientStateOperation(getPropertyLockUiDeps());
const clearPropertyLockOffCandidateRefreshTimer = () =>
  clearPropertyLockOffCandidateRefreshTimerOperation(getPropertyLockUiDeps());
// @ts-expect-error
const syncPropertyLockOffCandidateRefreshTimer = (active) =>
  syncPropertyLockOffCandidateRefreshTimerOperation(getPropertyLockUiDeps(), active);
// @ts-expect-error
const persistPropertyLockRecoveryMetadata = (tabId, recoveryState = {}) =>
  persistPropertyLockRecoveryMetadataOperation(getPropertyLockUiDeps(), tabId, recoveryState);
// @ts-expect-error
const applyPropertyLockState = (lockStateLike) =>
  applyPropertyLockStateOperation(getPropertyLockUiDeps(), lockStateLike);
// @ts-expect-error
const queueEditorBootstrapOnLockTransition = (previousLockState, nextLockState) =>
  queueEditorBootstrapOnLockTransitionOperation(getPropertyLockUiDeps(), previousLockState, nextLockState);
// @ts-expect-error
const applyPropertyLockConnectionStatus = (status, error = "") =>
  applyPropertyLockConnectionStatusOperation(getPropertyLockUiDeps(), status, error);
// @ts-expect-error
const applyPropertyLockServerMessage = (serverMessage, siteId = null) =>
  applyPropertyLockServerMessageOperation(getPropertyLockUiDeps(), serverMessage, siteId);
const isPropertyLockBlockingEditing = () =>
  isPropertyLockBlockingEditingOperation(getPropertyLockUiDeps());
const buildPropertyLockViewState = () =>
  buildPropertyLockViewStateOperation(getPropertyLockUiDeps());
// @ts-expect-error
const fetchPropertyLockState = (siteId) =>
  fetchPropertyLockStateOperation(getPropertyLockUiDeps(), siteId);
// @ts-expect-error
const refreshPropertyLockSnapshot = (siteId, options = {}) =>
  refreshPropertyLockSnapshotOperation(getPropertyLockUiDeps(), siteId, options);
// @ts-expect-error
const sendPropertyLockCommand = (type, payload = {}) =>
  sendPropertyLockCommandOperation(getPropertyLockUiDeps(), type, payload);
const reconcilePropertyLockAfterCommand = (options = {}) =>
  reconcilePropertyLockAfterCommandOperation(getPropertyLockUiDeps(), options);

const TOKEN_VALIDATION_INTERVAL_MS = 600 * 1000;
const POPUP_BUSY_OVERLAY_DELAY_MS = 180;
const REMOTE_CONFIG_RETRY_DELAY_MS = 2500;
const SILENT_HIGHLIGHTING_PREPARATION_REASON = "editor_preparing";
const RENDER_MODE_DETECTION_MAX_ATTEMPTS = 3;
const RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY = 0.65;
const RENDER_MODE_DETECTION_REVIEW_ACCURACY = 0.95;
const RENDER_MODE_INSPECTION_START_TIMEOUT_MS = 2000;
const RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS = 8000;
const RENDER_MODE_SET_NAV_GUARD_MAX_MS = 20000;
const RENDER_MODE_UNDETERMINED = "undetermined";
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS = 120 * 1000;
const OBSERVER_REMOTE_CONFIG_REFRESH_INTERVAL_MS = 60 * 1000;
const TODO_EXPANSION_CONTEXT_LIMIT = 200;
const GLOBAL_THEME_KEY = "globalTheme";
const GLOBAL_THEME_MODE_KEY = "globalThemeMode";
const THEME_DEFAULT = "nordic";
const THEME_MODE_DEFAULT = "system";
const THEME_MODE_SYSTEM = "system";
const THEME_MODE_LIGHT = "light";
const THEME_MODE_DARK = "dark";
const THEME_ACCENT_CLUSTER_ORDER = Object.freeze({
  blue: 0,
  cyan: 1,
  green: 2,
  warm: 3,
  violet: 4
});
const THEME_CATALOG = Object.freeze([
  { value: "blueprint", label: "Blueprint", cluster: "blue" },
  { value: "swedish-minimal", label: "Swedish Minimal", cluster: "blue" },
  { value: "cool", label: "Cool", cluster: "blue" },
  { value: "nordic", label: "Nordic", cluster: "blue" },
  { value: "neutral", label: "Neutral", cluster: "violet" },
  { value: "tidepool", label: "Tidepool", cluster: "cyan" },
  { value: "mint", label: "Mint", cluster: "cyan" },
  { value: "ocean", label: "Ocean", cluster: "cyan" },
  { value: "graphite", label: "Graphite", cluster: "cyan" },
  { value: "earthy", label: "Earthy", cluster: "green" },
  { value: "olive", label: "Olive", cluster: "green" },
  { value: "sunset", label: "Sunset", cluster: "warm" },
  { value: "clay-rose", label: "Clay Rose", cluster: "warm" },
  { value: "plum-steel", label: "Plum Steel", cluster: "violet" },
  { value: "plum", label: "Plum", cluster: "violet" },
  { value: "lavender", label: "Lavender", cluster: "violet" }
]);
const THEME_IDS = new Set(THEME_CATALOG.map((theme) => theme.value));
const THEME_OPTIONS = Object.freeze(
  [...THEME_CATALOG]
    .sort((left, right) => {
// @ts-expect-error
      const leftOrder = THEME_ACCENT_CLUSTER_ORDER[left.cluster] ?? Number.MAX_SAFE_INTEGER;
// @ts-expect-error
      const rightOrder = THEME_ACCENT_CLUSTER_ORDER[right.cluster] ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.label.localeCompare(right.label);
    })
    .map((theme) => ({ value: theme.value, label: theme.label }))
);
const popupSpinnerQueue = new Map();
const popupSpinnerKeyTabIds = new Map();
let popupSpinnerVisible = false;
let popupSpinnerTimer = 0;
// Fail-open watchdog: every queued spinner is force-cleared if it makes no
// progress for this long. runWithSpinner relies on its finally to pop the
// spinner, but if an awaited operation (e.g. device emulation / debugger
// attach, a hung network call, a tab reload that never completes) never
// settles, the finally never runs and the popup stays blocked forever. The
// watchdog guarantees no spinner can stick. It is reset whenever the spinner's
// message changes (progress), so legitimately long multi-stage operations are
// not cut off mid-flight.
const SPINNER_WATCHDOG_MS = 60000;
const POPUP_PAGE_BUSY_MIRROR_DELAY_MS = 3500;
const popupSpinnerWatchdogByKey = new Map();
let popupNavigationInspectionOverlayStarted = false;
// @ts-expect-error
let popupNavigationInspectionOverlayTabId = null;
const popupNavigationInspectionSettlePollByTabId = new Map();
const popupRenderModeSetNavGuardByTabId = new Map();
let popupStaleInspectionBusyClearTimer = 0;
// @ts-expect-error
let popupBackgroundStatePort = null;
// @ts-expect-error
let popupBackgroundLifecycle = null;
// @ts-expect-error
let popupPageBusyMirrorTabId = null;
let popupPageBusyMirrorActive = false;
let popupPageBusyMirrorSignature = "";
let popupPageBusyMirrorPendingSignature = "";
let popupPageBusyMirrorShowTimer = 0;
// @ts-expect-error
let propertyPageTypesRequest = null;
const popupTimers = createPopupTimerGroup({ windowRef: window });

// @ts-expect-error
function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function getSpinnerDeps() {
  return {
    popupSpinnerQueue,
    popupSpinnerKeyTabIds,
    popupSpinnerWatchdogByKey,
    spinnerWatchdogMs: SPINNER_WATCHDOG_MS,
    uiModule,
    windowRef: window,
    cryptoRef: crypto,
    getCurrentPopupTabId,
    getPopupSpinnerVisible: () => popupSpinnerVisible,
// @ts-expect-error
    setPopupSpinnerVisible: (value) => {
      popupSpinnerVisible = Boolean(value);
    },
    getPopupSpinnerTimer: () => popupSpinnerTimer,
// @ts-expect-error
    setPopupSpinnerTimer: (value) => {
      popupSpinnerTimer = Number(value) || 0;
    },
// @ts-expect-error
    popSpinner: (key) => {
      popSpinner(key);
    },
    logPopupSpinnerDebug,
    setUiBusyFromCurrentSpinner,
    syncUiBusyFromBrokerState,
    syncSpinnerEntryToBackground,
    removeSpinnerEntryFromBackground,
    clearSpinnerQueueInBackground,
    scheduleStaleInspectionBusyClear,
    syncPageBusyFromPopupSpinner
  };
}

// @ts-expect-error
const currentSpinnerMessage = () => currentSpinnerMessageOperation(getSpinnerDeps());
// @ts-expect-error
const currentSpinnerSnapshot = () => currentSpinnerSnapshotOperation(getSpinnerDeps());
// @ts-expect-error
const normalizeSpinnerReason = (reason, key, message) =>
// @ts-expect-error
  normalizeSpinnerReasonOperation(getSpinnerDeps(), reason, key, message);
// @ts-expect-error
const clearSpinnerWatchdog = (key) => clearSpinnerWatchdogOperation(getSpinnerDeps(), key);
// @ts-expect-error
const armSpinnerWatchdog = (key) => armSpinnerWatchdogOperation(getSpinnerDeps(), key);
// @ts-expect-error
const pushSpinner = (key, message, options = {}) =>
// @ts-expect-error
  pushSpinnerOperation(getSpinnerDeps(), key, message, options);
// @ts-expect-error
const setSpinnerMessage = (key, message) =>
// @ts-expect-error
  setSpinnerMessageOperation(getSpinnerDeps(), key, message);
// @ts-expect-error
const popSpinner = (key) => popSpinnerOperation(getSpinnerDeps(), key);
// @ts-expect-error
const runWithSpinner = (key, message, task, options = {}) =>
// @ts-expect-error
  runWithSpinnerOperation(getSpinnerDeps(), key, message, task, options);

function getSiteResolutionDeps() {
  return {
    PopupText,
    ViewText,
// @ts-expect-error
    showToast: (message) => {
      uiModule.showToast(message);
    },
    propertyPageTypesRefreshIntervalMs: PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS,
// @ts-expect-error
    getPropertyPageTypesRequest: () => propertyPageTypesRequest,
// @ts-expect-error
    setPropertyPageTypesRequest: (nextRequest) => {
      propertyPageTypesRequest = nextRequest;
    }
  };
}

const fetchPropertyPageTypesFromGraphql = (options = {}) =>
  fetchPropertyPageTypesFromGraphqlOperation(getSiteResolutionDeps(), options);
const ensurePropertyPageTypes = (options = {}) =>
  ensurePropertyPageTypesOperation(getSiteResolutionDeps(), options);
const resolveSiteIdFromGraphql = (options = {}) =>
  resolveSiteIdFromGraphqlOperation(getSiteResolutionDeps(), options);
// @ts-expect-error
const mergeConfigEntriesForResolvedBaseUrl = (resolvedBaseUrl, preferredEntry, existingEntry) =>
  mergeConfigEntriesForResolvedBaseUrlOperation(
    getSiteResolutionDeps(),
    resolvedBaseUrl,
    preferredEntry,
    existingEntry
  );
const ensureBaseUrlSiteId = (options = {}) =>
  ensureBaseUrlSiteIdOperation(getSiteResolutionDeps(), options);

function getRemoteConfigDeps() {
  return {
    PopupText,
    remoteConfigRetryDelayMs: REMOTE_CONFIG_RETRY_DELAY_MS,
    windowRef: window,
    ensureActiveTab: () => helpers.ensureActiveTab(),
// @ts-expect-error
    refreshUi: (options) => refreshUi(options),
    resolveRelativeEndpoint,
    updateLastConfigLoadStatus,
    invalidateTokenAndLockConfiguration,
// @ts-expect-error
    showToast: (message) => {
      uiModule.showToast(message);
    },
// @ts-expect-error
    ensureBaseUrlSiteId: (options) => ensureBaseUrlSiteId(options),
// @ts-expect-error
    getStoredGlobalToken: (options) => getStoredGlobalToken(options),
// @ts-expect-error
    ensurePropertyPageTypes: (options) => ensurePropertyPageTypes(options),
    collectStoredPageMarkingItems,
    buildLynxChecklistViewModel,
    buildPageMarkingKey,
    buildTransferPayloadKey,
    putTransferPayload,
    waitForRetryDelay,
    isRetryableHttpStatus,
    pruneRemoteInvalidPageMarkings
  };
}

const scheduleRemoteConfigRetry = () =>
  scheduleRemoteConfigRetryOperation(getRemoteConfigDeps());
const loadRemoteConfigForCurrentPage = (options = {}) =>
  loadRemoteConfigForCurrentPageOperation(getRemoteConfigDeps(), options);
const syncBaseConfigToServer = (options = {}) =>
  syncBaseConfigToServerOperation(getRemoteConfigDeps(), options);

function getRenderModeInspectionDeps() {
  return {
    state,
    config,
    PopupText,
    RENDER_MODE_DETECTION_MAX_ATTEMPTS,
    RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY,
    RENDER_MODE_INSPECTION_START_TIMEOUT_MS,
    RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS,
    RENDER_MODE_UNDETERMINED,
    windowRef: window,
    chromeRef: chrome,
    messages,
    shouldAutoDetectRenderMode,
    getCurrentRenderModeInspectionSnapshot,
    getSuggestedRenderModeForPage,
    markRenderModeUndetermined,
    loadGlobalAiSettings: () => helpers.loadGlobalAiSettings(),
    runWithSpinner,
    normalizeUiRenderModeValue,
    buildTransferPayloadKey,
    putTransferPayload,
    waitForRetryDelay,
    getRetryDelayMs,
    isRetryableHttpStatus,
    ensureContentReadyForRenderModeInspection,
    rememberRenderModeInspectionSnapshot,
    hideConsentForRenderModeInspection,
    reconcilePropertyLockAfterRenderModeReload,
    scheduleStaleInspectionBusyClear
  };
}

// @ts-expect-error
const normalizeRenderModeDetectionResult = (payload) =>
  normalizeRenderModeDetectionResultOperation(getRenderModeInspectionDeps(), payload);
// @ts-expect-error
const maybeAutoDetectRenderMode = (pageUrl) =>
  maybeAutoDetectRenderModeOperation(getRenderModeInspectionDeps(), pageUrl);
const detectRenderModeViaEndpoint = (options = {}) =>
  detectRenderModeViaEndpointOperation(getRenderModeInspectionDeps(), options);
// @ts-expect-error
const waitForTabLoadStart = (tabId, timeoutMs = RENDER_MODE_INSPECTION_START_TIMEOUT_MS) =>
  waitForTabLoadStartOperation(getRenderModeInspectionDeps(), tabId, timeoutMs);
const waitForTabLoadComplete = (
// @ts-expect-error
  tabId,
  timeoutMs = RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS,
  options = {}
) => waitForTabLoadCompleteOperation(getRenderModeInspectionDeps(), tabId, timeoutMs, options);
// @ts-expect-error
const completeRenderModeInspectionReloadFollowUp = (tabId, operationId = "") =>
  completeRenderModeInspectionReloadFollowUpOperation(getRenderModeInspectionDeps(), tabId, operationId);

function getPageReconciliationDeps() {
  return {
    state,
    PopupText,
    PAGE_SAVE_SYNC_MAX_ATTEMPTS,
    PAGE_SAVE_SYNC_INITIAL_RETRY_DELAY_MS,
    PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS,
    windowRef: window,
    hasCurrentPageMarkingChanges,
// @ts-expect-error
    ensureActiveTab: (options) => helpers.ensureActiveTab(options),
// @ts-expect-error
    ensureBaseUrl: (message) => helpers.ensureBaseUrl(message),
// @ts-expect-error
    refreshCurrentPageRuntimeStatus: (options) => refreshCurrentPageRuntimeStatus(options),
// @ts-expect-error
    showToast: (message) => {
      uiModule.showToast(message);
    },
    getViewState: () => uiModule.getViewState(),
    updateLastConfigSaveStatus,
    validateStoredToken,
    runWithSpinner,
    getCurrentPageUrl,
    loadGlobalAiSettings: () => helpers.loadGlobalAiSettings(),
// @ts-expect-error
    syncBaseConfigToServer: (options) => syncBaseConfigToServer(options),
    clearCurrentPageSaveReconciliation,
    resetAiRunMarkingsFingerprint,
    applyPostSaveSilentTransition,
// @ts-expect-error
    refreshUi: (options) => refreshUi(options),
// @ts-expect-error
    setUiBusy: (busy, message, details) => {
      uiModule.setUiBusy(busy, message, details);
    },
    waitForRetryDelay,
    applyLocalPageDiscard
  };
}

// @ts-expect-error
const hasCurrentPagePendingChanges = (localPageMarkings, backendSavedPageMarkings, options = {}) =>
  hasCurrentPagePendingChangesOperation(
    getPageReconciliationDeps(),
    localPageMarkings,
    backendSavedPageMarkings,
    options
  );

const handlePageSave = () => handlePageSaveOperation(getPageReconciliationDeps());
const handlePageRevert = () => handlePageRevertOperation(getPageReconciliationDeps());

// @ts-expect-error
function buildSpinnerBusyDetails(key, entry) {
  const spinnerEntry = entry && typeof entry === "object" ? entry : {};
  return {
    reason: normalizeSpinnerReason(spinnerEntry.reason, key, spinnerEntry.message),
    source: typeof spinnerEntry.source === "string" && spinnerEntry.source ? spinnerEntry.source : "popup-spinner",
    spinnerKey: typeof key === "string" ? key : ""
  };
}

function setUiBusyFromCurrentSpinner() {
  const snapshot = currentSpinnerSnapshot();
  if (!snapshot) {
    uiModule.setUiBusy(false);
    return;
  }
  uiModule.setUiBusy(true, snapshot.entry.message || "", buildSpinnerBusyDetails(snapshot.key, snapshot.entry));
}

function isPopupSpinnerDebugEnabled() {
  if (isDebugFlagEnabled("ufDebugSpinnerQueue")) {
    return true;
  }
  try {
    return Boolean(window && window.localStorage && window.localStorage.getItem("ufDebugSpinnerQueue") === "1");
  } catch {
    return false;
  }
}

// @ts-expect-error
function logPopupSpinnerDebug(eventName, details = {}) {
  if (!isPopupSpinnerDebugEnabled()) {
    return;
  }
  try {
    console.debug("[popup-spinner]", eventName, {
      queueKeys: [...popupSpinnerQueue.keys()],
      queueSize: popupSpinnerQueue.size,
      visible: popupSpinnerVisible,
      timerActive: Boolean(popupSpinnerTimer),
      navOverlayStarted: popupNavigationInspectionOverlayStarted,
// @ts-expect-error
      navOverlayTabId: popupNavigationInspectionOverlayTabId,
      ...details
    });
  } catch {
    // Debug logging must never break popup behavior.
  }
}

function getCurrentPopupTabId() {
// @ts-expect-error
  return state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
    ? Math.trunc(state.currentTab.id)
    : null;
}

// @ts-expect-error
function isRenderDetectionPopupSpinner(snapshot) {
  const message = snapshot && snapshot.entry && typeof snapshot.entry.message === "string"
    ? snapshot.entry.message
    : "";
  return message === PopupText.overlay.detectingRenderMode;
}

// @ts-expect-error
function sendPopupBusyMirrorMessage(tabId, active, message = "") {
  if (!tabId) {
    return;
  }
  messages.sendTabMessageToTab(tabId, {
    type: "setPopupBusyOnPage",
    active: Boolean(active),
    message: typeof message === "string" ? message : ""
  }).catch(() => {});
}

function clearPopupPageBusyMirrorShowTimer() {
  if (popupPageBusyMirrorShowTimer) {
    window.clearTimeout(popupPageBusyMirrorShowTimer);
    popupPageBusyMirrorShowTimer = 0;
  }
  popupPageBusyMirrorPendingSignature = "";
}

function syncPageBusyFromPopupSpinner() {
  const tabId = getCurrentPopupTabId();
  const snapshot = currentSpinnerSnapshot();
  const active = Boolean(
    tabId &&
      popupSpinnerVisible &&
      snapshot &&
      !isRenderDetectionPopupSpinner(snapshot)
  );

  if (active) {
    const message = currentSpinnerMessage() || PopupText.overlay.pleaseWait;
    const signature = `${tabId}|${message}`;
// @ts-expect-error
    if (popupPageBusyMirrorActive && popupPageBusyMirrorTabId && popupPageBusyMirrorTabId !== tabId) {
      sendPopupBusyMirrorMessage(popupPageBusyMirrorTabId, false);
      popupPageBusyMirrorActive = false;
      popupPageBusyMirrorSignature = "";
    }
    if (popupPageBusyMirrorActive && popupPageBusyMirrorSignature === signature) {
      return;
    }
    if (popupPageBusyMirrorActive) {
      popupPageBusyMirrorTabId = tabId;
      popupPageBusyMirrorSignature = signature;
      sendPopupBusyMirrorMessage(tabId, true, message);
      return;
    }
    if (popupPageBusyMirrorPendingSignature === signature && popupPageBusyMirrorShowTimer) {
      return;
    }
    clearPopupPageBusyMirrorShowTimer();
    popupPageBusyMirrorTabId = tabId;
    popupPageBusyMirrorPendingSignature = signature;
    popupPageBusyMirrorShowTimer = window.setTimeout(() => {
      popupPageBusyMirrorShowTimer = 0;
      if (popupPageBusyMirrorPendingSignature !== signature) {
        return;
      }
      const currentTabId = getCurrentPopupTabId();
      const currentSnapshot = currentSpinnerSnapshot();
      if (
        currentTabId !== tabId ||
        !popupSpinnerVisible ||
        !currentSnapshot ||
        isRenderDetectionPopupSpinner(currentSnapshot) ||
        currentSpinnerMessage() !== message
      ) {
        popupPageBusyMirrorPendingSignature = "";
        syncPageBusyFromPopupSpinner();
        return;
      }
      popupPageBusyMirrorPendingSignature = "";
      popupPageBusyMirrorActive = true;
      popupPageBusyMirrorTabId = tabId;
      popupPageBusyMirrorSignature = signature;
      sendPopupBusyMirrorMessage(tabId, true, message);
    }, POPUP_PAGE_BUSY_MIRROR_DELAY_MS);
    return;
  }

  clearPopupPageBusyMirrorShowTimer();
// @ts-expect-error
  if (!popupPageBusyMirrorActive && !popupPageBusyMirrorTabId) {
    return;
  }
// @ts-expect-error
  const clearTabId = popupPageBusyMirrorTabId || tabId;
  popupPageBusyMirrorActive = false;
  popupPageBusyMirrorTabId = null;
  popupPageBusyMirrorSignature = "";
  sendPopupBusyMirrorMessage(clearTabId, false);
}

function syncUiBusyFromBrokerState() {
  if (popupSpinnerQueue.size > 0) {
    popupSpinnerVisible = true;
    setUiBusyFromCurrentSpinner();
    syncPageBusyFromPopupSpinner();
    return;
  }
// @ts-expect-error
  const lifecycleBusy = Boolean(popupBackgroundLifecycle && popupBackgroundLifecycle.busy);
  if (lifecycleBusy) {
    popupSpinnerVisible = false;
// @ts-expect-error
    uiModule.setUiBusy(true, popupBackgroundLifecycle.message || PopupText.overlay.pleaseWait, {
// @ts-expect-error
      reason: normalizeSpinnerReason(popupBackgroundLifecycle.reason, popupBackgroundLifecycle.kind || "lifecycle", popupBackgroundLifecycle.message),
      source: "background-lifecycle",
      spinnerKey: ""
    });
    syncPageBusyFromPopupSpinner();
    return;
  }
  popupSpinnerVisible = false;
  uiModule.setUiBusy(false);
  syncPageBusyFromPopupSpinner();
}

function isWorldTraceEnabled() {
  return isFeatureEnabled("traceDiagnostics") && isDebugFlagEnabled("worldTraceEnabled");
}

// @ts-expect-error
function logWorldTrace(eventName, details = {}) {
  if (!isWorldTraceEnabled()) {
    return;
  }
  try {
    console.debug("[world-trace][popup]", eventName, details);
  } catch {
    // Trace logging must never break popup behavior.
  }
}

// @ts-expect-error
function applyBackgroundStateSnapshot(snapshot) {
  if (!snapshot || !snapshot.ok) {
    return;
  }
  const tabId = getCurrentPopupTabId();
  if (tabId && snapshot.tabId && Math.trunc(snapshot.tabId) !== tabId) {
    return;
  }
  popupBackgroundLifecycle = snapshot.lifecycle || null;
  const traceDiagnosticsEnabled = isFeatureEnabled("traceDiagnostics");
  state.traceModeEnabled = traceDiagnosticsEnabled && Boolean(snapshot.traceEnabled);
// @ts-expect-error
  state.traceEvents = traceDiagnosticsEnabled && Array.isArray(snapshot.traceEvents) ? [...snapshot.traceEvents] : [];
  popupSpinnerQueue.clear();
  popupSpinnerKeyTabIds.clear();
// @ts-expect-error
  (Array.isArray(snapshot.spinnerQueue) ? snapshot.spinnerQueue : []).forEach((entry) => {
    if (!entry || typeof entry.key !== "string" || !entry.key) {
      return;
    }
    popupSpinnerQueue.set(entry.key, {
      message: typeof entry.message === "string" ? entry.message : "",
      persistent: Boolean(entry.persistent),
      reason: normalizeSpinnerReason(entry.reason, entry.key, entry.message),
      source: typeof entry.source === "string" && entry.source ? entry.source : "background-broker",
      startedAt: Number.isFinite(entry.startedAt) ? Number(entry.startedAt) : Date.now()
    });
    if (tabId) {
      popupSpinnerKeyTabIds.set(entry.key, tabId);
    }
  });
  popupNavigationInspectionOverlayStarted = popupSpinnerQueue.has("navInspect");
  popupNavigationInspectionOverlayTabId = popupNavigationInspectionOverlayStarted ? tabId : null;
  syncUiBusyFromBrokerState();
  logWorldTrace("background-state", {
    tabId,
    traceEnabled: Boolean(snapshot.traceEnabled),
    lifecycleKind: popupBackgroundLifecycle && popupBackgroundLifecycle.kind,
    lifecyclePhase: popupBackgroundLifecycle && popupBackgroundLifecycle.phase,
    spinnerCount: popupSpinnerQueue.size,
    traceEvents: Array.isArray(snapshot.traceEvents) ? snapshot.traceEvents.length : 0
  });
}

// @ts-expect-error
function sendSpinnerBrokerMessage(message, options = {}) {
  const tabId = getCurrentPopupTabId();
  if (!tabId || !message || typeof message !== "object") {
    return Promise.resolve(null);
  }
// @ts-expect-error
  const shouldApplySnapshot = typeof options.shouldApplySnapshot === "function"
// @ts-expect-error
    ? options.shouldApplySnapshot
    : () => true;
  logWorldTrace("runtime-send", { tabId, type: message.type || "" });
  return messages.sendRuntimeMessage({ tabId, owner: SPINNER_OWNERS.POPUP, ...message })
    .then((response) => {
      if (response && response.ok && shouldApplySnapshot(response)) {
        applyBackgroundStateSnapshot(response);
      }
      logWorldTrace("runtime-response", {
        tabId,
        type: message.type || "",
        ok: Boolean(response && response.ok)
      });
      return response;
    })
    .catch(() => null);
}

// @ts-expect-error
function syncSpinnerEntryToBackground(key) {
  const entry = popupSpinnerQueue.get(key);
  if (!entry) {
    return Promise.resolve(null);
  }
  const expectedMessage = entry.message;
  const expectedPersistent = entry.persistent;
  const shouldApplySnapshot = () => {
    const currentEntry = popupSpinnerQueue.get(key);
    if (!currentEntry) {
      return false;
    }
    return currentEntry.message === expectedMessage &&
      Boolean(currentEntry.persistent) === Boolean(expectedPersistent);
  };
  return sendSpinnerBrokerMessage({
    type: WORLD_MESSAGE_TYPES.SPINNER_SET,
    key,
    message: expectedMessage,
    persistent: expectedPersistent,
    reason: normalizeSpinnerReason(entry.reason, key, expectedMessage),
    source: typeof entry.source === "string" && entry.source ? entry.source : "popup-spinner",
    startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : Date.now()
  }, {
    shouldApplySnapshot
  });
}

// @ts-expect-error
function removeSpinnerEntryFromBackground(key, tabId = getCurrentPopupTabId()) {
  if (!tabId || !key) {
    return Promise.resolve(null);
  }
  return messages.sendRuntimeMessage({
    type: WORLD_MESSAGE_TYPES.SPINNER_REMOVE,
    tabId,
    key
  }).then((response) => {
    if (response && response.ok) {
      applyBackgroundStateSnapshot(response);
    }
    return response;
  }).catch(() => null);
}

function clearSpinnerQueueInBackground(tabId = getCurrentPopupTabId(), options = {}) {
  if (!tabId) {
    return Promise.resolve(null);
  }
  return messages.sendRuntimeMessage({
    type: WORLD_MESSAGE_TYPES.SPINNER_CLEAR,
    tabId,
// @ts-expect-error
    transientOnly: Boolean(options.transientOnly)
  }).then((response) => {
    if (response && response.ok) {
      applyBackgroundStateSnapshot(response);
    }
    return response;
  }).catch(() => null);
}

// @ts-expect-error
async function restoreSpinnerQueueFromBackground(tabId) {
  if (!tabId) {
    return;
  }
  const viewState = await messages.requestPopupTabViewState(tabId).catch(() => null);
// @ts-expect-error
  if (viewState && viewState.state && viewState.state.ok) {
// @ts-expect-error
    applyBackgroundStateSnapshot(viewState.state);
  }
}

// @ts-expect-error
async function handleTraceModeToggle(event) {
  if (event && event.currentTarget) {
    event.currentTarget.checked = Boolean(state.traceModeEnabled);
  }
}

// @ts-expect-error
function connectBackgroundStatePort(tabId) {
  if (!tabId || !chrome.runtime || typeof chrome.runtime.connect !== "function") {
    return;
  }
// @ts-expect-error
  if (popupBackgroundStatePort) {
    try {
      popupBackgroundStatePort.disconnect();
    } catch {
      // Existing port may already be closed.
    }
    popupBackgroundStatePort = null;
  }
  try {
    const port = chrome.runtime.connect({ name: buildPopupStatePortName(tabId) });
    popupBackgroundStatePort = port;
    port.onMessage.addListener((message) => {
      if (message && message.type === WORLD_MESSAGE_TYPES.BACKGROUND_STATE) {
        applyBackgroundStateSnapshot(message.state);
      }
    });
    port.onDisconnect.addListener(() => {
// @ts-expect-error
      if (popupBackgroundStatePort === port) {
        popupBackgroundStatePort = null;
      }
    });
  } catch {
    popupBackgroundStatePort = null;
  }
}


function clearStaleInspectionBusyClearTimer() {
  if (!popupStaleInspectionBusyClearTimer) {
    return;
  }
  window.clearTimeout(popupStaleInspectionBusyClearTimer);
  popupStaleInspectionBusyClearTimer = 0;
}

function scheduleStaleInspectionBusyClear(
// @ts-expect-error
  tabId = state.currentTab && state.currentTab.id,
  baseUrl = state.currentBaseUrl,
  { reconcileSilentNavSpinner = false, reconcileRenderModeNavSpinner = false } = {}
) {
  if (!tabId) {
    return;
  }
  clearStaleInspectionBusyClearTimer();
  let attempt = 0;
  // Reconcile against the authoritative content inspection status until it is
  // actually no longer pending, rather than abandoning after a fixed budget.
  // The old 12-attempt (~5s) cap gave up while the editor reveal/freeze warmup
  // was still pending and then NOTHING re-triggered the clear, leaving the
  // "Inspecting page..." curtain (uiBusy) stuck permanently with an empty
  // spinner queue. The high cap below is a safety net only; the curtain clears
  // as soon as content reports not-pending.
  const maxAttempts = 75;
  const failOpenClear = () => {
    const view = uiModule.getViewState();
    const stillInspectionCurtain =
      view.isBusy && view.busyMessage === PopupText.overlay.pageInspection;
    if (!stillInspectionCurtain) {
      return;
    }
    // Last resort: never leave a blocking curtain up indefinitely. A stuck
    // curtain blocks the entire popup, which is worse than clearing slightly
    // early after the (generous) reconcile budget is exhausted.
    if (popupSpinnerQueue.has("navInspect")) {
      endNavigationInspectionOverlay(tabId);
      popSpinner("navInspect");
    } else if (
      popupSpinnerQueue.size === 0 &&
      !popupSpinnerVisible &&
      !popupSpinnerTimer
    ) {
      uiModule.setUiBusy(false);
    }
    logPopupSpinnerDebug("stale-inspection-busy-failopen", { tabId, attempt });
  };
  const run = async () => {
    popupStaleInspectionBusyClearTimer = 0;
    attempt += 1;
    const view = uiModule.getViewState();
    const curtainShowing =
      view.isBusy && view.busyMessage === PopupText.overlay.pageInspection;
    // A leftover navigation-inspection spinner from a prior marking session keeps
    // popupSpinnerVisible true, so the queue-empty gate below never fires and the
    // fresh-load curtain sticks in silent mode. Reconcile that case directly:
    // once the silent reveal/freeze warmup is no longer pending, end the stale
    // overlay (which pops the spinner and drops the curtain).
    const silentNavSpinnerStuck =
      reconcileSilentNavSpinner &&
      !view.toggleEnabled &&
      popupSpinnerQueue.has("navInspect");
    const renderModeNavSpinnerStuck = Boolean(
      reconcileRenderModeNavSpinner &&
      popupSpinnerQueue.has("navInspect")
    );
    const queueClearGate =
      popupSpinnerQueue.size === 0 &&
      !popupSpinnerVisible &&
      !popupSpinnerTimer;
    if (curtainShowing && (silentNavSpinnerStuck || renderModeNavSpinnerStuck || queueClearGate)) {
      const runtimeStatus = await refreshCurrentPageRuntimeStatus({
        tabId,
        baseUrl
      }).catch(() => null);
      const draftStatus = runtimeStatus && runtimeStatus.draftStatus;
      const editorPreparationPending = Boolean(
        draftStatus &&
          draftStatus.ok &&
          draftStatus.reconciliationPending &&
          draftStatus.reconciliation &&
          draftStatus.reconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON
      );
      const inspectionPending = Boolean(
        runtimeStatus &&
          (runtimeStatus.inspectionPending || editorPreparationPending)
      );
      const holdForRenderModeSet = shouldHoldNavInspectUntilRenderModeInspectionSeen(tabId);
      if (!inspectionPending && !holdForRenderModeSet) {
        if (silentNavSpinnerStuck || renderModeNavSpinnerStuck) {
          logPopupSpinnerDebug(
            renderModeNavSpinnerStuck ? "render-mode-nav-curtain-clear" : "silent-nav-curtain-clear",
            { tabId, attempt }
          );
          endNavigationInspectionOverlay(tabId);
          popSpinner("navInspect");
        } else {
          logPopupSpinnerDebug("stale-inspection-busy-clear", { tabId, attempt });
          uiModule.setUiBusy(false);
        }
        return;
      }
    }
    if (attempt >= maxAttempts) {
      failOpenClear();
      return;
    }
    popupStaleInspectionBusyClearTimer = window.setTimeout(() => {
      void run();
    }, 400);
  };
  popupStaleInspectionBusyClearTimer = window.setTimeout(() => {
    void run();
  }, 150);
}

// @ts-expect-error
function isValidEmail(value) {
  return EMAIL_REGEX.test(value);
}

// @ts-expect-error
function isMobileSimulationActive(deviceState) {
  if (!deviceState || typeof deviceState !== "object") {
    return false;
  }
  return Boolean(deviceState.enabled) && deviceState.mode === "mobile";
}

function ensureMobileSimulationForSave() {
  if (isMobileSimulationActive({
    enabled: state.currentDeviceEmulationEnabled,
    mode: state.currentDeviceMode
  })) {
    return true;
  }
  uiModule.showToast(PopupText.page.mobileSimulationRequired);
  return false;
}

async function ensureEditorMobileSimulation() {
  if (isMobileSimulationActive({
    enabled: state.currentDeviceEmulationEnabled,
    mode: state.currentDeviceMode
  })) {
    return true;
  }
  const normalized = await helpers.updateDeviceEmulation({
    enabled: true,
    mode: "mobile",
    scale: state.currentDeviceScale,
    recalculateScale:
      !state.currentDeviceEmulationEnabled ||
      state.currentDeviceMode !== "mobile"
  });
  return Boolean(normalized && normalized.enabled && normalized.mode === "mobile");
}

// @ts-expect-error
async function persistDesktopPreviewEnabled(tabId, enabled) {
  if (!tabId) {
    return;
  }
  const normalizedEnabled = isFeatureEnabled("desktopPreview") && Boolean(enabled);
  await messages.setTabState(tabId, {
    active: true,
    desktopPreviewEnabled: normalizedEnabled
  }, "initial");
  state.currentDesktopPreviewEnabled = normalizedEnabled;
}

// @ts-expect-error
function resolveRelativeEndpoint(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch (error) {
    return "";
  }
}

// @ts-expect-error
function normalizeThemeValue(value) {
  if (typeof value !== "string") {
    return THEME_DEFAULT;
  }
  const normalized = value.trim().toLowerCase();
  return THEME_IDS.has(normalized) ? normalized : THEME_DEFAULT;
}

// @ts-expect-error
function normalizeThemeModeValue(value) {
  if (value === THEME_MODE_LIGHT || value === THEME_MODE_DARK || value === THEME_MODE_SYSTEM) {
    return value;
  }
  return THEME_MODE_DEFAULT;
}

// @ts-expect-error
function applyPopupTheme(themeValue, modeValue) {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  const normalizedTheme = normalizeThemeValue(themeValue);
  const normalizedMode = normalizeThemeModeValue(modeValue);
  root.setAttribute("data-theme", normalizedTheme);
  root.setAttribute("data-theme-mode", normalizedMode);
  root.style.colorScheme =
    normalizedMode === THEME_MODE_SYSTEM ? "light dark" : normalizedMode;
}

function resetDisabledAppearanceCustomization() {
  state.currentTheme = THEME_DEFAULT;
  state.currentThemeMode = THEME_MODE_DEFAULT;
  applyPopupTheme(state.currentTheme, state.currentThemeMode);
  uiModule.setViewState({
    themeValue: state.currentTheme,
    themeModeValue: state.currentThemeMode,
    themeMenuOpen: false
  });
}

async function loadThemeSettings() {
  return getThemeSettings({
    normalizeThemeValue,
    normalizeThemeModeValue
  });
}

// @ts-expect-error
async function persistThemeSettings(themeValue, themeModeValue) {
  await setThemeSettings(themeValue, themeModeValue, {
    normalizeThemeValue,
    normalizeThemeModeValue
  });
}

async function ensureThemeSettings() {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  const { themeValue, themeModeValue } = await loadThemeSettings();
  state.currentTheme = themeValue;
  state.currentThemeMode = themeModeValue;
  applyPopupTheme(themeValue, themeModeValue);
  await persistThemeSettings(themeValue, themeModeValue);
}

async function loadTraceModeSetting() {
  return isFeatureEnabled("traceDiagnostics") && isDebugFlagEnabled("worldTraceEnabled");
}

// @ts-expect-error
async function applyTraceModePreferenceToTab(tabId, enabled) {
  void enabled;
  if (!isFeatureEnabled("traceDiagnostics")) {
    state.traceModeEnabled = false;
    state.traceEvents = [];
    uiModule.setViewState({ traceModeEnabled: false, traceEvents: [], traceEventCount: 0 });
    return null;
  }
  if (!tabId) {
    return null;
  }
  const viewState = await messages.requestPopupTabViewState(tabId).catch(() => null);
// @ts-expect-error
  if (viewState && viewState.state && viewState.state.ok) {
// @ts-expect-error
    applyBackgroundStateSnapshot(viewState.state);
// @ts-expect-error
    return viewState.state;
  }
  return null;
}

// @ts-expect-error
function buildPageMarkingKey(url, pageType) {
  const normalizedUrl = normalizeCandidatePageUrl(url);
  const normalizedPageType = normalizePageTypeKey(pageType);
  if (!normalizedUrl || !normalizedPageType) {
    return "";
  }
  return `${normalizedPageType}|${normalizedUrl}`;
}

function resetPropertyPageTypesState() {
  state.propertyPageTypes = [];
  state.propertyPageTypesDuplicateUrls = [];
  state.propertyPageTypesSiteId = null;
  state.propertyPageTypesStageBase = "";
  state.propertyPageTypesSignature = "";
  state.propertyPageTypesFetchedAt = 0;
  state.propertyPageTypesLastError = "";
  state.propertyPageTypesChangeNoticeVisible = false;
  state.propertyPageTypesInvalidAlertPending = false;
  state.propertyPageTypesChangeForceTodoOpen = false;
}

function clearPropertyPageTypesRefreshTimer() {
  popupTimers.clear("property-page-types-refresh");
  state.propertyPageTypesRefreshTimer = 0;
  state.propertyPageTypesRefreshKey = "";
}

function schedulePropertyPageTypesRefresh(options = {}) {
  const {
// @ts-expect-error
    siteId = null,
// @ts-expect-error
    stageBase = ""
  } = options;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  const normalizedStageBase = normalizeStageBase(stageBase);
  const refreshKey = normalizedSiteId && normalizedStageBase
    ? `${normalizedStageBase}|${normalizedSiteId}`
    : "";
  if (!refreshKey) {
    clearPropertyPageTypesRefreshTimer();
    return;
  }
  if (
    state.propertyPageTypesRefreshTimer &&
    state.propertyPageTypesRefreshKey === refreshKey
  ) {
    return;
  }
  clearPropertyPageTypesRefreshTimer();
  state.propertyPageTypesRefreshKey = refreshKey;
  state.propertyPageTypesRefreshTimer = popupTimers.setInterval("property-page-types-refresh", () => {
    helpers.loadGlobalAiSettings().then(({ tokenValue: nextTokenValue, stageBaseValue }) => {
      return ensurePropertyPageTypes({
        siteId: normalizedSiteId,
        stageBase: stageBaseValue || normalizedStageBase,
        tokenValue: nextTokenValue || "",
        force: true,
        notifyOnChange: false
      });
    }).then((result) => {
      if (!result || !result.changed) {
        return;
      }
      state.propertyPageTypesChangeNoticeVisible = true;
      state.propertyPageTypesInvalidAlertPending = true;
      state.propertyPageTypesChangeForceTodoOpen = true;
      refreshUi({
        useBusyOverlay: false,
        skipPropertyLockFetch: true,
        propertyPageTypesRefreshChanged: true
      }).then();
    }).catch(() => {});
  }, PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS);
}

// @ts-expect-error
function formatPageTypeCandidateLabel(url) {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || "/"}${parsed.search || ""}` || "/";
  } catch (error) {
    return url;
  }
}

// @ts-expect-error
function collectStoredPageMarkingItems(pageMarkings, baseUrl = "") {
// @ts-expect-error
  const items = [];
  Object.entries(pageMarkings && typeof pageMarkings === "object" ? pageMarkings : {}).forEach(([url, entry]) => {
    if (!url || !entry || typeof entry !== "object") {
      return;
    }
    if (baseUrl && !utils.isPageWithinBaseUrl(url, baseUrl)) {
      return;
    }
// @ts-expect-error
    const excludedCount = Array.isArray(entry.xpaths)
// @ts-expect-error
      ? entry.xpaths.filter((item) => item && item.excluded && item.xpath).length
      : 0;
// @ts-expect-error
    const includedCount = Array.isArray(entry.includeXpaths)
// @ts-expect-error
      ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath).length
      : 0;
    items.push({
      url,
// @ts-expect-error
      title: entry.title || url,
// @ts-expect-error
      pageType: entry.pageType || "",
      count: excludedCount + includedCount
    });
  });
// @ts-expect-error
  return items;
}

// @ts-expect-error
function createNormalizedPageMarkingsSnapshot(pageMarkings) {
  return config.createBackendSavedPageMarkingsSnapshot(pageMarkings);
}

// @ts-expect-error
function arePageMarkingSnapshotsEqual(left, right) {
  return JSON.stringify(createNormalizedPageMarkingsSnapshot(left)) ===
    JSON.stringify(createNormalizedPageMarkingsSnapshot(right));
}

// @ts-expect-error
function hasSessionPageMarkingChanges(localPageMarkings, backendSavedPageMarkings) {
  return !arePageMarkingSnapshotsEqual(localPageMarkings, backendSavedPageMarkings);
}

// @ts-expect-error
function getNormalizedPageMarkingSnapshotEntry(pageMarkings, pageUrl) {
  const normalizedTargetUrl = normalizeCandidatePageUrl(pageUrl);
  if (!normalizedTargetUrl) {
    return null;
  }
  const entry = findBackendSavedPageMarkingEntry(pageMarkings, normalizedTargetUrl);
  if (!entry) {
    return null;
  }
  const snapshot = createNormalizedPageMarkingsSnapshot({
    [normalizedTargetUrl]: entry
  });
// @ts-expect-error
  return snapshot[normalizedTargetUrl] || null;
}

// @ts-expect-error
function hasCurrentPageMarkingChanges(localPageMarkings, backendSavedPageMarkings, pageUrl) {
  return JSON.stringify(getNormalizedPageMarkingSnapshotEntry(localPageMarkings, pageUrl)) !==
    JSON.stringify(getNormalizedPageMarkingSnapshotEntry(backendSavedPageMarkings, pageUrl));
}

// @ts-expect-error
function getLatestPageMarkingTimestamp(pageMarkings) {
  let latestTimestamp = config.PAGE_TIMESTAMP_FALLBACK;
  Object.values(createNormalizedPageMarkingsSnapshot(pageMarkings)).forEach((entry) => {
// @ts-expect-error
    const timestamp = config.normalizeEntryTimestamp(entry && entry.timestamp);
    if (config.isIncomingTimestampNewer(timestamp, latestTimestamp)) {
      latestTimestamp = timestamp;
    }
  });
  return latestTimestamp;
}

// @ts-expect-error
function doesSessionRequireAiRun(sourceConfig, localPageMarkings, backendSavedPageMarkings, options = {}) {
  // A dirty current-page draft normally means the markings changed and the
  // selectors are stale, so an AI run is required before Save. But once a
  // successful AI run already matches the live current-page markings
  // (aiRunUpToDate), the draft is dirty only because it has not been
  // backend-saved yet - it does NOT need another run. Skipping the early
  // return in that case lets Save enable right after a clean run (State C)
  // while still demanding a run after any new mark/unmark change (State B).
// @ts-expect-error
  if (options.currentDraftDirty && !options.aiRunUpToDate) {
    return true;
  }
  if (!hasSessionPageMarkingChanges(localPageMarkings, backendSavedPageMarkings)) {
    return false;
  }
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "selectors")) {
    return true;
  }
  if (!hasCalculatedSelectorsFromConfig(sourceConfig)) {
    return true;
  }
  return config.isIncomingTimestampNewer(
    getLatestPageMarkingTimestamp(localPageMarkings),
    config.normalizeEntryTimestamp(sourceConfig && sourceConfig.selectorsUpdatedAt)
  );
}

// @ts-expect-error
function hasSessionPendingChanges(sourceConfig, localPageMarkings, backendSavedPageMarkings, options = {}) {
  return Boolean(
// @ts-expect-error
    options.currentDraftDirty ||
// @ts-expect-error
      options.reconciliationPending ||
      hasSessionPageMarkingChanges(localPageMarkings, backendSavedPageMarkings)
  );
}

// @ts-expect-error
function hasBackendSavedPageMarking(pageMarkings, pageUrl) {
  const normalizedTargetUrl = normalizeCandidatePageUrl(pageUrl);
  if (!normalizedTargetUrl || !pageMarkings || typeof pageMarkings !== "object") {
    return false;
  }
  return Object.keys(pageMarkings).some((url) => normalizeCandidatePageUrl(url) === normalizedTargetUrl);
}

// @ts-expect-error
function findBackendSavedPageMarkingEntry(pageMarkings, pageUrl) {
  const normalizedTargetUrl = normalizeCandidatePageUrl(pageUrl);
  if (!normalizedTargetUrl || !pageMarkings || typeof pageMarkings !== "object") {
    return null;
  }
  const matchingUrl = Object.keys(pageMarkings).find(
    (url) => normalizeCandidatePageUrl(url) === normalizedTargetUrl
  );
  return matchingUrl ? pageMarkings[matchingUrl] || null : null;
}

// @ts-expect-error
function clonePageMarkingEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return JSON.parse(JSON.stringify(entry));
}

// @ts-expect-error
function fingerprintPageMarkingEntry(entry) {
  // Stable signature of the element-level markings only (exclude + include
  // xpaths). CSS-selector edits intentionally do not affect this fingerprint,
  // so only mark/unmark actions re-enable Run AI. Normalize to marking-identity
  // strings (xpath + excluded flag) so incidental entry-object shape/order
  // differences across the AI-run snapshot + preview-exit refresh cycle do not
  // spuriously invalidate the fingerprint (which would wrongly re-enable Run AI
  // and disable Show Content List/Save right after a clean run).
  const excludeXpaths = entry && Array.isArray(entry.xpaths)
    ? entry.xpaths
// @ts-expect-error
        .map((item) => {
          if (typeof item === "string") {
            return item ? `${item}|0` : "";
          }
          if (item && typeof item === "object" && typeof item.xpath === "string") {
            return `${item.xpath}|${item.excluded ? "1" : "0"}`;
          }
          return "";
        })
// @ts-expect-error
        .filter((value) => value)
    : [];
  const includeXpaths = entry && Array.isArray(entry.includeXpaths)
// @ts-expect-error
    ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath)
    : [];
  excludeXpaths.sort();
  includeXpaths.sort();
  return JSON.stringify({ exclude: excludeXpaths, include: includeXpaths });
}

function getCurrentPageMarkingsFingerprint() {
  return fingerprintPageMarkingEntry(state.currentDraftEntry);
}

function isAiRunUpToDateForCurrentMarkings() {
  return (
    state.aiRunMarkingsFingerprint !== null &&
    state.aiRunMarkingsFingerprint === getCurrentPageMarkingsFingerprint()
  );
}

function captureAiRunMarkingsFingerprint() {
// @ts-expect-error
  state.aiRunMarkingsFingerprint = getCurrentPageMarkingsFingerprint();
}

function resetAiRunMarkingsFingerprint() {
  state.aiRunMarkingsFingerprint = null;
}

function mergeSelectorSetForBaseUrlMigration(
// @ts-expect-error
  preferredSelectorSet,
// @ts-expect-error
  preferredUpdatedAt,
// @ts-expect-error
  existingSelectorSet,
// @ts-expect-error
  existingUpdatedAt
) {
  return config.mergeSelectorSetsByTimestamp(
    existingSelectorSet,
    existingUpdatedAt,
    preferredSelectorSet,
    preferredUpdatedAt
  );
}

// @ts-expect-error
function getSelectorSetFingerprint(selectorSet) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  return combineAiSelectorSet(normalized).length ? JSON.stringify(normalized) : "";
}

// @ts-expect-error
function buildSelectorSetForGraphqlSubmit(selectorSet) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  return normalizeAiSelectorSet({
    exclusionSelectors: [
      ...normalized.exclusionSelectors,
      ...constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS
    ],
    inclusionSelectors: normalized.inclusionSelectors
  });
}

// @ts-expect-error
function buildGraphqlRenderModeValue(renderMode) {
  return config.normalizeRenderMode(renderMode) === config.RENDER_MODE_RENDERED
    ? "RENDERED"
    : "STATIC";
}

// @ts-expect-error
function isUndeterminedRenderMode(value) {
  return typeof value === "string" && value.trim().toLowerCase() === RENDER_MODE_UNDETERMINED;
}

// @ts-expect-error
function normalizeUiRenderModeValue(value, fallback = config.DEFAULT_RENDER_MODE) {
  if (isUndeterminedRenderMode(value)) {
    return RENDER_MODE_UNDETERMINED;
  }
  return config.normalizeRenderMode(typeof value === "string" ? value : fallback);
}

// @ts-expect-error
function markRenderModeUndetermined(detectionKey) {
  state.renderModeSuggestedValue = RENDER_MODE_UNDETERMINED;
  state.renderModeDetectionUnsure = true;
  state.renderModeDetectionAccuracy = Number.NaN;
  if (state.renderModeUndeterminedNoticeKey === detectionKey) {
    return;
  }
  state.renderModeUndeterminedNoticeKey = detectionKey;
  uiModule.showToast(PopupText.renderMode.toastUndeterminedManual);
}

// @ts-expect-error
function isRenderModeDetectionLowConfidence(accuracy) {
  return Number.isFinite(accuracy) &&
    accuracy >= RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY &&
    accuracy < RENDER_MODE_DETECTION_REVIEW_ACCURACY;
}

// @ts-expect-error
function hasConfirmedRenderModeForBaseUrl(configs, baseUrl) {
  const normalizedBaseUrl =
    utils.normalizeCanonicalBaseUrl(baseUrl) ||
    utils.normalizeBaseUrl(baseUrl) ||
    (typeof baseUrl === "string" ? baseUrl : "");
  if (
    !normalizedBaseUrl ||
    !configs ||
    !Object.prototype.hasOwnProperty.call(configs, normalizedBaseUrl)
  ) {
    return false;
  }
  const normalizedConfig = config.normalizeConfig(
    normalizedBaseUrl,
    configs[normalizedBaseUrl]
  ).config;
  return config.isRenderModeConfirmed(normalizedConfig);
}

// @ts-expect-error
function getSuggestedRenderModeForPage(pageUrl, sourceConfig = state.currentConfig) {
  const suggestionKey = `${state.currentBaseUrl || ""}|${pageUrl || ""}`;
  if (!state.currentBaseUrlHasConfirmedRenderMode) {
    return RENDER_MODE_UNDETERMINED;
  }
  if (
    state.renderModeSuggestedKey === suggestionKey &&
    state.renderModeSuggestedValue
  ) {
    return normalizeUiRenderModeValue(state.renderModeSuggestedValue);
  }
  if (shouldAutoDetectRenderMode(sourceConfig)) {
    return RENDER_MODE_UNDETERMINED;
  }
  return config.getConfigRenderMode(sourceConfig);
}

// @ts-expect-error
function shouldAutoDetectRenderMode(sourceConfig) {
  if (!isFeatureEnabled("renderModeAutoDetection")) {
    return false;
  }
  if (!sourceConfig || typeof sourceConfig !== "object") {
    return false;
  }
  if (state.currentBaseUrlHasConfirmedRenderMode) {
    return false;
  }
  return (
    config.getConfigRenderMode(sourceConfig) === config.DEFAULT_RENDER_MODE &&
    config.normalizeEntryTimestamp(sourceConfig.renderModeUpdatedAt) === config.PAGE_TIMESTAMP_FALLBACK
  );
}

// @ts-expect-error
function getRenderModeInspectionSnapshotKey(baseUrl, pageUrl) {
  return baseUrl && pageUrl ? `${baseUrl}|${pageUrl}` : "";
}

// @ts-expect-error
function getCurrentRenderModeInspectionSnapshot(detectionKey) {
  const snapshot = state.renderModeInspectionSnapshot;
  if (
    !detectionKey ||
    state.renderModeInspectionSnapshotKey !== detectionKey ||
    !snapshot ||
    typeof snapshot !== "object" ||
// @ts-expect-error
    typeof snapshot.renderedHtml !== "string" ||
// @ts-expect-error
    !snapshot.renderedHtml ||
// @ts-expect-error
    typeof snapshot.rawHtml !== "string"
  ) {
    return null;
  }
  return snapshot;
}

// @ts-expect-error
function rememberRenderModeInspectionSnapshot(baseUrl, pageUrl, snapshot) {
  const snapshotKey = getRenderModeInspectionSnapshotKey(baseUrl, pageUrl);
  if (
    !snapshotKey ||
    !snapshot ||
    typeof snapshot.renderedHtml !== "string" ||
    !snapshot.renderedHtml ||
    typeof snapshot.rawHtml !== "string"
  ) {
    return false;
  }
  state.renderModeInspectionSnapshotKey = snapshotKey;
// @ts-expect-error
  state.renderModeInspectionSnapshot = {
    renderedHtml: snapshot.renderedHtml,
    rawHtml: snapshot.rawHtml,
    renderMode: typeof snapshot.renderMode === "string" ? snapshot.renderMode : "",
    pageUrl
  };
  state.renderModeDetectionInFlight = false;
  state.renderModeDetectionKey = "";
  return true;
}

// @ts-expect-error
function createConfigSyncHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
// @ts-expect-error
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function getStoredGlobalToken(options = {}) {
  return getGlobalToken(options);
}

function formatSyncStatusTimestamp(value = Date.now()) {
  try {
    return new Date(value).toLocaleTimeString();
  } catch (error) {
    return "";
  }
}

function clearAiRunPollTimer() {
  if (state.aiRunPollTimer) {
    window.clearTimeout(state.aiRunPollTimer);
    state.aiRunPollTimer = 0;
  }
}

function clearAiRunCountdownTimer() {
  if (state.aiRunCountdownTimer) {
    window.clearInterval(state.aiRunCountdownTimer);
    state.aiRunCountdownTimer = 0;
  }
}

function clearAiRunTimers() {
  clearAiRunPollTimer();
  clearAiRunCountdownTimer();
}

function updateAiRunCountdownState() {
  if (state.aiRequestInFlight !== "compute") {
    return;
  }
  state.aiRunRemainingMs = getAiRunRemainingMs(state.aiRunDeadlineAt);
  uiModule.setViewState({
    computeButtonText: ViewText.computeButtonBusy,
    computeButtonLoading: true,
    computeButtonDisabled: true,
    saveExcludesButtonDisabled: true,
    previewLatestButtonDisabled: true,
    aiControlsBusy: true,
    aiRunSpinnerNote: PopupText.overlay.computingSelectorsNote,
    aiRunCountdownVisible: true,
    aiRunCountdownText: formatAiRunCountdown(state.aiRunRemainingMs)
  });
}

function startAiRunCountdownTimer() {
  clearAiRunCountdownTimer();
  updateAiRunCountdownState();
  state.aiRunCountdownTimer = window.setInterval(() => {
    if (state.aiRequestInFlight !== "compute") {
      clearAiRunCountdownTimer();
      return;
    }
    updateAiRunCountdownState();
  }, 1000);
}

function resetAiRunState() {
  clearAiRunTimers();
  state.aiRequestInFlight = null;
  state.aiComputeStartPending = false;
  state.aiRunPhase = "";
  state.aiRunSessionId = "";
  state.aiRunSiteId = "";
  state.aiRunDeadlineAt = 0;
  state.aiRunRemainingMs = 0;
  state.aiRunResumeExpiresAt = 0;
  state.aiRunResumed = false;
}

function setAiRunActiveState({
  sessionId = "",
  siteId = "",
  deadlineAt = Date.now() + AI_RUN_TIMEOUT_MS,
  resumed = false,
  phase = "starting"
} = {}) {
  state.aiComputeStartPending = false;
// @ts-expect-error
  state.aiRequestInFlight = "compute";
  state.aiRunPhase = phase;
  state.aiRunSessionId = sessionId;
  state.aiRunSiteId = siteId;
  state.aiRunDeadlineAt = deadlineAt;
  state.aiRunRemainingMs = getAiRunRemainingMs(deadlineAt);
  state.aiRunResumed = Boolean(resumed);
  startAiRunCountdownTimer();
}

async function loadPersistedAiRunRecord() {
  const response = await messages.sendRuntimeMessage({ type: "getPersistedAiRunRecord" });
  return normalizePersistedAiRunRecord(response && response.record);
}

async function clearPersistedAiRunRecord() {
  await messages.sendRuntimeMessage({ type: "clearPersistedAiRunRecord" });
}

// @ts-expect-error
async function syncAiComputeLock(active, expiresAt = 0) {
  const response = await messages.sendRuntimeMessage({
    type: "setAiComputeLockForTab",
    tabId: getCurrentPopupTabId(),
    active: Boolean(active),
    expiresAt,
    baseUrl: state.currentBaseUrl || ""
  });
  return Boolean(response && response.ok);
}

async function refreshAiRunHeartbeat(options = {}) {
// @ts-expect-error
  const sessionId = typeof options.sessionId === "string"
// @ts-expect-error
    ? options.sessionId.trim()
    : state.aiRunSessionId;
// @ts-expect-error
  const siteId = normalizeSiteIdValue(options.siteId || state.aiRunSiteId);
// @ts-expect-error
  const deadlineAt = Number.isFinite(options.deadlineAt)
// @ts-expect-error
    ? options.deadlineAt
    : state.aiRunDeadlineAt;
// @ts-expect-error
  const baseUrl = typeof options.baseUrl === "string"
// @ts-expect-error
    ? options.baseUrl
    : state.currentBaseUrl || "";
  if (!sessionId || !siteId || !Number.isFinite(deadlineAt) || deadlineAt <= 0) {
    return null;
  }
  const tabId = getCurrentPopupTabId();
  if (!tabId) {
    return null;
  }
  const response = await messages.sendRuntimeMessage({
    type: "refreshAiRunHeartbeat",
    tabId,
    sessionId,
    siteId,
    deadlineAt,
    baseUrl
  });
  if (!response || !response.ok || !Number.isFinite(Number(response.expiresAt))) {
    return null;
  }
  const expiresAt = Number(response.expiresAt);
  state.aiRunResumeExpiresAt = expiresAt;
  return expiresAt;
}

async function stopAiRun(options = {}) {
// @ts-expect-error
  const { unlockPage = true } = options;
  resetAiRunState();
  await clearPersistedAiRunRecord();
  if (unlockPage) {
    await syncAiComputeLock(false);
  }
  await refreshUi();
}

async function removePageMarkingFromRemote(options = {}) {
  const {
// @ts-expect-error
    siteId = null,
// @ts-expect-error
    url = ""
  } = options;
  const pageUrl = typeof url === "string" ? url.trim() : "";
  if (!normalizeSiteIdValue(siteId) || !pageUrl) {
    return { ok: false, skipped: true };
  }
  const response = await messages.sendRuntimeMessage({
    type: "removeRemotePageMarking",
    siteId,
    url: pageUrl
  });
  return response && typeof response === "object" ? response : { ok: false };
}

async function pruneRemoteInvalidPageMarkings(options = {}) {
  const {
// @ts-expect-error
    siteId = null,
// @ts-expect-error
    invalidUrls = []
  } = options;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  if (!normalizedSiteId || !Array.isArray(invalidUrls) || !invalidUrls.length) {
    return;
  }
  for (const value of invalidUrls) {
    const pageUrl = typeof value === "string" ? value.trim() : "";
    if (!pageUrl) {
      continue;
    }
    const removalKey = `${normalizedSiteId}|${pageUrl}`;
    if (state.removedRemotePageKeys.has(removalKey)) {
      continue;
    }
    try {
      const result = await removePageMarkingFromRemote({
        siteId: normalizedSiteId,
        url: pageUrl
      });
      if (result.ok) {
        state.removedRemotePageKeys.add(removalKey);
      }
    } catch {
      // Ignore remote cleanup failures. Sync filtering still prevents re-uploading invalid pages.
    }
  }
}

async function pruneLocalInvalidPageMarkings(options = {}) {
  const {
// @ts-expect-error
    baseUrl = "",
// @ts-expect-error
    invalidUrls = []
  } = options;
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !Array.isArray(invalidUrls) || !invalidUrls.length) {
    return [];
  }
  const exactInvalidUrls = new Set(
    invalidUrls
      .filter((url) => typeof url === "string" && url.trim())
      .map((url) => url.trim())
  );
  const normalizedInvalidUrls = new Set(
    Array.from(exactInvalidUrls)
      .map((url) => normalizeCandidatePageUrl(url))
      .filter(Boolean)
  );
  if (!exactInvalidUrls.size && !normalizedInvalidUrls.size) {
    return [];
  }
  const configs = await config.getConfigs();
// @ts-expect-error
  const sourceConfig = configs[normalizedBaseUrl];
  if (!sourceConfig || !sourceConfig.pageMarkings || typeof sourceConfig.pageMarkings !== "object") {
    return [];
  }
  const nextConfig = config.normalizeConfig(normalizedBaseUrl, sourceConfig).config;
// @ts-expect-error
  const removedUrls = [];
  Object.keys(nextConfig.pageMarkings || {}).forEach((url) => {
    const normalizedUrl = normalizeCandidatePageUrl(url);
    if (exactInvalidUrls.has(url) || (normalizedUrl && normalizedInvalidUrls.has(normalizedUrl))) {
// @ts-expect-error
      delete nextConfig.pageMarkings[url];
      removedUrls.push(url);
    }
  });
  if (removedUrls.length) {
// @ts-expect-error
    configs[normalizedBaseUrl] = nextConfig;
    await config.saveConfigs(configs);
  }
// @ts-expect-error
  return removedUrls;
}

async function repairLocalPageMarkingPageTypes(options = {}) {
  const {
// @ts-expect-error
    baseUrl = "",
// @ts-expect-error
    repairedMarkedPages = []
  } = options;
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !Array.isArray(repairedMarkedPages) || !repairedMarkedPages.length) {
    return [];
  }
  const repairsByUrl = new Map(
// @ts-expect-error
    repairedMarkedPages
      .map((item) => {
        const url = normalizeCandidatePageUrl(item && item.url);
        const pageType = item && typeof item.pageType === "string"
          ? item.pageType.trim()
          : "";
        return url && pageType ? [url, pageType] : null;
      })
      .filter(Boolean)
  );
  if (!repairsByUrl.size) {
    return [];
  }
  const configs = await config.getConfigs();
// @ts-expect-error
  const sourceConfig = configs[normalizedBaseUrl];
  if (!sourceConfig || !sourceConfig.pageMarkings || typeof sourceConfig.pageMarkings !== "object") {
    return [];
  }
  const nextConfig = config.normalizeConfig(normalizedBaseUrl, sourceConfig).config;
// @ts-expect-error
  const repairedUrls = [];
  Object.entries(nextConfig.pageMarkings || {}).forEach(([url, entry]) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const normalizedUrl = normalizeCandidatePageUrl(url);
    const repairedPageType = normalizedUrl ? repairsByUrl.get(normalizedUrl) : "";
// @ts-expect-error
    if (!repairedPageType || entry.pageType === repairedPageType) {
      return;
    }
// @ts-expect-error
    entry.pageType = repairedPageType;
    repairedUrls.push(url);
  });
  if (repairedUrls.length) {
// @ts-expect-error
    configs[normalizedBaseUrl] = nextConfig;
    await config.saveConfigs(configs);
  }
// @ts-expect-error
  return repairedUrls;
}

// @ts-expect-error
function getConfigLoadStatusTone(status) {
  switch (status) {
    case "ok":
      return "success";
    case "not_found":
    case "auth_error":
      return "warning";
    case "error":
      return "danger";
    case "skipped":
    case "skipped_editor":
    case "skipped_missing_config":
    default:
      return "muted";
  }
}

// @ts-expect-error
function getConfigSaveStatusTone(label) {
  switch (label) {
    case PopupText.page.savedAndSynced:
    case PopupText.page.revertedAndSynced:
    case PopupText.ai.selectorsUpdatedAndSynced:
    case PopupText.ai.submittedSelectors:
    case PopupText.ai.submittedSelectorsAndSynced:
      return "success";
    case PopupText.page.savedLocallySyncSkipped:
    case PopupText.page.savedLocallySyncPending:
    case PopupText.page.revertedLocallySyncSkipped:
    case PopupText.ai.selectorsUpdatedLocallySyncSkipped:
    case PopupText.ai.submittedSelectorsSyncSkipped:
      return "warning";
    case PopupText.page.saveFailed:
    case PopupText.page.revertFailed:
    case PopupText.page.savedLocallySyncFailed:
    case PopupText.page.savedAndSyncedRefreshFailed:
    case PopupText.page.revertedLocallySyncFailed:
    case PopupText.ai.selectorsUpdatedLocallySyncFailed:
    case PopupText.ai.submittedSelectorsSyncFailed:
      return "danger";
    case PopupText.page.noLocalChangesToSave:
    case PopupText.sync.unknown:
    default:
      return "muted";
  }
}

// @ts-expect-error
function updateLastConfigLoadStatus(result) {
  const status = result && typeof result.status === "string" ? result.status : "";
  const baseUrl = result && typeof result.baseUrl === "string" ? result.baseUrl : "";
  const label = formatConfigLoadStatusLabel(status, baseUrl);
  state.lastConfigLoadStatusTone = getConfigLoadStatusTone(status);
  if (status === "skipped") {
    state.lastConfigLoadStatusText = label;
    return;
  }
  const at = formatSyncStatusTimestamp();
  state.lastConfigLoadStatusText = formatTimestampedStatus(label, at);
}

// @ts-expect-error
function updateLastConfigSaveStatus(label) {
  const safeLabel = typeof label === "string" && label ? label : PopupText.sync.unknown;
  state.lastConfigSaveStatusTone = getConfigSaveStatusTone(safeLabel);
  const at = formatSyncStatusTimestamp();
  state.lastConfigSaveStatusText = formatTimestampedStatus(safeLabel, at);
}

// @ts-expect-error
function isSuccessfulConfigSyncResult(syncResult) {
  return Boolean(syncResult && (syncResult.ok || syncResult.skipped));
}

// @ts-expect-error
function isCompletedPageConfigSyncResult(syncResult) {
  return Boolean(syncResult && syncResult.ok && !syncResult.skipped);
}

function getCurrentPageUrl() {
// @ts-expect-error
  return (state.currentTab && state.currentTab.url) || "";
}

function buildPopupEnabledContext(tab = state.currentTab, baseUrl = state.currentBaseUrl) {
  return {
// @ts-expect-error
    tabId: tab && Number.isFinite(tab.id) ? Math.trunc(tab.id) : null,
// @ts-expect-error
    pageUrl: tab && typeof tab.url === "string" ? tab.url : "",
    baseUrl: typeof baseUrl === "string" ? baseUrl : ""
  };
}

// @ts-expect-error
function isPopupEnabledContextCurrent(context, currentContext = buildPopupEnabledContext()) {
  if (!context || typeof context !== "object") {
    return false;
  }
  return context.tabId === currentContext.tabId &&
    context.pageUrl === currentContext.pageUrl &&
    utils.sameBaseUrl(context.baseUrl || "", currentContext.baseUrl || "");
}

// @ts-expect-error
function setLastPopupEnabled(value, context = buildPopupEnabledContext()) {
  if (value === null) {
    state.lastPopupEnabled = null;
    state.lastPopupEnabledContext = null;
    return;
  }
// @ts-expect-error
  state.lastPopupEnabled = Boolean(value);
// @ts-expect-error
  state.lastPopupEnabledContext = { ...context };
}

function clearLastPopupEnabled() {
  setLastPopupEnabled(null);
}

// @ts-expect-error
async function setCurrentPageSaveReconciliationReason(reason) {
  const pageUrl = getCurrentPageUrl();
  if (!state.currentBaseUrl || !pageUrl) {
    return null;
  }
  const reconciliation = await config.setPageSaveReconciliation(state.currentBaseUrl, pageUrl, {
    reason: typeof reason === "string" ? reason : "pending"
  });
// @ts-expect-error
  state.currentPageSaveReconciliation = reconciliation;
  state.currentPageSaveReconciliationPending = config.isPageSaveReconciliationPending(reconciliation);
  await messages.sendTabMessage({
    type: "setPageSaveReconciliationPending",
    baseUrl: state.currentBaseUrl,
    pageUrl,
    reason: reconciliation && reconciliation.reason ? reconciliation.reason : "pending"
  });
  return reconciliation;
}

async function clearCurrentPageSaveReconciliation(baseUrl = state.currentBaseUrl) {
  const pageUrl = getCurrentPageUrl();
  if (!baseUrl || !pageUrl) {
    return;
  }
  await config.clearPageSaveReconciliation(baseUrl, pageUrl);
  if (baseUrl !== state.currentBaseUrl && state.currentBaseUrl) {
    await config.clearPageSaveReconciliation(state.currentBaseUrl, pageUrl);
  }
  state.currentPageSaveReconciliation = null;
  state.currentPageSaveReconciliationPending = false;
  const contentBaseUrl = state.currentBaseUrl || baseUrl;
  await messages.sendTabMessageWithRetry({
    type: "clearPageSaveReconciliation",
    baseUrl: contentBaseUrl,
    pageUrl
  }, 2);
}

async function refreshCurrentPageRuntimeStatus(options = {}) {
// @ts-expect-error
  const tabId = Number.isFinite(options.tabId)
// @ts-expect-error
    ? Math.trunc(options.tabId)
// @ts-expect-error
    : state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
      ? Math.trunc(state.currentTab.id)
      : null;
// @ts-expect-error
  const baseUrl = typeof options.baseUrl === "string" && options.baseUrl
// @ts-expect-error
    ? options.baseUrl
    : state.currentBaseUrl;
  if (!tabId) {
    return {
      inspectionStatus: null,
      draftStatus: null,
      inspectionPending: false,
      reconciliationPending: false
    };
  }

  const [inspectionStatus, draftStatus] = await Promise.all([
    messages.sendTabMessageToTab(tabId, { type: "getInspectionStatus" }).catch(() => null),
    baseUrl
      ? messages.sendTabMessageToTab(tabId, {
        type: "getPageDraftStatus",
        baseUrl
      }).catch(() => null)
      : Promise.resolve(null)
  ]);

  if (draftStatus && draftStatus.ok) {
    state.currentDraftEntry = draftStatus.entry || null;
    state.currentSavedEntry = draftStatus.savedEntry || null;
    state.currentDraftDirty = Boolean(draftStatus.dirty);
    state.currentDraftAvailable = true;
    state.currentPageSaveReconciliation = draftStatus.reconciliation || null;
    state.currentPageSaveReconciliationPending = Boolean(draftStatus.reconciliationPending);
  }

  const inspectionPending = Boolean(
    inspectionStatus &&
      inspectionStatus.ok &&
      (inspectionStatus.active || inspectionStatus.pending)
  );
  const reconciliationPending = Boolean(
    draftStatus &&
      draftStatus.ok &&
      draftStatus.reconciliationPending
  );

  return {
    inspectionStatus,
    draftStatus,
    inspectionPending,
    reconciliationPending
  };
}

// @ts-expect-error
function waitForRetryDelay(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

// @ts-expect-error
async function waitForEnableMarkingInspectionToSettle(tabId, baseUrl) {
  let inspectionObserved = false;
  let responseObserved = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const [inspectionStatus, draftStatus] = await Promise.all([
      messages.sendTabMessageToTab(tabId, { type: "getInspectionStatus" }),
      baseUrl
        ? messages.sendTabMessageToTab(tabId, {
          type: "getPageDraftStatus",
          baseUrl
        })
        : Promise.resolve(null)
    ]);
    if (
      (inspectionStatus && inspectionStatus.ok) ||
      (draftStatus && draftStatus.ok)
    ) {
      responseObserved = true;
    }
    const inspectionPending = Boolean(
      inspectionStatus &&
        inspectionStatus.ok &&
        (inspectionStatus.active || inspectionStatus.pending)
    );
    const reconciliationPending = Boolean(
      draftStatus &&
        draftStatus.ok &&
        draftStatus.reconciliationPending &&
        draftStatus.reconciliation &&
        draftStatus.reconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON
    );
    if (inspectionPending || reconciliationPending) {
      inspectionObserved = true;
      noteRenderModeSetNavGuardInspection(tabId);
    } else if (inspectionObserved || (responseObserved && attempt >= 2) || attempt >= 6) {
      return {
        inspectionObserved,
        responseObserved,
        settled: true,
        attempts: attempt + 1
      };
    }
    await waitForRetryDelay(getRetryDelayMs(attempt, 150, 900));
  }
  return {
    inspectionObserved,
    responseObserved,
    settled: false,
    attempts: 12
  };
}

// @ts-expect-error
function clearNavigationInspectionSettlePoll(tabId) {
  const timer = popupNavigationInspectionSettlePollByTabId.get(tabId);
  if (!timer) {
    return;
  }
  window.clearTimeout(timer);
  popupNavigationInspectionSettlePollByTabId.delete(tabId);
}

function clearNavigationInspectionSettlePollsExcept(tabIdToKeep = null) {
  popupNavigationInspectionSettlePollByTabId.forEach((timer, tabId) => {
    if (tabIdToKeep !== null && tabId === tabIdToKeep) {
      return;
    }
    window.clearTimeout(timer);
    popupNavigationInspectionSettlePollByTabId.delete(tabId);
  });
}

// @ts-expect-error
function startRenderModeSetNavGuard(tabId) {
  if (!tabId) {
    return;
  }
  popupRenderModeSetNavGuardByTabId.set(tabId, {
    startedAt: Date.now(),
    inspectionSeen: false
  });
  logPopupSpinnerDebug("render-mode-set-nav-guard-start", { tabId });
}

// @ts-expect-error
function clearRenderModeSetNavGuard(tabId) {
  if (!tabId) {
    return;
  }
  if (popupRenderModeSetNavGuardByTabId.delete(tabId)) {
    logPopupSpinnerDebug("render-mode-set-nav-guard-clear", { tabId });
  }
}

// @ts-expect-error
function noteRenderModeSetNavGuardInspection(tabId) {
  if (!tabId) {
    return;
  }
  const guard = popupRenderModeSetNavGuardByTabId.get(tabId);
  if (!guard || guard.inspectionSeen) {
    return;
  }
  guard.inspectionSeen = true;
  popupRenderModeSetNavGuardByTabId.set(tabId, guard);
  logPopupSpinnerDebug("render-mode-set-nav-guard-observed", { tabId });
}

// @ts-expect-error
function shouldHoldNavInspectUntilRenderModeInspectionSeen(tabId) {
  if (!tabId) {
    return false;
  }
  const guard = popupRenderModeSetNavGuardByTabId.get(tabId);
  if (!guard) {
    return false;
  }
  if (guard.inspectionSeen) {
    clearRenderModeSetNavGuard(tabId);
    return false;
  }
  if (Date.now() - guard.startedAt >= RENDER_MODE_SET_NAV_GUARD_MAX_MS) {
    logPopupSpinnerDebug("render-mode-set-nav-guard-timeout", { tabId });
    clearRenderModeSetNavGuard(tabId);
    return false;
  }
  return true;
}

// True while a render-mode Set reload is still in flight (guard armed and not yet
// expired). Used by the tab onUpdated listener so it keeps the navInspect overlay
// alive across the post-Set reload even in silent mode, where the tab is not
// marking-enabled and the listener would otherwise tear the overlay down.
// @ts-expect-error
function isRenderModeSetNavGuardActive(tabId) {
  if (!tabId) {
    return false;
  }
  const guard = popupRenderModeSetNavGuardByTabId.get(tabId);
  if (!guard) {
    return false;
  }
  if (Date.now() - guard.startedAt >= RENDER_MODE_SET_NAV_GUARD_MAX_MS) {
    logPopupSpinnerDebug("render-mode-set-nav-guard-timeout", { tabId });
    clearRenderModeSetNavGuard(tabId);
    return false;
  }
  return true;
}

// @ts-expect-error
function scheduleNavigationInspectionSettlePoll(tabId, baseUrl) {
  if (!tabId) {
    return;
  }
  clearNavigationInspectionSettlePoll(tabId);

  let attempt = 0;
  const maxAttempts = 30;
  const run = async () => {
// @ts-expect-error
    if (popupNavigationInspectionOverlayTabId !== tabId) {
      clearNavigationInspectionSettlePoll(tabId);
      return;
    }
    attempt += 1;
    const [inspectionStatus, draftStatus] = await Promise.all([
      messages.sendTabMessageToTab(tabId, { type: "getInspectionStatus" }).catch(() => null),
      baseUrl
        ? messages.sendTabMessageToTab(tabId, { type: "getPageDraftStatus", baseUrl }).catch(() => null)
        : Promise.resolve(null)
    ]);
    const inspectionPending = Boolean(
      inspectionStatus &&
      inspectionStatus.ok &&
      (inspectionStatus.active || inspectionStatus.pending)
    );
    const reconciliationPending = Boolean(
      draftStatus &&
      draftStatus.ok &&
      draftStatus.reconciliationPending &&
      draftStatus.reconciliation &&
      draftStatus.reconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON
    );
    if (inspectionPending || reconciliationPending) {
      noteRenderModeSetNavGuardInspection(tabId);
    }
    logPopupSpinnerDebug("nav-settle-poll", {
      tabId,
      attempt,
      inspectionPending,
      reconciliationPending,
      inspectionStatusOk: Boolean(inspectionStatus && inspectionStatus.ok),
      draftStatusOk: Boolean(draftStatus && draftStatus.ok)
    });
    if (!inspectionPending && !reconciliationPending) {
      if (shouldHoldNavInspectUntilRenderModeInspectionSeen(tabId)) {
        logPopupSpinnerDebug("nav-settle-poll-hold-for-render-mode-set", { tabId, attempt });
      } else {
        endNavigationInspectionOverlay(tabId);
        clearNavigationInspectionSettlePoll(tabId);
        void refreshUi({ useBusyOverlay: false });
        return;
      }
    }
    if (attempt >= maxAttempts) {
      logPopupSpinnerDebug("nav-settle-poll-timeout", { tabId, attempt });
      endNavigationInspectionOverlay(tabId);
      clearNavigationInspectionSettlePoll(tabId);
      void refreshUi({ useBusyOverlay: false });
      return;
    }
    const timer = window.setTimeout(() => {
      void run();
    }, getRetryDelayMs(attempt, 500, 2000));
    popupNavigationInspectionSettlePollByTabId.set(tabId, timer);
  };
  const timer = window.setTimeout(() => {
    void run();
  }, 350);
  popupNavigationInspectionSettlePollByTabId.set(tabId, timer);
  logPopupSpinnerDebug("nav-settle-poll-scheduled", { tabId, baseUrl });
}

// @ts-expect-error
function beginNavigationInspectionOverlay(tabId) {
  if (!tabId) {
    return false;
  }
  clearNavigationInspectionSettlePollsExcept(tabId);
  popupNavigationInspectionOverlayTabId = tabId;
  clearNavigationInspectionSettlePoll(tabId);
  if (popupSpinnerQueue.has("navInspect")) {
    setSpinnerMessage("navInspect", PopupText.overlay.pageInspection);
    popupNavigationInspectionOverlayStarted = true;
    return true;
  }
  const pushed = pushSpinner("navInspect", PopupText.overlay.pageInspection, {
    persistent: true,
    delayMs: 0
  });
  popupNavigationInspectionOverlayStarted = pushed !== null;
  return popupNavigationInspectionOverlayStarted;
}

// @ts-expect-error
function endNavigationInspectionOverlay(tabId = popupNavigationInspectionOverlayTabId) {
  if (
// @ts-expect-error
    popupNavigationInspectionOverlayTabId !== null &&
    tabId !== null &&
// @ts-expect-error
    popupNavigationInspectionOverlayTabId !== tabId
  ) {
    return;
  }
  if (popupNavigationInspectionOverlayStarted) {
    popSpinner("navInspect");
  }
  if (tabId) {
    clearRenderModeSetNavGuard(tabId);
    clearNavigationInspectionSettlePoll(tabId);
  }
  logPopupSpinnerDebug("nav-overlay-end", { tabId });
  popupNavigationInspectionOverlayStarted = false;
  popupNavigationInspectionOverlayTabId = null;
}

function waitForPopupUiPaint() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
// @ts-expect-error
      resolve();
    };
    window.setTimeout(finish, 75);
    if (typeof window.requestAnimationFrame !== "function") {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(finish);
    });
  });
}

// @ts-expect-error
function isRetryableHttpStatus(status) {
  if (!Number.isFinite(status) || status <= 0) {
    return true;
  }
  return RETRYABLE_HTTP_STATUSES.has(status);
}

// @ts-expect-error
function getRetryDelayMs(attempt, baseDelayMs = 450, maxDelayMs = 10000) {
  const boundedAttempt = Math.max(0, Number(attempt) || 0);
  const exponentialDelay = Math.min(baseDelayMs * (2 ** boundedAttempt), maxDelayMs);
  const jitter = Math.round(exponentialDelay * (0.1 + (Math.random() * 0.2)));
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function clearRemoteConfigRetryTimer() {
  if (!state.remoteConfigConnectionRetryTimer) {
    return;
  }
  window.clearTimeout(state.remoteConfigConnectionRetryTimer);
  state.remoteConfigConnectionRetryTimer = 0;
}

// @ts-expect-error
function setRemoteConfigConnectionIssue(active) {
  const nextActive = Boolean(active);
  state.remoteConfigConnectionIssue = nextActive;
  if (!nextActive) {
    clearRemoteConfigRetryTimer();
  }
}

// @ts-expect-error
function setPreviewBlocked(active, message = ViewText.previewBlockedDefault) {
  uiModule.setPreviewBlocked(active, message);
}

function clearObserverRemoteConfigRefreshTimer() {
  if (!state.observerRemoteConfigRefreshTimer) {
    return;
  }
  window.clearInterval(state.observerRemoteConfigRefreshTimer);
  state.observerRemoteConfigRefreshTimer = 0;
}

// @ts-expect-error
function syncObserverRemoteConfigRefreshTimer(active) {
  if (!active) {
    clearObserverRemoteConfigRefreshTimer();
    return;
  }
  if (state.observerRemoteConfigRefreshTimer) {
    return;
  }
  state.observerRemoteConfigRefreshTimer = window.setInterval(() => {
    helpers.ensureActiveTab().then(() =>
      refreshUi({
        useBusyOverlay: false,
        remoteConfigLoadMode: "observer_poll"
      })
    ).catch(() => {});
  }, OBSERVER_REMOTE_CONFIG_REFRESH_INTERVAL_MS);
}

// @ts-expect-error
function shouldSkipRemoteConfigLoadForPropertyEditor(siteId) {
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  return Boolean(
    normalizedSiteId &&
      state.propertyLockSiteId === normalizedSiteId &&
      state.propertyLockState &&
// @ts-expect-error
      state.propertyLockState.isEditor
  );
}

function updateLoginActionState(patch = {}) {
  const view = { ...uiModule.getViewState(), ...patch };
  const emailValue = (view.loginEmailValue || "").trim();
  const passwordValue = view.loginPasswordValue || "";
  const aiBusy = Boolean(view.aiControlsBusy || view.isBusy);
  const loginCredentialsEnabled =
    view.stageBaseReadOnly && Boolean(normalizeStageBase(view.stageBaseValue || ""));

  uiModule.setViewState({
    ...patch,
    loginActionDisabled:
      aiBusy ||
      !loginCredentialsEnabled ||
      !isValidEmail(emailValue) ||
      !passwordValue.trim()
  });
}

async function invalidateTokenAndLockConfiguration(showToast = true) {
  await clearGlobalToken();
  state.currentView = uiModule.View.Configuration;
  state.configViewLocked = true;
  uiModule.setViewState({
    currentView: state.currentView,
    loginStatusText: PopupText.authentication.statusLoginRequired,
    loginStatusTone: "warning"
  });
  if (showToast) {
    uiModule.showToast(PopupText.authentication.toastExpired);
  }
}

async function validateStoredToken(options = {}) {
// @ts-expect-error
  const { force = false, showToastOnInvalid = true } = options;
  if (state.tokenValidationInFlight) {
    return true;
  }
  const { tokenValue, stageBaseValue } = await helpers.loadGlobalAiSettings();
  const normalizedStageBaseValue = normalizeStageBase(stageBaseValue);
  if (!tokenValue || !normalizedStageBaseValue) {
    return Boolean(tokenValue);
  }
  const now = Date.now();
  if (!force && now - state.lastTokenValidationAt < TOKEN_VALIDATION_INTERVAL_MS) {
    return true;
  }
  state.lastTokenValidationAt = now;
  state.tokenValidationInFlight = true;
  try {
    const response = await messages.sendRuntimeMessage({
      type: "validateAuthToken",
      stageBase: normalizedStageBaseValue
    });
    if (response && response.ok && response.valid === false) {
      await invalidateTokenAndLockConfiguration(showToastOnInvalid);
      return false;
    }
    return true;
  } catch {
    return true;
  } finally {
    state.tokenValidationInFlight = false;
  }
}

async function clearFocusedElement() {
  await messages.sendTabMessage({ type: "clearFocus" });
}

// @ts-expect-error
function getEditableFieldState(options) {
  const {
    inputRef,
    currentValue,
    value,
    isSet,
    editMode,
    suggestedValue,
    preserveCurrentValueWhileEditing = false,
    noticeUnset,
    noticeEdit
  } = options;
  const isEditing = !isSet || editMode;
  const isFocused = inputRef && document.activeElement === inputRef;
  let nextValue = typeof currentValue === "string" ? currentValue : "";

  if (!isEditing) {
    nextValue = value || "";
  } else if (!preserveCurrentValueWhileEditing && !isFocused) {
    nextValue = isSet ? value || "" : suggestedValue || "";
  }

  let noticeText = "";
  let noticeVisible = false;
  if (!isSet) {
    noticeText = noticeUnset;
    noticeVisible = true;
  } else if (editMode) {
    noticeText = noticeEdit;
    noticeVisible = true;
  }

  return { isEditing, isReady: isSet && !editMode, value: nextValue, noticeText, noticeVisible };
}

function isCurrentRenderModeReady() {
  return Boolean(
    state.currentBaseUrl &&
    state.currentBaseUrlHasConfirmedRenderMode &&
    !state.renderModeEditMode
  );
}

function getCurrentSelectorsFromConfig(sourceConfig = state.currentConfig) {
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "selectors")) {
    return normalizeAiSelectorSet(null);
  }
// @ts-expect-error
  return normalizeAiSelectorSet(sourceConfig && sourceConfig.selectors);
}

function getLastSubmittedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "selectors")) {
    return normalizeAiSelectorSet(null);
  }
  return config.areCurrentSelectorsSubmitted(sourceConfig)
// @ts-expect-error
    ? normalizeAiSelectorSet(sourceConfig && sourceConfig.selectors)
    : normalizeAiSelectorSet(null);
}

function getLatestAvailableSelectorsFromConfig(sourceConfig = state.currentConfig) {
  return config.getNewestConfigSelectorSet(sourceConfig).selectorSet;
}

function hasCalculatedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "selectors")) {
    return false;
  }
  const updatedAt = config.normalizeEntryTimestamp(
// @ts-expect-error
    sourceConfig && sourceConfig.selectorsUpdatedAt
  );
  if (updatedAt === config.PAGE_TIMESTAMP_FALLBACK) {
    return false;
  }
// @ts-expect-error
  return combineAiSelectorSet(sourceConfig && sourceConfig.selectors).length > 0;
}

// @ts-expect-error
async function hideConsentForRenderModeInspection(targetTabId = state.currentTab && state.currentTab.id) {
  const tabId = Number.isFinite(targetTabId)
// @ts-expect-error
    ? Math.trunc(targetTabId)
    : null;
  if (!tabId) {
    return false;
  }

// @ts-expect-error
  const sendHideMessageWithRetry = async (attempts) => {
    for (let index = 0; index < attempts; index += 1) {
      const response = await messages.sendTabMessageToTab(tabId, {
        type: "hideConsentForInspection"
      });
      if (response) {
        return response;
      }
      await messages.delay(250);
    }
    return null;
  };

  let hideResponse = await sendHideMessageWithRetry(2);
  if (!hideResponse || !hideResponse.ok) {
    await messages.sendRuntimeMessage({ type: "activateContentForTab", tabId });
    hideResponse = await sendHideMessageWithRetry(3);
  }
  return Boolean(hideResponse && hideResponse.ok);
}

// @ts-expect-error
async function ensureContentReadyForRenderModeInspection(tabId) {
  if (!tabId) {
    return false;
  }
  // Keep the ready wait bounded so the render-mode popup spinner does not sit
  // for too long on slow reloads (notably the Without JavaScript path), while
  // still giving content-main a fair chance to come up post-navigation.
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await messages.sendRuntimeMessage({ type: "activateContentForTab", tabId }).catch(() => null);
    const status = await messages.sendTabMessageToTab(tabId, {
      type: "getInspectionStatus"
    }).catch(() => null);
    if (status && status.ok) {
      return true;
    }
    if (attempt + 1 < maxAttempts) {
      await messages.delay(250);
    }
  }
  return false;
}

async function reconcilePropertyLockAfterRenderModeReload() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    return;
  }
  const siteId = normalizeSiteIdValue(state.propertyLockSiteId);
  if (!siteId) {
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_TAKE_LOCK, {
    renderModeInspectionReconnect: true
  }).catch(() => null);
  // Poll the snapshot until the content re-establishes the lock connection (or
  // attempts run out). INACTIVE means no active lock (nothing to reconnect), so
  // treat it as settled alongside CONNECTED; keep polling while CONNECTING or
  // UNAVAILABLE so a transient post-reload disconnect resolves on its own.
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await refreshPropertyLockSnapshot(siteId).catch(() => null);
    uiModule.setViewState(buildPropertyLockViewState());
    const status = state.propertyLockConnectionStatus;
    if (
      status === PROPERTY_LOCK_CONNECTION_CONNECTED ||
      status === PROPERTY_LOCK_CONNECTION_INACTIVE
    ) {
      break;
    }
    if (attempt + 1 < maxAttempts) {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  }
  await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
}

function buildTodoExpansionContextKey(tabId = null, baseUrl = "") {
// @ts-expect-error
  const normalizedTabId = tabId || (state.currentTab && state.currentTab.id) || null;
  const normalizedBaseUrl = typeof baseUrl === "string" && baseUrl
    ? baseUrl
    : state.currentBaseUrl;
  return normalizedTabId && normalizedBaseUrl
    ? JSON.stringify([normalizedTabId, normalizedBaseUrl])
    : "";
}

function getTodoExpansionStateFromView() {
  const view = uiModule.getViewState();
  return {
    todoSectionExpanded: Boolean(view.todoSectionExpanded),
    todoSubsectionsExpanded: {
      ...(view.todoSubsectionsExpanded && typeof view.todoSubsectionsExpanded === "object"
        ? view.todoSubsectionsExpanded
        : {})
    }
  };
}

function saveCurrentTodoExpansionState() {
  const key = state.currentTodoExpansionKey || buildTodoExpansionContextKey();
  if (!key) {
    return;
  }
  if (!(state.todoExpansionStateByContext instanceof Map)) {
    state.todoExpansionStateByContext = new Map();
  }
  if (state.todoExpansionStateByContext.has(key)) {
    state.todoExpansionStateByContext.delete(key);
  }
  state.todoExpansionStateByContext.set(key, getTodoExpansionStateFromView());
  const overflowCount = state.todoExpansionStateByContext.size - TODO_EXPANSION_CONTEXT_LIMIT;
  if (overflowCount > 0) {
    const keyIterator = state.todoExpansionStateByContext.keys();
    for (let index = 0; index < overflowCount; index += 1) {
      state.todoExpansionStateByContext.delete(keyIterator.next().value);
    }
  }
}

function getCollapsedTodoExpansionState() {
  return {
    todoControlsMenuOpen: false,
    todoSectionExpanded: false,
    todoSubsectionsExpanded: {}
  };
}

// @ts-expect-error
function getSavedTodoExpansionState(key) {
  if (!key || !(state.todoExpansionStateByContext instanceof Map)) {
    return null;
  }
  const saved = state.todoExpansionStateByContext.get(key);
  if (!saved || typeof saved !== "object") {
    return null;
  }
  // Refresh insertion order so recently restored contexts are evicted last.
  state.todoExpansionStateByContext.delete(key);
  state.todoExpansionStateByContext.set(key, saved);
  return {
    todoControlsMenuOpen: false,
    todoSectionExpanded: Boolean(saved.todoSectionExpanded),
    todoSubsectionsExpanded: {
      ...(saved.todoSubsectionsExpanded && typeof saved.todoSubsectionsExpanded === "object"
        ? saved.todoSubsectionsExpanded
        : {})
    }
  };
}

function collapseTodoListForAutoCollapse() {
  if (uiModule.getViewState().todoAutoCollapse) {
    uiModule.collapseTodoList();
  }
}

async function refreshUiInner(options = {}) {
// @ts-expect-error
  const skipPropertyLockFetch = Boolean(options.skipPropertyLockFetch);
// @ts-expect-error
  const propertyPageTypesRefreshChanged = Boolean(options.propertyPageTypesRefreshChanged);
// @ts-expect-error
  const remoteConfigLoadMode = typeof options.remoteConfigLoadMode === "string"
// @ts-expect-error
    ? options.remoteConfigLoadMode
    : "";
  if (!state.currentTab) {
    return;
  }
  const previousBaseUrl = state.currentBaseUrl;
  await validateStoredToken({ force: false, showToastOnInvalid: true });
// @ts-expect-error
  const currentTabId = state.currentTab.id || null;
  const tabChanged = Boolean(currentTabId && state.lastTabId !== currentTabId);
  saveCurrentTodoExpansionState();
  if (tabChanged) {
    state.stageBaseEditMode = false;
    state.endpointEditMode = false;
    state.configEndpointEditMode = false;
    state.remoteConfigLoadKey = "";
    state.remoteConfigLoadResult = null;
    clearLastPopupEnabled();
  }
// @ts-expect-error
  const pageUrl = state.currentTab.url || "";
  if (pageUrl !== state.lastPopupPageUrl) {
    clearLastPopupEnabled();
    state.remoteConfigLoadKey = "";
    state.remoteConfigLoadResult = null;
    state.renderModeDetectionInFlight = false;
    state.renderModeDetectionKey = "";
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = config.DEFAULT_RENDER_MODE;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeWarningDismissedKey = "";
    state.renderModeManualStepsVisible = false;
  }
  state.lastPopupPageUrl = pageUrl;
  state.lastTabId = currentTabId;
  // Whether this tab is currently held in "Without JavaScript" render mode. Drives
  // which inspect button is disabled so the user cannot click the same mode twice.
  state.renderModeTabJsDisabled = currentTabId
    ? await isRenderModeNoJsHeld(currentTabId)
    : false;
  const {
    tokenValue,
    endpointValue,
    configEndpointValue,
    stageBaseValue
  } = await helpers.loadGlobalAiSettings();
  const normalizedStageBaseValue = normalizeStageBase(stageBaseValue);
  let configs = await config.getConfigs();
// @ts-expect-error
  const persistedTabState = await messages.getTabState(state.currentTab.id);
  if (currentTabId) {
    await messages.sendRuntimeMessage({
      type: "clearReloadRestoreTabState",
      tabId: currentTabId
    }).catch(() => null);
  }
  const tabState = persistedTabState || { enabled: false, baseUrl: "" };
  let initialTabState = currentTabId
    ? (await messages.getTabState(currentTabId, "initial")) || { active: false }
    : { active: false };
  if (
    currentTabId &&
    !(initialTabState && initialTabState.active) &&
    utils.getOriginFromUrl(pageUrl)
  ) {
    const activationResponse = await messages.sendRuntimeMessage({
      type: "activateContentForTab",
      tabId: currentTabId,
      url: pageUrl
    });
    if (!activationResponse || activationResponse.ok === false) {
      await messages.setTabState(currentTabId, { active: true }, "initial");
    }
    initialTabState = { active: true };
  }
  const tabInScope = Boolean(
    (initialTabState && initialTabState.active) ||
      utils.getOriginFromUrl(pageUrl)
  );
  const aiComputeRunActive =
    state.aiRequestInFlight === "compute" || state.aiComputeStartPending;
  const desktopPreviewFeatureEnabled = isFeatureEnabled("desktopPreview");
  state.currentDesktopPreviewEnabled = Boolean(
    desktopPreviewFeatureEnabled && initialTabState && initialTabState.desktopPreviewEnabled
  );
  if (isPropertyLockCollaborationEnabled()) {
    state.propertyLockOffCandidateDeadlineAt =
      initialTabState && Number.isFinite(initialTabState.propertyLockOffCandidateDeadlineAt)
        ? Number(initialTabState.propertyLockOffCandidateDeadlineAt)
        : 0;
// @ts-expect-error
    state.propertyLockRecoverySiteId =
      initialTabState && Number.isFinite(initialTabState.propertyLockRecoverySiteId)
        ? Number(initialTabState.propertyLockRecoverySiteId)
        : null;
    state.propertyLockRecoveryBaseUrl =
      initialTabState && typeof initialTabState.propertyLockRecoveryBaseUrl === "string"
        ? initialTabState.propertyLockRecoveryBaseUrl
        : "";
    state.propertyLockRecoveryClientId =
      initialTabState && typeof initialTabState.propertyLockRecoveryClientId === "string"
        ? initialTabState.propertyLockRecoveryClientId
        : "";
    state.propertyLockRecoveryDeadlineAt =
      initialTabState && Number.isFinite(initialTabState.propertyLockRecoveryDeadlineAt)
        ? Number(initialTabState.propertyLockRecoveryDeadlineAt)
        : 0;
  } else {
    resetDisabledPropertyLockState();
  }
  const persistedRecoveryState = {
    siteId: state.propertyLockRecoverySiteId,
    baseUrl: state.propertyLockRecoveryBaseUrl,
    clientId: state.propertyLockRecoveryClientId,
    deadlineAt: state.propertyLockRecoveryDeadlineAt
  };
  const previewState = tabInScope
    ? await messages.sendTabMessage({ type: "getAiPreviewState" })
    : null;
  const {
    previewActive,
    previewItems,
    previewFocusedXpath,
    previewShowAllCategories
  } = buildPreviewViewState(previewState);
  const aiPreviewSessionActive = Boolean(previewActive);
  let localMatchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  let hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
  let discoveredBaseUrlFromGraphql = "";
  let currentSiteId = null;
  let siteIdBlockedReason = "";
  let unsupportedByGraphql = false;
  let remoteLoadResult = { status: "skipped", baseUrl: "" };
  let effectiveTabState = tabState;
  if ((aiComputeRunActive || aiPreviewSessionActive) && tabInScope) {
    const preservedBaseUrl = tabState.baseUrl || state.currentBaseUrl || "";
    effectiveTabState = {
      ...tabState,
      enabled: preservedBaseUrl ? true : Boolean(tabState.enabled),
      baseUrl: preservedBaseUrl
    };
  }
  let propertyPageTypes = [];
  let propertyPageTypesFetchError = "";
  let propertyPageTypesLoaded = false;
  if (
    !aiComputeRunActive &&
    !aiPreviewSessionActive &&
    tabInScope &&
    tabState.baseUrl &&
    pageUrl &&
    !utils.isPageWithinBaseUrl(pageUrl, tabState.baseUrl)
  ) {
    effectiveTabState = { enabled: false, baseUrl: "" };
// @ts-expect-error
    await messages.setTabState(state.currentTab.id, effectiveTabState);
  }
  if (
    tabInScope &&
    !localMatchingBaseUrl &&
    !effectiveTabState.baseUrl &&
    currentTabId &&
    pageUrl &&
    normalizedStageBaseValue
  ) {
    const discoveryResult = await resolveSiteIdFromGraphql({
      stageBase: normalizedStageBaseValue,
      lookupUrl: pageUrl,
      tokenValue
    });
    if (
      discoveryResult &&
      discoveryResult.ok &&
      discoveryResult.siteId &&
      discoveryResult.baseUrl
    ) {
      const discoveredBaseUrl = discoveryResult.baseUrl;
      const discoveredSiteId = normalizeSiteIdValue(discoveryResult.siteId);
      if (discoveredSiteId) {
        state.siteIdLookupByBaseUrl.set(discoveredBaseUrl, discoveredSiteId);
        discoveredBaseUrlFromGraphql = discoveredBaseUrl;
        localMatchingBaseUrl = discoveredBaseUrl;
        hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
      }
    } else if (discoveryResult && discoveryResult.ok && discoveryResult.notFound) {
      unsupportedByGraphql = true;
      siteIdBlockedReason = PopupText.status.noMappedBaseUrlFound;
    }
  }
  const fallbackBaseUrl = tabInScope ? localMatchingBaseUrl : "";
  state.currentBaseUrl = tabInScope
    ? (effectiveTabState.baseUrl || fallbackBaseUrl || "")
    : "";
  if (state.currentBaseUrl) {
// @ts-expect-error
    const normalized = config.normalizeConfig(state.currentBaseUrl, configs[state.currentBaseUrl]);
// @ts-expect-error
    if (configs[state.currentBaseUrl] && normalized.changed) {
// @ts-expect-error
      configs[state.currentBaseUrl] = normalized.config;
      await config.saveConfigs(configs);
    }
// @ts-expect-error
    state.currentConfig = configs[state.currentBaseUrl] || normalized.config;
    const siteIdResult = await ensureBaseUrlSiteId({
      baseUrl: state.currentBaseUrl,
      pageUrl,
      stageBase: normalizedStageBaseValue,
      tokenValue,
      configs,
      persist: false
    });
    if (siteIdResult.ok && siteIdResult.siteId) {
      const resolvedBaseUrl = siteIdResult.baseUrl || state.currentBaseUrl;
      configs = siteIdResult.configs || configs;
      if (resolvedBaseUrl && resolvedBaseUrl !== state.currentBaseUrl) {
        state.currentBaseUrl = resolvedBaseUrl;
        if (currentTabId) {
          effectiveTabState = { ...effectiveTabState, baseUrl: resolvedBaseUrl };
          await messages.setTabState(currentTabId, effectiveTabState);
          if (effectiveTabState.enabled) {
            await messages.sendTabMessageWithRetry({
              type: "setEnabled",
              enabled: true,
              baseUrl: resolvedBaseUrl
            });
          }
        }
      }
      currentSiteId = siteIdResult.siteId;
      state.currentConfig = siteIdResult.config || state.currentConfig;
      if (
        tabInScope &&
        state.currentBaseUrl &&
        currentSiteId &&
        normalizedStageBaseValue &&
        tokenValue
      ) {
        const propertyPageTypesResult = await ensurePropertyPageTypes({
          siteId: currentSiteId,
          stageBase: normalizedStageBaseValue,
          tokenValue,
          force: false,
          notifyOnChange: false
        });
        propertyPageTypesLoaded = true;
        if (propertyPageTypesResult && propertyPageTypesResult.ok) {
          propertyPageTypes = propertyPageTypesResult.pageTypes || [];
          propertyPageTypesFetchError = propertyPageTypesResult.error || "";
        } else if (propertyPageTypesResult) {
          propertyPageTypesFetchError = propertyPageTypesResult.error || "";
        }
      }
      const bootstrapCandidateSiteId = propertyPageTypesLoaded &&
        getCurrentPageCandidateState(pageUrl, propertyPageTypes).status === "candidate"
        ? currentSiteId
        : null;
      if (bootstrapCandidateSiteId && isPropertyLockCollaborationEnabled()) {
        await refreshPropertyLockSnapshot(bootstrapCandidateSiteId, {
          skipFetch: skipPropertyLockFetch
        });
      } else {
        resetDisabledPropertyLockState();
      }
      const editorOwnsCurrentProperty = Boolean(
        bootstrapCandidateSiteId &&
          shouldSkipRemoteConfigLoadForPropertyEditor(bootstrapCandidateSiteId)
      );
      const shouldBootstrapEditorConfig = Boolean(
        editorOwnsCurrentProperty &&
          state.propertyLockEditorBootstrapPending
      );
      if (configEndpointValue && tokenValue && (!editorOwnsCurrentProperty || shouldBootstrapEditorConfig)) {
        remoteLoadResult = await loadRemoteConfigForCurrentPage({
          tabId: currentTabId,
          pageUrl,
          baseUrl: state.currentBaseUrl,
          siteId: currentSiteId,
          endpointValue: configEndpointValue,
          tokenValue,
          force: shouldBootstrapEditorConfig || remoteConfigLoadMode === "observer_poll",
          notifyOnChange: remoteConfigLoadMode === "observer_poll"
        });
        if (shouldBootstrapEditorConfig) {
          state.propertyLockEditorBootstrapPending = false;
        }
      } else if (editorOwnsCurrentProperty) {
        remoteLoadResult = { status: "skipped_editor", baseUrl: state.currentBaseUrl };
        state.propertyLockEditorBootstrapPending = false;
      } else {
        remoteLoadResult = { status: "skipped_missing_config", baseUrl: state.currentBaseUrl };
      }
      if (remoteLoadResult && remoteLoadResult.status === "ok") {
        configs = await config.getConfigs();
// @ts-expect-error
        if (state.currentBaseUrl && configs[state.currentBaseUrl]) {
          const normalizedCurrent = config.normalizeConfig(
            state.currentBaseUrl,
// @ts-expect-error
            configs[state.currentBaseUrl]
          );
          if (normalizedCurrent.changed) {
// @ts-expect-error
            configs[state.currentBaseUrl] = normalizedCurrent.config;
            await config.saveConfigs(configs);
          }
// @ts-expect-error
          state.currentConfig = configs[state.currentBaseUrl];
        }
      }
    } else {
      siteIdBlockedReason = siteIdResult.reason || "";
      remoteLoadResult = { status: "skipped", baseUrl: "" };
      updateLastConfigLoadStatus(remoteLoadResult);
    }
  } else {
    state.currentConfig = null;
  }
  const remoteConfigConnectionIssue = Boolean(
    configEndpointValue &&
      state.currentBaseUrl &&
      remoteLoadResult &&
      remoteLoadResult.status === "error"
  );
  setRemoteConfigConnectionIssue(remoteConfigConnectionIssue);
  if (
    remoteLoadResult &&
    remoteLoadResult.status === "not_found" &&
    !aiComputeRunActive &&
    !aiPreviewSessionActive &&
    effectiveTabState.baseUrl &&
    !hasLocalConfigForWebsite &&
    !currentSiteId
  ) {
    const wasEnabled = Boolean(effectiveTabState.enabled);
    effectiveTabState = { ...effectiveTabState, enabled: false, baseUrl: "" };
// @ts-expect-error
    await messages.setTabState(state.currentTab.id, effectiveTabState);
    if (wasEnabled) {
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
    state.currentBaseUrl = "";
    state.currentConfig = null;
    currentSiteId = null;
    siteIdBlockedReason = "";
  }
  if (unsupportedByGraphql && !aiComputeRunActive && !aiPreviewSessionActive) {
    if (effectiveTabState.enabled) {
      effectiveTabState = { ...effectiveTabState, enabled: false, baseUrl: "" };
// @ts-expect-error
      await messages.setTabState(state.currentTab.id, effectiveTabState);
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
    state.currentBaseUrl = "";
    state.currentConfig = null;
    currentSiteId = null;
  }
  if (
    !unsupportedByGraphql &&
    !state.currentBaseUrl &&
    tabInScope &&
    currentTabId &&
    pageUrl &&
    normalizedStageBaseValue
  ) {
    const fallbackDiscoveryResult = await resolveSiteIdFromGraphql({
      stageBase: normalizedStageBaseValue,
      lookupUrl: pageUrl,
      tokenValue
    });
    if (
      fallbackDiscoveryResult &&
      fallbackDiscoveryResult.ok &&
      fallbackDiscoveryResult.siteId &&
      fallbackDiscoveryResult.baseUrl
    ) {
      const fallbackBaseUrl =
        utils.normalizeCanonicalBaseUrl(fallbackDiscoveryResult.baseUrl) ||
        utils.normalizeBaseUrl(fallbackDiscoveryResult.baseUrl) ||
        fallbackDiscoveryResult.baseUrl;
      const fallbackSiteId = normalizeSiteIdValue(fallbackDiscoveryResult.siteId);
      if (fallbackBaseUrl && fallbackSiteId) {
        state.siteIdLookupByBaseUrl.set(fallbackBaseUrl, fallbackSiteId);
        state.currentBaseUrl = fallbackBaseUrl;
        currentSiteId = fallbackSiteId;
// @ts-expect-error
        state.currentConfig = config.normalizeConfig(
          fallbackBaseUrl,
// @ts-expect-error
          configs[fallbackBaseUrl]
        ).config;
      }
    } else if (fallbackDiscoveryResult && fallbackDiscoveryResult.ok && fallbackDiscoveryResult.notFound) {
      unsupportedByGraphql = true;
      siteIdBlockedReason = PopupText.status.noMappedBaseUrlFound;
    }
  }
  if (state.currentBaseUrl !== previousBaseUrl) {
    state.aiSelectorsComputedSinceLastSubmit = false;
    state.aiSelectorsComputedBaseUrl = "";
    state.renderModeEditMode = false;
    state.renderModeSummaryOpen = false;
    state.renderModeDetectionInFlight = false;
    state.renderModeDetectionKey = "";
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = config.DEFAULT_RENDER_MODE;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeWarningDismissedKey = "";
    state.renderModeManualStepsVisible = false;
  }
  const persistedConfigs = await config.getConfigs();
  state.currentBaseUrlHasConfirmedRenderMode = hasConfirmedRenderModeForBaseUrl(
    persistedConfigs,
    state.currentBaseUrl
  );
  let suggestedRenderMode = config.getConfigRenderMode(state.currentConfig);
  if (tabInScope && state.currentBaseUrl && state.currentConfig && pageUrl) {
    suggestedRenderMode = await maybeAutoDetectRenderMode(pageUrl);
    configs = await config.getConfigs();
    state.currentBaseUrlHasConfirmedRenderMode = hasConfirmedRenderModeForBaseUrl(
      configs,
      state.currentBaseUrl
    );
  } else {
    state.currentBaseUrlHasConfirmedRenderMode = false;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = config.DEFAULT_RENDER_MODE;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeWarningDismissedKey = "";
  }

  const view = uiModule.getViewState();
  const refs = uiModule.getRefs();
  const nextViewState = {
    currentPageUrl: pageUrl || ViewText.unavailable,
    currentBaseUrl: state.currentBaseUrl,
    featureFlags: getFeatureFlags(),
    configMenuOpen: state.configMenuOpen,
    previewActive,
    previewItems,
    previewFocusedXpath,
    previewShowAllCategories: isFeatureEnabled("previewExpandedStates") && previewShowAllCategories,
    previewBlocked: previewActive,
    previewBlockedMessage: previewActive
      ? PopupText.preview.blockedActive
      : ViewText.previewBlockedDefault
  };
  const baseUrlReady = Boolean(state.currentBaseUrl);
  const baseField = {
    value: state.currentBaseUrl || "",
    isEditing: false,
    noticeText: baseUrlReady
      ? ""
      : ViewText.baseUrlAutoResolvedNotice,
    noticeVisible: !baseUrlReady
  };
  if (!tabInScope) {
    baseField.noticeText = ViewText.openOnCurrentTabNotice;
    baseField.noticeVisible = true;
  }
  const extensionEnabledForTab = Boolean(
    tabInScope &&
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      utils.isPageWithinBaseUrl(pageUrl, effectiveTabState.baseUrl)
  );
  let toggleEnabled = extensionEnabledForTab;
  if (state.lastPopupEnabled !== null) {
    const popupEnabledContext = buildPopupEnabledContext(state.currentTab, state.currentBaseUrl || effectiveTabState.baseUrl || "");
    if (!isPopupEnabledContextCurrent(state.lastPopupEnabledContext, popupEnabledContext)) {
      clearLastPopupEnabled();
    } else {
      toggleEnabled = state.lastPopupEnabled;
      if (toggleEnabled === Boolean(effectiveTabState.enabled)) {
        clearLastPopupEnabled();
      }
    }
  }
  let contentModeStatus = null;
  const previewCloseMarkingHoldActive = Boolean(
    state.aiPreviewMarkingRestoreDeadlineAt > Date.now()
  );
  if (currentTabId && tabInScope && state.currentBaseUrl) {
    contentModeStatus = await messages.sendTabMessageToTab(currentTabId, {
      type: "getInspectionStatus"
    }).catch(() => null);
  }
  const contentModeKnown = Boolean(
    contentModeStatus &&
      contentModeStatus.ok &&
      typeof contentModeStatus.markingEnabled === "boolean"
  );
  if (contentModeKnown) {
    const contentMarkingEnabled = Boolean(contentModeStatus.markingEnabled);
    const preserveEnabledDuringPreviewCloseRestore = Boolean(
      previewCloseMarkingHoldActive &&
      tabInScope &&
      !contentMarkingEnabled
    );
    const preserveEnabledDuringAiComputeRun = Boolean(
      (aiComputeRunActive || aiPreviewSessionActive) &&
      tabInScope &&
      Boolean(state.currentBaseUrl || effectiveTabState.baseUrl) &&
      !contentMarkingEnabled
    );
    const shouldPreserveEnabledDuringReactivation = Boolean(
      effectiveTabState.enabled &&
        !contentMarkingEnabled &&
        (contentModeStatus.lockClaimPending ||
          contentModeStatus.pending ||
          contentModeStatus.renderModeInspectionActive)
    );
    if (contentMarkingEnabled !== Boolean(effectiveTabState.enabled) && currentTabId) {
      if (
        !shouldPreserveEnabledDuringReactivation &&
        !preserveEnabledDuringPreviewCloseRestore &&
        !preserveEnabledDuringAiComputeRun
      ) {
        effectiveTabState = {
          ...effectiveTabState,
          enabled: contentMarkingEnabled,
          baseUrl: contentMarkingEnabled
            ? state.currentBaseUrl || effectiveTabState.baseUrl || ""
            : effectiveTabState.baseUrl || state.currentBaseUrl || ""
        };
        await messages.setTabState(currentTabId, effectiveTabState);
        clearLastPopupEnabled();
      }
    }
    if (preserveEnabledDuringPreviewCloseRestore || preserveEnabledDuringAiComputeRun) {
      toggleEnabled = true;
    } else {
      toggleEnabled = shouldPreserveEnabledDuringReactivation
        ? Boolean(effectiveTabState.enabled)
        : contentMarkingEnabled;
    }
  }
  if (
    tabInScope &&
    (previewCloseMarkingHoldActive || aiComputeRunActive || aiPreviewSessionActive) &&
    (!contentModeKnown || !toggleEnabled)
  ) {
    toggleEnabled = true;
  }
  const contentMarkingModeActive = Boolean(
    contentModeKnown &&
      contentModeStatus &&
      contentModeStatus.markingEnabled
  );
  let isEnabled = toggleEnabled;
  const storedDeviceState = currentTabId
    ? await emulation.reconcileDeviceEmulationState(currentTabId)
    : {
        enabled: state.currentDeviceEmulationEnabled,
        mode: state.currentDeviceMode,
        scale: state.currentDeviceScale
      };
  const normalizedDeviceState = emulation.syncDeviceEmulationState(storedDeviceState);
  const loginEmailValue = view.loginEmailValue || "";
  const loginPasswordValue = view.loginPasswordValue || "";
  if (!configEndpointValue) {
    state.configEndpointEditMode = false;
  }
  if (!endpointValue) {
    state.endpointEditMode = false;
  }
  if (!normalizedStageBaseValue) {
    state.stageBaseEditMode = false;
  }
  const configEndpointSet = Boolean(configEndpointValue);
  const configEndpointField = getEditableFieldState({
    inputRef: refs.configEndpointUrlInput,
    currentValue: view.configEndpointUrlValue,
    value: configEndpointValue,
    isSet: configEndpointSet,
    editMode: state.configEndpointEditMode,
    suggestedValue: configEndpointValue,
    preserveCurrentValueWhileEditing: true,
    noticeUnset: PopupText.configuration.endpointNoticeUnset,
    noticeEdit: PopupText.configuration.endpointNoticeEdit
  });
  const configEndpointReady = configEndpointField.isReady;
  const endpointSet = Boolean(endpointValue);
  const endpointField = getEditableFieldState({
    inputRef: refs.endpointUrlInput,
    currentValue: view.endpointUrlValue,
    value: endpointValue,
    isSet: endpointSet,
    editMode: state.endpointEditMode,
    suggestedValue: endpointValue,
    preserveCurrentValueWhileEditing: true,
    noticeUnset: PopupText.configuration.aiEndpointNoticeUnset,
    noticeEdit: PopupText.configuration.aiEndpointNoticeEdit
  });
  const endpointReady = endpointField.isReady;
  const stageBaseSet = Boolean(normalizedStageBaseValue);
  const stageBaseField = getEditableFieldState({
    inputRef: refs.stageBaseInput,
    currentValue: view.stageBaseValue,
    value: normalizedStageBaseValue,
    isSet: stageBaseSet,
    editMode: state.stageBaseEditMode,
    suggestedValue: normalizedStageBaseValue,
    preserveCurrentValueWhileEditing: true,
    noticeUnset: PopupText.configuration.stageBaseNoticeUnset,
    noticeEdit: PopupText.configuration.stageBaseNoticeEdit
  });
  const stageBaseReady = stageBaseField.isReady;
  const loginCredentialsEnabled = stageBaseReady;
  const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
  if (!state.currentBaseUrlHasConfirmedRenderMode) {
    state.renderModeEditMode = false;
  }
  const siteIdReady = Boolean(
// @ts-expect-error
    currentSiteId || normalizeSiteIdValue(state.currentConfig && state.currentConfig.siteId)
  );
  const effectiveSiteIdBlockedReason = unsupportedByGraphql
    ? siteIdBlockedReason || PopupText.status.noMappedBaseUrlFound
    : !tabInScope
      ? ViewText.openOnCurrentTabNotice
    : baseUrlReady && !siteIdReady
      ? siteIdBlockedReason || ViewText.noDomainIdForBaseUrl
      : "";
  const liveSiteId = normalizeSiteIdValue(
    currentSiteId ||
// @ts-expect-error
      (state.currentConfig && state.currentConfig.siteId) ||
      (state.currentBaseUrl ? state.siteIdLookupByBaseUrl.get(state.currentBaseUrl) : null)
  );
// @ts-expect-error
  state.currentSiteId = liveSiteId;
  if (
    !propertyPageTypesLoaded &&
    tabInScope &&
    state.currentBaseUrl &&
    liveSiteId &&
    normalizedStageBaseValue &&
    tokenValue
  ) {
    const propertyPageTypesResult = await ensurePropertyPageTypes({
      siteId: liveSiteId,
      stageBase: normalizedStageBaseValue,
      tokenValue,
      force: false,
      notifyOnChange: false
    });
    propertyPageTypesLoaded = true;
    if (propertyPageTypesResult && propertyPageTypesResult.ok) {
      propertyPageTypes = propertyPageTypesResult.pageTypes || [];
      propertyPageTypesFetchError = propertyPageTypesResult.error || "";
    } else if (propertyPageTypesResult) {
      propertyPageTypesFetchError = propertyPageTypesResult.error || "";
    }
  }
  if (
    tabInScope &&
    state.currentBaseUrl &&
    liveSiteId &&
    normalizedStageBaseValue &&
    tokenValue
  ) {
    schedulePropertyPageTypesRefresh({
      siteId: liveSiteId,
      stageBase: normalizedStageBaseValue
    });
  } else {
    clearPropertyPageTypesRefreshTimer();
    if (!tabInScope || !state.currentBaseUrl || !liveSiteId) {
      resetPropertyPageTypesState();
    }
  }
// @ts-expect-error
  let pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
  const backendSavedPageMarkings = state.currentBaseUrl
    ? await config.getBackendSavedPageMarkings(state.currentBaseUrl)
    : {};
  const normalizedCurrentPageUrl = normalizeCandidatePageUrl(pageUrl);
// @ts-expect-error
  let invalidStoredPageUrlsForRemote = [];
  let currentPageEntryMarkedInvalid = false;
  let repairedStoredPageUrls = [];
  let didReconcileStoredPageMarkings = false;
  let backendSavedPageMarkingItems = collectStoredPageMarkingItems(
    backendSavedPageMarkings,
    state.currentBaseUrl
  );
  const currentPageCandidateState = getCurrentPageCandidateState(
    pageUrl,
    propertyPageTypes
  );
  const propertyLockScopeSiteId = isPropertyLockCollaborationEnabled()
    ? (
      state.propertyLockRecoveryDeadlineAt > Date.now() && state.propertyLockRecoverySiteId
        ? state.propertyLockRecoverySiteId
        : liveSiteId
    )
    : null;
  if (propertyLockScopeSiteId && state.currentBaseUrl && tokenValue) {
    await refreshPropertyLockSnapshot(propertyLockScopeSiteId, {
      skipFetch: skipPropertyLockFetch
    });
  } else if (propertyLockScopeSiteId && state.propertyLockRecoveryDeadlineAt > Date.now()) {
    await refreshPropertyLockSnapshot(propertyLockScopeSiteId, {
      skipFetch: skipPropertyLockFetch
    });
  } else {
    resetDisabledPropertyLockState();
  }
  if (currentTabId && isPropertyLockCollaborationEnabled()) {
    const activeEditorSiteId = normalizeSiteIdValue(liveSiteId || state.propertyLockSiteId);
    const recoverySiteId = normalizeSiteIdValue(
      state.propertyLockRecoverySiteId || persistedRecoveryState.siteId
    );
    const recoveryBaseUrl =
      state.propertyLockRecoveryBaseUrl || persistedRecoveryState.baseUrl || "";
    const recoveryClientId =
      state.propertyLockRecoveryClientId || persistedRecoveryState.clientId || "";
    const recoveryDeadlineAt = Number.isFinite(state.propertyLockRecoveryDeadlineAt) &&
      state.propertyLockRecoveryDeadlineAt > 0
      ? state.propertyLockRecoveryDeadlineAt
      : (
        Number.isFinite(persistedRecoveryState.deadlineAt) && persistedRecoveryState.deadlineAt > 0
          ? persistedRecoveryState.deadlineAt
          : 0
      );
    const hasPersistedRecoverySession = Boolean(
      recoverySiteId &&
      recoveryBaseUrl &&
      recoveryClientId
    );
    const isOutsideRecoveryBaseUrl = Boolean(
      hasPersistedRecoverySession &&
      pageUrl &&
      !utils.isPageWithinBaseUrl(pageUrl, recoveryBaseUrl)
    );
    if (hasPersistedRecoverySession && isOutsideRecoveryBaseUrl) {
      const nextRecoveryDeadlineAt = recoveryDeadlineAt > Date.now()
        ? recoveryDeadlineAt
        : Date.now() + PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS;
// @ts-expect-error
      state.propertyLockRecoverySiteId = recoverySiteId;
      state.propertyLockRecoveryBaseUrl = recoveryBaseUrl;
      state.propertyLockRecoveryClientId = recoveryClientId;
      state.propertyLockRecoveryDeadlineAt = nextRecoveryDeadlineAt;
      await persistPropertyLockRecoveryMetadata(currentTabId, {
        siteId: recoverySiteId,
        baseUrl: recoveryBaseUrl,
        clientId: recoveryClientId,
        deadlineAt: nextRecoveryDeadlineAt
      });
    } else if (
      state.propertyLockState &&
// @ts-expect-error
      state.propertyLockState.isEditor &&
      activeEditorSiteId &&
      state.currentBaseUrl &&
      state.propertyLockClientId
    ) {
      await persistPropertyLockRecoveryMetadata(currentTabId, {
        siteId: activeEditorSiteId,
        baseUrl: state.currentBaseUrl,
        clientId: state.propertyLockClientId,
        deadlineAt: 0
      });
    } else if (!state.propertyLockRecoveryDeadlineAt || state.propertyLockRecoveryDeadlineAt <= Date.now()) {
      await persistPropertyLockRecoveryMetadata(currentTabId, {
        siteId: null,
        baseUrl: "",
        clientId: "",
        deadlineAt: 0
      });
    }
  }
  if (propertyPageTypes.length && state.currentBaseUrl) {
    let coverageModel = buildLynxChecklistViewModel({
      pageTypes: propertyPageTypes,
      markedPages: backendSavedPageMarkingItems
    });
    if (coverageModel.repairedMarkedPages.length) {
      repairedStoredPageUrls = await repairLocalPageMarkingPageTypes({
        baseUrl: state.currentBaseUrl,
        repairedMarkedPages: coverageModel.repairedMarkedPages
      });
      if (repairedStoredPageUrls.length) {
        didReconcileStoredPageMarkings = true;
        configs = await config.getConfigs();
// @ts-expect-error
        state.currentConfig = config.normalizeConfig(
          state.currentBaseUrl,
// @ts-expect-error
          configs[state.currentBaseUrl]
        ).config;
// @ts-expect-error
        pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
        coverageModel = buildLynxChecklistViewModel({
          pageTypes: propertyPageTypes,
          markedPages: backendSavedPageMarkingItems
        });
      }
    }
    invalidStoredPageUrlsForRemote = Array.from(
      new Set(
        coverageModel.invalidMarkedPages
          .map((item) => (item && typeof item.url === "string" ? item.url.trim() : ""))
          .filter(Boolean)
      )
    );
    currentPageEntryMarkedInvalid = invalidStoredPageUrlsForRemote.some(
      (url) => normalizeCandidatePageUrl(url) === normalizedCurrentPageUrl
    );
    if (invalidStoredPageUrlsForRemote.length) {
      const removedInvalidUrls = await pruneLocalInvalidPageMarkings({
        baseUrl: state.currentBaseUrl,
        invalidUrls: invalidStoredPageUrlsForRemote
      });
      if (removedInvalidUrls.length) {
        didReconcileStoredPageMarkings = true;
        configs = await config.getConfigs();
// @ts-expect-error
        state.currentConfig = config.normalizeConfig(
          state.currentBaseUrl,
// @ts-expect-error
          configs[state.currentBaseUrl]
        ).config;
// @ts-expect-error
        pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
      }
    }
    const shouldReloadCurrentPageEntry =
      repairedStoredPageUrls.some((url) => normalizeCandidatePageUrl(url) === normalizedCurrentPageUrl) ||
      currentPageEntryMarkedInvalid;
    if (currentTabId && didReconcileStoredPageMarkings) {
      await messages.sendTabMessageWithRetry({
        type: "configUpdated",
        baseUrl: state.currentBaseUrl,
        forceReloadPageEntry: shouldReloadCurrentPageEntry
      }, 2);
    }
  }
  const localStoredPageMarkingItems = collectStoredPageMarkingItems(
    pageMarkings,
    state.currentBaseUrl
  );
  backendSavedPageMarkingItems = collectStoredPageMarkingItems(
    backendSavedPageMarkings,
    state.currentBaseUrl
  );
  // Todo completion must reflect persisted save results, not temporary local drafts.
  const coverageMarkedPageItems = backendSavedPageMarkingItems;
  const pageTypeCoverageModel = buildLynxChecklistViewModel({
    pageTypes: propertyPageTypes,
    markedPages: coverageMarkedPageItems
  });
  const activeMarkedPageKeys = new Set(
    pageTypeCoverageModel.activeMarkedPages
      .map((item) => buildPageMarkingKey(item.url, item.pageType))
      .filter(Boolean)
  );
  const pageMarkingItemByKey = new Map(
    coverageMarkedPageItems.map((item) => [buildPageMarkingKey(item.url, item.pageType), item])
  );
  const hasStoredCurrentPageEntry = localStoredPageMarkingItems.some(
    (item) => normalizeCandidatePageUrl(item.url) === normalizedCurrentPageUrl
  );
  syncObserverRemoteConfigRefreshTimer(
    Boolean(
      propertyLockScopeSiteId &&
        state.currentBaseUrl &&
        configEndpointValue &&
        tokenValue &&
        state.propertyLockSiteId === propertyLockScopeSiteId &&
        state.propertyLockState &&
// @ts-expect-error
        !state.propertyLockState.isEditor
    )
  );
  syncPropertyLockOffCandidateRefreshTimer(
    Boolean(
      (state.propertyLockOffCandidateDeadlineAt && state.propertyLockOffCandidateDeadlineAt > Date.now()) ||
      (state.propertyLockRecoveryDeadlineAt && state.propertyLockRecoveryDeadlineAt > Date.now())
    )
  );
  Object.assign(nextViewState, buildPropertyLockViewState());
  const currentPageMarkingAllowed = currentPageCandidateState.status === "candidate";
  const pageTypeUiBlocked = Boolean(
    tabInScope &&
    state.currentBaseUrl &&
    siteIdReady &&
    !unsupportedByGraphql &&
    (currentPageCandidateState.status === "missing" ||
      currentPageCandidateState.status === "duplicate" ||
      currentPageCandidateState.status === "empty")
  );
  state.currentPageTypeKey = currentPageCandidateState.pageTypeKey || "";
  state.currentPageTypeTitle = currentPageCandidateState.pageTypeTitle || "";
  state.lynxChecklistPageTypes = propertyPageTypes;
  const renderModeSet = state.currentBaseUrlHasConfirmedRenderMode;
  const renderModeField = getEditableFieldState({
    inputRef: refs.renderModeSelect,
    currentValue: view.renderModeValue,
    value: currentRenderMode,
    isSet: renderModeSet,
    editMode: state.renderModeEditMode,
    suggestedValue: suggestedRenderMode,
    noticeUnset: PopupText.renderMode.noticeUnset,
    noticeEdit: PopupText.renderMode.noticeEdit
  });
  const renderModeRequired =
    tabInScope &&
    !unsupportedByGraphql &&
    baseUrlReady &&
    siteIdReady;
  const renderModeLowConfidence =
    renderModeRequired &&
    !state.currentBaseUrlHasConfirmedRenderMode &&
    isRenderModeDetectionLowConfidence(state.renderModeDetectionAccuracy);
  const renderModeValueUndetermined = isUndeterminedRenderMode(renderModeField.value);
  const renderModeReady = !renderModeRequired || renderModeField.isReady;
  let renderModeNoticeText = renderModeField.noticeText;
  let renderModeNoticeVisible = renderModeField.noticeVisible;
  if (!renderModeRequired) {
    renderModeNoticeText = !tabInScope
      ? PopupText.renderMode.noticeOpenOnCurrentTab
      : unsupportedByGraphql
        ? PopupText.renderMode.noticeUnmappedPage
        : !baseUrlReady || !siteIdReady
          ? PopupText.renderMode.noticeRequiresSiteMapping
          : "";
    renderModeNoticeVisible = Boolean(renderModeNoticeText);
  } else if (state.renderModeDetectionInFlight) {
    renderModeNoticeText = PopupText.renderMode.noticeDetecting;
    renderModeNoticeVisible = true;
  } else if (state.renderModeDetectionUnsure) {
    renderModeNoticeText = PopupText.renderMode.noticeAutoDetectFailed;
    renderModeNoticeVisible = true;
  } else if (renderModeLowConfidence) {
    renderModeNoticeText = PopupText.renderMode.noticeLowConfidence;
    renderModeNoticeVisible = true;
  }

  const configurationComplete =
    configEndpointReady &&
    endpointReady &&
    stageBaseReady &&
    Boolean(tokenValue);
  const themeModeOptions = [
    { value: THEME_MODE_SYSTEM, label: PopupText.configuration.themeModeSystem },
    { value: THEME_MODE_LIGHT, label: PopupText.configuration.themeModeLight },
    { value: THEME_MODE_DARK, label: PopupText.configuration.themeModeDark }
  ];
  const aiReady =
    tabInScope &&
    !unsupportedByGraphql &&
    baseUrlReady &&
    siteIdReady &&
    endpointReady &&
    currentPageMarkingAllowed &&
    Boolean(tokenValue) &&
    renderModeReady;
  const markingInspectionInScope = Boolean(
    currentTabId &&
    toggleEnabled &&
    effectiveTabState.enabled &&
    effectiveTabState.baseUrl
  );
  // Silent highlighting runs the editor reveal/freeze warmup, which also reports
  // an inspection-pending status. Poll it in silent mode (in-scope page) so the
  // "Inspecting page..." curtain can track silent reveal/freeze, not just marking.
  const silentInspectionInScope = Boolean(
    currentTabId &&
    !markingInspectionInScope &&
    tabInScope &&
    baseUrlReady
  );
  let inspectionStatus =
    contentModeStatus ||
    (markingInspectionInScope || silentInspectionInScope
      ? await messages.sendTabMessageToTab(currentTabId, { type: "getInspectionStatus" })
      : null);
  let contentInspectionPending = Boolean(
    inspectionStatus &&
      inspectionStatus.ok &&
      (inspectionStatus.active || inspectionStatus.pending)
  );
  const navigationInspectionPending = Boolean(
    (currentTabId &&
      popupNavigationInspectionOverlayStarted &&
// @ts-expect-error
      popupNavigationInspectionOverlayTabId === currentTabId &&
      toggleEnabled &&
      effectiveTabState.enabled &&
      effectiveTabState.baseUrl) ||
    contentInspectionPending
  );
  if (
    popupSpinnerVisible &&
    popupNavigationInspectionOverlayStarted &&
// @ts-expect-error
    popupNavigationInspectionOverlayTabId === currentTabId
  ) {
    setSpinnerMessage("navInspect", PopupText.overlay.pageInspection);
  }
  isEnabled = toggleEnabled && (
    contentMarkingModeActive ||
    previewCloseMarkingHoldActive ||
    navigationInspectionPending ||
    (siteIdReady && renderModeReady && currentPageMarkingAllowed)
  );
  if (
    tabInScope &&
    toggleEnabled &&
    !aiComputeRunActive &&
    !aiPreviewSessionActive &&
    !previewCloseMarkingHoldActive &&
    !navigationInspectionPending &&
    (!siteIdReady || !renderModeReady || pageTypeUiBlocked) &&
    currentTabId
  ) {
    toggleEnabled = false;
    isEnabled = false;
    clearLastPopupEnabled();
    effectiveTabState = { ...effectiveTabState, enabled: false };
    await messages.setTabState(currentTabId, {
      enabled: false,
      baseUrl: state.currentBaseUrl || effectiveTabState.baseUrl || ""
    });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
  }
  if (state.propertyPageTypesInvalidAlertPending) {
    state.propertyPageTypesInvalidAlertPending = false;
    if (pageTypeUiBlocked) {
      window.alert(PopupText.pageTypes.currentPageInvalidAfterRefreshAlert);
    }
  }
  const currentSelectors = getCurrentSelectorsFromConfig();
  const latestAvailableSelectors = getLatestAvailableSelectorsFromConfig();
  const lastSaved = getLastSubmittedSelectorsFromConfig();
  const selectorCount = combineAiSelectorSet(currentSelectors).length;
  const hasNewSelectors =
    selectorCount > 0 &&
    !aiSelectorSetsEqual(currentSelectors, lastSaved);
  if (!hasNewSelectors && state.aiSelectorsComputedBaseUrl === state.currentBaseUrl) {
    state.aiSelectorsComputedSinceLastSubmit = false;
    state.aiSelectorsComputedBaseUrl = "";
  }
  const aiBusy = Boolean(state.aiRequestInFlight);
  const hasStoredSelectors = hasCalculatedSelectorsFromConfig();

  state.currentDraftEntry = null;
  state.currentSavedEntry = null;
  state.currentDraftDirty = false;
  state.currentDraftAvailable = false;
  state.currentPageSaveReconciliation = null;
  state.currentPageSaveReconciliationPending = false;
  let latestRuntimeStatus = null;
  const runtimeStatusBaseUrl = state.currentBaseUrl || effectiveTabState.baseUrl || "";
  if (
    runtimeStatusBaseUrl &&
    currentTabId &&
    (isEnabled || toggleEnabled || effectiveTabState.enabled || navigationInspectionPending || silentInspectionInScope)
  ) {
    latestRuntimeStatus = await refreshCurrentPageRuntimeStatus({
      tabId: currentTabId,
      baseUrl: runtimeStatusBaseUrl
    });
  }
  if (
    latestRuntimeStatus &&
    latestRuntimeStatus.inspectionStatus &&
    latestRuntimeStatus.inspectionStatus.ok
  ) {
    inspectionStatus = latestRuntimeStatus.inspectionStatus;
    contentInspectionPending = Boolean(latestRuntimeStatus.inspectionPending);
    if (latestRuntimeStatus.inspectionStatus.markingEnabled) {
      isEnabled = true;
      toggleEnabled = true;
      state.aiPreviewMarkingRestoreDeadlineAt = 0;
    }
  }
  const pageSaveReconciliationPending = Boolean(state.currentPageSaveReconciliationPending);
  const pageInspectionBusy =
    contentInspectionPending ||
    (pageSaveReconciliationPending &&
      Boolean(
        state.currentPageSaveReconciliation &&
// @ts-expect-error
        state.currentPageSaveReconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON
      ));
  // In silent mode no spinner key drives the curtain, so keep polling until the
  // editor reveal/freeze warmup clears and then drop the "Inspecting page..."
  // curtain. A leftover navigation-inspection spinner (restored from a prior
  // marking session) keeps the curtain up via the spinner queue even after the
  // warmup settles, so reconcile that case too.
  const silentNavSpinnerStuck = Boolean(
    silentInspectionInScope &&
    currentTabId &&
    popupSpinnerQueue.has("navInspect")
  );
  if (((pageInspectionBusy && silentInspectionInScope) || silentNavSpinnerStuck) && currentTabId) {
    scheduleStaleInspectionBusyClear(currentTabId, runtimeStatusBaseUrl, {
      reconcileSilentNavSpinner: silentNavSpinnerStuck
    });
  }
  const sessionHasPendingChanges = hasSessionPendingChanges(
    state.currentConfig,
    pageMarkings,
    backendSavedPageMarkings,
    {
      currentDraftDirty: state.currentDraftDirty,
      reconciliationPending: pageSaveReconciliationPending
    }
  );
  const currentPageHasPendingChanges = hasCurrentPagePendingChanges(
    pageMarkings,
    backendSavedPageMarkings,
    {
      pageUrl,
      currentDraftDirty: state.currentDraftDirty,
      reconciliationPending: pageSaveReconciliationPending
    }
  );
  // True only while the last successful AI run still matches the live element
  // markings. Gates Run AI (disabled when up to date) and Save/Preview (enabled
  // only when up to date). Any mark/unmark change flips this back to false.
  const aiRunUpToDate = isAiRunUpToDateForCurrentMarkings();
  const sessionRequiresAiRun = doesSessionRequireAiRun(
    state.currentConfig,
    pageMarkings,
    backendSavedPageMarkings,
    { currentDraftDirty: state.currentDraftDirty, aiRunUpToDate }
  );

  let resolvedView =
    state.currentView ||
    uiModule.getViewState().currentView ||
    uiModule.View.Marking;
  if (!configurationComplete) {
    resolvedView = uiModule.View.Configuration;
    state.configViewLocked = true;
  } else if (state.configViewLocked) {
    resolvedView = uiModule.View.Marking;
    state.configViewLocked = false;
  }
  state.currentView = resolvedView;

  const remoteConfigRetryBlocked =
    state.remoteConfigConnectionIssue && resolvedView !== uiModule.View.Configuration;
  if (remoteConfigRetryBlocked) {
    scheduleRemoteConfigRetry();
  } else {
    clearRemoteConfigRetryTimer();
  }

// @ts-expect-error
  nextViewState.currentView = resolvedView;
// @ts-expect-error
  nextViewState.configurationContinueDisabled = !configurationComplete;
// @ts-expect-error
  nextViewState.configurationBackDisabled = !configurationComplete;
// @ts-expect-error
  nextViewState.configurationNoticeVisible =
    !configurationComplete ||
    remoteConfigRetryBlocked;
// @ts-expect-error
  nextViewState.configurationNoticeText = remoteConfigRetryBlocked
    ? PopupText.configuration.remoteConfigRetryNotice
    : configurationComplete
      ? ""
      : PopupText.configuration.continueSetupNotice;
  const traceDiagnosticsEnabled = isFeatureEnabled("traceDiagnostics");
// @ts-expect-error
  nextViewState.traceModeEnabled = traceDiagnosticsEnabled && Boolean(state.traceModeEnabled);
// @ts-expect-error
  nextViewState.traceEvents = traceDiagnosticsEnabled && Array.isArray(state.traceEvents) ? state.traceEvents : [];
// @ts-expect-error
  nextViewState.traceEventCount = nextViewState.traceEvents.length;

  const pageScopedUiDisabled =
    unsupportedByGraphql ||
    !tabInScope ||
    remoteConfigRetryBlocked ||
    isPropertyLockBlockingEditing();
  if (pageScopedUiDisabled) {
    clearLastPopupEnabled();
  }
  const configurationUiDisabled = aiBusy;
  const silentModeActive =
    !pageScopedUiDisabled &&
    resolvedView === uiModule.View.Marking &&
    renderModeReady &&
    !isEnabled;
  const desktopPreviewVisible = Boolean(
    desktopPreviewFeatureEnabled &&
    silentModeActive &&
    currentTabId &&
    tabInScope &&
    state.currentConfig &&
    hasStoredSelectors
  );
  const desktopPreviewActive = Boolean(
    desktopPreviewVisible && state.currentDesktopPreviewEnabled
  );
// @ts-expect-error
  nextViewState.toggleEnabled = pageScopedUiDisabled ? false : isEnabled;
// @ts-expect-error
  nextViewState.toggleEnabledDisabled =
    pageScopedUiDisabled ||
    pageSaveReconciliationPending ||
    !baseUrlReady ||
    (!navigationInspectionPending && (!siteIdReady || !renderModeReady || pageTypeUiBlocked)) ||
    desktopPreviewActive;
// @ts-expect-error
  nextViewState.mainUiHidden =
    pageScopedUiDisabled ||
    !isEnabled ||
    (!navigationInspectionPending && (!siteIdReady || !renderModeReady));
// @ts-expect-error
  nextViewState.silentModeActive = silentModeActive;
// @ts-expect-error
  nextViewState.computeButtonDisabled =
    pageScopedUiDisabled ||
    aiBusy ||
    !aiReady ||
    pageSaveReconciliationPending ||
    aiRunUpToDate;
// @ts-expect-error
  nextViewState.saveExcludesButtonDisabled =
    !silentModeActive ||
    aiBusy ||
    !baseUrlReady ||
    !siteIdReady;
// @ts-expect-error
  nextViewState.previewLatestButtonDisabled =
    !silentModeActive ||
    aiBusy ||
    !baseUrlReady ||
    !siteIdReady ||
    !hasStoredSelectors;
// @ts-expect-error
  nextViewState.renderModeReady = renderModeReady;
// @ts-expect-error
  nextViewState.todoListVisible = siteIdReady && renderModeReady;
// @ts-expect-error
  nextViewState.renderModeValue = renderModeField.value;
// @ts-expect-error
  nextViewState.renderModeReadOnly = !renderModeField.isEditing;
// @ts-expect-error
  nextViewState.renderModeSetVisible = renderModeRequired && renderModeField.isEditing;
// @ts-expect-error
  nextViewState.renderModeEditVisible = renderModeSet && renderModeRequired;
// @ts-expect-error
  nextViewState.renderModeEditText = state.renderModeEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
// @ts-expect-error
  nextViewState.renderModeNoticeText = renderModeNoticeText;
// @ts-expect-error
  nextViewState.renderModeNoticeVisible = renderModeNoticeVisible;
// @ts-expect-error
  nextViewState.renderModeUndeterminedVisible =
    renderModeValueUndetermined || state.renderModeDetectionUnsure;
// @ts-expect-error
  nextViewState.renderModeWarningVisible = false;
// @ts-expect-error
  nextViewState.renderModeWarningAcknowledgeChecked = false;
// @ts-expect-error
  nextViewState.renderModeWarningOkDisabled = true;
// @ts-expect-error
  nextViewState.lynxChecklistVisible = Boolean(state.lynxChecklistVisible);
// @ts-expect-error
  nextViewState.lynxChecklistAiAnswer = state.lynxChecklistAiAnswer || "";
// @ts-expect-error
  nextViewState.lynxChecklistPageTypes = Array.isArray(state.lynxChecklistPageTypes)
    ? state.lynxChecklistPageTypes
    : [];
// @ts-expect-error
  nextViewState.lynxChecklistAiQuestionDisabled = Boolean(state.lynxChecklistAiQuestionDisabled);
// @ts-expect-error
  nextViewState.lynxChecklistAiQuestionHidden = Boolean(state.lynxChecklistAiQuestionHidden);
// @ts-expect-error
  nextViewState.lynxChecklistNoticeText = state.lynxChecklistNoticeText || "";
// @ts-expect-error
  nextViewState.sessionHasPendingChanges = sessionHasPendingChanges;
// @ts-expect-error
  nextViewState.currentPageHasPendingChanges = currentPageHasPendingChanges;
// @ts-expect-error
  nextViewState.sessionRequiresAiRun = sessionRequiresAiRun;
// @ts-expect-error
  nextViewState.renderModeInputDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !Boolean(state.currentConfig);
// @ts-expect-error
  nextViewState.renderModeInspectButtonsDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
// @ts-expect-error
    !Boolean(state.currentTab && state.currentTab.id);
  // Alternate the two inspect buttons by the tab's current JavaScript mode so the
  // same mode cannot be triggered twice: while the page runs JavaScript only
  // "Without JavaScript" is enabled, and once it is held in no-JS mode only "With
  // JavaScript" is enabled.
// @ts-expect-error
  nextViewState.renderModeInspectWithoutJavaScriptDisabled =
// @ts-expect-error
    nextViewState.renderModeInspectButtonsDisabled || Boolean(state.renderModeTabJsDisabled);
// @ts-expect-error
  nextViewState.renderModeInspectWithJavaScriptDisabled =
// @ts-expect-error
    nextViewState.renderModeInspectButtonsDisabled || !Boolean(state.renderModeTabJsDisabled);
// @ts-expect-error
  nextViewState.renderModeSetDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    renderModeValueUndetermined ||
    !Boolean(state.currentConfig);
// @ts-expect-error
  nextViewState.renderModeEditDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !Boolean(state.currentConfig);
// @ts-expect-error
  nextViewState.renderModeSummaryTitle = PopupText.renderMode.title;
// @ts-expect-error
  nextViewState.renderModeSummaryOpen =
    !renderModeSet || state.renderModeEditMode || state.renderModeSummaryOpen;
// @ts-expect-error
  nextViewState.renderModeSectionVisible = renderModeRequired && (!renderModeSet || state.renderModeEditMode);
// @ts-expect-error
  nextViewState.renderModeChangeMenuVisible =
    resolvedView === uiModule.View.Marking &&
    renderModeRequired &&
    renderModeSet &&
    !pageScopedUiDisabled &&
    currentPageMarkingAllowed;
// @ts-expect-error
  nextViewState.stageBaseValue = stageBaseField.value;
// @ts-expect-error
  nextViewState.stageBaseReadOnly = !stageBaseField.isEditing;
// @ts-expect-error
  nextViewState.stageBaseSetVisible = stageBaseField.isEditing;
// @ts-expect-error
  nextViewState.stageBaseEditVisible = stageBaseSet;
// @ts-expect-error
  nextViewState.stageBaseEditText = state.stageBaseEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
// @ts-expect-error
  nextViewState.stageBaseNoticeText = stageBaseField.noticeText;
// @ts-expect-error
  nextViewState.stageBaseNoticeVisible = stageBaseField.noticeVisible;
// @ts-expect-error
  nextViewState.stageBaseInputDisabled = configurationUiDisabled;
// @ts-expect-error
  nextViewState.stageBaseSetDisabled = configurationUiDisabled;
// @ts-expect-error
  nextViewState.stageBaseEditDisabled = configurationUiDisabled;
// @ts-expect-error
  nextViewState.themeValue = normalizeThemeValue(state.currentTheme);
// @ts-expect-error
  nextViewState.themeModeValue = normalizeThemeModeValue(state.currentThemeMode);
// @ts-expect-error
  nextViewState.themeOptions = THEME_OPTIONS;
// @ts-expect-error
  nextViewState.themeModeOptions = themeModeOptions;
// @ts-expect-error
  nextViewState.themeControlsDisabled = configurationUiDisabled;
// @ts-expect-error
  nextViewState.loginEmailValue = loginEmailValue;
// @ts-expect-error
  nextViewState.loginPasswordValue = loginPasswordValue;
// @ts-expect-error
  nextViewState.loginCredentialsDisabled =
    configurationUiDisabled || !loginCredentialsEnabled;
// @ts-expect-error
  nextViewState.loginStatusText = tokenValue
    ? PopupText.authentication.statusTokenSaved
    : PopupText.authentication.statusLoginRequired;
// @ts-expect-error
  nextViewState.loginStatusTone = tokenValue ? "success" : "warning";
// @ts-expect-error
  nextViewState.loginActionDisabled =
    configurationUiDisabled ||
    !loginCredentialsEnabled ||
    !isValidEmail(loginEmailValue.trim()) ||
    !loginPasswordValue.trim();
// @ts-expect-error
  nextViewState.configEndpointUrlValue = configEndpointField.value;
// @ts-expect-error
  nextViewState.configEndpointUrlReadOnly = !configEndpointField.isEditing;
// @ts-expect-error
  nextViewState.configEndpointSetVisible = configEndpointField.isEditing;
// @ts-expect-error
  nextViewState.configEndpointEditVisible = configEndpointSet;
// @ts-expect-error
  nextViewState.configEndpointEditText = state.configEndpointEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
// @ts-expect-error
  nextViewState.configEndpointNoticeText = configEndpointField.noticeText;
// @ts-expect-error
  nextViewState.configEndpointNoticeVisible = configEndpointField.noticeVisible;
// @ts-expect-error
  nextViewState.configEndpointInputDisabled = configurationUiDisabled;
// @ts-expect-error
  nextViewState.configEndpointSetDisabled = configurationUiDisabled;
// @ts-expect-error
  nextViewState.configEndpointEditDisabled = configurationUiDisabled;

// @ts-expect-error
  nextViewState.endpointUrlValue = endpointField.value;
// @ts-expect-error
  nextViewState.endpointUrlReadOnly = !endpointField.isEditing;
// @ts-expect-error
  nextViewState.endpointSetVisible = endpointField.isEditing;
// @ts-expect-error
  nextViewState.endpointEditVisible = endpointSet;
// @ts-expect-error
  nextViewState.endpointEditText = state.endpointEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
// @ts-expect-error
  nextViewState.endpointNoticeText = endpointField.noticeText;
// @ts-expect-error
  nextViewState.endpointNoticeVisible = endpointField.noticeVisible;
// @ts-expect-error
  nextViewState.endpointInputDisabled = configurationUiDisabled;
// @ts-expect-error
  nextViewState.endpointSetDisabled = configurationUiDisabled;
// @ts-expect-error
  nextViewState.endpointEditDisabled = configurationUiDisabled;
// @ts-expect-error
  nextViewState.clearDomainCacheDisabled =
    !isFeatureEnabled("cacheAndUnregisterTools") || state.clearDomainCacheDisabled;
// @ts-expect-error
  nextViewState.unregisterCurrentTabDisabled =
    !isFeatureEnabled("cacheAndUnregisterTools") ||
// @ts-expect-error
    state.unregisterCurrentTabDisabled || !state.currentTab || !state.currentTab.id;
// @ts-expect-error
  nextViewState.computeButtonText =
    state.aiRequestInFlight === "compute"
      ? ViewText.computeButtonBusy
      : ViewText.computeButtonIdle;
// @ts-expect-error
  nextViewState.saveExcludesButtonText =
    state.aiRequestInFlight === "save"
      ? ViewText.saveExcludesBusy
      : ViewText.saveExcludesIdle;
// @ts-expect-error
  nextViewState.computeButtonLoading = state.aiRequestInFlight === "compute";
// @ts-expect-error
  nextViewState.saveExcludesButtonLoading = state.aiRequestInFlight === "save";
// @ts-expect-error
  nextViewState.aiRunSpinnerNote =
    state.aiRequestInFlight === "compute"
      ? PopupText.overlay.computingSelectorsNote
      : "";
// @ts-expect-error
  nextViewState.aiRunCountdownVisible =
    state.aiRequestInFlight === "compute" && state.aiRunDeadlineAt > 0;
// @ts-expect-error
  nextViewState.aiRunCountdownText =
    state.aiRequestInFlight === "compute"
      ? formatAiRunCountdown(
          state.aiRunRemainingMs || getAiRunRemainingMs(state.aiRunDeadlineAt)
        )
      : "0:00";
// @ts-expect-error
  nextViewState.aiControlsBusy = aiBusy;
// @ts-expect-error
  nextViewState.aiDirtyNoticeVisible = pageSaveReconciliationPending;
// @ts-expect-error
  nextViewState.aiDirtyNoticeText = pageSaveReconciliationPending
    ? PopupText.page.statusServerSyncPending
    : PopupText.ai.dirtyNotice;
// @ts-expect-error
  nextViewState.cssSelectorsVisible = silentModeActive;
// @ts-expect-error
  nextViewState.baseUrlInputValue = baseField.value;
// @ts-expect-error
  nextViewState.baseUrlNoticeText =
    state.remoteConfigConnectionIssue
      ? PopupText.status.remoteConfigRetryNotice
      : effectiveSiteIdBlockedReason || baseField.noticeText;
// @ts-expect-error
  nextViewState.baseUrlNoticeVisible =
    state.remoteConfigConnectionIssue ||
    Boolean(effectiveSiteIdBlockedReason) ||
    baseField.noticeVisible;
// @ts-expect-error
  const pageControlsVisible = !nextViewState.mainUiHidden && nextViewState.renderModeReady;
  const pageSaveUiState = buildPageSaveUiState({
    pageControlsVisible,
    sessionHasPendingChanges,
    pageHasPendingChanges: currentPageHasPendingChanges,
    sessionRequiresAiRun,
    pageHasSavedBaseline: hasBackendSavedPageMarking(backendSavedPageMarkings, pageUrl),
    reconciliation: state.currentPageSaveReconciliation
  });
// @ts-expect-error
  nextViewState.pageSaveDisabled = pageSaveUiState.pageSaveDisabled;
// @ts-expect-error
  nextViewState.pageSaveMobileSimulationRequiredVisible =
    pageSaveUiState.pageSaveMobileSimulationRequiredVisible;
// @ts-expect-error
  nextViewState.pageSaveMobileSimulationRequiredText =
    PopupText.page.mobileSimulationRequired;
// @ts-expect-error
  nextViewState.pageRevertDisabled = pageSaveUiState.pageRevertDisabled;
  // Marking-mode "Preview Content": let the user see the AI content detection
  // without leaving marking mode. Mirrors Save gating - only available once a
  // successful AI run matches the live markings (and before the next change).
// @ts-expect-error
  nextViewState.markingPreviewVisible = pageControlsVisible && Boolean(isEnabled);
// @ts-expect-error
  nextViewState.markingPreviewDisabled =
    aiBusy ||
    pageSaveReconciliationPending ||
    !aiRunUpToDate;
// @ts-expect-error
  nextViewState.pageDraftStatusText = pageSaveUiState.pageDraftStatusText;
// @ts-expect-error
  nextViewState.pageDraftStatusTone = pageSaveUiState.pageDraftStatusTone;
// @ts-expect-error
  nextViewState.pageSessionNoticeVisible = pageSaveUiState.pageSessionNoticeVisible;
// @ts-expect-error
  nextViewState.pageSessionNoticeText = pageSaveUiState.pageSessionNoticeText;
// @ts-expect-error
  nextViewState.aiDirtyNoticeText = pageSaveUiState.aiDirtyNoticeText;
// @ts-expect-error
  nextViewState.syncLoadStatusText = state.lastConfigLoadStatusText || ViewText.syncLoadIdle;
// @ts-expect-error
  nextViewState.syncLoadStatusTone = state.lastConfigLoadStatusTone || "muted";
// @ts-expect-error
  nextViewState.syncSaveStatusText = state.lastConfigSaveStatusText || ViewText.syncSaveIdle;
// @ts-expect-error
  nextViewState.syncSaveStatusTone = state.lastConfigSaveStatusTone || "muted";
  const popupBusyActive = popupSpinnerVisible;
  const popupSpinnerSnapshot = currentSpinnerSnapshot();
// @ts-expect-error
  const backgroundLifecycleBusy = Boolean(popupBackgroundLifecycle && popupBackgroundLifecycle.busy);
// @ts-expect-error
  nextViewState.isBusy = popupBusyActive || backgroundLifecycleBusy || remoteConfigRetryBlocked || pageInspectionBusy;
// @ts-expect-error
  nextViewState.busyMessage = popupBusyActive
    ? currentSpinnerMessage()
    : backgroundLifecycleBusy
// @ts-expect-error
      ? (popupBackgroundLifecycle.message || PopupText.overlay.pleaseWait)
    : remoteConfigRetryBlocked
      ? PopupText.status.remoteServerRetryNotice
      : pageInspectionBusy
        ? PopupText.overlay.pageInspection
        : "";
// @ts-expect-error
  nextViewState.busyReason = popupBusyActive
    ? normalizeSpinnerReason(popupSpinnerSnapshot?.entry?.reason, popupSpinnerSnapshot?.key, currentSpinnerMessage())
    : backgroundLifecycleBusy
// @ts-expect-error
      ? normalizeSpinnerReason(popupBackgroundLifecycle.reason, popupBackgroundLifecycle.kind || "lifecycle", popupBackgroundLifecycle.message)
      : "";
// @ts-expect-error
  nextViewState.busySource = popupBusyActive
    ? (popupSpinnerSnapshot?.entry?.source || "popup-spinner")
    : backgroundLifecycleBusy
      ? "background-lifecycle"
      : "";
// @ts-expect-error
  nextViewState.busySpinnerKey = popupBusyActive
    ? (popupSpinnerSnapshot?.key || "")
    : "";
// @ts-expect-error
  nextViewState.pageDataNewNoticeHidden = pageSaveUiState.pageDataNewNoticeHidden;
// @ts-expect-error
  nextViewState.deviceEmulationEnabled = normalizedDeviceState.enabled;
// @ts-expect-error
  nextViewState.deviceMode = normalizedDeviceState.mode;
// @ts-expect-error
  nextViewState.deviceScale = normalizedDeviceState.scale.toFixed(2);
// @ts-expect-error
  nextViewState.deviceScaleValue = formatScalePercent(normalizedDeviceState.scale);
// @ts-expect-error
  nextViewState.deviceControlsDisabled = Boolean(state.deviceControlsDisabled || isEnabled);
// @ts-expect-error
  nextViewState.desktopPreviewVisible = desktopPreviewVisible;
// @ts-expect-error
  nextViewState.desktopPreviewEnabled = desktopPreviewActive;
// @ts-expect-error
  nextViewState.desktopPreviewDisabled =
    aiBusy ||
    !currentTabId ||
    !renderModeReady ||
    pageInspectionBusy ||
    state.deviceControlsDisabled;
// @ts-expect-error
  nextViewState.desktopPreviewNoticeVisible = desktopPreviewActive;
// @ts-expect-error
  nextViewState.desktopPreviewNoticeText = PopupText.device.desktopPreviewNotice;
// @ts-expect-error
  nextViewState.pageTypeGroups = pageTypeCoverageModel.pageTypes.map((pageType) => {
    const groupCurrent =
      currentPageMarkingAllowed &&
      currentPageCandidateState.pageTypeKey === pageType.key;
    return {
      key: pageType.key,
      title: pageType.title,
      markedCount: pageType.markedCount,
      missing: pageType.missing,
      current: groupCurrent,
      candidates: pageType.candidates.map((candidate) => {
        const candidateKey = buildPageMarkingKey(candidate.url, pageType.key);
        const isCurrent = groupCurrent && currentPageCandidateState.url === candidate.url;
        return {
          url: candidate.url,
          label: formatPageTypeCandidateLabel(candidate.url),
          wordsCount: candidate.wordsCount,
          marked: activeMarkedPageKeys.has(candidateKey),
          current: isCurrent,
          duplicate: Boolean(candidate.duplicate),
          navigationDisabled: Boolean(candidate.duplicate) || isCurrent,
          duplicateNotice:
            candidate.duplicate && Array.isArray(candidate.duplicatePageTypes) && candidate.duplicatePageTypes.length
              ? `Also listed under ${candidate.duplicatePageTypes.join(", ")}.`
              : ""
        };
      })
    };
  });
// @ts-expect-error
  nextViewState.pageTypeGroupsEmptyText = propertyPageTypesFetchError && !pageTypeCoverageModel.pageTypes.length
    ? propertyPageTypesFetchError
    : baseUrlReady
      ? PopupText.pageTypes.emptyState
      : effectiveSiteIdBlockedReason || ViewText.noMappedBaseUrlOrSiteId;
  const pageTypeCandidateNoticeText = currentPageCandidateState.status === "duplicate"
    ? PopupText.pageTypes.duplicateCurrentPage
    : currentPageCandidateState.status === "missing"
      ? (hasStoredCurrentPageEntry || currentPageEntryMarkedInvalid)
        ? PopupText.pageTypes.removedCurrentPage
        : PopupText.pageTypes.blockedCurrentPage
      : currentPageCandidateState.status === "empty"
        ? (propertyPageTypesFetchError || PopupText.pageTypes.emptyState)
        : pageTypeCoverageModel.invalidMarkedPages.length
          ? PopupText.pageTypes.invalidStoredNotice
          : "";
// @ts-expect-error
  nextViewState.pageTypeNoticeText = state.propertyPageTypesChangeNoticeVisible
    ? PopupText.pageTypes.changedNotice
    : pageTypeCandidateNoticeText;
// @ts-expect-error
  nextViewState.pageTypeNoticeVisible = Boolean(nextViewState.pageTypeNoticeText);
// @ts-expect-error
  nextViewState.lynxChecklistPageTypes = propertyPageTypes;
// @ts-expect-error
  nextViewState.markedPages = pageTypeCoverageModel.activeMarkedPages
    .map((item) => {
      const key = buildPageMarkingKey(item.url, item.pageType);
      const sourceItem = pageMarkingItemByKey.get(key);
      return {
        url: item.url,
        title: sourceItem && sourceItem.title ? sourceItem.title : item.title,
        pageType: item.pageType,
        count: sourceItem && Number.isFinite(sourceItem.count) ? sourceItem.count : 0
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
// @ts-expect-error
  nextViewState.markedPagesEmptyText = baseUrlReady
    ? PopupText.pageTypes.markRequirement
    : effectiveSiteIdBlockedReason || ViewText.noMappedBaseUrlOrSiteId;
  if (
    propertyPageTypes.length &&
    invalidStoredPageUrlsForRemote.length &&
    configEndpointValue &&
    tokenValue &&
    liveSiteId
  ) {
    pruneRemoteInvalidPageMarkings({
      endpointValue: configEndpointValue,
      tokenValue,
      siteId: liveSiteId,
// @ts-expect-error
      invalidUrls: invalidStoredPageUrlsForRemote
    }).then();
  }
  if (
    propertyPageTypes.length &&
    repairedStoredPageUrls.length &&
    configEndpointValue &&
    tokenValue &&
    normalizedStageBaseValue &&
    state.currentBaseUrl &&
    pageUrl
  ) {
    syncBaseConfigToServer({
      baseUrl: state.currentBaseUrl,
      pageUrl,
      endpointValue: configEndpointValue,
      tokenValue,
      stageBase: normalizedStageBaseValue,
      alertOnCurrentReplacement: false
    }).then();
  }

  const nextTodoExpansionKey = buildTodoExpansionContextKey(currentTabId, state.currentBaseUrl);
  const currentTodoExpansionKey = state.currentTodoExpansionKey;
  const todoExpansionContextChanged = nextTodoExpansionKey !== currentTodoExpansionKey;
  const hasNoTodoExpansionContext = !nextTodoExpansionKey;
  const movedToDifferentProperty = state.currentBaseUrl !== previousBaseUrl;
  const shouldAutoCollapseOnContextChange =
// @ts-expect-error
    todoExpansionContextChanged && nextViewState.todoAutoCollapse;
  const todoExpansionShouldCollapse =
    hasNoTodoExpansionContext ||
    movedToDifferentProperty ||
    shouldAutoCollapseOnContextChange;
  if (todoExpansionShouldCollapse) {
    Object.assign(nextViewState, getCollapsedTodoExpansionState());
  } else if (todoExpansionContextChanged) {
    Object.assign(
      nextViewState,
      getSavedTodoExpansionState(nextTodoExpansionKey) || getCollapsedTodoExpansionState()
    );
  }
  if (
    propertyPageTypesRefreshChanged &&
    state.propertyPageTypesChangeForceTodoOpen &&
// @ts-expect-error
    nextViewState.todoListVisible
  ) {
// @ts-expect-error
    nextViewState.todoControlsMenuOpen = false;
// @ts-expect-error
    nextViewState.todoSectionExpanded = true;
    state.propertyPageTypesChangeForceTodoOpen = false;
  }
  state.currentTodoExpansionKey = nextTodoExpansionKey;

  await syncRenderModeDebuggerLifecycle({
    wasVisible: Boolean(view.renderModeSectionVisible),
// @ts-expect-error
    isVisible: Boolean(nextViewState.renderModeSectionVisible),
    currentTabId
  });

  uiModule.setViewState(nextViewState);
}

async function maybeResumePersistedAiRun() {
  if (state.aiRequestInFlight || state.aiRunResumeInFlight) {
    return;
  }
// @ts-expect-error
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
    ? state.currentTab.id
    : null;
  const siteId = normalizeSiteIdValue(state.currentSiteId);
  if (!currentTabId || !siteId) {
    return;
  }
  const resumeCheckKey = `${currentTabId}|${siteId}`;
  if (state.aiRunResumeCheckKey === resumeCheckKey) {
    return;
  }
  state.aiRunResumeCheckKey = resumeCheckKey;
  state.aiRunResumeInFlight = true;
  try {
    const persistedRun = await loadPersistedAiRunRecord();
    if (!persistedRun) {
      return;
    }
    if (!shouldResumePersistedAiRun(persistedRun, siteId)) {
      if (persistedRun.siteId === siteId) {
        await clearPersistedAiRunRecord();
        await syncAiComputeLock(false);
      }
      return;
    }
    const { endpointValue, tokenValue } = await helpers.loadGlobalAiSettings();
    if (!endpointValue || !tokenValue) {
      await clearPersistedAiRunRecord();
      await syncAiComputeLock(false);
      return;
    }
    let statusResult;
    try {
      statusResult = await requestAiRunStatus({
        sessionId: persistedRun.sessionId
      });
    } catch {
      await clearPersistedAiRunRecord();
      await syncAiComputeLock(false);
      uiModule.showToast(PopupText.ai.runFailed);
      return;
    }
    if (statusResult.notFound) {
      await clearPersistedAiRunRecord();
      await syncAiComputeLock(false);
      uiModule.showToast(PopupText.ai.runUnavailable);
      return;
    }
    if (!statusResult.ok || statusResult.status === "error") {
      await clearPersistedAiRunRecord();
      await syncAiComputeLock(false);
      uiModule.showToast(PopupText.ai.runFailed);
      return;
    }
    const currentPageUrl = getCurrentPageUrl();
    setAiRunActiveState({
      sessionId: persistedRun.sessionId,
// @ts-expect-error
      siteId,
      deadlineAt: persistedRun.deadlineAt,
      resumed: true,
      phase: statusResult.status
    });
    const heartbeat = await refreshAiRunHeartbeat({
      sessionId: persistedRun.sessionId,
      siteId,
      deadlineAt: persistedRun.deadlineAt
    });
    if (!heartbeat) {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    await refreshUi();
    if (statusResult.status === "done") {
      let result;
      try {
        result = await requestAiRunResult({
          sessionId: persistedRun.sessionId
        });
      } catch {
// @ts-expect-error
        await failAiRun(PopupText.ai.runUnavailable);
        return;
      }
      if (!result.ok) {
// @ts-expect-error
        await failAiRun(result.notFound ? PopupText.ai.runUnavailable : PopupText.ai.runFailed);
        return;
      }
      const { previewOpened } = await applyComputedSelectorSet(result.selectorSet, {
        currentPageUrl,
        tokenValue
      });
      await stopAiRun({ unlockPage: !previewOpened });
      return;
    }
    await continueAiRunPolling({
      endpointValue,
      tokenValue,
      currentPageUrl
    });
  } finally {
    state.aiRunResumeInFlight = false;
  }
}

async function refreshUi(options = {}) {
// @ts-expect-error
  const useBusyOverlay = options.useBusyOverlay !== false;
  const refreshOptions = {
// @ts-expect-error
    skipPropertyLockFetch: Boolean(options.skipPropertyLockFetch),
// @ts-expect-error
    propertyPageTypesRefreshChanged: Boolean(options.propertyPageTypesRefreshChanged),
// @ts-expect-error
    remoteConfigLoadMode: typeof options.remoteConfigLoadMode === "string"
// @ts-expect-error
      ? options.remoteConfigLoadMode
      : ""
  };
  const response = useBusyOverlay
    ? await runWithSpinner(
      null,
      PopupText.overlay.loadingPopupAndPreparing,
      () => refreshUiInner(refreshOptions),
      {
        delayMs: POPUP_BUSY_OVERLAY_DELAY_MS,
        suppressIfActive: true
      }
    )
    : await refreshUiInner(refreshOptions);
  maybeResumePersistedAiRun().catch(() => {});
  return response;
}

// @ts-expect-error
function handleConfigEndpointInput(event) {
  uiModule.setViewState({ configEndpointUrlValue: event.target.value });
}

// @ts-expect-error
function handleEndpointInput(event) {
  uiModule.setViewState({ endpointUrlValue: event.target.value });
}

// @ts-expect-error
function handleStageBaseInput(event) {
  uiModule.setViewState({ stageBaseValue: event.target.value });
}

// @ts-expect-error
async function handleThemeInput(event) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  const nextThemeValue = normalizeThemeValue(
    event && event.target ? event.target.value : state.currentTheme
  );
  await applyThemeValue(nextThemeValue);
}

// @ts-expect-error
async function applyThemeValue(nextThemeValue) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  state.currentTheme = nextThemeValue;
  applyPopupTheme(state.currentTheme, state.currentThemeMode);
  uiModule.setViewState({
    themeValue: state.currentTheme,
    themeModeValue: normalizeThemeModeValue(state.currentThemeMode),
    themeMenuOpen: false
  });
  await persistThemeSettings(state.currentTheme, state.currentThemeMode);
}

function getThemeMenuPlacement() {
  const refs = uiModule.getRefs();
  const button = refs.themeDropdownButton;
  if (!button || typeof button.getBoundingClientRect !== "function") {
    return "bottom";
  }
  const rect = button.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  return spaceBelow < 220 && spaceAbove > spaceBelow ? "top" : "bottom";
}

// @ts-expect-error
function handleThemeMenuToggle(event) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  event.stopPropagation();
  const view = uiModule.getViewState();
  uiModule.setThemeMenuOpen(!view.themeMenuOpen, getThemeMenuPlacement());
}

// @ts-expect-error
function handleThemeMenuKeyDown(event) {
  const key = event && typeof event.key === "string" ? event.key : "";
  let indexDelta = null;
  if (key === "ArrowDown") {
    indexDelta = 1;
  } else if (key === "ArrowUp") {
    indexDelta = -1;
  }
  const options = Array.isArray(THEME_OPTIONS) ? THEME_OPTIONS : [];
  if (
    indexDelta === null ||
    !options.length ||
    !isFeatureEnabled("appearanceCustomization") ||
    uiModule.getViewState().themeControlsDisabled
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const currentTheme = normalizeThemeValue(state.currentTheme);
  const currentIndex = options.findIndex((item) => item && item.value === currentTheme);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + indexDelta + options.length) % options.length;
  if (!uiModule.getViewState().themeMenuOpen) {
    uiModule.setThemeMenuOpen(true, getThemeMenuPlacement());
  }
  void handleThemeOptionSelect(options[nextIndex].value).catch(() => {
    uiModule.showToast(PopupText.page.saveFailed);
  });
}

// @ts-expect-error
async function handleThemeOptionSelect(value) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  await applyThemeValue(normalizeThemeValue(value));
}

// @ts-expect-error
async function cycleTheme(direction) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  const options = Array.isArray(THEME_OPTIONS) ? THEME_OPTIONS : [];
  if (!options.length) {
    return;
  }
  const currentTheme = normalizeThemeValue(state.currentTheme);
  const currentIndex = options.findIndex((item) => item && item.value === currentTheme);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const delta = direction < 0 ? -1 : 1;
  const nextIndex = (safeIndex + delta + options.length) % options.length;
  state.currentTheme = normalizeThemeValue(options[nextIndex].value);
  applyPopupTheme(state.currentTheme, state.currentThemeMode);
  uiModule.setViewState({
    themeValue: state.currentTheme,
    themeModeValue: normalizeThemeModeValue(state.currentThemeMode),
    themeMenuOpen: false
  });
  await persistThemeSettings(state.currentTheme, state.currentThemeMode);
}

async function handleThemePrevious() {
  await cycleTheme(-1);
}

async function handleThemeNext() {
  await cycleTheme(1);
}

// @ts-expect-error
async function handleThemeModeInput(event) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  const nextThemeModeValue = normalizeThemeModeValue(
    event && (event.currentTarget || event.target)
      ? (event.currentTarget || event.target).value
      : state.currentThemeMode
  );
  state.currentThemeMode = nextThemeModeValue;
  applyPopupTheme(state.currentTheme, state.currentThemeMode);
  uiModule.setViewState({
    themeValue: normalizeThemeValue(state.currentTheme),
    themeModeValue: state.currentThemeMode
  });
  await persistThemeSettings(state.currentTheme, state.currentThemeMode);
}

// @ts-expect-error
function handleRenderModeInput(event) {
  const nextRenderMode = normalizeUiRenderModeValue(
    event && event.target ? event.target.value : uiModule.getViewState().renderModeValue
  );
  const view = uiModule.getViewState();
  const renderModeSetDisabled = Boolean(
    view.renderModeInputDisabled ||
      !view.renderModeSetVisible ||
      isUndeterminedRenderMode(nextRenderMode)
  );
  uiModule.setViewState({
    renderModeValue: nextRenderMode,
    renderModeSetDisabled
  });
}

// @ts-expect-error
async function runRenderModeInspectionReload(javaScriptDisabled) {
// @ts-expect-error
  const tabId = state.currentTab && state.currentTab.id;
  if (!tabId) {
    uiModule.showToast(PopupText.renderMode.toastUnavailable);
    return;
  }
  const operationId = `render-mode-inspection:${tabId}:${Date.now()}`;

  try {
    await runWithSpinner(null, PopupText.overlay.pleaseWait, async () => {
      state.renderModeInspectionActive = true;
      try {
        const inspectionResponse = await messages.requestTabRunRenderModeInspection(tabId, {
          baseUrl: state.currentBaseUrl,
          javaScriptDisabled,
          operationId
        });
// @ts-expect-error
        const operationResult = inspectionResponse && inspectionResponse.ok && inspectionResponse.result
// @ts-expect-error
          ? inspectionResponse.result
          : null;
        const inspectionResult = operationResult && operationResult.result && typeof operationResult.result === "object"
          ? operationResult.result
          : null;
        const inspectionFailureError = inspectionResult && typeof inspectionResult.followUpError === "string" && inspectionResult.followUpError
          ? inspectionResult.followUpError
          : (operationResult && typeof operationResult.error === "string" && operationResult.error) ||
// @ts-expect-error
            (inspectionResponse && inspectionResponse.error) || "";
        const reloadResult = inspectionResult && inspectionResult.reloadResult && typeof inspectionResult.reloadResult === "object"
          ? inspectionResult.reloadResult
          : {
            ok: false,
            error: inspectionFailureError || PopupText.renderMode.toastInspectReloadFailed
          };
        const loadStarted = Boolean(inspectionResult && inspectionResult.loadStarted);
        const outcome = resolveRenderModeInspectionReloadOutcome(reloadResult, loadStarted, javaScriptDisabled);
        if (!outcome.ok) {
          uiModule.showToast(outcome.toast);
          return;
        }

        const followUpCompleted = Boolean(inspectionResult && inspectionResult.followUpCompleted);
        if (followUpCompleted) {
          const snapshot = inspectionResult && inspectionResult.inspectionSnapshot && typeof inspectionResult.inspectionSnapshot === "object"
            ? inspectionResult.inspectionSnapshot
            : null;
          if (snapshot) {
            rememberRenderModeInspectionSnapshot(
              state.currentBaseUrl,
// @ts-expect-error
              snapshot.pageUrl || (state.currentTab && state.currentTab.url) || "",
              snapshot
            );
          }
          await reconcilePropertyLockAfterRenderModeReload();
          await refreshUi({ useBusyOverlay: false });
        }
        uiModule.showToast(outcome.toast);
      } finally {
        state.renderModeInspectionActive = false;
        uiModule.setViewState(buildPropertyLockViewState());
      }
    });
  } finally {
    scheduleStaleInspectionBusyClear(tabId, state.currentBaseUrl, {
      reconcileRenderModeNavSpinner: true
    });
  }
}

// @ts-expect-error
async function normalizeRenderModeDebuggerPage(tabId) {
  if (!tabId) {
    return;
  }

  const deviceState = await emulation.getDeviceEmulationState(tabId);
  if (deviceState && deviceState.enabled) {
    const reloadResult = await utils.reloadPageWithJavaScriptControl(tabId, false);
    if (!reloadResult.ok) {
      console.warn(
        "Unable to reload tab after re-enabling JavaScript:",
        reloadResult.error || "Unknown error"
      );
    }
    return;
  }

  const detachResult = await utils.detachDebugger(tabId);
  if (!detachResult.ok) {
    console.warn("Unable to detach debugger:", detachResult.error || "Unknown error");
  }

  const reloadResult = await chromeHelpers.reloadTab(tabId);
  if (!reloadResult.ok) {
    console.warn("Unable to reload tab after debugger detach:", reloadResult.error || "Unknown error");
  }
}

// @ts-expect-error
async function syncRenderModeDebuggerLifecycle({ wasVisible, isVisible, currentTabId }) {
  const managedTabId = state.renderModeDebuggerTabId;

  if (isVisible) {
    if (!currentTabId) {
      return;
    }

    if (managedTabId && managedTabId !== currentTabId) {
      await normalizeRenderModeDebuggerPage(managedTabId);
      state.renderModeDebuggerTabId = null;
    }

    if (managedTabId === currentTabId) {
      await hideConsentForRenderModeInspection();
      return;
    }

    const attachResult = await utils.attachDebugger(currentTabId);
    if (attachResult.ok || attachResult.alreadyAttached) {
      state.renderModeDebuggerTabId = currentTabId;
      await hideConsentForRenderModeInspection();
      return;
    }

    console.warn("Unable to attach debugger for render mode section:", attachResult.error || "Unknown error");
    return;
  }

  if ((wasVisible || managedTabId) && managedTabId) {
    await normalizeRenderModeDebuggerPage(managedTabId);
    state.renderModeDebuggerTabId = null;
  }
}

async function handleRenderModeInspectWithJavaScript() {
  await runRenderModeInspectionReload(false);
}

async function handleRenderModeInspectWithoutJavaScript() {
  await runRenderModeInspectionReload(true);
}

function setLynxChecklistViewState() {
  uiModule.setViewState({
    lynxChecklistVisible: Boolean(state.lynxChecklistVisible),
    lynxChecklistAiAnswer: state.lynxChecklistAiAnswer || "",
    lynxChecklistPageTypes: Array.isArray(state.lynxChecklistPageTypes)
      ? state.lynxChecklistPageTypes
      : [],
    lynxChecklistAiQuestionDisabled: Boolean(state.lynxChecklistAiQuestionDisabled),
    lynxChecklistAiQuestionHidden: Boolean(state.lynxChecklistAiQuestionHidden),
    lynxChecklistNoticeText: state.lynxChecklistNoticeText || ""
  });
}

function resetLynxChecklistState() {
  const initial = createInitialLynxChecklistState();
  const promptState = buildLynxChecklistPromptState();
  state.lynxChecklistAiAnswer = promptState.aiAnswer || initial.aiAnswer;
  state.lynxChecklistPageTypes = Array.isArray(state.propertyPageTypes)
    ? state.propertyPageTypes
    : initial.pageTypes;
  state.lynxChecklistAiQuestionDisabled = promptState.aiQuestionDisabled;
  state.lynxChecklistAiQuestionHidden = Boolean(promptState.aiQuestionHidden);
  state.lynxChecklistNoticeText = "";
}

function openLynxChecklistPopover() {
  resetLynxChecklistState();
  state.lynxChecklistVisible = true;
  setLynxChecklistViewState();
}

function closeLynxChecklistPopover() {
  state.lynxChecklistVisible = false;
  resetLynxChecklistState();
  setLynxChecklistViewState();
}

// @ts-expect-error
function handleLynxChecklistPageTypeDecisionChange(pageTypeKey, event) {
  void pageTypeKey;
  void event;
}

// @ts-expect-error
function handleLynxChecklistPageTypePageChange(pageTypeKey, event) {
  void pageTypeKey;
  void event;
}

function handleLynxChecklistCancel() {
  closeLynxChecklistPopover();
}

async function handleRenderModeSet() {
  await runWithSpinner(null, PopupText.overlay.savingRenderMode, async () => {
// @ts-expect-error
    const tabId = state.currentTab && state.currentTab.id;
    const nextRenderMode = normalizeUiRenderModeValue(uiModule.getViewState().renderModeValue);
    if (isUndeterminedRenderMode(nextRenderMode)) {
      uiModule.showToast(PopupText.renderMode.toastUndeterminedCannotSet);
      return;
    }
    if (!state.currentBaseUrl) {
      uiModule.showToast(PopupText.renderMode.toastUnavailable);
      return;
    }
    const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
    if (
      state.currentBaseUrlHasConfirmedRenderMode &&
      nextRenderMode === currentRenderMode
    ) {
      state.renderModeEditMode = false;
      state.renderModeDetectionUnsure = false;
      state.renderModeDetectionAccuracy = Number.NaN;
      state.renderModeWarningDismissedKey = "";
      state.renderModeManualStepsVisible = false;
      await refreshUi();
      return;
    }
    const renderModeUpdatedAt = config.createTimestampNow();
// @ts-expect-error
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (targetConfig) => {
      targetConfig.renderMode = nextRenderMode;
      targetConfig.renderModeUpdatedAt = renderModeUpdatedAt;
    });
    state.currentBaseUrlHasConfirmedRenderMode = true;
    state.renderModeEditMode = false;
    state.renderModeSummaryOpen = false;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = nextRenderMode;
    state.renderModeDetectionKey = "";
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeWarningDismissedKey = "";
    state.renderModeManualStepsVisible = false;
    await messages.sendTabMessage({
      type: "configUpdated",
      baseUrl: state.currentBaseUrl
    });
    // Normalize page execution state after Set regardless of the last
    // inspection path (with/without JavaScript) so post-Set behavior is
    // deterministic.
    if (tabId) {
      const tabState = await messages.getTabState(tabId);
      const candidateUrl =
// @ts-expect-error
        (state.currentTab && typeof state.currentTab.url === "string"
// @ts-expect-error
          ? state.currentTab.url
          : "");
      const settleBaseUrl =
        (tabState && tabState.baseUrl) || state.currentBaseUrl || "";
      // The post-Set reload always runs the editor reveal/freeze warmup for an
      // in-scope page, even in silent mode (marking not enabled). Gate the
      // overlay on in-scope, not on tabState.enabled, otherwise the spinner
      // never shows for the common fresh-property Set flow.
      const inspectionExpected = Boolean(
        settleBaseUrl &&
          (!candidateUrl || utils.isPageWithinBaseUrl(candidateUrl, settleBaseUrl))
      );
      if (inspectionExpected) {
        startRenderModeSetNavGuard(tabId);
        beginNavigationInspectionOverlay(tabId);
      }
      await normalizeRenderModeDebuggerPage(tabId);
      if (state.renderModeDebuggerTabId === tabId) {
        state.renderModeDebuggerTabId = null;
      }
    }
    await maybeSwitchToMarkingView();
    await refreshUi();
    uiModule.showToast(
      nextRenderMode === config.RENDER_MODE_RENDERED
        ? PopupText.renderMode.toastSetRendered
        : PopupText.renderMode.toastSetStatic
    );
  });
}

async function handleRenderModeEditToggle() {
  state.renderModeEditMode = !state.renderModeEditMode;
  if (state.renderModeEditMode) {
    state.renderModeSummaryOpen = true;
  }
  await refreshUi({ useBusyOverlay: false });
}

async function handleOpenRenderModeSection() {
  uiModule.setConfigMenuOpen(false);
  state.renderModeEditMode = true;
  state.renderModeSummaryOpen = true;
  await refreshUi({ useBusyOverlay: false });
}

// @ts-expect-error
function handleRenderModeSummaryToggle(event) {
  const target = event && event.currentTarget;
  const nextOpen = Boolean(target && target.open);
  const resolvedOpen =
    !state.currentBaseUrlHasConfirmedRenderMode || state.renderModeEditMode
      ? true
      : nextOpen;
  state.renderModeSummaryOpen = resolvedOpen;
  uiModule.setViewState({ renderModeSummaryOpen: resolvedOpen });
}

// @ts-expect-error
function handleLoginEmailInput(event) {
  updateLoginActionState({ loginEmailValue: event.target.value });
}

// @ts-expect-error
function handleLoginPasswordInput(event) {
  updateLoginActionState({ loginPasswordValue: event.target.value });
}

// @ts-expect-error
function handleEnterKeyDown(event, shouldHandle, handler) {
  if (event.key !== "Enter") {
    return;
  }
  if (!shouldHandle()) {
    return;
  }
  handler();
}

// @ts-expect-error
function handleConfigEndpointKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().configEndpointUrlReadOnly,
    handleConfigEndpointSet
  );
}

// @ts-expect-error
function handleEndpointKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().endpointUrlReadOnly,
    handleEndpointSet
  );
}

// @ts-expect-error
function handleStageBaseKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().stageBaseReadOnly,
    handleStageBaseSet
  );
}

// @ts-expect-error
function handleLoginPasswordKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().loginActionDisabled,
    handleLoginAction
  );
}

async function handlePropertyLockTake() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_TAKE_LOCK);
  await reconcilePropertyLockAfterCommand();
}

async function handlePropertyLockSuggest() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_SUGGEST);
  state.propertyLockSuggestionPending = true;
  state.propertyLockSuggestionRejected = false;
  uiModule.setViewState(buildPropertyLockViewState());
}

async function handlePropertyLockContinue() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_CONTINUE);
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockSecondsRemaining = null;
  uiModule.setViewState(buildPropertyLockViewState());
  await reconcilePropertyLockAfterCommand();
}

async function handlePropertyLockForceContinue() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_CONTINUE, {
    force: true,
    discardPrevious: true
  });
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockSecondsRemaining = null;
  uiModule.setViewState(buildPropertyLockViewState());
  await reconcilePropertyLockAfterCommand();
}

async function handlePropertyLockAcceptSuggestion() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  const suggestionId = state.propertyLockSuggestionId;
  if (!suggestionId) {
    return;
  }
  let discardUnsaved = false;
  if (state.currentDraftDirty || state.currentPageSaveReconciliationPending) {
    const shouldSave = window.confirm(propertyLockText.transferSaveBeforeAcceptConfirm);
    if (shouldSave) {
      await handlePageSave();
      await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
      if (state.currentDraftDirty || state.currentPageSaveReconciliationPending) {
        uiModule.showToast(PopupText.page.pageSavedAndSyncedRefreshFailed);
        return;
      }
    } else {
      const shouldDiscard = window.confirm(propertyLockText.transferDiscardBeforeAcceptConfirm);
      if (!shouldDiscard) {
        return;
      }
      discardUnsaved = true;
    }
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_RESPOND, {
    suggestionId,
    accept: true,
    discardUnsaved
  });
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  uiModule.setViewState(buildPropertyLockViewState());
  await reconcilePropertyLockAfterCommand();
}

async function handlePropertyLockRejectSuggestion() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  const suggestionId = state.propertyLockSuggestionId;
  if (!suggestionId) {
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_RESPOND, {
    suggestionId,
    accept: false
  });
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  uiModule.setViewState(buildPropertyLockViewState());
  await reconcilePropertyLockAfterCommand();
}

// @ts-expect-error
function handleConfigToggle(event) {
  event.stopPropagation();
  uiModule.setTodoControlsMenuOpen(false);
  uiModule.setConfigMenuOpen(!state.configMenuOpen);
}

// @ts-expect-error
function handleConfigMenuClick(event) {
  event.stopPropagation();
}

// @ts-expect-error
function handleTodoControlsMenuToggle(event) {
  event.stopPropagation();
  const view = uiModule.getViewState();
  uiModule.setConfigMenuOpen(false);
  uiModule.setTodoControlsMenuOpen(!Boolean(view.todoControlsMenuOpen));
}

// @ts-expect-error
function handleTodoControlsMenuClick(event) {
  event.stopPropagation();
}

function handleTodoSectionToggle() {
  const view = uiModule.getViewState();
  uiModule.setTodoSectionExpanded(!view.todoSectionExpanded);
  saveCurrentTodoExpansionState();
}

// @ts-expect-error
function handleTodoSubsectionToggle(key) {
  const view = uiModule.getViewState();
  const expanded = Boolean(view.todoSubsectionsExpanded && view.todoSubsectionsExpanded[key]);
  uiModule.setTodoSubsectionExpanded(key, !expanded);
  saveCurrentTodoExpansionState();
}

function handleTodoExpandAll() {
  uiModule.setTodoControlsMenuOpen(false);
  uiModule.setTodoAllSubsectionsExpanded(true);
  saveCurrentTodoExpansionState();
}

function handleTodoCollapseAll() {
  uiModule.setTodoControlsMenuOpen(false);
  uiModule.setTodoAllSubsectionsExpanded(false);
  saveCurrentTodoExpansionState();
}

function handleTodoAutoCollapseToggle() {
  const view = uiModule.getViewState();
  uiModule.setTodoAutoCollapse(!Boolean(view.todoAutoCollapse));
}

function handleConfigurationExtrasToggle() {
  uiModule.toggleConfigurationExtrasExpanded();
}

async function handleOpenConfigurationView() {
  uiModule.setConfigMenuOpen(false);
  clearRemoteConfigRetryTimer();
  state.currentView = uiModule.View.Configuration;
  collapseTodoListForAutoCollapse();
  uiModule.setViewState({ currentView: state.currentView });
  await refreshUi();
}

async function maybeSwitchToMarkingView() {
  const tokenIsValid = await validateStoredToken({
    force: true,
    showToastOnInvalid: false
  });
  const { tokenValue, endpointValue, configEndpointValue, stageBaseValue } =
    await helpers.loadGlobalAiSettings();
  if (
    tokenIsValid &&
    tokenValue &&
    endpointValue &&
    configEndpointValue &&
    normalizeStageBase(stageBaseValue)
  ) {
    state.currentView = uiModule.View.Marking;
    state.configViewLocked = false;
    collapseTodoListForAutoCollapse();
    uiModule.setViewState({ currentView: state.currentView });
  }
}

async function handleConfigurationContinue() {
  await maybeSwitchToMarkingView();
  await refreshUi();
}

// @ts-expect-error
async function handleExplicitExcludeView(xpath) {
  await runWithSpinner(null, PopupText.overlay.locatingElement, async () => {
    const response = await messages.sendTabMessage({
      type: "focusElement",
      xpath
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.focusFailed);
    }
  }, { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS });
}

// @ts-expect-error
async function handleExplicitExcludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
  await refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  await clearFocusedElement();
  const response = await messages.sendTabMessage({
    type: "setExplicitExclude",
    baseUrl: state.currentBaseUrl,
    xpath,
    excluded: false
  });
  if (!response || !response.ok) {
    uiModule.showToast(PopupText.explicitSelection.excludeUpdateFailed);
    return;
  }
  await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
}

// @ts-expect-error
async function handleExplicitIncludeView(xpath) {
  await runWithSpinner(null, PopupText.overlay.locatingElement, async () => {
    const response = await messages.sendTabMessage({
      type: "focusElement",
      xpath
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.focusFailed);
    }
  }, { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS });
}

// @ts-expect-error
async function handleExplicitIncludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
  await refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  await clearFocusedElement();
  const response = await messages.sendTabMessage({
    type: "setExplicitInclude",
    baseUrl: state.currentBaseUrl,
    xpath,
    included: false
  });
  if (!response || !response.ok) {
    uiModule.showToast(PopupText.explicitSelection.includeUpdateFailed);
    return;
  }
  await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
}

// @ts-expect-error
async function navigateActiveTabToUrl(url) {
  const tab = await helpers.ensureActiveTab({ requireId: true });
  if (!tab) {
    return false;
  }
  const response = await messages.sendRuntimeMessage({
    type: "navigateTabToUrl",
    tabId: tab.id,
    url
  });
  return Boolean(response && response.ok);
}

async function confirmNavigationAwayFromMarking() {
  let view = uiModule.getViewState();
  // Only marking mode with an unsaved session needs the discard gate; silent
  // highlighting (and a clean marking session) navigates freely.
  if (!view.toggleEnabled) {
    return true;
  }
  const pendingKnownFromCurrentView = Boolean(view.sessionHasPendingChanges);
  if (
    (await helpers.ensureActiveTab({ requireId: true })) &&
    state.currentBaseUrl &&
    !pendingKnownFromCurrentView
  ) {
    // If pending changes are already known, show confirm immediately. Only
    // refresh when pending state is not yet known to avoid false negatives.
    await refreshCurrentPageRuntimeStatus();
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    view = uiModule.getViewState();
  }
  if (!view.sessionHasPendingChanges) {
    // Clean marking session navigating away: the destination loads in silent
    // highlighting, so align the popup + tab state to silent too.
    await alignPopupToSilentMode();
    return true;
  }
  uiModule.showToast(
    view.sessionRequiresAiRun
      ? PopupText.page.exitRequiresAiResolution
      : PopupText.page.exitRequiresResolution
  );
  const confirmedDiscard = window.confirm(PopupText.page.navigateDiscardConfirm);
  if (!confirmedDiscard) {
    // Cancel: navigation stopped, stay in marking mode with the session intact.
    return false;
  }
  // OK: discard the pending session locally before navigating; the destination
  // page loads in silent highlighting mode, so align the popup + tab state to
  // silent (#6/#7) so re-enabling marking runs the full enable path again.
  await applyLocalPageDiscard();
  await alignPopupToSilentMode();
  return true;
}

// @ts-expect-error
async function navigateActiveTabToUrlWithTodoCollapse(url) {
  if (!(await confirmNavigationAwayFromMarking())) {
    return false;
  }
  const navigated = await navigateActiveTabToUrl(url);
  if (navigated) {
    collapseTodoListForAutoCollapse();
  }
  return navigated;
}

// @ts-expect-error
async function handleMarkedPageNavigate(url) {
  await navigateActiveTabToUrlWithTodoCollapse(url);
}

// @ts-expect-error
async function handleLynxChecklistCandidateNavigate(url) {
  if (!url) {
    return;
  }
  closeLynxChecklistPopover();
  await navigateActiveTabToUrlWithTodoCollapse(url);
}

// @ts-expect-error
async function handleEnableToggle(event) {
  const source = event && (event.currentTarget || event.target);
  const currentViewState = uiModule.getViewState();
  const desiredEnabled = source
    ? Boolean(source.checked)
    : currentViewState.toggleEnabled;
  if (desiredEnabled !== currentViewState.toggleEnabled) {
    collapseTodoListForAutoCollapse();
  }
  let latestViewState = currentViewState;
  const pendingKnownFromCurrentView = Boolean(
    !desiredEnabled && currentViewState.sessionHasPendingChanges
  );
// @ts-expect-error
  let immediateDisableSpinnerKey = null;
  const showImmediateDisableSpinner = () => {
// @ts-expect-error
    if (desiredEnabled || immediateDisableSpinnerKey) {
// @ts-expect-error
      return immediateDisableSpinnerKey;
    }
    immediateDisableSpinnerKey = pushSpinner(null, PopupText.overlay.disablingMarking, {
      delayMs: 0,
      reason: "marking-disable"
    });
    return immediateDisableSpinnerKey;
  };
  const clearImmediateDisableSpinner = () => {
// @ts-expect-error
    if (!immediateDisableSpinnerKey) {
      return;
    }
    popSpinner(immediateDisableSpinnerKey);
    immediateDisableSpinnerKey = null;
  };

  if (!desiredEnabled) {
    showImmediateDisableSpinner();
  }

  let tab = null;
  try {
    tab = await helpers.ensureActiveTab({ requireId: true, requireUrl: true });
  } catch (error) {
    clearImmediateDisableSpinner();
    throw error;
  }
  if (!tab) {
    clearImmediateDisableSpinner();
    return;
  }
  uiModule.setViewState({ toggleEnabled: desiredEnabled });
  if (!helpers.ensureBaseUrl(ViewText.noMappedBaseUrlOrSiteId)) {
    uiModule.setViewState({ toggleEnabled: false });
    clearLastPopupEnabled();
    clearImmediateDisableSpinner();
    return;
  }
  if (desiredEnabled && !isCurrentRenderModeReady()) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeEnabling);
    uiModule.setViewState({ toggleEnabled: false });
    clearLastPopupEnabled();
    await refreshUi();
    return;
  }
  if (desiredEnabled && !state.currentPageTypeKey) {
    uiModule.showToast(
      uiModule.getViewState().pageTypeNoticeText || PopupText.pageTypes.blockedCurrentPage
    );
    uiModule.setViewState({ toggleEnabled: false });
    clearLastPopupEnabled();
    await refreshUi();
    return;
  }

  try {
    if (!desiredEnabled && !pendingKnownFromCurrentView) {
      // If pending changes are already known in the current view state, show the
      // discard confirm immediately. Otherwise refresh first to avoid false
      // negatives when the pending state has not been computed yet.
      showImmediateDisableSpinner();
      await refreshCurrentPageRuntimeStatus({
        tabId: tab.id,
        baseUrl: state.currentBaseUrl
      });
      await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
      latestViewState = uiModule.getViewState();
    }

    if (!desiredEnabled && latestViewState.sessionHasPendingChanges) {
      clearImmediateDisableSpinner();
      uiModule.showToast(
        latestViewState.sessionRequiresAiRun
          ? PopupText.page.exitRequiresAiResolution
          : PopupText.page.exitRequiresResolution
      );
      const confirmedDiscard = window.confirm(PopupText.page.disableDiscardConfirm);
      if (!confirmedDiscard) {
        // Cancel: stay in marking mode with the pending session intact.
        uiModule.setViewState({ toggleEnabled: true });
// @ts-expect-error
        setLastPopupEnabled(true, buildPopupEnabledContext(tab, state.currentBaseUrl));
        await refreshUi();
        return;
      }
      // OK: discard the pending CSS selectors/markings locally, then fall through
      // to disable marking (which drops to silent highlighting mode).
      showImmediateDisableSpinner();
      await applyLocalPageDiscard();
    }
// @ts-expect-error
    setLastPopupEnabled(desiredEnabled, buildPopupEnabledContext(tab, state.currentBaseUrl));
    const baseUrlValue = state.currentBaseUrl;
    const currentPageTypeKey = desiredEnabled ? state.currentPageTypeKey || "" : "";
    await runWithSpinner(
      desiredEnabled ? null : immediateDisableSpinnerKey,
      desiredEnabled ? PopupText.overlay.enablingMarking : PopupText.overlay.disablingMarking,
// @ts-expect-error
      async (spinnerKey) => {
        if (desiredEnabled) {
          const parsed = utils.parseBaseUrl(baseUrlValue);
          if (!parsed) {
            uiModule.showToast(PopupText.baseUrl.toastInvalid);
            uiModule.setViewState({ toggleEnabled: false });
            clearLastPopupEnabled();
            await refreshUi();
            return;
          }
          if (!utils.isPageWithinBaseUrl(tab.url, baseUrlValue)) {
            uiModule.showToast(PopupText.baseUrl.toastOutsideCurrentPage);
            uiModule.setViewState({ toggleEnabled: false });
            clearLastPopupEnabled();
            await refreshUi();
            return;
          }
          {
            const currentConfigs = await config.getConfigs();
// @ts-expect-error
            const normalizedCurrent = config.normalizeConfig(baseUrlValue, currentConfigs[baseUrlValue]);
// @ts-expect-error
            state.currentConfig = normalizedCurrent.config;
          }
          const { stageBaseValue, tokenValue } = await helpers.loadGlobalAiSettings();
          const siteIdResult = await ensureBaseUrlSiteId({
            baseUrl: baseUrlValue,
            pageUrl: tab.url,
            stageBase: stageBaseValue,
            tokenValue,
            persist: false
          });
          if (!siteIdResult.ok || !siteIdResult.siteId) {
            uiModule.showToast(siteIdResult.reason || ViewText.noDomainIdForBaseUrl);
            uiModule.setViewState({ toggleEnabled: false });
            clearLastPopupEnabled();
            await refreshUi();
            return;
          }
          const effectiveBaseUrl = siteIdResult.baseUrl || baseUrlValue;
          state.currentBaseUrl = effectiveBaseUrl;
          state.currentConfig = siteIdResult.config || state.currentConfig;
          if (uiModule.getViewState().desktopPreviewEnabled) {
            uiModule.showToast(PopupText.device.desktopPreviewDisableMarkingToast);
            uiModule.setViewState({ toggleEnabled: false });
            clearLastPopupEnabled();
            await refreshUi();
            return;
          }
          setSpinnerMessage(spinnerKey, PopupText.overlay.pageInspection);
          const enableResponse = await messages.requestTabActivateMarking(tab.id, {
            baseUrl: effectiveBaseUrl,
            pageType: currentPageTypeKey,
            desktopPreviewEnabled: Boolean(uiModule.getViewState().desktopPreviewEnabled)
          });
          if (!enableResponse || !enableResponse.ok) {
            uiModule.setViewState({ toggleEnabled: false });
            clearLastPopupEnabled();
// @ts-expect-error
            if (enableResponse?.locked) {
// @ts-expect-error
              uiModule.showToast(propertyLockText.lockedInteractionBlockedToast(state.propertyLockState?.editorName || "Someone"));
            } else {
// @ts-expect-error
              uiModule.showToast(enableResponse?.error || PopupText.helper.activateFailedOnPage);
            }
            await refreshUi();
            return;
          }
          // Fresh entry into marking mode: Run AI starts enabled (no successful
          // run yet for the current markings), Save/Preview start disabled.
          resetAiRunMarkingsFingerprint();
        } else {
          const disableResponse = await messages.requestTabDeactivateMarking(tab.id, {
            baseUrl: baseUrlValue,
            pageType: ""
          });
          if (!disableResponse || !disableResponse.ok) {
            uiModule.setViewState({ toggleEnabled: true });
// @ts-expect-error
            setLastPopupEnabled(true, buildPopupEnabledContext(tab, state.currentBaseUrl));
// @ts-expect-error
            uiModule.showToast((disableResponse && disableResponse.error) || "Unable to disable marking");
            await refreshUi();
            return;
          }
        }
        await refreshUi();
      },
      { delayMs: desiredEnabled ? POPUP_BUSY_OVERLAY_DELAY_MS : 0 }
    );
    immediateDisableSpinnerKey = null;
  } finally {
    clearImmediateDisableSpinner();
  }
}

// @ts-expect-error
async function handleDeviceEmulationEnabledToggle(event) {
  if (!isFeatureEnabled("deviceEmulationToggle")) {
    return;
  }
  if (uiModule.getViewState().toggleEnabled) {
    return;
  }
  const desiredEnabled = event && event.currentTarget
    ? Boolean(event.currentTarget.checked)
    : uiModule.getViewState().deviceEmulationEnabled;
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  uiModule.setViewState({ deviceEmulationEnabled: desiredEnabled });
  if (desiredEnabled === state.currentDeviceEmulationEnabled) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: desiredEnabled,
    mode: "mobile",
    scale: state.currentDeviceScale
  });
}

// @ts-expect-error
async function handleDesktopPreviewEnabledToggle(event) {
  if (!isFeatureEnabled("desktopPreview")) {
    return;
  }
  const desiredEnabled = event && event.currentTarget
    ? Boolean(event.currentTarget.checked)
    : uiModule.getViewState().desktopPreviewEnabled;
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  const tab = state.currentTab;
// @ts-expect-error
  if (!tab || !tab.id) {
    return;
  }
  if (desiredEnabled === state.currentDesktopPreviewEnabled) {
    return;
  }
  if (desiredEnabled && !hasCalculatedSelectorsFromConfig(state.currentConfig)) {
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    return;
  }
  if (desiredEnabled && uiModule.getViewState().toggleEnabled) {
    await handleEnableToggle({ currentTarget: { checked: false } });
    if (uiModule.getViewState().toggleEnabled) {
      await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
      return;
    }
  }
  await runWithSpinner(
    null,
    PopupText.overlay.applyingDeviceEmulation,
    async () => {
      const targetMode = desiredEnabled ? "desktop" : "mobile";
      const normalized = await helpers.updateDeviceEmulation({
        enabled: true,
        mode: targetMode,
        scale: state.currentDeviceScale,
        recalculateScale:
          !state.currentDeviceEmulationEnabled ||
          state.currentDeviceMode !== targetMode
      });
      if (!normalized || !normalized.enabled || normalized.mode !== targetMode) {
        await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
        return;
      }
// @ts-expect-error
      await persistDesktopPreviewEnabled(tab.id, desiredEnabled);
      await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    },
    { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS }
  );
}


// @ts-expect-error
function handleDeviceScaleInput(event) {
  const value = event && event.currentTarget
    ? event.currentTarget.value
    : uiModule.getViewState().deviceScale;
  const scale = Number.parseFloat(value);
  if (!Number.isFinite(scale)) {
    return;
  }
  uiModule.setViewState({
    deviceScale: value,
    deviceScaleValue: formatScalePercent(scale)
  });
}

// @ts-expect-error
async function handleDeviceScaleChange(event) {
  const value = event && event.currentTarget
    ? event.currentTarget.value
    : uiModule.getViewState().deviceScale;
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  const scale = Number.parseFloat(value);
  if (!Number.isFinite(scale)) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    uiModule.setViewState({
      deviceEmulationEnabled: state.currentDeviceEmulationEnabled,
      deviceMode: state.currentDeviceMode,
      deviceScale: state.currentDeviceScale.toFixed(2),
      deviceScaleValue: formatScalePercent(state.currentDeviceScale)
    });
    return;
  }
  uiModule.setViewState({
    deviceScale: value,
    deviceScaleValue: formatScalePercent(scale)
  });
  if (scale === state.currentDeviceScale) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: true,
    mode: "mobile",
    scale
  });
}

async function handleClearDomainCache() {
  uiModule.setConfigMenuOpen(false);
  if (!isFeatureEnabled("cacheAndUnregisterTools")) {
    return;
  }
  const tab = await helpers.ensureActiveTab({
    requireUrl: true,
    toastOnMissing: PopupText.cache.toastNoActiveTab
  });
  if (!tab) {
    return;
  }
  const origin = utils.getOriginFromUrl(tab.url);
  if (!origin) {
    uiModule.showToast(PopupText.cache.toastUnsupportedPage);
    return;
  }
  let hostname = origin;
  try {
// @ts-expect-error
    hostname = new URL(tab.url).hostname;
  } catch (error) {
    hostname = origin;
  }
  const confirmed = window.confirm(formatClearDomainCacheConfirm(hostname));
  if (!confirmed) {
    return;
  }
  const clearCacheSpinnerKey = pushSpinner(null, PopupText.overlay.clearingCacheAndReloading);
  state.clearDomainCacheDisabled = true;
  uiModule.setViewState({ clearDomainCacheDisabled: true });
  try {
    const result = await chromeHelpers.clearBrowsingDataForOrigin(origin);
    if (!result.ok) {
      uiModule.showToast(result.error || PopupText.cache.toastClearFailed);
      return;
    }
    uiModule.showToast(PopupText.cache.toastCleared);
    const reloadResult = await chromeHelpers.reloadTab(tab.id);
    if (!reloadResult.ok) {
      uiModule.showToast(reloadResult.error || PopupText.cache.toastReloadFailed);
    }
  } catch (error) {
    uiModule.showToast(
// @ts-expect-error
      (error && error.message) || PopupText.cache.toastClearFailed
    );
  } finally {
    state.clearDomainCacheDisabled = false;
    uiModule.setViewState({ clearDomainCacheDisabled: false });
    popSpinner(clearCacheSpinnerKey);
  }
}

async function handleUnregisterCurrentTab() {
  uiModule.setConfigMenuOpen(false);
  if (!isFeatureEnabled("cacheAndUnregisterTools")) {
    return;
  }
  const tab = await helpers.ensureActiveTab({
    requireId: true,
    toastOnMissing: PopupText.unregister.toastNoActiveTab
  });
  if (!tab) {
    return;
  }
  const confirmed = window.confirm(PopupText.unregister.confirm);
  if (!confirmed) {
    return;
  }
  const unregisterSpinnerKey = pushSpinner(null, PopupText.overlay.unregisteringTabAndReloading);
  state.unregisterCurrentTabDisabled = true;
  uiModule.setViewState({ unregisterCurrentTabDisabled: true });
  try {
    const result = await messages.sendRuntimeMessage({
      type: "unregisterTabAndReload",
      tabId: tab.id
    });
    if (!result || !result.ok) {
      uiModule.showToast(
        (result && result.error) || PopupText.unregister.toastFailed
      );
      return;
    }
    window.close();
  } finally {
    state.unregisterCurrentTabDisabled = false;
    uiModule.setViewState({ unregisterCurrentTabDisabled: false });
    popSpinner(unregisterSpinnerKey);
  }
}

async function handleConfigEndpointSet() {
  const endpointValue = uiModule.getViewState().configEndpointUrlValue.trim();
  if (!endpointValue) {
    uiModule.showToast(PopupText.configuration.endpointEnter);
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    uiModule.showToast(PopupText.configuration.endpointEnterValid);
    return;
  }
  const saveResult = await saveGlobalConfigEndpoint(endpointValue);
  if (saveResult.tokenCleared) {
    state.lastTokenValidationAt = 0;
    state.siteIdLookupByBaseUrl.clear();
    setRemoteConfigConnectionIssue(false);
    uiModule.showToast(PopupText.configuration.endpointChangedLoginRequired);
  }
  state.configEndpointEditMode = false;
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleConfigEndpointEditToggle() {
  state.configEndpointEditMode = !state.configEndpointEditMode;
  await refreshUi();
}

async function handleEndpointSet() {
  const endpointValue = uiModule.getViewState().endpointUrlValue.trim();
  if (!endpointValue) {
    uiModule.showToast(PopupText.configuration.aiEndpointEnter);
    return;
  }
  try {
    new URL(endpointValue);
  } catch (error) {
    uiModule.showToast(PopupText.configuration.aiEndpointEnterValid);
    return;
  }
  const saveResult = await saveGlobalEndpoint(endpointValue);
  if (saveResult.tokenCleared) {
    state.lastTokenValidationAt = 0;
    setRemoteConfigConnectionIssue(false);
    uiModule.showToast(PopupText.configuration.aiEndpointChangedLoginRequired);
  }
  state.endpointEditMode = false;
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleEndpointEditToggle() {
  state.endpointEditMode = !state.endpointEditMode;
  await refreshUi();
}

async function handleStageBaseSet() {
  const inputValue = uiModule.getViewState().stageBaseValue.trim();
  const normalized = normalizeStageBase(inputValue);
  if (!normalized) {
    uiModule.showToast(PopupText.configuration.stageBaseEnterValid);
    return;
  }
  const saveResult = await saveGlobalStageBase(normalized);
  state.stageBaseEditMode = false;
  state.siteIdLookupByBaseUrl.clear();
  if (saveResult.tokenCleared) {
    uiModule.showToast(PopupText.configuration.stageBaseChangedLoginRequired);
  }
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleStageBaseEditToggle() {
  state.stageBaseEditMode = !state.stageBaseEditMode;
  await refreshUi();
}

async function handleLoginAction() {
  const view = uiModule.getViewState();
  const stageBase = normalizeStageBase(view.stageBaseValue || "");
  const email = view.loginEmailValue.trim();
  const password = view.loginPasswordValue;

  if (!stageBase) {
    uiModule.showToast(PopupText.authentication.toastSetStageBaseFirst);
    return;
  }
  if (!isValidEmail(email)) {
    uiModule.showToast(PopupText.authentication.toastEnterValidEmail);
    return;
  }
  if (!password.trim()) {
    uiModule.showToast(PopupText.authentication.toastEnterPassword);
    return;
  }

// @ts-expect-error
  state.aiRequestInFlight = "login";
  await refreshUi();
  let loginSucceeded = false;
  let loginFailureMessage = "";
  try {
    const response = await messages.sendRuntimeMessage({
      type: "requestAuthLogin",
      stageBase,
      email,
      password
    });
    const payload = response && response.payload && typeof response.payload === "object"
      ? response.payload
      : null;

    if (!response || response.ok !== true) {
      const status = response && Number.isFinite(response.status) ? response.status : 0;
      loginFailureMessage =
        (payload && typeof payload.error === "string" && payload.error) ||
        (payload && typeof payload.message === "string" && payload.message) ||
        formatLoginFailedStatus(status);
    } else {
      const token = payload && typeof payload.token === "string" ? payload.token.trim() : "";
      if (!token) {
        loginFailureMessage = PopupText.authentication.toastResponseMissingToken;
      } else {
        await saveLoginSettings({ stageBase, token });
        uiModule.setViewState({ loginPasswordValue: "" });
        loginSucceeded = true;
      }
    }
  } catch (error) {
    loginFailureMessage = PopupText.authentication.toastRequestFailed;
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
  if (!loginSucceeded) {
    uiModule.showToast(loginFailureMessage || PopupText.authentication.toastFailed);
    return;
  }
  uiModule.showToast(PopupText.authentication.toastSuccess);
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function alignPopupToSilentMode() {
  // Aligns the popup + tab state to silent (highlighting) mode WITHOUT touching
  // the content script: clears the popup enable toggle and marks the tab disabled
  // so the next refresh renders silent controls. Used by the post-save transition
  // and when navigating away from marking mode.
  const baseUrl = state.currentBaseUrl;
// @ts-expect-error
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
    ? state.currentTab.id
    : null;
  if (tabId !== null) {
    await messages.setTabState(tabId, { enabled: false, baseUrl, pageType: "" });
  }
  clearLastPopupEnabled();
  uiModule.setViewState({ toggleEnabled: false });
}

async function applyPostSaveSilentTransition() {
  // Post-save contract: the current page render resets from
  // scratch to the defaults -> CSS/AI selector baseline (the just-saved session
  // explicit deltas are dropped from the overlay), the mode switches marking ->
  // silent highlighting, and the user stays in silent until Enable Marking
  // re-enters marking from scratch.
  const baseUrl = state.currentBaseUrl;
// @ts-expect-error
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
    ? state.currentTab.id
    : null;
  // Reset + mode drop are owned by background command authority for this tab.
  if (tabId !== null) {
    await messages.requestTabApplyPostSaveTransition(tabId, { baseUrl });
  }
  state.currentDraftDirty = false;
  await alignPopupToSilentMode();
}

async function applyLocalPageDiscard() {
  const pageUrl = getCurrentPageUrl();
  const baseUrl = state.currentBaseUrl;
  // Discard drops the current-session marking deltas LOCALLY by restoring the
  // page entry from the already-cached backend-saved markings. No network
  // round-trip and no forced remote refetch keeps discard fast; the AI/CSS
  // selector baseline is intentionally preserved (only page markings revert).
  const backendSavedPageMarkings = await config.getBackendSavedPageMarkings(baseUrl);
  const backendEntry = findBackendSavedPageMarkingEntry(backendSavedPageMarkings, pageUrl);
  const normalizedTargetUrl = normalizeCandidatePageUrl(pageUrl);
// @ts-expect-error
  state.currentConfig = await config.updateConfig(baseUrl, (targetConfig) => {
    if (!targetConfig.pageMarkings || typeof targetConfig.pageMarkings !== "object") {
      targetConfig.pageMarkings = {};
    }
    Object.keys(targetConfig.pageMarkings).forEach((url) => {
      if (normalizeCandidatePageUrl(url) === normalizedTargetUrl) {
        delete targetConfig.pageMarkings[url];
      }
    });
    if (backendEntry) {
      targetConfig.pageMarkings[pageUrl] = clonePageMarkingEntry(backendEntry);
    }
  });
// @ts-expect-error
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
    ? state.currentTab.id
    : null;
  if (tabId !== null) {
    await messages.requestTabApplyLocalDiscard(tabId, { baseUrl });
  }
  await clearCurrentPageSaveReconciliation();
  state.aiSelectorsComputedSinceLastSubmit = false;
  state.aiSelectorsComputedBaseUrl = "";
  resetAiRunMarkingsFingerprint();
}

async function requestAiRunStart({
  endpointValue = "",
  payload = null,
  payloadKey = ""
} = {}) {
  const requestPayloadKey =
    typeof payloadKey === "string" && payloadKey.trim()
      ? payloadKey.trim()
      : buildTransferPayloadKey("ai-run-start-request");
  if (!payloadKey) {
    const stored = await putTransferPayload("ai-run-start-request", payload || {}, {
      payloadKey: requestPayloadKey
    });
    if (!stored.ok) {
      return { ok: false };
    }
  }
  const response = await messages.sendRuntimeMessage({
    type: "requestAiRunStartSnapshot",
    payloadKey: requestPayloadKey
  });
  if (!response || response.ok !== true || response.status !== "ok") {
    return { ok: false };
  }
  if (typeof response.sessionId !== "string" || !response.sessionId.trim()) {
    return { ok: false };
  }
  return { ok: true, sessionId: response.sessionId.trim() };
}

async function requestAiRunStatus({ sessionId = "" } = {}) {
  const response = await messages.sendRuntimeMessage({
    type: "requestAiRunStatus",
    sessionId
  });
  return response && typeof response === "object" ? response : { ok: false };
}

async function requestAiRunResult({ sessionId = "" } = {}) {
  const response = await messages.sendRuntimeMessage({
    type: "requestAiRunResultSnapshot",
    sessionId
  });
  if (response && response.notFound) {
    return { ok: false, notFound: true };
  }
  if (!response || response.ok !== true) {
    return { ok: false };
  }
  const payloadKey = typeof response.payloadKey === "string" ? response.payloadKey : "";
  const loaded = payloadKey
    ? await consumeTransferPayload(payloadKey, {
      expectedType: "object",
      removeInvalid: true
    })
    : { ok: false };
// @ts-expect-error
  const data = loaded.ok ? loaded.payload : null;
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray(data.exclusionSelectors) ||
    !Array.isArray(data.inclusionSelectors)
  ) {
    return { ok: false };
  }
  return { ok: true, selectorSet: normalizeAiSelectorSet(data) };
}

// @ts-expect-error
async function applyComputedSelectorSet(selectorSet, { currentPageUrl = "", tokenValue = "" } = {}) {
  const selectorsChanged =
    !config.isSelectorSetCurrentForRenderMode(state.currentConfig, "selectors") ||
    !aiSelectorSetsEqual(
      selectorSet,
// @ts-expect-error
      state.currentConfig && state.currentConfig.selectors
    );
  const selectorSetUpdatedAt = selectorsChanged
    ? config.createTimestampNow()
    : config.normalizeEntryTimestamp(
// @ts-expect-error
        state.currentConfig && state.currentConfig.selectorsUpdatedAt
      );
// @ts-expect-error
  state.currentConfig = await config.updateConfig(state.currentBaseUrl, (targetConfig) => {
    targetConfig.selectors = normalizeAiSelectorSet(selectorSet);
    targetConfig.selectorsUpdatedAt = selectorSetUpdatedAt;
  });
  const hasComputedNewSelectors =
    !aiSelectorSetsEqual(selectorSet, getLastSubmittedSelectorsFromConfig(state.currentConfig));
  state.aiSelectorsComputedSinceLastSubmit = hasComputedNewSelectors;
  state.aiSelectorsComputedBaseUrl = hasComputedNewSelectors ? state.currentBaseUrl : "";

  await messages.sendTabMessage({ type: "configUpdated", baseUrl: state.currentBaseUrl });
  // Refresh from the now-committed content draft so the captured fingerprint
  // reflects the SAME authoritative markings entry that the post-preview-exit
  // refresh will read back. Capturing from the (possibly stale or
  // refresh-nulled) in-memory draft could mismatch on return to marking mode
  // and wrongly re-enable Run AI / disable Show Content List + Save.
  await refreshCurrentPageRuntimeStatus();
  // Record the markings this AI run was computed for so Run AI disables and
  // Save/Preview enable until the next mark/unmark change.
  captureAiRunMarkingsFingerprint();

// @ts-expect-error
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
    ? state.currentTab.id
    : null;
  const previewResponse = await messages.requestTabShowAiPreview(tabId, {
    selectorSet
  });
// @ts-expect-error
  const previewOpened = Boolean(previewResponse && previewResponse.ok && previewResponse.result);
  updateLastConfigSaveStatus(PopupText.ai.selectorsComputedLocally);
  // This state is intentionally unsynced; keep the tone non-muted until Save runs.
  state.lastConfigSaveStatusTone = "warning";
  uiModule.showToast(PopupText.ai.selectorsComputedLocallyToast);
  return { previewOpened };
}

async function failAiRun(message = PopupText.ai.runFailed) {
  await stopAiRun({ unlockPage: true });
  uiModule.showToast(message);
}

// @ts-expect-error
function getAiRunCommandFailureMessage(response) {
  const details = response && response.details && typeof response.details === "object"
    ? response.details
    : {};
  if (details.reconciliationPending) {
    return PopupText.page.statusServerSyncPending;
  }
  if (details.locked) {
// @ts-expect-error
    return propertyLockText.lockedInteractionBlockedToast(state.propertyLockState?.editorName || "Someone");
  }
  if (details.reason === "missing_current_page") {
    return PopupText.ai.saveCurrentPageBeforeComputing;
  }
  if (details.reason === "missing_saved_pages") {
    return PopupText.ai.savePagesBeforeComputing;
  }
  if (details.reason === "timed_out") {
    return PopupText.ai.runTimedOut;
  }
  if (response && typeof response.error === "string" && response.error) {
    return response.error;
  }
  return PopupText.ai.saveCurrentPageBeforeComputing;
}

async function continueAiRunPolling({ endpointValue = "", tokenValue = "", currentPageUrl = "" } = {}) {
  while (state.aiRequestInFlight === "compute" && state.aiRunSessionId) {
    const sessionId = state.aiRunSessionId;
    const remainingMs = getAiRunRemainingMs(state.aiRunDeadlineAt);
    if (!remainingMs) {
// @ts-expect-error
      await failAiRun(PopupText.ai.runTimedOut);
      return;
    }
    await new Promise((resolve) => {
      state.aiRunPollTimer = window.setTimeout(resolve, Math.min(AI_RUN_POLL_INTERVAL_MS, remainingMs));
    });
    state.aiRunPollTimer = 0;
    if (state.aiRequestInFlight !== "compute" || !state.aiRunSessionId) {
      return;
    }
    if (!getAiRunRemainingMs(state.aiRunDeadlineAt)) {
// @ts-expect-error
      await failAiRun(PopupText.ai.runTimedOut);
      return;
    }
    let statusResult;
    try {
      statusResult = await requestAiRunStatus({
        sessionId
      });
    } catch {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    if (statusResult.notFound) {
// @ts-expect-error
      await failAiRun(state.aiRunResumed ? PopupText.ai.runUnavailable : PopupText.ai.runFailed);
      return;
    }
    if (!statusResult.ok) {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    if (statusResult.status === "running") {
      state.aiRunPhase = "running";
      const heartbeat = await refreshAiRunHeartbeat();
      if (!heartbeat) {
        await failAiRun(PopupText.ai.runFailed);
        return;
      }
      continue;
    }
    if (statusResult.status === "error") {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    let result;
    try {
        result = await requestAiRunResult({
          sessionId
        });
    } catch {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    if (result.notFound) {
// @ts-expect-error
      await failAiRun(state.aiRunResumed ? PopupText.ai.runUnavailable : PopupText.ai.runFailed);
      return;
    }
    if (!result.ok) {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    const { previewOpened } = await applyComputedSelectorSet(result.selectorSet, {
      currentPageUrl,
      tokenValue
    });
    await stopAiRun({ unlockPage: !previewOpened });
    return;
  }
}

async function handleComputeSelectors() {
  if (state.aiRequestInFlight || state.aiComputeStartPending) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!isCurrentRenderModeReady()) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeUsingAi);
    return;
  }
  state.aiComputeStartPending = true;
  try {
    await refreshCurrentPageRuntimeStatus();
    if (state.currentPageSaveReconciliationPending) {
      uiModule.showToast(PopupText.page.statusServerSyncPending);
      return;
    }
    const credentials = await helpers.requireAiCredentials();
    if (!credentials) {
      return;
    }
    const { tokenValue } = credentials;

    state.currentConfig = await config.ensureConfig(state.currentBaseUrl);
// @ts-expect-error
    const currentPageUrl = (state.currentTab && state.currentTab.url) || "";
    if (!currentPageUrl) {
      uiModule.showToast(PopupText.ai.currentPageUnavailable);
      return;
    }
// @ts-expect-error
    let pageMarkings = state.currentConfig.pageMarkings || {};
    let currentPageEntry = pageMarkings[currentPageUrl];
    const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
    const hasCurrentSubmissionXpaths =
      Array.isArray(currentPageEntry && currentPageEntry.submissionXpaths) &&
      currentPageEntry.submissionXpaths.length > 0;
    const currentPageHtml =
      currentPageEntry && typeof currentPageEntry.renderedHtml === "string"
        ? currentPageEntry.renderedHtml
        : "";
    const currentPageNeedsSnapshot =
      state.currentDraftDirty ||
      !currentPageEntry ||
      typeof currentPageEntry !== "object" ||
      !currentPageHtml ||
      !hasCurrentSubmissionXpaths;
    if (currentPageNeedsSnapshot && !ensureMobileSimulationForSave()) {
      return;
    }

// @ts-expect-error
    const siteId = normalizeSiteIdValue(state.currentSiteId || (state.currentConfig && state.currentConfig.siteId));
    const deadlineAt = Date.now() + AI_RUN_TIMEOUT_MS;
    setAiRunActiveState({
// @ts-expect-error
      siteId,
      deadlineAt,
      resumed: false,
      phase: "starting"
    });
    await waitForPopupUiPaint();
    try {
// @ts-expect-error
      const tabId = state.currentTab && state.currentTab.id;
      const aiRunResponse = await messages.requestTabRunAi(tabId, {
        baseUrl: state.currentBaseUrl,
        currentPageUrl,
        pageType: state.currentPageTypeKey || "",
        currentRenderMode,
        siteId,
        deadlineAt
      });
// @ts-expect-error
      if (!aiRunResponse || !aiRunResponse.ok || !aiRunResponse.result) {
        await failAiRun(getAiRunCommandFailureMessage(aiRunResponse));
        return;
      }

// @ts-expect-error
      const runResult = aiRunResponse.result;
      if (!Array.isArray(runResult.selectorSet?.exclusionSelectors) || !Array.isArray(runResult.selectorSet?.inclusionSelectors)) {
        await failAiRun(PopupText.ai.runFailed);
        return;
      }

      state.aiRunSessionId = typeof runResult.sessionId === "string" ? runResult.sessionId : "";
      state.aiRunPhase = "done";
      const { previewOpened } = await applyComputedSelectorSet(normalizeAiSelectorSet(runResult.selectorSet), {
        currentPageUrl,
        tokenValue
      });
      await stopAiRun({ unlockPage: false });
      if (!previewOpened) {
        await refreshUi();
      }
    } catch {
      await failAiRun(PopupText.ai.runFailed);
    }
  } finally {
    state.aiComputeStartPending = false;
  }
}

async function postPageTypeAssignmentsToAiServer(options = {}) {
  const {
// @ts-expect-error
    baseUrl = state.currentBaseUrl,
// @ts-expect-error
    checklistPageTypes = state.lynxChecklistPageTypes
  } = options;
  try {
    const preparedPayload = await messages.sendRuntimeMessage({
      type: "preparePageTypeAssignmentsSnapshot",
      baseUrl,
      checklistPageTypes
    });
    if (!preparedPayload || preparedPayload.ok !== true) {
      throw new Error("Unable to prepare page-type assignment payload.");
    }
    const requestPayloadKey = typeof preparedPayload.payloadKey === "string"
      ? preparedPayload.payloadKey
      : "";
    if (!requestPayloadKey) {
      return;
    }
    const response = await messages.sendRuntimeMessage({
      type: "submitPageTypeAssignments",
      payloadKey: requestPayloadKey
    });
    if (!response || response.ok !== true || response.status !== "ok") {
      throw new Error(`Request failed with status ${Number(response && response.httpStatus) || 0}`);
    }
  } catch (error) {
    console.warn("Unable to assign page types to AI server.", error);
  }
}

async function submitSelectorSetToServer(options = {}) {
  const {
// @ts-expect-error
    baseUrl = state.currentBaseUrl,
// @ts-expect-error
    selectorSet = getCurrentSelectorsFromConfig(),
// @ts-expect-error
    tokenValue = ""
  } = options;

  await refreshCurrentPageRuntimeStatus({ baseUrl });
  if (state.currentPageSaveReconciliationPending) {
    return { ok: false, skipped: true, reason: PopupText.page.statusServerSyncPending };
  }
  if (state.currentDraftDirty) {
    return { ok: false, skipped: true, reason: PopupText.ai.dirtyNotice };
  }

  const normalizedSelectorSet = normalizeAiSelectorSet(selectorSet);
  if (!combineAiSelectorSet(normalizedSelectorSet).length) {
    return { ok: false, skipped: true, reason: PopupText.ai.noSelectorsToSubmit };
  }

  const { stageBaseValue, configEndpointValue, endpointValue } = await helpers.loadGlobalAiSettings();
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBaseValue);
  if (!graphqlEndpoint) {
    return { ok: false, skipped: true, reason: PopupText.authentication.toastSetStageBaseFirst };
  }

  const siteIdResult = await ensureBaseUrlSiteId({
    baseUrl,
    stageBase: stageBaseValue,
    tokenValue
  });
  if (!siteIdResult.ok || !siteIdResult.siteId) {
    return {
      ok: false,
      skipped: true,
      reason: siteIdResult.reason || ViewText.noDomainIdForBaseUrl
    };
  }

  const effectiveBaseUrl = siteIdResult.baseUrl || baseUrl;
  state.currentBaseUrl = effectiveBaseUrl;
  state.currentConfig = siteIdResult.config || state.currentConfig;

  if (aiSelectorSetsEqual(normalizedSelectorSet, getLastSubmittedSelectorsFromConfig())) {
    return { ok: false, skipped: true, reason: PopupText.ai.noNewSelectorsToSubmit };
  }

  const includeCss = normalizedSelectorSet.inclusionSelectors.join(", ");
  const selectorSetForSubmit = buildSelectorSetForGraphqlSubmit(normalizedSelectorSet);
  const excludeCss = selectorSetForSubmit.exclusionSelectors.join(", ");
  const renderMode = buildGraphqlRenderModeValue(
    config.getConfigRenderMode(state.currentConfig)
  );
  let submitTokenValue = (await getStoredGlobalToken()) || tokenValue;

// @ts-expect-error
  state.aiRequestInFlight = "save";
  await refreshUi();
  try {
    await postPageTypeAssignmentsToAiServer({
      baseUrl: effectiveBaseUrl,
// @ts-expect-error
      pageMarkings: (state.currentConfig && state.currentConfig.pageMarkings) || {},
      checklistPageTypes: state.lynxChecklistPageTypes
    });
    submitTokenValue = (await getStoredGlobalToken()) || submitTokenValue;
    const response = await messages.sendRuntimeMessage({
      type: "submitSelectorSetGraphqlUpdate",
      stageBase: stageBaseValue,
      siteId: siteIdResult.siteId,
      includeCss,
      excludeCss,
      renderMode
    });
    let payload = null;
    if (response && response.payload && typeof response.payload === "object") {
      payload = response.payload;
    }
    if (!response || response.ok !== true) {
      return { ok: false, reason: PopupText.ai.submitResponseError };
    }
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: PopupText.ai.submitResponseFormatError };
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      return {
        ok: false,
        reason:
          payload.errors[0] && typeof payload.errors[0].message === "string"
            ? payload.errors[0].message
            : PopupText.ai.submitResponseError
      };
    }
    const mutationResult =
      payload.data && Object.prototype.hasOwnProperty.call(payload.data, "updateScrapingConditions")
        ? payload.data.updateScrapingConditions
        : undefined;
    if (
      mutationResult === undefined ||
      mutationResult === null ||
      mutationResult === false
    ) {
      return { ok: false, reason: PopupText.ai.submitResponseError };
    }

    const selectorsNeedRefresh =
      !config.isSelectorSetCurrentForRenderMode(state.currentConfig, "selectors") ||
      !aiSelectorSetsEqual(
        normalizedSelectorSet,
// @ts-expect-error
        state.currentConfig && state.currentConfig.selectors
      );
    const selectorSetUpdatedAt = selectorsNeedRefresh
      ? config.createTimestampNow()
      : config.normalizeEntryTimestamp(
// @ts-expect-error
          state.currentConfig && state.currentConfig.selectorsUpdatedAt
        );
    const submittedSelectorsFingerprint = getSelectorSetFingerprint(normalizedSelectorSet);
// @ts-expect-error
    state.currentConfig = await config.updateConfig(effectiveBaseUrl, (targetConfig) => {
      targetConfig.selectors = normalizeAiSelectorSet(normalizedSelectorSet);
      targetConfig.selectorsUpdatedAt = selectorSetUpdatedAt;
      targetConfig.submittedSelectorsFingerprint = submittedSelectorsFingerprint;
    });
    state.aiSelectorsComputedSinceLastSubmit = false;
    state.aiSelectorsComputedBaseUrl = "";
// @ts-expect-error
    const currentPageUrl = (state.currentTab && state.currentTab.url) || "";
    const configSyncResult = await syncBaseConfigToServer({
      baseUrl: effectiveBaseUrl,
      pageUrl: currentPageUrl,
      endpointValue: configEndpointValue,
      tokenValue: submitTokenValue,
      stageBase: stageBaseValue,
      alertOnCurrentReplacement: false
    });
    return { ok: true, baseUrl: effectiveBaseUrl, configSyncResult };
  } catch (error) {
    return { ok: false, reason: PopupText.ai.submitRequestFailed };
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
}

async function handleLynxChecklistSend() {
  if (!uiModule.getViewState().silentModeActive) {
    return;
  }
  const checklist = buildLynxChecklistViewModel({
    pageTypes: state.lynxChecklistPageTypes,
    markedPages: uiModule.getViewState().markedPages
  });
  if (!checklist.canSend) {
    setLynxChecklistViewState();
    return;
  }
  const credentials = await helpers.requireAiCredentials();
  if (!credentials) {
    return;
  }
  closeLynxChecklistPopover();
  const submitResult = await submitSelectorSetToServer({
    baseUrl: state.currentBaseUrl,
    selectorSet: getCurrentSelectorsFromConfig(),
    tokenValue: credentials.tokenValue
  });
  if (submitResult.ok) {
    const syncResult = submitResult.configSyncResult || null;
    const syncSkipped = Boolean(syncResult && syncResult.skipped);
    const syncFailed = Boolean(syncResult) && !syncSkipped && !isSuccessfulConfigSyncResult(syncResult);
    updateLastConfigSaveStatus(
      !syncResult
        ? PopupText.ai.submittedSelectors
        : syncSkipped
          ? PopupText.ai.submittedSelectorsSyncSkipped
          : syncFailed
            ? PopupText.ai.submittedSelectorsSyncFailed
            : PopupText.ai.submittedSelectorsAndSynced
    );
    uiModule.showToast(PopupText.ai.submittedToServer);
    return;
  }
  uiModule.showToast(submitResult.reason || PopupText.ai.submitRequestFailed);
}

async function handleSaveExcludes() {
  if (state.aiRequestInFlight) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!isCurrentRenderModeReady()) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeSubmitting);
    return;
  }
  await refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  if (!uiModule.getViewState().silentModeActive) {
    return;
  }
  openLynxChecklistPopover();
}

async function handlePreviewLatest() {
  if (!uiModule.getViewState().silentModeActive) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!state.currentConfig) {
    uiModule.showToast(ViewText.noMappedBaseUrlOrSiteId);
    return;
  }
  if (!hasCalculatedSelectorsFromConfig(state.currentConfig)) {
    uiModule.showToast(PopupText.preview.noStoredSelectors);
    return;
  }
  await refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  const selectorSet = getLatestAvailableSelectorsFromConfig();
  if (!combineAiSelectorSet(selectorSet).length) {
    uiModule.showToast(PopupText.preview.noStoredSelectors);
    return;
  }
  const view = uiModule.getViewState();
  if (view.previewBlocked) {
    return;
  }
  clearLastPopupEnabled();
  collapseTodoListForAutoCollapse();
// @ts-expect-error
  setPreviewBlocked(true, PopupText.preview.blockedActive);
  try {
// @ts-expect-error
    const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
      ? state.currentTab.id
      : null;
    const response = await messages.requestTabShowAiPreview(tabId, {
      selectorSet
    });
// @ts-expect-error
    if (!response || !response.ok || !response.result) {
      throw new Error(PopupText.preview.openFailed);
    }
    await refreshUi();
  } catch (error) {
    setPreviewBlocked(false);
// @ts-expect-error
    uiModule.showToast((error && error.message) || PopupText.preview.openFailed);
    await refreshUi();
  }
}

async function handleMarkingPreview() {
  const view = uiModule.getViewState();
  if (!view.markingPreviewVisible || view.markingPreviewDisabled) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!state.currentConfig) {
    uiModule.showToast(ViewText.noMappedBaseUrlOrSiteId);
    return;
  }
  await refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  const selectorSet = getLatestAvailableSelectorsFromConfig();
  if (!combineAiSelectorSet(selectorSet).length) {
    uiModule.showToast(PopupText.preview.noStoredSelectors);
    return;
  }
  if (uiModule.getViewState().previewBlocked) {
    return;
  }
  collapseTodoListForAutoCollapse();
// @ts-expect-error
  setPreviewBlocked(true, PopupText.preview.blockedActive);
  try {
// @ts-expect-error
    const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
      ? state.currentTab.id
      : null;
    const response = await messages.requestTabShowAiPreview(tabId, {
      selectorSet
    });
// @ts-expect-error
    if (!response || !response.ok || !response.result) {
      throw new Error(PopupText.preview.openFailed);
    }
    await refreshUi();
  } catch (error) {
    setPreviewBlocked(false);
// @ts-expect-error
    uiModule.showToast((error && error.message) || PopupText.preview.openFailed);
    await refreshUi();
  }
}

async function handleExitPreviewMode() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
// @ts-expect-error
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
    ? state.currentTab.id
    : null;
  const response = await messages.requestTabCloseAiPreview(tabId);
// @ts-expect-error
  if (!response || !response.ok || !response.result) {
    uiModule.showToast(PopupText.preview.exitFailed);
  }
}

// @ts-expect-error
function normalizePreviewItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item) => item && typeof item === "object" && typeof item.xpath === "string")
    .map((item) => ({
      xpath: item.xpath,
      text: typeof item.text === "string" ? item.text : "",
      title: typeof item.title === "string" && item.title ? item.title : item.xpath,
      kind: typeof item.kind === "string" ? item.kind : ""
    }));
}

// @ts-expect-error
function buildPreviewViewState(previewState) {
  const previewMode = typeof (previewState && previewState.mode) === "string"
    ? previewState.mode
    : "";
  const previewExpandedStatesEnabled = isFeatureEnabled("previewExpandedStates");
  return {
    previewActive: Boolean(previewState && previewState.active && previewMode === "preview"),
    previewItems: normalizePreviewItems(previewState && previewState.items),
    previewFocusedXpath: typeof (previewState && previewState.focusedXpath) === "string"
      ? previewState.focusedXpath
      : "",
    previewShowAllCategories: Boolean(
      previewExpandedStatesEnabled &&
      previewState &&
      previewState.active &&
      previewMode === "preview" &&
      previewState.showAllCategories
    )
  };
}

// @ts-expect-error
async function handlePreviewShowAllCategoriesChange(event) {
  if (!isFeatureEnabled("previewExpandedStates")) {
    uiModule.setViewState({ previewShowAllCategories: false });
    return;
  }
  const nextChecked = Boolean(event && event.target && event.target.checked);
  const previousChecked = Boolean(uiModule.getViewState().previewShowAllCategories);
  uiModule.setViewState({ previewShowAllCategories: nextChecked });
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    uiModule.setViewState({ previewShowAllCategories: previousChecked });
    return;
  }
  try {
// @ts-expect-error
    const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
      ? state.currentTab.id
      : null;
    const response = await messages.requestTabSetAiPreviewExpandedMode(tabId, {
      active: nextChecked
    });
// @ts-expect-error
    if (!response || !response.ok || !response.result) {
      throw new Error(PopupText.preview.updateFailed);
    }
// @ts-expect-error
    uiModule.setViewState(buildPreviewViewState(response.result.previewState || null));
  } catch (error) {
    uiModule.setViewState({ previewShowAllCategories: previousChecked });
// @ts-expect-error
    uiModule.showToast((error && error.message) || PopupText.preview.updateFailed);
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
  }
}

// @ts-expect-error
async function handlePreviewItemFocus(xpath) {
  if (!xpath || !await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  uiModule.setViewState({ previewFocusedXpath: xpath });
// @ts-expect-error
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
// @ts-expect-error
    ? state.currentTab.id
    : null;
  const response = await messages.requestTabFocusPreviewElement(tabId, {
    xpath
  });
// @ts-expect-error
  if (!response || !response.ok || !response.result) {
    uiModule.showToast(PopupText.explicitSelection.focusFailed);
    await refreshUi();
  }
}

function scheduleRefresh() {
  if (state.refreshTimer) {
    return;
  }
  state.refreshTimer = window.setTimeout(async () => {
    state.refreshTimer = 0;
    await helpers.ensureActiveTab();
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
  }, 120);
}

async function init() {
  state.traceEvents = [];
  state.traceModeEnabled = await loadTraceModeSetting().catch(() => false);
  await helpers.ensureActiveTab();
// @ts-expect-error
  const initTabId = state.currentTab && state.currentTab.id;
  if (initTabId) {
    connectBackgroundStatePort(initTabId);
    await restoreSpinnerQueueFromBackground(initTabId);
    await applyTraceModePreferenceToTab(initTabId, state.traceModeEnabled).catch(() => null);
    if (popupSpinnerQueue.has("navInspect")) {
      popupNavigationInspectionOverlayStarted = true;
      popupNavigationInspectionOverlayTabId = initTabId;
    }
  }
  logPopupReady(console, state);
  await ensureThemeSettings();

  uiModule.initUi({
    onToggleEnabled: handleEnableToggle,
    onDeviceEmulationEnabledChange: handleDeviceEmulationEnabledToggle,
    onDesktopPreviewEnabledChange: handleDesktopPreviewEnabledToggle,
    onDeviceScaleInput: handleDeviceScaleInput,
    onDeviceScaleChange: handleDeviceScaleChange,
    onConfigToggle: handleConfigToggle,
    onConfigMenuClick: handleConfigMenuClick,
    onTodoControlsMenuToggle: handleTodoControlsMenuToggle,
    onTodoControlsMenuClick: handleTodoControlsMenuClick,
    onTodoSectionToggle: handleTodoSectionToggle,
    onTodoSubsectionToggle: handleTodoSubsectionToggle,
    onTodoExpandAll: handleTodoExpandAll,
    onTodoCollapseAll: handleTodoCollapseAll,
    onTodoAutoCollapseToggle: handleTodoAutoCollapseToggle,
    onTraceModeToggle: handleTraceModeToggle,
    onConfigurationExtrasToggle: handleConfigurationExtrasToggle,
    onOpenConfiguration: handleOpenConfigurationView,
    onConfigurationContinue: handleConfigurationContinue,
    onClearDomainCache: handleClearDomainCache,
    onUnregisterCurrentTab: handleUnregisterCurrentTab,
    onPageSave: handlePageSave,
    onPageRevert: handlePageRevert,
    onMarkingPreview: handleMarkingPreview,
    onConfigEndpointInput: handleConfigEndpointInput,
    onConfigEndpointKeyDown: handleConfigEndpointKeyDown,
    onConfigEndpointSet: handleConfigEndpointSet,
    onConfigEndpointEditToggle: handleConfigEndpointEditToggle,
    onEndpointInput: handleEndpointInput,
    onEndpointKeyDown: handleEndpointKeyDown,
    onEndpointSet: handleEndpointSet,
    onEndpointEditToggle: handleEndpointEditToggle,
    onStageBaseInput: handleStageBaseInput,
    onThemeInput: handleThemeInput,
    onThemePrevious: handleThemePrevious,
    onThemeNext: handleThemeNext,
    onThemeMenuToggle: handleThemeMenuToggle,
    onThemeMenuKeyDown: handleThemeMenuKeyDown,
    onThemeOptionSelect: handleThemeOptionSelect,
    onThemeModeInput: handleThemeModeInput,
    onRenderModeInput: handleRenderModeInput,
    onRenderModeChoiceInput: handleRenderModeInput,
    onRenderModeSummaryToggle: handleRenderModeSummaryToggle,
    onRenderModeInspectWithJavaScript: handleRenderModeInspectWithJavaScript,
    onRenderModeInspectWithoutJavaScript: handleRenderModeInspectWithoutJavaScript,
    onLynxChecklistPageTypeDecisionChange: handleLynxChecklistPageTypeDecisionChange,
    onLynxChecklistPageTypePageChange: handleLynxChecklistPageTypePageChange,
    onLynxChecklistCandidateNavigate: handleLynxChecklistCandidateNavigate,
    onLynxChecklistCancel: handleLynxChecklistCancel,
    onLynxChecklistSend: handleLynxChecklistSend,
    onRenderModeSet: handleRenderModeSet,
    onRenderModeEditToggle: handleRenderModeEditToggle,
    onOpenRenderModeSection: handleOpenRenderModeSection,
    onStageBaseKeyDown: handleStageBaseKeyDown,
    onStageBaseSet: handleStageBaseSet,
    onStageBaseEditToggle: handleStageBaseEditToggle,
    onLoginEmailInput: handleLoginEmailInput,
    onLoginPasswordInput: handleLoginPasswordInput,
    onLoginPasswordKeyDown: handleLoginPasswordKeyDown,
    onLoginAction: handleLoginAction,
    onPropertyLockTake: handlePropertyLockTake,
    onPropertyLockSuggest: handlePropertyLockSuggest,
    onPropertyLockContinue: handlePropertyLockContinue,
    onPropertyLockForceContinue: handlePropertyLockForceContinue,
    onPropertyLockAcceptSuggestion: handlePropertyLockAcceptSuggestion,
    onPropertyLockRejectSuggestion: handlePropertyLockRejectSuggestion,
    onCompute: handleComputeSelectors,
    onSaveExcludes: handleSaveExcludes,
    onPreviewLatest: handlePreviewLatest,
    onPreviewItemFocus: handlePreviewItemFocus,
    onPreviewShowAllCategoriesChange: handlePreviewShowAllCategoriesChange,
    onExitPreviewMode: handleExitPreviewMode,
    onExplicitExcludeView: handleExplicitExcludeView,
    onExplicitExcludeRemove: handleExplicitExcludeRemove,
    onExplicitIncludeView: handleExplicitIncludeView,
    onExplicitIncludeRemove: handleExplicitIncludeRemove,
    onMarkedPageNavigate: handleMarkedPageNavigate
  });

  document.addEventListener("click", () => {
    uiModule.setConfigMenuOpen(false);
    uiModule.setTodoControlsMenuOpen(false);
    uiModule.setThemeMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      uiModule.setConfigMenuOpen(false);
      uiModule.setTodoControlsMenuOpen(false);
      uiModule.setThemeMenuOpen(false);
    }
    const primaryModifier = event.ctrlKey || event.metaKey;
    if (!primaryModifier || event.altKey || event.shiftKey || event.repeat) {
      return;
    }
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (key !== "e" && key !== "s" && key !== "m") {
      return;
    }
    if (key === "m" && !isFeatureEnabled("desktopPreview")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (isEditableTarget(event.target)) {
      return;
    }
    const view = uiModule.getViewState();
    if (key === "e") {
      if (view.toggleEnabledDisabled) {
        return;
      }
      handleEnableToggle({ target: { checked: !view.toggleEnabled } }).then();
      return;
    }
    if (key === "m") {
      if (view.desktopPreviewVisible && !view.desktopPreviewDisabled) {
        handleDesktopPreviewEnabledToggle({
          currentTarget: { checked: !view.desktopPreviewEnabled }
        }).then();
      }
      return;
    }
    if (!view.toggleEnabled || view.pageSaveDisabled) {
      return;
    }
    handlePageSave().then();
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    if (!tabId) {
      return;
    }
    const tab = await chrome.tabs.get(tabId);
// @ts-expect-error
    if (state.currentTab && tab.windowId !== state.currentTab.windowId) {
      return;
    }
    // Remove old-tab spinner storage when switching tabs; the popup keeps only the active tab queue.
// @ts-expect-error
    const oldTabId = state.currentTab && state.currentTab.id;
    if (oldTabId) {
      clearSpinnerQueueInBackground(oldTabId, { transientOnly: true }).catch(() => {});
    }
    clearNavigationInspectionSettlePollsExcept();
    popupSpinnerQueue.clear();
    if (popupSpinnerTimer) {
      window.clearTimeout(popupSpinnerTimer);
      popupSpinnerTimer = 0;
    }
    if (popupSpinnerVisible) {
      popupSpinnerVisible = false;
      uiModule.setUiBusy(false);
      syncPageBusyFromPopupSpinner();
    }
    popupNavigationInspectionOverlayStarted = false;
    popupNavigationInspectionOverlayTabId = null;
    await helpers.ensureActiveTab();
    // Restore spinner queue for the newly active tab.
// @ts-expect-error
    const newTabId = state.currentTab && state.currentTab.id;
    if (newTabId) {
      try {
        connectBackgroundStatePort(newTabId);
        await restoreSpinnerQueueFromBackground(newTabId);
      } catch {
        // Restoration failure is non-fatal; queue remains empty for this tab.
      }
      if (popupSpinnerQueue.has("navInspect")) {
        popupNavigationInspectionOverlayStarted = true;
        popupNavigationInspectionOverlayTabId = newTabId;
      }
    }
    await refreshUi();
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
// @ts-expect-error
    if (!state.currentTab || tabId !== state.currentTab.id) {
      return;
    }
    if (!(changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete")) {
      return;
    }
// @ts-expect-error
    state.currentTab = tab;
    await messages.sendRuntimeMessage({
      type: "clearReloadRestoreTabState",
      tabId
    }).catch(() => null);
    const tabState = await messages.getTabState(tabId);
    const candidateUrl = typeof changeInfo.url === "string" && changeInfo.url
      ? changeInfo.url
      : ((tab && typeof tab.url === "string") ? tab.url : "");
    // While a render-mode Set reload is in flight, the tab may not be
    // marking-enabled (silent mode). Resolve a base URL from tab state or the
    // current property so the settle checks and scope test still work, and treat
    // the reload as inspection so the navInspect overlay is not torn down here.
    const renderModeSetGuardActive = isRenderModeSetNavGuardActive(tabId);
    const settleBaseUrl =
      (tabState && tabState.baseUrl) || state.currentBaseUrl || "";
    const inspectionExpected = Boolean(
      (tabState &&
        tabState.enabled &&
        tabState.baseUrl &&
        (!candidateUrl || utils.isPageWithinBaseUrl(candidateUrl, tabState.baseUrl))) ||
      (renderModeSetGuardActive &&
        settleBaseUrl &&
        (!candidateUrl || utils.isPageWithinBaseUrl(candidateUrl, settleBaseUrl)))
    );
    if (!inspectionExpected) {
// @ts-expect-error
      if (popupNavigationInspectionOverlayTabId === tabId) {
        endNavigationInspectionOverlay(tabId);
      }
      if (changeInfo.url || changeInfo.status === "complete") {
        await refreshUi();
      }
      return;
    }
    beginNavigationInspectionOverlay(tabId);
    if (changeInfo.status === "loading") {
      return;
    }
    try {
      await refreshUi({ useBusyOverlay: false });
      if (changeInfo.status === "complete") {
        const settleResult = await waitForEnableMarkingInspectionToSettle(tabId, settleBaseUrl);
        logPopupSpinnerDebug("nav-complete-settle", {
          tabId,
          settleResult,
          url: tab && typeof tab.url === "string" ? tab.url : ""
        });
        if (settleResult.responseObserved || settleResult.inspectionObserved) {
          if (shouldHoldNavInspectUntilRenderModeInspectionSeen(tabId)) {
            scheduleNavigationInspectionSettlePoll(tabId, settleBaseUrl);
          } else {
            endNavigationInspectionOverlay(tabId);
            await refreshUi({ useBusyOverlay: false });
          }
        } else {
          // Communication can briefly fail on some pages. Keep queued spinner active
          // until we can explicitly confirm inspection settled.
          scheduleNavigationInspectionSettlePoll(tabId, settleBaseUrl);
        }
      }
    } finally {
      // Completion cleanup is handled after explicit settle checks above.
    }
  });
  window.addEventListener("beforeunload", () => {
    clearObserverRemoteConfigRefreshTimer();
    clearPropertyLockOffCandidateRefreshTimer();
// @ts-expect-error
    const tabId = state.currentTab && state.currentTab.id;
    if (tabId) {
      clearSpinnerQueueInBackground(tabId, { transientOnly: true }).catch(() => {});
    }
    clearNavigationInspectionSettlePollsExcept();
    if (popupSpinnerTimer) {
      window.clearTimeout(popupSpinnerTimer);
      popupSpinnerTimer = 0;
    }
  });

  utils.addStorageChangeListener((changes, areaName) => {
    if (areaName === "sync") {
// @ts-expect-error
      if (changes[GLOBAL_THEME_KEY] || changes[GLOBAL_THEME_MODE_KEY]) {
        const appearanceCustomizationEnabled = isFeatureEnabled("appearanceCustomization");
// @ts-expect-error
        if (!appearanceCustomizationEnabled && (changes[GLOBAL_THEME_KEY] || changes[GLOBAL_THEME_MODE_KEY])) {
          resetDisabledAppearanceCustomization();
        }
// @ts-expect-error
        if (appearanceCustomizationEnabled && changes[GLOBAL_THEME_KEY]) {
          state.currentTheme = normalizeThemeValue(
// @ts-expect-error
            changes[GLOBAL_THEME_KEY].newValue
          );
        }
// @ts-expect-error
        if (appearanceCustomizationEnabled && changes[GLOBAL_THEME_MODE_KEY]) {
          state.currentThemeMode = normalizeThemeModeValue(
// @ts-expect-error
            changes[GLOBAL_THEME_MODE_KEY].newValue
          );
        }
        if (appearanceCustomizationEnabled) {
          applyPopupTheme(state.currentTheme, state.currentThemeMode);
        }
        scheduleRefresh();
      }
      return;
    }
    if (areaName !== "local" && areaName !== "session") {
      return;
    }
    if (
// @ts-expect-error
      (areaName === "local" && changes.configs) ||
      (areaName === "session" &&
        state.currentTab &&
// @ts-expect-error
        (changes[`${constants.TAB_STATE_PREFIX}${state.currentTab.id}`] ||
// @ts-expect-error
          changes[`${constants.DEVICE_EMULATION_PREFIX}${state.currentTab.id}`] ||
// @ts-expect-error
          changes[renderModeNoJsHeldStorageKey(state.currentTab.id)]))
    ) {
      scheduleRefresh();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      state.currentTab &&
      sender &&
      sender.tab &&
      sender.tab.id &&
// @ts-expect-error
      sender.tab.id !== state.currentTab.id
    ) {
      return;
    }
    if (message && message.type === PROPERTY_LOCK_BACKGROUND_STATE_UPDATE) {
      if (!isPropertyLockCollaborationEnabled()) {
        resetDisabledPropertyLockState();
        uiModule.setViewState(buildPropertyLockViewState());
        return;
      }
      const messageSiteId = normalizeSiteIdValue(message.siteId);
      const messageTabId = Number.isFinite(message.tabId) ? Math.trunc(message.tabId) : null;
      if (
        messageTabId !== null &&
        state.currentTab &&
// @ts-expect-error
        Number.isFinite(state.currentTab.id) &&
// @ts-expect-error
        messageTabId !== Math.trunc(state.currentTab.id)
      ) {
        return;
      }
      if (
        messageSiteId &&
        state.propertyLockSiteId &&
        messageSiteId !== state.propertyLockSiteId
      ) {
        return;
      }
      if (typeof message.clientId === "string" && message.clientId) {
        state.propertyLockClientId = message.clientId;
      }
// @ts-expect-error
      const applied = applyPropertyLockServerMessage(message.message || null, messageSiteId);
      if (applied) {
        uiModule.setViewState(buildPropertyLockViewState());
        if (message.message && message.message.type === PROPERTY_LOCK_WS_LOCK_STATE) {
          scheduleRefresh();
        }
      }
      return;
    }
    if (message && message.type === "aiPreviewClosed") {
      state.aiPreviewMarkingRestoreDeadlineAt = message.markingEnabled
        ? Date.now() + AI_PREVIEW_MARKING_RESTORE_HOLD_MS
        : 0;
      (async () => {
        try {
          setPreviewBlocked(false);
          if (message.markingEnabled) {
            clearLastPopupEnabled();
            uiModule.setViewState({
              toggleEnabled: true,
              mainUiHidden: false,
              silentModeActive: false
            });
          }
          await refreshUi();
        } catch {
          setPreviewBlocked(false);
        }
      })();
      return;
    }
    if (message && message.type === "aiPreviewFocusChanged") {
      uiModule.setViewState({
        previewFocusedXpath: typeof message.xpath === "string" ? message.xpath : ""
      });
      return;
    }
    if (!message || message.type !== "pageDraftChanged") {
      return;
    }
    if (state.currentBaseUrl && utils.sameBaseUrl(message.baseUrl, state.currentBaseUrl)) {
      scheduleRefresh();
    }
  });

  if (state.tokenValidationTimer) {
    popupTimers.clear("token-validation");
  }
  state.tokenValidationTimer = popupTimers.setInterval("token-validation", async () => {
    const isValid = await validateStoredToken({ force: true, showToastOnInvalid: true });
    if (!isValid) {
      await refreshUi();
    }
  }, TOKEN_VALIDATION_INTERVAL_MS);

  await refreshUi({ useBusyOverlay: false });
}

init();
