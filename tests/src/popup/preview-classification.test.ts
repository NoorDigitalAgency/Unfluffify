import { describe, expect, it } from "vitest";

import { projectPreviewClassification } from "../../../src/popup/preview-classification";

describe("preview classification projection", () => {
  it("keeps the expanded model in debug and collapses production to included/excluded", () => {
    expect(projectPreviewClassification("included", false)).toBe("included");
    expect(projectPreviewClassification("excluded", false)).toBe("excluded");
    expect(projectPreviewClassification("immutable", false)).toBe("excluded");
    expect(projectPreviewClassification("closed-shadow", false)).toBe("excluded");

    expect(projectPreviewClassification("immutable", true)).toBe("immutable");
    expect(projectPreviewClassification("closed-shadow", true)).toBe("closed-shadow");
  });
});
