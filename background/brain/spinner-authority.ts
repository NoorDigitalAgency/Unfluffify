import {
  getSpinnerPhaseDefinition,
  type SpinnerBlockSurfaces,
  type SpinnerTimerMode,
} from "../../common/spinner-contract.js";
import type { SpinnerSelection, TabLayerState } from "./state-store.js";

export type SpinnerState = Readonly<{
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

function projectSurface(selection: SpinnerSelection | null): SpinnerState | null {
  if (!selection) {
    return null;
  }
  return phaseToSpinnerState(selection.kind, selection.phase, {
    startedAt: selection.startedAt,
    deadlineAt: selection.deadlineAt,
    operationId: selection.operationId,
  });
}

export function phaseToSpinnerState(
  kind: string,
  phase: string,
  options: Readonly<{
    startedAt: number;
    deadlineAt: number;
    operationId?: string;
  }>,
): SpinnerState | null {
  const definition = getSpinnerPhaseDefinition(kind, phase);
  if (!definition) {
    return null;
  }
  return {
    title: definition.title,
    message: definition.note,
    timerMode: definition.timerMode,
    deadlineAt: options.deadlineAt,
    startedAt: options.startedAt,
    blockSurfaces: definition.blockSurfaces,
    operationKind: definition.kind,
    operationPhase: definition.phase,
    operationId: options.operationId,
  };
}

export function projectSpinners(state: TabLayerState): {
  popup: SpinnerState | null;
  pageCurtain: SpinnerState | null;
  banner: SpinnerState | null;
} {
  return {
    popup: projectSurface(state.spinners.popup),
    pageCurtain: projectSurface(state.spinners.pageCurtain),
    banner: projectSurface(state.spinners.banner),
  };
}
