import * as stateModule from "./state.js";

const { state } = stateModule;
const stateAny = state as any;

export function isPropertyLockCollaborationEnabled(deps: any) {
  return deps.isFeatureEnabled("propertyLockCollaboration");
}

export function resetDisabledPropertyLockState(deps: any) {
  deps.clearPropertyLockOffCandidateRefreshTimer();
  deps.resetPropertyLockState();
  state.propertyLockState = deps.createInactiveLockState();
  state.propertyLockEditorBootstrapPending = false;
}

export function resetPropertyLockState(deps: any) {
  state.propertyLockSiteId = null;
  state.propertyLockState = null;
  state.propertyLockConnectionStatus = deps.PROPERTY_LOCK_CONNECTION_INACTIVE;
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

export function clearPropertyLockTransientState() {
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

export function clearPropertyLockOffCandidateRefreshTimer(deps: any) {
  if (!state.propertyLockOffCandidateRefreshTimer) {
    return;
  }
  deps.windowRef.clearInterval(state.propertyLockOffCandidateRefreshTimer);
  state.propertyLockOffCandidateRefreshTimer = 0;
}

export function syncPropertyLockOffCandidateRefreshTimer(deps: any, active: any) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.clearPropertyLockOffCandidateRefreshTimer();
    return;
  }
  if (!active) {
    deps.clearPropertyLockOffCandidateRefreshTimer();
    return;
  }
  if (state.propertyLockOffCandidateRefreshTimer) {
    return;
  }
  state.propertyLockOffCandidateRefreshTimer = deps.windowRef.setInterval(() => {
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
      deps.clearPropertyLockOffCandidateRefreshTimer();
    }
    deps.refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true }).catch(() => {});
  }, 1000);
}

export async function persistPropertyLockRecoveryMetadata(deps: any, tabId: any, recoveryState = {}) {
  const recoveryStateAny = recoveryState as any;
  if (!deps.isPropertyLockCollaborationEnabled()) {
    return;
  }
  if (!Number.isFinite(tabId)) {
    return;
  }
  await deps.setTabState(tabId, {
    active: true,
    propertyLockRecoverySiteId: Number.isFinite(recoveryStateAny.siteId)
      ? Number(recoveryStateAny.siteId)
      : null,
    propertyLockRecoveryBaseUrl: typeof recoveryStateAny.baseUrl === "string"
      ? recoveryStateAny.baseUrl
      : "",
    propertyLockRecoveryClientId: typeof recoveryStateAny.clientId === "string"
      ? recoveryStateAny.clientId
      : "",
    propertyLockRecoveryDeadlineAt: Number.isFinite(recoveryStateAny.deadlineAt)
      ? Number(recoveryStateAny.deadlineAt)
      : 0
  }, "initial");
}

export function applyPropertyLockState(deps: any, lockStateLike: any) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.resetDisabledPropertyLockState();
    return;
  }
  state.propertyLockState = deps.normalizeLockStateMessage(
    lockStateLike || deps.createInactiveLockState(),
    {
      ownIdentity: state.propertyLockIdentity,
      clientId: state.propertyLockClientId
    }
  );
  deps.clearPropertyLockTransientState();
}

export function queueEditorBootstrapOnLockTransition(deps: any, previousLockState: any, nextLockState: any) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
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

export function applyPropertyLockConnectionStatus(deps: any, status: any, error = "") {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    state.propertyLockConnectionStatus = deps.PROPERTY_LOCK_CONNECTION_INACTIVE;
    state.propertyLockConnectionError = "";
    return;
  }
  state.propertyLockConnectionStatus = typeof status === "string" && status
    ? status
    : deps.PROPERTY_LOCK_CONNECTION_INACTIVE;
  state.propertyLockConnectionError = typeof error === "string" ? error : "";
}

