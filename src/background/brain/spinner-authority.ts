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

// Contract enforcement for the phase recovery policies (RELEASE_ON_EXPIRE /
// FAIL_OPEN): a projected blocking surface must never outlive its phase budget.
// The queue's REMOVE normally clears the selection, but the selection itself is
// persisted with the brain store (session-scoped extension storage) while the
// spinner queue is service-worker memory — an MV3 SW suspension mid-operation
// loses the REMOVE forever and the popup would project the stuck surface
// indefinitely (live-reported: the "With JavaScript" render-mode inspection
// after a "Without JavaScript" hold sporadically left its curtain stuck).
// Projection runs on every store mutation and popup (re)connect, so expiring
// here clears the surface within the phase budget plus this grace.
const SPINNER_SURFACE_EXPIRY_GRACE_MS = 30_000;

function isExpiredSpinnerSelection(
  selection: SpinnerSelection,
  definition: { maxDurationMs: number },
  now: number,
): boolean {
  if (!Number.isFinite(now) || now <= 0) {
    return false;
  }
  if (selection.deadlineAt > 0 && now > selection.deadlineAt + SPINNER_SURFACE_EXPIRY_GRACE_MS) {
    return true;
  }
  return Boolean(
    definition.maxDurationMs > 0 &&
      selection.startedAt > 0 &&
      now > selection.startedAt + definition.maxDurationMs + SPINNER_SURFACE_EXPIRY_GRACE_MS
  );
}

function projectSurface(selection: SpinnerSelection | null, now = 0): SpinnerState | null {
  if (!selection) {
    return null;
  }
  // Admission: only phases the shared contract knows may reach a surface —
  // consumers resolve content from the same table, so an unknown phase would
  // render an empty overlay.
  const definition = getSpinnerPhaseDefinition(selection.kind, selection.phase);
  if (!definition) {
    return null;
  }
  if (isExpiredSpinnerSelection(selection, definition, now)) {
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

export function projectSpinners(state: TabLayerState, now = 0): {
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
    popup: projectSurface(popupSelection, now),
    pageCurtain: projectSurface(pageCurtainSelection, now),
    banner: projectSurface(state.spinners.banner, now),
  };
}
