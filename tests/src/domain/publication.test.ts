import { describe, expect, it } from "vitest";

import {
  evaluatePublicationChecklist,
  normalizeSavedSelectors,
  savedSelectorsFingerprint,
} from "../../../src/domain/publication";
import type { ConfigSnapshot } from "../../../src/storage/config";

function config(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    version: 2,
    environmentKey: "stage.example.com",
    siteId: 42,
    baseUrl: "https://example.com",
    propertyRevision: 4,
    feedRevision: 2,
    membershipFingerprint: "membership",
    assignmentFingerprint: "assignment",
    renderMode: "rendered",
    renderModeUpdatedAt: "2026-08-17T10:00:00Z",
    selectors: { exclusionSelectors: ["header"], inclusionSelectors: ["main"] },
    selectorsUpdatedAt: "2026-08-17T10:00:00Z",
    submittedSelectorsFingerprint: "",
    pages: {},
    reconciliation: { revision: 2, feedFingerprint: "feed", removedPageKeys: [], relabelledPages: [] },
    ...overrides,
  };
}

const authority = {
  environmentKey: "stage.example.com",
  siteId: 42,
  propertyRevision: 4,
  feedRevision: 2,
};

describe("Hub publication preflight", () => {
  it("normalizes and hashes the canonical saved-selector fixture exactly", async () => {
    const selectors = {
      exclusionSelectors: [" footer ", "header", "footer", ""],
      inclusionSelectors: ["main", " main "],
    };

    expect(normalizeSavedSelectors(selectors)).toEqual({
      exclusionSelectors: ["footer", "header"],
      inclusionSelectors: ["main"],
    });
    await expect(savedSelectorsFingerprint(selectors)).resolves.toBe(
      "2c3af722ce277a71d3242dcf650683d9298863820dd71ab92e381c2a0a466035",
    );
  });

  it("requires one saved candidate per non-empty type and rejects an empty-only feed", () => {
    const common = { contextStatus: "managed_candidate" as const, config: config(), authority };

    expect(evaluatePublicationChecklist({
      ...common,
      todo: { covered: 0, actionable: 0, pageTypes: [] },
    })).toEqual({ status: "no_actionable_page_types" });
    expect(evaluatePublicationChecklist({
      ...common,
      todo: {
        covered: 1,
        actionable: 2,
        pageTypes: [
          { pageType: "article", markedCount: 1, current: false, candidates: [{ pageKey: "/a", wordsCount: 1, marked: true, current: false }] },
          { pageType: "detail", markedCount: 0, current: true, candidates: [{ pageKey: "/d", wordsCount: 1, marked: false, current: true }] },
        ],
      },
    })).toEqual({ status: "missing_page_types", pageTypes: ["detail"] });
  });

  it("fails closed on stale authority and accepts a complete authoritative checklist", () => {
    const todo = {
      covered: 1,
      actionable: 1,
      pageTypes: [{
        pageType: "article",
        markedCount: 3,
        current: true,
        candidates: [{ pageKey: "/a", wordsCount: 1, marked: true, current: true }],
      }],
    };

    expect(evaluatePublicationChecklist({
      contextStatus: "managed_candidate",
      todo,
      config: config(),
      authority: { ...authority, propertyRevision: 3 },
    })).toEqual({ status: "revision_mismatch" });
    expect(evaluatePublicationChecklist({
      contextStatus: "managed_candidate",
      todo,
      config: config(),
      authority,
    })).toEqual({ status: "ready" });
  });
});
