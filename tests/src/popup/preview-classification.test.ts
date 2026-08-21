import { describe, expect, it } from "vitest";

import {
  projectPreviewClassification,
  projectPreviewRow,
} from "../../../src/popup/preview-classification";

describe("preview classification projection", () => {
  it("collapses the exact six-way model to the public included/excluded distinction", () => {
    expect(projectPreviewClassification("explicit-included")).toBe("included");
    expect(projectPreviewClassification("implicit-included")).toBe("included");
    for (const classification of ["excluded", "undetected", "immutable", "closed-shadow"] as const) {
      expect(projectPreviewClassification(classification)).toBe("excluded");
    }
  });

  it("keeps the expanded model in debug and collapses production to included/excluded", () => {
    const row = {
      id: "stable-row",
      classification: "explicit-included" as const,
      text: "Readable copy",
      xpath: "/html[1]/body[1]/main[1]/p[1]",
      selector: "main > p",
      shadow: "force-open-closed" as const,
    };

    expect(projectPreviewRow(row, false)).toEqual({
      id: "stable-row",
      text: "Readable copy",
      classification: "included",
      debugDetail: null,
    });
    expect(projectPreviewRow(row, true)).toEqual({
      id: "stable-row",
      text: "Readable copy",
      classification: "included",
      debugDetail: {
        classification: "explicit-included",
        xpath: "/html[1]/body[1]/main[1]/p[1]",
        selector: "main > p",
        shadow: "force-open-closed",
      },
    });
  });
});
