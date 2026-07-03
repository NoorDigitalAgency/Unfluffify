// REFLEX-ARC signal frames (MAIN PLAN Phase 1, see
// .copilot/architecture/reflex-arc-plan.md). Signals are EVENTS born at the
// source with provenance, admitted by the BRAIN which assigns a per-tab
// monotonic sequence, pushed best-effort and pulled by cursor for
// correctness. Heartbeats never re-serve a frame; consumers keep
// lastConsumedSeq and ignore anything at or below it.

export type SignalSource = "brain" | "content" | "popup";

export const SIGNAL_NAMES = Object.freeze({
  MARKING_ENABLED: "marking.enabled",
  MARKING_DISABLED: "marking.disabled",
  MARKINGS_CHANGED: "markings.changed",
  RUN_STARTED: "run.started",
  RUN_COMPLETED: "run.completed",
  RUN_FAILED: "run.failed",
  PREVIEW_OPENED: "preview.opened",
  PREVIEW_EXIT_REQUESTED: "preview.exit.requested",
  PREVIEW_EXITED: "preview.exited",
  SESSION_SAVED: "session.saved",
  SESSION_DISCARDED: "session.discarded",
  SESSION_NAVIGATED: "session.navigated",
  INSPECTION_STARTED: "inspection.started",
  INSPECTION_ENDED: "inspection.ended",
  RECONCILIATION_STARTED: "reconciliation.started",
  RECONCILIATION_ENDED: "reconciliation.ended",
} as const);

export type SignalName = (typeof SIGNAL_NAMES)[keyof typeof SIGNAL_NAMES];

export type SignalPayload = Readonly<Record<string, string | number | boolean>>;

export type SignalFrame = Readonly<{
  kind: "uf-signal/1";
  tabId: number;
  seq: number;
  name: SignalName;
  source: SignalSource;
  cause: string;
  at: number;
  payload: SignalPayload;
}>;

export const SIGNAL_REQUEST_TYPES = Object.freeze({
  EMIT: "signal.emit",
  PULL: "signal.pull",
} as const);

export const SIGNAL_EVENT_TYPES = Object.freeze({
  EMITTED: "signal.emitted",
} as const);

// Layer -> brain admission request. The brain assigns seq/at and returns the
// admitted frame (or null when deduped).
export type SignalEmitPayload = Readonly<{
  name: SignalName;
  source: SignalSource;
  cause: string;
  payload?: SignalPayload;
  // Optional stronger dedupe: dropped when the most recent admitted frame of
  // the same name carries the same key (e.g. a preview-close restore token
  // reported by both the command ack and the content push).
  dedupeKey?: string;
}>;

export type SignalEmitReply = Readonly<{
  ok: boolean;
  frame: SignalFrame | null;
}>;

export type SignalPullPayload = Readonly<{
  afterSeq: number;
}>;

export type SignalPullReply = Readonly<{
  ok: boolean;
  headSeq: number;
  frames: readonly SignalFrame[];
}>;
