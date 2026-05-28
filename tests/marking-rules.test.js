import test from "node:test";
import assert from "node:assert/strict";

import {
  getExplicitMarkingPresentation,
  getExplicitMarkingRenderOptions,
  shouldAutoSeedMarkingsFromAiSelectors,
  shouldSelfMarkToggleableDefaultBoundary
} from "../content/marking-rules.js";

test("toggleable default boundary self-marks when no visible textual descendant and no explicitly marked descendant", () => {
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasVisibleTextualDescendant: false,
      hasExplicitlyMarkedDescendant: false
    }),
    true
  );
});

test("toggleable default boundary is blocked when a visible textual descendant exists", () => {
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasVisibleTextualDescendant: true,
      hasExplicitlyMarkedDescendant: false
    }),
    false
  );
});

test("toggleable default boundary is blocked when an explicitly marked descendant exists", () => {
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasVisibleTextualDescendant: false,
      hasExplicitlyMarkedDescendant: true
    }),
    false
  );
});

test("AI auto-seed runs for unmarked pages that have AI selectors", () => {
  assert.equal(
    shouldAutoSeedMarkingsFromAiSelectors({
      hasAiSelectors: true,
      hasSavedMarkingsForPage: false
    }),
    true
  );
});

test("AI auto-seed is skipped when the page already has saved markings", () => {
  assert.equal(
    shouldAutoSeedMarkingsFromAiSelectors({
      hasAiSelectors: true,
      hasSavedMarkingsForPage: true
    }),
    false
  );
});

test("AI auto-seed is skipped when there are no AI selectors", () => {
  assert.equal(
    shouldAutoSeedMarkingsFromAiSelectors({
      hasAiSelectors: false,
      hasSavedMarkingsForPage: false
    }),
    false
  );
});

test("explicit marking renders use the standard scheduleRender defaults", () => {
  assert.deepEqual(getExplicitMarkingRenderOptions(), {
    delay: 50,
    minInterval: 0,
    invalidate: true
  });
});

test("explicit include presentation uses the non-ghost include class", () => {
  assert.deepEqual(
    getExplicitMarkingPresentation({ type: "include" }),
    { ghost: false, className: "uf-explicit-include" }
  );
});

test("explicit exclude presentation uses the non-ghost exclude class", () => {
  assert.deepEqual(
    getExplicitMarkingPresentation({ type: "exclude" }),
    { ghost: false, className: "uf-explicit-exclude" }
  );
});

test("explicit marking presentation defaults to exclude when type is unrecognised", () => {
  assert.deepEqual(
    getExplicitMarkingPresentation({}),
    { ghost: false, className: "uf-explicit-exclude" }
  );
});
