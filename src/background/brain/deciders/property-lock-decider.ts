import type {
  PropertyLockTimerState,
  PropertyLockViewState,
} from "../../../common/bus/contracts/property-lock-state";
import {
  PROPERTY_LOCK_TIMER_KINDS,
  PROPERTY_LOCK_TIMER_SOURCES,
} from "../../../common/bus/contracts/property-lock-state";

type NormalizedLockState = ReturnType<typeof import("../../../common/property-lock").createInactiveLockState>;

type PropertyLockDeciderDeps = Readonly<{
  propertyLockText: typeof import("../../../common/text").propertyLockText;
  PROPERTY_LOCK_CONNECTION_CONNECTING: string;
  PROPERTY_LOCK_CONNECTION_UNAVAILABLE: string;
  PROPERTY_LOCK_STATE_UNLOCKED: string;
  PROPERTY_LOCK_STATE_LOCKED: string;
  PROPERTY_LOCK_STATE_EXPIRY_WARNING: string;
  PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE: string;
  PROPERTY_LOCK_STATE_TRANSFER: string;
}>;

type PropertyLockDeciderInput = Readonly<{
  propertyLockFeatureEnabled: boolean;
  propertyLockSiteId: number | null;
  lockState: NormalizedLockState;
  propertyLockConnectionStatus: string;
  propertyLockSecondsRemaining: number | null;
  propertyLockSuggestionFromName: string;
  propertyLockSuggestionVisible: boolean;
  propertyLockSuggestionPending: boolean;
  propertyLockSuggestionRejected: boolean;
  propertyLockInactivityWarningVisible: boolean;
  propertyLockDisconnectCountdown: number | null;
  propertyLockTransferCountdown: number | null;
  propertyLockOffCandidateDeadlineAt: number;
  propertyLockRecoveryDeadlineAt: number;
  renderModeInspectionActive: boolean;
  now: number;
}>;

type PropertyLockProjection = Readonly<{
  viewState: PropertyLockViewState;
  timerState: PropertyLockTimerState | null;
}>;

type MutablePropertyLockViewState = {
  -readonly [K in keyof PropertyLockViewState]: PropertyLockViewState[K];
};

function getDeadlineSecondsRemaining(deadlineAt: number, now: number): number {
  return deadlineAt > now
    ? Math.max(0, Math.ceil((deadlineAt - now) / 1000))
    : 0;
}

function buildTimerState(
  deps: PropertyLockDeciderDeps,
  input: PropertyLockDeciderInput
): PropertyLockTimerState | null {
  if (
    input.renderModeInspectionActive &&
    input.propertyLockDisconnectCountdown !== null
  ) {
    return null;
  }

  if (input.propertyLockDisconnectCountdown !== null) {
    return {
      kind: PROPERTY_LOCK_TIMER_KINDS.DISCONNECT,
      source: PROPERTY_LOCK_TIMER_SOURCES.SNAPSHOT,
      deadlineAt: 0,
      secondsRemaining: input.propertyLockDisconnectCountdown || 0
    };
  }

  if (input.propertyLockInactivityWarningVisible) {
    return {
      kind: PROPERTY_LOCK_TIMER_KINDS.INACTIVITY,
      source: PROPERTY_LOCK_TIMER_SOURCES.SNAPSHOT,
      deadlineAt: 0,
      secondsRemaining: input.propertyLockSecondsRemaining || 0
    };
  }

  const crossPropertySecondsRemaining = getDeadlineSecondsRemaining(
    input.propertyLockRecoveryDeadlineAt,
    input.now
  );
  if (crossPropertySecondsRemaining > 0) {
    return {
      kind: PROPERTY_LOCK_TIMER_KINDS.CROSS_PROPERTY,
      source: PROPERTY_LOCK_TIMER_SOURCES.DEADLINE,
      deadlineAt: input.propertyLockRecoveryDeadlineAt,
      secondsRemaining: crossPropertySecondsRemaining
    };
  }

  const offCandidateSecondsRemaining = getDeadlineSecondsRemaining(
    input.propertyLockOffCandidateDeadlineAt,
    input.now
  );
  if (offCandidateSecondsRemaining > 0) {
    return {
      kind: PROPERTY_LOCK_TIMER_KINDS.OFF_CANDIDATE,
      source: PROPERTY_LOCK_TIMER_SOURCES.DEADLINE,
      deadlineAt: input.propertyLockOffCandidateDeadlineAt,
      secondsRemaining: offCandidateSecondsRemaining
    };
  }

  if (input.propertyLockTransferCountdown !== null) {
    return {
      kind: PROPERTY_LOCK_TIMER_KINDS.TRANSFER,
      source: PROPERTY_LOCK_TIMER_SOURCES.SNAPSHOT,
      deadlineAt: 0,
      secondsRemaining: input.propertyLockTransferCountdown || 0
    };
  }

  if (
    !input.lockState.isEditor &&
    !input.lockState.isSameUserEditor &&
    input.lockState.state === deps.PROPERTY_LOCK_STATE_EXPIRY_WARNING
  ) {
    return {
      kind: PROPERTY_LOCK_TIMER_KINDS.PASSIVE_EXPIRY,
      source: PROPERTY_LOCK_TIMER_SOURCES.SNAPSHOT,
      deadlineAt: 0,
      secondsRemaining: input.propertyLockSecondsRemaining || 0
    };
  }

  return null;
}

