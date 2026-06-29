import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { deriveDictation } from "../src/background/brain/deciders/dictation-decider.js";
import { decideSessionPhase } from "../src/background/brain/deciders/session-phase-decider.js";
import { AI_RUN_PHASES } from "../src/common/bus/contracts/session-state.js";

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

function buildLegacyParityState(facts) {
  const mainUiHidden =
    facts.pageScopedUiDisabled ||
    !facts.isEnabled ||
    (!facts.navigationInspectionPending && (!facts.siteIdReady || !facts.renderModeReady));
  const pageControlsVisible = !mainUiHidden && facts.renderModeReady;
  return {
    mainUiHidden,
    toggleVisible: facts.renderModeReady,
    toggleEnabled: !(
      facts.pageScopedUiDisabled ||
      facts.previewRestorePending ||
      facts.pageSaveReconciliationPending ||
      !facts.baseUrlReady ||
      (!facts.navigationInspectionPending && (!facts.siteIdReady || !facts.renderModeReady || facts.pageTypeUiBlocked)) ||
      facts.desktopPreviewActive
    ),
    actionMatrixEnabled: facts.aiRunPhase === AI_RUN_PHASES.POST_AI && !(
      facts.pageScopedUiDisabled ||
      facts.aiBusy ||
      facts.previewRestorePending ||
      facts.pageSaveReconciliationPending ||
      facts.saving ||
      facts.discarding
    ),
    computeVisible: !mainUiHidden,
    computeEnabled:
      !mainUiHidden &&
      !(
        facts.pageScopedUiDisabled ||
        facts.aiBusy ||
        facts.previewRestorePending ||
        facts.pageSaveReconciliationPending ||
        facts.saving ||
        facts.discarding ||
        facts.aiRunPhase === AI_RUN_PHASES.POST_AI
      ),
    previewVisible: pageControlsVisible && facts.isEnabled,
    previewEnabled: facts.aiRunPhase === AI_RUN_PHASES.POST_AI && !(
      facts.pageScopedUiDisabled ||
      facts.aiBusy ||
      facts.previewRestorePending ||
      facts.pageSaveReconciliationPending ||
      facts.saving ||
      facts.discarding
    ),
    saveVisible: pageControlsVisible,
    saveEnabled: facts.aiRunPhase === AI_RUN_PHASES.POST_AI && !(
      facts.pageScopedUiDisabled ||
      facts.aiBusy ||
      facts.previewRestorePending ||
      facts.pageSaveReconciliationPending ||
      facts.saving ||
      facts.discarding
    ),
    revertVisible: pageControlsVisible,
    revertEnabled: facts.aiRunPhase === AI_RUN_PHASES.POST_AI && !(
      facts.pageScopedUiDisabled ||
      facts.aiBusy ||
      facts.previewRestorePending ||
      facts.pageSaveReconciliationPending ||
      facts.saving ||
      facts.discarding
    ),
  };
}

for (const [label, facts] of [
  ["fresh-marking", buildFacts()],
  ["stale-dirty-marking", buildFacts({ sessionHasPendingChanges: true, sessionRequiresAiRun: true, currentDraftDirty: true })],
  ["ready-to-save", buildFacts({ sessionHasPendingChanges: true, currentDraftDirty: true, aiRunPhase: AI_RUN_PHASES.POST_AI, aiRunUpToDate: true })],
  ["preview-restoring", buildFacts({ previewRestorePending: true, sessionHasPendingChanges: true, currentDraftDirty: true, aiRunPhase: AI_RUN_PHASES.POST_AI, aiRunUpToDate: true })],
  ["out-of-scope-loading", buildFacts({ baseUrlReady: false, renderModeReady: false, siteIdReady: false, isEnabled: false })],
]) {
  test(`brain dictation stays in parity with legacy popup gating for ${label}`, () => {
    const dictation = deriveDictation(decideSessionPhase(facts), facts);
    const legacy = buildLegacyParityState(facts);

    assert.equal(dictation.mainUiHidden, legacy.mainUiHidden);
    assert.equal(dictation.buttons["toggle-enabled"].visible, legacy.toggleVisible);
    assert.equal(dictation.buttons["toggle-enabled"].enabled, legacy.toggleEnabled);
    assert.equal(dictation.buttons.compute.visible, legacy.computeVisible);
    assert.equal(dictation.buttons.compute.enabled, legacy.computeEnabled);
    assert.equal(dictation.buttons["marking-preview"].visible, legacy.previewVisible);
    assert.equal(dictation.buttons["marking-preview"].enabled, legacy.previewEnabled);
    assert.equal(dictation.buttons["page-save"].visible, legacy.saveVisible);
    assert.equal(dictation.buttons["page-save"].enabled, legacy.saveEnabled);
    assert.equal(dictation.buttons["page-revert"].visible, legacy.revertVisible);
    assert.equal(dictation.buttons["page-revert"].enabled, legacy.revertEnabled);
  });
}
