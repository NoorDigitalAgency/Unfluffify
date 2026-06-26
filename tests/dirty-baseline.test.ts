import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  state,
  isPageDraftDirty,
  setSavedPageEntry
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

test("AI-run-driven draft changes flip dirty to true until a backend save lands", () => {
  // Simulates the contract: AI run output mutates selectors which mutate the
  // per-page draft via re-sync; the dirty signal must flip true. A subsequent
  // user-triggered backend save (which calls setSavedPageEntry) refreshes the
  // baseline so dirty returns to false.
  resetState();
  const initial = makeEntry(["/html/body/p[1]"]);
  state.config.pageMarkings[PAGE_URL] = initial;
  isPageDraftDirty(PAGE_URL); // establish baseline (defaults + initial selectors)
  assert.equal(isPageDraftDirty(PAGE_URL), false);

  // AI run completes: new selectors influence the draft, sync repopulates it
  // with additional / changed rows.
  const afterAi = makeEntry([
    "/html/body/p[1]",
    "/html/body/article[1]"
  ]);
  state.config.pageMarkings[PAGE_URL] = afterAi;
  assert.equal(isPageDraftDirty(PAGE_URL), true);

  // User triggers a backend save. The just-saved entry refreshes the baseline.
  setSavedPageEntry(PAGE_URL, afterAi);
  assert.equal(isPageDraftDirty(PAGE_URL), false);

  // Subsequent user edit re-flips dirty.
  state.config.pageMarkings[PAGE_URL] = makeEntry([
    "/html/body/p[1]",
    "/html/body/article[1]",
    "/html/body/footer[1]"
  ]);
  assert.equal(isPageDraftDirty(PAGE_URL), true);
});

test("autoSeededPendingSavePageUrl overrides the baseline comparison and reports dirty", () => {
  resetState();
  state.config.pageMarkings[PAGE_URL] = makeEntry(["/html/body/p[1]"]);
  isPageDraftDirty(PAGE_URL); // establish baseline
  state.autoSeededPendingSavePageUrl = PAGE_URL;
  assert.equal(isPageDraftDirty(PAGE_URL), true);
});
