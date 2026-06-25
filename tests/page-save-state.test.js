import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS,
  isPageSaveReconciliationPending
} from "../src/common/config.js";
import { buildPageSaveUiState } from "../src/common/page-save-state.js";
import { PopupText } from "../src/common/text.js";

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

test("keeps pending reconciliation messaging without blocking save and discard", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: true,
    reconciliation: {
      status: "pending",
      reason: "pending"
    }
  });

  assert.equal(state.pageSaveDisabled, false);
  assert.equal(state.pageRevertDisabled, false);
  assert.equal(state.pageSaveMobileSimulationRequiredVisible, false);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusServerSyncPending);
  assert.equal(state.pageDraftStatusTone, "warning");
  assert.equal(state.aiBlockedByDraft, false);
  assert.equal(state.aiDirtyNoticeText, PopupText.page.statusServerSyncPending);
});

test("page-save UI and config share the non-blocking reconciliation reasons", () => {
  const pageSaveStateSource = readFileSync(new URL("../src/common/page-save-state.ts", import.meta.url), "utf8");

  assert.match(pageSaveStateSource, /import \{ NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS \} from "\.\/config\.js";/);
  assert.doesNotMatch(pageSaveStateSource, /\[\s*""[\s\S]*?"load_failed"[\s\S]*?\]\.includes/);
  for (const reason of NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS) {
    const reconciliation = {
      status: "pending",
      reason
    };
    const state = buildPageSaveUiState({
      pageControlsVisible: true,
      sessionHasPendingChanges: true,
      sessionRequiresAiRun: false,
      reconciliation
    });

    assert.equal(isPageSaveReconciliationPending(reconciliation), false, reason);
    assert.equal(state.pageSaveReconciliationPending, false, reason);
    assert.equal(state.pageSaveDisabled, false, reason);
  }
});

test("keeps retry messaging without blocking save and discard after a failed reconciliation", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: true,
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

test("requires AI before saving but keeps discard enabled when the session is stale", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: true,
    currentDraftDirty: true,
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
    currentDraftDirty: true,
    reconciliation: null
  });

  assert.equal(state.pageSaveDisabled, false);
  assert.equal(state.pageRevertDisabled, false);
  assert.equal(state.pageDataNewNoticeHidden, true);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusSessionChangesReadyToSave);
  assert.equal(state.pageSessionNoticeVisible, false);
});

test("keeps session save available while disabling discard when only another page is dirty", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: false,
    reconciliation: null
  });

  assert.equal(state.pageSaveDisabled, false);
  assert.equal(state.pageRevertDisabled, true);
});

test("enables discard when the page is dirty even with no saved baseline to revert to", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: true,
    currentDraftDirty: true,
    reconciliation: null
  });

  assert.equal(state.pageRevertDisabled, false);
  assert.equal(state.pageDraftStatusText, PopupText.page.statusRunAiBeforeSaving);
});

test("keeps discard disabled when the page has no unsaved edits (auto-seeded marks only)", () => {
  const state = buildPageSaveUiState({
    pageControlsVisible: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: false,
    reconciliation: null
  });

  assert.equal(state.pageRevertDisabled, true);
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
