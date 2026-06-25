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
  const pageBusySyncs = [];
  const uiBusySyncs = [];
  const projectedSyncs = [];
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
    setUiBusyFromCurrentSpinner() {
      uiBusySyncs.push([...queue.keys()]);
    },
    syncUiBusyFromBrokerState() {},
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    syncSpinnerEntryToBackground: async (key) => {
      synced.push(key);
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    removeSpinnerEntryFromBackground: async (key, tabId) => {
      removed.push({ key, tabId });
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    clearSpinnerQueueInBackground: async (tabId) => {
      cleared.push(tabId);
    },
    scheduleStaleInspectionBusyClear: (tabId) => {
      staleClears.push(tabId);
    },
    syncPageBusyFromPopupSpinner: () => {
      pageBusySyncs.push([...queue.keys()]);
    },
    syncProjectedSpinnerStateFromQueue: () => {
      projectedSyncs.push([...queue.keys()]);
    }
  };

  return {
    deps,
    queue,
    watchdogByKey,
    removed,
    synced,
    cleared,
    staleClears,
    pageBusySyncs,
    uiBusySyncs,
    projectedSyncs
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
  const { deps, queue, removed, synced, cleared, staleClears, projectedSyncs } = createDeps();

  const key = pushSpinner(deps, "navInspect", "Inspecting page", { persistent: true });
  assert.equal(key, "navInspect");
  assert.equal(queue.has("navInspect"), true);

  await waitFor(0);
  assert.deepEqual(synced, ["navInspect"]);
  assert.deepEqual(projectedSyncs[0], ["navInspect"]);

  popSpinner(deps, "navInspect");
  assert.equal(queue.has("navInspect"), false);
  await waitFor(0);
  assert.deepEqual(removed, [{ key: "navInspect", tabId: 7 }]);
  assert.deepEqual(cleared, [7]);
  assert.deepEqual(staleClears, [7]);
  assert.deepEqual(projectedSyncs.at(-1), []);
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
  const { deps, queue, projectedSyncs } = createDeps();

  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  const result = await runWithSpinner(deps, "task", "Running", async () => "ok");
  assert.equal(result, "ok");
  assert.equal(queue.has("task"), false);
  assert.deepEqual(projectedSyncs.at(-1), []);
});

test("popup spinner updates resync active selection even when key is not queue tail", () => {
  const { deps, queue, pageBusySyncs, uiBusySyncs, projectedSyncs } = createDeps();
  deps.setPopupSpinnerVisible(true);
  queue.set("blocking", {
    blockSurfaces: { page: true, popup: true },
    message: "Blocking",
    reason: "page-inspection-pending"
  });
  queue.set("background", {
    blockSurfaces: { page: false, popup: false },
    message: "Background",
    reason: "config-sync-saving"
  });

  pushSpinner(deps, "blocking", "Still blocking", { reason: "page-inspection-pending" });

  assert.equal(uiBusySyncs.length, 1);
  assert.equal(pageBusySyncs.length, 1);
  assert.equal(projectedSyncs.length, 1);
});

test("popup spinner message updates resync active selection even when key is not queue tail", () => {
  const { deps, queue, pageBusySyncs, uiBusySyncs, projectedSyncs } = createDeps();
  deps.setPopupSpinnerVisible(true);
  queue.set("blocking", {
    blockSurfaces: { page: true, popup: true },
    message: "Blocking",
    reason: "page-inspection-pending"
  });
  queue.set("background", {
    blockSurfaces: { page: false, popup: false },
    message: "Background",
    reason: "config-sync-saving"
  });

  setSpinnerMessage(deps, "blocking", "Still blocking");

  assert.equal(uiBusySyncs.length, 1);
  assert.equal(pageBusySyncs.length, 1);
  assert.equal(projectedSyncs.length, 1);
});
