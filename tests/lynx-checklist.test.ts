import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  buildLynxChecklistAssignments,
  buildLynxChecklistPromptState,
  buildLynxChecklistViewModel,
  createInitialLynxChecklistState,
  normalizePropertyPageTypes
,
  cssSelectorSetsMatch,
  lynxAlreadyHasSelectorSet,
  sanitizeCssSelectorList
} from "../src/common/lynx-checklist.js";

const propertyPageTypes = [
  {
    pageType: "homepage",
    pages: [
      { url: "https://example.com/", wordsCount: 340 },
      { url: "https://example.com/", wordsCount: 120 }
    ]
  },
  {
    pageType: "article",
    pages: [
      { url: "https://example.com/article", wordsCount: 620 }
    ]
  },
  {
    pageType: "listing",
    pages: [
      { url: "https://example.com/listing?page=1", wordsCount: 710 },
      { url: "https://example.com/shared", wordsCount: 400 }
    ]
  },
  {
    pageType: "product",
    pages: [
      { url: "https://example.com/shared", wordsCount: 360 },
      { url: "https://example.com/product-a", wordsCount: 520 }
    ]
  }
];

const markedPages = [
  { url: "https://example.com/", title: "Home", pageType: "homepage" },
  { url: "https://example.com/article", title: "Article", pageType: "article" },
  { url: "https://example.com/listing?page=1", title: "Listing", pageType: "listing" },
  { url: "https://example.com/shared", title: "Shared", pageType: "product" },
  { url: "https://example.com/legacy", title: "Legacy" }
];

test("normalizes GraphQL page types and flags duplicate candidate URLs", () => {
  const normalized = normalizePropertyPageTypes(propertyPageTypes);

  assert.deepEqual(normalized.pageTypes.map((item) => item.key), [
    "homepage",
    "article",
    "listing",
    "product"
  ]);
  assert.deepEqual(normalized.duplicateUrls, ["https://example.com/shared"]);
  assert.equal(normalized.pageTypes[0].candidates.length, 1);
  assert.equal(
    normalized.pageTypes[2].candidates.find((item) => item.url === "https://example.com/shared").duplicate,
    true
  );
});

test("accepts the wrapped propertyPageTypes.pageTypes GraphQL response shape", () => {
  const normalized = normalizePropertyPageTypes({
    pageTypes: propertyPageTypes
  });

  assert.deepEqual(normalized.pageTypes.map((item) => item.key), [
    "homepage",
    "article",
    "listing",
    "product"
  ]);
});

test("filters out unsupported page types and uses the fixed friendly labels for allowed types", () => {
  const normalized = normalizePropertyPageTypes([
    {
      pageType: "custom_page_type",
      title: "Custom Page Type",
      pages: [{ url: "https://example.com/custom", wordsCount: 150 }]
    },
    {
      pageType: "service_page",
      title: "Service page from API",
      pages: [{ url: "https://example.com/service", wordsCount: 220 }]
    },
    {
      pageType: "landingPage",
      title: "Landing page from API",
      pages: [{ url: "https://example.com/landing", wordsCount: 180 }]
    }
  ]);

  assert.deepEqual(normalized.pageTypes.map((item) => item.key), [
    "service_page",
    "landing_page"
  ]);
  assert.deepEqual(normalized.pageTypes.map((item) => item.title), [
    "Service",
    "Landing Page (Lead)"
  ]);
});

test("merges repeated GraphQL page type groups and dedupes their candidate URLs", () => {
  const normalized = normalizePropertyPageTypes([
    {
      pageType: "service_page",
      title: "Service page from API",
      pages: [
        { url: "https://example.com/service", wordsCount: 220 },
        { url: "https://example.com/service", wordsCount: 180 }
      ]
    },
    {
      pageType: "servicePage",
      title: "Ignored duplicate title",
      pages: [
        { url: "https://example.com/service", wordsCount: 260 },
        { url: "https://example.com/services/consulting", wordsCount: 340 }
      ]
    }
  ]);

  assert.equal(normalized.pageTypes.length, 1);
  assert.equal(normalized.pageTypes[0].key, "service_page");
  assert.equal(normalized.pageTypes[0].title, "Service");
  assert.deepEqual(normalized.pageTypes[0].candidates, [
    {
      url: "https://example.com/services/consulting",
      wordsCount: 340,
      duplicate: false,
      duplicatePageTypes: []
    },
    {
      url: "https://example.com/service",
      wordsCount: 260,
      duplicate: false,
      duplicatePageTypes: []
    }
  ]);
  assert.deepEqual(normalized.duplicateUrls, []);
});

