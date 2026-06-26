import type { PopupStateGetReply } from "./popup-state";
import type {
  SpinnerBlockSurfaces,
  SpinnerTimerMode,
} from "../../spinner-contract";

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

export type SpinnerViewState = Readonly<{
  title: string;
  message: string;
  timerMode: SpinnerTimerMode;
  deadlineAt: number;
  startedAt: number;
  blockSurfaces: SpinnerBlockSurfaces;
  maxDurationMs: number;
  operationKind: string;
  operationPhase: string;
  operationId?: string;
  reason?: string;
  source?: string;
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
