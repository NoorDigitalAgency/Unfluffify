import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import { vi } from "vitest";
import { decideSessionPhase } from "../src/background/brain/deciders/session-phase-decider.js";
import {
  buildCentralSessionDictationViewStatePatch,
  deriveCentralSessionDictationSnapshotEffect
} from "../src/popup/central-state-dictation.js";
import { getViewState, resolveBlockingUiCurtainState } from "../src/popup/ui.tsx";
import { AI_RUN_PHASES } from "../src/common/bus/contracts/session-state.js";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../src/popup/ui.tsx", import.meta.url), "utf8");

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

test("central-state dictation reduces to the phase pointer (P4 4.2)", () => {
  const facts = buildFacts({
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    aiRunUpToDate: true,
    hasStoredSelectors: true
  });
  const phase = decideSessionPhase(facts);
  const patch = buildCentralSessionDictationViewStatePatch({
    currentTabId: 12,
    projectedTabId: 12,
    sessionPhase: phase,
    sessionDictation: { phase }
  });

  assert.ok(patch);
  // The projected patch carries ONLY the phase: buttons/mode/curtain/preview
  // content are the machine's surface memory applied on top
  // (overrideDictatedMarkingButtons / overrideDictatedPreviewVisibility).
  assert.equal(patch, { sessionCurtainPhase: phase });
});

test("the projected sessionPhase leads the dictation phase", () => {
  const patch = buildCentralSessionDictationViewStatePatch({
    currentTabId: 7,
    projectedTabId: 7,
    sessionPhase: "silent",
    sessionDictation: { phase: "ready_to_save" }
  });

  assert.ok(patch);
  assert.equal(patch.sessionCurtainPhase, "silent");
});

test("central-state snapshot effect repaints on same-tab dictation updates and neutralizes when dictation is removed", () => {
  const repaintEffect = deriveCentralSessionDictationSnapshotEffect({
    currentTabId: 7,
    projectedTabId: 7,
    sessionPhase: "computing_ai",
    sessionDictation: { phase: "computing_ai" },
    hadProjectedSessionDictation: false
  });

  assert.ok(repaintEffect.patch);
  assert.equal(repaintEffect.patch.sessionCurtainPhase, "computing_ai");
  assert.equal(repaintEffect.refreshRequired, false);

  const clearEffect = deriveCentralSessionDictationSnapshotEffect({
    currentTabId: 7,
    projectedTabId: 7,
    sessionPhase: null,
    sessionDictation: null,
    hadProjectedSessionDictation: true
  });

  assert.ok(clearEffect.patch);
  assert.equal(clearEffect.patch.mainUiHidden, true);
  assert.equal(clearEffect.patch.computeButtonDisabled, true);
  assert.equal(clearEffect.patch.previewActive, false);
  assert.equal(clearEffect.patch.previewBlocked, false);
  assert.equal(clearEffect.refreshRequired, false);
});

