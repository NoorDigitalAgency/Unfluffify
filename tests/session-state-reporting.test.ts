import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createBrain } from "../src/background/brain/index.js";
import { AI_RUN_EVENT_TYPES } from "../src/common/bus/contracts/ai-run.js";
import { REALMS } from "../src/common/bus/realms.js";
import {
  AI_RUN_PHASES,
  SESSION_PHASES,
  SESSION_REPORT_TYPES,
  SESSION_REQUEST_TYPES
} from "../src/common/bus/contracts/session-state.js";
import { LIFECYCLE_KINDS, LIFECYCLE_PHASES } from "../src/common/world-messaging-contract.js";

test("brain ingests reported session facts and projects optional dictation into popup view", async () => {
  const brain = createBrain({ logger: { error() {} } });

  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      baseUrlReady: true,
      siteIdReady: true,
      renderModeReady: true,
      isEnabled: true,
      aiReady: true,
      sessionHasPendingChanges: true,
      currentPageHasPendingChanges: false,
      currentDraftDirty: false,
      aiRunPhase: AI_RUN_PHASES.POST_AI,
      aiRunUpToDate: true,
      pageInspectionBusy: false,
      desktopPreviewVisible: false,
      deviceControlsDisabled: false,
      hasStoredSelectors: false,
      lynxChecklistCanSend: true,
      lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: 99,
  });

  await new Promise((resolve) => queueMicrotask(resolve));

  const popupView = brain.getPopupView(99);
  assert.equal(popupView.sessionPhase, SESSION_PHASES.READY_TO_SAVE);
  assert.ok(popupView.sessionDictation);
  assert.equal(popupView.sessionDictation?.phase, SESSION_PHASES.READY_TO_SAVE);
  assert.equal(popupView.sessionDictation?.buttons["page-save"].enabled, true);
  assert.equal(popupView.sessionDictation?.buttons["marking-preview"].enabled, true);
  assert.equal(popupView.secondaryGates?.previewLatestBlockedReason, "not_available");
  assert.deepEqual(popupView.secondaryGates?.lynxChecklistSendBlockedReason, {
    code: "not_available",
    pageTypeKeys: [],
  });
});

test("brain acknowledges popup facts apply with freshly derived secondary gates", async () => {
  const brain = createBrain({ logger: { error() {} } });

  const reply = await brain.bus.request(
    SESSION_REQUEST_TYPES.FACTS_APPLY,
    {
      source: "popup",
      facts: {
        baseUrlReady: true,
        siteIdReady: true,
        renderModeReady: true,
        isEnabled: false,
        silentModeActive: true,
        aiReady: true,
        aiRunUpToDate: true,
        sessionHasPendingChanges: true,
        currentPageHasPendingChanges: true,
        currentDraftDirty: true,
        hasStoredSelectors: true,
        lynxChecklistCanSend: true,
        lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
      },
    },
    {
      target: REALMS.BACKGROUND,
      tab: 104,
      timeoutMs: 1000,
    },
  );

  assert.equal(reply.ok, true);
  assert.equal(reply.tabId, 104);
  assert.equal(reply.secondaryGates?.saveExcludesBlockedReason, "");
  assert.equal(reply.secondaryGates?.previewLatestBlockedReason, "");
  assert.equal(brain.getPopupView(104).secondaryGates?.previewLatestBlockedReason, "");
});

