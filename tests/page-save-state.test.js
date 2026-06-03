import test from "node:test";
import assert from "node:assert/strict";

import { buildPageSaveUiState } from "../common/page-save-state.js";
import { PopupText } from "../common/text.js";

test("shows saved session state and disables save when nothing is pending", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: false,
    sessionRequiresAiRun: false,
    reconciliation: null
  });

  assert.equal(state.pageDraftStatusText, PopupText.page.statusSessionSaved);
  assert.equal(state.pageDraftStatusTone, "success");
  assert.equal(state.pageSaveDisabled, true);
  assert.equal(state.pageRevertDisabled, true);
  assert.equal(state.aiBlockedByDraft, false);
  assert.equal(state.aiDirtyNoticeText, PopupText.ai.dirtyNotice);
  assert.equal(state.pageSessionNoticeVisible, false);
});

test("keeps save and discard blocked while reconciliation is pending", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    reconciliation: {
      status: "pending",
      reason: "pending"
    }
  });

  assert.equal(state.pageSaveDisabled, true);
  assert.equal(state.pageRevertDisabled, true);
  assert.equal(state.pageSaveMobileSimulationRequiredVisible, false);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusServerSyncPending);
  assert.equal(state.pageDraftStatusTone, "warning");
  assert.equal(state.aiBlockedByDraft, true);
  assert.equal(state.aiDirtyNoticeText, PopupText.page.statusServerSyncPending);
});

test("keeps retry messaging without blocking save and discard after a failed reconciliation", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    reconciliation: {
      status: "pending",
      reason: "sync_failed"
    }
  });

  assert.equal(state.pageSaveDisabled, false);
  assert.equal(state.pageRevertDisabled, false);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusServerSyncFailed);
  assert.equal(state.pageDraftStatusTone, "warning");
  assert.equal(state.aiBlockedByDraft, false);
  assert.equal(state.aiDirtyNoticeText, PopupText.page.statusServerSyncFailed);
});

test("requires AI before saving when the session is stale", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: true,
    reconciliation: null
  });

  assert.equal(state.pageSaveDisabled, true);
  assert.equal(state.pageRevertDisabled, false);
  assert.equal(state.pageSaveMobileSimulationRequiredVisible, false);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusRunAiBeforeSaving);
  assert.equal(state.pageDraftStatusTone, "warning");
  assert.equal(state.pageSessionNoticeVisible, true);
  assert.equal(state.pageSessionNoticeText, PopupText.page.noticeRunAiBeforeSaving);
});

test("enables save and discard when the session is ready to sync", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    reconciliation: null
  });

  assert.equal(state.pageSaveDisabled, false);
  assert.equal(state.pageRevertDisabled, false);
  assert.equal(state.pageDataNewNoticeHidden, true);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusSessionChangesReadyToSave);
  assert.equal(state.pageSessionNoticeVisible, false);
});

test("clears status text when page controls are hidden", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: false,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: true,
    reconciliation: null
  });

  assert.equal(state.pageSaveDisabled, true);
  assert.equal(state.pageRevertDisabled, true);
  assert.equal(state.pageDraftStatusText, "");
  assert.equal(state.pageSessionNoticeVisible, false);
});
