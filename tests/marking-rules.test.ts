import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  chooseExcludeParentBoundaryTarget,
  isStoredExcludeStateUserModified,
  shouldAllowParentMarkingBoundary,
  shouldCollectToggleableDefaultBoundary,
  shouldSelfMarkToggleableDefaultBoundary
} from "../src/content/marking-rules.js";
import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS
} from "../src/common/constants.js";

const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

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

test("reconcile candidate scans keep immutable and excluded-parent guards ahead of self-markable fallback", () => {
  const syncScan = coreSource.slice(
    coreSource.indexOf("function scanReconcileDocumentCandidates("),
    coreSource.indexOf("async function scanReconcileDocumentCandidatesAsync(")
  );
  const asyncScan = coreSource.slice(
    coreSource.indexOf("async function scanReconcileDocumentCandidatesAsync("),
    coreSource.indexOf("function collectDefaultHighlightTargets(")
  );

  assert.match(syncScan, /const autoToggleableDefault = !current\.withinExcludedParent && !withinImmutable/);
  assert.match(syncScan, /\} else if \(!current\.withinExcludedParent && !withinImmutable\) \{/);
  assert.match(asyncScan, /const autoToggleableDefault = !current\.withinExcludedParent && !withinImmutable/);
  assert.match(asyncScan, /\} else if \(!current\.withinExcludedParent && !withinImmutable\) \{/);
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
    "VIDEO",
    "SVG"
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
    "VIDEO",
    "SVG"
  ]) {
    assert.equal(immutable.has(tag), true, `${tag} should be immutable`);
    assert.equal(toggleable.has(tag), false, `${tag} should not be toggleable`);
  }
});

test("immutable/toggleable tag matching is case-insensitive so foreign-namespace <svg> matches", () => {
  // SVG (and other foreign-namespace) elements report a lowercase tagName
  // ("svg"), unlike uppercased HTML tags. The tag-selector comparison must
  // uppercase BOTH sides or a plain "SVG" selector silently never matches the
  // <svg> root. Pin both matchers to compare `.tagName.toUpperCase()`.
  const immutableMatcher = coreSource.slice(
    coreSource.indexOf("function matchesImmutableExcluded("),
    coreSource.indexOf("function isWithinImmutableExcluded(")
  );
  assert.match(
    immutableMatcher,
    /el\.tagName\.toUpperCase\(\)\s*===\s*selector\.toUpperCase\(\)/,
    "matchesImmutableExcluded must compare tag names case-insensitively"
  );
  const toggleableMatcher = coreSource.slice(
    coreSource.indexOf("function matchesToggleableDefaultExcluded("),
    coreSource.indexOf("function hasNestedToggleableDefaultExcludedDescendant(")
  );
  assert.match(
    toggleableMatcher,
    /el\.tagName\.toUpperCase\(\)\s*===\s*selector\.toUpperCase\(\)/,
    "matchesToggleableDefaultExcluded must compare tag names case-insensitively"
  );
});
