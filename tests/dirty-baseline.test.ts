import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  state,
  isPageDraftDirty,
  markUserMarkingEdit,
  clearUserMarkingEdit,
  hasUserMarkingEdit
} from "../src/content/core.js";

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
  state.userMarkingEditsByPageUrl.clear();
  state.savedPageEntry = null;
  state.savedPageUrl = "";
  state.autoSeededPendingSavePageUrl = "";
  state.pageSaveReconciliation = null;
}

test("isPageDraftDirty is false for a page with no user marking edit", () => {
  resetState();
  assert.equal(isPageDraftDirty(PAGE_URL), false);
});

test("draft entry changes without a real user edit never flip dirty (scroll / re-sync / AI)", () => {
  resetState();
  state.config.pageMarkings[PAGE_URL] = makeEntry(["/html/body/p[1]"]);
  assert.equal(isPageDraftDirty(PAGE_URL), false);
  // A background re-sync / reflow / AI selector apply repopulates the draft with
  // different rows. Deterministic dirty must NOT flip - only a real user toggle
  // counts, so a scroll or re-sync can never wrongly demand a fresh AI run.
  state.config.pageMarkings[PAGE_URL] = makeEntry([
    "/html/body/p[1]",
    "/html/body/p[2]",
    "/html/body/article[1]"
  ]);
  assert.equal(isPageDraftDirty(PAGE_URL), false);
});

test("isPageDraftDirty flips to true only after a real user marking edit", () => {
  resetState();
  state.config.pageMarkings[PAGE_URL] = makeEntry(["/html/body/p[1]"]);
  assert.equal(isPageDraftDirty(PAGE_URL), false);
  markUserMarkingEdit(PAGE_URL);
  assert.equal(hasUserMarkingEdit(PAGE_URL), true);
  assert.equal(isPageDraftDirty(PAGE_URL), true);
});

test("clearUserMarkingEdit returns the page to clean (enable / AI-run / save / discard baseline)", () => {
  resetState();
  markUserMarkingEdit(PAGE_URL);
  assert.equal(isPageDraftDirty(PAGE_URL), true);
  clearUserMarkingEdit(PAGE_URL);
  assert.equal(isPageDraftDirty(PAGE_URL), false);
});

test("a user edit on one page does not make a different page dirty", () => {
  resetState();
  markUserMarkingEdit(PAGE_URL);
  assert.equal(isPageDraftDirty("https://example.com/other-page"), false);
});

test("autoSeededPendingSavePageUrl overrides and reports dirty", () => {
  resetState();
  state.autoSeededPendingSavePageUrl = PAGE_URL;
  assert.equal(isPageDraftDirty(PAGE_URL), true);
});
