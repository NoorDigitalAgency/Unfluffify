import type { PopupStateGetReply } from "../common/bus/contracts/popup-state";
import type { SessionDictation } from "../common/bus/contracts/session-state";

export type CentralSessionDictationProjectionState = {
  featureEnabled: boolean;
  currentTabId: number | null;
  projectedTabId: number | null;
  sessionPhase: PopupStateGetReply["sessionPhase"] | null;
  sessionDictation: SessionDictation | null;
};

export type CentralSessionDictationViewStatePatch = {
  mainUiHidden?: boolean;
  silentModeActive?: boolean;
  toggleEnabledDisabled?: boolean;
  computeButtonDisabled?: boolean;
  computeButtonLoading?: boolean;
  markingPreviewVisible?: boolean;
  markingPreviewDisabled?: boolean;
  pageSaveDisabled?: boolean;
  pageRevertDisabled?: boolean;
  sessionCurtainVisible?: boolean;
  sessionCurtainMessage?: string;
  sessionCurtainNote?: string;
  sessionCurtainTimerText?: string;
  sessionCurtainOperation?: string;
  sessionCurtainPhase?: string;
};

export type CentralSessionDictationSnapshotEffect = {
  patch: CentralSessionDictationViewStatePatch | null;
  refreshRequired: boolean;
};

export function hasProjectedCentralSessionDictationForTab(
  state: CentralSessionDictationProjectionState,
): boolean {
  return Boolean(
    state.featureEnabled &&
      state.currentTabId &&
      state.projectedTabId === state.currentTabId &&
      state.sessionDictation
  );
}

export function shouldUseLocalSessionAuthorityFallback(
  state: CentralSessionDictationProjectionState,
): boolean {
  return !hasProjectedCentralSessionDictationForTab(state);
}

export function buildCentralSessionDictationViewStatePatch(
  state: CentralSessionDictationProjectionState,
): CentralSessionDictationViewStatePatch | null {
  if (!hasProjectedCentralSessionDictationForTab(state) || !state.sessionDictation) {
    return null;
  }

  const dictation = state.sessionDictation;
  return {
    mainUiHidden: dictation.mainUiHidden,
    silentModeActive: dictation.silentModeActive,
    toggleEnabledDisabled: !dictation.buttons["toggle-enabled"].enabled,
    computeButtonDisabled: !dictation.buttons.compute.enabled,
    computeButtonLoading: dictation.buttons.compute.loading,
    markingPreviewVisible: dictation.buttons["marking-preview"].visible,
    markingPreviewDisabled: !dictation.buttons["marking-preview"].enabled,
    pageSaveDisabled: !dictation.buttons["page-save"].enabled,
    pageRevertDisabled: !dictation.buttons["page-revert"].enabled,
    sessionCurtainVisible: dictation.curtain.visible,
    sessionCurtainMessage: dictation.curtain.message,
    sessionCurtainNote: dictation.curtain.note,
    sessionCurtainTimerText: dictation.curtain.timerText,
    sessionCurtainOperation: dictation.curtain.operation,
    sessionCurtainPhase: state.sessionPhase || dictation.phase,
  };
}

export function deriveCentralSessionDictationSnapshotEffect(
  state: CentralSessionDictationProjectionState & { hadProjectedSessionDictation: boolean },
): CentralSessionDictationSnapshotEffect {
  const patch = buildCentralSessionDictationViewStatePatch(state);
  return {
    patch,
    refreshRequired: !patch && state.hadProjectedSessionDictation,
  };
}
