import { describe, expect, it } from "vitest";

import {
  completeAiJob,
  createAiJobState,
  deriveAiJobGates,
  markCssSelectorOnlyEdit,
  markMarkingEdit,
  startAiJob,
  pollAiJob,
} from "../../../src/lynx/ai-job";

describe("P4 AI-job gate FSM", () => {
  it("transitions idle -> running -> fresh and stale-on-edit", () => {
    const running = startAiJob(createAiJobState());
    const fresh = completeAiJob(running, "marks-v1");
    const stale = markMarkingEdit(fresh, "marks-v2");

    expect(running.phase).toBe("running");
    expect(deriveAiJobGates(fresh)).toMatchObject({
      aiRunUpToDate: true,
      sessionRequiresAiRun: false,
      saveEnabled: true,
    });
    expect(stale.phase).toBe("stale-on-edit");
    expect(deriveAiJobGates(stale)).toMatchObject({
      aiRunUpToDate: false,
      sessionRequiresAiRun: true,
      saveEnabled: false,
    });
  });

  it("css-selector-only-edit-two-gates keeps Run AI disabled but blocks Save", () => {
    const fresh = completeAiJob(startAiJob(createAiJobState()), "marks-v1");
    const cssEdited = markCssSelectorOnlyEdit(fresh);

    expect(deriveAiJobGates(cssEdited)).toEqual({
      aiRunUpToDate: true,
      sessionRequiresAiRun: true,
      runAiDisabled: true,
      saveEnabled: false,
    });
  });

  it("polls first, heartbeats every iteration, and releases compute lock", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const heartbeats: unknown[] = [];
    let locked = false;
    const result = await pollAiJob("session-1", {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      getStatus: async () => sleeps.length === 0 ? { status: "ok", runStatus: "running" } : { status: "ok", runStatus: "done" },
      getResult: async () => ({ status: "ok", selectors: { exclusionSelectors: [], inclusionSelectors: [] } }),
      heartbeat: (state) => heartbeats.push(state),
      acquireComputeLock: async () => {
        locked = true;
        return () => { locked = false; };
      },
    }, { timeoutMs: 480_000, pollIntervalMs: 5_000 });

    expect(result).toEqual({ status: "fresh", selectors: { exclusionSelectors: [], inclusionSelectors: [] }, polls: 2 });
    expect(sleeps).toEqual([5_000]);
    expect(heartbeats).toHaveLength(2);
    expect(locked).toBe(false);
  });

  it("times out without sleeping past the deadline", async () => {
    let now = 0;
    const sleeps: number[] = [];
    let locked = false;
    const result = await pollAiJob("session-1", {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      getStatus: async () => ({ status: "ok", runStatus: "running" }),
      getResult: async () => ({ status: "error" }),
      heartbeat: () => undefined,
      acquireComputeLock: async () => {
        locked = true;
        return () => { locked = false; };
      },
    }, { timeoutMs: 12_000, pollIntervalMs: 5_000 });

    expect(result).toEqual({ status: "timeout", polls: 3 });
    expect(sleeps).toEqual([5_000, 5_000, 2_000]);
    expect(now).toBe(12_000);
    expect(locked).toBe(false);
  });
});
