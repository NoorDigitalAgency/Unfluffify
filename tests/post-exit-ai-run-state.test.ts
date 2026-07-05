import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import { createBrain } from "../src/background/brain/index.js";
import { REALMS } from "../src/common/bus/realms.js";
import { buildBusPortName } from "../src/common/bus/transport/transport-types.js";
import {
  SESSION_PHASES,
  SESSION_REPORT_TYPES,
} from "../src/common/bus/contracts/session-state.js";
import { AI_RUN_EVENT_TYPES } from "../src/common/bus/contracts/ai-run.js";
import { SECONDARY_GATES_BLOCK_REASONS } from "../src/common/bus/contracts/secondary-gates-state.js";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

function createFakePopupPort(tabId: number) {
  const onMessage = { addListener() {}, removeListener() {} };
  const onDisconnect = { addListener() {}, removeListener() {} };
  const port = {
    name: buildBusPortName(tabId),
    onMessage,
    onDisconnect,
    postMessage() {},
    disconnect() {},
  };
  return port as unknown as chrome.runtime.Port;
}

const flush = () => new Promise((resolve) => queueMicrotask(resolve));

const READY_FACTS = {
  baseUrlReady: true,
  siteIdReady: true,
  renderModeReady: true,
  isEnabled: true,
  silentModeActive: false,
  aiReady: true,
};

async function reportPopup(brain: ReturnType<typeof createBrain>, tabId: number, facts: Record<string, unknown>) {
  await brain.bus.publish(
    SESSION_REPORT_TYPES.FACTS_REPORTED,
    { source: "popup", facts },
    { target: REALMS.BACKGROUND, tab: tabId },
  );
  await flush();
}

async function reportContent(brain: ReturnType<typeof createBrain>, tabId: number, facts: Record<string, unknown>) {
  await brain.bus.publish(
    SESSION_REPORT_TYPES.FACTS_REPORTED,
    { source: "content", facts },
    { target: REALMS.BACKGROUND, tab: tabId },
  );
  await flush();
}

async function publishAiRunEvent(
  brain: ReturnType<typeof createBrain>,
  tabId: number,
  eventType: string,
  payload: Record<string, unknown> = {},
) {
  await brain.bus.publish(eventType, payload, { target: REALMS.BACKGROUND, tab: tabId });
  await flush();
}

// #5/#14 LAYER 2 (Save stuck on requires_ai_run): the popup session must reach
// POST_AI when an AI run completes. The brain-authority refactor removed
// markSessionAiRunPostAi(), leaving setSessionAiRunPhase only ever called with
// PRE_AI, so every popup report carried aiRunPhase:pre_ai; a post-exit report
// shaped like a clean reset handed AI-run authority back and wedged the brain
// at PRE_AI (pageSaveBlockedReason stuck "requires_ai_run").
test("popup marks the session POST_AI when the AI-run markings fingerprint is captured", () => {
  assert.match(
    popupSource,
    /function captureAiRunMarkingsFingerprint\(\) \{[\s\S]*?setSessionAiRunPhase\(AI_RUN_PHASES\.POST_AI\);[\s\S]*?\}/,
  );
  assert.match(
    popupSource,
    /function resetAiRunMarkingsFingerprint\(\) \{[\s\S]*?setSessionAiRunPhase\(AI_RUN_PHASES\.PRE_AI\);[\s\S]*?\}/,
  );
});

