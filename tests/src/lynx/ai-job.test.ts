import { describe, expect, it } from "vitest";

import {
  completeAiJob,
  createAiJobState,
  deriveAiJobGates,
  markCssSelectorOnlyEdit,
  markMarkingEdit,
  startAiJob,
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
});
