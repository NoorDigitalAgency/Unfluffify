import { describe, expect, it } from "vitest";

import {
  normalizedDocumentPageUrl,
  sameDocumentPageUrl,
} from "../../../src/content/page-url";

describe("document page URL identity", () => {
  it("ignores fragments while retaining origin, path, and query", () => {
    expect(normalizedDocumentPageUrl("https://example.com/a?q=1#first"))
      .toBe("https://example.com/a?q=1");
    expect(sameDocumentPageUrl(
      "https://example.com/a?q=1#first",
      "https://example.com/a?q=1#second",
    )).toBe(true);
    expect(sameDocumentPageUrl(
      "https://example.com/a?q=1",
      "https://example.com/a?q=2",
    )).toBe(false);
    expect(sameDocumentPageUrl(
      "https://example.com/a?q=1",
      "https://example.com/b?q=1",
    )).toBe(false);
    expect(sameDocumentPageUrl(
      "https://example.com/a?q=1",
      "https://other.example/a?q=1",
    )).toBe(false);
  });

  it("normalizes relative fragments against the compared document", () => {
    expect(sameDocumentPageUrl("#details", "https://example.com/a?q=1#top")).toBe(true);
  });
});