test("popup curtain rendering prioritizes session dictation when present", () => {
  assert.match(uiSource, /sessionCurtainVisible: false,/);
  assert.match(uiSource, /sessionCurtainMessage: "",/);
  // Session dictation still leads the curtain priority order — behind the
  // render-mode DETECTION-view suppression (no initial spinner belongs over
  // the manual detection posture; architect, 2026-07-03).
  assert.match(uiSource, /function getBlockingUiCurtainState\(view: ViewState\): BlockingUiCurtainState \{[\s\S]{0,800}const suppressPrepCurtains = Boolean\(view\.renderModeDetectionViewActive\);\s*if \(view\.sessionCurtainVisible && !suppressPrepCurtains\)/);
  assert.match(uiSource, /message: view\.sessionCurtainMessage \|\| PopupText\.overlay\.pleaseWait/);
  assert.match(uiSource, /const liveSessionCurtainTimerText =[\s\S]*?view\.busyTimerMode === SPINNER_TIMER_MODES\.COUNTDOWN[\s\S]*?formatCountdownFromDeadline\([\s\S]*?view\.busyDeadlineAt[\s\S]*?view\.aiRunDeadlineAt/);
  assert.match(uiSource, /timerText: liveSessionCurtainTimerText \|\| view\.sessionCurtainTimerText \|\| ""/);
});

test("session dictation curtain formats projected countdowns from live deadlines", ({ after }) => {
  const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
  after(() => nowSpy.mockRestore());
  const baseView = getViewState();

  const projectedCountdownCurtain = resolveBlockingUiCurtainState({
    ...baseView,
    sessionCurtainVisible: true,
    sessionCurtainPhase: "computing_ai",
    sessionCurtainOperation: "computing_ai",
    sessionCurtainTimerText: "Up to 8:00",
    busyTimerMode: "countdown",
    busyDeadlineAt: 341_000,
    aiRunDeadlineAt: 0
  });
  assert.equal(projectedCountdownCurtain.timerText, "4:01");

  const fallbackCountdownCurtain = resolveBlockingUiCurtainState({
    ...baseView,
    sessionCurtainVisible: true,
    sessionCurtainPhase: "computing_ai",
    sessionCurtainOperation: "computing_ai",
    sessionCurtainTimerText: "Up to 8:00",
    busyTimerMode: "",
    busyDeadlineAt: 0,
    aiRunDeadlineAt: 341_000
  });
  assert.equal(fallbackCountdownCurtain.timerText, "4:01");
});

test("popup wiring repaints live brain snapshots and keeps imperative writers behind the local fallback guard", () => {
  assert.match(popupSource, /deriveCentralSessionDictationSnapshotEffect\(/);
  assert.match(popupSource, /buildCentralSessionDictationViewStatePatch\(/);
  assert.match(popupSource, /async function getCurrentSessionActionGateState\(sourceConfig: Config \| null \| undefined = state\.currentConfig\) \{/);
  assert.match(popupSource, /function clearProjectedComputingAiState\(\): boolean \{/);
  assert.match(popupSource, /async function clearStaleProjectedComputingAiState\(\): Promise<void> \{/);
  assert.match(popupSource, /publishCurrentTabSessionFacts\(\{\s*aiBusy: true,[\s\S]*?aiComputing: true,[\s\S]*?busyVisible: true,/);
  assert.match(popupSource, /publishCurrentTabSessionFacts\(\{[\s\S]*?previewActive: true,[\s\S]*?previewBlocked: true,/);
  assert.match(popupSource, /publishCurrentTabSessionFacts\(\{[\s\S]*?previewRestorePending: true/);
  assert.match(popupSource, /async function stopAiRun\(options: StopAiRunOptions = \{\}\) \{[\s\S]*?clearProjectedComputingAiState\(\);/);
  assert.match(popupSource, /const persistedRun = await loadPersistedAiRunRecord\(\);[\s\S]*?if \(!persistedRun\) \{[\s\S]*?await clearStaleProjectedComputingAiState\(\);/);
  assert.match(
    popupSource,
    /uiModule\.setViewState\(\{[\s\S]*?previewWillRestoreMarking:[\s\S]*?previewItems:[\s\S]*?previewFocusedXpath:[\s\S]*?previewShowAllCategories:[\s\S]*?\}\);/
  );
  assert.match(
    popupSource,
    /state\.currentConfig = await config\.ensureConfig\(state\.currentBaseUrl\);[\s\S]*?const \{ aiRunUpToDate, sessionRequiresAiRun \} = await getCurrentSessionActionGateState\(state\.currentConfig\);[\s\S]*?if \(aiRunUpToDate && !sessionRequiresAiRun\) \{\s*return;\s*\}/
  );
  assert.match(
    popupSource,
    /await refreshCurrentPageRuntimeStatus\(\);[\s\S]*?const view = uiModule\.getViewState\(\);[\s\S]*?if \(view\.previewLatestBlockedReason === SECONDARY_GATES_BLOCK_REASONS\.SERVER_SYNC_PENDING\) \{[\s\S]*?if \(view\.previewLatestBlockedReason !== SECONDARY_GATES_BLOCK_REASONS\.NONE\) \{\s*return;\s*\}/
  );
  assert.match(
    popupSource,
    /if \([\s\S]*?nextCentralSessionDictationEffect\.patch[\s\S]*?nextProjectedPropertyLockEffect\.patch[\s\S]*?nextProjectedSecondaryGatesEffect\.patch[\s\S]*?\) \{[\s\S]*?uiModule\.setViewState\(snapshotPatch\);[\s\S]*?\}[\s\S]*?if \([\s\S]*?nextCentralSessionDictationEffect\.refreshRequired[\s\S]*?nextProjectedPropertyLockEffect\.refreshRequired[\s\S]*?nextProjectedSecondaryGatesEffect\.refreshRequired[\s\S]*?\) \{[\s\S]*?void refreshUi\(/
  );
});

function extractRefreshUiInnerBlock() {
  const start = popupSource.indexOf("async function refreshUiInner(");
  assert.ok(start >= 0, "Missing refreshUiInner");
  const end = popupSource.indexOf("async function maybeResumePersistedAiRun", start);
  assert.ok(end > start, "Missing refreshUiInner end boundary");
  return popupSource.slice(start, end);
}

test("refreshUiInner reflects session dictation as the final synchronous write so a late-completing refresh cannot restore a cleared curtain", () => {
  const refreshBlock = extractRefreshUiInnerBlock();
  // Regression guard for the stuck render-mode curtain: refreshUiInner has
  // multiple awaits, so a run that read the dictation while the curtain was
  // visible can finish AFTER the brain cleared it. The dictation reflection must
  // therefore be the LAST mutation before the synchronous setViewState - never
  // computed early - so an overlapping/late refresh always writes the current
  // dictation instead of a stale visible curtain over an already-cleared one.
  assert.match(
    refreshBlock,
    /applyCentralSessionDictation\(nextViewState, currentTabId\);\s*uiModule\.setViewState\(nextViewState\);/
  );

  // There must be no await between the dictation reflection and the write, or
  // the dictation could change again in that gap and reintroduce the race.
  const reflectIdx = refreshBlock.lastIndexOf(
    "applyCentralSessionDictation(nextViewState, currentTabId);"
  );
  const writeIdx = refreshBlock.indexOf(
    "uiModule.setViewState(nextViewState);",
    reflectIdx
  );
  assert.ok(reflectIdx > -1 && writeIdx > reflectIdx);
  assert.doesNotMatch(refreshBlock.slice(reflectIdx, writeIdx), /\bawait\b/);
});