// The POST_AI leg of shouldReportManualAiPreviewEvent is what makes the popup
// emit the EXITED ai-run event on preview exit even when the brain projection
// is degraded (the restore flag alone missed the content auto-exit race).
test("preview exit emits EXITED via the restore flag or the manual post-AI report", () => {
  assert.match(
    popupSource,
    /if \(shouldRestoreMarking \|\| shouldReportManualAiPreviewEvent\(\)\) \{\s*publishCurrentTabAiRunEvent\(AI_RUN_EVENT_TYPES\.EXITED\);/,
  );
  assert.match(
    popupSource,
    /function shouldReportManualAiPreviewEvent\(\): boolean \{[\s\S]*?state\.sessionAiRunPhase === AI_RUN_PHASES\.POST_AI[\s\S]*?\}/,
  );
});

// #5 LAYER 1 (marking "temporarily unavailable" flap): every content preview
// teardown must republish the preview session facts. The brain heartbeat
// re-serves the content STATE_GET sticky snapshot every second, so a silent
// resetAiPreviewState (force-disable / out-of-scope configUpdated) left a
// sticky previewActive:true that re-folded forever against the popup's false,
// flapping the brain-projected markingEditsBlocked directive on the page.
test("content clearAiPreviewState republishes preview session facts after the reset", () => {
  assert.match(
    contentSource,
    /function clearAiPreviewState\(\) \{[\s\S]*?resetAiPreviewState\(\);[\s\S]*?publishAiPreviewSessionFacts\(\);[\s\S]*?return true;\s*\}/,
  );
});

test("brain settles to READY_TO_SAVE with Save unblocked after a run + preview exit", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const tabId = 501;
  brain.registerPopupPort(tabId, createFakePopupPort(tabId));

  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    sessionHasPendingChanges: true,
    currentDraftDirty: true,
  });

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.STARTED);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.COMPUTING_AI);

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.PREVIEW_READY);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.PREVIEW_OPEN);

  // Exit: the fixed popup reports POST_AI (never a spurious pre_ai clean reset)
  // and emits EXITED; content republishes the closed preview facts.
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.EXITED);
  await reportContent(brain, tabId, {
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
  });
  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    aiRunPhase: "post_ai",
    sessionHasPendingChanges: true,
    currentPageHasPendingChanges: false,
    currentDraftDirty: false,
    previewActive: false,
    previewBlocked: false,
    previewRestorePending: false,
  });

  const view = brain.getPopupView(tabId);
  assert.equal(view.sessionPhase, SESSION_PHASES.READY_TO_SAVE);
  assert.equal(
    view.secondaryGates?.pageSaveBlockedReason,
    SECONDARY_GATES_BLOCK_REASONS.NONE,
  );

  // Heartbeat-style re-folds of the same settled reports must stay inert: no
  // phase flap, Save stays reachable.
  await reportContent(brain, tabId, { previewActive: false, previewBlocked: false });
  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    aiRunPhase: "post_ai",
    sessionHasPendingChanges: true,
    currentPageHasPendingChanges: false,
    currentDraftDirty: false,
    previewActive: false,
    previewBlocked: false,
  });
  const settledView = brain.getPopupView(tabId);
  assert.equal(settledView.sessionPhase, SESSION_PHASES.READY_TO_SAVE);
  assert.equal(
    settledView.secondaryGates?.pageSaveBlockedReason,
    SECONDARY_GATES_BLOCK_REASONS.NONE,
  );

  brain.heartbeat.stop(tabId);
});

// Post-discard settle (debug round PART 4): applyLocalPageDiscard publishes a
// full clean-reset patch at the new marking-session epoch. The brain hands
// AI-run authority back only when the REPORTED PATCH ITSELF carries pre_ai +
// clean pending/draft + previewActive:false + previewBlocked:false
// (shouldKeepBrainAiRunAuthority reads the patch, not merged facts), and
// aiRunUpToDate:false must ride along or the sticky true from the finished
// run keeps the decider at SAVED. This drives the REAL brain through the
// discard-from-POST_AI arc the user actually performs.
test("the discard settle from POST_AI lands MARKING_FRESH and closes the run-scoped gates", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const tabId = 503;
  brain.registerPopupPort(tabId, createFakePopupPort(tabId));

  // A full run: dirty session -> run -> preview -> exit -> READY_TO_SAVE, the
  // state the Discard button resolves (criterion-4).
  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    sessionHasPendingChanges: true,
    currentDraftDirty: true,
  });
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.STARTED);
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.PREVIEW_READY);
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.EXITED);
  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    aiRunPhase: "post_ai",
    aiRunUpToDate: true,
    sessionHasPendingChanges: true,
    currentPageHasPendingChanges: false,
    currentDraftDirty: false,
    previewActive: false,
    previewBlocked: false,
  });
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.READY_TO_SAVE);

  // The exact settle patch applyLocalPageDiscard publishes (no seq).
  await reportPopup(brain, tabId, {
    isEnabled: true,
    silentModeActive: false,
    aiRunPhase: "pre_ai",
    aiRunUpToDate: false,
    previewActive: false,
    previewBlocked: false,
    currentDraftDirty: false,
    discarding: false,
    sessionHasPendingChanges: false,
  });

  const view = brain.getPopupView(tabId);
  assert.equal(view.sessionPhase, SESSION_PHASES.MARKING_FRESH);
  // Preview Contents must not stay gated open against the discarded run.
  assert.equal(
    view.secondaryGates?.markingPreviewBlockedReason,
    SECONDARY_GATES_BLOCK_REASONS.REQUIRES_AI_RUN,
  );

  // Heartbeat-style re-fold of the merged sticky snapshot stays MARKING_FRESH.
  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    aiRunPhase: "pre_ai",
    aiRunUpToDate: false,
    sessionHasPendingChanges: false,
    currentPageHasPendingChanges: false,
    currentDraftDirty: false,
    previewActive: false,
    previewBlocked: false,
  });
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.MARKING_FRESH);

  // The post-discard session behaves like a fresh one: a new user mark goes
  // MARKING_DIRTY (requires a new run), never back to READY_TO_SAVE.
  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    aiRunPhase: "pre_ai",
    sessionHasPendingChanges: true,
    currentPageHasPendingChanges: true,
    currentDraftDirty: true,
    previewActive: false,
    previewBlocked: false,
  });
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.MARKING_DIRTY);

  brain.heartbeat.stop(tabId);
});

