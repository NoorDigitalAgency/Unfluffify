import { describe, expect, it } from "vitest";

import {
  isRovingFocusKey,
  resolveRovingFocusIndex,
} from "../../../src/ui/roving-focus";

describe("roving focus contract", () => {
  it("recognizes only the supported directional and edge keys", () => {
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(isRovingFocusKey(key)).toBe(true);
    }
    for (const key of ["Escape", "Enter", " ", "Tab"]) {
      expect(isRovingFocusKey(key)).toBe(false);
    }
  });

  it("wraps arrows and skips unavailable items", () => {
    const enabled = [true, false, true, true];
    expect(resolveRovingFocusIndex("ArrowDown", 0, enabled)).toBe(2);
    expect(resolveRovingFocusIndex("ArrowUp", 0, enabled)).toBe(3);
    expect(resolveRovingFocusIndex("ArrowDown", 3, enabled)).toBe(0);
    expect(resolveRovingFocusIndex("ArrowUp", -1, enabled)).toBe(3);
    expect(resolveRovingFocusIndex("ArrowRight", 0, enabled)).toBe(2);
    expect(resolveRovingFocusIndex("ArrowLeft", 0, enabled)).toBe(3);
  });

  it("moves Home and End to enabled edges and handles an unavailable list", () => {
    expect(resolveRovingFocusIndex("Home", 2, [false, true, true, false])).toBe(1);
    expect(resolveRovingFocusIndex("End", 1, [false, true, true, false])).toBe(2);
    expect(resolveRovingFocusIndex("ArrowDown", 0, [false, false])).toBeNull();
  });
});
