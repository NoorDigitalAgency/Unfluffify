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

// P4 step 4.2: the projected dictation is a phase pointer only. The patch
// carries the effective phase (adoption/gating vocabulary — every projected
// AND neutral patch has it); buttons/mode/curtain/preview content come from
// the machine surface memories applied on top (overrideDictatedMarkingButtons
// / overrideDictatedPreviewVisibility), with the local derivation underneath
// covering pass-through states until P5 retires it.
export function buildCentralSessionDictationViewStatePatch(
  state: CentralSessionDictationProjectionState,
): CentralSessionDictationViewStatePatch | null {
  if (!hasProjectedCentralSessionDictationForTab(state) || !state.sessionDictation) {
    return { ...NEUTRAL_SESSION_DICTATION_PATCH };
  }

  return {
    sessionCurtainPhase: state.sessionPhase || state.sessionDictation.phase,
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