export function applyPropertyLockServerMessage(deps: any, serverMessage: any, siteId = null) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.resetDisabledPropertyLockState();
    return false;
  }
  if (!serverMessage || typeof serverMessage !== "object") {
    return false;
  }

  const resolvedSiteId = deps.normalizeSiteIdValue(siteId || state.propertyLockSiteId);
  if (resolvedSiteId) {
    state.propertyLockSiteId = resolvedSiteId;
  }

  const type = typeof serverMessage.type === "string"
    ? serverMessage.type
    : deps.PROPERTY_LOCK_WS_LOCK_STATE;
  const secondsRemaining = typeof serverMessage.secondsRemaining === "number"
    ? Math.max(0, Math.ceil(serverMessage.secondsRemaining))
    : null;

  if (type === deps.PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS) {
    deps.applyPropertyLockConnectionStatus(serverMessage.connectionStatus, serverMessage.error);
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_LOCK_STATE || !serverMessage.type) {
    const previousLockState = state.propertyLockState;
    deps.applyPropertyLockState(serverMessage);
    deps.queueEditorBootstrapOnLockTransition(previousLockState, state.propertyLockState);
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_DISCONNECT_WARNING) {
    stateAny.propertyLockDisconnectCountdown = secondsRemaining;
    stateAny.propertyLockSecondsRemaining = secondsRemaining;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_INACTIVITY_WARNING) {
    state.propertyLockInactivityWarningVisible = true;
    stateAny.propertyLockSecondsRemaining = secondsRemaining;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION) {
    state.propertyLockSuggestionId = String(serverMessage.suggestionId || "");
    state.propertyLockSuggestionFromName = String(serverMessage.fromName || "");
    state.propertyLockSuggestionVisible = Boolean(state.propertyLockSuggestionId);
    state.propertyLockSuggestionPending = false;
    state.propertyLockSuggestionRejected = false;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_SUGGESTION_PENDING) {
    state.propertyLockSuggestionId = String(serverMessage.suggestionId || "");
    state.propertyLockSuggestionPending = Boolean(state.propertyLockSuggestionId);
    state.propertyLockSuggestionRejected = false;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_SUGGESTION_RESPONSE) {
    state.propertyLockSuggestionPending = false;
    state.propertyLockSuggestionRejected = serverMessage.accepted === false;
    return true;
  }

  if (
    type === deps.PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED ||
    type === deps.PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN
  ) {
    state.propertyLockState = {
      ...(state.propertyLockState || deps.createInactiveLockState()),
      transferFromName: String(
        serverMessage.transferFromName ||
        serverMessage.fromName ||
          stateAny.propertyLockState?.transferFromName ||
        ""
      ),
      transferToName: String(
        serverMessage.transferToName ||
        serverMessage.toName ||
          stateAny.propertyLockState?.transferToName ||
        state.propertyLockSuggestionFromName ||
        ""
      )
    };
    stateAny.propertyLockTransferCountdown = secondsRemaining;
    stateAny.propertyLockSecondsRemaining = secondsRemaining;
    state.propertyLockSuggestionVisible = false;
    state.propertyLockSuggestionPending = false;
    state.propertyLockSuggestionRejected = false;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_ERROR) {
    deps.showToast(String(serverMessage.reason || "Property lock request failed"));
    return false;
  }

  return false;
}

export function isPropertyLockBlockingEditing(deps: any) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    return false;
  }
  const lockState: any = state.propertyLockState;
  if (
    state.propertyLockSiteId &&
    state.propertyLockConnectionStatus === deps.PROPERTY_LOCK_CONNECTION_UNAVAILABLE
  ) {
    return true;
  }
  return Boolean(
    lockState &&
      !lockState.isEditor &&
      lockState.state !== deps.PROPERTY_LOCK_STATE_UNLOCKED
  );
}

