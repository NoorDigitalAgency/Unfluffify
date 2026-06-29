import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  armSpinnerWatchdog,
  clearSpinnerWatchdog,
  normalizeSpinnerReason,
  popSpinner,
  pushSpinner,
  runWithSpinner,
  setSpinnerMessage
} from "../src/popup/spinner.js";

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeps() {
  const entries = new Map();
  const delayTimers = new Map();
  const keyTabIds = new Map();
  const watchdogByKey = new Map();
  const removed = [];
  const synced = [];
  const staleClears = [];

  const deps = {
    popupSpinnerEntriesByKey: entries,
    popupSpinnerDelayTimersByKey: delayTimers,
    popupSpinnerKeyTabIds: keyTabIds,
    popupSpinnerWatchdogByKey: watchdogByKey,
    spinnerWatchdogMs: 20,
    windowRef: {
      setTimeout,
      clearTimeout
    },
    cryptoRef: {
      randomUUID: () => "generated-key"
    },
    getCurrentPopupTabId: () => 7,
    popSpinner: (key) => {
      popSpinner(deps, key);
    },
    logPopupSpinnerDebug() {},
    syncSpinnerEntryToBackground: async (key) => {
      synced.push(key);
    },
    removeSpinnerEntryFromBackground: async (key, tabId) => {
      removed.push({ key, tabId });
    },
    scheduleStaleInspectionBusyClear: (tabId) => {
      staleClears.push(tabId);
    }
  };

  return {
    deps,
    entries,
    delayTimers,
    watchdogByKey,
    removed,
    synced,
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

test("popup spinner push and pop maintain request map and broker sync", async () => {
  const { deps, entries, removed, synced, staleClears } = createDeps();

  const key = pushSpinner(deps, "navInspect", "Inspecting page", { persistent: true });
  assert.equal(key, "navInspect");
  assert.equal(entries.has("navInspect"), true);

  await waitFor(0);
  assert.deepEqual(synced, ["navInspect"]);

  popSpinner(deps, "navInspect");
  assert.equal(entries.has("navInspect"), false);
  await waitFor(0);
  assert.deepEqual(removed, [{ key: "navInspect", tabId: 7 }]);
  assert.deepEqual(staleClears, [7]);
});

test("popup spinner watchdog arms and can be cleared", async () => {
  const { deps, entries, watchdogByKey } = createDeps();

  entries.set("watch", { message: "Wait", persistent: false });
  armSpinnerWatchdog(deps, "watch");
  assert.equal(watchdogByKey.has("watch"), true);

  clearSpinnerWatchdog(deps, "watch");
  assert.equal(watchdogByKey.has("watch"), false);

  armSpinnerWatchdog(deps, "watch");
  await waitFor(40);
  assert.equal(entries.has("watch"), false);
});

test("popup spinner runWithSpinner pops after task settles", async () => {
  const { deps, entries } = createDeps();

  const result = await runWithSpinner(deps, "task", "Running", async () => "ok");
  assert.equal(result, "ok");
  assert.equal(entries.has("task"), false);
});

test("popup spinner update syncs the keyed broker request even when key is not tail", () => {
  const { deps, entries, synced } = createDeps();
  entries.set("blocking", {
    blockSurfaces: { page: true, popup: true },
    message: "Blocking",
    reason: "page-inspection-pending"
  });
  entries.set("background", {
    blockSurfaces: { page: false, popup: false },
    message: "Background",
    reason: "config-sync-saving"
  });

  pushSpinner(deps, "blocking", "Still blocking", { reason: "page-inspection-pending" });

  assert.deepEqual(synced, ["blocking"]);
});

test("popup spinner message update syncs the keyed broker request even when key is not tail", () => {
  const { deps, entries, synced } = createDeps();
  entries.set("blocking", {
    blockSurfaces: { page: true, popup: true },
    message: "Blocking",
    reason: "page-inspection-pending"
  });
  entries.set("background", {
    blockSurfaces: { page: false, popup: false },
    message: "Background",
    reason: "config-sync-saving"
  });

  setSpinnerMessage(deps, "blocking", "Still blocking");

  assert.deepEqual(synced, ["blocking"]);
});
