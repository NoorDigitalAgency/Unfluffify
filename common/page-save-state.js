import { PopupText } from "./text.js";

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
    currentDraftAvailable = false,
    hasSavedPageData = false,
    currentDraftDirty = false,
    needsAiSnapshotBackfill = false,
    mobileSimulationBlocked = false,
    reconciliation = null
  } = options;

  const pageSaveReconciliationPending = Boolean(reconciliation);
  const canInitialPageSave = !hasSavedPageData;

  const pageSaveDisabled =
    !pageControlsVisible ||
    !currentDraftAvailable ||
    (!pageSaveReconciliationPending && mobileSimulationBlocked) ||
    (!pageSaveReconciliationPending &&
      !currentDraftDirty &&
      !canInitialPageSave &&
      !needsAiSnapshotBackfill);

  const pageSaveMobileSimulationRequiredVisible =
    pageControlsVisible &&
    !pageSaveReconciliationPending &&
    mobileSimulationBlocked &&
    currentDraftAvailable &&
    (currentDraftDirty || canInitialPageSave || needsAiSnapshotBackfill);

  const pageRevertDisabled =
    !pageControlsVisible ||
    pageSaveReconciliationPending ||
    !currentDraftAvailable ||
    !hasSavedPageData ||
    !currentDraftDirty;

  let pageDraftStatusText = "";
  let pageDraftStatusTone = "muted";

  if (!pageControlsVisible) {
    pageDraftStatusText = "";
  } else if (!currentDraftAvailable) {
    pageDraftStatusText = PopupText.page.statusDraftUnavailable;
    pageDraftStatusTone = "warning";
  } else if (pageSaveReconciliationPending) {
    pageDraftStatusText = getPageSaveReconciliationStatusText(reconciliation);
    pageDraftStatusTone = "warning";
  } else if (!hasSavedPageData) {
    pageDraftStatusText = PopupText.page.statusNoSavedData;
    pageDraftStatusTone = "muted";
  } else if (currentDraftDirty) {
    pageDraftStatusText = PopupText.page.statusUnsavedChanges;
    pageDraftStatusTone = "warning";
  } else if (needsAiSnapshotBackfill) {
    pageDraftStatusText = PopupText.page.statusNeedsAiSnapshot;
    pageDraftStatusTone = "warning";
  } else {
    pageDraftStatusText = PopupText.page.statusAllChangesSaved;
    pageDraftStatusTone = "success";
  }

  return {
    pageSaveReconciliationPending,
    pageSaveDisabled,
    pageSaveMobileSimulationRequiredVisible,
    pageRevertDisabled,
    pageDraftStatusText,
    pageDraftStatusTone,
    pageDataNewNoticeHidden:
      !pageControlsVisible ||
      !currentDraftAvailable ||
      pageSaveReconciliationPending ||
      hasSavedPageData,
    aiBlockedByDraft: currentDraftDirty || pageSaveReconciliationPending,
    aiDirtyNoticeText: pageSaveReconciliationPending
      ? PopupText.page.statusServerSyncPending
      : PopupText.ai.dirtyNotice
  };
}
