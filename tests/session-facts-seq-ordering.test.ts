import { describe, expect, it } from "vitest";

import { createBrain } from "../src/background/brain/index.js";
import { AI_RUN_PHASES, SESSION_REPORT_TYPES } from "../src/common/bus/contracts/session-state.js";
import { REALMS } from "../src/common/bus/realms.js";

const flush = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

// A clean PRE_AI marking-enabled fact set. With isEnabled:true the brain dictates
// mainUiHidden=false (main UI revealed); flipping isEnabled:false dictates
// mainUiHidden=true (main UI hidden). That single observable bit is exactly the
// regression: a stale popup run with isEnabled:false must not hide the UI after a
// fresher run already revealed it.
const READY_MARKING_FACTS = {
  baseUrlReady: true,
  siteIdReady: true,
  renderModeReady: true,
  isEnabled: true,
  silentModeActive: false,
  hasStoredSelectors: false,
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

describe("brain session-facts seq ordering", () => {
  const reportPopup = (
    brain: ReturnType<typeof createBrain>,
    tab: number,
    facts: Record<string, unknown>,
    seq?: number,
  ) =>
    brain.bus.publish(
      SESSION_REPORT_TYPES.FACTS_REPORTED,
      { source: "popup", facts, ...(typeof seq === "number" ? { seq } : {}) } as never,
      { target: REALMS.BACKGROUND, tab } as never,
    );

  const mainUiHidden = (brain: ReturnType<typeof createBrain>, tab: number) =>
    brain.getPopupView(tab).sessionDictation?.mainUiHidden;

  it("drops a stale lower-seq popup report that lands after a fresher one", async () => {
    const brain = createBrain({ logger: { error() {} } });

    // Fresh refresh (seq 5): marking enabled -> main UI revealed.
    await reportPopup(brain, 70, { ...READY_MARKING_FACTS, isEnabled: true }, 5);
    await flush();
    expect(mainUiHidden(brain, 70)).toBe(false);

    // A stale earlier-started refresh (seq 3) finishing late with isEnabled:false
    // would hide the main UI. It must be dropped as out-of-order.
    await reportPopup(brain, 70, { ...READY_MARKING_FACTS, isEnabled: false }, 3);
    await flush();
    expect(mainUiHidden(brain, 70)).toBe(false);
  });

  it("drops a duplicate (equal-seq) popup report", async () => {
    const brain = createBrain({ logger: { error() {} } });

    await reportPopup(brain, 71, { ...READY_MARKING_FACTS, isEnabled: true }, 5);
    await flush();
    expect(mainUiHidden(brain, 71)).toBe(false);

    // Same seq replayed with different facts is a duplicate and must be dropped.
    await reportPopup(brain, 71, { ...READY_MARKING_FACTS, isEnabled: false }, 5);
    await flush();
    expect(mainUiHidden(brain, 71)).toBe(false);
  });

  it("applies a newer higher-seq popup report", async () => {
    const brain = createBrain({ logger: { error() {} } });

    await reportPopup(brain, 72, { ...READY_MARKING_FACTS, isEnabled: true }, 5);
    await flush();
    expect(mainUiHidden(brain, 72)).toBe(false);

    // A genuinely newer refresh (seq 6) is authoritative and applies.
    await reportPopup(brain, 72, { ...READY_MARKING_FACTS, isEnabled: false }, 6);
    await flush();
    expect(mainUiHidden(brain, 72)).toBe(true);
  });

  it("always applies untagged popup reports (back-compat, no seq)", async () => {
    const brain = createBrain({ logger: { error() {} } });

    await reportPopup(brain, 73, { ...READY_MARKING_FACTS, isEnabled: true }, 5);
    await flush();
    expect(mainUiHidden(brain, 73)).toBe(false);

    // Reports without a seq carry no ordering and always apply (legacy behavior;
    // partial popup publishes and content facts are untagged).
    await reportPopup(brain, 73, { ...READY_MARKING_FACTS, isEnabled: false });
    await flush();
    expect(mainUiHidden(brain, 73)).toBe(true);
  });

  it("keeps per-tab high-water marks independent", async () => {
    const brain = createBrain({ logger: { error() {} } });

    await reportPopup(brain, 81, { ...READY_MARKING_FACTS, isEnabled: true }, 9);
    await flush();
    expect(mainUiHidden(brain, 81)).toBe(false);

    // A different tab starting its own sequence at 1 must not be gated by tab 81's
    // high-water mark.
    await reportPopup(brain, 82, { ...READY_MARKING_FACTS, isEnabled: true }, 1);
    await flush();
    expect(mainUiHidden(brain, 82)).toBe(false);
  });
});
