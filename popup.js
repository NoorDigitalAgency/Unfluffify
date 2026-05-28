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
import * as emulation from "./popup/emulation.js";
import * as uiModule from "./popup/ui.js";
import {
  buildLynxChecklistAssignments,
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
  PROPERTY_PAGE_TYPES_QUERY,
  URL_SEARCH_INFO_QUERY,
  buildGraphqlEndpointFromStageBase,
  getCurrentPageCandidateState,
  maybeUpdateStoredTokenFromResponse,
  normalizeSiteIdValue,
  normalizeStageBase
} from "./common/lynx-live-pages.js";
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
  AI_RUN_PERSIST_KEY,
  AI_RUN_POLL_INTERVAL_MS,
  AI_RUN_TIMEOUT_MS,
  formatAiRunCountdown,
  getAiRunRemainingMs,
  getAiRunResumeExpiresAt,
  normalizePersistedAiRunRecord,
  parseAiRunStartResponse,
  parseAiRunStatusResponse,
  shouldResumePersistedAiRun
} from "./popup/ai-run.js";
import { resolveRenderModeInspectionReloadOutcome } from "./popup/render-mode.js";
import * as stateModule from "./popup/state.js";
import {
  getPopupTelemetryIncludePayloads,
  getPopupTelemetryTabId,
  logPopupReady
} from "./popup/telemetry.js";
import {
  refineXPathEntries
} from "./common/xpath-utilities.js";
import {
  isAiSubmissionDocumentRootXpath
} from "./content/submission-rules.js";
import {
  normalizeAiSelectorSet,
  combineAiSelectorSet,
  aiSelectorSetsEqual
} from "./common/selector-set.js";
import { installExtensionTelemetry } from "./common/extension-telemetry.js";
import {
  createInactiveRemoteSupportSidebarSnapshot,
  normalizeRemoteSupportSidebarSnapshot,
  REMOTE_SUPPORT_CONTROL_OWNER_REQUESTER,
  REMOTE_SUPPORT_CONTROL_OWNER_SUPPORTER,
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED,
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
  REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP,
  getRemoteSupportDockFallbackState,
  isRemoteSupportPageUrl,
  REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
  REMOTE_SUPPORT_MODE_SUPPORTING,
  normalizeRemoteSupportDockState,
  scopeRemoteSupportStateToTab,
  shouldLockRemoteSupportConfigurationView
} from "./common/remote-support.js";
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

installExtensionTelemetry({
  source: "popup",
  getTabId: () => getPopupTelemetryTabId(state),
  getIncludePayloads: () => getPopupTelemetryIncludePayloads(state)
});

function resetPropertyLockState() {
  state.propertyLockSiteId = null;
  state.propertyLockState = null;
  state.propertyLockConnectionStatus = PROPERTY_LOCK_CONNECTION_INACTIVE;
  state.propertyLockConnectionError = "";
  state.propertyLockIdentity = "";
  state.propertyLockName = "";
  state.propertyLockSecondsRemaining = null;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionPending = false;
  state.propertyLockSuggestionRejected = false;
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockDisconnectCountdown = null;
  state.propertyLockTransferCountdown = null;
}

function clearPropertyLockTransientState() {
  state.propertyLockSecondsRemaining = null;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionPending = false;
  state.propertyLockSuggestionRejected = false;
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockDisconnectCountdown = null;
  state.propertyLockTransferCountdown = null;
}

function applyPropertyLockState(lockStateLike) {
  state.propertyLockState = normalizeLockStateMessage(lockStateLike || createInactiveLockState());
  clearPropertyLockTransientState();
}

function applyPropertyLockConnectionStatus(status, error = "") {
  state.propertyLockConnectionStatus = typeof status === "string" && status
    ? status
    : PROPERTY_LOCK_CONNECTION_INACTIVE;
  state.propertyLockConnectionError = typeof error === "string" ? error : "";
}

function applyPropertyLockServerMessage(serverMessage, siteId = null) {
  if (!serverMessage || typeof serverMessage !== "object") {
    return false;
  }

  const resolvedSiteId = normalizeSiteIdValue(siteId || state.propertyLockSiteId);
  if (resolvedSiteId) {
    state.propertyLockSiteId = resolvedSiteId;
  }

  const type = typeof serverMessage.type === "string" ? serverMessage.type : PROPERTY_LOCK_WS_LOCK_STATE;
  const secondsRemaining = typeof serverMessage.secondsRemaining === "number"
    ? Math.max(0, Math.ceil(serverMessage.secondsRemaining))
    : null;

  if (type === PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS) {
    applyPropertyLockConnectionStatus(serverMessage.connectionStatus, serverMessage.error);
    return true;
  }

  if (type === PROPERTY_LOCK_WS_LOCK_STATE || !serverMessage.type) {
    applyPropertyLockState(serverMessage);
    return true;
  }

  if (type === PROPERTY_LOCK_WS_DISCONNECT_WARNING) {
    state.propertyLockDisconnectCountdown = secondsRemaining;
    state.propertyLockSecondsRemaining = secondsRemaining;
    return true;
  }

  if (type === PROPERTY_LOCK_WS_INACTIVITY_WARNING) {
    state.propertyLockInactivityWarningVisible = true;
    state.propertyLockSecondsRemaining = secondsRemaining;
    return true;
  }

  if (type === PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION) {
    state.propertyLockSuggestionId = String(serverMessage.suggestionId || "");
    state.propertyLockSuggestionFromName = String(serverMessage.fromName || "");
    state.propertyLockSuggestionVisible = Boolean(state.propertyLockSuggestionId);
    state.propertyLockSuggestionPending = false;
    state.propertyLockSuggestionRejected = false;
    return true;
  }

  if (type === PROPERTY_LOCK_WS_SUGGESTION_PENDING) {
    state.propertyLockSuggestionId = String(serverMessage.suggestionId || "");
    state.propertyLockSuggestionPending = Boolean(state.propertyLockSuggestionId);
    state.propertyLockSuggestionRejected = false;
    return true;
  }

  if (type === PROPERTY_LOCK_WS_SUGGESTION_RESPONSE) {
    state.propertyLockSuggestionPending = false;
    state.propertyLockSuggestionRejected = serverMessage.accepted === false;
    return true;
  }

  if (type === PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED || type === PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN) {
    state.propertyLockTransferCountdown = secondsRemaining;
    state.propertyLockSecondsRemaining = secondsRemaining;
    state.propertyLockSuggestionVisible = false;
    state.propertyLockSuggestionPending = false;
    state.propertyLockSuggestionRejected = false;
    return true;
  }

  if (type === PROPERTY_LOCK_WS_ERROR) {
    uiModule.showToast(String(serverMessage.reason || "Property lock request failed"));
    return false;
  }

  return false;
}

function isPropertyLockBlockingEditing() {
  const lockState = state.propertyLockState;
  if (
    state.propertyLockSiteId &&
    state.propertyLockConnectionStatus === PROPERTY_LOCK_CONNECTION_UNAVAILABLE
  ) {
    return true;
  }
  return Boolean(
    lockState &&
      !lockState.isEditor &&
      lockState.state !== PROPERTY_LOCK_STATE_UNLOCKED
  );
}

function buildPropertyLockViewState() {
  const lockState = state.propertyLockState || createInactiveLockState();
  const editorName = lockState.editorName || "Someone";
  const secondsRemaining = state.propertyLockSecondsRemaining;
  const visible = Boolean(state.propertyLockSiteId);
  const viewState = {
    propertyLockVisible: visible,
    propertyLockTone: "muted",
    propertyLockIcon: "lock-open-outline",
    propertyLockStatusText: "",
    propertyLockDetailText: "",
    propertyLockSuggestVisible: false,
    propertyLockTakeVisible: false,
    propertyLockTakeText: propertyLockText.takeoverButton,
    propertyLockContinueVisible: false,
    propertyLockSuggestionVisible: false,
    propertyLockAcceptVisible: false,
    propertyLockRejectVisible: false
  };

  if (!visible) {
    return viewState;
  }

  if (
    lockState.state === PROPERTY_LOCK_STATE_UNLOCKED &&
    state.propertyLockConnectionStatus === PROPERTY_LOCK_CONNECTION_CONNECTING
  ) {
    viewState.propertyLockTone = "muted";
    viewState.propertyLockIcon = "sync";
    viewState.propertyLockStatusText = propertyLockText.popupConnecting;
    return viewState;
  }

  if (
    lockState.state === PROPERTY_LOCK_STATE_UNLOCKED &&
    state.propertyLockConnectionStatus === PROPERTY_LOCK_CONNECTION_UNAVAILABLE
  ) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "cloud-off-outline";
    viewState.propertyLockStatusText = propertyLockText.popupUnavailable;
    viewState.propertyLockDetailText = propertyLockText.popupUnavailableDetail;
    return viewState;
  }

  if (state.propertyLockSuggestionVisible) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "account-switch-outline";
    viewState.propertyLockStatusText = propertyLockText.takeoverSuggestionMessage(
      state.propertyLockSuggestionFromName || "Someone"
    );
    viewState.propertyLockDetailText = propertyLockText.popupEditorDetail;
    viewState.propertyLockSuggestionVisible = true;
    viewState.propertyLockAcceptVisible = true;
    viewState.propertyLockRejectVisible = true;
    return viewState;
  }

  if (state.propertyLockDisconnectCountdown !== null) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "wifi-off";
    viewState.propertyLockStatusText = propertyLockText.editorDisconnectCountdownMessage(
      state.propertyLockDisconnectCountdown || 0
    );
    return viewState;
  }

  if (state.propertyLockInactivityWarningVisible) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "timer-alert-outline";
    viewState.propertyLockStatusText = propertyLockText.editorInactivityWarningMessage(secondsRemaining || 0);
    viewState.propertyLockContinueVisible = true;
    return viewState;
  }

  if (state.propertyLockTransferCountdown !== null) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "swap-horizontal";
    viewState.propertyLockStatusText = propertyLockText.editorTransferCountdownMessage(
      state.propertyLockTransferCountdown || 0
    );
    return viewState;
  }

  if (state.propertyLockSuggestionPending) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "clock-outline";
    viewState.propertyLockStatusText = propertyLockText.passiveSuggestionPendingMessage(editorName);
    viewState.propertyLockDetailText = propertyLockText.popupPassiveDetail;
    return viewState;
  }

  if (state.propertyLockSuggestionRejected) {
    viewState.propertyLockTone = "danger";
    viewState.propertyLockIcon = "lock-alert-outline";
    viewState.propertyLockStatusText = propertyLockText.passiveSuggestionRejectedMessage(editorName);
    viewState.propertyLockDetailText = propertyLockText.popupPassiveDetail;
    viewState.propertyLockSuggestVisible = true;
    return viewState;
  }

  if (lockState.state === PROPERTY_LOCK_STATE_UNLOCKED) {
    viewState.propertyLockTone = "success";
    viewState.propertyLockStatusText = propertyLockText.popupUnlocked;
    return viewState;
  }

  if (lockState.state === PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "lock-open-variant-outline";
    viewState.propertyLockStatusText = propertyLockText.takeoverAvailableMessage;
    viewState.propertyLockTakeVisible = true;
    viewState.propertyLockTakeText = lockState.isRecentEditor
      ? propertyLockText.startEditingAgainButton
      : propertyLockText.takeoverButton;
    return viewState;
  }

  if (lockState.state === PROPERTY_LOCK_STATE_TRANSFER) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "swap-horizontal";
    viewState.propertyLockStatusText = propertyLockText.editorTransferCountdownMessage(secondsRemaining || 0);
    return viewState;
  }

  if (lockState.isEditor) {
    viewState.propertyLockTone = "success";
    viewState.propertyLockIcon = "lock-check-outline";
    viewState.propertyLockStatusText = propertyLockText.popupEditorActive;
    viewState.propertyLockDetailText = propertyLockText.popupEditorDetail;
    return viewState;
  }

  viewState.propertyLockTone = lockState.state === PROPERTY_LOCK_STATE_EXPIRY_WARNING ? "warning" : "danger";
  viewState.propertyLockIcon = "lock-outline";
  viewState.propertyLockStatusText = lockState.state === PROPERTY_LOCK_STATE_EXPIRY_WARNING
    ? propertyLockText.passiveExpiryCountdownMessage(editorName, secondsRemaining || 0)
    : propertyLockText.passiveLockedMessage(editorName);
  viewState.propertyLockDetailText = propertyLockText.popupPassiveDetail;
  viewState.propertyLockSuggestVisible = lockState.state === PROPERTY_LOCK_STATE_LOCKED || lockState.state === PROPERTY_LOCK_STATE_EXPIRY_WARNING;
  return viewState;
}

async function fetchPropertyLockState(siteId) {
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  if (!normalizedSiteId) {
    return null;
  }

  try {
    return await chrome.runtime.sendMessage({
      type: PROPERTY_LOCK_BACKGROUND_GET_STATE,
      siteId: normalizedSiteId
    });
  } catch (error) {
    return {
      state: createInactiveLockState(),
      connectionStatus: PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
      error: "background_unavailable"
    };
  }
}

async function sendPropertyLockCommand(type, payload = {}) {
  const siteId = normalizeSiteIdValue(state.propertyLockSiteId);
  if (!siteId) {
    return { ok: false };
  }

  try {
    return await chrome.runtime.sendMessage({ type, siteId, ...payload });
  } catch (error) {
    return { ok: false };
  }
}

const TOKEN_VALIDATION_INTERVAL_MS = 600 * 1000;
const POPUP_BUSY_OVERLAY_DELAY_MS = 180;
const REMOTE_CONFIG_RETRY_DELAY_MS = 2500;
const RENDER_MODE_DETECTION_MAX_ATTEMPTS = 3;
const RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY = 0.65;
const RENDER_MODE_DETECTION_REVIEW_ACCURACY = 0.95;
const RENDER_MODE_UNDETERMINED = "undetermined";
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS = 120 * 1000;
const LYNX_CHECKLIST_AI_AUTO_CONFIRM_WINDOW_MS = 15 * 1000;
const TODO_EXPANSION_CONTEXT_LIMIT = 200;
const REMOTE_SUPPORT_SIDEBAR_SNAPSHOT_DEBOUNCE_MS = 150;
const REMOTE_SUPPORT_SIDEBAR_STREAM_CHANNEL_NAME = "unfluffify-remote-support-sidebar-stream";
const REMOTE_SUPPORT_SIDEBAR_STREAM_IMAGE_QUALITY = 0.72;
const REMOTE_SUPPORT_SIDEBAR_CURSOR_ID = "unfluffify-remote-support-sidebar-cursor";
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
      const leftOrder = THEME_ACCENT_CLUSTER_ORDER[left.cluster] ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = THEME_ACCENT_CLUSTER_ORDER[right.cluster] ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.label.localeCompare(right.label);
    })
    .map((theme) => ({ value: theme.value, label: theme.label }))
);
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
let popupBusyOverlayDepth = 0;
let popupBusyOverlayVisible = false;
let popupBusyOverlayTimer = 0;
let popupBusyOverlayMessage = PopupText.overlay.loadingPopup;
let propertyPageTypesRequest = null;
let remoteSupportSidebarSnapshotSyncTimer = 0;
let pendingRemoteSupportSidebarSnapshot = null;
let pendingRemoteSupportSidebarSnapshotKey = "";
let lastRemoteSupportSidebarSnapshotKey = "";
let remoteSupportSidebarStreamChannel = null;
let remoteSupportPopupMediaChannel = null;
let remoteSupportDockPiPWindow = null;
let remoteSupportLocalCameraCanvas = null;
let remoteSupportLocalCameraCtx = null;
let remoteSupportLocalCameraMediaStream = null;
let remoteSupportRemoteCameraCanvas = null;
let remoteSupportRemoteCameraCtx = null;
let remoteSupportRemoteCameraMediaStream = null;
let remoteSupportSidebarStreamAnimationFrame = 0;
let remoteSupportSidebarStreamCaptureInFlight = false;
let remoteSupportSidebarStreamDirty = false;
let remoteSupportSidebarStreamObserver = null;
let remoteSupportSidebarStreamListenersBound = false;
let remoteSupportSidebarCursorHideTimer = 0;

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function beginPopupBusyOverlay(message, options = {}) {
  const delayMs = Number.isFinite(options.delayMs)
    ? Math.max(0, Math.trunc(options.delayMs))
    : 0;
  const suppressIfActive = Boolean(options.suppressIfActive);
  if (
    suppressIfActive &&
    (popupBusyOverlayDepth > 0 || popupBusyOverlayVisible || popupBusyOverlayTimer)
  ) {
    return false;
  }
  popupBusyOverlayDepth += 1;
  if (typeof message === "string" && message.trim()) {
    popupBusyOverlayMessage = message.trim();
  }
  if (popupBusyOverlayVisible) {
    uiModule.setUiBusy(true, popupBusyOverlayMessage);
    return;
  }
  if (delayMs > 0) {
    if (popupBusyOverlayTimer) {
      return;
    }
    popupBusyOverlayTimer = window.setTimeout(() => {
      popupBusyOverlayTimer = 0;
      if (popupBusyOverlayDepth <= 0 || popupBusyOverlayVisible) {
        return;
      }
      popupBusyOverlayVisible = true;
      uiModule.setUiBusy(true, popupBusyOverlayMessage);
    }, delayMs);
    return true;
  }
  if (popupBusyOverlayTimer) {
    window.clearTimeout(popupBusyOverlayTimer);
    popupBusyOverlayTimer = 0;
  }
  popupBusyOverlayVisible = true;
  uiModule.setUiBusy(true, popupBusyOverlayMessage);
  return true;
}

function endPopupBusyOverlay(started = true) {
  if (!started) {
    return;
  }
  popupBusyOverlayDepth = Math.max(0, popupBusyOverlayDepth - 1);
  if (popupBusyOverlayDepth > 0) {
    return;
  }
  if (popupBusyOverlayTimer) {
    window.clearTimeout(popupBusyOverlayTimer);
    popupBusyOverlayTimer = 0;
  }
  if (!popupBusyOverlayVisible) {
    return;
  }
  popupBusyOverlayVisible = false;
  uiModule.setUiBusy(false);
}

async function runWithPopupBusyOverlay(message, task, options = {}) {
  const started = beginPopupBusyOverlay(message, options);
  try {
    return await task();
  } finally {
    endPopupBusyOverlay(started);
  }
}

function isValidEmail(value) {
  return EMAIL_REGEX.test(value);
}

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

function resolveRelativeEndpoint(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch (error) {
    return "";
  }
}

function getEndpointOrigin(value) {
  if (typeof value !== "string") {
    return "";
  }
  try {
    return new URL(value).origin.toLowerCase();
  } catch (error) {
    return "";
  }
}

function normalizeThemeValue(value) {
  if (typeof value !== "string") {
    return THEME_DEFAULT;
  }
  const normalized = value.trim().toLowerCase();
  return THEME_IDS.has(normalized) ? normalized : THEME_DEFAULT;
}

function normalizeThemeModeValue(value) {
  if (value === THEME_MODE_LIGHT || value === THEME_MODE_DARK || value === THEME_MODE_SYSTEM) {
    return value;
  }
  return THEME_MODE_DEFAULT;
}

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

async function loadThemeSettings() {
  const stored = await utils.storageGet(chrome.storage.sync, [
    GLOBAL_THEME_KEY,
    GLOBAL_THEME_MODE_KEY
  ]);
  return {
    themeValue: normalizeThemeValue(stored && stored[GLOBAL_THEME_KEY]),
    themeModeValue: normalizeThemeModeValue(stored && stored[GLOBAL_THEME_MODE_KEY])
  };
}

async function persistThemeSettings(themeValue, themeModeValue) {
  await utils.storageSet(chrome.storage.sync, {
    [GLOBAL_THEME_KEY]: normalizeThemeValue(themeValue),
    [GLOBAL_THEME_MODE_KEY]: normalizeThemeModeValue(themeModeValue)
  });
}

async function ensureThemeSettings() {
  const { themeValue, themeModeValue } = await loadThemeSettings();
  state.currentTheme = themeValue;
  state.currentThemeMode = themeModeValue;
  applyPopupTheme(themeValue, themeModeValue);
  await persistThemeSettings(themeValue, themeModeValue);
}

function buildLoginEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/login`;
}

function buildValidateEndpointFromStageBase(stageBase) {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://accounts.${normalized}/api/account/validate`;
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
  } catch (error) {
    // Use HTTPS default.
  }
  let parsed = null;
  try {
    parsed = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(`${protocol}//${raw.replace(/^\/+/, "")}`);
  } catch (error) {
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

function buildPageMarkingKey(url, pageType) {
  const normalizedUrl = normalizeCandidatePageUrl(url);
  const normalizedPageType = normalizePageTypeKey(pageType);
  if (!normalizedUrl || !normalizedPageType) {
    return "";
  }
  return `${normalizedPageType}|${normalizedUrl}`;
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

function resetPropertyPageTypesState() {
  state.propertyPageTypes = [];
  state.propertyPageTypesDuplicateUrls = [];
  state.propertyPageTypesSiteId = null;
  state.propertyPageTypesStageBase = "";
  state.propertyPageTypesSignature = "";
  state.propertyPageTypesFetchedAt = 0;
  state.propertyPageTypesLastError = "";
}

function clearPropertyPageTypesRefreshTimer() {
  if (state.propertyPageTypesRefreshTimer) {
    window.clearInterval(state.propertyPageTypesRefreshTimer);
    state.propertyPageTypesRefreshTimer = 0;
  }
  state.propertyPageTypesRefreshKey = "";
}

async function fetchPropertyPageTypesFromGraphql(options = {}) {
  const {
    siteId = null,
    stageBase = "",
    tokenValue = ""
  } = options;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!normalizedSiteId || !graphqlEndpoint) {
    return { ok: false, pageTypes: [], duplicateUrls: [], error: "" };
  }
  const headers = { "Content-Type": "application/json" };
  if (tokenValue) {
    headers.Authorization = `Bearer ${tokenValue}`;
  }
  const response = await fetch(graphqlEndpoint, {
    method: "POST",
    headers,
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
  } catch (error) {
    payload = null;
  }
  if (!response.ok) {
    return { ok: false, pageTypes: [], duplicateUrls: [], error: PopupText.pageTypes.refreshFailed };
  }
  if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
    return {
      ok: false,
      pageTypes: [],
      duplicateUrls: [],
      error:
        payload.errors[0] && typeof payload.errors[0].message === "string"
          ? payload.errors[0].message
          : PopupText.pageTypes.refreshFailed
    };
  }
  const rawPageTypes = payload && payload.data
    ? payload.data.propertyPageTypes
    : null;
  const normalized = normalizePropertyPageTypes(rawPageTypes);
  return {
    ok: true,
    pageTypes: normalized.pageTypes,
    duplicateUrls: normalized.duplicateUrls,
    signature: buildPropertyPageTypesSignature(normalized.pageTypes)
  };
}

async function ensurePropertyPageTypes(options = {}) {
  const {
    siteId = null,
    stageBase = "",
    tokenValue = "",
    force = false,
    notifyOnChange = false
  } = options;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  const normalizedStageBase = normalizeStageBase(stageBase);
  if (!normalizedSiteId || !normalizedStageBase || !tokenValue) {
    resetPropertyPageTypesState();
    return { ok: false, skipped: true, pageTypes: [], duplicateUrls: [], changed: false };
  }
  const cacheKey = `${normalizedStageBase}|${normalizedSiteId}`;
  const cacheFresh =
    !force &&
    state.propertyPageTypesSiteId === normalizedSiteId &&
    state.propertyPageTypesStageBase === normalizedStageBase &&
    state.propertyPageTypesFetchedAt > 0 &&
    Date.now() - state.propertyPageTypesFetchedAt < PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS &&
    !state.propertyPageTypesLastError;
  if (cacheFresh) {
    return {
      ok: true,
      pageTypes: state.propertyPageTypes,
      duplicateUrls: state.propertyPageTypesDuplicateUrls,
      changed: false,
      fromCache: true
    };
  }
  if (propertyPageTypesRequest && propertyPageTypesRequest.key === cacheKey) {
    return propertyPageTypesRequest.promise;
  }
  const request = fetchPropertyPageTypesFromGraphql({
    siteId: normalizedSiteId,
    stageBase: normalizedStageBase,
    tokenValue
  }).then((result) => {
    if (!result.ok) {
      state.propertyPageTypesLastError = result.error || PopupText.pageTypes.refreshFailed;
      if (
        state.propertyPageTypesSiteId === normalizedSiteId &&
        state.propertyPageTypesStageBase === normalizedStageBase &&
        Array.isArray(state.propertyPageTypes)
      ) {
        return {
          ok: true,
          pageTypes: state.propertyPageTypes,
          duplicateUrls: state.propertyPageTypesDuplicateUrls,
          changed: false,
          stale: true,
          error: state.propertyPageTypesLastError
        };
      }
      return {
        ok: false,
        pageTypes: [],
        duplicateUrls: [],
        changed: false,
        error: state.propertyPageTypesLastError
      };
    }
    const previousSignature = state.propertyPageTypesSignature;
    const nextSignature = result.signature || "";
    const changed = Boolean(previousSignature) && previousSignature !== nextSignature;
    state.propertyPageTypes = result.pageTypes;
    state.propertyPageTypesDuplicateUrls = result.duplicateUrls;
    state.propertyPageTypesSiteId = normalizedSiteId;
    state.propertyPageTypesStageBase = normalizedStageBase;
    state.propertyPageTypesSignature = nextSignature;
    state.propertyPageTypesFetchedAt = Date.now();
    state.propertyPageTypesLastError = "";
    if (changed && notifyOnChange) {
      uiModule.showToast(PopupText.pageTypes.updatedToast);
    }
    return {
      ok: true,
      pageTypes: state.propertyPageTypes,
      duplicateUrls: state.propertyPageTypesDuplicateUrls,
      changed,
      stale: false
    };
  }).finally(() => {
    if (propertyPageTypesRequest && propertyPageTypesRequest.key === cacheKey) {
      propertyPageTypesRequest = null;
    }
  });
  propertyPageTypesRequest = {
    key: cacheKey,
    promise: request
  };
  return request;
}

function schedulePropertyPageTypesRefresh(options = {}) {
  const {
    siteId = null,
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
  state.propertyPageTypesRefreshTimer = window.setInterval(() => {
    helpers.loadGlobalAiSettings().then(({ tokenValue: nextTokenValue, stageBaseValue }) => {
      return ensurePropertyPageTypes({
        siteId: normalizedSiteId,
        stageBase: stageBaseValue || normalizedStageBase,
        tokenValue: nextTokenValue || "",
        force: true,
        notifyOnChange: true
      });
    }).then(() => {
      refreshUi().then();
    }).catch(() => {
      uiModule.showToast(PopupText.pageTypes.refreshFailed);
    });
  }, PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS);
}

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

async function resolveSiteIdFromGraphql(options = {}) {
  const {
    stageBase = "",
    lookupUrl = "",
    tokenValue = ""
  } = options;
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!graphqlEndpoint || !lookupUrl) {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
  const headers = { "Content-Type": "application/json" };
  if (tokenValue) {
    headers.Authorization = `Bearer ${tokenValue}`;
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: URL_SEARCH_INFO_QUERY,
        variables: {
          url: lookupUrl,
          includePageInfo: false
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    const hasPayload = Boolean(data && typeof data === "object");
    if (hasPayload && Array.isArray(data.errors) && data.errors.length > 0) {
      const notFound = data.errors.some((item) => {
        const code =
          item &&
          item.extensions &&
          typeof item.extensions.code === "string"
            ? item.extensions.code
            : "";
        return code === "NotFound";
      });
      if (notFound) {
        return {
          ok: true,
          siteId: null,
          baseUrl: "",
          notFound: true
        };
      }
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    if (!response.ok) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    if (!hasPayload) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    const candidate = normalizeSiteIdValue(
      data &&
        data.data &&
        data.data.urlSearchInfo &&
        data.data.urlSearchInfo.domainId
    );
    const baseUrl = normalizeBaseUrlFromDomainName(
      data &&
        data.data &&
        data.data.urlSearchInfo &&
        data.data.urlSearchInfo.domainName,
      lookupUrl
    );
    if (!candidate) {
      return {
        ok: true,
        siteId: null,
        baseUrl,
        notFound: true
      };
    }
    if (!baseUrl) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    return {
      ok: true,
      siteId: candidate,
      baseUrl,
      notFound: false
    };
  } catch (error) {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
}

function mergeSelectorSetForBaseUrlMigration(
  preferredSelectorSet,
  preferredUpdatedAt,
  existingSelectorSet,
  existingUpdatedAt
) {
  return config.mergeSelectorSetsByTimestamp(
    existingSelectorSet,
    existingUpdatedAt,
    preferredSelectorSet,
    preferredUpdatedAt
  );
}

function getSelectorSetFingerprint(selectorSet) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  return combineAiSelectorSet(normalized).length ? JSON.stringify(normalized) : "";
}

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

function buildGraphqlRenderModeValue(renderMode) {
  return config.normalizeRenderMode(renderMode) === config.RENDER_MODE_RENDERED
    ? "RENDERED"
    : "STATIC";
}

function isUndeterminedRenderMode(value) {
  return typeof value === "string" && value.trim().toLowerCase() === RENDER_MODE_UNDETERMINED;
}

function normalizeUiRenderModeValue(value, fallback = config.DEFAULT_RENDER_MODE) {
  if (isUndeterminedRenderMode(value)) {
    return RENDER_MODE_UNDETERMINED;
  }
  return config.normalizeRenderMode(typeof value === "string" ? value : fallback);
}

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

function isRenderModeDetectionLowConfidence(accuracy) {
  return Number.isFinite(accuracy) &&
    accuracy >= RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY &&
    accuracy < RENDER_MODE_DETECTION_REVIEW_ACCURACY;
}

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

function getSuggestedRenderModeForPage(pageUrl, sourceConfig = state.currentConfig) {
  const suggestionKey = `${state.currentBaseUrl || ""}|${pageUrl || ""}`;
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

function shouldAutoDetectRenderMode(sourceConfig) {
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

async function maybeAutoDetectRenderMode(pageUrl) {
  if (
    !pageUrl ||
    !state.currentBaseUrl ||
    !state.currentConfig ||
    !shouldAutoDetectRenderMode(state.currentConfig)
  ) {
    const fallbackRenderMode = config.getConfigRenderMode(state.currentConfig);
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = fallbackRenderMode;
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    return fallbackRenderMode;
  }

  const detectionKey = `${state.currentBaseUrl}|${pageUrl}`;
  if (state.renderModeDetectionInFlight && state.renderModeDetectionKey === detectionKey) {
    return getSuggestedRenderModeForPage(pageUrl);
  }
  if (!state.renderModeDetectionInFlight && state.renderModeDetectionKey === detectionKey) {
    return getSuggestedRenderModeForPage(pageUrl);
  }

  state.renderModeDetectionInFlight = true;
  state.renderModeDetectionKey = detectionKey;
  state.renderModeSuggestedKey = detectionKey;
  state.renderModeDetectionUnsure = false;
  state.renderModeDetectionAccuracy = Number.NaN;
  state.renderModeUndeterminedNoticeKey = "";
  try {
    const { tokenValue, endpointValue } = await helpers.loadGlobalAiSettings();
    const renderedSnapshot = await messages.sendTabMessage({
      type: "collectPageData",
      baseUrl: state.currentBaseUrl
    });
    if (
      !renderedSnapshot ||
      typeof renderedSnapshot.renderedHtml !== "string" ||
      !renderedSnapshot.renderedHtml
    ) {
      markRenderModeUndetermined(detectionKey);
      return RENDER_MODE_UNDETERMINED;
    }

    const staticResponse = await messages.sendRuntimeMessage({
      type: "fetchStaticPageHtml",
      url: pageUrl
    });
    if (!staticResponse || !staticResponse.ok || typeof staticResponse.html !== "string") {
      markRenderModeUndetermined(detectionKey);
      return RENDER_MODE_UNDETERMINED;
    }

    const detectionResult = await runWithPopupBusyOverlay(
      PopupText.overlay.detectingRenderMode,
      () => detectRenderModeViaEndpoint({
        endpointValue,
        tokenValue,
        rawHtml: staticResponse.html,
        renderedHtml: renderedSnapshot.renderedHtml
      }),
      { delayMs: 0 }
    );
    if (!detectionResult.ok) {
      markRenderModeUndetermined(detectionKey);
      return RENDER_MODE_UNDETERMINED;
    }
    if (detectionResult.result === "unsure") {
      markRenderModeUndetermined(detectionKey);
      return RENDER_MODE_UNDETERMINED;
    }
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = detectionResult.accuracy;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeSuggestedValue = config.normalizeRenderMode(detectionResult.result);
    return state.renderModeSuggestedValue;
  } catch {
    markRenderModeUndetermined(detectionKey);
    return RENDER_MODE_UNDETERMINED;
  } finally {
    state.renderModeDetectionInFlight = false;
  }
}

function mergeConfigEntriesForResolvedBaseUrl(resolvedBaseUrl, preferredEntry, existingEntry) {
  const preferred = config.normalizeConfig(resolvedBaseUrl, preferredEntry).config;
  const existing = config.normalizeConfig(resolvedBaseUrl, existingEntry).config;
  const mergedPageMarkings = config.mergePageMarkingsByTimestamp(
    existing.pageMarkings,
    preferred.pageMarkings
  ).pageMarkings;
  const selectors = config.mergeConfigSelectorStateByTimestamp(
    existing.selectors,
    existing.selectorsUpdatedAt,
    existing.submittedSelectorsFingerprint,
    preferred.selectors,
    preferred.selectorsUpdatedAt,
    preferred.submittedSelectorsFingerprint
  );
  const renderMode = config.mergeRenderModeByTimestamp(
    preferred.renderMode,
    preferred.renderModeUpdatedAt,
    existing.renderMode,
    existing.renderModeUpdatedAt
  );
  const merged = {
    ...existing,
    ...preferred,
    siteId:
      normalizeSiteIdValue(preferred.siteId) ||
      normalizeSiteIdValue(existing.siteId) ||
      null,
    renderMode: renderMode.renderMode,
    renderModeUpdatedAt: renderMode.updatedAt,
    pageMarkings: mergedPageMarkings,
    selectors: selectors.selectorSet,
    selectorsUpdatedAt: selectors.updatedAt,
    submittedSelectorsFingerprint: selectors.submittedFingerprint
  };
  return config.normalizeConfig(resolvedBaseUrl, merged).config;
}

async function ensureBaseUrlSiteId(options = {}) {
  const {
    baseUrl = "",
    stageBase = "",
    tokenValue = "",
    configs = null,
    pageUrl = "",
    persist = true
  } = options;
  const shouldPersist = persist !== false;
  const requestedBaseUrl =
    utils.normalizeCanonicalBaseUrl(baseUrl) ||
    utils.normalizeBaseUrl(baseUrl) ||
    (typeof baseUrl === "string" ? baseUrl : "");
  if (!requestedBaseUrl) {
    return {
      ok: false,
      siteId: null,
      baseUrl: "",
      reason: ViewText.noMappedBaseUrlOrSiteId
    };
  }
  const sourceConfigs = configs || await config.getConfigs();
  const normalizedConfig = config.normalizeConfig(
    requestedBaseUrl,
    sourceConfigs[requestedBaseUrl]
  );
  if (!sourceConfigs[requestedBaseUrl] || normalizedConfig.changed) {
    sourceConfigs[requestedBaseUrl] = normalizedConfig.config;
    if (shouldPersist) {
      await config.saveConfigs(sourceConfigs);
    }
  }
  const existingSiteId = normalizeSiteIdValue(sourceConfigs[requestedBaseUrl].siteId);
  if (existingSiteId) {
    state.siteIdLookupByBaseUrl.set(requestedBaseUrl, existingSiteId);
    return {
      ok: true,
      siteId: existingSiteId,
      baseUrl: requestedBaseUrl,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  const normalizedStageBase = normalizeStageBase(stageBase);
  if (!normalizedStageBase) {
    return {
      ok: false,
      siteId: null,
      baseUrl: requestedBaseUrl,
      reason: PopupText.configuration.stageBaseRequiredBeforeContinuing,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  if (state.siteIdLookupByBaseUrl.has(requestedBaseUrl)) {
    const cached = normalizeSiteIdValue(state.siteIdLookupByBaseUrl.get(requestedBaseUrl));
    if (cached) {
      if (shouldPersist) {
        sourceConfigs[requestedBaseUrl] = await config.updateConfig(requestedBaseUrl, (target) => {
          target.siteId = cached;
        });
      } else {
        const normalizedCached = config.normalizeConfig(
          requestedBaseUrl,
          sourceConfigs[requestedBaseUrl]
        ).config;
        normalizedCached.siteId = cached;
        sourceConfigs[requestedBaseUrl] = normalizedCached;
      }
      return {
        ok: true,
        siteId: cached,
        baseUrl: requestedBaseUrl,
        configs: sourceConfigs,
        config: sourceConfigs[requestedBaseUrl]
      };
    }
    // Cached null values should not permanently block retries.
    state.siteIdLookupByBaseUrl.delete(requestedBaseUrl);
  }
  // Query with the current page URL if provided (for language-specific sites),
  // otherwise use the requested base URL
  const queryUrl = pageUrl && typeof pageUrl === "string" ? pageUrl : requestedBaseUrl;
  const lookupResult = await resolveSiteIdFromGraphql({
    stageBase: normalizedStageBase,
    lookupUrl: queryUrl,
    tokenValue
  });
  if (!lookupResult.ok) {
    return {
      ok: false,
      siteId: null,
      baseUrl: requestedBaseUrl,
      reason: PopupText.status.unableToResolveDomainId,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  const resolvedBaseUrl =
    utils.normalizeCanonicalBaseUrl(lookupResult.baseUrl) ||
    utils.normalizeBaseUrl(lookupResult.baseUrl) ||
    requestedBaseUrl;
  const resolvedSiteId = normalizeSiteIdValue(lookupResult.siteId);
  if (!resolvedSiteId) {
    return {
      ok: false,
      siteId: null,
      baseUrl: resolvedBaseUrl,
      reason: ViewText.noDomainIdForBaseUrl,
      configs: sourceConfigs,
      config: sourceConfigs[requestedBaseUrl]
    };
  }
  state.siteIdLookupByBaseUrl.set(resolvedBaseUrl, resolvedSiteId);
  if (requestedBaseUrl !== resolvedBaseUrl) {
    state.siteIdLookupByBaseUrl.delete(requestedBaseUrl);
  }
  let didChangeConfigs = false;
  if (requestedBaseUrl !== resolvedBaseUrl) {
    const mergedConfig = mergeConfigEntriesForResolvedBaseUrl(
      resolvedBaseUrl,
      sourceConfigs[requestedBaseUrl],
      sourceConfigs[resolvedBaseUrl]
    );
    sourceConfigs[resolvedBaseUrl] = mergedConfig;
    if (Object.prototype.hasOwnProperty.call(sourceConfigs, requestedBaseUrl)) {
      delete sourceConfigs[requestedBaseUrl];
    }
    didChangeConfigs = true;
  } else {
    const normalizedCurrent = config.normalizeConfig(
      resolvedBaseUrl,
      sourceConfigs[resolvedBaseUrl]
    );
    if (
      !sourceConfigs[resolvedBaseUrl] ||
      normalizedCurrent.changed ||
      normalizeSiteIdValue(normalizedCurrent.config.siteId) !== resolvedSiteId
    ) {
      sourceConfigs[resolvedBaseUrl] = normalizedCurrent.config;
      didChangeConfigs = true;
    }
  }
  const resolvedConfig = config.normalizeConfig(
    resolvedBaseUrl,
    sourceConfigs[resolvedBaseUrl]
  ).config;
  if (normalizeSiteIdValue(resolvedConfig.siteId) !== resolvedSiteId) {
    resolvedConfig.siteId = resolvedSiteId;
    sourceConfigs[resolvedBaseUrl] = resolvedConfig;
    didChangeConfigs = true;
  }
  if (shouldPersist && didChangeConfigs) {
    await config.saveConfigs(sourceConfigs);
  }
  return {
    ok: true,
    siteId: resolvedSiteId,
    baseUrl: resolvedBaseUrl,
    configs: sourceConfigs,
    config: sourceConfigs[resolvedBaseUrl]
  };
}

function createConfigSyncHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function getStoredGlobalToken(options = {}) {
  const { trim = false } = options;
  const stored = await utils.storageGet(chrome.storage.sync, "globalToken");
  const token = stored && typeof stored.globalToken === "string" ? stored.globalToken : "";
  return trim ? token.trim() : token;
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

async function syncAiComputeLock(active, expiresAt = 0) {
  const response = await messages.sendTabMessage({
    type: "setAiComputeLock",
    active: Boolean(active),
    expiresAt
  });
  return Boolean(response && response.ok);
}

async function refreshAiRunHeartbeat(options = {}) {
  const sessionId = typeof options.sessionId === "string"
    ? options.sessionId.trim()
    : state.aiRunSessionId;
  const siteId = normalizeSiteIdValue(options.siteId || state.aiRunSiteId);
  const deadlineAt = Number.isFinite(options.deadlineAt)
    ? options.deadlineAt
    : state.aiRunDeadlineAt;
  if (!sessionId || !siteId || !Number.isFinite(deadlineAt) || deadlineAt <= 0) {
    return null;
  }
  const expiresAt = getAiRunResumeExpiresAt();
  state.aiRunResumeExpiresAt = expiresAt;
  await savePersistedAiRunRecord({
    sessionId,
    siteId,
    expiresAt,
    deadlineAt
  });
  const lockApplied = await syncAiComputeLock(true, expiresAt);
  if (!lockApplied) {
    await clearPersistedAiRunRecord();
    return null;
  }
  return expiresAt;
}

async function stopAiRun(options = {}) {
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
    endpointValue = "",
    tokenValue = "",
    siteId = null,
    url = ""
  } = options;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  const pageUrl = typeof url === "string" ? url.trim() : "";
  const removeUrl = resolveRelativeEndpoint(endpointValue, "/remove");
  if (!removeUrl || !normalizedSiteId || !pageUrl) {
    return { ok: false, skipped: true };
  }
  const response = await fetch(removeUrl, {
    method: "POST",
    headers: createConfigSyncHeaders(tokenValue),
    body: JSON.stringify({
      siteId: normalizedSiteId,
      url: pageUrl
    })
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  return { ok: response.ok };
}

async function pruneRemoteInvalidPageMarkings(options = {}) {
  const {
    endpointValue = "",
    tokenValue = "",
    siteId = null,
    invalidUrls = []
  } = options;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  if (!endpointValue || !normalizedSiteId || !Array.isArray(invalidUrls) || !invalidUrls.length) {
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
        endpointValue,
        tokenValue,
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
    baseUrl = "",
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
  const sourceConfig = configs[normalizedBaseUrl];
  if (!sourceConfig || !sourceConfig.pageMarkings || typeof sourceConfig.pageMarkings !== "object") {
    return [];
  }
  const nextConfig = config.normalizeConfig(normalizedBaseUrl, sourceConfig).config;
  const removedUrls = [];
  Object.keys(nextConfig.pageMarkings || {}).forEach((url) => {
    const normalizedUrl = normalizeCandidatePageUrl(url);
    if (exactInvalidUrls.has(url) || (normalizedUrl && normalizedInvalidUrls.has(normalizedUrl))) {
      delete nextConfig.pageMarkings[url];
      removedUrls.push(url);
    }
  });
  if (removedUrls.length) {
    configs[normalizedBaseUrl] = nextConfig;
    await config.saveConfigs(configs);
  }
  return removedUrls;
}

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
    default:
      return "muted";
  }
}

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

function updateLastConfigSaveStatus(label) {
  const safeLabel = typeof label === "string" && label ? label : PopupText.sync.unknown;
  state.lastConfigSaveStatusTone = getConfigSaveStatusTone(safeLabel);
  const at = formatSyncStatusTimestamp();
  state.lastConfigSaveStatusText = formatTimestampedStatus(safeLabel, at);
}

function isSuccessfulConfigSyncResult(syncResult) {
  return Boolean(syncResult && (syncResult.ok || syncResult.skipped));
}

function isCompletedPageConfigSyncResult(syncResult) {
  return Boolean(syncResult && syncResult.ok && !syncResult.skipped);
}

function getCurrentPageUrl() {
  return (state.currentTab && state.currentTab.url) || "";
}

async function setCurrentPageSaveReconciliationReason(reason) {
  const pageUrl = getCurrentPageUrl();
  if (!state.currentBaseUrl || !pageUrl) {
    return null;
  }
  const reconciliation = await config.setPageSaveReconciliation(state.currentBaseUrl, pageUrl, {
    reason: typeof reason === "string" ? reason : "pending"
  });
  state.currentPageSaveReconciliation = reconciliation;
  state.currentPageSaveReconciliationPending = Boolean(reconciliation);
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

function waitForRetryDelay(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function isRetryableHttpStatus(status) {
  if (!Number.isFinite(status) || status <= 0) {
    return true;
  }
  return RETRYABLE_HTTP_STATUSES.has(status);
}

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

function setRemoteConfigConnectionIssue(active) {
  const nextActive = Boolean(active);
  state.remoteConfigConnectionIssue = nextActive;
  if (!nextActive) {
    clearRemoteConfigRetryTimer();
  }
}

function setPreviewBlocked(active, message = ViewText.previewBlockedDefault) {
  uiModule.setPreviewBlocked(active, message);
}

function scheduleRemoteConfigRetry() {
  if (state.remoteConfigConnectionRetryTimer) {
    return;
  }
  state.remoteConfigConnectionRetryTimer = window.setTimeout(async () => {
    state.remoteConfigConnectionRetryTimer = 0;
    await helpers.ensureActiveTab();
    await refreshUi();
  }, REMOTE_CONFIG_RETRY_DELAY_MS);
}

function normalizeRenderModeDetectionResult(payload) {
  if (!payload || typeof payload !== "object") {
    return { result: "", accuracy: Number.NaN };
  }
  const accuracy = Number(payload.accuracy);
  if (!Number.isFinite(accuracy)) {
    return { result: "", accuracy: Number.NaN };
  }
  if (accuracy < RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY) {
    return { result: "unsure", accuracy };
  }
  if (typeof payload.rendered !== "boolean") {
    return { result: "", accuracy };
  }
  return {
    result: payload.rendered ? "rendered" : "static",
    accuracy
  };
}

async function detectRenderModeViaEndpoint(options = {}) {
  const {
    endpointValue = "",
    tokenValue = "",
    rawHtml = "",
    renderedHtml = ""
  } = options;
  if (!endpointValue || !rawHtml || !renderedHtml) {
    return { ok: false, result: "", accuracy: Number.NaN };
  }
  const detectUrl = resolveRelativeEndpoint(endpointValue, "/is_js_rendered");
  if (!detectUrl) {
    return { ok: false, result: "", accuracy: Number.NaN };
  }
  for (let attempt = 0; attempt < RENDER_MODE_DETECTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(detectUrl, {
        method: "POST",
        headers: createConfigSyncHeaders(tokenValue),
        body: JSON.stringify({
          rawHtml,
          renderedHtml
        })
      });
      await maybeUpdateStoredTokenFromResponse(response, tokenValue);
      if (!response.ok) {
        if (
          attempt + 1 < RENDER_MODE_DETECTION_MAX_ATTEMPTS &&
          isRetryableHttpStatus(response.status)
        ) {
          await waitForRetryDelay(getRetryDelayMs(attempt, 350, 1800));
          continue;
        }
        return { ok: false, result: "", accuracy: Number.NaN };
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }
      const normalizedResult = normalizeRenderModeDetectionResult(payload);
      if (!normalizedResult.result) {
        return { ok: false, result: "", accuracy: Number.NaN };
      }
      return { ok: true, ...normalizedResult };
    } catch (error) {
      if (attempt + 1 < RENDER_MODE_DETECTION_MAX_ATTEMPTS) {
        await waitForRetryDelay(getRetryDelayMs(attempt, 350, 1800));
        continue;
      }
      return { ok: false, result: "", accuracy: Number.NaN };
    }
  }
  return { ok: false, result: "", accuracy: Number.NaN };
}

function buildRemoteConfigLoadKey(tabId, siteId, endpointValue) {
  return `${tabId || ""}|${siteId || ""}|${endpointValue || ""}`;
}

function mergeSelectorsIntoConfig(targetConfig, incomingConfig) {
  if (!targetConfig || typeof targetConfig !== "object") {
    return false;
  }
  const merged = config.mergeConfigSelectorStateByTimestamp(
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
  const currentUpdatedAt = config.normalizeEntryTimestamp(targetConfig.selectorsUpdatedAt);
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

async function mergeServerConfigIntoLocal(payload, currentPageUrl) {
  const invalidLoadedUrls = config.collectInvalidPageMarkingUrls(
    payload && typeof payload === "object" ? payload.pageMarkings : null
  );
  const normalizedPayload = config.normalizeConfigSyncPayload(payload, "");
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
  const allConfigs = await config.getConfigs();
  const existingRaw = allConfigs[baseUrl];
  const normalizedLocal = config.normalizeConfig(baseUrl, existingRaw);
  const localConfig = normalizedLocal.config;
  const incomingSiteId = normalizeSiteIdValue(normalizedPayload.siteId);
  const siteIdChanged =
    Boolean(incomingSiteId) && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId;
  if (incomingSiteId && normalizeSiteIdValue(localConfig.siteId) !== incomingSiteId) {
    localConfig.siteId = incomingSiteId;
  }
  const mergedRenderMode = config.mergeRenderModeByTimestamp(
    localConfig.renderMode,
    localConfig.renderModeUpdatedAt,
    normalizedPayload.renderMode,
    normalizedPayload.renderModeUpdatedAt
  );
  const renderModeChanged =
    config.getConfigRenderMode(localConfig) !== mergedRenderMode.renderMode ||
    config.normalizeEntryTimestamp(localConfig.renderModeUpdatedAt) !== mergedRenderMode.updatedAt;
  if (renderModeChanged) {
    localConfig.renderMode = mergedRenderMode.renderMode;
    localConfig.renderModeUpdatedAt = mergedRenderMode.updatedAt;
  }
  const mergeResult = config.mergePageMarkingsByTimestamp(
    localConfig.pageMarkings,
    normalizedPayload.pageMarkings
  );
  localConfig.pageMarkings = mergeResult.pageMarkings;
  const selectorStateChanged = mergeSelectorsIntoConfig(localConfig, normalizedPayload);
  const shouldSave =
    !existingRaw ||
    normalizedLocal.changed ||
    siteIdChanged ||
    renderModeChanged ||
    selectorStateChanged ||
    mergeResult.replacedUrls.length > 0;
  if (shouldSave) {
    allConfigs[baseUrl] = localConfig;
    await config.saveConfigs(allConfigs);
  }
  const prunedInvalidUrls = await pruneLocalInvalidPageMarkings({
    baseUrl,
    invalidUrls: invalidLoadedUrls
  });
  return {
    ok: true,
    changed: shouldSave || prunedInvalidUrls.length > 0,
    replacedCurrentPage: mergeResult.replacedExistingUrls.includes(currentPageUrl),
    baseUrl,
    invalidLoadedUrls
  };
}

async function loadRemoteConfigForCurrentPage(options = {}) {
  const {
    tabId = null,
    pageUrl = "",
    siteId = null,
    endpointValue = "",
    tokenValue = "",
    force = false
  } = options;
  if (!tabId || !siteId || !endpointValue || !tokenValue) {
    const result = { status: "skipped", baseUrl: "" };
    state.remoteConfigLoadResult = result;
    updateLastConfigLoadStatus(result);
    return result;
  }
  const loadKey = buildRemoteConfigLoadKey(tabId, siteId, endpointValue);
  if (
    !force &&
    state.remoteConfigLoadKey === loadKey &&
    state.remoteConfigLoadResult &&
    (
      state.remoteConfigLoadResult.status === "ok" ||
      state.remoteConfigLoadResult.status === "not_found"
    )
  ) {
    return state.remoteConfigLoadResult;
  }
  state.remoteConfigLoadKey = loadKey;
  const loadUrl = resolveRelativeEndpoint(endpointValue, "/load");
  if (!loadUrl) {
    const result = { status: "error", baseUrl: "" };
    state.remoteConfigLoadResult = result;
    updateLastConfigLoadStatus(result);
    return result;
  }
  try {
    const response = await fetch(loadUrl, {
      method: "POST",
      headers: createConfigSyncHeaders(tokenValue),
      body: JSON.stringify({ siteId })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (response.status === 401 || response.status === 403) {
      await invalidateTokenAndLockConfiguration(true);
      const result = { status: "auth_error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    if (response.status === 404) {
      const result = { status: "not_found", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    if (!response.ok) {
      const result = { status: "error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    const payload = await response.json();
    const mergeResult = await mergeServerConfigIntoLocal(payload, pageUrl);
    if (!mergeResult.ok) {
      const result = { status: "not_found", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    await pruneRemoteInvalidPageMarkings({
      endpointValue,
      tokenValue,
      siteId,
      invalidUrls: mergeResult.invalidLoadedUrls || []
    });
    if (mergeResult.changed && mergeResult.baseUrl) {
      await messages.sendTabMessageWithRetry({
        type: "configUpdated",
        baseUrl: mergeResult.baseUrl,
        forceReloadPageEntry: mergeResult.replacedCurrentPage
      }, 2);
    }
    if (mergeResult.replacedCurrentPage) {
      window.alert(PopupText.alerts.newerRemoteDataReplacedLocal);
    }
    const result = {
      status: "ok",
      baseUrl: mergeResult.baseUrl
    };
    state.remoteConfigLoadResult = result;
    updateLastConfigLoadStatus(result);
    return result;
  } catch {
    const result = { status: "error", baseUrl: "" };
    state.remoteConfigLoadResult = result;
    updateLastConfigLoadStatus(result);
    return result;
  }
}

async function syncBaseConfigToServer(options = {}) {
  const {
    baseUrl = "",
    pageUrl = "",
    endpointValue = "",
    tokenValue = "",
    stageBase = "",
    alertOnCurrentReplacement = true,
    maxAttempts = 5
  } = options;
  if (!baseUrl || !pageUrl || !endpointValue) {
    return { ok: false, skipped: true };
  }
  const saveUrl = resolveRelativeEndpoint(endpointValue, "/save");
  if (!saveUrl) {
    return { ok: false, skipped: true };
  }
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let retryDelayMs = 1500;
  let lastStatus = 0;
  let currentTokenValue = tokenValue || "";
  let currentBaseUrl = baseUrl;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const allConfigs = await config.getConfigs();
    const siteIdResult = await ensureBaseUrlSiteId({
      baseUrl: currentBaseUrl,
      pageUrl,
      stageBase,
      tokenValue: currentTokenValue,
      configs: allConfigs
    });
    if (!siteIdResult.ok || !siteIdResult.siteId) {
      return { ok: false, skipped: true, reason: siteIdResult.reason || PopupText.status.missingSiteId };
    }
    const resolvedBaseUrl = siteIdResult.baseUrl || baseUrl;
    currentBaseUrl = resolvedBaseUrl;
    const workingConfigs = siteIdResult.configs || allConfigs;
    try {
      const refreshedToken = await getStoredGlobalToken({ trim: true });
      if (refreshedToken) {
        currentTokenValue = refreshedToken;
      }
    } catch {
      // Ignore token refresh read errors; continue with the current in-memory token.
    }
    const normalized = config.normalizeConfig(resolvedBaseUrl, workingConfigs[resolvedBaseUrl]);
    const sourceConfig = normalized.config;
    if (!workingConfigs[resolvedBaseUrl] || normalized.changed) {
      workingConfigs[resolvedBaseUrl] = sourceConfig;
      await config.saveConfigs(workingConfigs);
    }
    const propertyPageTypesResult = await ensurePropertyPageTypes({
      siteId: siteIdResult.siteId,
      stageBase,
      tokenValue: currentTokenValue,
      force: false,
      notifyOnChange: false
    });
    let filterPageMarking = null;
    if (propertyPageTypesResult && propertyPageTypesResult.ok) {
      const coverageModel = buildLynxChecklistViewModel({
        aiAnswer: "yes",
        pageTypes: propertyPageTypesResult.pageTypes,
        markedPages: collectStoredPageMarkingItems(sourceConfig.pageMarkings, resolvedBaseUrl)
      });
      const activePageMarkingKeys = new Set(
        coverageModel.activeMarkedPages
          .map((item) => buildPageMarkingKey(item.url, item.pageType))
          .filter(Boolean)
      );
      filterPageMarking = (url, entry) => activePageMarkingKeys.has(
        buildPageMarkingKey(url, entry && entry.pageType)
      );
    }
    const payload = config.createConfigSyncPayload(resolvedBaseUrl, sourceConfig, {
      filterPageMarking
    });
    try {
      const response = await fetch(saveUrl, {
        method: "POST",
        headers: createConfigSyncHeaders(currentTokenValue),
        body: JSON.stringify(payload)
      });
      currentTokenValue = await maybeUpdateStoredTokenFromResponse(
        response,
        currentTokenValue
      );
      if (!response.ok) {
        lastStatus = response.status || 0;
        if (attempt + 1 < attempts && isRetryableHttpStatus(lastStatus)) {
          await waitForRetryDelay(retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 10000);
          continue;
        }
        return { ok: false, status: lastStatus };
      }

      let responseData = null;
      try {
        responseData = await response.json();
      } catch (error) {
        responseData = null;
      }
      if (!responseData || typeof responseData !== "object") {
        return { ok: true, replacedCurrentPage: false };
      }

      const mergeResult = await mergeServerConfigIntoLocal(responseData, pageUrl);
      if (!mergeResult.ok) {
        return { ok: false };
      }
      await pruneRemoteInvalidPageMarkings({
        endpointValue,
        tokenValue: currentTokenValue,
        siteId: siteIdResult.siteId,
        invalidUrls: mergeResult.invalidLoadedUrls || []
      });
      if (mergeResult.changed && mergeResult.baseUrl) {
        await messages.sendTabMessageWithRetry({
          type: "configUpdated",
          baseUrl: mergeResult.baseUrl,
          forceReloadPageEntry: mergeResult.replacedCurrentPage
        }, 2);
      }
      if (mergeResult.replacedCurrentPage && alertOnCurrentReplacement) {
        window.alert(PopupText.alerts.newerRemoteDataReplacedLocal);
      }
      return {
        ok: true,
        replacedCurrentPage: mergeResult.replacedCurrentPage,
        baseUrl: resolvedBaseUrl
      };
    } catch (error) {
      if (attempt + 1 < attempts) {
        await waitForRetryDelay(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 10000);
        continue;
      }
      return { ok: false };
    }
  }
  return { ok: false, status: lastStatus };
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
  await utils.storageSet(chrome.storage.sync, { globalToken: "" });
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
  const { force = false, showToastOnInvalid = true } = options;
  if (state.tokenValidationInFlight) {
    return true;
  }
  const { tokenValue, stageBaseValue } = await helpers.loadGlobalAiSettings();
  const validateUrl = buildValidateEndpointFromStageBase(stageBaseValue);
  if (!tokenValue || !validateUrl) {
    return Boolean(tokenValue);
  }
  const now = Date.now();
  if (!force && now - state.lastTokenValidationAt < TOKEN_VALIDATION_INTERVAL_MS) {
    return true;
  }
  state.lastTokenValidationAt = now;
  state.tokenValidationInFlight = true;
  try {
    const response = await fetch(validateUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenValue}` }
    });
    if (response.status === 401 || response.status === 403) {
      await invalidateTokenAndLockConfiguration(showToastOnInvalid);
      return false;
    }
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    return true;
  } catch (error) {
    return true;
  } finally {
    state.tokenValidationInFlight = false;
  }
}

async function clearFocusedElement() {
  await messages.sendTabMessage({ type: "clearFocus" });
}

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
  return normalizeAiSelectorSet(sourceConfig && sourceConfig.selectors);
}

function getLastSubmittedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "selectors")) {
    return normalizeAiSelectorSet(null);
  }
  return config.areCurrentSelectorsSubmitted(sourceConfig)
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
    sourceConfig && sourceConfig.selectorsUpdatedAt
  );
  if (updatedAt === config.PAGE_TIMESTAMP_FALLBACK) {
    return false;
  }
  return combineAiSelectorSet(sourceConfig && sourceConfig.selectors).length > 0;
}

async function hideConsentForRenderModeInspection() {
  const tabId = state.currentTab && state.currentTab.id;
  if (!tabId) {
    return false;
  }
  let hideResponse = await messages.sendTabMessageWithRetry(
    { type: "hideConsentForInspection" },
    2
  );
  if (!hideResponse || !hideResponse.ok) {
    await messages.sendRuntimeMessage({ type: "activateContentForTab", tabId });
    hideResponse = await messages.sendTabMessageWithRetry(
      { type: "hideConsentForInspection" },
      3
    );
  }
  return Boolean(hideResponse && hideResponse.ok);
}

async function waitForTabLoadComplete(tabId, timeoutMs = 8000, options = {}) {
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
      window.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
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

    const timeoutId = window.setTimeout(() => {
      finish(false);
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish(false);
        return;
      }
      if (!awaitNextLoad && tab && tab.status === "complete") {
        finish(true);
      }
    });
  });
}

function buildTodoExpansionContextKey(tabId = null, baseUrl = "") {
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

async function refreshUiInner() {
  if (!state.currentTab) {
    return;
  }
  const previousBaseUrl = state.currentBaseUrl;
  await validateStoredToken({ force: false, showToastOnInvalid: true });
  const currentTabId = state.currentTab.id || null;
  const tabChanged = Boolean(currentTabId && state.lastTabId !== currentTabId);
  saveCurrentTodoExpansionState();
  if (tabChanged) {
    state.stageBaseEditMode = false;
    state.endpointEditMode = false;
    state.configEndpointEditMode = false;
    state.remoteConfigLoadKey = "";
    state.remoteConfigLoadResult = null;
  }
  const pageUrl = state.currentTab.url || "";
  if (pageUrl !== state.lastPopupPageUrl) {
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
  const {
    tokenValue,
    endpointValue,
    configEndpointValue,
    stageBaseValue
  } = await helpers.loadGlobalAiSettings();
  const normalizedStageBaseValue = normalizeStageBase(stageBaseValue);
  let configs = await config.getConfigs();
  const tabState =
    (await utils.getTabState(state.currentTab.id)) || { enabled: false, baseUrl: "" };
  let initialTabState = currentTabId
    ? (await utils.getTabState(currentTabId, "initial")) || { active: false }
    : { active: false };
  if (
    currentTabId &&
    !(initialTabState && initialTabState.active) &&
    utils.getOriginFromUrl(pageUrl)
  ) {
    await utils.setTabState(currentTabId, { active: true }, "initial");
    initialTabState = { active: true };
  }
  const tabInScope = Boolean(
    (initialTabState && initialTabState.active) ||
      utils.getOriginFromUrl(pageUrl)
  );
  const previewState = tabInScope
    ? await messages.sendTabMessage({ type: "getAiPreviewState" })
    : null;
  const previewMode = typeof (previewState && previewState.mode) === "string"
    ? previewState.mode
    : "";
  const previewActive = Boolean(previewState && previewState.active && previewMode === "preview");
  const previewItems = Array.isArray(previewState && previewState.items)
    ? previewState.items.filter((item) => item && typeof item === "object" && typeof item.xpath === "string")
    : [];
  const previewFocusedXpath = typeof (previewState && previewState.focusedXpath) === "string"
    ? previewState.focusedXpath
    : "";
  let localMatchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  let hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
  let discoveredBaseUrlFromGraphql = "";
  let currentSiteId = null;
  let siteIdBlockedReason = "";
  let unsupportedByGraphql = false;
  let remoteLoadResult = { status: "skipped", baseUrl: "" };
  let effectiveTabState = tabState;
  if (
    tabInScope &&
    tabState.baseUrl &&
    pageUrl &&
    !utils.isPageWithinBaseUrl(pageUrl, tabState.baseUrl)
  ) {
    effectiveTabState = { enabled: false, baseUrl: "" };
    await utils.setTabState(state.currentTab.id, effectiveTabState);
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
      if (configEndpointValue) {
        remoteLoadResult = await loadRemoteConfigForCurrentPage({
          tabId: currentTabId,
          pageUrl,
          siteId: discoveryResult.siteId,
          endpointValue: configEndpointValue,
          tokenValue,
          force: false
        });
        if (
          remoteLoadResult &&
          (remoteLoadResult.status === "ok" || remoteLoadResult.status === "not_found")
        ) {
          configs = await config.getConfigs();
          const persistedMatchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
          localMatchingBaseUrl =
            persistedMatchingBaseUrl || discoveredBaseUrlFromGraphql || localMatchingBaseUrl;
          hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
        }
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
    const normalized = config.normalizeConfig(state.currentBaseUrl, configs[state.currentBaseUrl]);
    if (configs[state.currentBaseUrl] && normalized.changed) {
      configs[state.currentBaseUrl] = normalized.config;
      await config.saveConfigs(configs);
    }
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
          await utils.setTabState(currentTabId, effectiveTabState);
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
      remoteLoadResult = await loadRemoteConfigForCurrentPage({
        tabId: currentTabId,
        pageUrl,
        siteId: currentSiteId,
        endpointValue: configEndpointValue,
        tokenValue,
        force: false
      });
      if (remoteLoadResult && remoteLoadResult.status === "ok") {
        configs = await config.getConfigs();
        if (state.currentBaseUrl && configs[state.currentBaseUrl]) {
          const normalizedCurrent = config.normalizeConfig(
            state.currentBaseUrl,
            configs[state.currentBaseUrl]
          );
          if (normalizedCurrent.changed) {
            configs[state.currentBaseUrl] = normalizedCurrent.config;
            await config.saveConfigs(configs);
          }
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
    effectiveTabState.baseUrl &&
    !hasLocalConfigForWebsite &&
    !currentSiteId
  ) {
    const wasEnabled = Boolean(effectiveTabState.enabled);
    effectiveTabState = { ...effectiveTabState, enabled: false, baseUrl: "" };
    await utils.setTabState(state.currentTab.id, effectiveTabState);
    if (wasEnabled) {
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
    state.currentBaseUrl = "";
    state.currentConfig = null;
    currentSiteId = null;
    siteIdBlockedReason = "";
  }
  if (unsupportedByGraphql) {
    if (effectiveTabState.enabled) {
      effectiveTabState = { ...effectiveTabState, enabled: false, baseUrl: "" };
      await utils.setTabState(state.currentTab.id, effectiveTabState);
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
        state.currentConfig = config.normalizeConfig(
          fallbackBaseUrl,
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
    state.basePageMenuOpen = false;
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
  const remoteSupportState = await fetchRemoteSupportState();
  state.remoteSupportState = remoteSupportState;
  const remoteSupportPageVisible = isRemoteSupportPageUrl(pageUrl, configEndpointValue);
  const scopedRemoteSupportState = scopeRemoteSupportStateToTab(remoteSupportState, currentTabId);
  const remoteSupportViewLocked = shouldLockRemoteSupportConfigurationView(
    remoteSupportPageVisible,
    remoteSupportState,
    currentTabId
  );
  const nextViewState = {
    currentPageUrl: pageUrl || ViewText.unavailable,
    currentBaseUrl: state.currentBaseUrl,
    configMenuOpen: state.configMenuOpen,
    basePageMenuOpen: state.basePageMenuOpen,
    previewActive,
    previewItems,
    previewFocusedXpath,
    previewBlocked: previewActive,
    previewBlockedMessage: previewActive
      ? PopupText.preview.blockedActive
      : ViewText.previewBlockedDefault
  };
  const remoteSupportMode = scopedRemoteSupportState.mode || "inactive";
  const remoteSupportControlOwner = scopedRemoteSupportState.controlOwner || "";
  nextViewState.remoteSupportSessionActive = Boolean(scopedRemoteSupportState.active);
  nextViewState.remoteSupportMode = remoteSupportMode;
  nextViewState.remoteSupportRole = scopedRemoteSupportState.role || "";
  nextViewState.remoteSupportVisible = Boolean(tokenValue);
  nextViewState.remoteSupportRequested = Boolean(scopedRemoteSupportState.supportCode);
  nextViewState.remoteSupportCode = scopedRemoteSupportState.supportCode || "";
  nextViewState.remoteSupportJoinCode = state.remoteSupportJoinCode || view.remoteSupportJoinCode || "";
  nextViewState.remoteSupportPageVisible = remoteSupportPageVisible;
  nextViewState.remoteSupportConnected = Boolean(scopedRemoteSupportState.connected);
  nextViewState.remoteSupportStreaming = Boolean(scopedRemoteSupportState.streaming);
  nextViewState.remoteSupportCameraAvailable = Boolean(scopedRemoteSupportState.supporteeCameraAvailable);
  nextViewState.remoteSupportCameraEnabled = Boolean(scopedRemoteSupportState.supporteeCameraEnabled);
  nextViewState.remoteSupportMicrophoneAvailable = Boolean(scopedRemoteSupportState.supporteeMicrophoneAvailable);
  nextViewState.remoteSupportMicrophoneEnabled = Boolean(scopedRemoteSupportState.supporteeMicrophoneEnabled);
  nextViewState.remoteSupportSoundAvailable = Boolean(scopedRemoteSupportState.supporteeAudioAvailable);
  nextViewState.remoteSupportSoundEnabled = Boolean(scopedRemoteSupportState.supporteeAudioEnabled);
  nextViewState.remoteSupportDockState = normalizeRemoteSupportDockState(scopedRemoteSupportState.dockState);
  nextViewState.remoteSupportLocalCameraActive = Boolean(state.remoteSupportLocalCameraActive);
  nextViewState.remoteSupportRemoteCameraActive = Boolean(state.remoteSupportRemoteCameraActive);
  nextViewState.remoteSupportPreviewImage = Boolean(scopedRemoteSupportState.active)
    ? state.remoteSupportLastFrame || ""
    : "";
  nextViewState.remoteSupportStatusText = buildRemoteSupportStatusText({
    active: nextViewState.remoteSupportSessionActive,
    mode: remoteSupportMode,
    connected: nextViewState.remoteSupportConnected,
    controlOwner: remoteSupportControlOwner
  });
  nextViewState.remoteSupportError = scopedRemoteSupportState.error || "";
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
    toggleEnabled = state.lastPopupEnabled;
    if (toggleEnabled === Boolean(effectiveTabState.enabled)) {
      state.lastPopupEnabled = null;
    }
  }
  let isEnabled = toggleEnabled;
  const storedDeviceState = currentTabId
    ? await emulation.reconcileDeviceEmulationState(currentTabId)
    : {
        enabled: state.currentDeviceEmulationEnabled,
        mode: state.currentDeviceMode,
        scale: state.currentDeviceScale
      };
  const normalizedDeviceState = emulation.syncDeviceEmulationState(storedDeviceState);
  const mobileSimulationReady = isMobileSimulationActive(normalizedDeviceState);
  const mobileSimulationBlocked = !mobileSimulationReady;
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
      (state.currentConfig && state.currentConfig.siteId) ||
      (state.currentBaseUrl ? state.siteIdLookupByBaseUrl.get(state.currentBaseUrl) : null)
  );
  state.currentSiteId = liveSiteId;
  if (liveSiteId && state.currentBaseUrl && tokenValue) {
    if (state.propertyLockSiteId !== liveSiteId) {
      resetPropertyLockState();
      state.propertyLockSiteId = liveSiteId;
    }
    const lockResponse = await fetchPropertyLockState(liveSiteId);
    const nextLockState = normalizeLockStateMessage(
      lockResponse && lockResponse.state ? lockResponse.state : createInactiveLockState()
    );
    const previousLockState = state.propertyLockState;
    if (
      !previousLockState ||
      previousLockState.state !== nextLockState.state ||
      previousLockState.isEditor !== nextLockState.isEditor ||
      previousLockState.editorIdentity !== nextLockState.editorIdentity
    ) {
      clearPropertyLockTransientState();
    }
    state.propertyLockState = nextLockState;
    applyPropertyLockConnectionStatus(
      lockResponse && lockResponse.connectionStatus
        ? lockResponse.connectionStatus
        : PROPERTY_LOCK_CONNECTION_CONNECTED,
      lockResponse && lockResponse.error ? lockResponse.error : ""
    );
    state.propertyLockIdentity = (lockResponse && lockResponse.identity) || "";
    state.propertyLockName = (lockResponse && lockResponse.name) || "";
  } else {
    resetPropertyLockState();
  }
  Object.assign(nextViewState, buildPropertyLockViewState());
  let propertyPageTypes = [];
  let propertyPageTypesFetchError = "";
  if (
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
    if (propertyPageTypesResult && propertyPageTypesResult.ok) {
      propertyPageTypes = propertyPageTypesResult.pageTypes || [];
      propertyPageTypesFetchError = propertyPageTypesResult.error || "";
    } else if (propertyPageTypesResult) {
      propertyPageTypesFetchError = propertyPageTypesResult.error || "";
    }
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
  let pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
  const normalizedCurrentPageUrl = normalizeCandidatePageUrl(pageUrl);
  let invalidStoredPageUrlsForRemote = [];
  let removedStoredCurrentPageEntry = false;
  if (propertyPageTypes.length && state.currentBaseUrl) {
    const initialStoredPageMarkingItems = collectStoredPageMarkingItems(
      pageMarkings,
      state.currentBaseUrl
    );
    const initialCoverageModel = buildLynxChecklistViewModel({
      aiAnswer: state.lynxChecklistAiAnswer,
      pageTypes: propertyPageTypes,
      markedPages: initialStoredPageMarkingItems
    });
    invalidStoredPageUrlsForRemote = Array.from(
      new Set(
        initialCoverageModel.invalidMarkedPages
          .map((item) => (item && typeof item.url === "string" ? item.url.trim() : ""))
          .filter(Boolean)
      )
    );
    removedStoredCurrentPageEntry = invalidStoredPageUrlsForRemote.some(
      (url) => normalizeCandidatePageUrl(url) === normalizedCurrentPageUrl
    );
    if (invalidStoredPageUrlsForRemote.length) {
      const removedInvalidUrls = await pruneLocalInvalidPageMarkings({
        baseUrl: state.currentBaseUrl,
        invalidUrls: invalidStoredPageUrlsForRemote
      });
      if (removedInvalidUrls.length) {
        configs = await config.getConfigs();
        state.currentConfig = config.normalizeConfig(
          state.currentBaseUrl,
          configs[state.currentBaseUrl]
        ).config;
        pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
        if (currentTabId) {
          await messages.sendTabMessageWithRetry({
            type: "configUpdated",
            baseUrl: state.currentBaseUrl,
            forceReloadPageEntry: removedInvalidUrls.some(
              (url) => normalizeCandidatePageUrl(url) === normalizedCurrentPageUrl
            )
          }, 2);
        }
      }
    }
  }
  const storedPageMarkingItems = collectStoredPageMarkingItems(
    pageMarkings,
    state.currentBaseUrl
  );
  const pageTypeCoverageModel = buildLynxChecklistViewModel({
    aiAnswer: state.lynxChecklistAiAnswer,
    pageTypes: propertyPageTypes,
    markedPages: storedPageMarkingItems
  });
  const activeMarkedPageKeys = new Set(
    pageTypeCoverageModel.activeMarkedPages
      .map((item) => buildPageMarkingKey(item.url, item.pageType))
      .filter(Boolean)
  );
  const pageMarkingItemByKey = new Map(
    storedPageMarkingItems.map((item) => [buildPageMarkingKey(item.url, item.pageType), item])
  );
  const hasStoredCurrentPageEntry = storedPageMarkingItems.some(
    (item) => normalizeCandidatePageUrl(item.url) === normalizedCurrentPageUrl
  );
  const currentPageCandidateState = getCurrentPageCandidateState(
    pageUrl,
    pageTypeCoverageModel.pageTypes
  );
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
  isEnabled = toggleEnabled && siteIdReady && renderModeReady && currentPageMarkingAllowed;
  if (
    tabInScope &&
    toggleEnabled &&
    (!siteIdReady || !renderModeReady || pageTypeUiBlocked) &&
    currentTabId
  ) {
    toggleEnabled = false;
    isEnabled = false;
    state.lastPopupEnabled = null;
    effectiveTabState = { ...effectiveTabState, enabled: false };
    await utils.setTabState(currentTabId, {
      enabled: false,
      baseUrl: state.currentBaseUrl || effectiveTabState.baseUrl || ""
    });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
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
  const selectorsReadyForSubmit = hasNewSelectors;
  const aiBusy = Boolean(state.aiRequestInFlight);
  const hasStoredSelectors = hasCalculatedSelectorsFromConfig();

  state.currentDraftEntry = null;
  state.currentSavedEntry = null;
  state.currentDraftDirty = false;
  state.currentDraftAvailable = false;
  state.currentPageSaveReconciliation = null;
  state.currentPageSaveReconciliationPending = false;
  if (state.currentBaseUrl && isEnabled) {
    const draftStatus = await messages.sendTabMessage({
      type: "getPageDraftStatus",
      baseUrl: state.currentBaseUrl
    });
    if (draftStatus && draftStatus.ok) {
      state.currentDraftEntry = draftStatus.entry || null;
      state.currentSavedEntry = draftStatus.savedEntry || null;
      state.currentDraftDirty = Boolean(draftStatus.dirty);
      state.currentDraftAvailable = true;
      state.currentPageSaveReconciliation = draftStatus.reconciliation || null;
      state.currentPageSaveReconciliationPending = Boolean(draftStatus.reconciliationPending);
    }
  }
  const savedEntry =
    state.currentSavedEntry ||
    (state.currentConfig &&
      state.currentConfig.pageMarkings &&
      state.currentConfig.pageMarkings[pageUrl]);
  const hasSavedPageData = Boolean(
    savedEntry &&
      ((Array.isArray(savedEntry.xpaths) && savedEntry.xpaths.length > 0) ||
        (Array.isArray(savedEntry.includeXpaths) &&
          savedEntry.includeXpaths.length > 0) ||
        (Array.isArray(savedEntry.consentXpaths) &&
          savedEntry.consentXpaths.length > 0) ||
        (typeof savedEntry.renderedHtml === "string" &&
          savedEntry.renderedHtml.length > 0))
  );
  const hasSavedAiSubmissionSnapshot = Boolean(
    savedEntry &&
      typeof savedEntry.renderedHtml === "string" &&
      savedEntry.renderedHtml.length > 0 &&
      Array.isArray(savedEntry.submissionXpaths) &&
      savedEntry.submissionXpaths.length > 0
  );
  const needsAiSnapshotBackfill =
    hasSavedPageData && !hasSavedAiSubmissionSnapshot;
  const pageSaveReconciliationPending = Boolean(state.currentPageSaveReconciliationPending);
  const aiBlockedByDraft = state.currentDraftDirty || pageSaveReconciliationPending;
  const aiBlockedByMissingSavedSnapshot =
    isEnabled &&
    baseUrlReady &&
    siteIdReady &&
    state.currentDraftAvailable &&
    !state.currentDraftDirty &&
    !hasSavedAiSubmissionSnapshot;

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
  if (remoteSupportViewLocked) {
    resolvedView = uiModule.View.Configuration;
    state.remoteSupportViewLocked = true;
  } else if (state.remoteSupportViewLocked) {
    state.remoteSupportViewLocked = false;
    if (configurationComplete) {
      resolvedView = uiModule.View.Marking;
    }
  }
  state.currentView = resolvedView;

  const remoteConfigRetryBlocked =
    state.remoteConfigConnectionIssue && resolvedView !== uiModule.View.Configuration;
  if (remoteConfigRetryBlocked) {
    scheduleRemoteConfigRetry();
  } else {
    clearRemoteConfigRetryTimer();
  }

  nextViewState.currentView = resolvedView;
  nextViewState.configurationContinueDisabled = !configurationComplete;
  nextViewState.configurationBackDisabled = !configurationComplete || remoteSupportViewLocked;
  nextViewState.configurationNoticeVisible =
    !configurationComplete ||
    remoteConfigRetryBlocked;
  nextViewState.configurationNoticeText = remoteConfigRetryBlocked
    ? PopupText.configuration.remoteConfigRetryNotice
    : configurationComplete
      ? ""
      : PopupText.configuration.continueSetupNotice;
  nextViewState.remoteSupportAutoFocus = remoteSupportViewLocked;

  const pageScopedUiDisabled =
    unsupportedByGraphql ||
    !tabInScope ||
    remoteConfigRetryBlocked ||
    pageTypeUiBlocked ||
    isPropertyLockBlockingEditing() ||
    remoteSupportMode === REMOTE_SUPPORT_MODE_SUPPORTING;
  const configurationUiDisabled = aiBusy;
  nextViewState.toggleEnabled = pageScopedUiDisabled ? false : isEnabled;
  nextViewState.toggleEnabledDisabled =
    pageScopedUiDisabled || pageSaveReconciliationPending || !baseUrlReady || !siteIdReady || !renderModeReady;
  nextViewState.mainUiHidden =
    pageScopedUiDisabled || !isEnabled || !siteIdReady || !renderModeReady;
  nextViewState.computeButtonDisabled =
    pageScopedUiDisabled ||
    aiBusy ||
    !aiReady ||
    aiBlockedByDraft ||
    aiBlockedByMissingSavedSnapshot;
  nextViewState.saveExcludesButtonDisabled =
    pageScopedUiDisabled ||
    aiBusy ||
    !aiReady ||
    !selectorsReadyForSubmit ||
    aiBlockedByDraft;
  nextViewState.previewLatestButtonDisabled =
    pageScopedUiDisabled ||
    aiBusy ||
    !baseUrlReady ||
    !siteIdReady ||
    !hasStoredSelectors ||
    aiBlockedByDraft;
  nextViewState.renderModeReady = renderModeReady;
  nextViewState.todoListVisible = siteIdReady && renderModeReady;
  nextViewState.renderModeValue = renderModeField.value;
  nextViewState.renderModeReadOnly = !renderModeField.isEditing;
  nextViewState.renderModeSetVisible = renderModeRequired && renderModeField.isEditing;
  nextViewState.renderModeEditVisible = renderModeSet && renderModeRequired;
  nextViewState.renderModeEditText = state.renderModeEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.renderModeNoticeText = renderModeNoticeText;
  nextViewState.renderModeNoticeVisible = renderModeNoticeVisible;
  nextViewState.renderModeUndeterminedVisible =
    renderModeValueUndetermined || state.renderModeDetectionUnsure;
  nextViewState.renderModeWarningVisible = false;
  nextViewState.renderModeWarningAcknowledgeChecked = false;
  nextViewState.renderModeWarningOkDisabled = true;
  nextViewState.lynxChecklistVisible = Boolean(state.lynxChecklistVisible);
  nextViewState.lynxChecklistAiAnswer = state.lynxChecklistAiAnswer || "";
  nextViewState.lynxChecklistPageTypes = Array.isArray(state.lynxChecklistPageTypes)
    ? state.lynxChecklistPageTypes
    : [];
  nextViewState.lynxChecklistAiQuestionDisabled = Boolean(state.lynxChecklistAiQuestionDisabled);
  nextViewState.lynxChecklistAiQuestionHidden = Boolean(state.lynxChecklistAiQuestionHidden);
  nextViewState.lynxChecklistNoticeText = state.lynxChecklistNoticeText || "";
  nextViewState.renderModeInputDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !Boolean(state.currentConfig);
  nextViewState.renderModeInspectButtonsDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !Boolean(state.currentTab && state.currentTab.id);
  nextViewState.renderModeSetDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    renderModeValueUndetermined ||
    !Boolean(state.currentConfig);
  nextViewState.renderModeEditDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !Boolean(state.currentConfig);
  nextViewState.renderModeSummaryTitle =
    renderModeSet
      ? currentRenderMode === config.RENDER_MODE_RENDERED
        ? PopupText.renderMode.summaryTitleRendered
        : PopupText.renderMode.summaryTitleStatic
      : PopupText.renderMode.title;
  nextViewState.renderModeSummaryOpen =
    !renderModeSet || state.renderModeEditMode || state.renderModeSummaryOpen;
  nextViewState.renderModeSectionVisible = renderModeRequired && (!renderModeSet || state.renderModeEditMode);
  nextViewState.renderModeChangeMenuVisible =
    resolvedView === uiModule.View.Marking &&
    renderModeRequired &&
    renderModeSet &&
    !pageScopedUiDisabled &&
    currentPageMarkingAllowed;
  nextViewState.stageBaseValue = stageBaseField.value;
  nextViewState.stageBaseReadOnly = !stageBaseField.isEditing;
  nextViewState.stageBaseSetVisible = stageBaseField.isEditing;
  nextViewState.stageBaseEditVisible = stageBaseSet;
  nextViewState.stageBaseEditText = state.stageBaseEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.stageBaseNoticeText = stageBaseField.noticeText;
  nextViewState.stageBaseNoticeVisible = stageBaseField.noticeVisible;
  nextViewState.stageBaseInputDisabled = configurationUiDisabled;
  nextViewState.stageBaseSetDisabled = configurationUiDisabled;
  nextViewState.stageBaseEditDisabled = configurationUiDisabled;
  nextViewState.themeValue = normalizeThemeValue(state.currentTheme);
  nextViewState.themeModeValue = normalizeThemeModeValue(state.currentThemeMode);
  nextViewState.themeOptions = THEME_OPTIONS;
  nextViewState.themeModeOptions = themeModeOptions;
  nextViewState.themeControlsDisabled = configurationUiDisabled;
  nextViewState.loginEmailValue = loginEmailValue;
  nextViewState.loginPasswordValue = loginPasswordValue;
  nextViewState.loginCredentialsDisabled =
    configurationUiDisabled || !loginCredentialsEnabled;
  nextViewState.loginStatusText = tokenValue
    ? PopupText.authentication.statusTokenSaved
    : PopupText.authentication.statusLoginRequired;
  nextViewState.loginStatusTone = tokenValue ? "success" : "warning";
  nextViewState.loginActionDisabled =
    configurationUiDisabled ||
    !loginCredentialsEnabled ||
    !isValidEmail(loginEmailValue.trim()) ||
    !loginPasswordValue.trim();
  nextViewState.configEndpointUrlValue = configEndpointField.value;
  nextViewState.configEndpointUrlReadOnly = !configEndpointField.isEditing;
  nextViewState.configEndpointSetVisible = configEndpointField.isEditing;
  nextViewState.configEndpointEditVisible = configEndpointSet;
  nextViewState.configEndpointEditText = state.configEndpointEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.configEndpointNoticeText = configEndpointField.noticeText;
  nextViewState.configEndpointNoticeVisible = configEndpointField.noticeVisible;
  nextViewState.configEndpointInputDisabled = configurationUiDisabled;
  nextViewState.configEndpointSetDisabled = configurationUiDisabled;
  nextViewState.configEndpointEditDisabled = configurationUiDisabled;

  nextViewState.endpointUrlValue = endpointField.value;
  nextViewState.endpointUrlReadOnly = !endpointField.isEditing;
  nextViewState.endpointSetVisible = endpointField.isEditing;
  nextViewState.endpointEditVisible = endpointSet;
  nextViewState.endpointEditText = state.endpointEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.endpointNoticeText = endpointField.noticeText;
  nextViewState.endpointNoticeVisible = endpointField.noticeVisible;
  nextViewState.endpointInputDisabled = configurationUiDisabled;
  nextViewState.endpointSetDisabled = configurationUiDisabled;
  nextViewState.endpointEditDisabled = configurationUiDisabled;
  nextViewState.clearDomainCacheDisabled = state.clearDomainCacheDisabled;
  nextViewState.unregisterCurrentTabDisabled =
    state.unregisterCurrentTabDisabled || !state.currentTab || !state.currentTab.id;
  nextViewState.computeButtonText =
    state.aiRequestInFlight === "compute"
      ? ViewText.computeButtonBusy
      : ViewText.computeButtonIdle;
  nextViewState.saveExcludesButtonText =
    state.aiRequestInFlight === "save"
      ? ViewText.saveExcludesBusy
      : ViewText.saveExcludesIdle;
  nextViewState.computeButtonLoading = state.aiRequestInFlight === "compute";
  nextViewState.saveExcludesButtonLoading = state.aiRequestInFlight === "save";
  nextViewState.aiRunSpinnerNote =
    state.aiRequestInFlight === "compute"
      ? PopupText.overlay.computingSelectorsNote
      : "";
  nextViewState.aiRunCountdownVisible =
    state.aiRequestInFlight === "compute" && state.aiRunDeadlineAt > 0;
  nextViewState.aiRunCountdownText =
    state.aiRequestInFlight === "compute"
      ? formatAiRunCountdown(
          state.aiRunRemainingMs || getAiRunRemainingMs(state.aiRunDeadlineAt)
        )
      : "0:00";
  nextViewState.aiControlsBusy = aiBusy;
  nextViewState.aiDirtyNoticeVisible = aiBlockedByDraft || aiBlockedByMissingSavedSnapshot;
  nextViewState.aiDirtyNoticeText = PopupText.ai.dirtyNotice;
  nextViewState.cssSelectorsVisible =
    !pageScopedUiDisabled &&
    resolvedView === uiModule.View.Marking &&
    renderModeReady;
  nextViewState.baseUrlInputValue = baseField.value;
  nextViewState.baseUrlNoticeText =
    state.remoteConfigConnectionIssue
      ? PopupText.status.remoteConfigRetryNotice
      : effectiveSiteIdBlockedReason || baseField.noticeText;
  nextViewState.baseUrlNoticeVisible =
    state.remoteConfigConnectionIssue ||
    Boolean(effectiveSiteIdBlockedReason) ||
    baseField.noticeVisible;
  const pageControlsVisible = !nextViewState.mainUiHidden && nextViewState.renderModeReady;
  const pageSaveUiState = buildPageSaveUiState({
    pageControlsVisible,
    currentDraftAvailable: state.currentDraftAvailable,
    hasSavedPageData,
    currentDraftDirty: state.currentDraftDirty,
    needsAiSnapshotBackfill,
    mobileSimulationBlocked,
    reconciliation: state.currentPageSaveReconciliation
  });
  nextViewState.pageSaveDisabled = pageSaveUiState.pageSaveDisabled;
  nextViewState.pageSaveMobileSimulationRequiredVisible =
    pageSaveUiState.pageSaveMobileSimulationRequiredVisible;
  nextViewState.pageSaveMobileSimulationRequiredText =
    PopupText.page.mobileSimulationRequired;
  nextViewState.pageRevertDisabled = pageSaveUiState.pageRevertDisabled;
  nextViewState.pageDraftStatusText = pageSaveUiState.pageDraftStatusText;
  nextViewState.pageDraftStatusTone = pageSaveUiState.pageDraftStatusTone;
  nextViewState.aiDirtyNoticeText = pageSaveUiState.aiDirtyNoticeText;
  nextViewState.syncLoadStatusText = state.lastConfigLoadStatusText || ViewText.syncLoadIdle;
  nextViewState.syncLoadStatusTone = state.lastConfigLoadStatusTone || "muted";
  nextViewState.syncSaveStatusText = state.lastConfigSaveStatusText || ViewText.syncSaveIdle;
  nextViewState.syncSaveStatusTone = state.lastConfigSaveStatusTone || "muted";
  const popupBusyActive = popupBusyOverlayVisible;
  nextViewState.isBusy = popupBusyActive || remoteConfigRetryBlocked;
  nextViewState.busyMessage = popupBusyActive
    ? popupBusyOverlayMessage
    : remoteConfigRetryBlocked
      ? PopupText.status.remoteServerRetryNotice
      : "";
  nextViewState.pageDataNewNoticeHidden = pageSaveUiState.pageDataNewNoticeHidden;
  nextViewState.deviceEmulationEnabled = normalizedDeviceState.enabled;
  nextViewState.deviceMode = normalizedDeviceState.mode;
  nextViewState.deviceScale = normalizedDeviceState.scale.toFixed(2);
  nextViewState.deviceScaleValue = formatScalePercent(normalizedDeviceState.scale);
  nextViewState.deviceControlsDisabled = Boolean(state.deviceControlsDisabled);
  nextViewState.pageTypeGroups = pageTypeCoverageModel.pageTypes.map((pageType) => ({
    key: pageType.key,
    title: pageType.title,
    markedCount: pageType.markedCount,
    missing: pageType.missing,
    candidates: pageType.candidates.map((candidate) => {
      const candidateKey = buildPageMarkingKey(candidate.url, pageType.key);
      const isCurrent =
        currentPageMarkingAllowed &&
        currentPageCandidateState.pageTypeKey === pageType.key &&
        currentPageCandidateState.url === candidate.url;
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
  }));
  nextViewState.pageTypeGroupsEmptyText = propertyPageTypesFetchError && !pageTypeCoverageModel.pageTypes.length
    ? propertyPageTypesFetchError
    : baseUrlReady
      ? PopupText.pageTypes.emptyState
      : effectiveSiteIdBlockedReason || ViewText.noMappedBaseUrlOrSiteId;
  nextViewState.pageTypeNoticeText = currentPageCandidateState.status === "duplicate"
    ? PopupText.pageTypes.duplicateCurrentPage
    : currentPageCandidateState.status === "missing"
      ? (hasStoredCurrentPageEntry || removedStoredCurrentPageEntry)
        ? PopupText.pageTypes.removedCurrentPage
        : PopupText.pageTypes.blockedCurrentPage
      : currentPageCandidateState.status === "empty"
        ? (propertyPageTypesFetchError || PopupText.pageTypes.emptyState)
        : pageTypeCoverageModel.invalidMarkedPages.length
          ? PopupText.pageTypes.invalidStoredNotice
          : "";
  nextViewState.pageTypeNoticeVisible = Boolean(nextViewState.pageTypeNoticeText);
  nextViewState.lynxChecklistPageTypes = propertyPageTypes;
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
      invalidUrls: invalidStoredPageUrlsForRemote
    }).then();
  }

  const basePageUrlSet = new Set(
    Object.keys(configs).filter((url) => {
      if (typeof url !== "string" || !url) {
        return false;
      }
      const normalized = config.normalizeConfig(url, configs[url]).config;
      return Boolean(normalizeSiteIdValue(normalized.siteId));
    })
  );
  if (state.currentBaseUrl && liveSiteId) {
    basePageUrlSet.add(state.currentBaseUrl);
  }
  const basePageUrls = Array.from(basePageUrlSet)
    .sort((left, right) => left.localeCompare(right))
    .map((url) => ({ url }));
  nextViewState.basePageUrls = basePageUrls;
  nextViewState.basePageUrlsEmptyText = ViewText.basePageUrlsEmpty;

  const nextTodoExpansionKey = buildTodoExpansionContextKey(currentTabId, state.currentBaseUrl);
  const currentTodoExpansionKey = state.currentTodoExpansionKey;
  const todoExpansionContextChanged = nextTodoExpansionKey !== currentTodoExpansionKey;
  const hasNoTodoExpansionContext = !nextTodoExpansionKey;
  const movedToDifferentProperty = state.currentBaseUrl !== previousBaseUrl;
  const shouldAutoCollapseOnContextChange =
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
  state.currentTodoExpansionKey = nextTodoExpansionKey;

  await syncRenderModeDebuggerLifecycle({
    wasVisible: Boolean(view.renderModeSectionVisible),
    isVisible: Boolean(nextViewState.renderModeSectionVisible),
    currentTabId
  });

  uiModule.setViewState(nextViewState);
}

async function maybeResumePersistedAiRun() {
  if (state.aiRequestInFlight || state.aiRunResumeInFlight) {
    return;
  }
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
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
        endpointValue,
        tokenValue,
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
          endpointValue,
          tokenValue,
          sessionId: persistedRun.sessionId
        });
      } catch {
        await failAiRun(PopupText.ai.runUnavailable);
        return;
      }
      if (!result.ok) {
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

async function refreshUi() {
  const response = await runWithPopupBusyOverlay(
    PopupText.overlay.loadingPopupAndPreparing,
    () => refreshUiInner(),
    {
      delayMs: POPUP_BUSY_OVERLAY_DELAY_MS,
      suppressIfActive: true
    }
  );
  maybeResumePersistedAiRun().catch(() => {});
  return response;
}

function handleConfigEndpointInput(event) {
  uiModule.setViewState({ configEndpointUrlValue: event.target.value });
}

function handleEndpointInput(event) {
  uiModule.setViewState({ endpointUrlValue: event.target.value });
}

function handleStageBaseInput(event) {
  uiModule.setViewState({ stageBaseValue: event.target.value });
}

async function handleThemeInput(event) {
  const nextThemeValue = normalizeThemeValue(
    event && event.target ? event.target.value : state.currentTheme
  );
  await applyThemeValue(nextThemeValue);
}

async function applyThemeValue(nextThemeValue) {
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

function handleThemeMenuToggle(event) {
  event.stopPropagation();
  const view = uiModule.getViewState();
  uiModule.setThemeMenuOpen(!view.themeMenuOpen, getThemeMenuPlacement());
}

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

async function handleThemeOptionSelect(value) {
  await applyThemeValue(normalizeThemeValue(value));
}

async function cycleTheme(direction) {
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

async function handleThemeModeInput(event) {
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

async function runRenderModeInspectionReload(javaScriptDisabled) {
  const tabId = state.currentTab && state.currentTab.id;
  if (!tabId) {
    uiModule.showToast(PopupText.renderMode.toastUnavailable);
    return;
  }

  await runWithPopupBusyOverlay(PopupText.overlay.pleaseWait, async () => {
    const loadCompletePromise = waitForTabLoadComplete(tabId, 8000, {
      awaitNextLoad: true
    });
    const result = await utils.reloadPageWithJavaScriptControl(tabId, javaScriptDisabled);
    const loadCompleted = await loadCompletePromise;
    const outcome = resolveRenderModeInspectionReloadOutcome(result, loadCompleted, javaScriptDisabled);
    if (!outcome.ok) {
      uiModule.showToast(outcome.toast);
      return;
    }

    await hideConsentForRenderModeInspection();
    uiModule.showToast(outcome.toast);
  });
}

async function detachRenderModeDebuggerAndNormalizePage(tabId) {
  if (!tabId) {
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

async function syncRenderModeDebuggerLifecycle({ wasVisible, isVisible, currentTabId }) {
  const managedTabId = state.renderModeDebuggerTabId;

  if (isVisible) {
    if (!currentTabId) {
      return;
    }

    if (managedTabId && managedTabId !== currentTabId) {
      await detachRenderModeDebuggerAndNormalizePage(managedTabId);
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
    await detachRenderModeDebuggerAndNormalizePage(managedTabId);
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

function isRecentConfigSelectorComputation(sourceConfig = state.currentConfig) {
  if (!hasCalculatedSelectorsFromConfig(sourceConfig)) {
    return false;
  }
  const updatedAt = config.normalizeEntryTimestamp(
    sourceConfig && sourceConfig.selectorsUpdatedAt
  );
  if (updatedAt === config.PAGE_TIMESTAMP_FALLBACK) {
    return false;
  }
  return Date.now() - updatedAt <= LYNX_CHECKLIST_AI_AUTO_CONFIRM_WINDOW_MS;
}

function resetLynxChecklistState() {
  const initial = createInitialLynxChecklistState();
  const hasCalculatedSelectors = hasCalculatedSelectorsFromConfig(state.currentConfig);
  const promptState = buildLynxChecklistPromptState({
    hasCalculatedSelectors,
    recentlyCalculatedSelectors: isRecentConfigSelectorComputation(state.currentConfig)
  });
  state.lynxChecklistAiAnswer = promptState.aiAnswer || initial.aiAnswer;
  state.lynxChecklistPageTypes = Array.isArray(state.propertyPageTypes)
    ? state.propertyPageTypes
    : initial.pageTypes;
  state.lynxChecklistAiQuestionDisabled = promptState.aiQuestionDisabled;
  state.lynxChecklistAiQuestionHidden = Boolean(promptState.aiQuestionHidden);
  state.lynxChecklistNoticeText = hasCalculatedSelectors
    ? ""
    : PopupText.lynxChecklist.noticeRunAiDetectionFirst;
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

function handleLynxChecklistAiAnswerChange(event) {
  if (state.lynxChecklistAiQuestionDisabled) {
    return;
  }
  const nextValue =
    event && event.currentTarget && event.currentTarget.value === "no" ? "no" : "yes";
  state.lynxChecklistAiAnswer = nextValue;
  setLynxChecklistViewState();
}

function handleLynxChecklistPageTypeDecisionChange(pageTypeKey, event) {
  void pageTypeKey;
  void event;
}

function handleLynxChecklistPageTypePageChange(pageTypeKey, event) {
  void pageTypeKey;
  void event;
}

function handleLynxChecklistCancel() {
  closeLynxChecklistPopover();
}

async function handleRenderModeSet() {
  await runWithPopupBusyOverlay(PopupText.overlay.savingRenderMode, async () => {
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
  await refreshUi();
}

async function handleOpenRenderModeSection() {
  uiModule.setConfigMenuOpen(false);
  uiModule.setBasePageMenuOpen(false);
  state.renderModeEditMode = true;
  state.renderModeSummaryOpen = true;
  await refreshUi();
}

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

function handleLoginEmailInput(event) {
  updateLoginActionState({ loginEmailValue: event.target.value });
}

function handleLoginPasswordInput(event) {
  updateLoginActionState({ loginPasswordValue: event.target.value });
}

function handleEnterKeyDown(event, shouldHandle, handler) {
  if (event.key !== "Enter") {
    return;
  }
  if (!shouldHandle()) {
    return;
  }
  handler();
}

function handleConfigEndpointKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().configEndpointUrlReadOnly,
    handleConfigEndpointSet
  );
}

function handleEndpointKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().endpointUrlReadOnly,
    handleEndpointSet
  );
}

function handleStageBaseKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().stageBaseReadOnly,
    handleStageBaseSet
  );
}

function handleLoginPasswordKeyDown(event) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().loginActionDisabled,
    handleLoginAction
  );
}

function syncRemoteSupportViewState(remoteSupportState = null) {
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const nextState = scopeRemoteSupportStateToTab(remoteSupportState, currentTabId);
  const remoteSupportControlOwner = nextState.controlOwner || "";
  const statusText = buildRemoteSupportStatusText({
    active: Boolean(nextState.active),
    mode: nextState.mode || "inactive",
    connected: Boolean(nextState.connected),
    controlOwner: remoteSupportControlOwner
  });
  uiModule.setViewState({
    remoteSupportSessionActive: Boolean(nextState.active),
    remoteSupportMode: nextState.mode || "inactive",
    remoteSupportRole: nextState.role || "",
    remoteSupportRequested: Boolean(nextState.supportCode),
    remoteSupportCode: nextState.supportCode || "",
    remoteSupportConnected: Boolean(nextState.connected),
    remoteSupportStreaming: Boolean(nextState.streaming),
    remoteSupportCameraAvailable: Boolean(nextState.supporteeCameraAvailable),
    remoteSupportCameraEnabled: Boolean(nextState.supporteeCameraEnabled),
    remoteSupportMicrophoneAvailable: Boolean(nextState.supporteeMicrophoneAvailable),
    remoteSupportMicrophoneEnabled: Boolean(nextState.supporteeMicrophoneEnabled),
    remoteSupportSoundAvailable: Boolean(nextState.supporteeAudioAvailable),
    remoteSupportSoundEnabled: Boolean(nextState.supporteeAudioEnabled),
    remoteSupportDockState: normalizeRemoteSupportDockState(nextState.dockState),
    remoteSupportLocalCameraActive: Boolean(state.remoteSupportLocalCameraActive),
    remoteSupportRemoteCameraActive: Boolean(state.remoteSupportRemoteCameraActive),
    remoteSupportPreviewImage: Boolean(nextState.active) ? state.remoteSupportLastFrame || "" : "",
    remoteSupportStatusText: statusText,
    remoteSupportError: nextState.error || ""
  });
  if (!nextState.active) {
    state.remoteSupportLocalCameraActive = false;
    state.remoteSupportRemoteCameraActive = false;
    remoteSupportLocalCameraCanvas = null;
    remoteSupportLocalCameraCtx = null;
    remoteSupportLocalCameraMediaStream = null;
    remoteSupportRemoteCameraCanvas = null;
    remoteSupportRemoteCameraCtx = null;
    remoteSupportRemoteCameraMediaStream = null;
    uiModule.setViewState({
      remoteSupportLocalCameraActive: false,
      remoteSupportRemoteCameraActive: false,
      remoteSupportDockState: REMOTE_SUPPORT_DOCK_STATE_EMBEDDED
    });
  }
  scheduleRemoteSupportSidebarStreamCapture();
}

function buildRemoteSupportStatusText(stateValue) {
  if (!stateValue || !stateValue.active) {
    return "";
  }
  const mode = stateValue.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED
    ? "Being supported"
    : "Supporting";
  const connectedLabel = stateValue.connected ? " • connected" : " • waiting for peer";
  const streamLabel = stateValue.connected ? " • view-only" : "";
  return `${mode}${connectedLabel}${streamLabel}`;
}

function normalizeRemoteSupportSidebarListItem(candidate) {
  if (!candidate) {
    return "";
  }

  if (typeof candidate === "string") {
    return candidate.trim();
  }

  if (typeof candidate.label === "string" && candidate.label.trim()) {
    return candidate.label.trim();
  }

  if (typeof candidate.title === "string" && candidate.title.trim()) {
    return candidate.title.trim();
  }

  if (typeof candidate.url === "string" && candidate.url.trim()) {
    return candidate.url.trim();
  }

  return "";
}

function buildRemoteSupportSidebarSnapshot(viewState = uiModule.getViewState()) {
  const publicationContext = getRemoteSupportSidebarPublicationContext();
  if (!publicationContext || publicationContext.tabId === null) {
    return createInactiveRemoteSupportSidebarSnapshot();
  }

  const normalizedViewState = viewState && typeof viewState === "object"
    ? viewState
    : uiModule.getViewState();
  const summaryRows = [
    {
      label: "Extension",
      value: normalizedViewState.toggleEnabled ? "Enabled" : "Disabled"
    },
    {
      label: "View",
      value: typeof normalizedViewState.currentView === "string"
        ? normalizedViewState.currentView
        : ""
    },
    {
      label: "Render mode",
      value: typeof normalizedViewState.renderModeValue === "string"
        ? normalizedViewState.renderModeValue
        : "undetermined"
    },
    {
      label: "Device emulation",
      value: normalizedViewState.deviceEmulationEnabled
        ? `${normalizedViewState.deviceMode || "mobile"} ${normalizedViewState.deviceScaleValue || ""}`.trim()
        : "Off"
    },
    {
      label: "Marked pages",
      value: String(Array.isArray(normalizedViewState.markedPages) ? normalizedViewState.markedPages.length : 0)
    },
    {
      label: "Todo groups",
      value: String(Array.isArray(normalizedViewState.pageTypeGroups) ? normalizedViewState.pageTypeGroups.length : 0)
    }
  ];
  const markedPages = Array.isArray(normalizedViewState.markedPages)
    ? normalizedViewState.markedPages
        .map((entry) => normalizeRemoteSupportSidebarListItem(entry))
        .filter(Boolean)
    : [];
  const pageTypeGroups = Array.isArray(normalizedViewState.pageTypeGroups)
    ? normalizedViewState.pageTypeGroups
        .map((group) => {
          if (!group || typeof group !== "object") {
            return "";
          }

          const title = typeof group.title === "string" && group.title.trim()
            ? group.title.trim()
            : (typeof group.key === "string" ? group.key.trim() : "");
          if (!title) {
            return "";
          }

          const markedCount = Number.isFinite(group.markedCount)
            ? Math.max(0, Math.trunc(group.markedCount))
            : 0;
          return group.missing
            ? `${title} (${markedCount}, missing)`
            : `${title} (${markedCount})`;
        })
        .filter(Boolean)
    : [];
  const notices = [
    normalizedViewState.configurationNoticeText,
    normalizedViewState.baseUrlNoticeText,
    normalizedViewState.endpointNoticeText,
    normalizedViewState.renderModeNoticeText,
    normalizedViewState.remoteSupportError,
    normalizedViewState.loginStatusText
  ].filter((value) => typeof value === "string" && value.trim());

  return normalizeRemoteSupportSidebarSnapshot({
    active: true,
    currentView: typeof normalizedViewState.currentView === "string"
      ? normalizedViewState.currentView
      : "",
    currentPageUrl: typeof normalizedViewState.currentPageUrl === "string"
      ? normalizedViewState.currentPageUrl
      : "",
    currentBaseUrl: typeof normalizedViewState.currentBaseUrl === "string"
      ? normalizedViewState.currentBaseUrl
      : "",
    remoteSupportStatusText: typeof normalizedViewState.remoteSupportStatusText === "string"
      ? normalizedViewState.remoteSupportStatusText
      : "",
    renderModeValue: typeof normalizedViewState.renderModeValue === "string"
      ? normalizedViewState.renderModeValue
      : "",
    pageDraftStatusText: typeof normalizedViewState.pageDraftStatusText === "string"
      ? normalizedViewState.pageDraftStatusText
      : "",
    syncLoadStatusText: typeof normalizedViewState.syncLoadStatusText === "string"
      ? normalizedViewState.syncLoadStatusText
      : "",
    syncSaveStatusText: typeof normalizedViewState.syncSaveStatusText === "string"
      ? normalizedViewState.syncSaveStatusText
      : "",
    summaryRows,
    markedPages,
    pageTypeGroups,
    notices
  });
}

function getRemoteSupportSidebarStreamTabId(remoteSupportState = state.remoteSupportState) {
  const publicationContext = getRemoteSupportSidebarPublicationContext(remoteSupportState);
  return publicationContext ? publicationContext.tabId : null;
}

function getRemoteSupportSidebarPublicationContext(remoteSupportState = state.remoteSupportState) {
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const scopedState = scopeRemoteSupportStateToTab(remoteSupportState, currentTabId);
  if (currentTabId !== null && scopedState.active && scopedState.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    return {
      tabId: currentTabId,
      state: scopedState
    };
  }

  const stateTabId = remoteSupportState && Number.isFinite(Number(remoteSupportState.tabId))
    ? Math.trunc(Number(remoteSupportState.tabId))
    : null;
  if (stateTabId === null || stateTabId === currentTabId) {
    return {
      tabId: null,
      state: null
    };
  }

  const remoteScopedState = scopeRemoteSupportStateToTab(remoteSupportState, stateTabId);
  if (remoteScopedState.active && remoteScopedState.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    return {
      tabId: stateTabId,
      state: remoteScopedState
    };
  }

  return {
    tabId: null,
    state: null
  };
}

function ensureRemoteSupportSidebarStreamChannel() {
  if (remoteSupportSidebarStreamChannel || typeof BroadcastChannel !== "function") {
    return remoteSupportSidebarStreamChannel;
  }

  remoteSupportSidebarStreamChannel = new BroadcastChannel(REMOTE_SUPPORT_SIDEBAR_STREAM_CHANNEL_NAME);
  remoteSupportSidebarStreamChannel.onmessage = (event) => {
    const message = event && event.data && typeof event.data === "object"
      ? event.data
      : null;
    if (!message || message.type !== "command") {
      return;
    }

    const activeTabId = getRemoteSupportSidebarStreamTabId();
    if (activeTabId === null || Number(message.tabId) !== activeTabId) {
      return;
    }

    applyRemoteSupportSidebarCommand(message.command);
  };
  return remoteSupportSidebarStreamChannel;
}

function ensureRemoteSupportPopupMediaChannel() {
  if (remoteSupportPopupMediaChannel || typeof BroadcastChannel !== "function") {
    return remoteSupportPopupMediaChannel;
  }

  remoteSupportPopupMediaChannel = new BroadcastChannel("unfluffify-remote-support-popup-media");
  remoteSupportPopupMediaChannel.onmessage = (event) => {
    const message = event && event.data && typeof event.data === "object" ? event.data : null;
    const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
      ? state.currentTab.id
      : null;
    if (!message || currentTabId === null || Number(message.tabId) !== currentTabId) {
      return;
    }

    const { localCameraBitmap, remoteCameraBitmap } = message;

    if ("localCameraBitmap" in message) {
      if (localCameraBitmap instanceof ImageBitmap) {
        if (!remoteSupportLocalCameraCanvas) {
          remoteSupportLocalCameraCanvas = document.createElement("canvas");
          remoteSupportLocalCameraCtx = remoteSupportLocalCameraCanvas.getContext("2d");
          remoteSupportLocalCameraMediaStream = remoteSupportLocalCameraCanvas.captureStream();
        }
        if (remoteSupportLocalCameraCanvas.width !== localCameraBitmap.width) {
          remoteSupportLocalCameraCanvas.width = localCameraBitmap.width;
        }
        if (remoteSupportLocalCameraCanvas.height !== localCameraBitmap.height) {
          remoteSupportLocalCameraCanvas.height = localCameraBitmap.height;
        }
        remoteSupportLocalCameraCtx?.drawImage(localCameraBitmap, 0, 0);
        state.remoteSupportLocalCameraActive = true;
      } else {
        state.remoteSupportLocalCameraActive = false;
      }
    }

    if ("remoteCameraBitmap" in message) {
      if (remoteCameraBitmap instanceof ImageBitmap) {
        if (!remoteSupportRemoteCameraCanvas) {
          remoteSupportRemoteCameraCanvas = document.createElement("canvas");
          remoteSupportRemoteCameraCtx = remoteSupportRemoteCameraCanvas.getContext("2d");
          remoteSupportRemoteCameraMediaStream = remoteSupportRemoteCameraCanvas.captureStream();
        }
        if (remoteSupportRemoteCameraCanvas.width !== remoteCameraBitmap.width) {
          remoteSupportRemoteCameraCanvas.width = remoteCameraBitmap.width;
        }
        if (remoteSupportRemoteCameraCanvas.height !== remoteCameraBitmap.height) {
          remoteSupportRemoteCameraCanvas.height = remoteCameraBitmap.height;
        }
        remoteSupportRemoteCameraCtx?.drawImage(remoteCameraBitmap, 0, 0);
        state.remoteSupportRemoteCameraActive = true;
      } else {
        state.remoteSupportRemoteCameraActive = false;
      }
    }

    uiModule.setViewState({
      remoteSupportLocalCameraActive: state.remoteSupportLocalCameraActive,
      remoteSupportRemoteCameraActive: state.remoteSupportRemoteCameraActive
    });
    syncRemoteSupportCameraVideoRefs();
    syncRemoteSupportDockPiPWindow();
  };
  return remoteSupportPopupMediaChannel;
}

function postRemoteSupportSidebarStreamMessage(message) {
  const channel = ensureRemoteSupportSidebarStreamChannel();
  if (!channel) {
    return;
  }

  try {
    channel.postMessage(message);
  } catch {
    // Ignore local sidebar stream delivery failures.
  }
}

function stopRemoteSupportSidebarStreamPublishing() {
  if (remoteSupportSidebarStreamAnimationFrame) {
    window.cancelAnimationFrame(remoteSupportSidebarStreamAnimationFrame);
    remoteSupportSidebarStreamAnimationFrame = 0;
  }

  remoteSupportSidebarStreamDirty = false;
  hideRemoteSupportSidebarCursor();
}

function ensureRemoteSupportSidebarCursor() {
  let cursor = document.getElementById(REMOTE_SUPPORT_SIDEBAR_CURSOR_ID);
  if (cursor) {
    return cursor;
  }

  cursor = document.createElement("div");
  cursor.id = REMOTE_SUPPORT_SIDEBAR_CURSOR_ID;
  cursor.className = "remote-support-sidebar-cursor";
  cursor.setAttribute("aria-hidden", "true");
  cursor.setAttribute("data-uf-extension-ui", "true");
  cursor.hidden = true;
  (document.body || document.documentElement).appendChild(cursor);
  return cursor;
}

function hideRemoteSupportSidebarCursor() {
  if (remoteSupportSidebarCursorHideTimer) {
    window.clearTimeout(remoteSupportSidebarCursorHideTimer);
    remoteSupportSidebarCursorHideTimer = 0;
  }

  const cursor = document.getElementById(REMOTE_SUPPORT_SIDEBAR_CURSOR_ID);
  if (!cursor) {
    return;
  }

  cursor.hidden = true;
  cursor.classList.remove("is-visible", "is-clicking");
}

function showRemoteSupportSidebarCursor(point, { click = false } = {}) {
  if (!point) {
    return;
  }

  const cursor = ensureRemoteSupportSidebarCursor();
  cursor.hidden = false;
  cursor.style.left = `${Math.round(Number(point.x) || 0)}px`;
  cursor.style.top = `${Math.round(Number(point.y) || 0)}px`;
  cursor.classList.add("is-visible");

  if (click) {
    cursor.classList.remove("is-clicking");
    cursor.getBoundingClientRect();
    cursor.classList.add("is-clicking");
  }

  if (remoteSupportSidebarCursorHideTimer) {
    window.clearTimeout(remoteSupportSidebarCursorHideTimer);
  }
  remoteSupportSidebarCursorHideTimer = window.setTimeout(() => {
    const activeCursor = document.getElementById(REMOTE_SUPPORT_SIDEBAR_CURSOR_ID);
    if (activeCursor) {
      activeCursor.classList.remove("is-visible", "is-clicking");
      activeCursor.hidden = true;
    }
    remoteSupportSidebarCursorHideTimer = 0;
  }, 2500);
}

function shouldMirrorLocalRemoteSupportSidebarPointer() {
  const publicationContext = getRemoteSupportSidebarPublicationContext();
  return Boolean(
    publicationContext &&
    publicationContext.tabId !== null &&
    publicationContext.state &&
    publicationContext.state.active &&
    publicationContext.state.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
    publicationContext.state.controlOwner === REMOTE_SUPPORT_CONTROL_OWNER_REQUESTER
  );
}

function getLocalRemoteSupportSidebarPointer(event) {
  if (!event || !event.isTrusted || !shouldMirrorLocalRemoteSupportSidebarPointer()) {
    return null;
  }

  const width = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1));
  const height = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1));
  return {
    x: Math.max(0, Math.min(width, Number(event.clientX) || 0)),
    y: Math.max(0, Math.min(height, Number(event.clientY) || 0))
  };
}

function handleLocalRemoteSupportSidebarPointerMove(event) {
  const point = getLocalRemoteSupportSidebarPointer(event);
  if (!point) {
    return;
  }

  showRemoteSupportSidebarCursor(point);
  scheduleRemoteSupportSidebarStreamCapture();
}

function handleLocalRemoteSupportSidebarClick(event) {
  const point = getLocalRemoteSupportSidebarPointer(event);
  if (!point) {
    return;
  }

  showRemoteSupportSidebarCursor(point, { click: true });
  scheduleRemoteSupportSidebarStreamCapture();
}

function ensureRemoteSupportSidebarStreamObservation() {
  if (!remoteSupportSidebarStreamListenersBound) {
    remoteSupportSidebarStreamListenersBound = true;

    window.addEventListener("resize", () => {
      scheduleRemoteSupportSidebarStreamCapture();
    });
    document.addEventListener("scroll", () => {
      scheduleRemoteSupportSidebarStreamCapture();
    }, true);
    document.addEventListener("input", () => {
      scheduleRemoteSupportSidebarStreamCapture();
    }, true);
    document.addEventListener("change", () => {
      scheduleRemoteSupportSidebarStreamCapture();
    }, true);
    document.addEventListener("mousemove", handleLocalRemoteSupportSidebarPointerMove, true);
    document.addEventListener("click", handleLocalRemoteSupportSidebarClick, true);
  }

  if (remoteSupportSidebarStreamObserver || typeof MutationObserver !== "function" || !document.documentElement) {
    return;
  }

  remoteSupportSidebarStreamObserver = new MutationObserver(() => {
    scheduleRemoteSupportSidebarStreamCapture();
  });
  remoteSupportSidebarStreamObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true
  });
}

function focusRemoteSupportSidebarTarget(target) {
  if (!target || typeof target.focus !== "function") {
    return;
  }

  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
}

function isRemoteSupportSidebarTextEditableElement(target) {
  if (!target || target.nodeType !== 1) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = String(target.tagName || "").toLowerCase();
  if (tagName === "textarea") {
    return true;
  }

  if (tagName !== "input") {
    return false;
  }

  const type = String(target.type || "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit"
  ].includes(type);
}

function dispatchRemoteSupportSidebarEditableInputEvent(target) {
  target.dispatchEvent(new Event("input", {
    bubbles: true,
    cancelable: false,
    composed: true
  }));
}

function applyRemoteSupportSidebarTextInputCommand(target, command) {
  if (!isRemoteSupportSidebarTextEditableElement(target) || !command || command.ctrlKey || command.altKey || command.metaKey) {
    return false;
  }

  focusRemoteSupportSidebarTarget(target);
  const key = String(command.key || "");

  if (target.isContentEditable && typeof document.execCommand === "function") {
    if (key.length === 1) {
      document.execCommand("insertText", false, key);
      return true;
    }
    if (key === "Backspace") {
      document.execCommand("delete", false);
      return true;
    }
    if (key === "Delete") {
      document.execCommand("forwardDelete", false);
      return true;
    }
    if (key === "Enter") {
      document.execCommand("insertLineBreak", false);
      return true;
    }
    return false;
  }

  const value = typeof target.value === "string" ? target.value : "";
  const selectionStart = Number.isInteger(target.selectionStart) ? target.selectionStart : value.length;
  const selectionEnd = Number.isInteger(target.selectionEnd) ? target.selectionEnd : selectionStart;

  let nextValue = value;
  let nextCaret = selectionStart;

  if (key.length === 1) {
    nextValue = `${value.slice(0, selectionStart)}${key}${value.slice(selectionEnd)}`;
    nextCaret = selectionStart + key.length;
  } else if (key === "Backspace") {
    if (selectionStart !== selectionEnd) {
      nextValue = `${value.slice(0, selectionStart)}${value.slice(selectionEnd)}`;
      nextCaret = selectionStart;
    } else if (selectionStart > 0) {
      nextValue = `${value.slice(0, selectionStart - 1)}${value.slice(selectionEnd)}`;
      nextCaret = selectionStart - 1;
    }
  } else if (key === "Delete") {
    if (selectionStart !== selectionEnd) {
      nextValue = `${value.slice(0, selectionStart)}${value.slice(selectionEnd)}`;
      nextCaret = selectionStart;
    } else if (selectionStart < value.length) {
      nextValue = `${value.slice(0, selectionStart)}${value.slice(selectionStart + 1)}`;
      nextCaret = selectionStart;
    }
  } else if (key === "Enter" && String(target.tagName || "").toLowerCase() === "textarea") {
    nextValue = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
    nextCaret = selectionStart + 1;
  } else {
    return false;
  }

  if (nextValue === value) {
    return true;
  }

  target.value = nextValue;
  if (typeof target.setSelectionRange === "function") {
    target.setSelectionRange(nextCaret, nextCaret);
  }
  dispatchRemoteSupportSidebarEditableInputEvent(target);
  return true;
}

function dispatchRemoteSupportSidebarPointerClick(target, clientX, clientY, button = 0) {
  if (!target || target.nodeType !== 1) {
    return false;
  }

  focusRemoteSupportSidebarTarget(target);
  const mouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    button
  };

  target.dispatchEvent(new MouseEvent("mousedown", mouseEventInit));
  target.dispatchEvent(new MouseEvent("mouseup", mouseEventInit));
  if (typeof target.click === "function") {
    target.click();
    return true;
  }

  target.dispatchEvent(new MouseEvent("click", mouseEventInit));
  return true;
}

function resolveRemoteSupportSidebarPoint(command) {
  const root = document.documentElement;
  const width = Math.max(1, Number(root && root.clientWidth) || window.innerWidth || 1);
  const height = Math.max(1, Number(root && root.clientHeight) || window.innerHeight || 1);
  return {
    x: Math.max(0, Math.min(width - 1, Math.round((Number(command && command.x) || 0) * width))),
    y: Math.max(0, Math.min(height - 1, Math.round((Number(command && command.y) || 0) * height)))
  };
}

function applyRemoteSupportSidebarCommand(command) {
  if (!command || typeof command !== "object") {
    return;
  }

  const type = typeof command.type === "string" ? command.type : "";
  if (!type) {
    return;
  }

  if (type === "pointer-move") {
    const point = resolveRemoteSupportSidebarPoint(command);
    showRemoteSupportSidebarCursor(point);
    const target = document.elementFromPoint(point.x, point.y) || document.body;
    if (!target) {
      return;
    }

    target.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      buttons: 0
    }));
    return;
  }

  if (type === "pointer-click") {
    const point = resolveRemoteSupportSidebarPoint(command);
    showRemoteSupportSidebarCursor(point, { click: true });
    const target = document.elementFromPoint(point.x, point.y) || document.body;
    dispatchRemoteSupportSidebarPointerClick(target, point.x, point.y, Number(command.button) || 0);
    return;
  }

  if (type === "scroll") {
    const point = resolveRemoteSupportSidebarPoint(command);
    showRemoteSupportSidebarCursor(point);
    const target = document.elementFromPoint(point.x, point.y) || document.scrollingElement || document.documentElement;
    target.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      deltaX: Number(command.deltaX) || 0,
      deltaY: Number(command.deltaY) || 0
    }));
    return;
  }

  if (type === "key") {
    const eventInit = {
      key: String(command.key || ""),
      code: String(command.code || ""),
      ctrlKey: Boolean(command.ctrlKey),
      altKey: Boolean(command.altKey),
      shiftKey: Boolean(command.shiftKey),
      metaKey: Boolean(command.metaKey),
      bubbles: true,
      cancelable: true,
      composed: true
    };
    const target = document.activeElement && document.activeElement.nodeType === 1
      ? document.activeElement
      : document.documentElement;
    target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    applyRemoteSupportSidebarTextInputCommand(target, command);
    target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  }
}

function collectRemoteSupportSidebarCaptureCssText() {
  const cssTexts = [];
  for (const styleSheet of Array.from(document.styleSheets || [])) {
    try {
      for (const rule of Array.from(styleSheet.cssRules || [])) {
        cssTexts.push(rule.cssText);
      }
    } catch {
      // Ignore inaccessible stylesheet rules.
    }
  }

  return cssTexts.join("\n");
}

function syncRemoteSupportSidebarCloneState(sourceRoot, cloneRoot) {
  if (!sourceRoot || !cloneRoot) {
    return;
  }

  const sourceWalker = document.createTreeWalker(sourceRoot, NodeFilter.SHOW_ELEMENT);
  const cloneWalker = document.createTreeWalker(cloneRoot, NodeFilter.SHOW_ELEMENT);

  let sourceNode = sourceWalker.currentNode;
  let cloneNode = cloneWalker.currentNode;
  while (sourceNode && cloneNode) {
    const tagName = String(sourceNode.tagName || "").toLowerCase();
    if (tagName === "input" || tagName === "textarea" || tagName === "select") {
      if ("value" in sourceNode && "value" in cloneNode) {
        cloneNode.value = sourceNode.value;
        cloneNode.setAttribute("value", sourceNode.value);
      }
      if ("checked" in sourceNode && sourceNode.checked) {
        cloneNode.setAttribute("checked", "checked");
      } else if ("checked" in cloneNode) {
        cloneNode.removeAttribute("checked");
      }
    }

    sourceNode = sourceWalker.nextNode();
    cloneNode = cloneWalker.nextNode();
  }
}

async function renderRemoteSupportSidebarStreamFrame(width, height) {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script").forEach((node) => {
    node.remove();
  });
  syncRemoteSupportSidebarCloneState(document.documentElement, clone);

  const head = clone.querySelector("head");
  if (head) {
    const style = document.createElement("style");
    style.textContent = collectRemoteSupportSidebarCaptureCssText();
    head.appendChild(style);
  }

  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;

  const body = clone.querySelector("body");
  if (body) {
    body.style.margin = "0";
    body.style.width = `${width}px`;
    body.style.height = `${height}px`;
    body.style.overflow = "hidden";
  }

  const serializedMarkup = new XMLSerializer().serializeToString(clone);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">${serializedMarkup}</foreignObject>
    </svg>
  `;

  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) {
            reject(new Error("Remote support sidebar capture is unavailable"));
            return;
          }

          context.drawImage(image, 0, 0, width, height);
          if (typeof canvas.toBlob === "function") {
            canvas.toBlob((blob) => {
              if (blob) {
                resolve({ blob });
                return;
              }

              resolve({ dataUrl: canvas.toDataURL("image/webp", REMOTE_SUPPORT_SIDEBAR_STREAM_IMAGE_QUALITY) });
            }, "image/webp", REMOTE_SUPPORT_SIDEBAR_STREAM_IMAGE_QUALITY);
            return;
          }

          resolve({ dataUrl: canvas.toDataURL("image/webp", REMOTE_SUPPORT_SIDEBAR_STREAM_IMAGE_QUALITY) });
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => {
        reject(new Error("Failed to render remote support sidebar"));
      };
      image.src = svgUrl;
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function scheduleRemoteSupportSidebarStreamCapture() {
  const activeTabId = getRemoteSupportSidebarStreamTabId();
  if (activeTabId === null) {
    stopRemoteSupportSidebarStreamPublishing();
    return;
  }

  ensureRemoteSupportSidebarStreamObservation();
  ensureRemoteSupportSidebarStreamChannel();
  remoteSupportSidebarStreamDirty = true;

  if (remoteSupportSidebarStreamAnimationFrame || remoteSupportSidebarStreamCaptureInFlight) {
    return;
  }

  remoteSupportSidebarStreamAnimationFrame = window.requestAnimationFrame(() => {
    remoteSupportSidebarStreamAnimationFrame = 0;
    const nextTabId = getRemoteSupportSidebarStreamTabId();
    if (nextTabId === null) {
      stopRemoteSupportSidebarStreamPublishing();
      return;
    }

    remoteSupportSidebarStreamDirty = false;
    flushRemoteSupportSidebarStreamCapture(nextTabId).then();
  });
}

async function flushRemoteSupportSidebarStreamCapture(tabId) {
  if (remoteSupportSidebarStreamCaptureInFlight) {
    return;
  }

  const activeTabId = getRemoteSupportSidebarStreamTabId();
  if (activeTabId === null || activeTabId !== tabId) {
    stopRemoteSupportSidebarStreamPublishing();
    return;
  }

  remoteSupportSidebarStreamCaptureInFlight = true;
  try {
    const root = document.documentElement;
    const width = Math.max(1, Math.round(Number(root && root.clientWidth) || window.innerWidth || 1));
    const height = Math.max(1, Math.round(Number(root && root.clientHeight) || window.innerHeight || 1));
    const frame = await renderRemoteSupportSidebarStreamFrame(width, height);
    postRemoteSupportSidebarStreamMessage({
      type: "frame",
      tabId,
      width,
      height,
      ...frame
    });
  } catch {
    // Ignore transient capture failures while the popup is rerendering.
  } finally {
    remoteSupportSidebarStreamCaptureInFlight = false;
    if (remoteSupportSidebarStreamDirty) {
      scheduleRemoteSupportSidebarStreamCapture();
    }
  }
}

async function flushRemoteSupportSidebarSnapshotSync() {
  remoteSupportSidebarSnapshotSyncTimer = 0;

  const snapshot = pendingRemoteSupportSidebarSnapshot;
  const snapshotKey = pendingRemoteSupportSidebarSnapshotKey;
  pendingRemoteSupportSidebarSnapshot = null;
  pendingRemoteSupportSidebarSnapshotKey = "";

  if (!snapshot || !snapshot.active) {
    lastRemoteSupportSidebarSnapshotKey = "";
    return;
  }

  const tabId = getRemoteSupportSidebarStreamTabId();
  if (tabId === null) {
    return;
  }

  try {
    const response = await messages.sendRuntimeMessage({
      type: "remoteSupportUpdateSidebarSnapshot",
      tabId,
      snapshot
    });
    if (response && response.ok) {
      lastRemoteSupportSidebarSnapshotKey = snapshotKey;
    }
  } catch {
    // Ignore transient background or transport restarts.
  }
}

function scheduleRemoteSupportSidebarSnapshotSync(viewState = uiModule.getViewState()) {
  const snapshot = buildRemoteSupportSidebarSnapshot(viewState);
  if (!snapshot.active) {
    pendingRemoteSupportSidebarSnapshot = null;
    pendingRemoteSupportSidebarSnapshotKey = "";
    lastRemoteSupportSidebarSnapshotKey = "";
    if (remoteSupportSidebarSnapshotSyncTimer) {
      window.clearTimeout(remoteSupportSidebarSnapshotSyncTimer);
      remoteSupportSidebarSnapshotSyncTimer = 0;
    }
    return;
  }

  const snapshotKey = JSON.stringify(snapshot);
  if (
    snapshotKey === lastRemoteSupportSidebarSnapshotKey ||
    snapshotKey === pendingRemoteSupportSidebarSnapshotKey
  ) {
    return;
  }

  pendingRemoteSupportSidebarSnapshot = snapshot;
  pendingRemoteSupportSidebarSnapshotKey = snapshotKey;
  if (remoteSupportSidebarSnapshotSyncTimer) {
    return;
  }

  remoteSupportSidebarSnapshotSyncTimer = window.setTimeout(() => {
    flushRemoteSupportSidebarSnapshotSync().then();
  }, REMOTE_SUPPORT_SIDEBAR_SNAPSHOT_DEBOUNCE_MS);
}

async function fetchRemoteSupportState(tabId = state.currentTab && state.currentTab.id) {
  const response = await messages.sendRuntimeMessage({
    type: "getRemoteSupportState",
    tabId: Number.isFinite(tabId) ? tabId : undefined
  });
  if (!response || !response.ok) {
    return null;
  }
  return response.state || null;
}

async function requireRemoteSupportSetup() {
  if (!await helpers.ensureActiveTab({ requireId: true, requireUrl: true })) {
    return null;
  }
  const { tokenValue, configEndpointValue } = await helpers.loadGlobalAiSettings();
  if (!configEndpointValue) {
    uiModule.showToast(PopupText.configuration.endpointEnter);
    return null;
  }
  if (!tokenValue) {
    uiModule.showToast(PopupText.authentication.statusLoginRequired);
    return null;
  }
  return { tokenValue, configEndpointValue };
}

async function handleRemoteSupportRequest() {
  uiModule.setViewState({ remoteSupportRequestLoading: true });
  try {
    const setup = await requireRemoteSupportSetup();
    if (!setup || !state.currentTab || !state.currentTab.id) {
      return;
    }
    const response = await messages.sendRuntimeMessage({
      type: "remoteSupportRequestCode",
      endpointValue: setup.configEndpointValue,
      tokenValue: setup.tokenValue,
      tabId: state.currentTab.id,
      pageUrl: state.currentTab.url || ""
    });
    if (!response || !response.ok) {
      uiModule.showToast((response && response.error) || "Unable to request support code");
      return;
    }
    state.remoteSupportState = response.state || null;
    syncRemoteSupportViewState(state.remoteSupportState);
    await refreshUi();
  } finally {
    uiModule.setViewState({ remoteSupportRequestLoading: false });
  }
}

function handleRemoteSupportJoinCodeInput(event) {
  const value = event && event.target && typeof event.target.value === "string"
    ? event.target.value.trim().toUpperCase()
    : "";
  state.remoteSupportJoinCode = value;
  uiModule.setViewState({ remoteSupportJoinCode: value });
}

async function handleRemoteSupportJoin() {
  uiModule.setViewState({ remoteSupportJoinLoading: true });
  try {
    const setup = await requireRemoteSupportSetup();
    if (!setup || !state.currentTab || !state.currentTab.id) {
      return;
    }
    const supportCode = (uiModule.getViewState().remoteSupportJoinCode || "").trim();
    if (!supportCode) {
      uiModule.showToast(PopupText.configuration.remoteSupportJoinCodePlaceholder);
      return;
    }
    const response = await messages.sendRuntimeMessage({
      type: "remoteSupportJoin",
      endpointValue: setup.configEndpointValue,
      tokenValue: setup.tokenValue,
      tabId: state.currentTab.id,
      supportCode
    });
    if (!response || !response.ok) {
      uiModule.showToast((response && response.error) || "Unable to join support session");
      return;
    }
    state.remoteSupportState = response.state || null;
    syncRemoteSupportViewState(state.remoteSupportState);
    await refreshUi();
  } finally {
    uiModule.setViewState({ remoteSupportJoinLoading: false });
  }
}

async function setRemoteSupportDockState(dockState) {
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : undefined;
  const scopedRemoteSupportState = scopeRemoteSupportStateToTab(state.remoteSupportState, currentTabId);
  const response = await messages.sendRuntimeMessage({
    type: "remoteSupportSetDockState",
    tabId: currentTabId,
    sessionId: typeof scopedRemoteSupportState.sessionId === "string"
      ? scopedRemoteSupportState.sessionId
      : "",
    dockState
  });
  if (response && response.ok) {
    state.remoteSupportState = response.state || state.remoteSupportState;
    syncRemoteSupportViewState(state.remoteSupportState);
  }
  return response;
}

async function openRemoteSupportDockPiP() {
  const scopedRemoteSupportState = scopeRemoteSupportStateToTab(
    state.remoteSupportState,
    state.currentTab && Number.isFinite(state.currentTab.id) ? state.currentTab.id : null
  );
  if (!scopedRemoteSupportState.active || scopedRemoteSupportState.mode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    return;
  }

  if (!window.documentPictureInPicture || typeof window.documentPictureInPicture.requestWindow !== "function") {
    await setRemoteSupportDockState(REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED);
    return;
  }

  if (remoteSupportDockPiPWindow && !remoteSupportDockPiPWindow.closed) {
    return;
  }

  try {
    remoteSupportDockPiPWindow = await window.documentPictureInPicture.requestWindow({
      width: 360,
      height: 260
    });
    const pipDocument = remoteSupportDockPiPWindow.document;
    pipDocument.head.innerHTML = `
      <style>
        body{margin:0;padding:12px;background:#09111d;color:#e8edf6;font:500 13px/1.4 system-ui,sans-serif}
        .dock{display:grid;gap:10px}
        .tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .tile{min-height:92px;overflow:hidden;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:#101a2b}
        .tile video,.tile span{display:block;width:100%;height:100%}
        .tile video{object-fit:cover}
        .tile span{display:grid;place-items:center;color:#9eb4d2}
        .controls{display:flex;flex-wrap:wrap;gap:8px}
        button{border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:8px 10px;background:#101a2b;color:#fff;cursor:pointer}
        button.warn{background:#7f1d2d}
      </style>
    `;
    pipDocument.body.innerHTML = `
      <div class="dock">
        <div class="tiles">
          <div class="tile"><video id="uf-pip-local" autoplay muted playsinline hidden aria-label="Local camera preview"></video><span id="uf-pip-local-empty">Local camera</span></div>
          <div class="tile"><video id="uf-pip-remote" autoplay muted playsinline hidden aria-label="Supporter camera preview"></video><span id="uf-pip-remote-empty">Supporter camera</span></div>
        </div>
        <div class="controls">
          <button id="uf-pip-camera">Camera</button>
          <button id="uf-pip-mic">Mic</button>
          <button id="uf-pip-sound">Sound</button>
          <button id="uf-pip-end" class="warn">End</button>
        </div>
      </div>
    `;
    pipDocument.getElementById("uf-pip-camera").addEventListener("click", () => { handleRemoteSupportCameraToggle().then(); });
    pipDocument.getElementById("uf-pip-mic").addEventListener("click", () => { handleRemoteSupportMicrophoneToggle().then(); });
    pipDocument.getElementById("uf-pip-sound").addEventListener("click", () => { handleRemoteSupportSoundToggle().then(); });
    pipDocument.getElementById("uf-pip-end").addEventListener("click", () => { handleRemoteSupportEnd().then(); });
    remoteSupportDockPiPWindow.addEventListener("pagehide", () => {
      remoteSupportDockPiPWindow = null;
      setRemoteSupportDockState(REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED).then();
    }, { once: true });
    await setRemoteSupportDockState(REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP);
    syncRemoteSupportDockPiPWindow();
  } catch (error) {
    remoteSupportDockPiPWindow = null;
    await setRemoteSupportDockState(REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED);
  }
}

function syncRemoteSupportCameraVideoRefs() {
  const refs = uiModule.getRefs();
  if (refs.localCameraVideo && remoteSupportLocalCameraMediaStream) {
    if (refs.localCameraVideo.srcObject !== remoteSupportLocalCameraMediaStream) {
      refs.localCameraVideo.srcObject = remoteSupportLocalCameraMediaStream;
    }
  }
  if (refs.remoteCameraVideo && remoteSupportRemoteCameraMediaStream) {
    if (refs.remoteCameraVideo.srcObject !== remoteSupportRemoteCameraMediaStream) {
      refs.remoteCameraVideo.srcObject = remoteSupportRemoteCameraMediaStream;
    }
  }
}

function syncRemoteSupportDockPiPWindow() {
  if (!remoteSupportDockPiPWindow || remoteSupportDockPiPWindow.closed) {
    return;
  }
  const pipDocument = remoteSupportDockPiPWindow.document;
  const localVideo = pipDocument.getElementById("uf-pip-local");
  const remoteVideo = pipDocument.getElementById("uf-pip-remote");
  const localEmpty = pipDocument.getElementById("uf-pip-local-empty");
  const remoteEmpty = pipDocument.getElementById("uf-pip-remote-empty");
  const localActive = Boolean(state.remoteSupportLocalCameraActive);
  const remoteActive = Boolean(state.remoteSupportRemoteCameraActive);
  if (localVideo) {
    if (remoteSupportLocalCameraMediaStream && localVideo.srcObject !== remoteSupportLocalCameraMediaStream) {
      localVideo.srcObject = remoteSupportLocalCameraMediaStream;
    }
    localVideo.hidden = !localActive;
  }
  if (remoteVideo) {
    if (remoteSupportRemoteCameraMediaStream && remoteVideo.srcObject !== remoteSupportRemoteCameraMediaStream) {
      remoteVideo.srcObject = remoteSupportRemoteCameraMediaStream;
    }
    remoteVideo.hidden = !remoteActive;
  }
  if (localEmpty) {
    localEmpty.hidden = localActive;
  }
  if (remoteEmpty) {
    remoteEmpty.hidden = remoteActive;
  }
}

async function handleRemoteSupportDockExternalize() {
  await openRemoteSupportDockPiP();
}

async function handleRemoteSupportEnd() {
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : undefined;
  const scopedRemoteSupportState = scopeRemoteSupportStateToTab(state.remoteSupportState, currentTabId);
  await messages.sendRuntimeMessage({
    type: "remoteSupportEnd",
    tabId: currentTabId,
    sessionId: typeof scopedRemoteSupportState.sessionId === "string"
      ? scopedRemoteSupportState.sessionId
      : ""
  });
  state.remoteSupportState = await fetchRemoteSupportState();
  state.remoteSupportLastFrame = "";
  syncRemoteSupportViewState(state.remoteSupportState);
  uiModule.setViewState({ remoteSupportPreviewImage: "" });
  await refreshUi();
}

async function handleRemoteSupportLocalMediaToggle(control) {
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : undefined;
  if (!Number.isFinite(currentTabId)) {
    return;
  }

  const scopedState = scopeRemoteSupportStateToTab(state.remoteSupportState, currentTabId);
  if (!scopedState.active || scopedState.mode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    return;
  }

  const mediaStateByControl = {
    camera: {
      available: Boolean(scopedState.supporteeCameraAvailable),
      enabled: Boolean(scopedState.supporteeCameraEnabled)
    },
    microphone: {
      available: Boolean(scopedState.supporteeMicrophoneAvailable),
      enabled: Boolean(scopedState.supporteeMicrophoneEnabled)
    },
    sound: {
      available: Boolean(scopedState.supporteeAudioAvailable),
      enabled: Boolean(scopedState.supporteeAudioEnabled)
    }
  };

  const currentMediaState = mediaStateByControl[control];
  if (!currentMediaState || !currentMediaState.available) {
    return;
  }

  const response = await messages.sendRuntimeMessage({
    type: "remoteSupportSetLocalMediaEnabled",
    tabId: currentTabId,
    sessionId: typeof scopedState.sessionId === "string" ? scopedState.sessionId : "",
    control,
    enabled: !currentMediaState.enabled
  });

  if (!response || !response.ok) {
    uiModule.showToast((response && response.error) || "Unable to update remote support media");
    return;
  }

  state.remoteSupportState = response.state || await fetchRemoteSupportState(currentTabId);
  syncRemoteSupportViewState(state.remoteSupportState);
}

async function handleRemoteSupportCameraToggle() {
  await handleRemoteSupportLocalMediaToggle("camera");
}

async function handleRemoteSupportMicrophoneToggle() {
  await handleRemoteSupportLocalMediaToggle("microphone");
}

async function handleRemoteSupportSoundToggle() {
  await handleRemoteSupportLocalMediaToggle("sound");
}

async function handleRemoteSupportErrorDismiss(event) {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }
  if (event && typeof event.stopPropagation === "function") {
    event.stopPropagation();
  }

  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  if (currentTabId === null) {
    uiModule.setViewState({ remoteSupportError: "" });
    return;
  }

  const scopedState = scopeRemoteSupportStateToTab(state.remoteSupportState, currentTabId);
  uiModule.setViewState({ remoteSupportError: "" });

  try {
    const response = await messages.sendRuntimeMessage({
      type: "remoteSupportDismissError",
      tabId: currentTabId,
      sessionId: typeof scopedState.sessionId === "string" ? scopedState.sessionId : ""
    });
    if (response && response.ok) {
      state.remoteSupportState = response.state || await fetchRemoteSupportState(currentTabId);
      syncRemoteSupportViewState(state.remoteSupportState);
      await refreshUi();
      return;
    }
  } catch {
    // Keep the local dismissal even if the background snapshot is already gone.
  }
}

async function handlePropertyLockTake() {
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_TAKE_LOCK);
  await refreshUi();
}

async function handlePropertyLockSuggest() {
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_SUGGEST);
  state.propertyLockSuggestionPending = true;
  state.propertyLockSuggestionRejected = false;
  uiModule.setViewState(buildPropertyLockViewState());
}

async function handlePropertyLockContinue() {
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_CONTINUE);
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockSecondsRemaining = null;
  uiModule.setViewState(buildPropertyLockViewState());
}

async function handlePropertyLockAcceptSuggestion() {
  const suggestionId = state.propertyLockSuggestionId;
  if (!suggestionId) {
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_RESPOND, {
    suggestionId,
    accept: true
  });
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  uiModule.setViewState(buildPropertyLockViewState());
}

async function handlePropertyLockRejectSuggestion() {
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
}

function handleConfigToggle(event) {
  event.stopPropagation();
  uiModule.setBasePageMenuOpen(false);
  uiModule.setTodoControlsMenuOpen(false);
  uiModule.setConfigMenuOpen(!state.configMenuOpen);
}

function handleConfigMenuClick(event) {
  event.stopPropagation();
}

function handleBasePageMenuToggle(event) {
  event.stopPropagation();
  uiModule.setConfigMenuOpen(false);
  uiModule.setTodoControlsMenuOpen(false);
  uiModule.setBasePageMenuOpen(!state.basePageMenuOpen);
}

function handleBasePageMenuClick(event) {
  event.stopPropagation();
}

function handleTodoControlsMenuToggle(event) {
  event.stopPropagation();
  const view = uiModule.getViewState();
  uiModule.setConfigMenuOpen(false);
  uiModule.setBasePageMenuOpen(false);
  uiModule.setTodoControlsMenuOpen(!Boolean(view.todoControlsMenuOpen));
}

function handleTodoControlsMenuClick(event) {
  event.stopPropagation();
}

function handleTodoSectionToggle() {
  const view = uiModule.getViewState();
  uiModule.setTodoSectionExpanded(!view.todoSectionExpanded);
  saveCurrentTodoExpansionState();
}

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
  uiModule.setBasePageMenuOpen(false);
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

async function handleExplicitExcludeView(xpath) {
  await runWithPopupBusyOverlay(PopupText.overlay.locatingElement, async () => {
    const response = await messages.sendTabMessage({
      type: "focusElement",
      xpath
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.focusFailed);
    }
  }, { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS });
}

async function handleExplicitExcludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
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
  await refreshUi();
}

async function handleExplicitIncludeView(xpath) {
  await runWithPopupBusyOverlay(PopupText.overlay.locatingElement, async () => {
    const response = await messages.sendTabMessage({
      type: "focusElement",
      xpath
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.focusFailed);
    }
  }, { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS });
}

async function handleExplicitIncludeRemove(xpath) {
  if (!state.currentBaseUrl) {
    return;
  }
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
  await refreshUi();
}

async function navigateActiveTabToUrl(url) {
  const tab = await helpers.ensureActiveTab({ requireId: true });
  if (!tab) {
    return false;
  }
  chrome.tabs.update(tab.id, { url }, () => {
    void chrome.runtime.lastError;
  });
  return true;
}

async function navigateActiveTabToUrlWithTodoCollapse(url) {
  const navigated = await navigateActiveTabToUrl(url);
  if (navigated) {
    collapseTodoListForAutoCollapse();
  }
  return navigated;
}

async function handleMarkedPageNavigate(url) {
  await navigateActiveTabToUrlWithTodoCollapse(url);
}

async function handleBasePageNavigate(url) {
  uiModule.setBasePageMenuOpen(false);
  await navigateActiveTabToUrlWithTodoCollapse(url);
}

async function handleLynxChecklistCandidateNavigate(url) {
  if (!url) {
    return;
  }
  closeLynxChecklistPopover();
  await navigateActiveTabToUrlWithTodoCollapse(url);
}

async function handleEnableToggle(event) {
  const source = event && (event.currentTarget || event.target);
  const currentViewState = uiModule.getViewState();
  const desiredEnabled = source
    ? Boolean(source.checked)
    : currentViewState.toggleEnabled;
  if (desiredEnabled !== currentViewState.toggleEnabled) {
    collapseTodoListForAutoCollapse();
  }
  const tab = await helpers.ensureActiveTab({ requireId: true, requireUrl: true });
  if (!tab) {
    return;
  }
  uiModule.setViewState({ toggleEnabled: desiredEnabled });
  if (!helpers.ensureBaseUrl(ViewText.noMappedBaseUrlOrSiteId)) {
    uiModule.setViewState({ toggleEnabled: false });
    state.lastPopupEnabled = null;
    return;
  }
  if (desiredEnabled && !isCurrentRenderModeReady()) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeEnabling);
    uiModule.setViewState({ toggleEnabled: false });
    state.lastPopupEnabled = null;
    await refreshUi();
    return;
  }
  if (desiredEnabled && !state.currentPageTypeKey) {
    uiModule.showToast(
      uiModule.getViewState().pageTypeNoticeText || PopupText.pageTypes.blockedCurrentPage
    );
    uiModule.setViewState({ toggleEnabled: false });
    state.lastPopupEnabled = null;
    await refreshUi();
    return;
  }
  state.lastPopupEnabled = desiredEnabled;
  const baseUrlValue = state.currentBaseUrl;
  const currentPageTypeKey = desiredEnabled ? state.currentPageTypeKey || "" : "";
  await runWithPopupBusyOverlay(
    desiredEnabled ? PopupText.overlay.enablingMarking : PopupText.overlay.disablingMarking,
    async () => {
      if (desiredEnabled) {
        const parsed = utils.parseBaseUrl(baseUrlValue);
        if (!parsed) {
          uiModule.showToast(PopupText.baseUrl.toastInvalid);
          uiModule.setViewState({ toggleEnabled: false });
          state.lastPopupEnabled = null;
          await refreshUi();
          return;
        }
        if (!utils.isPageWithinBaseUrl(tab.url, baseUrlValue)) {
          uiModule.showToast(PopupText.baseUrl.toastOutsideCurrentPage);
          uiModule.setViewState({ toggleEnabled: false });
          state.lastPopupEnabled = null;
          await refreshUi();
          return;
        }
        {
          const currentConfigs = await config.getConfigs();
          const normalizedCurrent = config.normalizeConfig(baseUrlValue, currentConfigs[baseUrlValue]);
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
          state.lastPopupEnabled = null;
          await refreshUi();
          return;
        }
        const effectiveBaseUrl = siteIdResult.baseUrl || baseUrlValue;
        state.currentBaseUrl = effectiveBaseUrl;
        state.currentConfig = siteIdResult.config || state.currentConfig;
        const injectResult = await helpers.injectContentScriptIfNeeded();
        if (!injectResult.ok) {
          uiModule.showToast(injectResult.error || PopupText.helper.activateFailedOnPage);
          uiModule.setViewState({ toggleEnabled: false });
          state.lastPopupEnabled = null;
          await refreshUi();
          return;
        }
        await messages.sendRuntimeMessage({ type: "activateContentForTab", tabId: tab.id });
        await utils.setTabState(tab.id, {
          enabled: true,
          baseUrl: effectiveBaseUrl,
          pageType: currentPageTypeKey
        });
        await messages.sendTabMessageWithRetry({
          type: "setEnabled",
          enabled: true,
          baseUrl: effectiveBaseUrl,
          pageType: currentPageTypeKey
        });
        await messages.sendTabMessageWithRetry({ type: "forceRefresh" });
      } else {
        await utils.setTabState(tab.id, {
          enabled: false,
          baseUrl: baseUrlValue,
          pageType: ""
        });
        await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false, pageType: "" });
      }
      await refreshUi();
    },
    { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS }
  );
}

async function handleDeviceEmulationEnabledToggle(event) {
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
    hostname = new URL(tab.url).hostname;
  } catch (error) {
    hostname = origin;
  }
  const confirmed = window.confirm(formatClearDomainCacheConfirm(hostname));
  if (!confirmed) {
    return;
  }
  beginPopupBusyOverlay(PopupText.overlay.clearingCacheAndReloading);
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
      (error && error.message) || PopupText.cache.toastClearFailed
    );
  } finally {
    state.clearDomainCacheDisabled = false;
    uiModule.setViewState({ clearDomainCacheDisabled: false });
    endPopupBusyOverlay();
  }
}

async function handleUnregisterCurrentTab() {
  uiModule.setConfigMenuOpen(false);
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
  beginPopupBusyOverlay(PopupText.overlay.unregisteringTabAndReloading);
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
    endPopupBusyOverlay();
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
  const stored = await utils.storageGet(chrome.storage.sync, [
    "globalConfigEndpoint",
    "globalToken"
  ]);
  const previousEndpoint =
    stored && typeof stored.globalConfigEndpoint === "string"
      ? stored.globalConfigEndpoint.trim()
      : "";
  const hadToken = Boolean(stored && stored.globalToken);
  const endpointOriginChanged =
    getEndpointOrigin(previousEndpoint) &&
    getEndpointOrigin(endpointValue) &&
    getEndpointOrigin(previousEndpoint) !== getEndpointOrigin(endpointValue);
  const shouldResetToken = hadToken && endpointOriginChanged;
  await utils.storageSet(chrome.storage.sync, {
    globalConfigEndpoint: endpointValue,
    globalToken: shouldResetToken ? "" : (stored.globalToken || "")
  });
  if (shouldResetToken) {
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
  const stored = await utils.storageGet(chrome.storage.sync, [
    "globalEndpoint",
    "globalToken"
  ]);
  const previousEndpoint =
    stored && typeof stored.globalEndpoint === "string"
      ? stored.globalEndpoint.trim()
      : "";
  const hadToken = Boolean(stored && stored.globalToken);
  const endpointOriginChanged =
    getEndpointOrigin(previousEndpoint) &&
    getEndpointOrigin(endpointValue) &&
    getEndpointOrigin(previousEndpoint) !== getEndpointOrigin(endpointValue);
  const shouldResetToken = hadToken && endpointOriginChanged;
  await utils.storageSet(chrome.storage.sync, {
    globalEndpoint: endpointValue,
    globalToken: shouldResetToken ? "" : (stored.globalToken || "")
  });
  if (shouldResetToken) {
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
  const stored = await utils.storageGet(chrome.storage.sync, [
    "globalStageBase",
    "globalToken"
  ]);
  const previousStageBase = normalizeStageBase((stored && stored.globalStageBase) || "");
  const hasToken = Boolean(stored && stored.globalToken);
  await utils.storageSet(chrome.storage.sync, {
    globalStageBase: normalized,
    globalToken:
      previousStageBase !== normalized && hasToken ? "" : stored.globalToken || ""
  });
  state.stageBaseEditMode = false;
  state.siteIdLookupByBaseUrl.clear();
  if (previousStageBase !== normalized && hasToken) {
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

  state.aiRequestInFlight = "login";
  await refreshUi();
  let loginSucceeded = false;
  let loginFailureMessage = "";
  try {
    const loginUrl = buildLoginEndpointFromStageBase(stageBase);
    if (!loginUrl) {
      loginFailureMessage = PopupText.authentication.toastSetValidStageBaseFirst;
    } else {
      const response = await fetch(loginUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });
      await maybeUpdateStoredTokenFromResponse(response, "");
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (!response.ok) {
        loginFailureMessage =
          (payload && typeof payload.error === "string" && payload.error) ||
          (payload && typeof payload.message === "string" && payload.message) ||
          formatLoginFailedStatus(response.status);
      } else {
        const token = payload && typeof payload.token === "string" ? payload.token.trim() : "";
        if (!token) {
          loginFailureMessage = PopupText.authentication.toastResponseMissingToken;
        } else {
          await utils.storageSet(chrome.storage.sync, {
            globalStageBase: stageBase,
            globalToken: token
          });
          uiModule.setViewState({ loginPasswordValue: "" });
          loginSucceeded = true;
        }
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

async function handlePageSave() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  const wasReconciliationPending = Boolean(state.currentPageSaveReconciliationPending);
  if (!wasReconciliationPending && !ensureMobileSimulationForSave()) {
    return;
  }
  await runWithPopupBusyOverlay(PopupText.overlay.savingPage, async () => {
    const response = await messages.sendTabMessage({
      type: "savePageDraft",
      baseUrl: state.currentBaseUrl,
      pageType: state.currentPageTypeKey || ""
    });
    if (!response || !response.ok) {
      updateLastConfigSaveStatus(PopupText.page.saveFailed);
      uiModule.showToast(PopupText.page.saveFailedToast);
      return;
    }
    if (response.saved) {
      updateLastConfigSaveStatus(PopupText.page.savedLocallySyncPending);
      const pageUrl = getCurrentPageUrl();
      const { tokenValue, configEndpointValue, stageBaseValue } =
        await helpers.loadGlobalAiSettings();
      const syncResult = await syncBaseConfigToServer({
        baseUrl: state.currentBaseUrl,
        pageUrl,
        endpointValue: configEndpointValue,
        tokenValue,
        stageBase: stageBaseValue,
        alertOnCurrentReplacement: true
      });
      const syncSkipped = Boolean(syncResult && syncResult.skipped);
      const syncCompleted = isCompletedPageConfigSyncResult(syncResult);
      if (!syncCompleted) {
        await setCurrentPageSaveReconciliationReason(syncSkipped ? "sync_skipped" : "sync_failed");
        updateLastConfigSaveStatus(
          syncSkipped
            ? PopupText.page.savedLocallySyncSkipped
            : PopupText.page.savedLocallySyncFailed
        );
        uiModule.showToast(
          syncSkipped
            ? PopupText.page.pageSavedLocallySyncSkipped
            : PopupText.page.pageSavedLocallySyncFailed
        );
      } else {
        const effectiveBaseUrl = (syncResult && syncResult.baseUrl) || state.currentBaseUrl;
        const configs = await config.getConfigs();
        const refreshedConfig = config.normalizeConfig(
          effectiveBaseUrl,
          configs[effectiveBaseUrl]
        ).config;
        const refreshedSiteId = normalizeSiteIdValue(refreshedConfig.siteId);
        const loadResult = refreshedSiteId
          ? await loadRemoteConfigForCurrentPage({
            tabId: state.currentTab && state.currentTab.id,
            pageUrl,
            siteId: refreshedSiteId,
            endpointValue: configEndpointValue,
            tokenValue,
            force: true
          })
          : { status: "error", baseUrl: "" };
        if (!loadResult || loadResult.status !== "ok") {
          await setCurrentPageSaveReconciliationReason("load_failed");
          updateLastConfigSaveStatus(PopupText.page.savedAndSyncedRefreshFailed);
          uiModule.showToast(PopupText.page.pageSavedAndSyncedRefreshFailed);
        } else {
          await clearCurrentPageSaveReconciliation(effectiveBaseUrl);
          updateLastConfigSaveStatus(PopupText.page.savedAndSynced);
          uiModule.showToast(PopupText.page.pageSaved);
        }
      }
    } else {
      updateLastConfigSaveStatus(PopupText.page.noLocalChangesToSave);
      uiModule.showToast(PopupText.page.noChangesToSave);
    }
    await refreshUi();
  });
}

async function handlePageRevert() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  const confirmed = window.confirm(PopupText.page.revertConfirm);
  if (!confirmed) {
    return;
  }
  await runWithPopupBusyOverlay(PopupText.overlay.revertingPage, async () => {
    const response = await messages.sendTabMessage({
      type: "revertPageDraft",
      baseUrl: state.currentBaseUrl
    });
    if (!response || !response.ok) {
      updateLastConfigSaveStatus(PopupText.page.revertFailed);
      uiModule.showToast(PopupText.page.revertFailedToast);
      return;
    }
    await setCurrentPageSaveReconciliationReason("pending");
    const pageUrl = getCurrentPageUrl();
    const { tokenValue, configEndpointValue, stageBaseValue } =
      await helpers.loadGlobalAiSettings();
    const syncResult = await syncBaseConfigToServer({
      baseUrl: state.currentBaseUrl,
      pageUrl,
      endpointValue: configEndpointValue,
      tokenValue,
      stageBase: stageBaseValue,
      alertOnCurrentReplacement: true
    });
    const syncSkipped = Boolean(syncResult && syncResult.skipped);
    const syncCompleted = isCompletedPageConfigSyncResult(syncResult);
    if (!syncCompleted) {
      await setCurrentPageSaveReconciliationReason(syncSkipped ? "sync_skipped" : "sync_failed");
      updateLastConfigSaveStatus(
        syncSkipped
          ? PopupText.page.revertedLocallySyncSkipped
          : PopupText.page.revertedLocallySyncFailed
      );
      uiModule.showToast(
        syncSkipped
          ? PopupText.page.revertedLocallyServerSyncSkipped
          : PopupText.page.revertedLocallyServerSyncFailed
      );
    } else {
      const effectiveBaseUrl = (syncResult && syncResult.baseUrl) || state.currentBaseUrl;
      const configs = await config.getConfigs();
      const refreshedConfig = config.normalizeConfig(
        effectiveBaseUrl,
        configs[effectiveBaseUrl]
      ).config;
      const refreshedSiteId = normalizeSiteIdValue(refreshedConfig.siteId);
      const loadResult = refreshedSiteId
        ? await loadRemoteConfigForCurrentPage({
          tabId: state.currentTab && state.currentTab.id,
          pageUrl,
          siteId: refreshedSiteId,
          endpointValue: configEndpointValue,
          tokenValue,
          force: true
        })
        : { status: "error", baseUrl: "" };
      if (!loadResult || loadResult.status !== "ok") {
        await setCurrentPageSaveReconciliationReason("load_failed");
        updateLastConfigSaveStatus(PopupText.page.savedAndSyncedRefreshFailed);
        uiModule.showToast(PopupText.page.pageSavedAndSyncedRefreshFailed);
      } else {
        await clearCurrentPageSaveReconciliation(effectiveBaseUrl);
        updateLastConfigSaveStatus(PopupText.page.revertedAndSynced);
        uiModule.showToast(PopupText.page.revertedToLastSaved);
      }
    }
    await refreshUi();
  });
}

async function requestAiRunStart({ endpointValue = "", tokenValue = "", payload = null } = {}) {
  const computeSelectorsUrl = resolveRelativeEndpoint(endpointValue, "/get_selectors");
  if (!computeSelectorsUrl) {
    return { ok: false };
  }
  const response = await fetch(computeSelectorsUrl, {
    method: "POST",
    headers: createConfigSyncHeaders(tokenValue),
    body: JSON.stringify(payload || {})
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  if (!response.ok) {
    return { ok: false };
  }
  const sessionId = parseAiRunStartResponse(await response.json());
  if (!sessionId) {
    return { ok: false };
  }
  return { ok: true, sessionId };
}

async function requestAiRunStatus({ endpointValue = "", tokenValue = "", sessionId = "" } = {}) {
  const statusUrl = resolveRelativeEndpoint(
    endpointValue,
    `/get_selectors/status/${encodeURIComponent(sessionId)}`
  );
  if (!statusUrl) {
    return { ok: false };
  }
  const response = await fetch(statusUrl, {
    method: "GET",
    headers: createConfigSyncHeaders(tokenValue)
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

async function requestAiRunResult({ endpointValue = "", tokenValue = "", sessionId = "" } = {}) {
  const resultUrl = resolveRelativeEndpoint(
    endpointValue,
    `/get_selectors/result/${encodeURIComponent(sessionId)}`
  );
  if (!resultUrl) {
    return { ok: false };
  }
  const response = await fetch(resultUrl, {
    method: "GET",
    headers: createConfigSyncHeaders(tokenValue)
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  if (response.status === 404) {
    return { ok: false, notFound: true };
  }
  if (!response.ok) {
    return { ok: false };
  }
  const data = await response.json();
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

async function applyComputedSelectorSet(selectorSet, { currentPageUrl = "", tokenValue = "" } = {}) {
  const selectorsChanged =
    !config.isSelectorSetCurrentForRenderMode(state.currentConfig, "selectors") ||
    !aiSelectorSetsEqual(
      selectorSet,
      state.currentConfig && state.currentConfig.selectors
    );
  const selectorSetUpdatedAt = selectorsChanged
    ? config.createTimestampNow()
    : config.normalizeEntryTimestamp(
        state.currentConfig && state.currentConfig.selectorsUpdatedAt
      );
  state.currentConfig = await config.updateConfig(state.currentBaseUrl, (targetConfig) => {
    targetConfig.selectors = normalizeAiSelectorSet(selectorSet);
    targetConfig.selectorsUpdatedAt = selectorSetUpdatedAt;
  });
  const hasComputedNewSelectors =
    !aiSelectorSetsEqual(selectorSet, getLastSubmittedSelectorsFromConfig(state.currentConfig));
  state.aiSelectorsComputedSinceLastSubmit = hasComputedNewSelectors;
  state.aiSelectorsComputedBaseUrl = hasComputedNewSelectors ? state.currentBaseUrl : "";

  await messages.sendTabMessage({ type: "configUpdated", baseUrl: state.currentBaseUrl });
  const previewResponse = await messages.sendTabMessage({
    type: "showAiPreview",
    selectorSet
  });
  const previewOpened = Boolean(previewResponse && previewResponse.ok);
  const { configEndpointValue, stageBaseValue } = await helpers.loadGlobalAiSettings();
  const syncResult = await syncBaseConfigToServer({
    baseUrl: state.currentBaseUrl,
    pageUrl: currentPageUrl,
    endpointValue: configEndpointValue,
    tokenValue,
    stageBase: stageBaseValue,
    alertOnCurrentReplacement: false
  });
  const syncSkipped = Boolean(syncResult && syncResult.skipped);
  const syncFailed = !syncSkipped && !isSuccessfulConfigSyncResult(syncResult);
  updateLastConfigSaveStatus(
    syncSkipped
      ? PopupText.ai.selectorsUpdatedLocallySyncSkipped
      : syncFailed
        ? PopupText.ai.selectorsUpdatedLocallySyncFailed
        : PopupText.ai.selectorsUpdatedAndSynced
  );
  if (syncSkipped && syncResult.reason) {
    uiModule.showToast(formatSelectorsComputedLocally(syncResult.reason));
  } else if (syncSkipped) {
    uiModule.showToast(PopupText.ai.selectorsComputedLocallySyncSkipped);
  } else if (syncFailed) {
    uiModule.showToast(PopupText.ai.selectorsComputedLocallySyncFailed);
  } else {
    uiModule.showToast(PopupText.ai.selectorsComputedAndSaved);
  }
  return { previewOpened };
}

async function failAiRun(message = PopupText.ai.runFailed) {
  await stopAiRun({ unlockPage: true });
  uiModule.showToast(message);
}

async function continueAiRunPolling({ endpointValue = "", tokenValue = "", currentPageUrl = "" } = {}) {
  while (state.aiRequestInFlight === "compute" && state.aiRunSessionId) {
    const sessionId = state.aiRunSessionId;
    const remainingMs = getAiRunRemainingMs(state.aiRunDeadlineAt);
    if (!remainingMs) {
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
      await failAiRun(PopupText.ai.runTimedOut);
      return;
    }
    let statusResult;
    try {
      statusResult = await requestAiRunStatus({
        endpointValue,
        tokenValue,
        sessionId
      });
    } catch {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    if (statusResult.notFound) {
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
          endpointValue,
          tokenValue,
          sessionId
        });
    } catch {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    if (result.notFound) {
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
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeUsingAi);
    return;
  }
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  if (state.currentDraftDirty) {
    uiModule.showToast(PopupText.ai.dirtyNotice);
    return;
  }
  const credentials = await helpers.requireAiCredentials();
  if (!credentials) {
    return;
  }
  const { endpointValue, tokenValue } = credentials;

  state.currentConfig = await config.ensureConfig(state.currentBaseUrl);
  const currentPageUrl = (state.currentTab && state.currentTab.url) || "";
  if (!currentPageUrl) {
    uiModule.showToast(PopupText.ai.currentPageUnavailable);
    return;
  }
  const pageMarkings = state.currentConfig.pageMarkings || {};
  const currentPageEntry = pageMarkings[currentPageUrl];
  if (!currentPageEntry || typeof currentPageEntry !== "object") {
    uiModule.showToast(PopupText.ai.saveCurrentPageBeforeComputing);
    return;
  }
  const currentPageHtml =
    typeof currentPageEntry.renderedHtml === "string" ? currentPageEntry.renderedHtml : "";
  const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
  if (!currentPageHtml) {
    uiModule.showToast(PopupText.ai.saveCurrentPageBeforeComputing);
    return;
  }
  const hasCurrentSubmissionXpaths =
    Array.isArray(currentPageEntry.submissionXpaths) &&
    currentPageEntry.submissionXpaths.length > 0;
  if (!hasCurrentSubmissionXpaths) {
    // AI compute no longer rebuilds xpaths from stored HTML. The live DOM decides
    // visibility/hidden/excluded state when the page is saved, and that snapshot
    // (`submissionXpaths`) becomes the source of truth for later AI requests.
    uiModule.showToast(PopupText.ai.saveCurrentPageBeforeComputing);
    return;
  }

  // Build the AI payload from stored page snapshots only. We intentionally avoid
  // any compute-time DOM/HTML reclassification here to keep AI input consistent
  // with the last saved page state.
  const toAiPayloadXpaths = (entry) => {
    const explicitIncludeXpaths = new Set(
      Array.isArray(entry && entry.includeXpaths)
        ? entry.includeXpaths
          .filter((xpath) => typeof xpath === "string" && xpath)
          .map((xpath) => xpath.trim())
          .filter(Boolean)
        : []
    );
    return (Array.isArray(entry && entry.submissionXpaths) ? entry.submissionXpaths : [])
      .filter((item) => item && typeof item.xpath === "string" && item.xpath)
      .map((item) => {
        const xpath = item.xpath.trim();
        const excluded = Boolean(item.excluded);
        if (excluded) {
          return { xpath, excluded: true };
        }
        return {
          xpath,
          excluded: false,
          explicit: explicitIncludeXpaths.has(xpath)
        };
      })
      .filter((item) => item && !isAiSubmissionDocumentRootXpath(item.xpath));
  };
  const storedPageEntries = Object.entries(pageMarkings)
    .filter(([url, entry]) => {
      if (!url || !entry || typeof entry !== "object") {
        return false;
      }
      if (state.currentBaseUrl && !utils.isPageWithinBaseUrl(url, state.currentBaseUrl)) {
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
    // Guard against stale state where the current tab exists in `pageMarkings`
    // but does not yet have the required saved snapshot fields.
    uiModule.showToast(PopupText.ai.saveCurrentPageBeforeComputing);
    return;
  }

  if (!storedPageEntries.length) {
    uiModule.showToast(PopupText.ai.savePagesBeforeComputing);
    return;
  }

  const rawHtmlBackfills = await backfillRawHtmlForPages(
    state.currentBaseUrl,
    storedPageEntries.map(([url]) => url),
    pageMarkings
  );

  const storedPages = storedPageEntries.map(([url, entry]) => {
    const { renderedHtml, rawHtml } = getStoredPageHtmlSnapshot(entry, url, rawHtmlBackfills);
    const isStatic = currentRenderMode === "static";
    const renderedXPaths = toAiPayloadXpaths(entry);
    return {
      url,
      renderedHtml,
      rawHtml: isStatic ? rawHtml : undefined,
      renderedXPaths,
      rawXPaths: isStatic ? refineXPathEntries(renderedHtml, rawHtml, renderedXPaths) : undefined
    };
  });

  const payload = {
    baseUrl: state.currentBaseUrl,
    renderMode: currentRenderMode,
    defaultExclusionSelectors: constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
    pages: storedPages
  };
  const siteId = normalizeSiteIdValue(state.currentSiteId || (state.currentConfig && state.currentConfig.siteId));
  const deadlineAt = Date.now() + AI_RUN_TIMEOUT_MS;
  setAiRunActiveState({
    siteId,
    deadlineAt,
    resumed: false,
    phase: "starting"
  });
  await refreshUi();
  try {
    const startResult = await requestAiRunStart({
      endpointValue,
      tokenValue,
      payload
    });
    if (!startResult.ok || !startResult.sessionId) {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    state.aiRunSessionId = startResult.sessionId;
    state.aiRunPhase = "running";
    const heartbeat = await refreshAiRunHeartbeat({
      sessionId: startResult.sessionId,
      siteId,
      deadlineAt
    });
    if (!heartbeat) {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    await continueAiRunPolling({
      endpointValue,
      tokenValue,
      currentPageUrl
    });
  } catch {
    await failAiRun(PopupText.ai.runFailed);
  }
}

async function backfillRawHtmlForPages(baseUrl, urls, pageMarkings) {
  const urlsMissingRawHtml = urls
    .filter((url) => {
      const entry = pageMarkings[url];
      return !entry || typeof entry.rawHtml !== "string" || !entry.rawHtml;
    });
  if (!urlsMissingRawHtml.length) {
    return new Map();
  }
  const backfillResults = await Promise.all(
    urlsMissingRawHtml.map(async (url) => {
      const response = await messages.sendRuntimeMessage({
        type: "fetchStaticPageHtml",
        url
      });
      if (!response || !response.ok || typeof response.html !== "string" || !response.html) {
        return null;
      }
      return {
        url,
        rawHtml: response.html
      };
    })
  );
  const rawHtmlBackfills = new Map();
  const successfulBackfills = backfillResults.filter(Boolean);
  successfulBackfills.forEach((item) => {
    rawHtmlBackfills.set(item.url, item.rawHtml);
  });
  if (successfulBackfills.length && baseUrl) {
    state.currentConfig = await config.updateConfig(baseUrl, (targetConfig) => {
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
  return rawHtmlBackfills;
}

function getStoredPageHtmlSnapshot(entry, url, rawHtmlBackfills) {
  return {
    renderedHtml: entry && typeof entry.renderedHtml === "string" ? entry.renderedHtml : "",
    rawHtml:
      entry && typeof entry.rawHtml === "string" && entry.rawHtml
        ? entry.rawHtml
        : rawHtmlBackfills.get(url) || ""
  };
}

async function postPageTypeAssignmentsToAiServer(options = {}) {
  const {
    endpointValue = "",
    tokenValue = "",
    baseUrl = state.currentBaseUrl,
    pageMarkings = {},
    checklistPageTypes = state.lynxChecklistPageTypes
  } = options;
  try {
    const assignPageTypesUrl = resolveRelativeEndpoint(endpointValue, "/assign_page_types");
    if (!assignPageTypesUrl) {
      return;
    }
    const storedPageMarkingItems = collectStoredPageMarkingItems(pageMarkings, baseUrl);
    const assignments = buildLynxChecklistAssignments({
      pageTypes: checklistPageTypes,
      markedPages: storedPageMarkingItems
    });
    if (!assignments.length) {
      return;
    }
    const rawHtmlBackfills = await backfillRawHtmlForPages(
      baseUrl,
      assignments.map((item) => item.url),
      pageMarkings
    );
    const payload = assignments.map((item) => {
      const entry = pageMarkings[item.url];
      const { rawHtml, renderedHtml } = getStoredPageHtmlSnapshot(
        entry,
        item.url,
        rawHtmlBackfills
      );
      return {
        url: item.url,
        rawHtml,
        renderedHtml,
        pageType: item.pageType
      };
    });
    const response = await fetch(assignPageTypesUrl, {
      method: "POST",
      headers: createConfigSyncHeaders(tokenValue),
      body: JSON.stringify(payload)
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
  } catch (error) {
    console.warn("Unable to assign page types to AI server.", error);
  }
}

async function submitSelectorSetToServer(options = {}) {
  const {
    baseUrl = state.currentBaseUrl,
    selectorSet = getCurrentSelectorsFromConfig(),
    tokenValue = ""
  } = options;

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

  state.aiRequestInFlight = "save";
  await refreshUi();
  try {
    await postPageTypeAssignmentsToAiServer({
      endpointValue,
      tokenValue: submitTokenValue,
      baseUrl: effectiveBaseUrl,
      pageMarkings: (state.currentConfig && state.currentConfig.pageMarkings) || {},
      checklistPageTypes: state.lynxChecklistPageTypes
    });
    submitTokenValue = (await getStoredGlobalToken()) || submitTokenValue;
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: createConfigSyncHeaders(submitTokenValue),
      body: JSON.stringify({
        query: UPDATE_SCRAPING_CONDITIONS_MUTATION,
        variables: {
          domainId: siteIdResult.siteId,
          includeCss,
          excludeCss,
          renderingMode: renderMode
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, submitTokenValue);
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (!response.ok) {
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
        state.currentConfig && state.currentConfig.selectors
      );
    const selectorSetUpdatedAt = selectorsNeedRefresh
      ? config.createTimestampNow()
      : config.normalizeEntryTimestamp(
          state.currentConfig && state.currentConfig.selectorsUpdatedAt
        );
    const submittedSelectorsFingerprint = getSelectorSetFingerprint(normalizedSelectorSet);
    state.currentConfig = await config.updateConfig(effectiveBaseUrl, (targetConfig) => {
      targetConfig.selectors = normalizeAiSelectorSet(normalizedSelectorSet);
      targetConfig.selectorsUpdatedAt = selectorSetUpdatedAt;
      targetConfig.submittedSelectorsFingerprint = submittedSelectorsFingerprint;
    });
    state.aiSelectorsComputedSinceLastSubmit = false;
    state.aiSelectorsComputedBaseUrl = "";
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
  const checklist = buildLynxChecklistViewModel({
    aiAnswer: state.lynxChecklistAiAnswer,
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
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  openLynxChecklistPopover();
}

async function handlePreviewLatest() {
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
  state.lastPopupEnabled = null;
  collapseTodoListForAutoCollapse();
  setPreviewBlocked(true, PopupText.preview.blockedActive);
  try {
    const response = await messages.sendTabMessage({
      type: "showAiPreview",
      selectorSet
    });
    if (!response || !response.ok) {
      throw new Error(PopupText.preview.openFailed);
    }
    await refreshUi();
  } catch (error) {
    setPreviewBlocked(false);
    uiModule.showToast((error && error.message) || PopupText.preview.openFailed);
    await refreshUi();
  }
}

async function handleExitPreviewMode() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  const response = await messages.sendTabMessage({ type: "closeAiPreview" });
  if (!response || !response.ok) {
    uiModule.showToast(PopupText.preview.exitFailed);
  }
}

async function handlePreviewItemFocus(xpath) {
  if (!xpath || !await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  uiModule.setViewState({ previewFocusedXpath: xpath });
  const response = await messages.sendTabMessage({
    type: "focusElement",
    xpath
  });
  if (!response || !response.ok) {
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
    await refreshUi();
  }, 120);
}

async function init() {
  await helpers.ensureActiveTab();
  logPopupReady(console, state);
  await ensureThemeSettings();

  uiModule.initUi({
    onToggleEnabled: handleEnableToggle,
    onDeviceEmulationEnabledChange: handleDeviceEmulationEnabledToggle,
    onDeviceScaleInput: handleDeviceScaleInput,
    onDeviceScaleChange: handleDeviceScaleChange,
    onConfigToggle: handleConfigToggle,
    onConfigMenuClick: handleConfigMenuClick,
    onBasePageMenuToggle: handleBasePageMenuToggle,
    onBasePageMenuClick: handleBasePageMenuClick,
    onTodoControlsMenuToggle: handleTodoControlsMenuToggle,
    onTodoControlsMenuClick: handleTodoControlsMenuClick,
    onTodoSectionToggle: handleTodoSectionToggle,
    onTodoSubsectionToggle: handleTodoSubsectionToggle,
    onTodoExpandAll: handleTodoExpandAll,
    onTodoCollapseAll: handleTodoCollapseAll,
    onTodoAutoCollapseToggle: handleTodoAutoCollapseToggle,
    onConfigurationExtrasToggle: handleConfigurationExtrasToggle,
    onOpenConfiguration: handleOpenConfigurationView,
    onConfigurationContinue: handleConfigurationContinue,
    onClearDomainCache: handleClearDomainCache,
    onUnregisterCurrentTab: handleUnregisterCurrentTab,
    onPageSave: handlePageSave,
    onPageRevert: handlePageRevert,
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
    onLynxChecklistAiAnswerChange: handleLynxChecklistAiAnswerChange,
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
    onRemoteSupportRequest: handleRemoteSupportRequest,
    onRemoteSupportJoinCodeInput: handleRemoteSupportJoinCodeInput,
    onRemoteSupportJoin: handleRemoteSupportJoin,
    onRemoteSupportEnd: handleRemoteSupportEnd,
    onRemoteSupportCameraToggle: handleRemoteSupportCameraToggle,
    onRemoteSupportMicrophoneToggle: handleRemoteSupportMicrophoneToggle,
    onRemoteSupportSoundToggle: handleRemoteSupportSoundToggle,
    onRemoteSupportDockExternalize: handleRemoteSupportDockExternalize,
    onRemoteSupportErrorDismiss: handleRemoteSupportErrorDismiss,
    onPropertyLockTake: handlePropertyLockTake,
    onPropertyLockSuggest: handlePropertyLockSuggest,
    onPropertyLockContinue: handlePropertyLockContinue,
    onPropertyLockAcceptSuggestion: handlePropertyLockAcceptSuggestion,
    onPropertyLockRejectSuggestion: handlePropertyLockRejectSuggestion,
    onCompute: handleComputeSelectors,
    onSaveExcludes: handleSaveExcludes,
    onPreviewLatest: handlePreviewLatest,
    onPreviewItemFocus: handlePreviewItemFocus,
    onExitPreviewMode: handleExitPreviewMode,
    onExplicitExcludeView: handleExplicitExcludeView,
    onExplicitExcludeRemove: handleExplicitExcludeRemove,
    onExplicitIncludeView: handleExplicitIncludeView,
    onExplicitIncludeRemove: handleExplicitIncludeRemove,
    onMarkedPageNavigate: handleMarkedPageNavigate,
    onBasePageNavigate: handleBasePageNavigate
  });
  ensureRemoteSupportPopupMediaChannel();

  uiModule.onViewStateChange((viewState) => {
    scheduleRemoteSupportSidebarSnapshotSync(viewState);
    scheduleRemoteSupportSidebarStreamCapture();
    if (
      viewState.remoteSupportMode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
      viewState.remoteSupportSessionActive &&
      viewState.remoteSupportDockState === REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP
    ) {
      openRemoteSupportDockPiP().catch(() => {});
    } else if (
      remoteSupportDockPiPWindow &&
      (remoteSupportDockPiPWindow.closed || !viewState.remoteSupportSessionActive)
    ) {
      try {
        remoteSupportDockPiPWindow.close();
      } catch {}
      remoteSupportDockPiPWindow = null;
    }
    syncRemoteSupportDockPiPWindow();
  });

  document.addEventListener("click", () => {
    uiModule.setConfigMenuOpen(false);
    uiModule.setBasePageMenuOpen(false);
    uiModule.setTodoControlsMenuOpen(false);
    uiModule.setThemeMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      uiModule.setConfigMenuOpen(false);
      uiModule.setBasePageMenuOpen(false);
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
      if (!view.deviceControlsDisabled) {
        const nextEnabled = !view.deviceEmulationEnabled;
        if (nextEnabled) {
          helpers.updateDeviceEmulation({
            enabled: true,
            mode: "mobile",
            scale: state.currentDeviceScale
          }).then();
        } else {
          handleDeviceEmulationEnabledToggle({
            currentTarget: { checked: false }
          }).then();
        }
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
    if (state.currentTab && tab.windowId !== state.currentTab.windowId) {
      return;
    }
    await helpers.ensureActiveTab();
    await refreshUi();
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!state.currentTab || tabId !== state.currentTab.id) {
      return;
    }
    if (changeInfo.url || changeInfo.status === "complete") {
      state.currentTab = tab;
      await refreshUi();
    }
  });
  window.addEventListener("beforeunload", () => {
    if (remoteSupportDockPiPWindow && !remoteSupportDockPiPWindow.closed) {
      setRemoteSupportDockState(REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED).then();
      try {
        remoteSupportDockPiPWindow.close();
      } catch {}
      remoteSupportDockPiPWindow = null;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
      if (changes[GLOBAL_THEME_KEY] || changes[GLOBAL_THEME_MODE_KEY]) {
        if (changes[GLOBAL_THEME_KEY]) {
          state.currentTheme = normalizeThemeValue(
            changes[GLOBAL_THEME_KEY].newValue
          );
        }
        if (changes[GLOBAL_THEME_MODE_KEY]) {
          state.currentThemeMode = normalizeThemeModeValue(
            changes[GLOBAL_THEME_MODE_KEY].newValue
          );
        }
        applyPopupTheme(state.currentTheme, state.currentThemeMode);
        scheduleRefresh();
      }
      return;
    }
    if (areaName !== "local" && areaName !== "session") {
      return;
    }
    if (
      (areaName === "local" && changes.configs) ||
      (areaName === "session" &&
        state.currentTab &&
        (changes[`${constants.TAB_STATE_PREFIX}${state.currentTab.id}`] ||
          changes[`${constants.DEVICE_EMULATION_PREFIX}${state.currentTab.id}`]))
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
      sender.tab.id !== state.currentTab.id
    ) {
      return;
    }
    if (message && message.type === PROPERTY_LOCK_BACKGROUND_STATE_UPDATE) {
      const messageSiteId = normalizeSiteIdValue(message.siteId);
      if (
        messageSiteId &&
        state.propertyLockSiteId &&
        messageSiteId !== state.propertyLockSiteId
      ) {
        return;
      }
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
      (async () => {
        try {
          setPreviewBlocked(false);
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
    if (message && message.type === "remoteSupportStateChanged") {
      const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
        ? state.currentTab.id
        : null;
      if (currentTabId !== null && Number.isFinite(message.tabId) && Number(message.tabId) !== currentTabId) {
        return;
      }
      state.remoteSupportState = message.state || null;
      syncRemoteSupportViewState(state.remoteSupportState);
      scheduleRefresh();
      return;
    }
    if (message && message.type === "remoteSupportFrame") {
      const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
        ? state.currentTab.id
        : null;
      if (currentTabId !== null && Number.isFinite(message.tabId) && Number(message.tabId) !== currentTabId) {
        return;
      }
      const image = typeof message.frame === "string"
        ? message.frame
        : (message.frame && typeof message.frame.dataUrl === "string" ? message.frame.dataUrl : "");
      state.remoteSupportLastFrame = image;
      const scopedState = scopeRemoteSupportStateToTab(
        state.remoteSupportState,
        state.currentTab && Number.isFinite(state.currentTab.id) ? state.currentTab.id : null
      );
      uiModule.setViewState({
        remoteSupportPreviewImage: Boolean(scopedState.active) ? image : ""
      });
      return;
    }
    if (!message || message.type !== "pageDraftChanged") {
      if (message && message.type === "consentXpathsChanged") {
        if (state.currentBaseUrl && utils.sameBaseUrl(message.baseUrl, state.currentBaseUrl)) {
          const hasSavedData = Boolean(
            state.currentSavedEntry &&
              ((Array.isArray(state.currentSavedEntry.xpaths) &&
                state.currentSavedEntry.xpaths.length > 0) ||
                (Array.isArray(state.currentSavedEntry.includeXpaths) &&
                  state.currentSavedEntry.includeXpaths.length > 0) ||
                (Array.isArray(state.currentSavedEntry.consentXpaths) &&
                  state.currentSavedEntry.consentXpaths.length > 0) ||
                (typeof state.currentSavedEntry.renderedHtml === "string" &&
                  state.currentSavedEntry.renderedHtml.length > 0))
          );
          if (hasSavedData) {
            window.alert(PopupText.consent.changedAlert);
          }
          scheduleRefresh();
        }
      }
      return;
    }
    if (state.currentBaseUrl && utils.sameBaseUrl(message.baseUrl, state.currentBaseUrl)) {
      scheduleRefresh();
    }
  });

  if (state.tokenValidationTimer) {
    window.clearInterval(state.tokenValidationTimer);
  }
  state.tokenValidationTimer = window.setInterval(async () => {
    const isValid = await validateStoredToken({ force: true, showToastOnInvalid: true });
    if (!isValid) {
      await refreshUi();
    }
  }, TOKEN_VALIDATION_INTERVAL_MS);

  await refreshUi();
}

init();
