import type { PopupStateGetReply } from "./popup-state";
import type { SpinnerBlockSurfaces } from "../../spinner-contract";

export const SPINNER_REQUEST_TYPES = Object.freeze({
  SET: "spinner.entry.set",
  REMOVE: "spinner.entry.remove",
  CLEAR: "spinner.queue.clear",
} as const);

export const SPINNER_EVENT_TYPES = Object.freeze({
  SET: "spinner.set",
  CLEAR: "spinner.clear",
} as const);

export type SpinnerSurface = "popup" | "pageCurtain" | "banner";

// P4 step 4.2: the broadcast is surface vocabulary only — WHICH operation
// engages the surface and its timing. All presentation (title/note/timer
// mode/block surfaces/max duration) is resolved by each layer locally:
// machine surface memory first, the shared phase-definition table
// (common/spinner-contract.ts) second.
export type SpinnerViewState = Readonly<{
  kind: string;
  phase: string;
  deadlineAt: number;
  startedAt: number;
  operationId?: string;
  reason?: string;
  spinnerKey?: string;
}>;

export type SpinnerSetPayload = Readonly<{
  surface: SpinnerSurface;
  state: SpinnerViewState;
}>;

export type SpinnerClearPayload = Readonly<{
  surface: SpinnerSurface;
}>;

export type SpinnerSetRequestPayload = Readonly<{
  key: string;
  message: string;
  persistent: boolean;
  reason: string;
  source: string;
  startedAt: number;
  operationId: string;
  operationKind: string;
  operationPhase: string;
  deadlineAt?: number;
  maxDurationMs?: number;
  blockSurfaces?: SpinnerBlockSurfaces;
  timerMode: string;
}>;

export type SpinnerRemoveRequestPayload = Readonly<{
  key: string;
}>;

export type SpinnerClearRequestPayload = Readonly<{
  transientOnly: boolean;
}>;

export type SpinnerMutationReply = PopupStateGetReply;
