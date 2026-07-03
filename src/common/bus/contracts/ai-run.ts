export const AI_RUN_DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

// THE single source of truth for every DISPLAYED representation of the AI-run
// timeout (spinner countdown fallbacks, busy-curtain notes). The actual abort
// deadline and the live countdown both derive from the run's deadlineAt
// (server-provided when known, AI_RUN_DEFAULT_TIMEOUT_MS otherwise) — static
// copy must derive from here too, never hardcode the minutes (P4 step 4.0).
export const AI_RUN_DEFAULT_TIMEOUT_MINUTES = Math.round(AI_RUN_DEFAULT_TIMEOUT_MS / 60_000);

export function formatAiRunTimeoutFallbackCountdown(): string {
  return `Up to ${AI_RUN_DEFAULT_TIMEOUT_MINUTES}:00`;
}

export const AI_RUN_EVENT_REASONS = Object.freeze({
  RESULTS_READY: "results_ready",
} as const);

export const AI_RUN_EVENT_TYPES = Object.freeze({
  STARTED: "ai-run.started",
  PREVIEW_READY: "ai-run.previewReady",
  RESULTS_APPLIED: "ai-run.resultsApplied",
  FAILED: "ai-run.failed",
  TIMED_OUT: "ai-run.timedOut",
  EXITED: "ai-run.exited",
} as const);

export type AiRunEventType = (typeof AI_RUN_EVENT_TYPES)[keyof typeof AI_RUN_EVENT_TYPES];

export type AiRunEventPayload = Readonly<{
  tabId?: number;
  sessionId?: string;
  deadlineAt?: number;
  reason?: string;
  // Preview provenance for PREVIEW_READY: which open path raised it
  // ("post_ai" run completion, "marking" Show Content, "silent" Silent
  // Preview). Feeds the brain's `preview.opened` signal emission.
  origin?: string;
}>;