export function derivePropertyLockViewState(
  deps: PropertyLockDeciderDeps,
  input: PropertyLockDeciderInput
): PropertyLockProjection {
  const editorName = input.lockState.editorName || "Someone";
  const sameUserEditor = Boolean(input.lockState.isSameUserEditor);
  const otherTabHasUnsavedChanges = Boolean(input.lockState.otherTabHasUnsavedChanges);
  const timerState = buildTimerState(deps, input);
  const visible = input.propertyLockFeatureEnabled && Boolean(input.propertyLockSiteId);
  const viewState: MutablePropertyLockViewState = {
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
    return { viewState, timerState };
  }

  if (
    input.lockState.state === deps.PROPERTY_LOCK_STATE_UNLOCKED &&
    input.propertyLockConnectionStatus === deps.PROPERTY_LOCK_CONNECTION_CONNECTING
  ) {
    viewState.propertyLockTone = "muted";
    viewState.propertyLockIcon = "sync";
    viewState.propertyLockStatusText = deps.propertyLockText.popupConnecting;
    return { viewState, timerState };
  }

  if (
    input.lockState.state === deps.PROPERTY_LOCK_STATE_UNLOCKED &&
    input.propertyLockConnectionStatus === deps.PROPERTY_LOCK_CONNECTION_UNAVAILABLE
  ) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "cloud-off-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.popupUnavailable;
    viewState.propertyLockDetailText = deps.propertyLockText.popupUnavailableDetail;
    return { viewState, timerState };
  }

  if (input.propertyLockSuggestionVisible) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "account-switch-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.takeoverSuggestionMessage(
      input.propertyLockSuggestionFromName || "Someone"
    );
    viewState.propertyLockDetailText = deps.propertyLockText.popupEditorDetail;
    viewState.propertyLockSuggestionVisible = true;
    viewState.propertyLockAcceptVisible = true;
    viewState.propertyLockRejectVisible = true;
    return { viewState, timerState };
  }

  if (
    input.renderModeInspectionActive &&
    input.propertyLockDisconnectCountdown !== null
  ) {
    viewState.propertyLockTone = "muted";
    viewState.propertyLockIcon = "sync";
    viewState.propertyLockStatusText = deps.propertyLockText.popupInspectionReconnecting;
    return { viewState, timerState };
  }

  if (
    timerState &&
    timerState.kind === PROPERTY_LOCK_TIMER_KINDS.DISCONNECT
  ) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "wifi-off";
    viewState.propertyLockStatusText = deps.propertyLockText.editorDisconnectCountdownMessage(
      timerState.secondsRemaining
    );
    return { viewState, timerState };
  }

  if (
    timerState &&
    timerState.kind === PROPERTY_LOCK_TIMER_KINDS.INACTIVITY
  ) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "timer-alert-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.editorInactivityWarningMessage(
      timerState.secondsRemaining
    );
    viewState.propertyLockContinueVisible = true;
    return { viewState, timerState };
  }

  if (
    timerState &&
    timerState.kind === PROPERTY_LOCK_TIMER_KINDS.CROSS_PROPERTY
  ) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "home-export-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.popupCrossPropertyWarning(
      timerState.secondsRemaining
    );
    viewState.propertyLockDetailText = deps.propertyLockText.editorCrossPropertyCountdownMessage(
      timerState.secondsRemaining
    );
    return { viewState, timerState };
  }

  if (
    timerState &&
    timerState.kind === PROPERTY_LOCK_TIMER_KINDS.OFF_CANDIDATE
  ) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "map-marker-alert-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.popupOffCandidateWarning(
      timerState.secondsRemaining
    );
    viewState.propertyLockDetailText = deps.propertyLockText.editorOffCandidateCountdownMessage(
      timerState.secondsRemaining
    );
    return { viewState, timerState };
  }

  if (
    timerState &&
    timerState.kind === PROPERTY_LOCK_TIMER_KINDS.TRANSFER
  ) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "swap-horizontal";
    viewState.propertyLockStatusText = deps.propertyLockText.editorTransferCountdownMessage(
      input.lockState.transferFromName || editorName,
      input.lockState.transferToName || input.propertyLockSuggestionFromName || "the next editor",
      timerState.secondsRemaining
    );
    return { viewState, timerState };
  }

  if (input.propertyLockSuggestionPending) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "clock-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.passiveSuggestionPendingMessage(editorName);
    viewState.propertyLockDetailText = deps.propertyLockText.popupPassiveDetail;
    return { viewState, timerState };
  }

  if (input.propertyLockSuggestionRejected) {
    viewState.propertyLockTone = "danger";
    viewState.propertyLockIcon = "lock-alert-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.passiveSuggestionRejectedMessage(editorName);
    viewState.propertyLockDetailText = deps.propertyLockText.popupPassiveDetail;
    viewState.propertyLockSuggestVisible = true;
    return { viewState, timerState };
  }

  if (input.lockState.state === deps.PROPERTY_LOCK_STATE_UNLOCKED) {
    viewState.propertyLockTone = "success";
    viewState.propertyLockStatusText = deps.propertyLockText.popupUnlocked;
    return { viewState, timerState };
  }

  if (input.lockState.state === deps.PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "lock-open-variant-outline";
    viewState.propertyLockStatusText = input.lockState.isRecentEditor
      ? deps.propertyLockText.recentEditorInactiveMessage
      : deps.propertyLockText.takeoverAvailableMessage;
    viewState.propertyLockTakeVisible = true;
    viewState.propertyLockTakeText = input.lockState.isRecentEditor
      ? deps.propertyLockText.continueEditingButton
      : deps.propertyLockText.takeoverButton;
    return { viewState, timerState };
  }

  if (input.lockState.state === deps.PROPERTY_LOCK_STATE_TRANSFER) {
    viewState.propertyLockTone = "warning";
    viewState.propertyLockIcon = "swap-horizontal";
    viewState.propertyLockStatusText = deps.propertyLockText.editorTransferCountdownMessage(
      input.lockState.transferFromName || editorName,
      input.lockState.transferToName || "the next editor",
      input.propertyLockSecondsRemaining || 0
    );
    return { viewState, timerState };
  }

  if (input.lockState.isEditor) {
    viewState.propertyLockTone = "success";
    viewState.propertyLockIcon = "lock-check-outline";
    viewState.propertyLockStatusText = deps.propertyLockText.popupEditorActive;
    viewState.propertyLockDetailText = deps.propertyLockText.popupEditorDetail;
    return { viewState, timerState };
  }

  viewState.propertyLockTone = input.lockState.state === deps.PROPERTY_LOCK_STATE_EXPIRY_WARNING
    ? "warning"
    : "danger";
  viewState.propertyLockIcon = "lock-outline";
  viewState.propertyLockStatusText = sameUserEditor
    ? deps.propertyLockText.sameUserLockedMessage
    : input.lockState.state === deps.PROPERTY_LOCK_STATE_EXPIRY_WARNING
      ? deps.propertyLockText.passiveExpiryCountdownMessage(
          editorName,
          timerState?.kind === PROPERTY_LOCK_TIMER_KINDS.PASSIVE_EXPIRY
            ? timerState.secondsRemaining
            : input.propertyLockSecondsRemaining || 0
        )
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
      input.lockState.state === deps.PROPERTY_LOCK_STATE_LOCKED ||
      input.lockState.state === deps.PROPERTY_LOCK_STATE_EXPIRY_WARNING;
  }
  return { viewState, timerState };
}
