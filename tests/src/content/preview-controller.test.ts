import { describe, expect, it, vi } from "vitest";

import {
  createPreviewController,
  type PreviewProjectionEngine,
} from "../../../src/content/preview-controller";

const projection = {
  projectionId: "preview-1",
  revision: 1,
  pageUrl: "https://example.com/page",
  rows: [{
    id: "row-1",
    classification: "explicit-included" as const,
    text: "Readable content",
    xpath: "/html[1]/body[1]/main[1]",
    selector: "main",
    shadow: "light" as const,
  }],
};

function engine() {
  return {
    projectPreview: vi.fn(() => projection),
    retirePreviewProjection: vi.fn(),
    emphasizePreviewRow: vi.fn((projectionId: string, rowId: string) =>
      projectionId === projection.projectionId && rowId === "row-1"
    ),
    activatePreviewRow: vi.fn((projectionId: string, rowId: string) =>
      projectionId === projection.projectionId && rowId === "row-1"
    ),
  } satisfies PreviewProjectionEngine;
}

describe("preview content controller", () => {
  it("projects the caller's exact selectors and fences the active page", () => {
    const target = engine();
    const controller = createPreviewController({
      currentPageUrl: () => projection.pageUrl,
      currentEngine: () => target,
      ensureEngine: () => target,
      interactionActive: () => true,
    });
    const selectors = { inclusionSelectors: ["main"], exclusionSelectors: ["nav"] };

    expect(controller.project({ pageUrl: projection.pageUrl, selectors })).toEqual(projection);
    expect(target.projectPreview).toHaveBeenCalledWith(projection.pageUrl, selectors);
    controller.retireProjection();
    expect(target.retirePreviewProjection).toHaveBeenCalledTimes(1);
    expect(() => controller.project({ pageUrl: "https://example.com/other", selectors }))
      .toThrow("Preview pageUrl does not match");
  });

  it("delegates opaque projection/row fences and gates active interactions", () => {
    const target = engine();
    let active = true;
    const controller = createPreviewController({
      currentPageUrl: () => projection.pageUrl,
      currentEngine: () => target,
      ensureEngine: () => target,
      interactionActive: () => active,
    });
    const base = { pageUrl: projection.pageUrl, projectionId: projection.projectionId, rowId: "row-1" };

    expect(controller.emphasize({ ...base, active: true })).toEqual({ targeted: true });
    expect(controller.activate(base)).toEqual({ targeted: true });
    expect(controller.activate({ ...base, projectionId: "stale" })).toEqual({ targeted: false });

    active = false;
    expect(controller.activate(base)).toEqual({ targeted: false });
    expect(controller.emphasize({ ...base, active: true })).toEqual({ targeted: false });
    // Pointer leave remains a safe cleanup after the preview-state edge closes.
    expect(controller.emphasize({ ...base, active: false })).toEqual({ targeted: true });
    expect(controller.activate({ ...base, pageUrl: "https://example.com/other" })).toEqual({ targeted: false });
  });
});
