import { describe, expect, it, vi } from "vitest";

import { executeConfirmedCandidateNavigation } from "../../../src/popup/candidate-navigation";

describe("confirmed candidate navigation", () => {
  it("runs inspection, cleanup, same-tab navigation, and crawler restoration in order", async () => {
    const order: string[] = [];
    await expect(executeConfirmedCandidateNavigation({
      restoreNeeded: true,
      inspect: async () => {
        order.push("inspect");
        return { decision: "allow", dirty: "dirty" };
      },
      deactivate: async () => { order.push("deactivate"); return true; },
      navigate: async () => { order.push("navigate"); },
      reapplyMobile: async () => { order.push("mobile"); },
      restore: async () => { order.push("restore"); return true; },
    })).resolves.toEqual({ status: "navigated", warning: null });
    expect(order).toEqual(["inspect", "deactivate", "navigate", "mobile"]);
  });

  it("honors an explicit block without cleanup or navigation", async () => {
    const deactivate = vi.fn();
    const navigate = vi.fn();
    await expect(executeConfirmedCandidateNavigation({
      restoreNeeded: true,
      inspect: async () => ({ decision: "block", dirty: "dirty", reason: "bound tab changed" }),
      deactivate,
      navigate,
      reapplyMobile: vi.fn(),
      restore: vi.fn(),
    })).resolves.toEqual({ status: "blocked", reason: "bound tab changed" });
    expect(deactivate).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("fails open after bounded unknown inspection but retains a generic warning", async () => {
    vi.useFakeTimers();
    try {
      const result = executeConfirmedCandidateNavigation({
        timeoutMs: 25,
        restoreNeeded: false,
        inspect: () => new Promise(() => undefined),
        deactivate: async () => true,
        navigate: async () => undefined,
        reapplyMobile: async () => undefined,
        restore: async () => true,
      });
      await vi.advanceTimersByTimeAsync(25);
      await expect(result).resolves.toEqual({
        status: "navigated",
        warning: "Navigation state inspection timed out.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores a usable surface and never unregisters when navigation fails", async () => {
    const restore = vi.fn().mockResolvedValue(true);
    await expect(executeConfirmedCandidateNavigation({
      restoreNeeded: true,
      inspect: async () => ({ decision: "allow", dirty: "clean" }),
      deactivate: async () => true,
      navigate: async () => { throw new Error("tabs.update rejected"); },
      reapplyMobile: vi.fn(),
      restore,
    })).resolves.toEqual({
      status: "failed",
      reason: "tabs.update rejected",
      restored: true,
    });
    expect(restore).toHaveBeenCalledOnce();
  });
});
