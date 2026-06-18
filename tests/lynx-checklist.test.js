import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  buildLynxChecklistAssignments,
  buildLynxChecklistPromptState,
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
  assert.equal(normalized.pageTypes[0].title, "Service Page");
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
