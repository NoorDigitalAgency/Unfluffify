// REFLEX-ARC pairing guarantee for phase-edge signals (MAIN PLAN §2).
// 'inspection.*' and 'reconciliation.*' are consumed as strict started->ended
// pairs: the popup overlay states enter on -started and return to their prior
// ONLY on the matching -ended. The brain's sessionFacts/sessionDictation are
// rewritten by several mutate paths (session-facts folds, AI-run folds,
// navigation-curtain clears, lifecycle mirrors), so edge detection inside any
// single fold function cannot see every flip. Live wedge, 2026-07-03: a save
// lifecycle fold emitted reconciliation.ended + inspection.started in one pass,
// then clearNavigationInspectionCurtainDraft dropped the phase with no fold
// running — inspection.ended was never born and the popup sat behind the
// "Inspecting the page" curtain until a navigation. The only place every
// rewrite funnels through is the state store's mutate, so the edges are
// observed HERE, by wrapping mutate at store creation.
//
// Each pair member carries the pair's cycle number in payload and dedupeKey:
// the admission log's 250ms double-fire window compares (name, cause, payload),
// so without a per-cycle payload a rapid flap (ended -> started -> ended inside
// the window) would drop the closing ended and re-create the wedge. A genuine
// double-fire of the SAME edge still dedupes via the identical dedupeKey.
import {
  SESSION_PHASES,
} from "../../common/bus/contracts/session-state";
import {
  SIGNAL_NAMES,
  type SignalEmitPayload,
} from "../../common/bus/contracts/signals";
import type { TabLayerState } from "./state-store";

export type SessionSignalEdgeEmitter = (tabId: number, emit: SignalEmitPayload) => unknown;

type MutateFn = (
  tabId: number,
  reason: string,
  fn: (state: TabLayerState) => void,
) => TabLayerState;

function isInspectingState(state: Pick<TabLayerState, "sessionDictation">): boolean {
  return (state.sessionDictation?.phase ?? null) === SESSION_PHASES.RENDER_MODE_INSPECTION;
}

function isReconcilingState(state: Pick<TabLayerState, "sessionFacts">): boolean {
  return state.sessionFacts.pageSaveReconciliationPending === true;
}

export function wrapMutateWithSessionSignalEdges(
  mutate: MutateFn,
  emit: SessionSignalEdgeEmitter,
): MutateFn {
  const cycles = new Map<number, { inspection: number; reconciliation: number }>();
  function cycleOf(tabId: number): { inspection: number; reconciliation: number } {
    let cycle = cycles.get(tabId);
    if (!cycle) {
      cycle = { inspection: 0, reconciliation: 0 };
      cycles.set(tabId, cycle);
    }
    return cycle;
  }
  return (tabId, reason, fn) => {
    let wasReconciling = false;
    let wasInspecting = false;
    let observed = false;
    const state = mutate(tabId, reason, (draft) => {
      wasReconciling = isReconcilingState(draft);
      wasInspecting = isInspectingState(draft);
      observed = true;
      fn(draft);
    });
    if (!observed) {
      return state;
    }
    const isReconciling = isReconcilingState(state);
    const isInspecting = isInspectingState(state);
    if (isReconciling !== wasReconciling) {
      const cycle = cycleOf(tabId);
      if (isReconciling) {
        cycle.reconciliation += 1;
      }
      emit(tabId, {
        name: isReconciling
          ? SIGNAL_NAMES.RECONCILIATION_STARTED
          : SIGNAL_NAMES.RECONCILIATION_ENDED,
        source: "brain",
        cause: "save-lifecycle",
        payload: {
          reason: state.sessionFacts.pageSaveReconciliationReason ?? "",
          cycle: cycle.reconciliation,
        },
        dedupeKey: `save-reconciliation:${isReconciling ? "started" : "ended"}:${cycle.reconciliation}`,
      });
    }
    if (isInspecting !== wasInspecting) {
      const cycle = cycleOf(tabId);
      if (isInspecting) {
        cycle.inspection += 1;
      }
      emit(tabId, {
        name: isInspecting ? SIGNAL_NAMES.INSPECTION_STARTED : SIGNAL_NAMES.INSPECTION_ENDED,
        source: "brain",
        cause: "render-mode-inspection-phase",
        payload: { kind: "render_mode", cycle: cycle.inspection },
        dedupeKey: `render-mode-inspection:${isInspecting ? "started" : "ended"}:${cycle.inspection}`,
      });
    }
    return state;
  };
}
