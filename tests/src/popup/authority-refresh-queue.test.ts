import { describe, expect, it, vi } from "vitest";

import { createAuthorityRefreshQueue } from "../../../src/popup/authority-refresh-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("popup authority refresh queue", () => {
  it("enforces cadence while allowing one explicit forced generation", async () => {
    let now = 1_000;
    const run = vi.fn(async () => undefined);
    const queue = createAuthorityRefreshQueue({
      intervalMs: 15_000,
      isPaused: () => false,
      now: () => now,
      run,
    });

    await queue.queue();
    now += 5_000;
    await queue.queue();
    await queue.queue(true);

    expect(run.mock.calls).toEqual([[false], [true]]);
  });

  it("coalesces overlap into one trailing run and retains its force bit", async () => {
    let now = 1_000;
    const first = deferred();
    const calls: boolean[] = [];
    const queue = createAuthorityRefreshQueue({
      intervalMs: 15_000,
      isPaused: () => false,
      now: () => now,
      run: async (force) => {
        calls.push(force);
        if (calls.length === 1) {
          await first.promise;
        }
      },
    });

    const current = queue.queue();
    now += 15_000;
    void queue.queue();
    void queue.queue(true);
    first.resolve();
    await current;

    expect(calls).toEqual([false, true]);
  });

  it("retains a forced refresh while polling is paused", async () => {
    let paused = true;
    const run = vi.fn(async () => undefined);
    const queue = createAuthorityRefreshQueue({
      intervalMs: 15_000,
      isPaused: () => paused,
      run,
    });

    await queue.queue(true);
    expect(queue.hasQueued()).toBe(true);
    expect(run).not.toHaveBeenCalled();

    paused = false;
    await queue.queue();
    expect(run).toHaveBeenCalledWith(true);
  });
});
