import test from "node:test";
import assert from "node:assert/strict";

import {
  collectInvalidPageMarkingUrls,
  buildPageSaveReconciliationKey,
  createBackendSavedPageMarkingsSnapshot,
  createConfigSyncPayload,
  isPageSaveReconciliationPending,
  normalizePageSaveReconciliation,
  normalizeConfig,
  normalizeConfigSyncPayload
} from "../common/config.js";

test("normalizeConfig preserves legacy page markings without pageType for later candidate reconciliation", () => {
  const normalized = normalizeConfig("https://example.com", {
    pageMarkings: {
      "https://example.com/legacy": {
        timestamp: "2026-01-01T00:00:00Z",
        xpaths: [{ xpath: "/html/body/main", excluded: true, explicit: true }],
        consentXpaths: ["/html/body/dialog"],
        includeXpaths: [],
        submissionXpaths: [],
        renderedHtml: "<main></main>",
        rawHtml: "<main></main>"
      },
      "https://example.com/current": {
        timestamp: "2026-01-01T00:00:00Z",
        pageType: "article",
        xpaths: [{ xpath: "/html/body/article", excluded: true }],
        includeXpaths: [],
        submissionXpaths: [],
        renderedHtml: "<article></article>",
        rawHtml: "<article></article>"
      }
    }
  }).config;

  assert.deepEqual(Object.keys(normalized.pageMarkings), [
    "https://example.com/legacy",
    "https://example.com/current"
  ]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized.pageMarkings["https://example.com/legacy"], "pageType"),
    false
  );
  assert.equal(normalized.pageMarkings["https://example.com/current"].pageType, "article");
});

test("normalizeConfig preserves unsupported page types for later candidate reconciliation", () => {
  const normalized = normalizeConfig("https://example.com", {
    pageMarkings: {
      "https://example.com/legacy": {
        timestamp: "2026-01-01T00:00:00Z",
        pageType: "custom_page_type",
        xpaths: [{ xpath: "/html/body/main", excluded: true, explicit: true }],
        consentXpaths: ["/html/body/dialog"],
        includeXpaths: [],
        submissionXpaths: [],
        renderedHtml: "<main></main>",
        rawHtml: "<main></main>"
      },
      "https://example.com/current": {
        timestamp: "2026-01-01T00:00:00Z",
        pageType: "article",
        xpaths: [{ xpath: "/html/body/article", excluded: true }],
        includeXpaths: [],
        submissionXpaths: [],
        renderedHtml: "<article></article>",
        rawHtml: "<article></article>"
      }
    }
  }).config;

  assert.deepEqual(Object.keys(normalized.pageMarkings), [
    "https://example.com/legacy",
    "https://example.com/current"
  ]);
  assert.equal(normalized.pageMarkings["https://example.com/legacy"].pageType, "custom_page_type");
  assert.equal(normalized.pageMarkings["https://example.com/current"].pageType, "article");
});

test("collectInvalidPageMarkingUrls returns raw URLs for legacy missing or unsupported page types", () => {
  assert.deepEqual(
    collectInvalidPageMarkingUrls({
      "https://example.com/missing": {
        timestamp: "2026-01-01T00:00:00Z"
      },
      "https://example.com/unsupported": {
        timestamp: "2026-01-01T00:00:00Z",
        pageType: "custom_page_type"
      },
      "https://example.com/current": {
        timestamp: "2026-01-01T00:00:00Z",
        pageType: "article"
      }
    }),
    [
      "https://example.com/missing",
      "https://example.com/unsupported"
    ]
  );
});

test("createConfigSyncPayload keeps pageType on synced page markings", () => {
  const payload = createConfigSyncPayload("https://example.com", {
    siteId: 123,
    pageMarkings: {
      "https://example.com/current": {
        timestamp: "2026-01-01T00:00:00Z",
        pageType: "listing",
        xpaths: [{ xpath: "/html/body/main", excluded: true, explicit: true }],
        consentXpaths: ["/html/body/dialog"],
        includeXpaths: [],
        submissionXpaths: [],
        renderedHtml: "<main></main>",
        rawHtml: "<main></main>"
      }
    }
  });

  assert.equal(payload.pageMarkings["https://example.com/current"].pageType, "listing");
  assert.equal(payload.version, 4);
  assert.deepEqual(payload.pageMarkings["https://example.com/current"].xpaths, [
    { xpath: "/html/body/main", excluded: true, explicit: true }
  ]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload.pageMarkings["https://example.com/current"], "consentXpaths"),
    false
  );
});

