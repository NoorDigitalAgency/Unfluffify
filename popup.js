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
  normalizeAiSelectorSet,
  combineAiSelectorSet,
  aiSelectorSetsEqual
} from "./common/selector-set.js";
import { installExtensionTelemetry } from "./common/extension-telemetry.js";
import {
  SPINNER_OWNERS,
  WORLD_MESSAGE_TYPES,
  buildPopupStatePortName
} from "./common/world-messaging-contract.js";
import {
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED,
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
  REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP,
  getRemoteSupportDockFallbackState,
  isRemoteSupportPageUrl,
  REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
  REMOTE_SUPPORT_MODE_SUPPORTING,
  formatRemoteSupportCountdown,
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

installExtensionTelemetry({
  source: "popup",
  getTabId: () => getPopupTelemetryTabId(state),
  getIncludePayloads: () => getPopupTelemetryIncludePayloads(state)
});

function isPropertyLockCollaborationEnabled() {
  return isFeatureEnabled("propertyLockCollaboration");
}

function resetDisabledPropertyLockState() {
  clearPropertyLockOffCandidateRefreshTimer();
  resetPropertyLockState();
  state.propertyLockState = createInactiveLockState();
  state.propertyLockEditorBootstrapPending = false;
}

function resetPropertyLockState() {
  state.propertyLockSiteId = null;
  state.propertyLockState = null;
  state.propertyLockConnectionStatus = PROPERTY_LOCK_CONNECTION_INACTIVE;
  state.propertyLockConnectionError = "";
  state.propertyLockIdentity = "";
  state.propertyLockName = "";
  state.propertyLockClientId = "";
  state.propertyLockSecondsRemaining = null;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionPending = false;
  state.propertyLockSuggestionRejected = false;
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockDisconnectCountdown = null;
  state.propertyLockTransferCountdown = null;
  state.propertyLockOffCandidateDeadlineAt = 0;
  state.propertyLockRecoverySiteId = null;
  state.propertyLockRecoveryBaseUrl = "";
  state.propertyLockRecoveryClientId = "";
  state.propertyLockRecoveryDeadlineAt = 0;
  state.propertyLockEditorBootstrapPending = false;
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
  state.propertyLockOffCandidateDeadlineAt = 0;
}

function clearPropertyLockOffCandidateRefreshTimer() {
  if (!state.propertyLockOffCandidateRefreshTimer) {
    return;
  }
  window.clearInterval(state.propertyLockOffCandidateRefreshTimer);
  state.propertyLockOffCandidateRefreshTimer = 0;
}

function syncPropertyLockOffCandidateRefreshTimer(active) {
  if (!isPropertyLockCollaborationEnabled()) {
    clearPropertyLockOffCandidateRefreshTimer();
    return;
  }
  if (!active) {
    clearPropertyLockOffCandidateRefreshTimer();
    return;
  }
  if (state.propertyLockOffCandidateRefreshTimer) {
    return;
  }
  state.propertyLockOffCandidateRefreshTimer = window.setInterval(() => {
    if (
      (
        !state.propertyLockOffCandidateDeadlineAt ||
        state.propertyLockOffCandidateDeadlineAt <= Date.now()
      ) &&
      (
        !state.propertyLockRecoveryDeadlineAt ||
        state.propertyLockRecoveryDeadlineAt <= Date.now()
      )
    ) {
      clearPropertyLockOffCandidateRefreshTimer();
    }
    refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true }).catch(() => {});
  }, 1000);
}

async function persistPropertyLockRecoveryMetadata(tabId, recoveryState = {}) {
  if (!isPropertyLockCollaborationEnabled()) {
    return;
  }
  if (!Number.isFinite(tabId)) {
    return;
  }
  await messages.setTabState(tabId, {
    active: true,
    propertyLockRecoverySiteId: Number.isFinite(recoveryState.siteId)
      ? Number(recoveryState.siteId)
      : null,
    propertyLockRecoveryBaseUrl: typeof recoveryState.baseUrl === "string"
      ? recoveryState.baseUrl
      : "",
    propertyLockRecoveryClientId: typeof recoveryState.clientId === "string"
      ? recoveryState.clientId
      : "",
    propertyLockRecoveryDeadlineAt: Number.isFinite(recoveryState.deadlineAt)
      ? Number(recoveryState.deadlineAt)
      : 0
  }, "initial");
}

function applyPropertyLockState(lockStateLike) {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  state.propertyLockState = normalizeLockStateMessage(lockStateLike || createInactiveLockState(), {
    ownIdentity: state.propertyLockIdentity,
    clientId: state.propertyLockClientId
  });
  clearPropertyLockTransientState();
}

function queueEditorBootstrapOnLockTransition(previousLockState, nextLockState) {
  if (!isPropertyLockCollaborationEnabled()) {
    return;
  }
  if (
    previousLockState &&
    !previousLockState.isEditor &&
    nextLockState &&
    nextLockState.isEditor
  ) {
    state.propertyLockEditorBootstrapPending = true;
  }
}

function applyPropertyLockConnectionStatus(status, error = "") {
  if (!isPropertyLockCollaborationEnabled()) {
    state.propertyLockConnectionStatus = PROPERTY_LOCK_CONNECTION_INACTIVE;
    state.propertyLockConnectionError = "";
    return;
  }
  state.propertyLockConnectionStatus = typeof status === "string" && status
    ? status
    : PROPERTY_LOCK_CONNECTION_INACTIVE;
  state.propertyLockConnectionError = typeof error === "string" ? error : "";
}

function applyPropertyLockServerMessage(serverMessage, siteId = null) {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return false;
  }
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
    const previousLockState = state.propertyLockState;
    applyPropertyLockState(serverMessage);
    queueEditorBootstrapOnLockTransition(previousLockState, state.propertyLockState);
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
    state.propertyLockState = {
      ...(state.propertyLockState || createInactiveLockState()),
      transferFromName: String(serverMessage.transferFromName || serverMessage.fromName || state.propertyLockState?.transferFromName || ""),
      transferToName: String(serverMessage.transferToName || serverMessage.toName || state.propertyLockState?.transferToName || state.propertyLockSuggestionFromName || "")
    };
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
  if (!isPropertyLockCollaborationEnabled()) {
    return false;
  }
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
  const propertyLockFeatureEnabled = isPropertyLockCollaborationEnabled();
  const lockState = propertyLockFeatureEnabled
    ? (state.propertyLockState || createInactiveLockState())
    : createInactiveLockState();
  const editorName = lockState.editorName || "Someone";
  const sameUserEditor = Boolean(lockState.isSameUserEditor);
  const otherTabHasUnsavedChanges = Boolean(lockState.otherTabHasUnsavedChanges);
  const secondsRemaining = state.propertyLockSecondsRemaining;
  const offCandidateSecondsRemaining = state.propertyLockOffCandidateDeadlineAt > Date.now()
    ? Math.max(0, Math.ceil((state.propertyLockOffCandidateDeadlineAt - Date.now()) / 1000))
    : 0;
  const crossPropertySecondsRemaining = state.propertyLockRecoveryDeadlineAt > Date.now()
    ? Math.max(0, Math.ceil((state.propertyLockRecoveryDeadlineAt - Date.now()) / 1000))
    : 0;
  const visible = propertyLockFeatureEnabled && Boolean(state.propertyLockSiteId);
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
    propertyLockContinueText: propertyLockText.continueEditingButton,
    propertyLockContinueDisabled: false,
    propertyLockForceContinueVisible: false,
    propertyLockForceContinueText: propertyLockText.continueEditingHereAnywayButton,
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

  if (state.renderModeInspectionActive && state.propertyLockDisconnectCountdown !== null) {
    viewState.propertyLockTone = "muted";
    viewState.propertyLockIcon = "sync";
    viewState.propertyLockStatusText = propertyLockText.popupInspectionReconnecting;
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

  if (crossPropertySecondsRemaining > 0) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "home-export-outline";
    viewState.propertyLockStatusText = propertyLockText.popupCrossPropertyWarning(crossPropertySecondsRemaining);
    viewState.propertyLockDetailText = propertyLockText.editorCrossPropertyCountdownMessage(crossPropertySecondsRemaining);
    return viewState;
  }

  if (offCandidateSecondsRemaining > 0) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "map-marker-alert-outline";
    viewState.propertyLockStatusText = propertyLockText.popupOffCandidateWarning(offCandidateSecondsRemaining);
    viewState.propertyLockDetailText = propertyLockText.editorOffCandidateCountdownMessage(offCandidateSecondsRemaining);
    return viewState;
  }

  if (state.propertyLockTransferCountdown !== null) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "swap-horizontal";
    viewState.propertyLockStatusText = propertyLockText.editorTransferCountdownMessage(
      lockState.transferFromName || editorName,
      lockState.transferToName || state.propertyLockSuggestionFromName || "the next editor",
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
    viewState.propertyLockStatusText = lockState.isRecentEditor
      ? propertyLockText.recentEditorInactiveMessage
      : propertyLockText.takeoverAvailableMessage;
    viewState.propertyLockTakeVisible = true;
    viewState.propertyLockTakeText = lockState.isRecentEditor
      ? propertyLockText.continueEditingButton
      : propertyLockText.takeoverButton;
    return viewState;
  }

  if (lockState.state === PROPERTY_LOCK_STATE_TRANSFER) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "swap-horizontal";
    viewState.propertyLockStatusText = propertyLockText.editorTransferCountdownMessage(
      lockState.transferFromName || editorName,
      lockState.transferToName || "the next editor",
      secondsRemaining || 0
    );
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
  viewState.propertyLockStatusText = sameUserEditor
    ? propertyLockText.sameUserLockedMessage
    : lockState.state === PROPERTY_LOCK_STATE_EXPIRY_WARNING
      ? propertyLockText.passiveExpiryCountdownMessage(editorName, secondsRemaining || 0)
      : propertyLockText.passiveLockedMessage(editorName);
  viewState.propertyLockDetailText = propertyLockText.popupPassiveDetail;
  if (sameUserEditor) {
    viewState.propertyLockSuggestVisible = false;
    viewState.propertyLockContinueVisible = true;
    viewState.propertyLockContinueText = propertyLockText.continueEditingHereButton;
    viewState.propertyLockContinueDisabled = otherTabHasUnsavedChanges;
    viewState.propertyLockDetailText = otherTabHasUnsavedChanges
      ? propertyLockText.otherTabUnsavedChangesLabel
      : propertyLockText.popupSameUserPassiveDetail;
    viewState.propertyLockForceContinueVisible = otherTabHasUnsavedChanges;
  } else {
    viewState.propertyLockSuggestVisible = lockState.state === PROPERTY_LOCK_STATE_LOCKED || lockState.state === PROPERTY_LOCK_STATE_EXPIRY_WARNING;
  }
  return viewState;
}

