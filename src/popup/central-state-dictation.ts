import type { PopupStateGetReply } from "../common/bus/contracts/popup-state";
import type { SessionDictation } from "../common/bus/contracts/session-state";

export type CentralSessionDictationProjectionState = {
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
  previewActive?: boolean;
  previewBlocked?: boolean;
  previewItemsPending?: boolean;
  previewBlockedMessage?: string;
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
    state.currentTabId !== null &&
      state.projectedTabId === state.currentTabId &&
      state.sessionDictation
  );
}

const NEUTRAL_SESSION_DICTATION_PATCH: CentralSessionDictationViewStatePatch = {
  mainUiHidden: true,
  silentModeActive: false,
  toggleEnabledDisabled: true,
  computeButtonDisabled: true,
  computeButtonLoading: false,
  markingPreviewVisible: false,
  markingPreviewDisabled: true,
  pageSaveDisabled: true,
  pageRevertDisabled: true,
  previewActive: false,
  previewBlocked: false,
  previewItemsPending: false,
  previewBlockedMessage: "",
  sessionCurtainVisible: false,
  sessionCurtainMessage: "",
  sessionCurtainNote: "",
  sessionCurtainTimerText: "",
  sessionCurtainOperation: "",
  sessionCurtainPhase: "",
};

export function buildCentralSessionDictationViewStatePatch(
  state: CentralSessionDictationProjectionState,
): CentralSessionDictationViewStatePatch | null {
  if (!hasProjectedCentralSessionDictationForTab(state) || !state.sessionDictation) {
    return { ...NEUTRAL_SESSION_DICTATION_PATCH };
  }

  const dictation = state.sessionDictation;
  const effectivePhase = state.sessionPhase || dictation.phase;
  const showCurtain = dictation.curtain.visible && effectivePhase !== "silent";
  const preview = dictation.preview || { active: false, blocked: false, itemsPending: false };
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
    previewActive: preview.active === true,
    previewBlocked: preview.blocked === true,
    previewItemsPending: preview.itemsPending === true,
    sessionCurtainVisible: showCurtain,
    sessionCurtainMessage: showCurtain ? dictation.curtain.message : "",
    sessionCurtainNote: showCurtain ? dictation.curtain.note : "",
    sessionCurtainTimerText: showCurtain ? dictation.curtain.timerText : "",
    sessionCurtainOperation: showCurtain ? dictation.curtain.operation : "",
    sessionCurtainPhase: effectivePhase,
  };
}

export function deriveCentralSessionDictationSnapshotEffect(
  state: CentralSessionDictationProjectionState & { hadProjectedSessionDictation: boolean },
): CentralSessionDictationSnapshotEffect {
  const patch = buildCentralSessionDictationViewStatePatch(state);
  return {
    patch,
    refreshRequired: false,
  };
}
