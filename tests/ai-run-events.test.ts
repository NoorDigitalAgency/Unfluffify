import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createBrain } from "../src/background/brain/index.js";
import { AI_RUN_EVENT_TYPES } from "../src/common/bus/contracts/ai-run.js";
import { SPINNER_EVENT_TYPES } from "../src/common/bus/contracts/spinner.js";
import { REALMS } from "../src/common/bus/realms.js";
import { buildBusPortName } from "../src/common/bus/transport/transport-types.js";
import {
  AI_RUN_PHASES,
  SESSION_PHASES,
  SESSION_REPORT_TYPES
} from "../src/common/bus/contracts/session-state.js";

function createFakePopupPort(tabId: number) {
  const postedMessages: unknown[] = [];
  const onMessage = {
    addListener() {},
    removeListener() {},
  };
  const onDisconnect = {
    addListener() {},
    removeListener() {},
  };
  const port = {
    name: buildBusPortName(tabId),
    onMessage,
    onDisconnect,
    postMessage(message: unknown) {
      postedMessages.push(message);
    },
    disconnect() {},
  };
  return {
    port: port as unknown as chrome.runtime.Port,
    postedMessages,
  };
}

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

  // The popup cannot clobber the typed AI-run authority: the store phase stays
  // POST_AI. But currentPageHasPendingChanges is a non-stripped page-edit signal,
  // so reporting it true drops the SESSION phase to MARKING_DIRTY (State B) - a
  // legitimate "edited the markings after the run" transition, not a clobber.
  assert.equal(brain.store.get(tabId)?.aiRun.phase, AI_RUN_PHASES.POST_AI);
  assert.equal(brain.getPopupView(tabId).sessionDictation?.phase, SESSION_PHASES.MARKING_DIRTY);

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

test("brain replays active spinner surfaces when the popup port registers", async () => {
  const brain = createBrain({ logger: { error() {}, debug() {} } });
  const tabId = 91;
  const deadlineAt = Date.now() + 480000;

  await reportReadyMarkingFacts(brain, tabId);
  await publishAiRunEvent(brain, tabId, AI_RUN_EVENT_TYPES.STARTED, {
    sessionId: "ai-session",
    deadlineAt,
  });

  const popupPort = createFakePopupPort(tabId);
  brain.registerPopupPort(tabId, popupPort.port);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const popupSpinnerEvent = popupPort.postedMessages.find((message) => {
    const envelope = message as { t?: unknown; payload?: { surface?: unknown; state?: { operationKind?: unknown } } };
    return envelope.t === SPINNER_EVENT_TYPES.SET &&
      envelope.payload?.surface === "popup" &&
      envelope.payload.state?.operationKind === "ai-run";
  }) as { payload: { state: { deadlineAt?: unknown; operationPhase?: unknown } } } | undefined;

  assert.ok(popupSpinnerEvent);
  assert.equal(popupSpinnerEvent.payload.state.operationPhase, "remote-wait");
  assert.equal(popupSpinnerEvent.payload.state.deadlineAt, deadlineAt);
});

test("brain publishes spinner clears when a popup registers before tab state exists", async () => {
  const brain = createBrain({ logger: { error() {}, debug() {} } });
  const tabId = 92;
  const popupPort = createFakePopupPort(tabId);

  brain.registerPopupPort(tabId, popupPort.port);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const clearedSurfaces = popupPort.postedMessages
    .map((message) => message as { t?: unknown; payload?: { surface?: unknown } })
    .filter((envelope) => envelope.t === SPINNER_EVENT_TYPES.CLEAR)
    .map((envelope) => envelope.payload?.surface)
    .sort();

  assert.deepEqual(clearedSurfaces, ["banner", "pageCurtain", "popup"]);
});
