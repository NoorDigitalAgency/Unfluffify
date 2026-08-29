import { describe, expect, it, vi } from "vitest";

import { runPreviewExitAttempts } from "../../../src/popup/preview-exit";

describe("runPreviewExitAttempts", () => {
  it("replays one operator occurrence until content confirms restoration", async () => {
    let terminal = false;
    const attempt = vi.fn(async (attemptNumber: number) => {
      terminal = attemptNumber === 2;
      return terminal;
    });

    await expect(runPreviewExitAttempts({
      attempt,
      isTerminal: () => terminal,
      isCurrent: () => true,
      maxAttempts: 3,
    })).resolves.toEqual({ exited: true, attempts: 2, error: null });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("coalesces terminal observation after a lost acknowledgement", async () => {
    let terminal = false;
    const result = await runPreviewExitAttempts({
      attempt: async () => {
        terminal = true;
        return false;
      },
      isTerminal: () => terminal,
      isCurrent: () => true,
    });

    expect(result).toEqual({ exited: true, attempts: 1, error: null });
  });

  it("stops without replaying into a retired binding occurrence", async () => {
    const attempt = vi.fn(async () => false);
    const result = await runPreviewExitAttempts({
      attempt,
      isTerminal: () => false,
      isCurrent: () => false,
    });

    expect(result).toEqual({ exited: false, attempts: 0, error: null });
    expect(attempt).not.toHaveBeenCalled();
  });
});
