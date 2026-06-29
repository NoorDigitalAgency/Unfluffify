import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { deriveDictation } from "../src/background/brain/deciders/dictation-decider.js";
import { decideSessionPhase } from "../src/background/brain/deciders/session-phase-decider.js";
import { AI_RUN_PHASES, BUTTON_IDS, SESSION_PHASES } from "../src/common/bus/contracts/session-state.js";

function buildFacts(overrides = {}) {
  return {
    baseUrlReady: true,
    pageScopedUiDisabled: false,
    navigationInspectionPending: false,
    siteIdReady: true,
    renderModeReady: true,
    pageTypeUiBlocked: false,
    currentPageHasPendingChanges: false,
    pageInspectionBusy: false,
    desktopPreviewVisible: false,
    desktopPreviewActive: false,
    deviceControlsDisabled: false,
    isEnabled: true,
    silentModeActive: false,
    aiReady: true,
    aiBusy: false,
    aiComputing: false,
    aiRunPhase: AI_RUN_PHASES.PRE_AI,
    aiRunUpToDate: false,
    previewActive: false,
    previewBlocked: false,
    previewRestorePending: false,
    sessionHasPendingChanges: false,
    sessionRequiresAiRun: false,
    currentDraftDirty: false,
    pageSaveReconciliationPending: false,
    propertyLockBlocked: false,
    saving: false,
    discarding: false,
    hasStoredSelectors: false,
    lynxChecklistCanSend: false,
    lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
    busyVisible: false,
    busyMessage: "",
    busyNote: "",
    busyTimerText: "",
    ...overrides,
  };
}

test("dictation keeps fresh marking in the approved matrix state", () => {
  const facts = buildFacts();
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(dictation.phase, SESSION_PHASES.MARKING_FRESH);
  assert.equal(dictation.mainUiHidden, false);
  assert.equal(dictation.pageControlsVisible, true);
  assert.equal(dictation.buttons[BUTTON_IDS.TOGGLE_ENABLED].visible, true);
  assert.equal(dictation.buttons[BUTTON_IDS.TOGGLE_ENABLED].enabled, true);
  assert.equal(dictation.buttons[BUTTON_IDS.COMPUTE].enabled, true);
  assert.equal(dictation.buttons[BUTTON_IDS.MARKING_PREVIEW].visible, true);
  assert.equal(dictation.buttons[BUTTON_IDS.MARKING_PREVIEW].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_SAVE].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_REVERT].enabled, false);
});

test("dictation keeps pre-AI post-edit marking save/list/discard disabled", () => {
  const facts = buildFacts({
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: true,
    currentDraftDirty: true,
  });
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(dictation.phase, SESSION_PHASES.MARKING_DIRTY);
  assert.equal(dictation.buttons[BUTTON_IDS.COMPUTE].enabled, true);
  assert.equal(dictation.buttons[BUTTON_IDS.MARKING_PREVIEW].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_SAVE].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_REVERT].enabled, false);
});

test("dictation keeps ready-to-save marking in the approved post-AI state", () => {
  const facts = buildFacts({
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: true,
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    aiRunUpToDate: true,
    hasStoredSelectors: true,
  });
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(dictation.phase, SESSION_PHASES.READY_TO_SAVE);
  assert.equal(dictation.buttons[BUTTON_IDS.TOGGLE_ENABLED].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.COMPUTE].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.MARKING_PREVIEW].enabled, true);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_SAVE].enabled, true);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_REVERT].enabled, true);
});

test("dictation disables the matrix during preview restore without hiding marking controls", () => {
  const facts = buildFacts({
    previewRestorePending: true,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: true,
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    aiRunUpToDate: true,
  });
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(dictation.phase, SESSION_PHASES.PREVIEW_RESTORING);
  assert.equal(dictation.buttons[BUTTON_IDS.TOGGLE_ENABLED].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.COMPUTE].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.MARKING_PREVIEW].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_SAVE].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_REVERT].enabled, false);
});

test("dictation keeps post-AI actions enabled even when legacy freshness facts drift", () => {
  const facts = buildFacts({
    aiReady: false,
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    aiRunUpToDate: false,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: true,
    currentDraftDirty: true,
  });
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(dictation.buttons[BUTTON_IDS.COMPUTE].enabled, false);
  assert.equal(dictation.buttons[BUTTON_IDS.MARKING_PREVIEW].enabled, true);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_SAVE].enabled, true);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_REVERT].enabled, true);
});

test("dictation hides post-render controls until render mode is ready", () => {
  const facts = buildFacts({
    renderModeReady: false,
    siteIdReady: false,
  });
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(dictation.phase, SESSION_PHASES.LOADING);
  assert.equal(dictation.mainUiHidden, true);
  assert.equal(dictation.pageControlsVisible, false);
  assert.equal(dictation.buttons[BUTTON_IDS.TOGGLE_ENABLED].visible, false);
  assert.equal(dictation.buttons[BUTTON_IDS.COMPUTE].visible, false);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_SAVE].visible, false);
  assert.equal(dictation.buttons[BUTTON_IDS.PAGE_REVERT].visible, false);
});

test("dictation keeps the toggle disabled while desktop preview is active", () => {
  const facts = buildFacts({
    desktopPreviewActive: true,
  });
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(dictation.buttons[BUTTON_IDS.TOGGLE_ENABLED].visible, true);
  assert.equal(dictation.buttons[BUTTON_IDS.TOGGLE_ENABLED].enabled, false);
});

test("dictation exposes the AI curtain when compute is active", () => {
  const facts = buildFacts({
    aiBusy: true,
    aiComputing: true,
    busyMessage: "Computing selectors",
    busyNote: "Preparing page content for AI...",
    busyTimerText: "Up to 8:00",
  });
  const dictation = deriveDictation(decideSessionPhase(facts), facts);

  assert.equal(dictation.phase, SESSION_PHASES.COMPUTING_AI);
  assert.equal(dictation.buttons[BUTTON_IDS.COMPUTE].loading, true);
  assert.equal(dictation.curtain.visible, true);
  assert.equal(dictation.curtain.operation, "computing_ai");
  assert.equal(dictation.curtain.message, "Computing selectors");
  assert.equal(dictation.curtain.timerText, "Up to 8:00");
});
