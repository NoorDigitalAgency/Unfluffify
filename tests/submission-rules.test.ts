import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  isAiSubmissionDocumentRootXpath,
  resolveAiSubmissionRowState
} from "../src/content/submission-rules.js";

test("document root xpaths are not AI submission rows", () => {
  assert.equal(isAiSubmissionDocumentRootXpath("/html[1]"), true);
  assert.equal(isAiSubmissionDocumentRootXpath("/html[1]/body[1]"), true);
  assert.equal(isAiSubmissionDocumentRootXpath("/html[1]/body[1]/main[1]"), false);
});

test("explicit exclusions submit as excluded when not explicitly included", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: true,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      visibleToUser: true,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: true }
  );
});

test("generated default excluded rows submit as excluded when not explicitly included", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      excludedRow: true,
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      visibleToUser: true,
      markableTextual: false
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

test("hidden explicit includes still submit as included content", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: true,
      insideExcludedAncestor: false,
      visibleToUser: false,
      markableTextual: false
    }),
    { shouldSubmit: true, excluded: false }
  );
});

test("explicit includes win when a node is also explicitly excluded", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: true,
      explicitlyIncluded: true,
      insideExcludedAncestor: false,
      visibleToUser: false,
      markableTextual: false
    }),
    { shouldSubmit: true, excluded: false }
  );
});

test("explicit includes win over hidden-root classification", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: true,
      insideExcludedAncestor: false,
      hiddenToggleableRoot: true,
      visibleToUser: false,
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

test("explicitly-excluded descendants inside excluded ancestors are suppressed", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: true,
      explicitlyIncluded: false,
      insideExcludedAncestor: true,
      visibleToUser: true,
      markableTextual: true
    }),
    { shouldSubmit: false, excluded: false }
  );
});

test("immutable roots are omitted even when stale explicit rows exist", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: true,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      immutableExcludedRoot: true,
      visibleToUser: true,
      markableTextual: true
    }),
    { shouldSubmit: false, excluded: false }
  );
});

test("immutable roots are omitted even when stale includes exist", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: true,
      insideExcludedAncestor: false,
      immutableExcludedRoot: true,
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

test("hidden textual roots submit as excluded without consent-specific rules", () => {
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

test("immutable exclusion roots are omitted because immutable tags are sent separately", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      immutableExcludedRoot: true,
      visibleToUser: false,
      markableTextual: true
    }),
    { shouldSubmit: false, excluded: false }
  );
});

test("hidden toggleable roots submit as excluded only when textual", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      hiddenToggleableRoot: true,
      visibleToUser: false,
      markableTextual: true
    }),
    { shouldSubmit: true, excluded: true }
  );
});

test("hidden non-textual toggleable roots are omitted", () => {
  assert.deepEqual(
    resolveAiSubmissionRowState({
      explicitlyExcluded: false,
      explicitlyIncluded: false,
      insideExcludedAncestor: false,
      hiddenToggleableRoot: true,
      visibleToUser: false,
      markableTextual: false
    }),
    { shouldSubmit: false, excluded: false }
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
      visibleToUser: false,
      markableTextual: true
    }),
    { shouldSubmit: false, excluded: false }
  );
});
