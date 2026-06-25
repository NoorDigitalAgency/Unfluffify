import type {
  SpinnerBlockSurfaces,
  SpinnerTimerMode,
} from "../../spinner-contract.js";

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
  operationKind: string;
  operationPhase: string;
  operationId?: string;
}>;

export type SpinnerSetPayload = Readonly<{
  surface: SpinnerSurface;
  state: SpinnerViewState;
}>;

export type SpinnerClearPayload = Readonly<{
  surface: SpinnerSurface;
}>;
