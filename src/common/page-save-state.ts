import { NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS } from "./config";
import { PopupText } from "./text";

type PageSaveReconciliation = {
  status?: string;
  reason?: string;
} | null;

type BuildPageSaveUiStateOptions = {
  pageControlsVisible?: boolean;
  sessionHasPendingChanges?: boolean;
  sessionRequiresAiRun?: boolean;
  currentDraftDirty?: boolean;
  reconciliation?: PageSaveReconciliation;
};

function isBlockingPageSaveReconciliation(reconciliation: PageSaveReconciliation): boolean {
  if (!reconciliation || reconciliation.status !== "pending") {
    return false;
  }
  return !NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS.has(reconciliation.reason ?? "");
}

export function getPageSaveReconciliationStatusText(
  reconciliation: PageSaveReconciliation
): string {
  const reason = reconciliation && typeof reconciliation.reason === "string"
    ? reconciliation.reason
    : "";
  if (reason === "sync_failed") {
    return PopupText.page.statusServerSyncFailed;
  }
  if (reason === "sync_skipped") {
    return PopupText.page.statusServerSyncSkipped;
  }
  if (reason === "load_failed") {
    return PopupText.page.statusServerRefreshFailed;
  }
  return PopupText.page.statusServerSyncPending;
}

export function buildPageSaveUiState(options: BuildPageSaveUiStateOptions = {}) {
  const {
    pageControlsVisible = false,
    sessionHasPendingChanges = false,
    sessionRequiresAiRun = false,
    currentDraftDirty = false,
    reconciliation = null
  } = options;

  const hasPageSaveReconciliation = Boolean(reconciliation);
  const pageSaveReconciliationPending = isBlockingPageSaveReconciliation(reconciliation);

  const pageSaveDisabled =
    !pageControlsVisible ||
    pageSaveReconciliationPending ||
    !sessionHasPendingChanges ||
    sessionRequiresAiRun;

  const pageSaveMobileSimulationRequiredVisible = false;

  // Discard drops the current-session marking edits. It is available whenever the
  // draft has unsaved session edits (currentDraftDirty): discard reverts to the
  // last backend-saved baseline, or clears the page's marks if it was never saved.
  // Auto-seeded marks from CSS/AI selectors on first enable are not "dirty", so
  // Discard stays disabled until the user actually marks/unmarks something.
  const pageRevertDisabled =
    !pageControlsVisible ||
    pageSaveReconciliationPending ||
    !currentDraftDirty;

  let pageDraftStatusText: string;
  let pageDraftStatusTone: string;
  let pageSessionNoticeVisible = false;
  let pageSessionNoticeText = "";

  if (!pageControlsVisible) {
    pageDraftStatusText = "";
    pageDraftStatusTone = "success";
  } else if (pageSaveReconciliationPending) {
    pageDraftStatusText = getPageSaveReconciliationStatusText(reconciliation);
    pageDraftStatusTone = "warning";
  } else if (hasPageSaveReconciliation) {
    pageDraftStatusText = getPageSaveReconciliationStatusText(reconciliation);
    pageDraftStatusTone = "warning";
  } else if (sessionHasPendingChanges && sessionRequiresAiRun) {
    pageDraftStatusText = PopupText.page.statusRunAiBeforeSaving;
    pageDraftStatusTone = "warning";
    pageSessionNoticeVisible = true;
    pageSessionNoticeText = PopupText.page.noticeRunAiBeforeSaving;
  } else if (sessionHasPendingChanges) {
    pageDraftStatusText = PopupText.page.statusSessionChangesReadyToSave;
    pageDraftStatusTone = "warning";
  } else {
    pageDraftStatusText = PopupText.page.statusSessionSaved;
    pageDraftStatusTone = "success";
  }

  return {
    pageSaveReconciliationPending,
    pageSaveDisabled,
    pageSaveMobileSimulationRequiredVisible,
    pageRevertDisabled,
    pageDraftStatusText,
    pageDraftStatusTone,
    pageSessionNoticeVisible,
    pageSessionNoticeText,
    pageDataNewNoticeHidden: true,
    aiBlockedByDraft: pageSaveReconciliationPending,
    aiDirtyNoticeText: hasPageSaveReconciliation
      ? getPageSaveReconciliationStatusText(reconciliation)
      : PopupText.ai.dirtyNotice
  };
}
