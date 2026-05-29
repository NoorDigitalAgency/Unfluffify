import test from "node:test";
import assert from "node:assert/strict";

import {
  isStoredExcludeStateUserModified,
  shouldCollectToggleableDefaultBoundary,
  shouldPromoteDefaultBoundaryToInclude,
  shouldSelfMarkToggleableDefaultBoundary
} from "../content/marking-rules.js";

test("toggleable boundary self-markability remains a target-shape rule, not boundary identity", () => {
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasVisibleTextualDescendant: false,
      hasExplicitlyMarkedDescendant: false
    }),
    true
  );
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasVisibleTextualDescendant: true,
      hasExplicitlyMarkedDescendant: false
    }),
    false
  );
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasVisibleTextualDescendant: false,
      hasExplicitlyMarkedDescendant: true
    }),
    false
  );
});

test("visible toggleable default boundaries are collected regardless of visible immutable descendants", () => {
  assert.equal(
    shouldCollectToggleableDefaultBoundary({
      isToggleableDefaultExcluded: true,
      isHiddenSubtree: false,
      hasVisibleImmutableDescendant: true
    }),
    true
  );
});

test("toggleable default boundary collection rejects hidden and higher-precedence boundaries", () => {
  const base = {
    isToggleableDefaultExcluded: true,
    isHiddenSubtree: false
  };
  for (const blocked of [
    { isToggleableDefaultExcluded: false },
    { isHiddenSubtree: true },
    { isWithinAiIncluded: true },
    { isWithinAiPopover: true },
    { isWithinExplicitIncluded: true },
    { isWithinConsent: true },
    { isWithinExtensionUi: true },
    { isImmutableExcluded: true }
  ]) {
    assert.equal(
      shouldCollectToggleableDefaultBoundary({ ...base, ...blocked }),
      false
    );
  }
});

test("stored default-exclude state is user-modified only when it differs from the default posture", () => {
  assert.equal(
    isStoredExcludeStateUserModified({ isExcluded: true, isDefaultExcluded: true }),
    false
  );
  assert.equal(
    isStoredExcludeStateUserModified({ isExcluded: false, isDefaultExcluded: false }),
    false
  );
  assert.equal(
    isStoredExcludeStateUserModified({ isExcluded: false, isDefaultExcluded: true }),
    true
  );
  assert.equal(
    isStoredExcludeStateUserModified({ isExcluded: true, isDefaultExcluded: false }),
    true
  );
});

test("plain exclude clicks promote only eligible default boundaries to explicit include", () => {
  const base = {
    mode: "exclude",
    shiftHeld: false,
    altHeld: false,
    defaultBoundaryExists: true
  };
  assert.equal(shouldPromoteDefaultBoundaryToInclude(base), true);
  for (const blocked of [
    { mode: "include" },
    { shiftHeld: true },
    { altHeld: true },
    { defaultBoundaryExists: false },
    { isWithinAiIncluded: true },
    { isWithinExplicitIncluded: true },
    { defaultBoundaryAlreadyUserModified: true }
  ]) {
    assert.equal(
      shouldPromoteDefaultBoundaryToInclude({ ...base, ...blocked }),
      false
    );
  }
});