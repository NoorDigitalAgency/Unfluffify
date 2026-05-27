import test from "node:test";
import assert from "node:assert/strict";

import {
  DEVTOOLS_SOURCE_FILTER_ALL,
  formatSourceLabel,
  getDevtoolsSourceFilterOptions,
  matchesDevtoolsSourceFilter,
  normalizeDevtoolsSource
} from "../common/devtools-helpers.js";

test("devtools source helpers normalize and format known sources", () => {
  assert.equal(normalizeDevtoolsSource(" popup "), "popup");
  assert.equal(normalizeDevtoolsSource(""), "extension");
  assert.equal(formatSourceLabel("worker"), "background worker");
  assert.equal(formatSourceLabel("popup"), "popup.html");
  assert.equal(formatSourceLabel("content"), "page content script");
});

test("devtools source filter options include all plus known and dynamic sources", () => {
  const options = getDevtoolsSourceFilterOptions([
    { source: "popup" },
    { source: "worker" },
    { source: "support-page" }
  ]);

  assert.deepEqual(
    options.map((option) => option.value),
    [DEVTOOLS_SOURCE_FILTER_ALL, "worker", "popup", "content", "extension", "support-page"]
  );
  assert.deepEqual(
    options.map((option) => option.label),
    ["All sources", "background worker", "popup.html", "page content script", "extension", "support-page"]
  );
});

test("devtools source filter matches all or the selected source", () => {
  const popupEntry = { source: "popup" };
  const workerEntry = { source: "worker" };

  assert.equal(matchesDevtoolsSourceFilter(popupEntry, DEVTOOLS_SOURCE_FILTER_ALL), true);
  assert.equal(matchesDevtoolsSourceFilter(popupEntry, "popup"), true);
  assert.equal(matchesDevtoolsSourceFilter(workerEntry, "popup"), false);
  assert.equal(matchesDevtoolsSourceFilter({ source: "" }, "extension"), true);
});