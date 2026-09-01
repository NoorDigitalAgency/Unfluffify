import { describe, expect, it } from "vitest";

import {
  markingHoverNeedsLeadingPaint,
  type MarkingHoverIdentity,
} from "../../../../src/content/marking/hover-scheduling";

const targetA = {};
const targetB = {};
const identity = (
  overrides: Partial<MarkingHoverIdentity<object | null>> = {},
): MarkingHoverIdentity<object | null> => ({
  eventTarget: targetA,
  overlayXpath: "",
  altKey: false,
  ctrlKey: false,
  ...overrides,
});

describe("marking hover scheduling", () => {
  it("paints the first observation and newly entered target on the leading edge", () => {
    const current = identity();

    expect(markingHoverNeedsLeadingPaint(null, current)).toBe(true);
    expect(markingHoverNeedsLeadingPaint(current, identity({ eventTarget: targetB }))).toBe(true);
  });

  it("paints overlay-owner and modifier transitions on the leading edge", () => {
    const current = identity();

    expect(markingHoverNeedsLeadingPaint(current, identity({ overlayXpath: "/html/body/p" })))
      .toBe(true);
    expect(markingHoverNeedsLeadingPaint(current, identity({ altKey: true }))).toBe(true);
    expect(markingHoverNeedsLeadingPaint(current, identity({ ctrlKey: true }))).toBe(true);
  });

  it("keeps repeated movement inside one semantic boundary frame-coalescible", () => {
    const current = identity();

    expect(markingHoverNeedsLeadingPaint(current, identity())).toBe(false);
  });
});