test("repairs stored pages with missing or wrong page types when the candidate URL is unique", () => {
  const checklist = buildLynxChecklistViewModel({
    pageTypes: propertyPageTypes,
    markedPages: [
      { url: "https://example.com/article", title: "Article" },
      { url: "https://example.com/product-a", title: "Product", pageType: "custom_page_type" }
    ]
  });

  assert.deepEqual(checklist.repairedMarkedPages, [
    {
      url: "https://example.com/article",
      pageType: "article",
      previousPageType: ""
    },
    {
      url: "https://example.com/product-a",
      pageType: "product",
      previousPageType: "custom_page_type"
    }
  ]);
  assert.deepEqual(checklist.activeMarkedPages, [
    { url: "https://example.com/article", title: "Article", pageType: "article" },
    { url: "https://example.com/product-a", title: "Product", pageType: "product" }
  ]);
});

test("keeps non-candidate and ambiguous duplicate URLs invalid instead of auto-repairing them", () => {
  const checklist = buildLynxChecklistViewModel({
    pageTypes: propertyPageTypes,
    markedPages: [
      { url: "https://example.com/legacy", title: "Legacy" },
      { url: "https://example.com/shared", title: "Shared", pageType: "custom_page_type" }
    ]
  });

  assert.deepEqual(checklist.repairedMarkedPages, []);
  assert.deepEqual(checklist.activeMarkedPages, []);
  assert.deepEqual(checklist.invalidMarkedPages, [
    { url: "https://example.com/legacy", title: "Legacy", pageType: "" },
    { url: "https://example.com/shared", title: "Shared", pageType: "custom_page_type" }
  ]);
});

test("allows sending once every current page type has a marked candidate", () => {
  const checklist = buildLynxChecklistViewModel({
    pageTypes: propertyPageTypes,
    markedPages: [
      { url: "https://example.com/", title: "Home", pageType: "homepage" },
      { url: "https://example.com/article", title: "Article", pageType: "article" },
      { url: "https://example.com/listing?page=1", title: "Listing", pageType: "listing" },
      { url: "https://example.com/product-a", title: "Product", pageType: "product" }
    ]
  });

  assert.equal(checklist.canSend, true);
  assert.deepEqual(checklist.blockingReason, { code: "" });
});

test("keeps the legacy AI confirmation hidden for Lynx submissions", () => {
  const promptState = buildLynxChecklistPromptState();

  assert.equal(promptState.aiQuestionDisabled, true);
  assert.equal(promptState.aiQuestionHidden, true);
  assert.equal(promptState.aiAnswer, "");
});

test("reports missing page types when coverage is incomplete", () => {
  const checklist = buildLynxChecklistViewModel({
    pageTypes: propertyPageTypes,
    markedPages: [
      { url: "https://example.com/", title: "Home", pageType: "homepage" },
      { url: "https://example.com/article", title: "Article", pageType: "article" },
      { url: "https://example.com/listing?page=1", title: "Listing", pageType: "listing" }
    ]
  });

  assert.equal(checklist.canSend, false);
  assert.deepEqual(checklist.blockingReason, {
    code: "missing_page_types",
    pageTypeKeys: ["product"]
  });
});

test("reports missing page types until each current type has at least one marked page", () => {
  const initial = createInitialLynxChecklistState();

  const checklist = buildLynxChecklistViewModel({
    ...initial,
    pageTypes: propertyPageTypes,
    markedPages
  });

  assert.equal(checklist.canSend, false);
  assert.deepEqual(checklist.blockingReason, {
    code: "missing_page_types",
    pageTypeKeys: ["product"]
  });
  assert.deepEqual(checklist.missingPageTypes.map((item) => item.key), ["product"]);
});

