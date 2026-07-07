export type AiJobPhase = "idle" | "running" | "fresh" | "stale-on-edit" | "failed";

export type AiJobState = Readonly<{
  phase: AiJobPhase;
  currentMarkingFingerprint: string;
  freshMarkingFingerprint: string;
  pendingChanges: boolean;
  pageControlsVisible: boolean;
  reconciliationPending: boolean;
  error?: string;
}>;

export type AiJobGates = Readonly<{
  aiRunUpToDate: boolean;
  sessionRequiresAiRun: boolean;
  runAiDisabled: boolean;
  saveEnabled: boolean;
}>;

export function createAiJobState(): AiJobState {
  return {
    phase: "idle",
    currentMarkingFingerprint: "",
    freshMarkingFingerprint: "",
    pendingChanges: false,
    pageControlsVisible: true,
    reconciliationPending: false,
  };
}

export function startAiJob(state: AiJobState): AiJobState {
  return { ...state, phase: "running", error: undefined };
}

export function completeAiJob(state: AiJobState, fingerprint: string): AiJobState {
  return {
    ...state,
    phase: "fresh",
    currentMarkingFingerprint: fingerprint,
    freshMarkingFingerprint: fingerprint,
    pendingChanges: false,
    error: undefined,
  };
}

export function failAiJob(state: AiJobState, error: string): AiJobState {
  return { ...state, phase: "failed", error };
}

export function markMarkingEdit(state: AiJobState, fingerprint: string): AiJobState {
  return {
    ...state,
    phase: state.phase === "running" ? "running" : "stale-on-edit",
    currentMarkingFingerprint: fingerprint,
    pendingChanges: true,
  };
}

export function markCssSelectorOnlyEdit(state: AiJobState): AiJobState {
  return {
    ...state,
    pendingChanges: true,
  };
}

export function setAiJobContext(
  state: AiJobState,
  context: Partial<Pick<AiJobState, "pageControlsVisible" | "reconciliationPending">>,
): AiJobState {
  return { ...state, ...context };
}

export function deriveAiJobGates(state: AiJobState): AiJobGates {
  const aiRunUpToDate =
    state.phase === "fresh" &&
    state.currentMarkingFingerprint !== "" &&
    state.currentMarkingFingerprint === state.freshMarkingFingerprint;
  const sessionRequiresAiRun = state.pendingChanges || !aiRunUpToDate;
  return {
    aiRunUpToDate,
    sessionRequiresAiRun,
    runAiDisabled: state.phase === "running" || aiRunUpToDate,
    saveEnabled: state.pageControlsVisible && !state.reconciliationPending && !sessionRequiresAiRun,
  };
}
