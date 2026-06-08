import { NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS } from "./config.js";
import { PopupText } from "./text.js";

function isBlockingPageSaveReconciliation(reconciliation) {
  if (!reconciliation || reconciliation.status !== "pending") {
    return false;
  }
  return !NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS.has(reconciliation.reason);
}

export function getPageSaveReconciliationStatusText(reconciliation) {
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

export function buildPageSaveUiState(options = {}) {
  const {
    pageControlsVisible = false,
    sessionHasPendingChanges = false,
    pageHasPendingChanges = sessionHasPendingChanges,
    sessionRequiresAiRun = false,
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

  const pageRevertDisabled =
    !pageControlsVisible ||
    pageSaveReconciliationPending ||
    !pageHasPendingChanges;

  let pageDraftStatusText = "";
  let pageDraftStatusTone = "muted";
  let pageSessionNoticeVisible = false;
  let pageSessionNoticeText = "";

  if (!pageControlsVisible) {
    pageDraftStatusText = "";
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