test("builds assignments from marked candidate pages only and drops duplicate or legacy entries", () => {
  assert.deepEqual(buildLynxChecklistAssignments({
    pageTypes: propertyPageTypes,
    markedPages
  }), [
    {
      key: "homepage",
      url: "https://example.com/",
      pageType: "homepage"
    },
    {
      key: "article",
      url: "https://example.com/article",
      pageType: "article"
    },
    {
      key: "listing",
      url: "https://example.com/listing?page=1",
      pageType: "listing"
    }
  ]);
});

// The candidate matcher normalizes BOTH sides: raw backend page types carry
// the root candidate as "https://host" (no trailing slash), and strict
// equality against the normalized current URL wrongly reported the root page
// as "not a candidate" (architect report, 2026-07-03).
test("getCurrentPageCandidateState matches the root page against an unnormalized root candidate", async () => {
  const { getCurrentPageCandidateState } = await import("../src/common/lynx-live-pages.js");
  const pageTypes = [
    {
      key: "homepage",
      title: "Homepage",
      candidates: [{ url: "https://www.example.com", duplicate: false }]
    }
  ];
  const atRoot = getCurrentPageCandidateState("https://www.example.com/", pageTypes);
  assert.equal(atRoot.status, "candidate");
  assert.equal(atRoot.pageTypeKey, "homepage");
  // Protocol variance: live-pages data carries http:// roots while the live
  // page canonicalizes to https — the live report that survived the slash
  // normalization alone.
  const httpCandidate = getCurrentPageCandidateState("https://www.example.com/", [
    { key: "homepage", title: "Homepage", candidates: [{ url: "http://www.example.com/", duplicate: false }] }
  ]);
  assert.equal(httpCandidate.status, "candidate");
  assert.equal(httpCandidate.pageTypeKey, "homepage");
  // Trailing-slash variance on non-root paths matches too.
  const withSlash = getCurrentPageCandidateState("https://www.example.com/news/", [
    { key: "news", title: "News", candidates: [{ url: "https://www.example.com/news", duplicate: false }] }
  ]);
  assert.equal(withSlash.status, "candidate");
  // A genuinely different page still misses.
  const miss = getCurrentPageCandidateState("https://www.example.com/other", pageTypes);
  assert.equal(miss.status, "missing");
});

// --- Send-to-Lynx cssInfo staleness guard (sanitize both sides, set equality) ---

test("sanitizeCssSelectorList trims, collapses whitespace, dedupes, drops empties, sorts", () => {
  assert.deepEqual(
    sanitizeCssSelectorList("  .b ,  div   p , .a,, .b ,"),
    [".a", ".b", "div p"]
  );
  assert.deepEqual(sanitizeCssSelectorList(null), []);
  assert.deepEqual(sanitizeCssSelectorList(""), []);
});

test("cssSelectorSetsMatch is order-insensitive and whitespace-robust, but case-sensitive", () => {
  assert.equal(cssSelectorSetsMatch(".a, .b, div  p", "div p , .b,.a"), true);
  assert.equal(cssSelectorSetsMatch(".a, .b", ".a"), false);
  assert.equal(cssSelectorSetsMatch(".Alpha", ".alpha"), false);
  assert.equal(cssSelectorSetsMatch("", ""), true);
});

