import { describe, expect, it } from "vitest";

import { createRewriteBrain } from "../../src/background/index";
import { createContentOrgan } from "../../src/content/runtime";
import { createPopupStore } from "../../src/popup/store";
import { completeAiJob, createAiJobState, deriveAiJobGates, markMarkingEdit, startAiJob } from "../../src/lynx";
import { adoptLockIdentity, mirrorBackendTimings } from "../../src/lock";

describe("P10 rewrite integration lifecycle", () => {
  it("runs activate -> edit -> run AI -> save signal flow across brain/content/popup", () => {
    const brain = createRewriteBrain(1);
    const content = createContentOrgan();
    const popup = createPopupStore();

    const activationSignals = brain.observe({
      tabId: 1,
      source: "popup",
      reason: "activate",
      facts: {
        tabId: 1,
        baseUrl: "https://example.com",
        pageUrl: "https://example.com/page",
        markingEnabled: true,
        lockRole: "editor",
        configPresent: true,
      },
    });
    activationSignals.forEach((signal) => {
      content.transition(signal);
      popup.dispatch(signal);
    });

    let aiJob = createAiJobState();
    aiJob = markMarkingEdit(aiJob, "marks-v1");
    expect(deriveAiJobGates(aiJob).sessionRequiresAiRun).toBe(true);
    aiJob = startAiJob(aiJob);
    aiJob = completeAiJob(aiJob, "marks-v1");
    expect(deriveAiJobGates(aiJob).saveEnabled).toBe(true);

    const saveSignals = brain.observe({
      tabId: 1,
      source: "background",
      reason: "save",
      facts: {
        tabId: 1,
        markingEnabled: false,
      },
    });
    saveSignals.forEach((signal) => {
      content.transition(signal);
      popup.dispatch(signal);
    });

    expect(content.state().name).toBe("silent");
    expect(popup.getState().name).toBe("silent");
  });

  it("keeps lock identity backend-issued and timer display backend-authoritative", () => {
    const first = adoptLockIdentity(null, {
      tabId: 1,
      siteId: 123,
      identity: "backend-identity-1",
      updatedAt: 1,
    });
    const second = adoptLockIdentity(first.current, {
      tabId: 1,
      siteId: 123,
      identity: "backend-identity-2",
      updatedAt: 2,
    });

    expect(second.previousInvalidated).toBe(true);
    expect(mirrorBackendTimings({ expiresAtUtc: "2026-07-07T00:00:00Z", secondsRemaining: 60 }))
      .toEqual({ expiresAtUtc: "2026-07-07T00:00:00Z", secondsRemaining: 60 });
  });
});
