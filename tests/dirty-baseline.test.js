import test from "node:test";
import assert from "node:assert/strict";

import {
  state,
  isPageDraftDirty,
  setSavedPageEntry
} from "../content/core.js";

const PAGE_URL = "https://example.com/dirty-baseline-test";

function makeEntry(xpaths) {
  return {
    title: "t",
    timestamp: Date.now(),
    pageType: "",
    xpaths: xpaths.map((xp) => ({ xpath: xp, excluded: false, explicit: false })),
    includeXpaths: [],
    selectorSuppressedXpaths: [],
    silentWhitespaceExcludedXpaths: [],
    submissionXpaths: [],
    renderedHtml: "",
    rawHtml: ""
  };
}

function resetState() {
  state.config = { pageMarkings: {} };
  state.cleanBaselineFingerprintByPageUrl.clear();
  state.savedPageEntry = null;
  state.savedPageUrl = "";
  state.autoSeededPendingSavePageUrl = "";
  state.pageSaveReconciliation = null;
}

test("isPageDraftDirty is false for a page that has no draft yet", () => {
  resetState();
  assert.equal(isPageDraftDirty(PAGE_URL), false);
});

test("isPageDraftDirty lazy-records the first non-empty draft as the clean baseline", () => {
  resetState();
  const initial = makeEntry(["/html/body/p[1]"]);
  state.config.pageMarkings[PAGE_URL] = initial;
  // First check after sync: no baseline yet, draft has content, so the
  // implicit baseline is recorded and the page reports clean.
  assert.equal(isPageDraftDirty(PAGE_URL), false);
  assert.ok(state.cleanBaselineFingerprintByPageUrl.has(PAGE_URL));
  // Same state on a subsequent check stays clean.
  assert.equal(isPageDraftDirty(PAGE_URL), false);
});

test("isPageDraftDirty flips to true when the draft diverges from the recorded baseline", () => {
  resetState();
  state.config.pageMarkings[PAGE_URL] = makeEntry(["/html/body/p[1]"]);
  isPageDraftDirty(PAGE_URL); // establish baseline
  state.config.pageMarkings[PAGE_URL] = makeEntry([
    "/html/body/p[1]",
    "/html/body/p[2]"
  ]);
  assert.equal(isPageDraftDirty(PAGE_URL), true);
});

test("setSavedPageEntry with a substantive entry refreshes the clean baseline", () => {
  resetState();
  state.config.pageMarkings[PAGE_URL] = makeEntry(["/html/body/p[1]"]);
  isPageDraftDirty(PAGE_URL); // establish baseline at xpaths=[p1]
  state.config.pageMarkings[PAGE_URL] = makeEntry([
    "/html/body/p[1]",
    "/html/body/p[2]"
  ]);
  assert.equal(isPageDraftDirty(PAGE_URL), true);
  // Simulate a backend save that confirms the new state.
  setSavedPageEntry(PAGE_URL, state.config.pageMarkings[PAGE_URL]);
  assert.equal(isPageDraftDirty(PAGE_URL), false);
});

test("setSavedPageEntry with an empty entry does not erase the established baseline", () => {
  resetState();
  state.config.pageMarkings[PAGE_URL] = makeEntry(["/html/body/p[1]"]);
  isPageDraftDirty(PAGE_URL); // establish baseline
  const before = state.cleanBaselineFingerprintByPageUrl.get(PAGE_URL);
  setSavedPageEntry(PAGE_URL, null);
  setSavedPageEntry(PAGE_URL, { xpaths: [] });
  const after = state.cleanBaselineFingerprintByPageUrl.get(PAGE_URL);
  assert.equal(after, before);
});

test("autoSeededPendingSavePageUrl overrides the baseline comparison and reports dirty", () => {
  resetState();
  state.config.pageMarkings[PAGE_URL] = makeEntry(["/html/body/p[1]"]);
  isPageDraftDirty(PAGE_URL); // establish baseline
  state.autoSeededPendingSavePageUrl = PAGE_URL;
  assert.equal(isPageDraftDirty(PAGE_URL), true);
});
