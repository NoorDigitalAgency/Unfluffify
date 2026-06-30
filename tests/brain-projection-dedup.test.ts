import { describe, expect, it } from "vitest";

import { createBrain } from "../src/background/brain/index.js";
import { POPUP_STATE_EVENT_TYPES } from "../src/common/bus/contracts/popup-state.js";
import { AI_RUN_PHASES, SESSION_REPORT_TYPES } from "../src/common/bus/contracts/session-state.js";
import { REALMS } from "../src/common/bus/realms.js";

const flush = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

const SILENT_FACTS = {
  baseUrlReady: true,
  siteIdReady: true,
  renderModeReady: true,
  isEnabled: false,
  silentModeActive: true,
  hasStoredSelectors: true,
  pageScopedUiDisabled: false,
  navigationInspectionPending: false,
  pageInspectionBusy: false,
  pageTypeUiBlocked: false,
  currentPageHasPendingChanges: false,
  sessionHasPendingChanges: false,
  currentDraftDirty: false,
  pageSaveReconciliationPending: false,
  pageSaveReconciliationReason: "",
  sessionRequiresAiRun: false,
  aiReady: true,
  aiBusy: false,
  aiComputing: false,
  saving: false,
  discarding: false,
  previewActive: false,
  previewBlocked: false,
  previewRestorePending: false,
  aiRunPhase: AI_RUN_PHASES.PRE_AI,
  aiRunUpToDate: false,
  lynxChecklistCanSend: true,
  lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
};

describe("brain projection dedup", () => {
  it("dedupes the popup VIEW_UPDATED but always re-broadcasts the content directive", async () => {
    const brain = createBrain({ logger: { error() {} } });
    let viewUpdates = 0;
    let directiveBroadcasts = 0;
    const originalPublish = brain.bus.publish.bind(brain.bus);
    brain.bus.publish = ((type: string, payload: unknown, options?: unknown) => {
      if (type === POPUP_STATE_EVENT_TYPES.VIEW_UPDATED) {
        viewUpdates += 1;
      } else if (type === "directive.content") {
        directiveBroadcasts += 1;
      }
      return originalPublish(type as never, payload as never, options as never);
    }) as typeof brain.bus.publish;

    const report = (facts: Record<string, unknown>) =>
      originalPublish(
        SESSION_REPORT_TYPES.FACTS_REPORTED,
        { source: "popup", facts } as never,
        { target: REALMS.BACKGROUND, tab: 77 } as never,
      );

    await report({ ...SILENT_FACTS });
    await flush();
    const viewAfterFirst = viewUpdates;
    const directiveAfterFirst = directiveBroadcasts;
    expect(viewAfterFirst).toBeGreaterThanOrEqual(1);
    expect(directiveAfterFirst).toBeGreaterThanOrEqual(1);

    // Re-reporting byte-identical facts must NOT trigger another popup broadcast,
    // but MUST still re-broadcast the content directive (content has no pull).
    await report({ ...SILENT_FACTS });
    await flush();
    await report({ ...SILENT_FACTS });
    await flush();
    expect(viewUpdates).toBe(viewAfterFirst);
    expect(directiveBroadcasts).toBe(directiveAfterFirst + 2);

    // A real change resumes popup broadcasting.
    await report({ ...SILENT_FACTS, isEnabled: true });
    await flush();
    expect(viewUpdates).toBe(viewAfterFirst + 1);
  });
});
