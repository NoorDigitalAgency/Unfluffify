import type { PopupLegacySpinnerEntry } from "../../../common/bus/contracts/popup-state.js";
import type { SpinnerSelection, TabLayerState } from "../state-store.js";

type SpinnerSelections = Readonly<Pick<TabLayerState["spinners"], "popup" | "pageCurtain" | "banner">>;
type BlockingSurface = "popup" | "page";

function blocksSurface(entry: PopupLegacySpinnerEntry, surface: BlockingSurface): boolean {
  if (entry.blockSurfaces && typeof entry.blockSurfaces === "object") {
    return entry.blockSurfaces[surface] === true;
  }
  return true;
}

function rendersAsBanner(entry: PopupLegacySpinnerEntry): boolean {
  if (!entry.blockSurfaces || typeof entry.blockSurfaces !== "object") {
    return false;
  }
  return entry.blockSurfaces.page !== true && entry.blockSurfaces.popup !== true;
}

function toSpinnerSelection(entry: PopupLegacySpinnerEntry): SpinnerSelection | null {
  if (!entry.operationKind || !entry.operationPhase) {
    return null;
  }
  return {
    kind: entry.operationKind,
    phase: entry.operationPhase,
    startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : 0,
    deadlineAt: Number.isFinite(entry.deadlineAt) ? entry.deadlineAt : 0,
    operationId: entry.operationId || undefined,
  };
}

function selectLatestSpinner(
  queue: readonly PopupLegacySpinnerEntry[],
  predicate: (entry: PopupLegacySpinnerEntry) => boolean,
): SpinnerSelection | null {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const entry = queue[index];
    if (!predicate(entry)) {
      continue;
    }
    const selection = toSpinnerSelection(entry);
    if (selection) {
      return selection;
    }
  }
  return null;
}

function selectLegacyActiveSpinner(queue: readonly PopupLegacySpinnerEntry[]): SpinnerSelection | null {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const entry = queue[index];
    if (!entry) {
      continue;
    }
    if (!entry.blockSurfaces || typeof entry.blockSurfaces !== "object") {
      return toSpinnerSelection(entry);
    }
    if (entry.blockSurfaces.popup === true || entry.blockSurfaces.page === true) {
      return toSpinnerSelection(entry);
    }
  }
  return queue.length ? toSpinnerSelection(queue[queue.length - 1]) : null;
}

export function deriveSpinnerSelectionsFromLegacyQueue(
  queue: readonly PopupLegacySpinnerEntry[],
): SpinnerSelections {
  return {
    popup: selectLegacyActiveSpinner(queue),
    pageCurtain: selectLatestSpinner(queue, (entry) => blocksSurface(entry, "page")),
    banner: selectLatestSpinner(queue, rendersAsBanner),
  };
}
