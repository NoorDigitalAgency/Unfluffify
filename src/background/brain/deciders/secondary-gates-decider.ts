import type { SecondaryGatesViewState } from "../../../common/bus/contracts/secondary-gates-state";
import { SECONDARY_GATES_BLOCK_REASONS } from "../../../common/bus/contracts/secondary-gates-state";
import { AI_RUN_PHASES, type SessionFacts } from "../../../common/bus/contracts/session-state";

function isBusy(facts: SessionFacts): boolean {
  return Boolean(
    facts.aiBusy ||
      facts.aiComputing ||
      facts.previewRestorePending ||
      facts.saving ||
      facts.discarding
  );
}

function cloneChecklistBlockingState(facts: SessionFacts) {
  return {
    code: typeof facts.lynxChecklistBlockingReason.code === "string"
      ? facts.lynxChecklistBlockingReason.code
      : "",
    pageTypeKeys: Array.isArray(facts.lynxChecklistBlockingReason.pageTypeKeys)
      ? [...facts.lynxChecklistBlockingReason.pageTypeKeys]
      : []
  };
}

export function deriveSecondaryGatesViewState(facts: SessionFacts): SecondaryGatesViewState {
  const busy = isBusy(facts);
  // POST_AI/AI_PREVIEW is the phase where the dictation-decider unconditionally
  // ENABLES the Discard button so the AI run can always be cleared back to
  // PRE_AI. Keep this gate's blocked-reason consistent with that button: an
  // enabled button must have an empty (NONE) reason, otherwise the page-revert
  // handler refuses (e.g. "no changes to save") even though the button is live.
  // The AI selectors are session-level, so currentPageHasPendingChanges is
  // typically false right after a run — that must NOT block Discard.
  const postAi =
    facts.aiRunPhase === AI_RUN_PHASES.POST_AI || facts.aiRunPhase === AI_RUN_PHASES.AI_PREVIEW;
  const pageSaveBlockedReason = busy
    ? SECONDARY_GATES_BLOCK_REASONS.BUSY
    : facts.pageSaveReconciliationPending
      ? SECONDARY_GATES_BLOCK_REASONS.SERVER_SYNC_PENDING
    : !facts.sessionHasPendingChanges
      ? SECONDARY_GATES_BLOCK_REASONS.NO_SESSION_CHANGES
    : facts.sessionRequiresAiRun
      ? SECONDARY_GATES_BLOCK_REASONS.REQUIRES_AI_RUN
      : SECONDARY_GATES_BLOCK_REASONS.NONE;
  const pageRevertBlockedReason = busy
    ? SECONDARY_GATES_BLOCK_REASONS.BUSY
    : postAi
      ? SECONDARY_GATES_BLOCK_REASONS.NONE
    : facts.pageSaveReconciliationPending
      ? SECONDARY_GATES_BLOCK_REASONS.SERVER_SYNC_PENDING
    : !facts.currentPageHasPendingChanges
      ? SECONDARY_GATES_BLOCK_REASONS.NO_PAGE_CHANGES
      : SECONDARY_GATES_BLOCK_REASONS.NONE;
  const markingPreviewBlockedReason = busy
    ? SECONDARY_GATES_BLOCK_REASONS.BUSY
    : facts.pageSaveReconciliationPending
      ? SECONDARY_GATES_BLOCK_REASONS.SERVER_SYNC_PENDING
    : !facts.aiRunUpToDate || facts.sessionRequiresAiRun
      ? SECONDARY_GATES_BLOCK_REASONS.REQUIRES_AI_RUN
      : SECONDARY_GATES_BLOCK_REASONS.NONE;
  const saveExcludesBlockedReason = busy
    ? SECONDARY_GATES_BLOCK_REASONS.BUSY
    : facts.pageSaveReconciliationPending
      ? SECONDARY_GATES_BLOCK_REASONS.SERVER_SYNC_PENDING
    : !facts.silentModeActive
      ? SECONDARY_GATES_BLOCK_REASONS.NOT_AVAILABLE
    : !facts.baseUrlReady || !facts.siteIdReady
      ? SECONDARY_GATES_BLOCK_REASONS.NOT_READY
      : SECONDARY_GATES_BLOCK_REASONS.NONE;
  const previewLatestBlockedReason = busy
    ? SECONDARY_GATES_BLOCK_REASONS.BUSY
    : facts.pageSaveReconciliationPending
      ? SECONDARY_GATES_BLOCK_REASONS.SERVER_SYNC_PENDING
    : !facts.silentModeActive
      ? SECONDARY_GATES_BLOCK_REASONS.NOT_AVAILABLE
    : !facts.baseUrlReady || !facts.siteIdReady
      ? SECONDARY_GATES_BLOCK_REASONS.NOT_READY
    : !facts.hasStoredSelectors
      ? SECONDARY_GATES_BLOCK_REASONS.NO_STORED_SELECTORS
    : !facts.aiRunUpToDate || facts.sessionRequiresAiRun
      ? SECONDARY_GATES_BLOCK_REASONS.REQUIRES_AI_RUN
    : facts.previewBlocked
      ? SECONDARY_GATES_BLOCK_REASONS.PREVIEW_BLOCKED
      : SECONDARY_GATES_BLOCK_REASONS.NONE;
  const desktopPreviewBlockedReason = busy
    ? SECONDARY_GATES_BLOCK_REASONS.BUSY
    : !facts.desktopPreviewVisible
      ? SECONDARY_GATES_BLOCK_REASONS.NOT_AVAILABLE
    : !facts.renderModeReady
      ? SECONDARY_GATES_BLOCK_REASONS.NOT_READY
    : facts.pageInspectionBusy || facts.navigationInspectionPending
      ? SECONDARY_GATES_BLOCK_REASONS.PAGE_INSPECTION
    : facts.deviceControlsDisabled
      ? SECONDARY_GATES_BLOCK_REASONS.DEVICE_CONTROLS_LOCKED
      : SECONDARY_GATES_BLOCK_REASONS.NONE;
  const lynxChecklistSendBlockedReason = busy
    ? { code: SECONDARY_GATES_BLOCK_REASONS.BUSY, pageTypeKeys: [] }
    : facts.pageSaveReconciliationPending
      ? { code: SECONDARY_GATES_BLOCK_REASONS.SERVER_SYNC_PENDING, pageTypeKeys: [] }
    : !facts.silentModeActive
      ? { code: SECONDARY_GATES_BLOCK_REASONS.NOT_AVAILABLE, pageTypeKeys: [] }
    : !facts.baseUrlReady || !facts.siteIdReady
      ? { code: SECONDARY_GATES_BLOCK_REASONS.NOT_READY, pageTypeKeys: [] }
    : facts.lynxChecklistCanSend
      ? { code: "", pageTypeKeys: [] }
      : cloneChecklistBlockingState(facts);

  return {
    pageSaveBlockedReason,
    pageRevertBlockedReason,
    markingPreviewBlockedReason,
    saveExcludesButtonDisabled: saveExcludesBlockedReason !== SECONDARY_GATES_BLOCK_REASONS.NONE,
    saveExcludesBlockedReason,
    previewLatestButtonDisabled: previewLatestBlockedReason !== SECONDARY_GATES_BLOCK_REASONS.NONE,
    previewLatestBlockedReason,
    desktopPreviewVisible: facts.desktopPreviewVisible,
    desktopPreviewEnabled: facts.desktopPreviewVisible && facts.desktopPreviewActive,
    desktopPreviewDisabled: desktopPreviewBlockedReason !== SECONDARY_GATES_BLOCK_REASONS.NONE,
    desktopPreviewBlockedReason,
    lynxChecklistSendBlockedReason,
    navigationInspectionActive: Boolean(
      facts.navigationInspectionPending || facts.pageInspectionBusy
    )
  };
}
