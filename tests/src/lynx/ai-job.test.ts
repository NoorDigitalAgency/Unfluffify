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

    expect(result).toEqual({
      status: "timeout",
      polls: 3,
      failureStage: "timeout",
      reason: "deadline_exceeded",
    });
    expect(sleeps).toEqual([5_000, 5_000, 2_000]);
    expect(now).toBe(12_000);
    expect(locked).toBe(false);
  });

  it.each([
    {
      label: "missing status",
      getStatus: async () => ({ status: "not_found" as const, httpStatus: 404 }),
      getResult: async () => ({ status: "ok" as const, selectors: {} }),
      expected: { status: "not_found", failureStage: "status", reason: "status_not_found", httpStatus: 404 },
    },
    {
      label: "backend status error",
      getStatus: async () => ({ status: "ok" as const, runStatus: "error" }),
      getResult: async () => ({ status: "ok" as const, selectors: {} }),
      expected: { status: "error", failureStage: "status", reason: "backend_run_error" },
    },
    {
      label: "missing result",
      getStatus: async () => ({ status: "ok" as const, runStatus: "done" }),
      getResult: async () => ({ status: "not_found" as const, httpStatus: 404 }),
      expected: { status: "not_found", failureStage: "result", reason: "result_not_found", httpStatus: 404 },
    },
    {
      label: "invalid result",
      getStatus: async () => ({ status: "ok" as const, runStatus: "done" }),
      getResult: async () => ({ status: "invalid" as const, httpStatus: 200 }),
      expected: { status: "error", failureStage: "result", reason: "result_invalid", httpStatus: 200 },
    },
    {
      label: "status transport",
      getStatus: async (): Promise<never> => { throw new Error("secret transport detail"); },
      getResult: async () => ({ status: "ok" as const, selectors: {} }),
      expected: { status: "error", failureStage: "transport", reason: "status_transport_error" },
    },
  ])("retains a sanitized stage and reason for $label", async ({ getStatus, getResult, expected }) => {
    const result = await pollAiJob("session-failure", {
      now: () => 0,
      sleep: async () => undefined,
      getStatus,
      getResult,
      heartbeat: () => undefined,
      acquireComputeLock: async () => () => undefined,
    }, { timeoutMs: 10 });

    expect(result).toMatchObject({ ...expected, polls: 1 });
    expect(JSON.stringify(result)).not.toContain("secret transport detail");
  });
});
