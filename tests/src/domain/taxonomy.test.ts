import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TAG_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS,
} from "../../../src/domain/constants";
import {
  isDefaultExcluded,
  isImmutableTag,
  isToggleableDefaultTag,
} from "../../../src/domain/taxonomy";

describe("P0 taxonomy (INV-2.1..INV-2.4)", () => {
  it("classifies immutable tags case-insensitively", () => {
    expect(DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS).toEqual([
      "IMG",
      "INPUT",
      "NOSCRIPT",
      "SELECT",
      "TITLE",
      "STYLE",
      "SCRIPT",
      "TEMPLATE",
      "IFRAME",
      "VIDEO",
      "SVG",
    ]);
    for (const tag of DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS) {
      expect(isImmutableTag(tag)).toBe(true);
      expect(isImmutableTag(tag.toLowerCase())).toBe(true);
    }
  });

  it("classifies toggleable defaults case-insensitively", () => {
    expect(DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS).toEqual([
      "FOOTER",
      "FORM",
      "LABEL",
      "NAV",
      "HEADER",
      "DIALOG",
      "ASIDE",
      "BUTTON",
    ]);
    for (const tag of DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS) {
      expect(isToggleableDefaultTag(tag)).toBe(true);
      expect(isToggleableDefaultTag(tag.toLowerCase())).toBe(true);
    }
  });

  it("keeps LINK outside every taxonomy and immutable as all-default minus toggleable", () => {
    expect(isImmutableTag("LINK")).toBe(false);
    expect(isToggleableDefaultTag("LINK")).toBe(false);
    expect(isDefaultExcluded("LINK")).toBe(false);

    const toggleable = new Set(DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS);
    expect(DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS).toEqual(
      DEFAULT_EXCLUDED_TAG_SELECTORS.filter((tag) => !toggleable.has(tag)),
    );
  });
});
