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
      currentDraftDirty: true,
      aiRunUpToDate: true,
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
});
