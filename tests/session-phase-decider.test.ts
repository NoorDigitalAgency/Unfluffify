import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { decideSessionPhase, applySessionFactsPatch, createDefaultSessionFacts } from "../src/background/brain/deciders/session-phase-decider.js";
import { AI_RUN_PHASES, SESSION_PHASES } from "../src/common/bus/contracts/session-state.js";

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
    previewItemsPending: false,
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

test("session-phase decider picks the expected named phase across the current popup states", () => {
  assert.equal(decideSessionPhase(buildFacts({ propertyLockBlocked: true })), SESSION_PHASES.PROPERTY_LOCK_BLOCKED);
  assert.equal(decideSessionPhase(buildFacts({ baseUrlReady: false })), SESSION_PHASES.OUT_OF_SCOPE);
  assert.equal(decideSessionPhase(buildFacts({ discarding: true })), SESSION_PHASES.DISCARDING);
  assert.equal(decideSessionPhase(buildFacts({ saving: true })), SESSION_PHASES.SAVING);
  assert.equal(decideSessionPhase(buildFacts({ aiComputing: true })), SESSION_PHASES.COMPUTING_AI);
  assert.equal(decideSessionPhase(buildFacts({ previewActive: true })), SESSION_PHASES.PREVIEW_OPEN);
  assert.equal(decideSessionPhase(buildFacts({ previewRestorePending: true })), SESSION_PHASES.PREVIEW_RESTORING);
  assert.equal(decideSessionPhase(buildFacts({ pageSaveReconciliationPending: true })), SESSION_PHASES.RECONCILIATION_PENDING);
  assert.equal(decideSessionPhase(buildFacts({ navigationInspectionPending: true })), SESSION_PHASES.RENDER_MODE_INSPECTION);
  assert.equal(decideSessionPhase(buildFacts({ siteIdReady: false })), SESSION_PHASES.LOADING);
  assert.equal(decideSessionPhase(buildFacts({ isEnabled: false, silentModeActive: true })), SESSION_PHASES.SILENT);
  assert.equal(decideSessionPhase(buildFacts({ sessionHasPendingChanges: true, sessionRequiresAiRun: true })), SESSION_PHASES.MARKING_DIRTY);
  assert.equal(decideSessionPhase(buildFacts({ sessionHasPendingChanges: true, currentDraftDirty: true, aiRunPhase: AI_RUN_PHASES.POST_AI })), SESSION_PHASES.READY_TO_SAVE);
  assert.equal(decideSessionPhase(buildFacts({ aiRunPhase: AI_RUN_PHASES.POST_AI })), SESSION_PHASES.SAVED);
  assert.equal(decideSessionPhase(buildFacts()), SESSION_PHASES.MARKING_FRESH);
});

test("brain composes AI_PREVIEW from reported POST_AI + preview-open and exits to POST_AI", () => {
  const base = createDefaultSessionFacts();
  // Popup reports run completion (POST_AI) and preview-open; brain composes AI_PREVIEW.
  const open = applySessionFactsPatch(base, {
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    previewActive: true,
  });
  assert.equal(open.facts.aiRunPhase, AI_RUN_PHASES.AI_PREVIEW);
  // Exit preview: previewActive clears -> brain drops back to POST_AI.
  const exited = applySessionFactsPatch(open.facts, { previewActive: false });
  assert.equal(exited.facts.aiRunPhase, AI_RUN_PHASES.POST_AI);
  // Discard/save report PRE_AI -> stays PRE_AI regardless of preview facts.
  const pre = applySessionFactsPatch(exited.facts, { aiRunPhase: AI_RUN_PHASES.PRE_AI });
  assert.equal(pre.facts.aiRunPhase, AI_RUN_PHASES.PRE_AI);
});

test("session-phase decider keeps high-priority transient phases ahead of steady-state marking phases", () => {
  const facts = buildFacts({
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: true,
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    aiRunUpToDate: true,
    aiComputing: true,
    previewRestorePending: true,
  });

  assert.equal(decideSessionPhase(facts), SESSION_PHASES.COMPUTING_AI);
});