test("lynxAlreadyHasSelectorSet blocks only a full both-field match from a selector-bearing backend", () => {
  const pending = { includeCss: ".inc-a, .inc-b", excludeCss: ".exc-a" };
  const backend = {
    usesUnfluffify: true,
    inclusionCssSelectors: ".inc-b , .inc-a",
    exclusionCssSelectors: " .exc-a"
  };
  assert.equal(lynxAlreadyHasSelectorSet(backend, pending), true);
  // One field differing means the submit is an UPDATE and stays allowed.
  assert.equal(
    lynxAlreadyHasSelectorSet({ ...backend, exclusionCssSelectors: ".exc-a, .exc-b" }, pending),
    false
  );
  assert.equal(
    lynxAlreadyHasSelectorSet({ ...backend, inclusionCssSelectors: "" }, pending),
    false
  );
  // A backend without selectors (or not using Unfluffify) never blocks.
  assert.equal(
    lynxAlreadyHasSelectorSet(
      { usesUnfluffify: true, inclusionCssSelectors: "", exclusionCssSelectors: null },
      pending
    ),
    false
  );
  assert.equal(
    lynxAlreadyHasSelectorSet({ ...backend, usesUnfluffify: false }, pending),
    false
  );
  assert.equal(lynxAlreadyHasSelectorSet(null, pending), false);
  assert.equal(lynxAlreadyHasSelectorSet(backend, null), false);
});

test("the popup wires the cssInfo gate fail-closed around the Lynx send", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  // Popover open kicks a fresh check ONLY once page-type coverage is
  // complete (the query is redundant while the todo guard blocks the send);
  // state defaults/resets to pending.
  assert.match(
    popupSource,
    /const coverage = buildLynxChecklistViewModel\(\{\s*pageTypes: view\.lynxChecklistPageTypes,\s*markedPages: view\.markedPages\s*\}\);\s*if \(coverage\.canSend\) \{\s*void refreshLynxCssInfoGate\(\);\s*\}/
  );
  assert.match(popupSource, /state\.lynxChecklistCssInfoStatus = "pending";/);
  // The comparison uses the SAME composition the submit sends.
  assert.match(
    popupSource,
    /function buildPendingLynxSelectorCss\(\)[\s\S]*?inclusionSelectors\.join\(", "\)[\s\S]*?buildSelectorSetForGraphqlSubmit\(normalizedSelectorSet\)\.exclusionSelectors\.join\(", "\)/
  );
  // Fetch failure lands in "error" (fail-closed), never "clear".
  assert.match(
    popupSource,
    /if \(!response \|\| response\.ok !== true \|\| !response\.cssInfo[\s\S]*?state\.lynxChecklistCssInfoStatus = "error";/
  );
  // The click-time belt: only a confirmed non-match sends.
  assert.match(
    popupSource,
    /if \(state\.lynxChecklistCssInfoStatus !== "clear"\) \{[\s\S]*?setLynxChecklistViewState\(\);\s*return;\s*\}/
  );
  // S7 (debug round): a pending/errored gate retries the check on the user's
  // click so a fail-closed state can recover instead of wedging (bug #7).
  assert.match(
    popupSource,
    /if \(state\.lynxChecklistCssInfoStatus !== "match" && !lynxCssInfoCheckInFlight\) \{\s*void refreshLynxCssInfoGate\(\);\s*\}/
  );
  // The TEMP every-click short-circuit is gone.
  assert.doesNotMatch(popupSource, /TEMP SHORT-CIRCUIT/);
  // The send button renders fail-closed off the gate status, and a spinner
  // narrates the in-flight check once coverage is complete.
  const uiSource = readFileSync(new URL("../src/popup/ui.tsx", import.meta.url), "utf8");
  assert.match(
    uiSource,
    /checklist\.canSend && \(view\.lynxChecklistCssInfoStatus \|\| "pending"\) === "pending"[\s\S]*?lynx-checklist-popover__spinner/
  );
  assert.match(
    uiSource,
    /disabled=\{!checklist\.canSend \|\| \(view\.lynxChecklistCssInfoStatus \|\| "pending"\) !== "clear"\}/
  );
  // Background transport exists and requests the full CssInfo shape.
  const remoteSource = readFileSync(new URL("../src/background/remote-network.ts", import.meta.url), "utf8");
  assert.match(remoteSource, /query cssInfo\(\$url: String!\) \{[\s\S]*?inclusionCssSelectors[\s\S]*?usesUnfluffify/);
  assert.match(remoteSource, /export async function fetchLynxCssInfo\(/);
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  assert.match(backgroundSource, /message\.type === "fetchLynxCssInfo"/);
});
