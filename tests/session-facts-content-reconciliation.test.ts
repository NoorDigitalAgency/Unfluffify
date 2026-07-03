import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createBrain } from "../src/background/brain/index.js";
import { REALMS } from "../src/common/bus/realms.js";
import { buildBusPortName } from "../src/common/bus/transport/transport-types.js";
import { SESSION_REPORT_TYPES } from "../src/common/bus/contracts/session-state.js";

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

// Marking enabled + ready: with isEnabled true and readiness satisfied the brain
// dictates mainUiHidden=false (the marking UI, incl. Save/Discard, is shown).
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

test("while a popup is connected the popup owns isEnabled/silentModeActive; conflicting content marking facts are dropped", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const tabId = 401;
  brain.registerPopupPort(tabId, createFakePopupPort(tabId));

  await reportPopup(brain, tabId, READY_FACTS);
  assert.notEqual(brain.getPopupView(tabId).sessionDictation?.phase, "silent");

  // Post-AI, content legitimately reports its page edit-state as silent
  // (marking edits locked). With a popup connected this must NOT flip the
  // brain-dictated marking UI off, or Save/Discard would vanish (the heartbeat
  // flicker / unclickable-blocker regression).
  await reportContent(brain, tabId, { isEnabled: false, silentModeActive: true });
  assert.notEqual(brain.getPopupView(tabId).sessionDictation?.phase, "silent");

  // A repeated content report (as the heartbeat would re-fold every tick) stays inert.
  await reportContent(brain, tabId, { isEnabled: false, silentModeActive: true });
  assert.notEqual(brain.getPopupView(tabId).sessionDictation?.phase, "silent");

  brain.heartbeat.stop(tabId);
});

test("content still owns isEnabled/silentModeActive when no popup is connected (silent highlighting authority)", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const tabId = 402;
  // No registerPopupPort -> no popup connected for this tab.

  await reportPopup(brain, tabId, READY_FACTS);
  assert.notEqual(brain.getPopupView(tabId).sessionDictation?.phase, "silent");

  // With the popup closed, content keeps authority over marking state so silent
  // highlighting still activates; its isEnabled:false now applies.
  await reportContent(brain, tabId, { isEnabled: false, silentModeActive: true });
  assert.equal(brain.getPopupView(tabId).sessionDictation?.phase, "silent");
});

test("content marking-fact reconciliation is per-tab (drop only for the tab with a connected popup)", async () => {
  const brain = createBrain({ logger: { error() {} } });
  const withPopup = 403;
  const withoutPopup = 404;
  brain.registerPopupPort(withPopup, createFakePopupPort(withPopup));

  await reportPopup(brain, withPopup, READY_FACTS);
  await reportPopup(brain, withoutPopup, READY_FACTS);

  await reportContent(brain, withPopup, { isEnabled: false, silentModeActive: true });
  await reportContent(brain, withoutPopup, { isEnabled: false, silentModeActive: true });

  // Tab with a popup keeps the popup's value; tab without a popup takes content's.
  assert.notEqual(brain.getPopupView(withPopup).sessionDictation?.phase, "silent");
  assert.equal(brain.getPopupView(withoutPopup).sessionDictation?.phase, "silent");

  brain.heartbeat.stop(withPopup);
});
