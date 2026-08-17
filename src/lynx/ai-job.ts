import { AI_RUN_POLL_INTERVAL_MS, AI_RUN_TIMEOUT_MS } from "./ai";

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

export type AiJobPollDeps = Readonly<{
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  getStatus: (sessionId: string) => Promise<{ status: "ok"; runStatus: string } | { status: "not_found" | "error" }>;
  getResult: (sessionId: string) => Promise<{ status: "ok"; selectors: unknown } | { status: "not_found" | "error" }>;
  heartbeat: (state: Readonly<{ sessionId: string; phase: AiJobPhase; deadlineAt: number; updatedAt: number }>) => Promise<void> | void;
  acquireComputeLock: () => Promise<() => void> | (() => void);
}>;

export type AiJobPollResult =
  | Readonly<{ status: "fresh"; selectors: unknown; polls: number }>
  | Readonly<{ status: "timeout" | "not_found" | "error"; polls: number }>;

export async function pollAiJob(
  sessionId: string,
  deps: AiJobPollDeps,
  options: Readonly<{ timeoutMs?: number; pollIntervalMs?: number }> = {},
): Promise<AiJobPollResult> {
  const timeoutMs = options.timeoutMs ?? AI_RUN_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? AI_RUN_POLL_INTERVAL_MS;
  const deadlineAt = deps.now() + timeoutMs;
  const release = await deps.acquireComputeLock();
  let polls = 0;
  try {
    while (deps.now() < deadlineAt) {
      polls += 1;
      await deps.heartbeat({ sessionId, phase: "running", deadlineAt, updatedAt: deps.now() });
      const status = await deps.getStatus(sessionId);
      if (status.status === "not_found") return { status: "not_found", polls };
      if (status.status !== "ok" || status.runStatus === "error") return { status: "error", polls };
      if (status.runStatus !== "running") {
        const result = await deps.getResult(sessionId);
        if (result.status === "ok") return { status: "fresh", selectors: result.selectors, polls };
        return { status: result.status, polls };
      }
      await deps.sleep(Math.min(pollIntervalMs, Math.max(0, deadlineAt - deps.now())));
    }
    return { status: "timeout", polls };
  } finally {
    release();
  }
}