async function fetchPropertyLockState(siteId) {
  if (!isPropertyLockCollaborationEnabled()) {
    return {
      state: createInactiveLockState(),
      connectionStatus: PROPERTY_LOCK_CONNECTION_INACTIVE,
      error: FEATURE_DISABLED_REASON
    };
  }
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  if (!normalizedSiteId) {
    return null;
  }
  const clientIdHint = state.propertyLockSiteId === normalizedSiteId
    ? state.propertyLockClientId
    : (
      state.propertyLockRecoverySiteId === normalizedSiteId
        ? state.propertyLockRecoveryClientId
        : ""
    );

  try {
    return await chrome.runtime.sendMessage({
      type: PROPERTY_LOCK_BACKGROUND_GET_STATE,
      siteId: normalizedSiteId,
      clientId: clientIdHint || "",
      tabId: state.currentTab && Number.isFinite(state.currentTab.id)
        ? Math.trunc(state.currentTab.id)
        : null
    });
  } catch (error) {
    return {
      state: createInactiveLockState(),
      connectionStatus: PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
      error: "background_unavailable"
    };
  }
}

async function refreshPropertyLockSnapshot(siteId, options = {}) {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return createInactiveLockState();
  }
  const { skipFetch = false } = options;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  if (!normalizedSiteId) {
    resetPropertyLockState();
    return createInactiveLockState();
  }

  if (state.propertyLockSiteId !== normalizedSiteId) {
    resetPropertyLockState();
    state.propertyLockSiteId = normalizedSiteId;
  }

  if (skipFetch && state.propertyLockState) {
    return state.propertyLockState;
  }

  const previousLockState = state.propertyLockState;
  const lockResponse = await fetchPropertyLockState(normalizedSiteId);
  state.propertyLockIdentity = (lockResponse && lockResponse.identity) || "";
  state.propertyLockName = (lockResponse && lockResponse.name) || "";
  state.propertyLockClientId = (lockResponse && lockResponse.clientId) || "";
  const nextLockState = normalizeLockStateMessage(
    lockResponse && lockResponse.state ? lockResponse.state : createInactiveLockState(),
    {
      ownIdentity: state.propertyLockIdentity,
      clientId: state.propertyLockClientId
    }
  );
  queueEditorBootstrapOnLockTransition(previousLockState, nextLockState);
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
  return nextLockState;
}

async function sendPropertyLockCommand(type, payload = {}) {
  if (!isPropertyLockCollaborationEnabled()) {
    return {
      ok: false,
      reason: FEATURE_DISABLED_REASON,
      feature: "propertyLockCollaboration"
    };
  }
  const siteId = normalizeSiteIdValue(state.propertyLockSiteId);
  if (!siteId) {
    return { ok: false };
  }

  await refreshCurrentPageRuntimeStatus().catch(() => null);

  try {
    return await chrome.runtime.sendMessage({
      type,
      siteId,
      clientId: state.propertyLockClientId || "",
      tabId: state.currentTab && Number.isFinite(state.currentTab.id)
        ? Math.trunc(state.currentTab.id)
        : null,
      hasUnsavedChanges: Boolean(state.currentDraftDirty || state.currentPageSaveReconciliationPending),
      ...payload
    });
  } catch (error) {
    return { ok: false };
  }
}

async function reconcilePropertyLockAfterCommand(options = {}) {
  const { useBusyOverlay = false } = options;
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    await refreshUi({ useBusyOverlay });
    return;
  }
  const siteId = normalizeSiteIdValue(state.propertyLockSiteId);
  if (siteId) {
    await refreshPropertyLockSnapshot(siteId).catch(() => null);
    uiModule.setViewState(buildPropertyLockViewState());
  }
  await refreshUi({ useBusyOverlay });
}

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
      const leftOrder = THEME_ACCENT_CLUSTER_ORDER[left.cluster] ?? Number.MAX_SAFE_INTEGER;
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
const popupSpinnerWatchdogByKey = new Map();
let popupNavigationInspectionOverlayStarted = false;
let popupNavigationInspectionOverlayTabId = null;
const popupNavigationInspectionSettlePollByTabId = new Map();
const popupRenderModeSetNavGuardByTabId = new Map();
let popupStaleInspectionBusyClearTimer = 0;
let popupBackgroundStatePort = null;
let popupBackgroundLifecycle = null;
let propertyPageTypesRequest = null;
let remoteSupportPopupMediaChannel = null;
let remoteSupportDockPiPWindow = null;
let remoteSupportDockPiPClosingProgrammatically = false;
let remoteSupportLocalCameraCanvas = null;
let remoteSupportLocalCameraCtx = null;
let remoteSupportLocalCameraMediaStream = null;
let remoteSupportRemoteCameraCanvas = null;
let remoteSupportRemoteCameraCtx = null;
let remoteSupportRemoteCameraMediaStream = null;

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function currentSpinnerMessage() {
  if (popupSpinnerQueue.size === 0) {
    return "";
  }
  return [...popupSpinnerQueue.values()].at(-1).message;
}

function currentSpinnerSnapshot() {
  if (popupSpinnerQueue.size === 0) {
    return null;
  }
  const [key, entry] = [...popupSpinnerQueue.entries()].at(-1);
  return { key, entry };
}

function normalizeSpinnerReason(reason, key, message) {
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  if (typeof key === "string" && key.trim()) {
    return `spinner:${key.trim()}`;
  }
  if (typeof message === "string" && message.trim()) {
    return `message:${message.trim()}`;
  }
  return "popup-spinner";
}

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
      navOverlayTabId: popupNavigationInspectionOverlayTabId,
      ...details
    });
  } catch {
    // Debug logging must never break popup behavior.
  }
}

function getCurrentPopupTabId() {
  return state.currentTab && Number.isFinite(state.currentTab.id)
    ? Math.trunc(state.currentTab.id)
    : null;
}

function syncUiBusyFromBrokerState() {
  if (popupSpinnerQueue.size > 0) {
    popupSpinnerVisible = true;
    setUiBusyFromCurrentSpinner();
    return;
  }
  const lifecycleBusy = Boolean(popupBackgroundLifecycle && popupBackgroundLifecycle.busy);
  if (lifecycleBusy) {
    popupSpinnerVisible = false;
    uiModule.setUiBusy(true, popupBackgroundLifecycle.message || PopupText.overlay.pleaseWait, {
      reason: normalizeSpinnerReason(popupBackgroundLifecycle.reason, popupBackgroundLifecycle.kind || "lifecycle", popupBackgroundLifecycle.message),
      source: "background-lifecycle",
      spinnerKey: ""
    });
    return;
  }
  popupSpinnerVisible = false;
  uiModule.setUiBusy(false);
}

function isWorldTraceEnabled() {
  return isFeatureEnabled("traceDiagnostics") && isDebugFlagEnabled("worldTraceEnabled");
}

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
  state.traceEvents = traceDiagnosticsEnabled && Array.isArray(snapshot.traceEvents) ? [...snapshot.traceEvents] : [];
  popupSpinnerQueue.clear();
  popupSpinnerKeyTabIds.clear();
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

function sendSpinnerBrokerMessage(message, options = {}) {
  const tabId = getCurrentPopupTabId();
  if (!tabId || !message || typeof message !== "object") {
    return Promise.resolve(null);
  }
  const shouldApplySnapshot = typeof options.shouldApplySnapshot === "function"
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
    transientOnly: Boolean(options.transientOnly)
  }).then((response) => {
    if (response && response.ok) {
      applyBackgroundStateSnapshot(response);
    }
    return response;
  }).catch(() => null);
}

async function restoreSpinnerQueueFromBackground(tabId) {
  if (!tabId) {
    return;
  }
  const viewState = await messages.requestPopupTabViewState(tabId).catch(() => null);
  if (viewState && viewState.state && viewState.state.ok) {
    applyBackgroundStateSnapshot(viewState.state);
  }
}

async function handleTraceModeToggle(event) {
  if (event && event.currentTarget) {
    event.currentTarget.checked = Boolean(state.traceModeEnabled);
  }
}

function connectBackgroundStatePort(tabId) {
  if (!tabId || !chrome.runtime || typeof chrome.runtime.connect !== "function") {
    return;
  }
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
      if (popupBackgroundStatePort === port) {
        popupBackgroundStatePort = null;
      }
    });
  } catch {
    popupBackgroundStatePort = null;
  }
}

function clearSpinnerWatchdog(key) {
  const timer = popupSpinnerWatchdogByKey.get(key);
  if (timer) {
    window.clearTimeout(timer);
    popupSpinnerWatchdogByKey.delete(key);
  }
}

function armSpinnerWatchdog(key) {
  if (!key) {
    return;
  }
  clearSpinnerWatchdog(key);
  const timer = window.setTimeout(() => {
    popupSpinnerWatchdogByKey.delete(key);
    if (popupSpinnerQueue.has(key)) {
      // The owning operation never settled (its runWithSpinner finally / manual
      // popSpinner never ran). Fail open so the popup can never stay blocked.
      logPopupSpinnerDebug("spinner-watchdog-failopen", { key });
      popSpinner(key);
    }
  }, SPINNER_WATCHDOG_MS);
  popupSpinnerWatchdogByKey.set(key, timer);
}