export function buildPropertyLockViewState(deps: any) {
  const propertyLockFeatureEnabled = deps.isPropertyLockCollaborationEnabled();
  const lockState: any = propertyLockFeatureEnabled
    ? (state.propertyLockState || deps.createInactiveLockState())
    : deps.createInactiveLockState();
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
  const viewState: any = {
    propertyLockVisible: visible,
    propertyLockTone: "muted",
    propertyLockIcon: "lock-open-outline",
    propertyLockStatusText: "",
    propertyLockDetailText: "",
    propertyLockSuggestVisible: false,
    propertyLockTakeVisible: false,
    propertyLockTakeText: deps.propertyLockText.takeoverButton,
    propertyLockContinueVisible: false,
    propertyLockContinueText: deps.propertyLockText.continueEditingButton,
    propertyLockContinueDisabled: false,
    propertyLockForceContinueVisible: false,
    propertyLockForceContinueText: deps.propertyLockText.continueEditingHereAnywayButton,
    propertyLockSuggestionVisible: false,
    propertyLockAcceptVisible: false,
    propertyLockRejectVisible: false
  };

  if (!visible) {
    return viewState;
  }

  if (
    lockState.state === deps.PROPERTY_LOCK_STATE_UNLOCKED &&
    state.propertyLockConnectionStatus === deps.PROPERTY_LOCK_CONNECTION_CONNECTING
  ) {
    viewState.propertyLockTone = "muted";
    viewState.propertyLockIcon = "sync";
    viewState.propertyLockStatusText = deps.propertyLockText.popupConnecting;
    return viewState;
  }

  if (
    lockState.state === deps.PROPERTY_LOCK_STATE_UNLOCKED &&
    state.propertyLockConnectionStatus === deps.PROPERTY_LOCK_CONNECTION_UNAVAILABLE
  ) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "cloud-off-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.popupUnavailable;
    viewState.propertyLockDetailText = deps.propertyLockText.popupUnavailableDetail;
    return viewState;
  }

  if (state.propertyLockSuggestionVisible) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "account-switch-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.takeoverSuggestionMessage(
      state.propertyLockSuggestionFromName || "Someone"
    );
    viewState.propertyLockDetailText = deps.propertyLockText.popupEditorDetail;
    viewState.propertyLockSuggestionVisible = true;
    viewState.propertyLockAcceptVisible = true;
    viewState.propertyLockRejectVisible = true;
    return viewState;
  }

  if (state.renderModeInspectionActive && state.propertyLockDisconnectCountdown !== null) {
    viewState.propertyLockTone = "muted";
    viewState.propertyLockIcon = "sync";
    viewState.propertyLockStatusText = deps.propertyLockText.popupInspectionReconnecting;
    return viewState;
  }

  if (state.propertyLockDisconnectCountdown !== null) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "wifi-off";
    viewState.propertyLockStatusText = deps.propertyLockText.editorDisconnectCountdownMessage(
      state.propertyLockDisconnectCountdown || 0
    );
    return viewState;
  }

  if (state.propertyLockInactivityWarningVisible) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "timer-alert-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.editorInactivityWarningMessage(secondsRemaining || 0);
    viewState.propertyLockContinueVisible = true;
    return viewState;
  }

  if (crossPropertySecondsRemaining > 0) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "home-export-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.popupCrossPropertyWarning(crossPropertySecondsRemaining);
    viewState.propertyLockDetailText = deps.propertyLockText.editorCrossPropertyCountdownMessage(crossPropertySecondsRemaining);
    return viewState;
  }

  if (offCandidateSecondsRemaining > 0) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "map-marker-alert-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.popupOffCandidateWarning(offCandidateSecondsRemaining);
    viewState.propertyLockDetailText = deps.propertyLockText.editorOffCandidateCountdownMessage(offCandidateSecondsRemaining);
    return viewState;
  }

  if (state.propertyLockTransferCountdown !== null) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "swap-horizontal";
    viewState.propertyLockStatusText = deps.propertyLockText.editorTransferCountdownMessage(
      lockState.transferFromName || editorName,
      lockState.transferToName || state.propertyLockSuggestionFromName || "the next editor",
      state.propertyLockTransferCountdown || 0
    );
    return viewState;
  }

  if (state.propertyLockSuggestionPending) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "clock-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.passiveSuggestionPendingMessage(editorName);
    viewState.propertyLockDetailText = deps.propertyLockText.popupPassiveDetail;
    return viewState;
  }

  if (state.propertyLockSuggestionRejected) {
    viewState.propertyLockTone = "danger";
    viewState.propertyLockIcon = "lock-alert-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.passiveSuggestionRejectedMessage(editorName);
    viewState.propertyLockDetailText = deps.propertyLockText.popupPassiveDetail;
    viewState.propertyLockSuggestVisible = true;
    return viewState;
  }

  if (lockState.state === deps.PROPERTY_LOCK_STATE_UNLOCKED) {
    viewState.propertyLockTone = "success";
    viewState.propertyLockStatusText = deps.propertyLockText.popupUnlocked;
    return viewState;
  }

  if (lockState.state === deps.PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "lock-open-variant-outline";
    viewState.propertyLockStatusText = lockState.isRecentEditor
      ? deps.propertyLockText.recentEditorInactiveMessage
      : deps.propertyLockText.takeoverAvailableMessage;
    viewState.propertyLockTakeVisible = true;
    viewState.propertyLockTakeText = lockState.isRecentEditor
      ? deps.propertyLockText.continueEditingButton
      : deps.propertyLockText.takeoverButton;
    return viewState;
  }

  if (lockState.state === deps.PROPERTY_LOCK_STATE_TRANSFER) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "swap-horizontal";
    viewState.propertyLockStatusText = deps.propertyLockText.editorTransferCountdownMessage(
      lockState.transferFromName || editorName,
      lockState.transferToName || "the next editor",
      secondsRemaining || 0
    );
    return viewState;
  }

  if (lockState.isEditor) {
    viewState.propertyLockTone = "success";
    viewState.propertyLockIcon = "lock-check-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.popupEditorActive;
    viewState.propertyLockDetailText = deps.propertyLockText.popupEditorDetail;
    return viewState;
  }

  viewState.propertyLockTone = lockState.state === deps.PROPERTY_LOCK_STATE_EXPIRY_WARNING
    ? "warning"
    : "danger";
  viewState.propertyLockIcon = "lock-outline";
  viewState.propertyLockStatusText = sameUserEditor
    ? deps.propertyLockText.sameUserLockedMessage
    : lockState.state === deps.PROPERTY_LOCK_STATE_EXPIRY_WARNING
      ? deps.propertyLockText.passiveExpiryCountdownMessage(editorName, secondsRemaining || 0)
      : deps.propertyLockText.passiveLockedMessage(editorName);
  viewState.propertyLockDetailText = deps.propertyLockText.popupPassiveDetail;
  if (sameUserEditor) {
    viewState.propertyLockSuggestVisible = false;
    viewState.propertyLockContinueVisible = true;
    viewState.propertyLockContinueText = deps.propertyLockText.continueEditingHereButton;
    viewState.propertyLockContinueDisabled = otherTabHasUnsavedChanges;
    viewState.propertyLockDetailText = otherTabHasUnsavedChanges
      ? deps.propertyLockText.otherTabUnsavedChangesLabel
      : deps.propertyLockText.popupSameUserPassiveDetail;
    viewState.propertyLockForceContinueVisible = otherTabHasUnsavedChanges;
  } else {
    viewState.propertyLockSuggestVisible =
      lockState.state === deps.PROPERTY_LOCK_STATE_LOCKED ||
      lockState.state === deps.PROPERTY_LOCK_STATE_EXPIRY_WARNING;
  }
  return viewState;
}

