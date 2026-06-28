import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  buildProjectedPropertyLockViewStatePatch,
  deriveProjectedPropertyLockSnapshotEffect,
  hasProjectedPropertyLockViewForTab
} from "../src/popup/property-lock-state-dictation.js";

function buildState(overrides = {}) {
  return {
    featureEnabled: true,
    currentTabId: 12,
    projectedTabId: 12,
    propertyLockView: {
      propertyLockVisible: true,
      propertyLockTone: "warning",
      propertyLockIcon: "map-marker-alert-outline",
      propertyLockStatusText: "Off candidate page",
      propertyLockDetailText: "Return soon",
      propertyLockSuggestVisible: false,
      propertyLockTakeVisible: false,
      propertyLockTakeText: "",
      propertyLockContinueVisible: false,
      propertyLockContinueText: "",
      propertyLockContinueDisabled: false,
      propertyLockForceContinueVisible: false,
      propertyLockForceContinueText: "",
      propertyLockSuggestionVisible: false,
      propertyLockAcceptVisible: false,
      propertyLockRejectVisible: false,
    },
    ...overrides,
  };
}

test("projected property-lock helper applies background-owned property-lock view for the active tab", () => {
  const state = buildState();

  assert.equal(hasProjectedPropertyLockViewForTab(state), true);
  assert.deepEqual(buildProjectedPropertyLockViewStatePatch(state), state.propertyLockView);
});

test("projected property-lock helper requests a refresh when projection disappears", () => {
  const effect = deriveProjectedPropertyLockSnapshotEffect({
    ...buildState({
      projectedTabId: null,
      propertyLockView: null,
    }),
    hadProjectedPropertyLockView: true
  });

  assert.equal(effect.patch, null);
  assert.equal(effect.refreshRequired, true);
});
