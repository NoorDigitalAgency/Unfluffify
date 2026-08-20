import { describe, expect, it, vi } from "vitest";

import {
  actionIconStateForContext,
  createActionIconController,
} from "../../../src/background/action-icon";

describe("action icon controller", () => {
  it("projects the five approved states and deduplicates unchanged updates", async () => {
    const setIcon = vi.fn();
    const setBadgeText = vi.fn();
    const setBadgeBackgroundColor = vi.fn();
    const setTitle = vi.fn();
    const controller = createActionIconController({
      setIcon,
      setBadgeText,
      setBadgeBackgroundColor,
      setTitle,
    });

    for (const state of ["unregistered", "connecting", "active", "locked", "attention"] as const) {
      await controller.apply(17, state);
      expect(controller.state(17)).toBe(state);
    }
    await controller.apply(17, "attention");

    expect(setIcon).toHaveBeenCalledTimes(5);
    expect(setBadgeText.mock.calls.map(([details]) => details.text)).toEqual(["", "…", "", "L", "!"]);
    expect(setBadgeBackgroundColor).toHaveBeenCalledTimes(5);
    expect(setTitle.mock.calls.map(([details]) => details.title)).toEqual([
      expect.stringContaining("not registered"),
      expect.stringContaining("connecting"),
      expect.stringContaining("active"),
      expect.stringContaining("locked"),
      expect.stringContaining("attention"),
    ]);
  });

  it("maps managed contexts to active and unresolved failures to attention", () => {
    expect(actionIconStateForContext("managed_candidate")).toBe("active");
    expect(actionIconStateForContext("managed_non_candidate")).toBe("active");
    expect(actionIconStateForContext("environment_not_registered")).toBe("unregistered");
    expect(actionIconStateForContext("authentication_required")).toBe("attention");
  });
});
