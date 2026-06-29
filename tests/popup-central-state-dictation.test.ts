import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import { vi } from "vitest";
import { deriveDictation } from "../src/background/brain/deciders/dictation-decider.js";
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

test("central-state dictation helper maps projected brain state into popup authority fields", () => {
  const facts = buildFacts({
    sessionHasPendingChanges: true,
    currentDraftDirty: true,
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    aiRunUpToDate: true,
    hasStoredSelectors: true
  });
  const dictation = deriveDictation(decideSessionPhase(facts), facts);
  const patch = buildCentralSessionDictationViewStatePatch({
    featureEnabled: true,
    currentTabId: 12,
    projectedTabId: 12,
    sessionPhase: dictation.phase,
    sessionDictation: dictation
  });

  assert.ok(patch);
  assert.equal(patch.mainUiHidden, dictation.mainUiHidden);
  assert.equal(patch.toggleEnabledDisabled, !dictation.buttons["toggle-enabled"].enabled);
  assert.equal(patch.computeButtonDisabled, !dictation.buttons.compute.enabled);
  assert.equal(patch.computeButtonLoading, dictation.buttons.compute.loading);
  assert.equal(patch.markingPreviewVisible, dictation.buttons["marking-preview"].visible);
  assert.equal(patch.pageSaveDisabled, !dictation.buttons["page-save"].enabled);
  assert.equal(patch.sessionCurtainVisible, dictation.curtain.visible);
  assert.equal(patch.sessionCurtainPhase, dictation.phase);
});

test("central-state snapshot effect repaints on same-tab dictation updates and refreshes when dictation is removed", () => {
  const computingFacts = buildFacts({
    aiBusy: true,
    aiComputing: true,
    busyVisible: true,
    busyMessage: "Computing selectors",
    busyNote: "Preparing page content for AI...",
    busyTimerText: "Up to 8:00"
  });
  const computingDictation = deriveDictation(decideSessionPhase(computingFacts), computingFacts);
  const repaintEffect = deriveCentralSessionDictationSnapshotEffect({
    featureEnabled: true,
    currentTabId: 7,
    projectedTabId: 7,
    sessionPhase: computingDictation.phase,
    sessionDictation: computingDictation,
    hadProjectedSessionDictation: false
  });

  assert.ok(repaintEffect.patch);
  assert.equal(repaintEffect.patch.sessionCurtainVisible, true);
  assert.equal(repaintEffect.patch.computeButtonLoading, true);
  assert.equal(repaintEffect.refreshRequired, false);

  const clearEffect = deriveCentralSessionDictationSnapshotEffect({
    featureEnabled: true,
    currentTabId: 7,
    projectedTabId: 7,
    sessionPhase: null,
    sessionDictation: null,
    hadProjectedSessionDictation: true
  });

  assert.equal(clearEffect.patch, null);
  assert.equal(clearEffect.refreshRequired, true);
});

test("central-state dictation suppresses stale busy curtain when projected phase is silent", () => {
  const computingFacts = buildFacts({
    aiBusy: true,
    aiComputing: true,
    busyVisible: true,
    busyMessage: "Refreshing popup data...",
    busyNote: "Working... controls are temporarily blocked.",
    busyTimerText: ""
  });
  const computingDictation = deriveDictation(decideSessionPhase(computingFacts), computingFacts);

  const patch = buildCentralSessionDictationViewStatePatch({
    featureEnabled: true,
    currentTabId: 7,
    projectedTabId: 7,
    sessionPhase: "silent",
    sessionDictation: computingDictation
  });

  assert.ok(patch);
  assert.equal(patch.sessionCurtainVisible, false);
  assert.equal(patch.sessionCurtainMessage, "");
  assert.equal(patch.sessionCurtainOperation, "");
  assert.equal(patch.sessionCurtainPhase, "silent");
});

test("popup curtain rendering prioritizes session dictation when present", () => {
  assert.match(uiSource, /sessionCurtainVisible: false,/);
  assert.match(uiSource, /sessionCurtainMessage: "",/);
  assert.match(uiSource, /function getBlockingUiCurtainState\(view: ViewState\): BlockingUiCurtainState \{\s*if \(view\.sessionCurtainVisible\)/);
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
  assert.match(popupSource, /function shouldUseLocalComputingAiLockout\(tabId: number \| null\): boolean \{/);
  assert.match(popupSource, /function shouldUseLocalPreviewRevealFallback\(tabId: number \| null\): boolean \{/);
  assert.match(popupSource, /function shouldUseLocalPreviewRestoreLockout\(tabId: number \| null\): boolean \{/);
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
    /function updateAiRunCountdownState\(\) \{[\s\S]*?const useLocalComputingAiLockout = shouldUseLocalComputingAiLockout\(currentTabId\);[\s\S]*?\.\.\.\(useLocalComputingAiLockout[\s\S]*?computeButtonLoading: true,[\s\S]*?computeButtonDisabled: true,[\s\S]*?aiControlsBusy: true/
  );
  assert.match(
    popupSource,
    /function beginPreviewRestorePending\(\) \{[\s\S]*?const useLocalPreviewRestoreLockout = shouldUseLocalPreviewRestoreLockout\(currentTabId\);[\s\S]*?\.\.\.\(useLocalPreviewRestoreLockout[\s\S]*?toggleEnabledDisabled: true,[\s\S]*?computeButtonDisabled: true,[\s\S]*?markingPreviewDisabled: true,[\s\S]*?pageSaveDisabled: true,[\s\S]*?pageRevertDisabled: true/
  );
  assert.match(
    popupSource,
    /previewBlockedMessage: PopupText\.preview\.blockedActive,[\s\S]*?\.\.\.\(shouldUseLocalPreviewRevealFallback\(getCurrentPopupTabId\(\)\)[\s\S]*?computeButtonLoading: false,[\s\S]*?aiControlsBusy: false,[\s\S]*?sessionCurtainVisible: false/
  );
  assert.match(
    popupSource,
    /const useLocalSessionAuthorityFallback = shouldUseLocalSessionAuthorityFallback\(currentTabId\);[\s\S]*?if \(useLocalSessionAuthorityFallback\) \{[\s\S]*?nextViewState\.toggleEnabledDisabled = toggleEnabledDisabled;[\s\S]*?nextViewState\.mainUiHidden = mainUiHidden;[\s\S]*?nextViewState\.computeButtonDisabled = computeButtonDisabled;/
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
    /if \([\s\S]*?nextCentralSessionDictationEffect\.patch[\s\S]*?nextProjectedPropertyLockEffect\.patch[\s\S]*?nextProjectedSecondaryGatesEffect\.patch[\s\S]*?\) \{[\s\S]*?uiModule\.setViewState\(\{[\s\S]*?\}\);[\s\S]*?\}[\s\S]*?if \([\s\S]*?nextCentralSessionDictationEffect\.refreshRequired[\s\S]*?nextProjectedPropertyLockEffect\.refreshRequired[\s\S]*?nextProjectedSecondaryGatesEffect\.refreshRequired[\s\S]*?\) \{[\s\S]*?void refreshUi\(/
  );
});
