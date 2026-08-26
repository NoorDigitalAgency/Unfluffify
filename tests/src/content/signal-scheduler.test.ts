import { describe, expect, it, vi } from "vitest";

import { createSignalScheduler } from "../../../src/content/signal-scheduler";

describe("content signal scheduler", () => {
  it("coalesces an event storm into one trailing pull", async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const run = vi.fn()
      .mockImplementationOnce(async () => await first)
      .mockResolvedValue(undefined);
    const scheduler = createSignalScheduler(run);

    const active = scheduler.request();
    const arrivals = Array.from({ length: 100 }, () => scheduler.request());
    expect(run).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([active, ...arrivals]);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drains an active pull and its one trailing request", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn()
      .mockImplementationOnce(async () => await blocked)
      .mockResolvedValue(undefined);
    const scheduler = createSignalScheduler(run);

    void scheduler.request();
    const drained = scheduler.drain();
    release();
    await drained;

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not launch trailing work after disposal", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(async () => await blocked);
    const scheduler = createSignalScheduler(run);

    const active = scheduler.request();
    void scheduler.request();
    scheduler.dispose();
    release();
    await active;

    expect(run).toHaveBeenCalledOnce();
    await scheduler.request();
    expect(run).toHaveBeenCalledOnce();
  });
});
