import test from "node:test";
import assert from "node:assert/strict";

import { resolveAiSubmissionRowState } from "../content/submission-rules.js";

test("explicit exclusions always submit as excluded", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: true,
      explicitlyIncluded: true,
      insideExcludedAncestor: false,
      visibleToUser: true,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: true }
  );
});

test("visible explicit includes submit as included content", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: true,
      insideExcludedAncestor: true,
      markableTextual: false
    }),
    { shouldSubmit: true, excluded: false }
  );
});

test("hidden explicit includes submit as excluded content", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: true,
      insideExcludedAncestor: false,
      markableTextual: false
    }),
    { shouldSubmit: true, excluded: false }
  );
});

test("descendants inside excluded ancestors are omitted unless explicitly included", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: true,
      visibleToUser: true,
      markableTextual: true
    }),
    { shouldSubmit: false, excluded: false }
  );
});

test("implicit visible textual content submits as included", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: false }
  );
});

test("implicit hidden textual content still submits as included content", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: false }
  );
});

test("non-textual implicit nodes are omitted", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      markableTextual: false
    }),
    { shouldSubmit: false, excluded: false }
  );
});

test("consent roots always submit as excluded", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      consentExcludedRoot: true,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: true }
  );
});

test("immutable exclusion roots always submit as excluded", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      immutableExcludedRoot: true,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: true }
  );
});

test("hidden toggleable roots submit as excluded", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      hiddenToggleableRoot: true,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: true }
  );
});

test("implicit exclusion roots do not duplicate inside excluded ancestors", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: true,
      immutableExcludedRoot: true,
      hiddenToggleableRoot: true,
      markableTextual: true
    }),
    { shouldSubmit: false, excluded: false }
  );
});