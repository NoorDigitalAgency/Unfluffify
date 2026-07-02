import {
  getSpinnerPhaseDefinition,
  SPINNER_OPERATION_KINDS,
  SPINNER_OPERATION_PHASES,
  type SpinnerBlockSurfaces,
  type SpinnerTimerMode,
} from "../../common/spinner-contract";
import type { SpinnerSelection, TabLayerState } from "./state-store";

export type SpinnerState = Readonly<{
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

function projectSurface(selection: SpinnerSelection | null): SpinnerState | null {
  if (!selection) {
    return null;
  }
  return phaseToSpinnerState(selection.kind, selection.phase, {
    startedAt: selection.startedAt,
    deadlineAt: selection.deadlineAt,
    operationId: selection.operationId,
    message: selection.message,
    reason: selection.reason,
    source: selection.source,
    spinnerKey: selection.spinnerKey,
  });
}

function selectionBlocksPage(selection: SpinnerSelection | null | undefined): boolean {
  if (!selection) {
    return false;
  }
  const definition = getSpinnerPhaseDefinition(selection.kind, selection.phase);
  return Boolean(definition && definition.blockSurfaces.page);
}

function isAiRunSelection(selection: SpinnerSelection | null | undefined): selection is SpinnerSelection {
  return Boolean(selection && selection.kind === SPINNER_OPERATION_KINDS.AI_RUN);
}

function projectAiRunSelection(state: TabLayerState): SpinnerSelection | null {
  if (!state.aiRun.active) {
    return null;
  }
  return {
    kind: SPINNER_OPERATION_KINDS.AI_RUN,
    phase: SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
    startedAt: state.aiRun.leaseStartedAt,
    deadlineAt: state.aiRun.deadlineAt,
    operationId: state.aiRun.sessionId ? `ai-run:${state.aiRun.sessionId}` : `ai-run:${state.tabId}`,
    message: "Computing selectors",
    reason: state.aiRun.reason || "ai-run-started",
    source: "brain-ai-run-events",
    spinnerKey: `run-ai:${state.tabId}`,
  };
}

export function phaseToSpinnerState(
  kind: string,
  phase: string,
  options: Readonly<{
    startedAt: number;
    deadlineAt: number;
    operationId?: string;
    message?: string;
    reason?: string;
    source?: string;
    spinnerKey?: string;
  }>,
): SpinnerState | null {
  const definition = getSpinnerPhaseDefinition(kind, phase);
  if (!definition) {
    return null;
  }
  return {
    title: definition.title,
    message: typeof options.message === "string" && options.message ? options.message : definition.note,
    timerMode: definition.timerMode,
    deadlineAt: options.deadlineAt,
    startedAt: options.startedAt,
    blockSurfaces: definition.blockSurfaces,
    maxDurationMs: definition.maxDurationMs,
    operationKind: definition.kind,
    operationPhase: definition.phase,
    operationId: options.operationId,
    reason: typeof options.reason === "string" ? options.reason : "",
    source: typeof options.source === "string" ? options.source : "",
    spinnerKey: typeof options.spinnerKey === "string" ? options.spinnerKey : "",
  };
}

export function projectSpinners(state: TabLayerState): {
  popup: SpinnerState | null;
  pageCurtain: SpinnerState | null;
  banner: SpinnerState | null;
} {
  const aiRunSelection = projectAiRunSelection(state);
  const popupAiRunSelection = isAiRunSelection(state.spinners.popup)
    ? state.spinners.popup
    : null;
  const pageCurtainAiRunSelection = isAiRunSelection(state.spinners.pageCurtain)
    ? state.spinners.pageCurtain
    : null;
  const staleAiRunPopupSelection = Boolean(
    aiRunSelection &&
      popupAiRunSelection &&
      popupAiRunSelection.startedAt < aiRunSelection.startedAt
  );
  const effectivePopupAiRunSelection = staleAiRunPopupSelection
    ? null
    : popupAiRunSelection;
  const popupSelection = effectivePopupAiRunSelection || aiRunSelection || state.spinners.popup;
  const popupOnlyAiRunSelection = Boolean(
    effectivePopupAiRunSelection &&
      !selectionBlocksPage(effectivePopupAiRunSelection)
  );
  const staleAiRunPageCurtain = Boolean(
    aiRunSelection &&
      pageCurtainAiRunSelection &&
      pageCurtainAiRunSelection.startedAt < aiRunSelection.startedAt
  );
  const pageCurtainSelection = popupOnlyAiRunSelection
    ? pageCurtainAiRunSelection
      ? null
      : state.spinners.pageCurtain
    : staleAiRunPageCurtain
      ? aiRunSelection
      : pageCurtainAiRunSelection || aiRunSelection || state.spinners.pageCurtain;
  return {
    popup: projectSurface(popupSelection),
    pageCurtain: projectSurface(pageCurtainSelection),
    banner: projectSurface(state.spinners.banner),
  };
}
