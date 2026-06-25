import { describe, expect, it } from "vitest";

import { SPINNER_OPERATION_KINDS, SPINNER_OPERATION_PHASES, SPINNER_TIMER_MODES } from "../common/spinner-contract.js";
import { phaseToSpinnerState } from "../background/brain/spinner-authority.js";

describe("spinner authority", () => {
  it("maps countdown phases", () => {
    const state = phaseToSpinnerState(
      SPINNER_OPERATION_KINDS.AI_RUN,
      SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      { startedAt: 10, deadlineAt: 20 },
    );

    expect(state).toMatchObject({
      timerMode: SPINNER_TIMER_MODES.COUNTDOWN,
      title: "Waiting for AI results",
      deadlineAt: 20,
      startedAt: 10,
      maxDurationMs: 480_000,
    });
  });

  it("maps elapsed phases", () => {
    const state = phaseToSpinnerState(
      SPINNER_OPERATION_KINDS.REVEAL_FREEZE,
      SPINNER_OPERATION_PHASES.REVEAL_FREEZE.REVEALING_CONTENT,
      { startedAt: 30, deadlineAt: 0 },
    );

    expect(state).toMatchObject({
      timerMode: SPINNER_TIMER_MODES.ELAPSED,
      title: "Revealing lazy-loaded content",
      maxDurationMs: 120_000,
    });
  });

  it("maps none-timer phases", () => {
    const state = phaseToSpinnerState(
      SPINNER_OPERATION_KINDS.AI_RUN,
      SPINNER_OPERATION_PHASES.AI_RUN.PREPARING_PAGE,
      { startedAt: 40, deadlineAt: 0 },
    );

    expect(state).toMatchObject({
      timerMode: SPINNER_TIMER_MODES.NONE,
      title: "Preparing page content for AI",
    });
  });

  it("prefers the live spinner message and carries popup metadata", () => {
    const state = phaseToSpinnerState(
      SPINNER_OPERATION_KINDS.AI_RUN,
      SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
      {
        startedAt: 50,
        deadlineAt: 70,
        operationId: "op-2",
        message: "Waiting on AI run",
        reason: "tab-run-ai-running",
        source: "background-spinner-broker",
        spinnerKey: "ai",
      },
    );

    expect(state).toMatchObject({
      message: "Waiting on AI run",
      operationId: "op-2",
      reason: "tab-run-ai-running",
      source: "background-spinner-broker",
      spinnerKey: "ai",
    });
  });
});
