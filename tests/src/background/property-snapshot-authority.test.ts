import { describe, expect, it } from "vitest";

import {
  PropertySnapshotIntegrityError,
  adoptAuthoritativeSnapshot,
  assessAuthoritativeSnapshot,
  overlayLivePageOnAuthoritativeCorpus,
} from "../../../src/storage/property-snapshot-authority";
import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "../../../src/domain/constants";
import type { ConfigSnapshot } from "../../../src/storage/config";

function snapshot(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    version: 2,
    environmentKey: "a.example.com",
    siteId: 42,
    baseUrl: "https://www.example.com",
    propertyRevision: 4,
    feedRevision: 2,
    membershipFingerprint: "membership-2",
    assignmentFingerprint: "assignment-2",
    renderMode: "rendered",
    renderModeUpdatedAt: "2026-08-17T10:00:00Z",
    selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    selectorsUpdatedAt: "2026-08-17T10:00:00Z",
    submittedSelectorsFingerprint: "selectors",
    pages: {
      "/a": {
        timestamp: "2026-08-17T09:00:00Z",
        pageType: "detail",
        renderedHtml: "<html>a</html>",
        rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      },
      "/b?view=full": {
        timestamp: "2026-08-17T09:30:00Z",
        pageType: "detail",
        renderedHtml: "<html>old-b</html>",
        rows: [{ xpath: "/html[1]/body[1]/main[2]", excluded: false }],
      },
    },
    reconciliation: {
      revision: 2,
      feedFingerprint: "feed-2",
      removedPageKeys: [],
      relabelledPages: [],
    },
    ...overrides,
  };
}

describe("authoritative property snapshot adoption", () => {
  it("adopts a complete Load response without dropping untouched pages", () => {
    const previous = snapshot();
    const response = snapshot({
      propertyRevision: 5,
      pages: {
        ...previous.pages,
        "/b?view=full": {
          ...previous.pages["/b?view=full"],
          renderedHtml: "<html>new-b</html>",
        },
      },
    });

    const adopted = adoptAuthoritativeSnapshot(previous, response);

    expect(Object.keys(adopted.pages)).toEqual(["/a", "/b?view=full"]);
    expect(adopted.pages["/a"].renderedHtml).toBe("<html>a</html>");
    expect(adopted.pages["/b?view=full"].renderedHtml).toBe("<html>new-b</html>");
  });

  it("rejects a valid snapshot returned for a different requested scope", () => {
    expect(() => adoptAuthoritativeSnapshot(null, snapshot(), {
      environmentKey: "b.example.com",
      siteId: 42,
    })).toThrow(PropertySnapshotIntegrityError);
  });

  it("adopts unexplained shrink while returning a write-blocking integrity warning", () => {
    const previous = snapshot();
    const response = snapshot({
      propertyRevision: 5,
      pages: { "/b?view=full": previous.pages["/b?view=full"] },
    });

    expect(assessAuthoritativeSnapshot(previous, response)).toEqual({
      snapshot: response,
      integrityWarning: {
        code: "integrity_shrink",
        removedPageKeys: ["/a"],
        message: "Authoritative response removed /a without exact reconciliation proof.",
      },
    });
    expect(adoptAuthoritativeSnapshot(previous, response)).toEqual(response);
  });

  it("accepts shrink only with exact, newer reconciliation proof", () => {
    const previous = snapshot();
    const response = snapshot({
      propertyRevision: 5,
      feedRevision: 3,
      pages: { "/b?view=full": previous.pages["/b?view=full"] },
      reconciliation: {
        revision: 3,
        feedFingerprint: "feed-3",
        removedPageKeys: ["/a"],
        relabelledPages: [],
      },
    });

    expect(assessAuthoritativeSnapshot(previous, response)).toEqual({
      snapshot: response,
      integrityWarning: null,
    });
  });
});

describe("AI corpus authority", () => {
  it("retains the full stored corpus and overlays the live current page", () => {
    const corpus = overlayLivePageOnAuthoritativeCorpus(snapshot(), {
      baseUrl: "https://www.example.com",
      renderMode: "rendered",
      defaultExclusionSelectors: [...DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS],
      pages: [{
        url: "https://example.com/b?view=full",
        renderedHtml: "<html>live-b</html>",
        renderedXPaths: [{ xpath: "/html[1]/body[1]/article[1]", excluded: false }],
      }],
    });

    expect(corpus.pages.map((page) => page.url)).toEqual([
      "https://www.example.com/a",
      "https://example.com/b?view=full",
    ]);
    expect(corpus.pages[1].renderedHtml).toBe("<html>live-b</html>");
  });
});