export async function fetchPropertyLockState(deps: any, siteId: any) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    return {
      state: deps.createInactiveLockState(),
      connectionStatus: deps.PROPERTY_LOCK_CONNECTION_INACTIVE,
      error: deps.FEATURE_DISABLED_REASON
    };
  }
  const normalizedSiteId = deps.normalizeSiteIdValue(siteId);
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

  const currentTabAny = state.currentTab as any;
  try {
    return await deps.sendRuntimeMessage({
      type: deps.PROPERTY_LOCK_BACKGROUND_GET_STATE,
      siteId: normalizedSiteId,
      clientId: clientIdHint || "",
      tabId: currentTabAny && Number.isFinite(currentTabAny.id)
        ? Math.trunc(currentTabAny.id)
        : null
    });
  } catch {
    return {
      state: deps.createInactiveLockState(),
      connectionStatus: deps.PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
      error: "background_unavailable"
    };
  }
}

export async function refreshPropertyLockSnapshot(deps: any, siteId: any, options: any = {}) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.resetDisabledPropertyLockState();
    return deps.createInactiveLockState();
  }
  const { skipFetch = false } = options;
  const normalizedSiteId = deps.normalizeSiteIdValue(siteId);
  if (!normalizedSiteId) {
    deps.resetPropertyLockState();
    return deps.createInactiveLockState();
  }

  if (state.propertyLockSiteId !== normalizedSiteId) {
    deps.resetPropertyLockState();
    state.propertyLockSiteId = normalizedSiteId;
  }

  if (skipFetch && state.propertyLockState) {
    return state.propertyLockState;
  }

  const previousLockState: any = state.propertyLockState;
  const lockResponse = await deps.fetchPropertyLockState(normalizedSiteId);
  state.propertyLockIdentity = (lockResponse && lockResponse.identity) || "";
  state.propertyLockName = (lockResponse && lockResponse.name) || "";
  state.propertyLockClientId = (lockResponse && lockResponse.clientId) || "";
  const nextLockState: any = deps.normalizeLockStateMessage(
    lockResponse && lockResponse.state ? lockResponse.state : deps.createInactiveLockState(),
    {
      ownIdentity: state.propertyLockIdentity,
      clientId: state.propertyLockClientId
    }
  );
  deps.queueEditorBootstrapOnLockTransition(previousLockState, nextLockState);
  if (
    !previousLockState ||
    previousLockState.state !== nextLockState.state ||
    previousLockState.isEditor !== nextLockState.isEditor ||
    previousLockState.editorIdentity !== nextLockState.editorIdentity
  ) {
    deps.clearPropertyLockTransientState();
  }
  state.propertyLockState = nextLockState;
  deps.applyPropertyLockConnectionStatus(
    lockResponse && lockResponse.connectionStatus
      ? lockResponse.connectionStatus
      : deps.PROPERTY_LOCK_CONNECTION_CONNECTED,
    lockResponse && lockResponse.error ? lockResponse.error : ""
  );
  return nextLockState;
}

