import test from "node:test";
import assert from "node:assert/strict";

import { buildPageSaveUiState } from "../common/page-save-state.js";
import { PopupText } from "../common/text.js";

test("shows saved state and disables save when sync and refresh are complete", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    currentDraftAvailable: true,
    hasSavedPageData: true,
    currentDraftDirty: false,
    needsAiSnapshotBackfill: false,
    mobileSimulationBlocked: false,
    reconciliation: null
  });

  assert.equal(state.pageDraftStatusText, PopupText.page.statusAllChangesSaved);
  assert.equal(state.pageDraftStatusTone, "success");
  assert.equal(state.pageSaveDisabled, true);
  assert.equal(state.pageRevertDisabled, true);
  assert.equal(state.aiBlockedByDraft, false);
  assert.equal(state.aiDirtyNoticeText, PopupText.ai.dirtyNotice);
});

test("keeps save enabled for retry while sync is pending and suppresses mobile requirement", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    currentDraftAvailable: true,
    hasSavedPageData: true,
    currentDraftDirty: false,
    needsAiSnapshotBackfill: false,
    mobileSimulationBlocked: true,
    reconciliation: {
      status: "pending",
      reason: "pending"
    }
  });

  assert.equal(state.pageSaveDisabled, false);
  assert.equal(state.pageSaveMobileSimulationRequiredVisible, false);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusServerSyncPending);
  assert.equal(state.pageDraftStatusTone, "warning");
  assert.equal(state.aiBlockedByDraft, true);
  assert.equal(state.aiDirtyNoticeText, PopupText.page.statusServerSyncPending);
});

test("requires mobile simulation for initial save when no reconciliation is pending", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    currentDraftAvailable: true,
    hasSavedPageData: false,
    currentDraftDirty: false,
    needsAiSnapshotBackfill: false,
    mobileSimulationBlocked: true,
    reconciliation: null
  });

  assert.equal(state.pageSaveDisabled, true);
  assert.equal(state.pageSaveMobileSimulationRequiredVisible, true);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusNoSavedData);
  assert.equal(state.pageDraftStatusTone, "muted");
});

test("reports unsaved changes while allowing save when mobile simulation is available", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    currentDraftAvailable: true,
    hasSavedPageData: true,
    currentDraftDirty: true,
    needsAiSnapshotBackfill: false,
    mobileSimulationBlocked: false,
    reconciliation: null
  });

  assert.equal(state.pageSaveDisabled, false);
  assert.equal(state.pageSaveMobileSimulationRequiredVisible, false);
  assert.equal(state.pageRevertDisabled, false);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusUnsavedChanges);
  assert.equal(state.pageDraftStatusTone, "warning");
  assert.equal(state.aiBlockedByDraft, true);
});