function pushSpinner(key, message, options = {}) {
  const effectiveKey = (typeof key === "string" && key) ? key : crypto.randomUUID();
  const msg = (typeof message === "string" && message.trim()) ? message.trim() : "";
  const persistent = Boolean(options.persistent);
  const source = typeof options.source === "string" && options.source.trim()
    ? options.source.trim()
    : "popup-spinner";
  const reason = normalizeSpinnerReason(options.reason, effectiveKey, msg);
  const startedAt = Date.now();
  const isUpdate = popupSpinnerQueue.has(effectiveKey);
  const tabId = state.currentTab && state.currentTab.id;

  if (!isUpdate) {
    const suppressIfActive = Boolean(options.suppressIfActive);
    if (suppressIfActive && (popupSpinnerQueue.size > 0 || popupSpinnerVisible || popupSpinnerTimer)) {
      return null;
    }
  }

  const delayMs = (!isUpdate && Number.isFinite(options.delayMs))
    ? Math.max(0, Math.trunc(options.delayMs))
    : 0;

  if (isUpdate) {
    const existing = popupSpinnerQueue.get(effectiveKey);
    if (msg) {
      existing.message = msg;
    }
    existing.persistent = persistent;
    existing.reason = reason;
    existing.source = source;
    if (popupSpinnerTimer) {
      window.clearTimeout(popupSpinnerTimer);
      popupSpinnerTimer = 0;
      if (!popupSpinnerVisible) {
        popupSpinnerVisible = true;
        setUiBusyFromCurrentSpinner();
      } else {
        setUiBusyFromCurrentSpinner();
      }
    } else if (popupSpinnerVisible) {
      const topKey = [...popupSpinnerQueue.keys()].at(-1);
      if (topKey === effectiveKey) {
        setUiBusyFromCurrentSpinner();
      }
    }
    if (tabId) {
      popupSpinnerKeyTabIds.set(effectiveKey, tabId);
    }
    armSpinnerWatchdog(effectiveKey);
    syncSpinnerEntryToBackground(effectiveKey).catch(() => {});
    return effectiveKey;
  }

  popupSpinnerQueue.set(effectiveKey, { message: msg, persistent, reason, source, startedAt });
  armSpinnerWatchdog(effectiveKey);
  if (tabId) {
    popupSpinnerKeyTabIds.set(effectiveKey, tabId);
  }

  if (popupSpinnerVisible) {
    logPopupSpinnerDebug("push:update-visible", { key: effectiveKey, message: msg, persistent, reason, source, startedAt });
    setUiBusyFromCurrentSpinner();
    syncSpinnerEntryToBackground(effectiveKey).catch(() => {});
    return effectiveKey;
  }

  if (delayMs > 0) {
    if (!popupSpinnerTimer) {
      popupSpinnerTimer = window.setTimeout(() => {
        popupSpinnerTimer = 0;
        if (popupSpinnerQueue.size === 0 || popupSpinnerVisible) {
          return;
        }
        popupSpinnerVisible = true;
        logPopupSpinnerDebug("push:delayed-show", { key: effectiveKey, message: msg, persistent, reason, source, startedAt });
        setUiBusyFromCurrentSpinner();
        syncSpinnerEntryToBackground(effectiveKey).catch(() => {});
      }, delayMs);
    }
    return effectiveKey;
  }

  if (popupSpinnerTimer) {
    window.clearTimeout(popupSpinnerTimer);
    popupSpinnerTimer = 0;
  }
  popupSpinnerVisible = true;
  logPopupSpinnerDebug("push:show", { key: effectiveKey, message: msg, persistent, reason, source, startedAt });
  setUiBusyFromCurrentSpinner();
  if (tabId) {
    popupSpinnerKeyTabIds.set(effectiveKey, tabId);
  }
  syncSpinnerEntryToBackground(effectiveKey).catch(() => {});
  return effectiveKey;
}