// Control pinning WHY the settle carries previewActive/previewBlocked: without
// them the patch is not a clean reset, the brain keeps AI-run authority, strips
// the reported pre_ai, and re-derives POST_AI from its own run state — phase
// SAVED with the marking-preview gate open against the just-discarded run. If
// shouldKeepBrainAiRunAuthority is ever deliberately relaxed, update this and
// the settle comment in applyLocalPageDiscard together.
test("a discard settle missing the preview fields does not hand AI-run authority back", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const tabId = 504;
  brain.registerPopupPort(tabId, createFakePopupPort(tabId));

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.STARTED);
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.EXITED);
  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    aiRunPhase: "post_ai",
    sessionHasPendingChanges: true,
    currentPageHasPendingChanges: false,
    currentDraftDirty: false,
    previewActive: false,
    previewBlocked: false,
  });

  await reportPopup(brain, tabId, {
    isEnabled: true,
    silentModeActive: false,
    aiRunPhase: "pre_ai",
    currentDraftDirty: false,
    discarding: false,
    sessionHasPendingChanges: false,
  });

  const view = brain.getPopupView(tabId);
  assert.equal(view.sessionPhase, SESSION_PHASES.SAVED);
  assert.equal(
    view.secondaryGates?.markingPreviewBlockedReason,
    SECONDARY_GATES_BLOCK_REASONS.NONE,
  );

  brain.heartbeat.stop(tabId);
});

test("a popup POST_AI report cannot hand AI-run authority back as a clean reset", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const tabId = 502;
  brain.registerPopupPort(tabId, createFakePopupPort(tabId));

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.STARTED);
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.PREVIEW_READY);
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.EXITED);

  // A transient post-exit report where the draft probes have not landed yet
  // (no pending changes visible) previously qualified as a clean reset when the
  // popup still said pre_ai, folding PRE_AI into the brain permanently. With
  // the popup reporting post_ai the brain must keep its POST_AI run state.
  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    aiRunPhase: "post_ai",
    sessionHasPendingChanges: false,
    currentDraftDirty: false,
    previewActive: false,
    previewBlocked: false,
  });

  await reportPopup(brain, tabId, {
    ...READY_FACTS,
    aiRunPhase: "post_ai",
    sessionHasPendingChanges: true,
    currentPageHasPendingChanges: false,
    currentDraftDirty: false,
    previewActive: false,
    previewBlocked: false,
  });

  const view = brain.getPopupView(tabId);
  assert.equal(view.sessionPhase, SESSION_PHASES.READY_TO_SAVE);
  assert.equal(
    view.secondaryGates?.pageSaveBlockedReason,
    SECONDARY_GATES_BLOCK_REASONS.NONE,
  );

  brain.heartbeat.stop(tabId);
});
