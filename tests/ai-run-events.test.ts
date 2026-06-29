import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createBrain } from "../src/background/brain/index.js";
import { AI_RUN_EVENT_TYPES } from "../src/common/bus/contracts/ai-run.js";
import { REALMS } from "../src/common/bus/realms.js";
import {
  AI_RUN_PHASES,
  SESSION_PHASES,
  SESSION_REPORT_TYPES
} from "../src/common/bus/contracts/session-state.js";

async function reportReadyMarkingFacts(brain: ReturnType<typeof createBrain>, tabId: number) {
  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      baseUrlReady: true,
      siteIdReady: true,
      renderModeReady: true,
      isEnabled: true,
      aiReady: true,
      sessionHasPendingChanges: true,
      currentPageHasPendingChanges: true,
      currentDraftDirty: true,
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: tabId,
  });
  await new Promise((resolve) => queueMicrotask(resolve));
}

async function publishAiRunEvent(
  brain: ReturnType<typeof createBrain>,
  tabId: number,
  type: (typeof AI_RUN_EVENT_TYPES)[keyof typeof AI_RUN_EVENT_TYPES],
  payload: Record<string, unknown> = {}
) {
  await brain.bus.publish(type, payload, {
    target: REALMS.BACKGROUND,
    tab: tabId,
  });
  await new Promise((resolve) => queueMicrotask(resolve));
}

test("brain derives AI-run phases from typed run lifecycle events", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const tabId = 88;

  await reportReadyMarkingFacts(brain, tabId);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.MARKING_DIRTY);

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.STARTED, {
    sessionId: "ai-session",
    deadlineAt: Date.now() + 480000,
  });
  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.PRE_AI);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.COMPUTING_AI);

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.RESULTS_APPLIED, {
    sessionId: "ai-session",
  });
  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.POST_AI);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.READY_TO_SAVE);

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.PREVIEW_READY, {
    sessionId: "ai-session",
  });
  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.AI_PREVIEW);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.PREVIEW_OPEN);

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.EXITED, {
    sessionId: "ai-session",
  });
  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.POST_AI);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.READY_TO_SAVE);
});

test("brain returns to PRE_AI after failed or timed-out AI run events", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const tabId = 89;

  await reportReadyMarkingFacts(brain, tabId);
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.STARTED, {
    sessionId: "ai-session",
    deadlineAt: Date.now() + 480000,
  });

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.FAILED, {
    sessionId: "ai-session",
    reason: "run_error",
  });
  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.PRE_AI);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.MARKING_DIRTY);

  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.STARTED, {
    sessionId: "ai-session-2",
    deadlineAt: Date.now() + 480000,
  });
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.TIMED_OUT, {
    sessionId: "ai-session-2",
    reason: "timed_out",
  });
  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.PRE_AI);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.MARKING_DIRTY);
});

test("popup fact reports cannot clobber typed AI-run authority except clean PRE_AI reset", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const tabId = 90;

  await reportReadyMarkingFacts(brain, tabId);
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.RESULTS_APPLIED, {
    sessionId: "ai-session",
  });
  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.POST_AI);
  assert.equal(brain.getPopupView(tabId).sessionPhase, SESSION_PHASES.READY_TO_SAVE);

  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      aiRunPhase: AI_RUN_PHASES.PRE_AI,
      aiRunUpToDate: false,
      previewActive: false,
      previewBlocked: false,
      sessionHasPendingChanges: true,
      currentPageHasPendingChanges: true,
      currentDraftDirty: true,
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: tabId,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.POST_AI);
  assert.equal(brain.getPopupView(tabId).sessionDictation?.phase, SESSION_PHASES.READY_TO_SAVE);

  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      aiRunPhase: AI_RUN_PHASES.PRE_AI,
      aiRunUpToDate: false,
      previewActive: false,
      previewBlocked: false,
      sessionHasPendingChanges: false,
      currentPageHasPendingChanges: false,
      currentDraftDirty: false,
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: tabId,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.POST_AI);
  assert.equal(brain.getPopupView(tabId).sessionDictation?.phase, SESSION_PHASES.MARKING_FRESH);
});
