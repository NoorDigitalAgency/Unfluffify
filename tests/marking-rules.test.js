import test from "node:test";
import assert from "node:assert/strict";

import {
  filterDefaultElementsForExplicitMarks,
  getExplicitMarkingFullRenderOptions,
  getExplicitMarkingPresentation,
  getExplicitMarkingRenderOptions,
  shouldIgnoreDuplicateUserToggle,
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

test("explicit marking renders use cached collections before the deferred rebuild", () => {
  assert.deepEqual(getExplicitMarkingRenderOptions(), {
    delay: 80,
    minInterval: 200,
    invalidate: false,
    reason: "explicit-toggle-reposition"
  });
});

test("explicit marking full renders are invalidating and rate-limited", () => {
  assert.deepEqual(getExplicitMarkingFullRenderOptions(), {
    delay: 120,
    minInterval: 500,
    invalidate: true,
    reason: "explicit-toggle-full-rebuild"
  });
});

test("explicit marking refresh removes stale related default elements", () => {
  const parent = {
    name: "parent",
    contains(element) {
      return element === child;
    }
  };
  const child = {
    name: "child",
    contains() {
      return false;
    }
  };
  const sibling = {
    name: "sibling",
    contains() {
      return false;
    }
  };

  assert.deepEqual(
    filterDefaultElementsForExplicitMarks([parent, child, sibling], [parent]),
    [sibling]
  );
  assert.deepEqual(
    filterDefaultElementsForExplicitMarks([parent, child, sibling], [child]),
    [sibling]
  );
});

test("duplicate user toggles on the same target and mode are ignored in a short window", () => {
  assert.equal(
    shouldIgnoreDuplicateUserToggle({
      targetXpath: "/HTML/BODY/DIV[1]",
      mode: "exclude",
      now: 1000,
      lastActionKey: "exclude:/HTML/BODY/DIV[1]",
      lastActionAt: 780
    }),
    true
  );
});

test("duplicate user toggles are ignored while the same target and mode is in-flight", () => {
  assert.equal(
    shouldIgnoreDuplicateUserToggle({
      targetXpath: "/HTML/BODY/DIV[1]",
      mode: "include",
      now: 2000,
      inFlightKey: "include:/HTML/BODY/DIV[1]"
    }),
    true
  );
});

test("fast repeated clicks on a different mode or target still proceed", () => {
  assert.equal(
    shouldIgnoreDuplicateUserToggle({
      targetXpath: "/HTML/BODY/DIV[1]",
      mode: "include",
      now: 1000,
      lastActionKey: "exclude:/HTML/BODY/DIV[1]",
      lastActionAt: 900
    }),
    false
  );
  assert.equal(
    shouldIgnoreDuplicateUserToggle({
      targetXpath: "/HTML/BODY/DIV[2]",
      mode: "exclude",
      now: 1000,
      lastActionKey: "exclude:/HTML/BODY/DIV[1]",
      lastActionAt: 900
    }),
    false
  );
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
