import { describe, expect, it, vi } from "vitest";

import { watchRenderModeInspection } from "../../../src/popup/render-mode-inspection";

describe("render-mode inspection watchdog", () => {
  it("settles normally and clears its watchdog", async () => {
    vi.useFakeTimers();
    try {
      await expect(watchRenderModeInspection(async () => "ok", 50))
        .resolves.toEqual({ status: "settled", value: "ok" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a stalled UI for retry and leaves no stale timer", async () => {
    vi.useFakeTimers();
    try {
      const result = watchRenderModeInspection(() => new Promise(() => undefined), 50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(result).resolves.toEqual({ status: "timeout" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
