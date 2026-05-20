import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseExcludeParentBoundaryTarget,
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

test("falls back to the broadest non-toggleable markable ancestor", () => {
  const nearestMarkable = { name: "section" };
  const broadestMarkable = { name: "article" };
  assert.equal(
    chooseExcludeParentBoundaryTarget({
      selfValue: null,
      ancestors: [
        { value: nearestMarkable, isStructuredGroup: false, isToggleableBoundary: false, isMarkable: true },
        { value: broadestMarkable, isStructuredGroup: false, isToggleableBoundary: false, isMarkable: true }
      ]
    }),
    broadestMarkable
  );
});