import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createBrain } from "../src/background/brain/index.js";
import { REALMS } from "../src/common/bus/realms.js";
import { SESSION_PHASES, SESSION_REPORT_TYPES } from "../src/common/bus/contracts/session-state.js";

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
      currentPageHasPendingChanges: true,
      currentDraftDirty: true,
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

test("brain derives the COMPUTING_AI phase from an AI-run spinner lease, not popup facts", async () => {
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
    deadlineAt: 481000,
    maxDurationMs: 480000,
    updatedAt: 1000,
    blockSurfaces: { page: true, popup: true },
  };

  brain.syncProjectedSpinnerQueue(77, [aiRunLease], "spinner-operations:set");

  const computingView = brain.getPopupView(77);
  assert.equal(computingView.sessionPhase, SESSION_PHASES.COMPUTING_AI);
  assert.equal(computingView.sessionDictation?.curtain.visible, true);
  assert.equal(computingView.sessionDictation?.curtain.operation, "computing_ai");
  assert.equal(computingView.sessionDictation?.curtain.timerText, "");

  brain.syncProjectedSpinnerQueue(77, [], "spinner-operations:remove");

  const clearedView = brain.getPopupView(77);
  assert.notEqual(clearedView.sessionPhase, SESSION_PHASES.COMPUTING_AI);
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
