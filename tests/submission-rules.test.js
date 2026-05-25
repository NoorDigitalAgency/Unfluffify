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
      visibleToUser: true,
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
      visibleToUser: false,
      markableTextual: false
    }),
    { shouldSubmit: true, excluded: true }
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
      visibleToUser: true,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: false }
  );
});

test("implicit hidden textual content submits as excluded", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      visibleToUser: false,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: true }
  );
});

test("non-textual implicit nodes are omitted", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      visibleToUser: true,
      markableTextual: false
    }),
    { shouldSubmit: false, excluded: false }
  );
});