test("brain derives the COMPUTING_AI phase from typed AI-run STARTED events", async () => {
  const brain = createBrain({ logger: { error() {} } });

  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      baseUrlReady: true,
      siteIdReady: true,
      renderModeReady: true,
      isEnabled: true,
      aiReady: true,
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: 77,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  await brain.bus.publish(AI_RUN_EVENT_TYPES.STARTED, {
    reason: "tab-run-ai-started",
  }, {
    target: REALMS.BACKGROUND,
    tab: 77,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  const computingView = brain.getPopupView(77);
  assert.equal(computingView.sessionPhase, SESSION_PHASES.COMPUTING_AI);
  assert.equal(computingView.sessionDictation?.curtain.visible, true);
  assert.equal(computingView.sessionDictation?.curtain.operation, "computing_ai");
  assert.equal(computingView.sessionDictation?.curtain.timerText, "");
  assert.equal(brain.store.get(77)?.aiRun.active, true);
  assert.ok((brain.store.get(77)?.aiRun.deadlineAt || 0) > Date.now());

  await brain.bus.publish(AI_RUN_EVENT_TYPES.RESULTS_APPLIED, {}, {
    target: REALMS.BACKGROUND,
    tab: 77,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  const clearedView = brain.getPopupView(77);
  assert.notEqual(clearedView.sessionPhase, SESSION_PHASES.COMPUTING_AI);
  assert.equal(brain.store.get(77)?.aiRun.active, false);
});

test("brain ignores legacy AI-run spinner leases as AI busy authority", async () => {
  const brain = createBrain({ logger: { error() {} } });

  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      baseUrlReady: true,
      siteIdReady: true,
      renderModeReady: true,
      isEnabled: true,
      aiReady: true,
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: 78,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  const aiRunLease = {
    key: "run-ai:77",
    message: "Waiting for AI results",
    persistent: false,
    owner: "popup",
    reason: "tab-run-ai-running",
    source: "background-command-router",
    startedAt: 1000,
    progress: 0,
    operationId: "ai-op",
    operationKind: "ai-run",
    operationPhase: "remote-wait",
    timerMode: "countdown",
    deadlineAt: Date.now() + 480000,
    maxDurationMs: 480000,
    updatedAt: 1000,
    blockSurfaces: { page: true, popup: true },
  };

  brain.syncProjectedSpinnerQueue(78, [aiRunLease], "spinner-operations:set");

  assert.notEqual(brain.getPopupView(78).sessionPhase, SESSION_PHASES.COMPUTING_AI);

  brain.syncProjectedSpinnerQueue(78, [], "spinner-operations:remove");
});

test("brain does not clobber popup-owned AI-run facts when no lease exists (resume path)", async () => {
  const brain = createBrain({ logger: { error() {} } });

  // A resumed run: the popup itself owns aiBusy/aiComputing because the
  // background service worker is not driving the run (no spinner lease).
  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      baseUrlReady: true,
      siteIdReady: true,
      renderModeReady: true,
      isEnabled: true,
      aiReady: true,
      aiBusy: true,
      aiComputing: true,
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: 55,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  assert.equal(brain.getPopupView(55).sessionPhase, SESSION_PHASES.COMPUTING_AI);

  // A spinner-queue sync with NO ai-run lease must leave the popup-owned facts
  // intact, so the resumed-run curtain does not flicker off mid-run.
  brain.syncProjectedSpinnerQueue(55, [], "spinner-operations:set");

  assert.equal(brain.getPopupView(55).sessionPhase, SESSION_PHASES.COMPUTING_AI);
});

test("brain preserves lifecycle-owned navigation curtain across queue sync and stale false fact replay", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const lifecycle = {
    kind: LIFECYCLE_KINDS.SILENT_HIGHLIGHTING,
    phase: LIFECYCLE_PHASES.STARTED,
    busy: true,
    message: "Inspecting page...",
    reason: "silent-highlighting",
    operationId: "silent-nav-1",
    source: "test",
  };

  brain.mirrorPopupState(88, {
    ok: true,
    tabId: 88,
    lifecycle,
    spinnerQueue: [],
    activeSpinnerLease: null,
    traceEnabled: false,
    traceEvents: [],
  }, "test:lifecycle-started");
  brain.syncProjectedSpinnerQueue(88, [], "test:empty-queue");

  assert.equal(brain.store.get(88)?.spinners.pageCurtain?.spinnerKey, "navInspect");

  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      navigationInspectionPending: false,
      pageInspectionBusy: false,
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: 88,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  assert.equal(brain.store.get(88)?.spinners.pageCurtain?.spinnerKey, "navInspect");

  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      navigationInspectionPending: true,
      pageInspectionBusy: true,
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: 88,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  await brain.bus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, {
    source: "popup",
    facts: {
      navigationInspectionPending: false,
      pageInspectionBusy: false,
    },
  }, {
    target: REALMS.BACKGROUND,
    tab: 88,
  });
  await new Promise((resolve) => queueMicrotask(resolve));

  assert.equal(brain.store.get(88)?.spinners.pageCurtain, null);
});
