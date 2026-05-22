import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLynxChecklistAssignments,
  buildLynxChecklistViewModel,
  createInitialLynxChecklistState,
  normalizePropertyPageTypes
} from "../common/lynx-checklist.js";

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
    "Service Page",
    "Landing Page"
  ]);
});

test("requires the AI confirmation before sending", () => {
  const checklist = buildLynxChecklistViewModel({
    pageTypes: propertyPageTypes,
    markedPages
  });

  assert.equal(checklist.canSend, false);
  assert.deepEqual(checklist.blockingReason, { code: "ai_unanswered" });
});

test("reports missing page types until each current type has at least one marked page", () => {
  const initial = createInitialLynxChecklistState();
  initial.aiAnswer = "yes";

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

test("allows sending once AI is confirmed and every current page type has a marked candidate", () => {
  const checklist = buildLynxChecklistViewModel({
    aiAnswer: "yes",
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