export async function sendPropertyLockCommand(deps: any, type: any, payload = {}) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    return {
      ok: false,
      reason: deps.FEATURE_DISABLED_REASON,
      feature: "propertyLockCollaboration"
    };
  }
  const siteId = deps.normalizeSiteIdValue(state.propertyLockSiteId);
  if (!siteId) {
    return { ok: false };
  }

  await deps.refreshCurrentPageRuntimeStatus().catch(() => null);

  const currentTabAny = state.currentTab as any;
  try {
    return await deps.sendRuntimeMessage({
      type,
      siteId,
      clientId: state.propertyLockClientId || "",
      tabId: currentTabAny && Number.isFinite(currentTabAny.id)
        ? Math.trunc(currentTabAny.id)
        : null,
      hasUnsavedChanges: Boolean(state.currentDraftDirty || state.currentPageSaveReconciliationPending),
      ...payload
    });
  } catch {
    return { ok: false };
  }
}

export async function reconcilePropertyLockAfterCommand(deps: any, options = {}) {
  const opts = options as any;
  const { useBusyOverlay = false } = opts;
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.resetDisabledPropertyLockState();
    await deps.refreshUi({ useBusyOverlay });
    return;
  }
  const siteId = deps.normalizeSiteIdValue(state.propertyLockSiteId);
  if (siteId) {
    await deps.refreshPropertyLockSnapshot(siteId).catch(() => null);
    deps.setViewState(deps.buildPropertyLockViewState());
  }
  await deps.refreshUi({ useBusyOverlay });
}
