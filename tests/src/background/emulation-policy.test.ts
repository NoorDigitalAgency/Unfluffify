import { describe, expect, it } from "vitest";

import { managedEmulationDecision } from "../../../src/background/emulation-policy";

describe("managed tab emulation policy", () => {
  it("establishes the fixed crawler posture once and leaves held authority untouched", () => {
    expect(managedEmulationDecision({ recognized: true, heldMode: null })).toEqual({
      mode: "mobile",
      scale: 1,
      allowReload: true,
    });
    expect(managedEmulationDecision({ recognized: true, heldMode: "mobile" })).toBeNull();
  });

  it("preserves only the held silent desktop-preview exception", () => {
    expect(managedEmulationDecision({ recognized: true, heldMode: "desktop" })).toBeNull();
    expect(managedEmulationDecision({ recognized: false, heldMode: null })).toBeNull();
  });
});
