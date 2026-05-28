import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseExcludeParentBoundaryTarget,
  getExplicitMarkingRenderOptions,
  getExplicitMarkingPresentation,
  isValidExpandedExclusionBoundary,
  shouldAllowExplicitIncludeDescendantTarget,
  shouldAutoSeedMarkingsFromAiSelectors,
  shouldBlockExpandedExclusionRoot,
  shouldSelfMarkToggleableDefaultBoundary
} from "../content/marking-rules.js";

test("direct-text toggleable defaults remain self-markable with descendants", () => {
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasDirectOwnText: true,
      hasVisibleTextualDescendant: true,
      hasExplicitlyMarkedDescendant: false
    }),
    true
  );
});

test("toggleable defaults without direct text stay blocked by textual descendants", () => {
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasDirectOwnText: false,
      hasVisibleTextualDescendant: true,
      hasExplicitlyMarkedDescendant: false
    }),
    false
  );
});

test("toggleable defaults without descendants can self-mark", () => {
  assert.equal(
    shouldSelfMarkToggleableDefaultBoundary({
      hasDirectOwnText: false,
      hasVisibleTextualDescendant: false,
      hasExplicitlyMarkedDescendant: false
    }),
    true
  );
});

test("preview restore suppresses one-shot AI auto-seeding for unmarked pages", () => {
  assert.equal(
    shouldAutoSeedMarkingsFromAiSelectors({
      hasAiSelectors: true,
      hasSavedMarkingsForPage: false,
      suppressAutoSeed: true
    }),
    false
  );
});

test("AI auto-seeding still runs for unmarked pages outside preview restore", () => {
  assert.equal(
    shouldAutoSeedMarkingsFromAiSelectors({
      hasAiSelectors: true,
      hasSavedMarkingsForPage: false,
      suppressAutoSeed: false
    }),
    true
  );
});

test("structured group boundaries win immediately on direct Shift selection", () => {
  const boundary = { name: "benefits-list" };
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: boundary,
      selfStructuredGroup: true,
      selfToggleableBoundary: false,
      ancestors: []
    }),
    boundary
  );
});

test("directly clicked toggleable defaults win immediately on Shift selection", () => {
  const boundary = { name: "form" };
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: boundary,
      selfStructuredGroup: false,
      selfToggleableBoundary: true,
      ancestors: []
    }),
    boundary
  );
});

test("nearest structured group ancestor wins over broader candidates", () => {
  const nearestStructured = { name: "button-group" };
  const broaderToggleable = { name: "aside" };
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: null,
      ancestors: [
        { value: nearestStructured, isStructuredGroup: true, isToggleableBoundary: false, isMarkable: false },
        { value: broaderToggleable, isStructuredGroup: false, isToggleableBoundary: true, isMarkable: false }
      ]
    }),
    nearestStructured
  );
});

test("nearest nested toggleable default ancestor wins over broadest toggleable ancestor", () => {
  const form = { name: "form" };
  const aside = { name: "aside" };
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: null,
      ancestors: [
        { value: form, isStructuredGroup: false, isToggleableBoundary: true, isMarkable: false },
        { value: aside, isStructuredGroup: false, isToggleableBoundary: true, isMarkable: false }
      ]
    }),
    form
  );
});

test("nearest cohesive content boundary wins over a broader generic markable ancestor", () => {
  const nearestContentBoundary = { name: "section" };
  const broadestMarkable = { name: "article" };
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: null,
      ancestors: [
        {
          value: nearestContentBoundary,
          isStructuredGroup: false,
          isToggleableBoundary: false,
          isContentBoundary: true,
          isMarkable: true
        },
        { value: broadestMarkable, isStructuredGroup: false, isToggleableBoundary: false, isMarkable: true }
      ]
    }),
    nearestContentBoundary
  );
});

test("expanded exclusion boundaries allow cohesive grouped content without direct own text", () => {
  assert.equal(
    isValidExpandedExclusionBoundary({
      hasDirectOwnText: false,
      hasDirectTextualBoundary: false,
      qualifyingChildBoundaryCount: 0
    }),
    false
  );
  assert.equal(
    isValidExpandedExclusionBoundary({
      hasDirectOwnText: false,
      hasDirectTextualBoundary: false,
      qualifyingChildBoundaryCount: 2,
      hasOnlyLayoutWrapperChain: false,
      hasMixedSiblingContent: false
    }),
    true
  );
  assert.equal(
    isValidExpandedExclusionBoundary({
      hasDirectOwnText: true,
      hasDirectTextualBoundary: false
    }),
    true
  );
});

test("expanded exclusion boundaries allow a single adjacent visual sibling pair", () => {
  assert.equal(
    isValidExpandedExclusionBoundary({
      hasDirectOwnText: false,
      hasDirectTextualBoundary: false,
      qualifyingChildBoundaryCount: 1,
      hasOnlyLayoutWrapperChain: false,
      hasMixedSiblingContent: true,
      hasAdjacentVisualSiblingPair: true
    }),
    true
  );
});

test("expanded exclusion boundaries still block broader mixed sibling wrappers without the narrow pair escape hatch", () => {
  assert.equal(
    isValidExpandedExclusionBoundary({
      hasDirectOwnText: false,
      hasDirectTextualBoundary: false,
      qualifyingChildBoundaryCount: 1,
      hasOnlyLayoutWrapperChain: false,
      hasMixedSiblingContent: true,
      hasAdjacentVisualSiblingPair: false
    }),
    false
  );
});

test("expanded exclusions block body and sole visual body wrapper roots", () => {
  assert.equal(shouldBlockExpandedExclusionRoot({ isBody: true }), true);
  assert.equal(shouldBlockExpandedExclusionRoot({ isSoleVisualBodyWrapper: true }), true);
  assert.equal(shouldBlockExpandedExclusionRoot({ isBody: false, isSoleVisualBodyWrapper: false }), false);
});

test("explicit marking renders are scheduled for immediate invalidated feedback", () => {
  assert.deepEqual(getExplicitMarkingRenderOptions(), {
    delay: 0,
    minInterval: 0,
    invalidate: true
  });
});

test("explicit include descendants are blocked until the include boundary is removed", () => {
  assert.equal(
    shouldAllowExplicitIncludeDescendantTarget({
      insideExplicitIncludeAncestor: true,
      isExactExplicitInclude: false
    }),
    false
  );
  assert.equal(
    shouldAllowExplicitIncludeDescendantTarget({
      insideExplicitIncludeAncestor: true,
      isExactExplicitInclude: true
    }),
    true
  );
  assert.equal(
    shouldAllowExplicitIncludeDescendantTarget({
      insideExplicitIncludeAncestor: false,
      isExactExplicitInclude: false
    }),
    true
  );
});

test("hidden explicit markings use ghost presentation classes", () => {
  assert.deepEqual(
    getExplicitMarkingPresentation({ type: "include", visible: false }),
    { ghost: true, className: "uf-ghost-include" }
  );
  assert.deepEqual(
    getExplicitMarkingPresentation({ type: "exclude", visible: false }),
    { ghost: true, className: "uf-ghost-exclude" }
  );
  assert.deepEqual(
    getExplicitMarkingPresentation({ type: "include", visible: true }),
    { ghost: false, className: "uf-explicit-include" }
  );
});
