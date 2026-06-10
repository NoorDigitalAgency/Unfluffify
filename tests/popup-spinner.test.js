import test from "node:test";
import assert from "node:assert/strict";

import {
  armSpinnerWatchdog,
  clearSpinnerWatchdog,
  normalizeSpinnerReason,
  popSpinner,
  pushSpinner,
  runWithSpinner
} from "../popup/spinner.js";

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeps() {
  const queue = new Map();
  const keyTabIds = new Map();
  const watchdogByKey = new Map();
  const removed = [];
  const synced = [];
  const cleared = [];
  const staleClears = [];
  let visible = false;
  let timer = 0;

  const deps = {
    popupSpinnerQueue: queue,
    popupSpinnerKeyTabIds: keyTabIds,
    popupSpinnerWatchdogByKey: watchdogByKey,
    spinnerWatchdogMs: 20,
    uiModule: {
      setUiBusy() {}
    },
    windowRef: {
      setTimeout,
      clearTimeout
    },
    cryptoRef: {
      randomUUID: () => "generated-key"
    },
    getCurrentPopupTabId: () => 7,
    getPopupSpinnerVisible: () => visible,
    setPopupSpinnerVisible: (value) => {
      visible = Boolean(value);
    },
    getPopupSpinnerTimer: () => timer,
    setPopupSpinnerTimer: (value) => {
      timer = Number(value) || 0;
    },
    popSpinner: (key) => {
      popSpinner(deps, key);
    },
    logPopupSpinnerDebug() {},
    setUiBusyFromCurrentSpinner() {},
    syncUiBusyFromBrokerState() {},
    syncSpinnerEntryToBackground: async (key) => {
      synced.push(key);
    },
    removeSpinnerEntryFromBackground: async (key, tabId) => {
      removed.push({ key, tabId });
    },
    clearSpinnerQueueInBackground: async (tabId) => {
      cleared.push(tabId);
    },
    scheduleStaleInspectionBusyClear: (tabId) => {
      staleClears.push(tabId);
    }
  };

  return {
    deps,
    queue,
    watchdogByKey,
    removed,
    synced,
    cleared,
    staleClears
  };
}

test("popup spinner normalizes reason values", () => {
  const { deps } = createDeps();
  assert.equal(normalizeSpinnerReason(deps, "explicit", "k", "msg"), "explicit");
  assert.equal(normalizeSpinnerReason(deps, "", "k", "msg"), "spinner:k");
  assert.equal(normalizeSpinnerReason(deps, "", "", "msg"), "message:msg");
  assert.equal(normalizeSpinnerReason(deps, "", "", ""), "popup-spinner");
});

test("popup spinner push and pop maintain queue and broker sync", async () => {
  const { deps, queue, removed, synced, cleared, staleClears } = createDeps();

  const key = pushSpinner(deps, "navInspect", "Inspecting page", { persistent: true });
  assert.equal(key, "navInspect");
  assert.equal(queue.has("navInspect"), true);

  await waitFor(0);
  assert.deepEqual(synced, ["navInspect"]);

  popSpinner(deps, "navInspect");
  assert.equal(queue.has("navInspect"), false);
  await waitFor(0);
  assert.deepEqual(removed, [{ key: "navInspect", tabId: 7 }]);
  assert.deepEqual(cleared, [7]);
  assert.deepEqual(staleClears, [7]);
});

test("popup spinner watchdog arms and can be cleared", async () => {
  const { deps, queue, watchdogByKey } = createDeps();

  queue.set("watch", { message: "Wait", persistent: false });
  armSpinnerWatchdog(deps, "watch");
  assert.equal(watchdogByKey.has("watch"), true);

  clearSpinnerWatchdog(deps, "watch");
  assert.equal(watchdogByKey.has("watch"), false);

  armSpinnerWatchdog(deps, "watch");
  await waitFor(40);
  assert.equal(queue.has("watch"), false);
});

test("popup spinner runWithSpinner pops after task settles", async () => {
  const { deps, queue } = createDeps();

  const result = await runWithSpinner(deps, "task", "Running", async () => "ok");
  assert.equal(result, "ok");
  assert.equal(queue.has("task"), false);
});
