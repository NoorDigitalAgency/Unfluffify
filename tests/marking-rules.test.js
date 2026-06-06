import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseExcludeParentBoundaryTarget,
  isStoredExcludeStateUserModified,
  shouldAllowParentMarkingBoundary,
  shouldCollectToggleableDefaultBoundary,
  shouldSelfMarkToggleableDefaultBoundary
} from "../content/marking-rules.js";
import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS
} from "../common/constants.js";

test("toggleable boundary self-markability restores 052c direct-text and descendant rules", () => {
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasDirectOwnText: false,
      hasVisibleTextualDescendant: false,
      hasExplicitlyMarkedDescendant: false
    }),
    true
  );
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasDirectOwnText: false,
      hasVisibleTextualDescendant: true,
      hasExplicitlyMarkedDescendant: false
    }),
    false
  );
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasDirectOwnText: false,
      hasVisibleTextualDescendant: false,
      hasExplicitlyMarkedDescendant: true
    }),
    false
  );
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasDirectOwnText: true,
      hasVisibleTextualDescendant: true,
      hasExplicitlyMarkedDescendant: true
    }),
    true
  );
});

test("toggleable default boundary collection trusts structural auto-default eligibility", () => {
  assert.equal(
    shouldCollectToggleableDefaultBoundary({
      isToggleableDefaultExcluded: true,
      isHiddenSubtree: false,
      hasVisibleImmutableDescendant: true
    }),
    true
  );
  assert.equal(
    shouldCollectToggleableDefaultBoundary({
      isToggleableDefaultExcluded: false,
      isHiddenSubtree: false,
      hasVisibleImmutableDescendant: true
    }),
    false
  );
});

test("Shift parent chooser prefers 052c structured, toggleable, then broadest markable ancestors", () => {
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: "self",
      selfStructuredGroup: true,
      ancestors: [{ value: "ancestor", isStructuredGroup: true }]
    }),
    "self"
  );
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: "self",
      ancestors: [
        { value: "nearest", isMarkable: true },
        { value: "structured", isStructuredGroup: true },
        { value: "broad", isMarkable: true }
      ]
    }),
    "structured"
  );
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: "self",
      ancestors: [
        { value: "nearest", isMarkable: true },
        { value: "toggleable", isToggleableBoundary: true },
        { value: "broad", isMarkable: true }
      ]
    }),
    "toggleable"
  );
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: "self",
      ancestors: [
        { value: "nearest", isMarkable: true },
        { value: "broad", isMarkable: true }
      ]
    }),
    "broad"
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

test("parent marking accepts a wrapper with one markable descendant", () => {
  assert.equal(
    shouldAllowParentMarkingBoundary({
      hasDirectText: false,
      markableDescendantCount: 0
    }),
    false
  );
  assert.equal(
    shouldAllowParentMarkingBoundary({
      hasDirectText: false,
      markableDescendantCount: 1
    }),
    true
  );
  assert.equal(
    shouldAllowParentMarkingBoundary({
      hasDirectText: true,
      markableDescendantCount: 0
    }),
    true
  );
});

test("locked default-exclusion taxonomy keeps buttons toggleable and links omitted", () => {
  assert.deepEqual(DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS, [
    "FOOTER",
    "FORM",
    "LABEL",
    "NAV",
    "HEADER",
    "DIALOG",
    "ASIDE",
    "BUTTON"
  ]);
  assert.deepEqual(DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS, [
    "IMG",
    "INPUT",
    "NOSCRIPT",
    "SELECT",
    "TITLE",
    "STYLE",
    "SCRIPT",
    "TEMPLATE",
    "IFRAME",
    "VIDEO"
  ]);

  const toggleable = new Set(DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS);
  const immutable = new Set(DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS);
  for (const tag of ["FOOTER", "FORM", "LABEL", "NAV", "HEADER", "DIALOG", "ASIDE", "BUTTON"]) {
    assert.equal(toggleable.has(tag), true, `${tag} should be toggleable`);
    assert.equal(immutable.has(tag), false, `${tag} should not be immutable`);
  }
  assert.equal(toggleable.has("LINK"), false, "LINK is omitted from the toggleable taxonomy");
  assert.equal(immutable.has("LINK"), false, "LINK is omitted from the immutable taxonomy");
  for (const tag of [
    "IMG",
    "INPUT",
    "NOSCRIPT",
    "SELECT",
    "TITLE",
    "STYLE",
    "SCRIPT",
    "TEMPLATE",
    "IFRAME",
    "VIDEO"
  ]) {
    assert.equal(immutable.has(tag), true, `${tag} should be immutable`);
    assert.equal(toggleable.has(tag), false, `${tag} should not be toggleable`);
  }
});
