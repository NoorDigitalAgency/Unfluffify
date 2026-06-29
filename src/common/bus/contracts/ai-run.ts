export const AI_RUN_DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

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
}>;
