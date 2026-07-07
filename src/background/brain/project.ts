import type { TabFacts } from "../../domain/schema/facts";

export type BrainProjection = Readonly<{
  tabId: number;
  phase: "silent" | "locked" | "marking" | "reconciling";
  signalHead: number;
  canEdit: boolean;
  blockedReason: string;
}>;

export function projectBrainState(facts: TabFacts, signalHead: number): BrainProjection {
  if (facts.reconciliationPending) {
    return {
      tabId: facts.tabId,
      phase: "reconciling",
      signalHead,
      canEdit: false,
      blockedReason: "reconciliation",
    };
  }
  if (facts.lockRole === "passive") {
    return {
      tabId: facts.tabId,
      phase: "locked",
      signalHead,
      canEdit: false,
      blockedReason: "property-lock",
    };
  }
  if (facts.markingEnabled) {
    return {
      tabId: facts.tabId,
      phase: "marking",
      signalHead,
      canEdit: facts.configPresent && facts.lockRole === "editor",
      blockedReason: facts.configPresent && facts.lockRole === "editor" ? "" : "not-ready",
    };
  }
  return {
    tabId: facts.tabId,
    phase: "silent",
    signalHead,
    canEdit: false,
    blockedReason: "",
  };
}
