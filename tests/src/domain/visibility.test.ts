import { describe, expect, it } from "vitest";

import { isUserVisible, type VisibilityGeometry } from "../../../src/domain/visibility";

const visible: VisibilityGeometry = {
  rect: { left: 0, top: 0, width: 100, height: 20 },
  pageHeight: 3_000,
  viewportWidth: 412,
};

describe("P0 visibility policy (INV-5.5..INV-5.8)", () => {
  it("counts page height but clips by mobile width", () => {
    expect(
      isUserVisible("below-fold", {
        ...visible,
        rect: { left: 0, top: 2_000, width: 100, height: 20 },
      }),
    ).toBe(true);
    expect(
      isUserVisible("out-of-mobile-width", {
        ...visible,
        rect: { left: 500, top: 0, width: 100, height: 20 },
      }),
    ).toBe(false);
  });

  it("treats downward CSS clamps with visible previews as visible", () => {
    expect(
      isUserVisible("clamped", {
        ...visible,
        rect: { left: 0, top: 0, width: 100, height: 24 },
        style: {
          overflowY: "hidden",
          clientHeight: 24,
          scrollHeight: 100,
          textContent: "visible preview",
        },
      }),
    ).toBe(true);
  });

  it("excludes clipped overflow without a visible text-clamp preview", () => {
    expect(
      isUserVisible("clipped-no-preview", {
        ...visible,
        rect: { left: 0, top: 0, width: 100, height: 24 },
        style: {
          overflowY: "hidden",
          clientHeight: 24,
          scrollHeight: 100,
          textContent: "",
        },
      }),
    ).toBe(false);
    expect(
      isUserVisible("overflow-hidden-no-clip", {
        ...visible,
        style: {
          overflowY: "hidden",
          clientHeight: 24,
          scrollHeight: 24,
          textContent: "fully visible",
        },
      }),
    ).toBe(true);
  });

  it("excludes genuine hidden modes and zero-area boxes", () => {
    expect(isUserVisible("display", { ...visible, style: { display: "none" } })).toBe(false);
    expect(isUserVisible("visibility", { ...visible, style: { visibility: "hidden" } })).toBe(
      false,
    );
    expect(isUserVisible("opacity", { ...visible, style: { opacity: 0 } })).toBe(false);
    expect(isUserVisible("hidden", { ...visible, style: { hidden: true } })).toBe(false);
    expect(isUserVisible("sr-only", { ...visible, style: { srOnly: true } })).toBe(false);
    expect(isUserVisible("gated", { ...visible, style: { interactionGated: true } })).toBe(false);
    expect(isUserVisible("zero", { ...visible, rect: { left: 0, top: 0, width: 0, height: 20 } }))
      .toBe(false);
  });
});
