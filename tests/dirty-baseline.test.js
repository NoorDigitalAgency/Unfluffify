import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  state,
  isPageDraftDirty,
  markPageDraftUserEdited,
  clearPageDraftUserEdited
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
  state.pageDraftEditedSinceCleanByPageUrl.clear();
  state.savedPageEntry = null;
  state.savedPageUrl = "";
  state.autoSeededPendingSavePageUrl = "";
  state.pageSaveReconciliation = null;
}

test("isPageDraftDirty is false for a freshly auto-seeded page with no user edit", () => {
  resetState();
  // A populated draft alone (auto-seeded AI selectors) must NOT report dirty:
  // the old DOM-fingerprint approach reported dirty here due to xpath churn.
  state.config.pageMarkings[PAGE_URL] = makeEntry([
    "/html/body/p[1]",
    "/html/body/p[2]"
  ]);
  assert.equal(isPageDraftDirty(PAGE_URL), false);
});

test("isPageDraftDirty flips to true once the page is flagged as user-edited", () => {
  resetState();
  state.config.pageMarkings[PAGE_URL] = makeEntry(["/html/body/p[1]"]);
  assert.equal(isPageDraftDirty(PAGE_URL), false);
  markPageDraftUserEdited(PAGE_URL);
  assert.equal(isPageDraftDirty(PAGE_URL), true);
});

test("clearPageDraftUserEdited returns the page to clean (save / discard)", () => {
  resetState();
  state.config.pageMarkings[PAGE_URL] = makeEntry(["/html/body/p[1]"]);
  markPageDraftUserEdited(PAGE_URL);
  assert.equal(isPageDraftDirty(PAGE_URL), true);
  clearPageDraftUserEdited(PAGE_URL);
  assert.equal(isPageDraftDirty(PAGE_URL), false);
});

test("the user-edit flag is scoped per page URL", () => {
  resetState();
  const otherUrl = `${PAGE_URL}/other`;
  markPageDraftUserEdited(PAGE_URL);
  assert.equal(isPageDraftDirty(PAGE_URL), true);
  assert.equal(isPageDraftDirty(otherUrl), false);
});

test("isPageDraftDirty does NOT diff a DOM xpath fingerprint", () => {
  // Regression guard: the dirty signal must be driven purely by the explicit
  // per-page user-edit flag (+ reconciliation), never by comparing draft xpaths
  // against a snapshotted baseline. Dynamic SPAs churn xpaths with zero user
  // action, which the old fingerprint approach mis-read as dirty.
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const fnMatch = source.match(
    /export function isPageDraftDirty\(pageUrl\) \{[\s\S]*?\n\}/
  );
  assert.ok(fnMatch, "expected an isPageDraftDirty function in core.js");
  const body = fnMatch[0];
  assert.ok(
    /pageDraftEditedSinceCleanByPageUrl\.has\(pageUrl\)/.test(body),
    "isPageDraftDirty must read the explicit user-edit flag"
  );
  assert.ok(
    !/getEntryFingerprint/.test(body),
    "isPageDraftDirty must NOT compute a DOM xpath fingerprint"
  );
  assert.ok(
    !/cleanBaselineFingerprintByPageUrl/.test(body),
    "isPageDraftDirty must NOT consult the removed fingerprint baseline map"
  );
});

test("a manual mark/unmark flags the current page as user-edited", () => {
  // completeExplicitToggle is the single funnel for every manual mark/unmark,
  // and it must flag the current page so Save/Discard report dirty (State B).
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const fnMatch = source.match(
    /function completeExplicitToggle\([\s\S]*?\n\}/
  );
  assert.ok(fnMatch, "expected a completeExplicitToggle function in core.js");
  assert.ok(
    /pageDraftEditedSinceCleanByPageUrl\.add\(location\.href\)/.test(fnMatch[0]),
    "completeExplicitToggle must flag the current page as user-edited"
  );
});

test("auto-seeded AI-selector markings stay clean (Save/Discard disabled until a manual change or AI run)", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const block = source.match(
    /if \(autoSeededFromAiSelectors\) \{[\s\S]*?\n {2}\}/
  );
  assert.ok(block, "expected an `if (autoSeededFromAiSelectors)` block in renderMarkingCollections");
  const body = block[0];
  // The freshly seeded draft starts clean because auto-seed does not set the
  // user-edit flag. It must also avoid clearing an existing flag: committed AI
  // runs can render through this path and must stay dirty for State C.
  assert.ok(
    !/pageDraftEditedSinceCleanByPageUrl\.delete\(pageUrl\)/.test(body),
    "auto-seed must not clear a committed AI-run dirty flag"
  );
  assert.ok(
    !/autoSeededPendingSavePageUrl\s*=\s*pageUrl/.test(body),
    "auto-seed must NOT flag a pending save (would false-enable Save/Discard on fresh enable)"
  );
  // The seeded markings must still persist locally and refresh the UI.
  assert.ok(/scheduleSnapshotSave\(\)/.test(body), "auto-seed must still persist the seeded draft");
  assert.ok(/notifyDraftStatus\(pageUrl\)/.test(body), "auto-seed must still refresh draft status");
});

test("enableForBaseUrl can skip merging the disabled unsaved draft cache", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const fnMatch = source.match(
    /export async function enableForBaseUrl\(baseUrl, options = \{\}\) \{[\s\S]*?\n\}/
  );
  assert.ok(fnMatch, "expected enableForBaseUrl in core.js");
  const body = fnMatch[0];
  assert.match(body, /const discardUnsavedDraftCache = Boolean\(options && options\.discardUnsavedDraftCache\);/);
  assert.match(body, /!discardUnsavedDraftCache &&[\s\S]*?cachedDraft &&[\s\S]*?mergeDraftEntry\(/);
});
