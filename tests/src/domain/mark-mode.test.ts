import { describe, expect, it } from "vitest";

import {
  deriveMarkMode,
  resetHeldModifierLatches,
  type MarkModeInput,
} from "../../../src/domain/mark-mode";

describe("P0 deriveMarkMode (INV-3.1..INV-3.4)", () => {
  const base: MarkModeInput = {
    enabled: true,
    hasOverlay: true,
    temporarilyDisabled: false,
    passThrough: false,
    altActive: false,
  };

  it("applies disabled > passthrough > include > exclude precedence", () => {
    expect(deriveMarkMode({ ...base, enabled: false, passThrough: true, altActive: true })).toBe(
      "disabled",
    );
    expect(deriveMarkMode({ ...base, hasOverlay: false, passThrough: true, altActive: true })).toBe(
      "disabled",
    );
    expect(
      deriveMarkMode({ ...base, temporarilyDisabled: true, passThrough: true, altActive: true }),
    ).toBe("disabled");
    expect(deriveMarkMode({ ...base, passThrough: true, altActive: true })).toBe("passthrough");
    expect(deriveMarkMode({ ...base, altActive: true })).toBe("include");
    expect(deriveMarkMode(base)).toBe("exclude");
  });

  it("covers the full boolean truth table with a single authority", () => {
    for (const enabled of [false, true]) {
      for (const hasOverlay of [false, true]) {
        for (const temporarilyDisabled of [false, true]) {
          for (const passThrough of [false, true]) {
            for (const altActive of [false, true]) {
              const mode = deriveMarkMode({
                enabled,
                hasOverlay,
                temporarilyDisabled,
                passThrough,
                altActive,
              });
              if (!enabled || !hasOverlay || temporarilyDisabled) {
                expect(mode).toBe("disabled");
              } else if (passThrough) {
                expect(mode).toBe("passthrough");
              } else if (altActive) {
                expect(mode).toBe("include");
              } else {
                expect(mode).toBe("exclude");
              }
            }
          }
        }
      }
    }
  });

  it("resets held modifier latches on blur, visibility change, and navigation", () => {
    expect(resetHeldModifierLatches()).toEqual({
      altActive: false,
      shiftActive: false,
      passThrough: false,
    });
  });
});