test("page marking selector suppression xpaths are normalized and included in sync payloads", () => {
  const normalized = normalizeConfig("https://example.com", {
    pageMarkings: {
      "https://example.com/current": {
        timestamp: "2026-01-01T00:00:00Z",
        pageType: "listing",
        xpaths: [{ xpath: "/html/body/main", excluded: true }],
        includeXpaths: [],
        selectorSuppressedXpaths: [
          "/html/body/main/section",
          "/html/body/main/section",
          ""
        ],
        submissionXpaths: [],
        renderedHtml: "<main></main>",
        rawHtml: "<main></main>"
      }
    }
  }).config;

  assert.deepEqual(
    normalized.pageMarkings["https://example.com/current"].selectorSuppressedXpaths,
    ["/html/body/main/section"]
  );

  const payload = createConfigSyncPayload("https://example.com", normalized);
  assert.deepEqual(
    payload.pageMarkings["https://example.com/current"].selectorSuppressedXpaths,
    ["/html/body/main/section"]
  );

  const roundTripped = normalizeConfigSyncPayload(payload, "https://example.com");
  assert.deepEqual(
    roundTripped.pageMarkings["https://example.com/current"].selectorSuppressedXpaths,
    ["/html/body/main/section"]
  );
});

test("backend-saved page marking snapshots keep only confirmed page entries outside config sync", () => {
  const snapshot = createBackendSavedPageMarkingsSnapshot({
    "https://example.com/current": {
      timestamp: "2026-01-01T00:00:00Z",
      title: "Current",
      pageType: "article",
      xpaths: [{ xpath: "/html/body/header", excluded: true, explicit: true }],
      includeXpaths: ["/html/body/main"],
      consentXpaths: ["/html/body/dialog"],
      selectorSuppressedXpaths: ["/html/body/header/nav"],
      submissionXpaths: [{ xpath: "/html/body/header", excluded: true }],
      renderedHtml: "<main>Saved</main>",
      rawHtml: "<html><body><main>Saved</main></body></html>",
      transientLocalOnly: true
    }
  });

  assert.deepEqual(snapshot, {
    "https://example.com/current": {
      timestamp: "2026-01-01T00:00:00Z",
      title: "Current",
      pageType: "article",
      xpaths: [{ xpath: "/html/body/header", excluded: true, explicit: true }],
      includeXpaths: ["/html/body/main"],
      selectorSuppressedXpaths: ["/html/body/header/nav"],
      submissionXpaths: [{ xpath: "/html/body/header", excluded: true }],
      renderedHtml: "<main>Saved</main>",
      rawHtml: "<html><body><main>Saved</main></body></html>"
    }
  });
});

test("page save reconciliation normalizes pending local save locks", () => {
  const normalized = normalizePageSaveReconciliation({
    status: "pending",
    baseUrl: "https://www.example.com/shop/",
    pageUrl: "https://www.example.com/shop/item",
    reason: "sync_failed",
    updatedAt: "2026-01-01T00:00:00Z"
  });

  assert.equal(normalized.status, "pending");
  assert.equal(normalized.baseUrl, "https://example.com/shop");
  assert.equal(normalized.pageUrl, "https://www.example.com/shop/item");
  assert.equal(normalized.reason, "sync_failed");
  assert.equal(isPageSaveReconciliationPending(normalized), true);
});

test("page save reconciliation keys are scoped by normalized base and exact page url", () => {
  assert.equal(
    buildPageSaveReconciliationKey(
      "https://www.example.com/shop/",
      "https://www.example.com/shop/item?variant=1"
    ),
    JSON.stringify(["https://example.com/shop", "https://www.example.com/shop/item?variant=1"])
  );
  assert.equal(buildPageSaveReconciliationKey("", "https://example.com"), "");
});
