import { describe, expect, it } from "vitest";

import {
  projectPreviewClassification,
  projectPreviewRow,
} from "../../../src/popup/preview-classification";

describe("preview classification projection", () => {
  it("collapses the exact six-way model to the public included/excluded distinction", () => {
    expect(projectPreviewClassification("explicit-included")).toBe("included");
    expect(projectPreviewClassification("implicit-included")).toBe("included");
    expect(projectPreviewClassification("undetected")).toBe("included");
    for (const classification of ["excluded", "immutable", "closed-shadow"] as const) {
      expect(projectPreviewClassification(classification)).toBe("excluded");
    }
  });

  it("presents submitted default content as included even without selector coverage", () => {
    const row = {
      id: "default-content-row",
      classification: "undetected" as const,
      text: "Default extracted content",
      xpath: "/html[1]/body[1]/main[1]/p[1]",
      shadow: "none" as const,
    };

    expect(projectPreviewRow(row, false)).toEqual({
      id: "default-content-row",
      text: "Default extracted content",
      classification: "included",
      debugDetail: null,
    });
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

  it("replaces raw technical source in production while retaining it in debug", () => {
    const rows = [
      ["script", "Script or embedded code"],
      ["style", "Style rules"],
      ["noscript", "No-script fallback content"],
    ] as const;

    for (const [tagName, label] of rows) {
      const row = {
        id: `${tagName}-row`,
        classification: "excluded" as const,
        text: `raw ${tagName} source { do-not-render: true; }`,
        xpath: `/html[1]/body[1]/${tagName}[1]`,
        shadow: "none" as const,
      };
      expect(projectPreviewRow(row, false).text).toBe(label);
      expect(projectPreviewRow(row, true).text).toBe(row.text);
    }
  });
});