function setSpinnerMessage(key, message) {
  if (!key || typeof key !== "string" || typeof message !== "string" || !message.trim()) {
    return;
  }
  const entry = popupSpinnerQueue.get(key);
  if (!entry) {
    return;
  }
  entry.message = message.trim();
  entry.reason = normalizeSpinnerReason(entry.reason, key, entry.message);
  entry.source = typeof entry.source === "string" && entry.source ? entry.source : "popup-spinner";
  // Message change = progress; reset the fail-open watchdog for this key.
  armSpinnerWatchdog(key);
  logPopupSpinnerDebug("set-message", { key, message: entry.message, reason: entry.reason, source: entry.source });
  const tabId = state.currentTab && state.currentTab.id;
  syncSpinnerEntryToBackground(key).catch(() => {});
  if (popupSpinnerVisible) {
    const topKey = [...popupSpinnerQueue.keys()].at(-1);
    if (topKey === key) {
      setUiBusyFromCurrentSpinner();
    }
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
    const renderModeNavSpinnerStuck =
      reconcileRenderModeNavSpinner &&
      popupSpinnerQueue.size === 1 &&
      popupSpinnerQueue.has("navInspect");
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

function popSpinner(key) {
  if (!key || typeof key !== "string") {
    return;
  }
  clearSpinnerWatchdog(key);
  const mappedTabId = popupSpinnerKeyTabIds.get(key);
  if (!popupSpinnerQueue.has(key)) {
    if (mappedTabId) {
      popupSpinnerKeyTabIds.delete(key);
      removeSpinnerEntryFromBackground(key, mappedTabId).catch(() => {});
    }
    return;
  }
  popupSpinnerKeyTabIds.delete(key);
  popupSpinnerQueue.delete(key);
  logPopupSpinnerDebug("pop", { key, mappedTabId });
  removeSpinnerEntryFromBackground(key, mappedTabId || getCurrentPopupTabId()).catch(() => {});
  if (popupSpinnerQueue.size > 0) {
    if (popupSpinnerVisible) {
      setUiBusyFromCurrentSpinner();
      syncUiBusyFromBrokerState();
    }
    return;
  }
  if (popupSpinnerTimer) {
    window.clearTimeout(popupSpinnerTimer);
    popupSpinnerTimer = 0;
  }
  const tabId = state.currentTab && state.currentTab.id;
  clearSpinnerQueueInBackground(tabId).catch(() => {});
  if (popupSpinnerVisible) {
    popupSpinnerVisible = false;
    logPopupSpinnerDebug("pop:hide", { key, mappedTabId });
    uiModule.setUiBusy(false);
  }
  scheduleStaleInspectionBusyClear(mappedTabId || tabId);
}

async function runWithSpinner(key, message, task, options = {}) {
  const pushed = pushSpinner(key, message, options);
  try {
    return await task(pushed);
  } finally {
    popSpinner(pushed);
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

function resolveRelativeEndpoint(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
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
  if (viewState && viewState.state && viewState.state.ok) {
    applyBackgroundStateSnapshot(viewState.state);
    return viewState.state;
  }
  return null;
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
  state.propertyPageTypesChangeNoticeVisible = false;
  state.propertyPageTypesInvalidAlertPending = false;
  state.propertyPageTypesChangeForceTodoOpen = false;
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
  const normalizedStageBase = normalizeStageBase(stageBase);
  if (!normalizedSiteId || !normalizedStageBase) {
    return { ok: false, pageTypes: [], duplicateUrls: [], error: "" };
  }
  const response = await messages.sendRuntimeMessage({
    type: "fetchLivePagePropertyPageTypes",
    siteId: normalizedSiteId,
    stageBase: normalizedStageBase,
    tokenValue
  });
  if (!response || !response.ok) {
    return {
      ok: false,
      pageTypes: [],
      duplicateUrls: [],
      error: response && typeof response.reason === "string" && response.reason
        ? response.reason
        : PopupText.pageTypes.refreshFailed
    };
  }
  return {
    ok: true,
    pageTypes: Array.isArray(response.pageTypes) ? response.pageTypes : [],
    duplicateUrls: Array.isArray(response.duplicateUrls) ? response.duplicateUrls : [],
    signature: typeof response.signature === "string"
      ? response.signature
      : buildPropertyPageTypesSignature(response.pageTypes)
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

function createNormalizedPageMarkingsSnapshot(pageMarkings) {
  return config.createBackendSavedPageMarkingsSnapshot(pageMarkings);
}

function arePageMarkingSnapshotsEqual(left, right) {
  return JSON.stringify(createNormalizedPageMarkingsSnapshot(left)) ===
    JSON.stringify(createNormalizedPageMarkingsSnapshot(right));
}

function hasSessionPageMarkingChanges(localPageMarkings, backendSavedPageMarkings) {
  return !arePageMarkingSnapshotsEqual(localPageMarkings, backendSavedPageMarkings);
}

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
  return snapshot[normalizedTargetUrl] || null;
}

function hasCurrentPageMarkingChanges(localPageMarkings, backendSavedPageMarkings, pageUrl) {
  return JSON.stringify(getNormalizedPageMarkingSnapshotEntry(localPageMarkings, pageUrl)) !==
    JSON.stringify(getNormalizedPageMarkingSnapshotEntry(backendSavedPageMarkings, pageUrl));
}

function getLatestPageMarkingTimestamp(pageMarkings) {
  let latestTimestamp = config.PAGE_TIMESTAMP_FALLBACK;
  Object.values(createNormalizedPageMarkingsSnapshot(pageMarkings)).forEach((entry) => {
    const timestamp = config.normalizeEntryTimestamp(entry && entry.timestamp);
    if (config.isIncomingTimestampNewer(timestamp, latestTimestamp)) {
      latestTimestamp = timestamp;
    }
  });
  return latestTimestamp;
}

function doesSessionRequireAiRun(sourceConfig, localPageMarkings, backendSavedPageMarkings, options = {}) {
  // A dirty current-page draft normally means the markings changed and the
  // selectors are stale, so an AI run is required before Save. But once a
  // successful AI run already matches the live current-page markings
  // (aiRunUpToDate), the draft is dirty only because it has not been
  // backend-saved yet - it does NOT need another run. Skipping the early
  // return in that case lets Save enable right after a clean run (State C)
  // while still demanding a run after any new mark/unmark change (State B).
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

function hasSessionPendingChanges(sourceConfig, localPageMarkings, backendSavedPageMarkings, options = {}) {
  return Boolean(
    options.currentDraftDirty ||
      options.reconciliationPending ||
      hasSessionPageMarkingChanges(localPageMarkings, backendSavedPageMarkings)
  );
}

function hasCurrentPagePendingChanges(localPageMarkings, backendSavedPageMarkings, options = {}) {
  return Boolean(
    options.currentDraftDirty ||
      options.reconciliationPending ||
      hasCurrentPageMarkingChanges(localPageMarkings, backendSavedPageMarkings, options.pageUrl)
  );
}

function hasBackendSavedPageMarking(pageMarkings, pageUrl) {
  const normalizedTargetUrl = normalizeCandidatePageUrl(pageUrl);
  if (!normalizedTargetUrl || !pageMarkings || typeof pageMarkings !== "object") {
    return false;
  }
  return Object.keys(pageMarkings).some((url) => normalizeCandidatePageUrl(url) === normalizedTargetUrl);
}

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

function clonePageMarkingEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return JSON.parse(JSON.stringify(entry));
}

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
        .map((item) => {
          if (typeof item === "string") {
            return item ? `${item}|0` : "";
          }
          if (item && typeof item === "object" && typeof item.xpath === "string") {
            return `${item.xpath}|${item.excluded ? "1" : "0"}`;
          }
          return "";
        })
        .filter((value) => value)
    : [];
  const includeXpaths = entry && Array.isArray(entry.includeXpaths)
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
  state.aiRunMarkingsFingerprint = getCurrentPageMarkingsFingerprint();
}

function resetAiRunMarkingsFingerprint() {
  state.aiRunMarkingsFingerprint = null;
}

async function resolveSiteIdFromGraphql(options = {}) {
  const {
    stageBase = "",
    lookupUrl = ""
  } = options;
  const normalizedStageBase = normalizeStageBase(stageBase);
  if (!normalizedStageBase || !lookupUrl) {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
  try {
    const response = await messages.sendRuntimeMessage({
      type: "resolveLivePageSiteId",
      stageBase: normalizedStageBase,
      pageUrl: lookupUrl
    });
    if (!response || !response.ok) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    const candidate = normalizeSiteIdValue(response.siteId);
    const baseUrl = typeof response.baseUrl === "string" ? response.baseUrl : "";
    if (!candidate) {
      return {
        ok: true,
        siteId: null,
        baseUrl,
        notFound: Boolean(response.notFound)
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

function getRenderModeInspectionSnapshotKey(baseUrl, pageUrl) {
  return baseUrl && pageUrl ? `${baseUrl}|${pageUrl}` : "";
}

function getCurrentRenderModeInspectionSnapshot(detectionKey) {
  const snapshot = state.renderModeInspectionSnapshot;
  if (
    !detectionKey ||
    state.renderModeInspectionSnapshotKey !== detectionKey ||
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof snapshot.renderedHtml !== "string" ||
    !snapshot.renderedHtml ||
    typeof snapshot.rawHtml !== "string"
  ) {
    return null;
  }
  return snapshot;
}

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
  const inspectionSnapshot = getCurrentRenderModeInspectionSnapshot(detectionKey);
  if (!inspectionSnapshot) {
    state.renderModeSuggestedKey = detectionKey;
    state.renderModeSuggestedValue = RENDER_MODE_UNDETERMINED;
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeUndeterminedNoticeKey = "";
    return RENDER_MODE_UNDETERMINED;
  }
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
    if (!inspectionSnapshot.renderedHtml || typeof inspectionSnapshot.rawHtml !== "string") {
      markRenderModeUndetermined(detectionKey);
      return RENDER_MODE_UNDETERMINED;
    }

    const detectionResult = await runWithSpinner(
      null,
      PopupText.overlay.detectingRenderMode,
      () => detectRenderModeViaEndpoint({
        endpointValue,
        tokenValue,
        rawHtml: inspectionSnapshot.rawHtml,
        renderedHtml: inspectionSnapshot.renderedHtml
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
  const sessionId = typeof options.sessionId === "string"
    ? options.sessionId.trim()
    : state.aiRunSessionId;
  const siteId = normalizeSiteIdValue(options.siteId || state.aiRunSiteId);
  const deadlineAt = Number.isFinite(options.deadlineAt)
    ? options.deadlineAt
    : state.aiRunDeadlineAt;
  const baseUrl = typeof options.baseUrl === "string"
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
    siteId = null,
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
    siteId = null,
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

async function repairLocalPageMarkingPageTypes(options = {}) {
  const {
    baseUrl = "",
    repairedMarkedPages = []
  } = options;
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !Array.isArray(repairedMarkedPages) || !repairedMarkedPages.length) {
    return [];
  }
  const repairsByUrl = new Map(
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
  const sourceConfig = configs[normalizedBaseUrl];
  if (!sourceConfig || !sourceConfig.pageMarkings || typeof sourceConfig.pageMarkings !== "object") {
    return [];
  }
  const nextConfig = config.normalizeConfig(normalizedBaseUrl, sourceConfig).config;
  const repairedUrls = [];
  Object.entries(nextConfig.pageMarkings || {}).forEach(([url, entry]) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const normalizedUrl = normalizeCandidatePageUrl(url);
    const repairedPageType = normalizedUrl ? repairsByUrl.get(normalizedUrl) : "";
    if (!repairedPageType || entry.pageType === repairedPageType) {
      return;
    }
    entry.pageType = repairedPageType;
    repairedUrls.push(url);
  });
  if (repairedUrls.length) {
    configs[normalizedBaseUrl] = nextConfig;
    await config.saveConfigs(configs);
  }
  return repairedUrls;
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
    case "skipped_editor":
    case "skipped_missing_config":
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

function buildPopupEnabledContext(tab = state.currentTab, baseUrl = state.currentBaseUrl) {
  return {
    tabId: tab && Number.isFinite(tab.id) ? Math.trunc(tab.id) : null,
    pageUrl: tab && typeof tab.url === "string" ? tab.url : "",
    baseUrl: typeof baseUrl === "string" ? baseUrl : ""
  };
}

function isPopupEnabledContextCurrent(context, currentContext = buildPopupEnabledContext()) {
  if (!context || typeof context !== "object") {
    return false;
  }
  return context.tabId === currentContext.tabId &&
    context.pageUrl === currentContext.pageUrl &&
    utils.sameBaseUrl(context.baseUrl || "", currentContext.baseUrl || "");
}

function setLastPopupEnabled(value, context = buildPopupEnabledContext()) {
  if (value === null) {
    state.lastPopupEnabled = null;
    state.lastPopupEnabledContext = null;
    return;
  }
  state.lastPopupEnabled = Boolean(value);
  state.lastPopupEnabledContext = { ...context };
}

function clearLastPopupEnabled() {
  setLastPopupEnabled(null);
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
  const tabId = Number.isFinite(options.tabId)
    ? Math.trunc(options.tabId)
    : state.currentTab && Number.isFinite(state.currentTab.id)
      ? Math.trunc(state.currentTab.id)
      : null;
  const baseUrl = typeof options.baseUrl === "string" && options.baseUrl
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

function waitForRetryDelay(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

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

function clearRenderModeSetNavGuard(tabId) {
  if (!tabId) {
    return;
  }
  if (popupRenderModeSetNavGuardByTabId.delete(tabId)) {
    logPopupSpinnerDebug("render-mode-set-nav-guard-clear", { tabId });
  }
}

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

function scheduleNavigationInspectionSettlePoll(tabId, baseUrl) {
  if (!tabId) {
    return;
  }
  clearNavigationInspectionSettlePoll(tabId);
  let attempt = 0;
  const maxAttempts = 30;
  const run = async () => {
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

function endNavigationInspectionOverlay(tabId = popupNavigationInspectionOverlayTabId) {
  if (
    popupNavigationInspectionOverlayTabId !== null &&
    tabId !== null &&
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
    rawHtml = "",
    renderedHtml = ""
  } = options;
  if (!rawHtml || !renderedHtml) {
    return { ok: false, result: "", accuracy: Number.NaN };
  }
  for (let attempt = 0; attempt < RENDER_MODE_DETECTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const requestPayloadKey = buildTransferPayloadKey("render-mode-request");
      const stored = await putTransferPayload("render-mode-request", {
        rawHtml,
        renderedHtml
      }, {
        payloadKey: requestPayloadKey
      });
      if (!stored.ok) {
        throw new Error("Unable to persist render-mode request payload");
      }
      const response = await messages.sendRuntimeMessage({
        type: "requestRenderModeDetection",
        payloadKey: requestPayloadKey
      });
      if (!response || response.ok !== true) {
        if (attempt + 1 < RENDER_MODE_DETECTION_MAX_ATTEMPTS) {
          await waitForRetryDelay(getRetryDelayMs(attempt, 350, 1800));
          continue;
        }
        return { ok: false, result: "", accuracy: Number.NaN };
      }
      if (response.status === "error") {
        if (
          attempt + 1 < RENDER_MODE_DETECTION_MAX_ATTEMPTS &&
          isRetryableHttpStatus(response.httpStatus)
        ) {
          await waitForRetryDelay(getRetryDelayMs(attempt, 350, 1800));
          continue;
        }
        return { ok: false, result: "", accuracy: Number.NaN };
      }
      const normalizedResult = normalizeRenderModeDetectionResult(response.payload);
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

async function loadRemoteConfigForCurrentPage(options = {}) {
  const {
    tabId = null,
    pageUrl = "",
    baseUrl = "",
    siteId = null,
    endpointValue = "",
    force = false,
    notifyOnChange = false
  } = options;
  if (!tabId || !siteId || !endpointValue) {
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
    const response = await messages.sendRuntimeMessage({
      type: "loadRemoteConfigSnapshot",
      siteId
    });
    if (response && response.status === "auth_error") {
      await invalidateTokenAndLockConfiguration(true);
      const result = { status: "auth_error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    if (response && response.status === "not_found") {
      await config.clearBackendSavedPageMarkings(baseUrl || state.currentBaseUrl);
      const result = { status: "not_found", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    if (!response || response.ok !== true || response.status !== "ok") {
      const result = { status: "error", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    const replaceResult = await messages.sendRuntimeMessage({
      type: "replaceServerConfigIntoLocalSnapshot",
      payloadKey: typeof response.payloadKey === "string" ? response.payloadKey : "",
      currentPageUrl: pageUrl,
      siteId
    });
    if (!replaceResult.ok) {
      const result = { status: "not_found", baseUrl: "" };
      state.remoteConfigLoadResult = result;
      updateLastConfigLoadStatus(result);
      return result;
    }
    if (replaceResult.changed && replaceResult.baseUrl) {
      await messages.sendTabMessageWithRetry({
        type: "configUpdated",
        baseUrl: replaceResult.baseUrl,
        forceReloadPageEntry: replaceResult.replacedCurrentPage
      }, 2);
    }
    if (replaceResult.changed && notifyOnChange) {
      uiModule.showToast(PopupText.page.remoteDataUpdated);
    }
    const result = {
      status: "ok",
      baseUrl: replaceResult.baseUrl
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

function clearObserverRemoteConfigRefreshTimer() {
  if (!state.observerRemoteConfigRefreshTimer) {
    return;
  }
  window.clearInterval(state.observerRemoteConfigRefreshTimer);
  state.observerRemoteConfigRefreshTimer = 0;
}

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

function shouldSkipRemoteConfigLoadForPropertyEditor(siteId) {
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  return Boolean(
    normalizedSiteId &&
      state.propertyLockSiteId === normalizedSiteId &&
      state.propertyLockState &&
      state.propertyLockState.isEditor
  );
}

async function syncBaseConfigToServer(options = {}) {
  const {
    baseUrl = "",
    pageUrl = "",
    endpointValue = "",
    tokenValue = "",
    stageBase = "",
    alertOnCurrentReplacement = true,
    includeCurrentPageMarking = false,
    includeAllLocalPageMarkings = false,
    maxAttempts = 5
  } = options;
  if (!baseUrl || !pageUrl || !endpointValue) {
    return { ok: false, skipped: true };
  }
  if (!resolveRelativeEndpoint(endpointValue, "/save")) {
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
    const backendSavedPageMarkings = await config.getBackendSavedPageMarkings(resolvedBaseUrl);
    const backendSavedPageMarkingItems = collectStoredPageMarkingItems(
      backendSavedPageMarkings,
      resolvedBaseUrl
    );
    const localPageMarkingItems = collectStoredPageMarkingItems(
      sourceConfig.pageMarkings,
      resolvedBaseUrl
    );
    const backendSavedPageUrls = new Set(
      Object.keys(backendSavedPageMarkings || {}).filter(Boolean)
    );
    const currentPageEntry =
      pageUrl &&
      sourceConfig.pageMarkings &&
      typeof sourceConfig.pageMarkings === "object"
        ? sourceConfig.pageMarkings[pageUrl]
        : null;
    let filterPageMarking = (url) =>
      includeAllLocalPageMarkings ||
      backendSavedPageUrls.has(url) ||
      (includeCurrentPageMarking && url === pageUrl);
    if (propertyPageTypesResult && propertyPageTypesResult.ok) {
      const coverageModel = buildLynxChecklistViewModel({
        aiAnswer: "yes",
        pageTypes: propertyPageTypesResult.pageTypes,
        markedPages: includeAllLocalPageMarkings
          ? localPageMarkingItems
          : backendSavedPageMarkingItems
      });
      const activePageMarkingKeys = new Set(
        coverageModel.activeMarkedPages
          .map((item) => buildPageMarkingKey(item.url, item.pageType))
          .filter(Boolean)
      );
      if (includeCurrentPageMarking && currentPageEntry) {
        activePageMarkingKeys.add(buildPageMarkingKey(pageUrl, currentPageEntry.pageType));
      }
      filterPageMarking = (url, entry) =>
        activePageMarkingKeys.has(buildPageMarkingKey(url, entry && entry.pageType));
    }
    const payload = config.createConfigSyncPayload(resolvedBaseUrl, sourceConfig, {
      filterPageMarking
    });
    try {
      const requestPayloadKey = buildTransferPayloadKey("save-request");
      const stored = await putTransferPayload("save-request", payload, {
        payloadKey: requestPayloadKey
      });
      if (!stored.ok) {
        throw new Error("Unable to persist remote-config save payload");
      }
      const response = await messages.sendRuntimeMessage({
        type: "saveRemoteConfigSnapshot",
        payloadKey: requestPayloadKey
      });
      try {
        const refreshedToken = await getStoredGlobalToken({ trim: true });
        if (refreshedToken) {
          currentTokenValue = refreshedToken;
        }
      } catch {
        // Ignore token refresh read errors; continue with the current in-memory token.
      }
      if (response && response.status === "auth_error") {
        await invalidateTokenAndLockConfiguration(true);
        return { ok: false, status: 401, authExpired: true };
      }
      if (!response || response.ok !== true) {
        if (attempt + 1 < attempts) {
          await waitForRetryDelay(retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 10000);
          continue;
        }
        return { ok: false };
      }
      if (response.status === "error") {
        lastStatus = Number(response.httpStatus) || 0;
        if (attempt + 1 < attempts && isRetryableHttpStatus(lastStatus)) {
          await waitForRetryDelay(retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 10000);
          continue;
        }
        return { ok: false, status: lastStatus };
      }
      const responsePayloadKey = typeof response.payloadKey === "string" ? response.payloadKey : "";
      if (response.status !== "ok" || !responsePayloadKey) {
        const mergeResult = await messages.sendRuntimeMessage({
          type: "mergeServerConfigIntoLocalSnapshot",
          payload: {
            ...payload,
            pageMarkings: {}
          },
          currentPageUrl: pageUrl,
          confirmedPageMarkings: payload.pageMarkings,
          preferConfirmedPageMarkings: includeCurrentPageMarking || includeAllLocalPageMarkings
        });
        return { ok: mergeResult.ok, replacedCurrentPage: false };
      }

      const mergeResult = await messages.sendRuntimeMessage({
        type: "mergeServerConfigIntoLocalSnapshot",
        payloadKey: responsePayloadKey,
        currentPageUrl: pageUrl,
        confirmedPageMarkings: payload.pageMarkings,
        preferConfirmedPageMarkings: includeCurrentPageMarking || includeAllLocalPageMarkings
      });
      if (!mergeResult.ok) {
        return { ok: false };
      }
      await pruneRemoteInvalidPageMarkings({
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

async function hideConsentForRenderModeInspection(targetTabId = state.currentTab && state.currentTab.id) {
  const tabId = Number.isFinite(targetTabId)
    ? Math.trunc(targetTabId)
    : null;
  if (!tabId) {
    return false;
  }

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

async function waitForTabLoadStart(tabId, timeoutMs = RENDER_MODE_INSPECTION_START_TIMEOUT_MS) {
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
      window.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
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

    const timeoutId = window.setTimeout(() => {
      finish(false);
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish(false);
        return;
      }
      if (tab && tab.status === "loading") {
        finish(true);
      }
    });
  });
}

async function waitForTabLoadComplete(
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

async function completeRenderModeInspectionReloadFollowUp(tabId, operationId = "") {
  const loadCompleted = await waitForTabLoadComplete(
    tabId,
    RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS
  );
  if (!loadCompleted) {
    return false;
  }
  const contentReady = await ensureContentReadyForRenderModeInspection(tabId);
  if (!contentReady) {
    return false;
  }
  const revealResponse = await messages.sendTabMessageToTab(tabId, {
    type: "runRenderModeRevealOnce",
    baseUrl: state.currentBaseUrl,
    operationId
  });
  if (!revealResponse || !revealResponse.ok) {
    return false;
  }
  const htmlResponse = await messages.sendTabMessageToTab(tabId, {
    type: "captureRenderModeInspectionHtml",
    baseUrl: state.currentBaseUrl,
    operationId
  });
  if (!htmlResponse || !htmlResponse.ok) {
    return false;
  }
  rememberRenderModeInspectionSnapshot(
    state.currentBaseUrl,
    htmlResponse.pageUrl || (state.currentTab && state.currentTab.url) || "",
    htmlResponse
  );
  await hideConsentForRenderModeInspection(tabId);
  // The reload tore down the page, so the content script's property-lock port
  // disconnected and re-claims after re-injection. Reconcile the popup view so it
  // stops showing "disconnected" once the connection is re-established (#9).
  await reconcilePropertyLockAfterRenderModeReload();
  scheduleStaleInspectionBusyClear(tabId, state.currentBaseUrl, {
    reconcileRenderModeNavSpinner: true
  });
  return true;
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

async function refreshUiInner(options = {}) {
  const skipPropertyLockFetch = Boolean(options.skipPropertyLockFetch);
  const propertyPageTypesRefreshChanged = Boolean(options.propertyPageTypesRefreshChanged);
  const remoteConfigLoadMode = typeof options.remoteConfigLoadMode === "string"
    ? options.remoteConfigLoadMode
    : "";
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
    clearLastPopupEnabled();
  }
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
  const {
    tokenValue,
    endpointValue,
    configEndpointValue,
    stageBaseValue
  } = await helpers.loadGlobalAiSettings();
  const normalizedStageBaseValue = normalizeStageBase(stageBaseValue);
  let configs = await config.getConfigs();
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
    !aiComputeRunActive &&
    !aiPreviewSessionActive &&
    effectiveTabState.baseUrl &&
    !hasLocalConfigForWebsite &&
    !currentSiteId
  ) {
    const wasEnabled = Boolean(effectiveTabState.enabled);
    effectiveTabState = { ...effectiveTabState, enabled: false, baseUrl: "" };
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
  const remoteSupportFeatureEnabled = isFeatureEnabled("remoteSupport");
  if (!remoteSupportFeatureEnabled) {
    resetDisabledRemoteSupportState();
  }
  const remoteSupportState = remoteSupportFeatureEnabled ? await fetchRemoteSupportState() : null;
  state.remoteSupportState = remoteSupportState;
  const remoteSupportPageVisible = remoteSupportFeatureEnabled && isRemoteSupportPageUrl(pageUrl, configEndpointValue);
  const scopedRemoteSupportState = remoteSupportFeatureEnabled
    ? scopeRemoteSupportStateToTab(remoteSupportState, currentTabId)
    : {};
  const remoteSupportViewLocked = remoteSupportFeatureEnabled &&
    shouldLockRemoteSupportConfigurationView(
      remoteSupportPageVisible,
      remoteSupportState,
      currentTabId
    );
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
  const remoteSupportMode = scopedRemoteSupportState.mode || "inactive";
  nextViewState.remoteSupportSessionActive = Boolean(scopedRemoteSupportState.active);
  nextViewState.remoteSupportMode = remoteSupportMode;
  nextViewState.remoteSupportRole = scopedRemoteSupportState.role || "";
  nextViewState.remoteSupportVisible = remoteSupportFeatureEnabled && Boolean(tokenValue);
  nextViewState.remoteSupportRequested = Boolean(scopedRemoteSupportState.supportCode);
  nextViewState.remoteSupportCode = scopedRemoteSupportState.supportCode || "";
  nextViewState.remoteSupportJoinCode = remoteSupportFeatureEnabled
    ? state.remoteSupportJoinCode || view.remoteSupportJoinCode || ""
    : "";
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
  nextViewState.remoteSupportLocalCameraActive = remoteSupportFeatureEnabled && Boolean(state.remoteSupportLocalCameraActive);
  nextViewState.remoteSupportRemoteCameraActive = remoteSupportFeatureEnabled && Boolean(state.remoteSupportRemoteCameraActive);
  nextViewState.remoteSupportPreviewImage = Boolean(scopedRemoteSupportState.active)
    ? state.remoteSupportLastFrame || ""
    : "";
  nextViewState.remoteSupportStatusText = buildRemoteSupportStatusText({
    active: nextViewState.remoteSupportSessionActive,
    mode: remoteSupportMode,
    connected: nextViewState.remoteSupportConnected
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
  let pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
  const backendSavedPageMarkings = state.currentBaseUrl
    ? await config.getBackendSavedPageMarkings(state.currentBaseUrl)
    : {};
  const normalizedCurrentPageUrl = normalizeCandidatePageUrl(pageUrl);
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
        state.currentConfig = config.normalizeConfig(
          state.currentBaseUrl,
          configs[state.currentBaseUrl]
        ).config;
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
        state.currentConfig = config.normalizeConfig(
          state.currentBaseUrl,
          configs[state.currentBaseUrl]
        ).config;
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
      popupNavigationInspectionOverlayTabId === currentTabId &&
      toggleEnabled &&
      effectiveTabState.enabled &&
      effectiveTabState.baseUrl) ||
    contentInspectionPending
  );
  if (
    popupSpinnerVisible &&
    popupNavigationInspectionOverlayStarted &&
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
  const traceDiagnosticsEnabled = isFeatureEnabled("traceDiagnostics");
  nextViewState.traceModeEnabled = traceDiagnosticsEnabled && Boolean(state.traceModeEnabled);
  nextViewState.traceEvents = traceDiagnosticsEnabled && Array.isArray(state.traceEvents) ? state.traceEvents : [];
  nextViewState.traceEventCount = nextViewState.traceEvents.length;
  nextViewState.remoteSupportAutoFocus = remoteSupportViewLocked;

  const pageScopedUiDisabled =
    unsupportedByGraphql ||
    !tabInScope ||
    remoteConfigRetryBlocked ||
    isPropertyLockBlockingEditing() ||
    remoteSupportMode === REMOTE_SUPPORT_MODE_SUPPORTING;
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
  nextViewState.toggleEnabled = pageScopedUiDisabled ? false : isEnabled;
  nextViewState.toggleEnabledDisabled =
    pageScopedUiDisabled ||
    pageSaveReconciliationPending ||
    !baseUrlReady ||
    (!navigationInspectionPending && (!siteIdReady || !renderModeReady || pageTypeUiBlocked)) ||
    desktopPreviewActive;
  nextViewState.mainUiHidden =
    pageScopedUiDisabled ||
    !isEnabled ||
    (!navigationInspectionPending && (!siteIdReady || !renderModeReady));
  nextViewState.silentModeActive = silentModeActive;
  nextViewState.computeButtonDisabled =
    pageScopedUiDisabled ||
    aiBusy ||
    !aiReady ||
    pageSaveReconciliationPending ||
    aiRunUpToDate;
  nextViewState.saveExcludesButtonDisabled =
    !silentModeActive ||
    aiBusy ||
    !baseUrlReady ||
    !siteIdReady;
  nextViewState.previewLatestButtonDisabled =
    !silentModeActive ||
    aiBusy ||
    !baseUrlReady ||
    !siteIdReady ||
    !hasStoredSelectors;
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
  nextViewState.sessionHasPendingChanges = sessionHasPendingChanges;
  nextViewState.currentPageHasPendingChanges = currentPageHasPendingChanges;
  nextViewState.sessionRequiresAiRun = sessionRequiresAiRun;
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
  nextViewState.renderModeSummaryTitle = PopupText.renderMode.title;
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
  nextViewState.clearDomainCacheDisabled =
    !isFeatureEnabled("cacheAndUnregisterTools") || state.clearDomainCacheDisabled;
  nextViewState.unregisterCurrentTabDisabled =
    !isFeatureEnabled("cacheAndUnregisterTools") ||
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
  nextViewState.aiDirtyNoticeVisible = pageSaveReconciliationPending;
  nextViewState.aiDirtyNoticeText = pageSaveReconciliationPending
    ? PopupText.page.statusServerSyncPending
    : PopupText.ai.dirtyNotice;
  nextViewState.cssSelectorsVisible = silentModeActive;
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
    sessionHasPendingChanges,
    pageHasPendingChanges: currentPageHasPendingChanges,
    sessionRequiresAiRun,
    pageHasSavedBaseline: hasBackendSavedPageMarking(backendSavedPageMarkings, pageUrl),
    reconciliation: state.currentPageSaveReconciliation
  });
  nextViewState.pageSaveDisabled = pageSaveUiState.pageSaveDisabled;
  nextViewState.pageSaveMobileSimulationRequiredVisible =
    pageSaveUiState.pageSaveMobileSimulationRequiredVisible;
  nextViewState.pageSaveMobileSimulationRequiredText =
    PopupText.page.mobileSimulationRequired;
  nextViewState.pageRevertDisabled = pageSaveUiState.pageRevertDisabled;
  // Marking-mode "Preview Content": let the user see the AI content detection
  // without leaving marking mode. Mirrors Save gating - only available once a
  // successful AI run matches the live markings (and before the next change).
  nextViewState.markingPreviewVisible = pageControlsVisible && Boolean(isEnabled);
  nextViewState.markingPreviewDisabled =
    aiBusy ||
    pageSaveReconciliationPending ||
    !aiRunUpToDate;
  nextViewState.pageDraftStatusText = pageSaveUiState.pageDraftStatusText;
  nextViewState.pageDraftStatusTone = pageSaveUiState.pageDraftStatusTone;
  nextViewState.pageSessionNoticeVisible = pageSaveUiState.pageSessionNoticeVisible;
  nextViewState.pageSessionNoticeText = pageSaveUiState.pageSessionNoticeText;
  nextViewState.aiDirtyNoticeText = pageSaveUiState.aiDirtyNoticeText;
  nextViewState.syncLoadStatusText = state.lastConfigLoadStatusText || ViewText.syncLoadIdle;
  nextViewState.syncLoadStatusTone = state.lastConfigLoadStatusTone || "muted";
  nextViewState.syncSaveStatusText = state.lastConfigSaveStatusText || ViewText.syncSaveIdle;
  nextViewState.syncSaveStatusTone = state.lastConfigSaveStatusTone || "muted";
  const popupBusyActive = popupSpinnerVisible;
  nextViewState.isBusy = popupBusyActive || remoteConfigRetryBlocked || pageInspectionBusy;
  nextViewState.busyMessage = popupBusyActive
    ? currentSpinnerMessage()
    : remoteConfigRetryBlocked
      ? PopupText.status.remoteServerRetryNotice
      : pageInspectionBusy
        ? PopupText.overlay.pageInspection
        : "";
  nextViewState.pageDataNewNoticeHidden = pageSaveUiState.pageDataNewNoticeHidden;
  nextViewState.deviceEmulationEnabled = normalizedDeviceState.enabled;
  nextViewState.deviceMode = normalizedDeviceState.mode;
  nextViewState.deviceScale = normalizedDeviceState.scale.toFixed(2);
  nextViewState.deviceScaleValue = formatScalePercent(normalizedDeviceState.scale);
  nextViewState.deviceControlsDisabled = Boolean(state.deviceControlsDisabled || isEnabled);
  nextViewState.desktopPreviewVisible = desktopPreviewVisible;
  nextViewState.desktopPreviewEnabled = desktopPreviewActive;
  nextViewState.desktopPreviewDisabled =
    aiBusy ||
    !currentTabId ||
    !renderModeReady ||
    pageInspectionBusy ||
    state.deviceControlsDisabled;
  nextViewState.desktopPreviewNoticeVisible = desktopPreviewActive;
  nextViewState.desktopPreviewNoticeText = PopupText.device.desktopPreviewNotice;
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
  nextViewState.pageTypeNoticeText = state.propertyPageTypesChangeNoticeVisible
    ? PopupText.pageTypes.changedNotice
    : pageTypeCandidateNoticeText;
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
    nextViewState.todoListVisible
  ) {
    nextViewState.todoControlsMenuOpen = false;
    nextViewState.todoSectionExpanded = true;
    state.propertyPageTypesChangeForceTodoOpen = false;
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

async function refreshUi(options = {}) {
  const useBusyOverlay = options.useBusyOverlay !== false;
  const refreshOptions = {
    skipPropertyLockFetch: Boolean(options.skipPropertyLockFetch),
    propertyPageTypesRefreshChanged: Boolean(options.propertyPageTypesRefreshChanged),
    remoteConfigLoadMode: typeof options.remoteConfigLoadMode === "string"
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
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  const nextThemeValue = normalizeThemeValue(
    event && event.target ? event.target.value : state.currentTheme
  );
  await applyThemeValue(nextThemeValue);
}

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

function handleThemeMenuToggle(event) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
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

async function handleThemeOptionSelect(value) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  await applyThemeValue(normalizeThemeValue(value));
}

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
  const operationId = `render-mode-inspection:${tabId}:${Date.now()}`;

  await runWithSpinner(null, PopupText.overlay.pleaseWait, async () => {
    state.renderModeInspectionActive = true;
    try {
      const inspectionResponse = await messages.requestTabRunRenderModeInspection(tabId, {
        baseUrl: state.currentBaseUrl,
        javaScriptDisabled,
        operationId
      });
      const inspectionResult = inspectionResponse && inspectionResponse.ok && inspectionResponse.result
        ? inspectionResponse.result
        : null;
      const reloadResult = inspectionResult && inspectionResult.reloadResult && typeof inspectionResult.reloadResult === "object"
        ? inspectionResult.reloadResult
        : {
          ok: false,
          error: (inspectionResponse && inspectionResponse.error) || PopupText.renderMode.toastInspectReloadFailed
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
            snapshot.pageUrl || (state.currentTab && state.currentTab.url) || "",
            snapshot
          );
        }
        await reconcilePropertyLockAfterRenderModeReload();
        scheduleStaleInspectionBusyClear(tabId, state.currentBaseUrl, {
          reconcileRenderModeNavSpinner: true
        });
        await refreshUi({ useBusyOverlay: false });
      }
      uiModule.showToast(outcome.toast);
    } finally {
      state.renderModeInspectionActive = false;
      uiModule.setViewState(buildPropertyLockViewState());
    }
  });
}

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
  await runWithSpinner(null, PopupText.overlay.savingRenderMode, async () => {
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
        (state.currentTab && typeof state.currentTab.url === "string"
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

function resetDisabledRemoteSupportState() {
  state.remoteSupportState = null;
  state.remoteSupportJoinCode = "";
  state.remoteSupportLastFrame = "";
  state.remoteSupportLocalCameraActive = false;
  state.remoteSupportRemoteCameraActive = false;
  stopRemoteSupportCameraMediaStreams();
  uiModule.setViewState({
    remoteSupportVisible: false,
    remoteSupportPageVisible: false,
    remoteSupportAutoFocus: false,
    remoteSupportSessionActive: false,
    remoteSupportMode: "inactive",
    remoteSupportRole: "",
    remoteSupportRequested: false,
    remoteSupportCode: "",
    remoteSupportJoinCode: "",
    remoteSupportRequestLoading: false,
    remoteSupportJoinLoading: false,
    remoteSupportConnected: false,
    remoteSupportStreaming: false,
    remoteSupportCameraAvailable: false,
    remoteSupportCameraEnabled: false,
    remoteSupportMicrophoneAvailable: false,
    remoteSupportMicrophoneEnabled: false,
    remoteSupportSoundAvailable: false,
    remoteSupportSoundEnabled: false,
    remoteSupportDockState: REMOTE_SUPPORT_DOCK_STATE_EMBEDDED,
    remoteSupportLocalCameraActive: false,
    remoteSupportRemoteCameraActive: false,
    remoteSupportPreviewImage: "",
    remoteSupportStatusText: "",
    remoteSupportInactivityCountdownActive: false,
    remoteSupportInactivitySecondsRemaining: 0,
    remoteSupportInactivityCountdownText: "0:00",
    remoteSupportError: ""
  });
}

function shouldBlockRemoteSupportFeature() {
  if (isFeatureEnabled("remoteSupport")) {
    return false;
  }
  resetDisabledRemoteSupportState();
  return true;
}

function syncRemoteSupportViewState(remoteSupportState = null) {
  if (shouldBlockRemoteSupportFeature()) {
    return;
  }
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const nextState = scopeRemoteSupportStateToTab(remoteSupportState, currentTabId);
  const statusText = buildRemoteSupportStatusText(nextState);
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
    remoteSupportInactivityCountdownActive: Boolean(nextState.inactivityCountdownActive),
    remoteSupportInactivitySecondsRemaining: Math.max(0, Math.trunc(Number(nextState.inactivitySecondsRemaining) || 0)),
    remoteSupportInactivityCountdownText: formatRemoteSupportCountdown(nextState.inactivitySecondsRemaining),
    remoteSupportError: nextState.error || ""
  });
  if (!nextState.active) {
    state.remoteSupportLocalCameraActive = false;
    state.remoteSupportRemoteCameraActive = false;
    stopRemoteSupportCameraMediaStreams();
    uiModule.setViewState({
      remoteSupportLocalCameraActive: false,
      remoteSupportRemoteCameraActive: false,
      remoteSupportDockState: REMOTE_SUPPORT_DOCK_STATE_EMBEDDED
    });
  }
}

function stopMediaStreamTracks(stream) {
  if (!stream || typeof stream.getTracks !== "function") {
    return;
  }
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore media track stop failures.
    }
  }
}

function stopRemoteSupportCameraMediaStreams() {
  stopMediaStreamTracks(remoteSupportLocalCameraMediaStream);
  stopMediaStreamTracks(remoteSupportRemoteCameraMediaStream);
  remoteSupportLocalCameraCanvas = null;
  remoteSupportLocalCameraCtx = null;
  remoteSupportLocalCameraMediaStream = null;
  remoteSupportRemoteCameraCanvas = null;
  remoteSupportRemoteCameraCtx = null;
  remoteSupportRemoteCameraMediaStream = null;
  const refs = uiModule.getRefs();
  if (refs.localCameraVideo) {
    refs.localCameraVideo.srcObject = null;
  }
  if (refs.remoteCameraVideo) {
    refs.remoteCameraVideo.srcObject = null;
  }
  if (remoteSupportDockPiPWindow && !remoteSupportDockPiPWindow.closed) {
    const pipDocument = remoteSupportDockPiPWindow.document;
    const localVideo = pipDocument.getElementById("uf-pip-local");
    const remoteVideo = pipDocument.getElementById("uf-pip-remote");
    if (localVideo) {
      localVideo.srcObject = null;
    }
    if (remoteVideo) {
      remoteVideo.srcObject = null;
    }
  }
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
  const countdownLabel = Boolean(stateValue.inactivityCountdownActive)
    ? ` • session ends in ${formatRemoteSupportCountdown(stateValue.inactivitySecondsRemaining)}`
    : "";
  return `${mode}${connectedLabel}${streamLabel}${countdownLabel}`;
}

function ensureRemoteSupportPopupMediaChannel() {
  if (!isFeatureEnabled("remoteSupport")) {
    return null;
  }
  if (remoteSupportPopupMediaChannel || typeof BroadcastChannel !== "function") {
    return remoteSupportPopupMediaChannel;
  }

  remoteSupportPopupMediaChannel = new BroadcastChannel("unfluffify-remote-support-popup-media");
  remoteSupportPopupMediaChannel.onmessage = (event) => {
    const message = event && event.data && typeof event.data === "object" ? event.data : null;
    const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
      ? state.currentTab.id
      : null;
    const scopedRemoteSupportState = scopeRemoteSupportStateToTab(state.remoteSupportState, currentTabId);
    const scopedSessionId = scopedRemoteSupportState && typeof scopedRemoteSupportState.sessionId === "string"
      ? scopedRemoteSupportState.sessionId
      : "";
    if (
      !message ||
      currentTabId === null ||
      Number(message.tabId) !== currentTabId ||
      !scopedSessionId ||
      message.sessionId !== scopedSessionId
    ) {
      return;
    }

    const { localCameraBitmap, remoteCameraBitmap } = message;

    if ("localCameraBitmap" in message) {
      if (localCameraBitmap instanceof ImageBitmap) {
        try {
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
        } finally {
          localCameraBitmap.close();
        }
      } else {
        state.remoteSupportLocalCameraActive = false;
      }
    }

    if ("remoteCameraBitmap" in message) {
      if (remoteCameraBitmap instanceof ImageBitmap) {
        try {
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
        } finally {
          remoteCameraBitmap.close();
        }
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
async function fetchRemoteSupportState(tabId = state.currentTab && state.currentTab.id) {
  if (shouldBlockRemoteSupportFeature()) {
    return null;
  }
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
  if (shouldBlockRemoteSupportFeature()) {
    return null;
  }
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
  if (shouldBlockRemoteSupportFeature()) {
    return;
  }
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
  if (shouldBlockRemoteSupportFeature()) {
    return;
  }
  const value = event && event.target && typeof event.target.value === "string"
    ? event.target.value.trim().toUpperCase()
    : "";
  state.remoteSupportJoinCode = value;
  uiModule.setViewState({ remoteSupportJoinCode: value });
}

async function handleRemoteSupportJoin() {
  if (shouldBlockRemoteSupportFeature()) {
    return;
  }
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
  if (shouldBlockRemoteSupportFeature()) {
    return { ok: false, reason: "feature_disabled", feature: "remoteSupport" };
  }
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
  if (shouldBlockRemoteSupportFeature()) {
    return;
  }
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
      if (remoteSupportDockPiPClosingProgrammatically) {
        remoteSupportDockPiPClosingProgrammatically = false;
        return;
      }
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
  if (shouldBlockRemoteSupportFeature()) {
    return;
  }
  await openRemoteSupportDockPiP();
}

async function handleRemoteSupportEnd() {
  if (shouldBlockRemoteSupportFeature()) {
    return;
  }
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

async function handleRemoteSupportContinue() {
  if (shouldBlockRemoteSupportFeature()) {
    return;
  }
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : undefined;
  const scopedRemoteSupportState = scopeRemoteSupportStateToTab(state.remoteSupportState, currentTabId);
  const response = await messages.sendRuntimeMessage({
    type: "remoteSupportContinueSession",
    tabId: currentTabId,
    sessionId: typeof scopedRemoteSupportState.sessionId === "string"
      ? scopedRemoteSupportState.sessionId
      : ""
  });
  if (!response || !response.ok) {
    uiModule.showToast((response && response.error) || "Unable to continue remote support session");
    return;
  }
  state.remoteSupportState = response.state || state.remoteSupportState;
  syncRemoteSupportViewState(state.remoteSupportState);
  await refreshUi();
}

async function handleRemoteSupportLocalMediaToggle(control) {
  if (shouldBlockRemoteSupportFeature()) {
    return;
  }
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
  if (shouldBlockRemoteSupportFeature()) {
    return;
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

function handleConfigToggle(event) {
  event.stopPropagation();
  uiModule.setTodoControlsMenuOpen(false);
  uiModule.setConfigMenuOpen(!state.configMenuOpen);
}

function handleConfigMenuClick(event) {
  event.stopPropagation();
}

function handleTodoControlsMenuToggle(event) {
  event.stopPropagation();
  const view = uiModule.getViewState();
  uiModule.setConfigMenuOpen(false);
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

async function handleMarkedPageNavigate(url) {
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
    clearLastPopupEnabled();
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

  let latestViewState = currentViewState;
  const pendingKnownFromCurrentView = Boolean(
    !desiredEnabled && currentViewState.sessionHasPendingChanges
  );
  if (!desiredEnabled && !pendingKnownFromCurrentView) {
    // If pending changes are already known in the current view state, show the
    // discard confirm immediately. Otherwise refresh first to avoid false
    // negatives when the pending state has not been computed yet.
    await refreshCurrentPageRuntimeStatus({
      tabId: tab.id,
      baseUrl: state.currentBaseUrl
    });
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    latestViewState = uiModule.getViewState();
  }

  if (!desiredEnabled && latestViewState.sessionHasPendingChanges) {
    uiModule.showToast(
      latestViewState.sessionRequiresAiRun
        ? PopupText.page.exitRequiresAiResolution
        : PopupText.page.exitRequiresResolution
    );
    const confirmedDiscard = window.confirm(PopupText.page.disableDiscardConfirm);
    if (!confirmedDiscard) {
      // Cancel: stay in marking mode with the pending session intact.
      uiModule.setViewState({ toggleEnabled: true });
      setLastPopupEnabled(true, buildPopupEnabledContext(tab, state.currentBaseUrl));
      await refreshUi();
      return;
    }
    // OK: discard the pending CSS selectors/markings locally, then fall through
    // to disable marking (which drops to silent highlighting mode).
    await applyLocalPageDiscard();
  }
  setLastPopupEnabled(desiredEnabled, buildPopupEnabledContext(tab, state.currentBaseUrl));
  const baseUrlValue = state.currentBaseUrl;
  const currentPageTypeKey = desiredEnabled ? state.currentPageTypeKey || "" : "";
  await runWithSpinner(
    null,
    desiredEnabled ? PopupText.overlay.enablingMarking : PopupText.overlay.disablingMarking,
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
          if (enableResponse?.locked) {
            uiModule.showToast(propertyLockText.lockedInteractionBlockedToast(state.propertyLockState?.editorName || "Someone"));
          } else {
            uiModule.showToast(enableResponse?.error || PopupText.helper.activateFailedOnPage);
          }
          await refreshUi();
          return;
        }
        await waitForEnableMarkingInspectionToSettle(tab.id, effectiveBaseUrl);
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
          setLastPopupEnabled(true, buildPopupEnabledContext(tab, state.currentBaseUrl));
          uiModule.showToast((disableResponse && disableResponse.error) || "Unable to disable marking");
          await refreshUi();
          return;
        }
      }
      await refreshUi();
    },
    { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS }
  );
}

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
      await persistDesktopPreviewEnabled(tab.id, desiredEnabled);
      await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    },
    { delayMs: POPUP_BUSY_OVERLAY_DELAY_MS }
  );
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
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
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
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  // Reset + mode drop are owned by background command authority for this tab.
  if (tabId !== null) {
    await messages.requestTabApplyPostSaveTransition(tabId, { baseUrl });
  }
  state.currentDraftDirty = false;
  await alignPopupToSilentMode();
}

async function handlePageSave() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  await refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  const currentViewState = uiModule.getViewState();
  if (!currentViewState.sessionHasPendingChanges) {
    updateLastConfigSaveStatus(PopupText.page.noLocalChangesToSave);
    uiModule.showToast(PopupText.page.noChangesToSave);
    return;
  }
  if (currentViewState.sessionRequiresAiRun) {
    uiModule.showToast(PopupText.page.noticeRunAiBeforeSaving);
    return;
  }
  const tokenIsValid = await validateStoredToken({ force: true });
  if (!tokenIsValid) {
    return;
  }
  await runWithSpinner(null, PopupText.overlay.savingPage, async () => {
    const pageUrl = getCurrentPageUrl();
    const { tokenValue, configEndpointValue, stageBaseValue } =
      await helpers.loadGlobalAiSettings();
    let retryDelayMs = PAGE_SAVE_SYNC_INITIAL_RETRY_DELAY_MS;
    for (let attempt = 0; attempt < PAGE_SAVE_SYNC_MAX_ATTEMPTS; attempt += 1) {
      const syncResult = await syncBaseConfigToServer({
        baseUrl: state.currentBaseUrl,
        pageUrl,
        endpointValue: configEndpointValue,
        tokenValue,
        stageBase: stageBaseValue,
        alertOnCurrentReplacement: false,
        includeAllLocalPageMarkings: true,
        maxAttempts: 1
      });
      if (syncResult && syncResult.ok) {
        await clearCurrentPageSaveReconciliation();
        resetAiRunMarkingsFingerprint();
        // Switch marking -> silent and reset the current page to the saved
        // baseline so Discard is disabled and Run AI stays irrelevant in silent.
        await applyPostSaveSilentTransition();
        updateLastConfigSaveStatus(PopupText.page.savedAndSynced);
        uiModule.showToast(PopupText.page.sessionSaved);
        await refreshUi();
        return;
      }
      if (syncResult && syncResult.authExpired) {
        return;
      }
      if (syncResult && syncResult.skipped) {
        updateLastConfigSaveStatus(PopupText.page.saveFailed);
        uiModule.showToast(syncResult.reason || PopupText.page.saveFailedToast);
        return;
      }
      if (attempt + 1 >= PAGE_SAVE_SYNC_MAX_ATTEMPTS) {
        updateLastConfigSaveStatus(PopupText.page.saveFailed);
        uiModule.showToast(PopupText.page.saveFailedToast);
        await refreshUi();
        return;
      }
      uiModule.setUiBusy(true, PopupText.status.remoteServerRetryNotice, {
        reason: "page-save-remote-config-retry",
        source: "popup-page-save",
        spinnerKey: ""
      });
      await waitForRetryDelay(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS);
    }
  });
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
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
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

async function handlePageRevert() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  await refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  const currentViewState = uiModule.getViewState();
  if (!currentViewState.currentPageHasPendingChanges) {
    uiModule.showToast(PopupText.page.noChangesToSave);
    return;
  }
  const confirmed = window.confirm(PopupText.page.revertConfirm);
  if (!confirmed) {
    return;
  }
  await runWithSpinner(null, PopupText.overlay.revertingPage, async () => {
    await applyLocalPageDiscard();
    updateLastConfigSaveStatus(PopupText.page.revertedToLastSaved);
    uiModule.showToast(PopupText.page.revertedToLastSaved);
    await refreshUi();
  });
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
  // Refresh from the now-committed content draft so the captured fingerprint
  // reflects the SAME authoritative markings entry that the post-preview-exit
  // refresh will read back. Capturing from the (possibly stale or
  // refresh-nulled) in-memory draft could mismatch on return to marking mode
  // and wrongly re-enable Run AI / disable Show Content List + Save.
  await refreshCurrentPageRuntimeStatus();
  // Record the markings this AI run was computed for so Run AI disables and
  // Save/Preview enable until the next mark/unmark change.
  captureAiRunMarkingsFingerprint();

  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const previewResponse = await messages.requestTabShowAiPreview(tabId, {
    selectorSet
  });
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

function getAiRunCommandFailureMessage(response) {
  const details = response && response.details && typeof response.details === "object"
    ? response.details
    : {};
  if (details.reconciliationPending) {
    return PopupText.page.statusServerSyncPending;
  }
  if (details.locked) {
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
    const currentPageUrl = (state.currentTab && state.currentTab.url) || "";
    if (!currentPageUrl) {
      uiModule.showToast(PopupText.ai.currentPageUnavailable);
      return;
    }
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

    const siteId = normalizeSiteIdValue(state.currentSiteId || (state.currentConfig && state.currentConfig.siteId));
    const deadlineAt = Date.now() + AI_RUN_TIMEOUT_MS;
    setAiRunActiveState({
      siteId,
      deadlineAt,
      resumed: false,
      phase: "starting"
    });
    await waitForPopupUiPaint();
    try {
      const tabId = state.currentTab && state.currentTab.id;
      const aiRunResponse = await messages.requestTabRunAi(tabId, {
        baseUrl: state.currentBaseUrl,
        currentPageUrl,
        pageType: state.currentPageTypeKey || "",
        currentRenderMode,
        siteId,
        deadlineAt
      });
      if (!aiRunResponse || !aiRunResponse.ok || !aiRunResponse.result) {
        await failAiRun(getAiRunCommandFailureMessage(aiRunResponse));
        return;
      }

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
    baseUrl = state.currentBaseUrl,
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
    baseUrl = state.currentBaseUrl,
    selectorSet = getCurrentSelectorsFromConfig(),
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

  state.aiRequestInFlight = "save";
  await refreshUi();
  try {
    await postPageTypeAssignmentsToAiServer({
      baseUrl: effectiveBaseUrl,
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
  setPreviewBlocked(true, PopupText.preview.blockedActive);
  try {
    const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
      ? state.currentTab.id
      : null;
    const response = await messages.requestTabShowAiPreview(tabId, {
      selectorSet
    });
    if (!response || !response.ok || !response.result) {
      throw new Error(PopupText.preview.openFailed);
    }
    await refreshUi();
  } catch (error) {
    setPreviewBlocked(false);
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
  setPreviewBlocked(true, PopupText.preview.blockedActive);
  try {
    const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
      ? state.currentTab.id
      : null;
    const response = await messages.requestTabShowAiPreview(tabId, {
      selectorSet
    });
    if (!response || !response.ok || !response.result) {
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
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const response = await messages.requestTabCloseAiPreview(tabId);
  if (!response || !response.ok || !response.result) {
    uiModule.showToast(PopupText.preview.exitFailed);
  }
}

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
    const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
      ? state.currentTab.id
      : null;
    const response = await messages.requestTabSetAiPreviewExpandedMode(tabId, {
      active: nextChecked
    });
    if (!response || !response.ok || !response.result) {
      throw new Error(PopupText.preview.updateFailed);
    }
    uiModule.setViewState(buildPreviewViewState(response.result.previewState || null));
  } catch (error) {
    uiModule.setViewState({ previewShowAllCategories: previousChecked });
    uiModule.showToast((error && error.message) || PopupText.preview.updateFailed);
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
  }
}

async function handlePreviewItemFocus(xpath) {
  if (!xpath || !await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  uiModule.setViewState({ previewFocusedXpath: xpath });
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const response = await messages.requestTabFocusPreviewElement(tabId, {
    xpath
  });
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
    onRemoteSupportRequest: handleRemoteSupportRequest,
    onRemoteSupportJoinCodeInput: handleRemoteSupportJoinCodeInput,
    onRemoteSupportJoin: handleRemoteSupportJoin,
    onRemoteSupportEnd: handleRemoteSupportEnd,
    onRemoteSupportCameraToggle: handleRemoteSupportCameraToggle,
    onRemoteSupportMicrophoneToggle: handleRemoteSupportMicrophoneToggle,
    onRemoteSupportSoundToggle: handleRemoteSupportSoundToggle,
    onRemoteSupportContinue: handleRemoteSupportContinue,
    onRemoteSupportDockExternalize: handleRemoteSupportDockExternalize,
    onRemoteSupportErrorDismiss: handleRemoteSupportErrorDismiss,
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
  if (isFeatureEnabled("remoteSupport")) {
    ensureRemoteSupportPopupMediaChannel();
  }

  uiModule.onViewStateChange((viewState) => {
    if (!isFeatureEnabled("remoteSupport")) {
      return;
    }
    if (
      viewState.remoteSupportMode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
      viewState.remoteSupportSessionActive &&
      viewState.remoteSupportDockState === REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP
    ) {
      openRemoteSupportDockPiP().catch(() => {});
    } else if (
      remoteSupportDockPiPWindow &&
      (
        remoteSupportDockPiPWindow.closed ||
        !viewState.remoteSupportSessionActive ||
        viewState.remoteSupportDockState !== REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP
      )
    ) {
      if (!remoteSupportDockPiPWindow.closed) {
        remoteSupportDockPiPClosingProgrammatically = true;
        try {
          remoteSupportDockPiPWindow.close();
        } catch {
          remoteSupportDockPiPClosingProgrammatically = false;
        }
      }
      remoteSupportDockPiPWindow = null;
    }
    syncRemoteSupportDockPiPWindow();
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
    if (state.currentTab && tab.windowId !== state.currentTab.windowId) {
      return;
    }
    // Remove old-tab spinner storage when switching tabs; the popup keeps only the active tab queue.
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
    }
    popupNavigationInspectionOverlayStarted = false;
    popupNavigationInspectionOverlayTabId = null;
    await helpers.ensureActiveTab();
    // Restore spinner queue for the newly active tab.
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
    if (!state.currentTab || tabId !== state.currentTab.id) {
      return;
    }
    if (!(changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete")) {
      return;
    }
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
    const tabId = state.currentTab && state.currentTab.id;
    if (tabId) {
      clearSpinnerQueueInBackground(tabId, { transientOnly: true }).catch(() => {});
    }
    clearNavigationInspectionSettlePollsExcept();
    if (popupSpinnerTimer) {
      window.clearTimeout(popupSpinnerTimer);
      popupSpinnerTimer = 0;
    }
    if (remoteSupportDockPiPWindow && !remoteSupportDockPiPWindow.closed) {
      remoteSupportDockPiPClosingProgrammatically = true;
      try {
        remoteSupportDockPiPWindow.close();
      } catch {
        remoteSupportDockPiPClosingProgrammatically = false;
      }
      remoteSupportDockPiPWindow = null;
    }
  });

  utils.addStorageChangeListener((changes, areaName) => {
    if (areaName === "sync") {
      if (changes[GLOBAL_THEME_KEY] || changes[GLOBAL_THEME_MODE_KEY]) {
        const appearanceCustomizationEnabled = isFeatureEnabled("appearanceCustomization");
        if (!appearanceCustomizationEnabled && (changes[GLOBAL_THEME_KEY] || changes[GLOBAL_THEME_MODE_KEY])) {
          resetDisabledAppearanceCustomization();
        }
        if (appearanceCustomizationEnabled && changes[GLOBAL_THEME_KEY]) {
          state.currentTheme = normalizeThemeValue(
            changes[GLOBAL_THEME_KEY].newValue
          );
        }
        if (appearanceCustomizationEnabled && changes[GLOBAL_THEME_MODE_KEY]) {
          state.currentThemeMode = normalizeThemeModeValue(
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
        Number.isFinite(state.currentTab.id) &&
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
    if (message && message.type === "remoteSupportStateChanged") {
      const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
        ? state.currentTab.id
        : null;
      if (currentTabId !== null && Number.isFinite(message.tabId) && Number(message.tabId) !== currentTabId) {
        return;
      }
      state.remoteSupportState = message.state || null;
      clearLastPopupEnabled();
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

  await refreshUi({ useBusyOverlay: false });
}

init();
