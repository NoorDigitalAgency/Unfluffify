import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrainHeartbeat } from "../src/background/brain/heartbeat.js";
import { REALMS } from "../src/common/bus/realms.js";
import { SESSION_REQUEST_TYPES } from "../src/common/bus/contracts/session-state.js";

describe("createBrainHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("pulls popup + content state and folds facts on each tick while active", async () => {
    const folds: Array<{ tabId: number; source: string }> = [];
    const request = vi.fn(async (_type: string, _payload: unknown, opts: { target: string }) => ({
      source: opts.target === REALMS.POPUP ? "popup" : "content",
      facts: { aiBusy: true },
    }));
    const heartbeat = createBrainHeartbeat({
      request: request as never,
      foldFacts: (tabId, source) => folds.push({ tabId, source }),
      intervalMs: 1000,
    });

    heartbeat.start(7);
    expect(heartbeat.isRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(request).toHaveBeenCalledWith(
      SESSION_REQUEST_TYPES.STATE_GET,
      {},
      expect.objectContaining({ target: REALMS.POPUP, tab: 7 }),
    );
    expect(request).toHaveBeenCalledWith(
      SESSION_REQUEST_TYPES.STATE_GET,
      {},
      expect.objectContaining({ target: REALMS.CONTENT, tab: 7 }),
    );
    expect(folds).toEqual([
      { tabId: 7, source: "popup" },
      { tabId: 7, source: "content" },
    ]);
  });

  it("tolerates layer failures without folding", async () => {
    const folds: Array<string> = [];
    const heartbeat = createBrainHeartbeat({
      request: vi.fn(async () => {
        throw new Error("layer offline");
      }) as never,
      foldFacts: (_tabId, source) => folds.push(source),
      intervalMs: 1000,
    });

    heartbeat.start(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(folds).toEqual([]);
  });

  it("stops only when all tabs disconnect", () => {
    const heartbeat = createBrainHeartbeat({
      request: vi.fn(async () => ({ source: "popup", facts: {} })) as never,
      foldFacts: () => {},
    });
    heartbeat.start(1);
    heartbeat.start(2);
    heartbeat.stop(1);
    expect(heartbeat.isRunning()).toBe(true);
    heartbeat.stop(2);
    expect(heartbeat.isRunning()).toBe(false);
  });
});
