import {
  AI_RUN_PHASES,
  BUTTON_IDS,
  CURTAIN_OPERATIONS,
  type ButtonDictation,
  type ButtonId,
  type CurtainDictation,
  type SessionDictation,
  type SessionFacts,
  type SessionPhase,
} from "../../../common/bus/contracts/session-state";

function buildButtonDictation(
  id: ButtonId,
  visible: boolean,
  enabled: boolean,
  loading = false,
): ButtonDictation {
  return {
    id,
    visible,
    enabled: visible && enabled,
    loading,
  };
}

function deriveMainUiHidden(facts: SessionFacts): boolean {
  return Boolean(
    facts.pageScopedUiDisabled ||
      !facts.isEnabled ||
      (!facts.navigationInspectionPending && (!facts.siteIdReady || !facts.renderModeReady))
  );
}

function derivePageControlsVisible(facts: SessionFacts, mainUiHidden: boolean): boolean {
  return !mainUiHidden && facts.renderModeReady;
}

function deriveCurtainDictation(phase: SessionPhase, facts: SessionFacts): CurtainDictation {
  if (phase === "computing_ai") {
    return {
      visible: true,
      operation: CURTAIN_OPERATIONS.COMPUTING_AI,
      message: facts.busyMessage || "Computing selectors",
      note: facts.busyNote,
      timerText: facts.busyTimerText,
    };
  }

  if (phase === "saving") {
    return {
      visible: true,
      operation: CURTAIN_OPERATIONS.SAVING,
      message: facts.busyMessage || "Saving changes",
      note: facts.busyNote,
      timerText: facts.busyTimerText,
    };
  }

  if (phase === "discarding") {
    return {
      visible: true,
      operation: CURTAIN_OPERATIONS.DISCARDING,
      message: facts.busyMessage || "Discarding changes",
      note: facts.busyNote,
      timerText: facts.busyTimerText,
    };
  }

  if (facts.busyVisible || facts.aiBusy) {
    return {
      visible: true,
      operation: CURTAIN_OPERATIONS.BUSY,
      message: facts.busyMessage || "Please wait",
      note: facts.busyNote,
      timerText: facts.busyTimerText,
    };
  }

  return {
    visible: false,
    operation: CURTAIN_OPERATIONS.IDLE,
    message: "",
    note: "",
    timerText: "",
  };
}

export function deriveDictation(phase: SessionPhase, facts: SessionFacts): SessionDictation {
  const mainUiHidden = deriveMainUiHidden(facts);
  const pageControlsVisible = derivePageControlsVisible(facts, mainUiHidden);
  const postAi = facts.aiRunPhase === AI_RUN_PHASES.POST_AI || facts.aiRunPhase === AI_RUN_PHASES.AI_PREVIEW;
  const actionMatrixDisabled = Boolean(
    facts.pageScopedUiDisabled ||
      facts.aiBusy ||
      facts.previewRestorePending ||
      facts.pageSaveReconciliationPending ||
      facts.saving ||
      facts.discarding
  );

  const toggleEnabledDisabled = Boolean(
    facts.pageScopedUiDisabled ||
      postAi ||
      facts.previewRestorePending ||
      facts.pageSaveReconciliationPending ||
      !facts.baseUrlReady ||
      (!facts.navigationInspectionPending && (!facts.siteIdReady || !facts.renderModeReady || facts.pageTypeUiBlocked)) ||
      facts.desktopPreviewActive
  );

  // Discard must always be reachable in POST_AI so a stuck/pending reconciliation
  // can be unconditionally cleared back to PRE_AI; only an active busy/save/discard
  // run blocks it. Save/List stay gated on reconciliation pending.
  const revertMatrixDisabled = Boolean(
    facts.pageScopedUiDisabled ||
      facts.aiBusy ||
      facts.previewRestorePending ||
      facts.saving ||
      facts.discarding
  );

  const computeButtonDisabled = actionMatrixDisabled || postAi;

  const buttons = {
    [BUTTON_IDS.TOGGLE_ENABLED]: buildButtonDictation(
      BUTTON_IDS.TOGGLE_ENABLED,
      facts.renderModeReady,
      !toggleEnabledDisabled,
    ),
    [BUTTON_IDS.COMPUTE]: buildButtonDictation(
      BUTTON_IDS.COMPUTE,
      !mainUiHidden,
      !computeButtonDisabled,
      facts.aiComputing,
    ),
    [BUTTON_IDS.MARKING_PREVIEW]: buildButtonDictation(
      BUTTON_IDS.MARKING_PREVIEW,
      pageControlsVisible && facts.isEnabled,
      postAi && !actionMatrixDisabled,
    ),
    [BUTTON_IDS.PAGE_SAVE]: buildButtonDictation(
      BUTTON_IDS.PAGE_SAVE,
      pageControlsVisible,
      postAi && !actionMatrixDisabled,
    ),
    [BUTTON_IDS.PAGE_REVERT]: buildButtonDictation(
      BUTTON_IDS.PAGE_REVERT,
      pageControlsVisible,
      postAi && !revertMatrixDisabled,
    ),
  };

  return {
    phase,
    mainUiHidden,
    pageControlsVisible,
    silentModeActive: facts.silentModeActive,
    buttons,
    curtain: deriveCurtainDictation(phase, facts),
  };
}
