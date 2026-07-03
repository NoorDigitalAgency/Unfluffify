import {
  getSpinnerPhaseDefinition,
  SPINNER_OPERATION_KINDS,
  SPINNER_OPERATION_PHASES,
} from "../../common/spinner-contract";
import type { SpinnerSelection, TabLayerState } from "./state-store";

// P4 step 4.2: the brain broadcasts surface vocabulary only — which operation
// engages a surface and its timing. Layers resolve ALL presentation locally
// (machine surface memory first, the shared phase-definition table second),
// so this projection never composes display strings.
export type SpinnerState = Readonly<{
  kind: string;
  phase: string;
  deadlineAt: number;
  startedAt: number;
  operationId?: string;
  reason?: string;
  spinnerKey?: string;
}>;

function projectSurface(selection: SpinnerSelection | null): SpinnerState | null {
  if (!selection) {
    return null;
  }
  // Admission: only phases the shared contract knows may reach a surface —
  // consumers resolve content from the same table, so an unknown phase would
  // render an empty overlay.
  if (!getSpinnerPhaseDefinition(selection.kind, selection.phase)) {
    return null;
  }
  return {
    kind: selection.kind,
    phase: selection.phase,
    startedAt: selection.startedAt,
    deadlineAt: selection.deadlineAt,
    operationId: selection.operationId,
    reason: selection.reason || "",
    spinnerKey: selection.spinnerKey || "",
  };
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
    message: "",
    reason: state.aiRun.reason || "ai-run-started",
    source: "brain-ai-run-events",
    spinnerKey: `run-ai:${state.tabId}`,
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
