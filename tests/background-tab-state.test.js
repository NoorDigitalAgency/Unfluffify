import test from "node:test";
import assert from "node:assert/strict";

import {
  aiComputeLockExpiresAtByTabId,
  disposeTabState,
  pageMotionFreezeControlQueueByTarget,
  popupStatePortsByTabId,
  renderModeNoJsInspectionTabIds,
  tabLifecycleStateByTabId,
  tabSpinnerQueueByTabId,
  tabWorldTraceStateByTabId
} from "../background/background-tab-state.js";

function clearAllTabStateMaps() {
  tabLifecycleStateByTabId.clear();
  tabSpinnerQueueByTabId.clear();
  popupStatePortsByTabId.clear();
  tabWorldTraceStateByTabId.clear();
  aiComputeLockExpiresAtByTabId.clear();
  pageMotionFreezeControlQueueByTarget.clear();
  renderModeNoJsInspectionTabIds.clear();
}

test("disposeTabState removes only the target tab across all maps", () => {
  clearAllTabStateMaps();

  tabLifecycleStateByTabId.set(1, { busy: true });
  tabLifecycleStateByTabId.set(2, { busy: false });
  tabSpinnerQueueByTabId.set(1, [{ id: "a" }]);
  tabSpinnerQueueByTabId.set(2, [{ id: "b" }]);
  popupStatePortsByTabId.set(1, new Set(["p1"]));
  popupStatePortsByTabId.set(2, new Set(["p2"]));
  tabWorldTraceStateByTabId.set(1, { events: [1] });
  tabWorldTraceStateByTabId.set(2, { events: [2] });
  aiComputeLockExpiresAtByTabId.set(1, Date.now() + 10_000);
  aiComputeLockExpiresAtByTabId.set(2, Date.now() + 10_000);
  pageMotionFreezeControlQueueByTarget.set("1:0", Promise.resolve());
  pageMotionFreezeControlQueueByTarget.set("1:all", Promise.resolve());
  pageMotionFreezeControlQueueByTarget.set("2:0", Promise.resolve());
  renderModeNoJsInspectionTabIds.add(1);
  renderModeNoJsInspectionTabIds.add(2);

  disposeTabState(1);

  assert.equal(tabLifecycleStateByTabId.has(1), false);
  assert.equal(tabSpinnerQueueByTabId.has(1), false);
  assert.equal(popupStatePortsByTabId.has(1), false);
  assert.equal(tabWorldTraceStateByTabId.has(1), false);
  assert.equal(aiComputeLockExpiresAtByTabId.has(1), false);
  assert.equal(pageMotionFreezeControlQueueByTarget.has("1:0"), false);
  assert.equal(pageMotionFreezeControlQueueByTarget.has("1:all"), false);
  assert.equal(renderModeNoJsInspectionTabIds.has(1), false);

  assert.equal(tabLifecycleStateByTabId.has(2), true);
  assert.equal(tabSpinnerQueueByTabId.has(2), true);
  assert.equal(popupStatePortsByTabId.has(2), true);
  assert.equal(tabWorldTraceStateByTabId.has(2), true);
  assert.equal(aiComputeLockExpiresAtByTabId.has(2), true);
  assert.equal(pageMotionFreezeControlQueueByTarget.has("2:0"), true);
});

test("disposeTabState ignores invalid tab ids", () => {
  clearAllTabStateMaps();

  tabLifecycleStateByTabId.set(3, { busy: true });
  pageMotionFreezeControlQueueByTarget.set("3:0", Promise.resolve());

  disposeTabState(0);
  disposeTabState(null);

  assert.equal(tabLifecycleStateByTabId.has(3), true);
  assert.equal(pageMotionFreezeControlQueueByTarget.has("3:0"), true);
});
