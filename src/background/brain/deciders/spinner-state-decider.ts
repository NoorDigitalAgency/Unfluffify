import type { PopupSpinnerEntry } from "../../../common/bus/contracts/popup-state";
import { SPINNER_OPERATION_KINDS, SPINNER_OPERATION_PHASES } from "../../../common/spinner-contract";
import type { SpinnerSelection, TabLayerState } from "../state-store";

type SpinnerSelections = Readonly<Pick<TabLayerState["spinners"], "popup" | "pageCurtain" | "banner">>;
type BlockingSurface = "popup" | "page";
type SpinnerStateStore = {
  mutate(tabId: number, reason: string, fn: (state: TabLayerState) => void): TabLayerState;
};

const AI_RUN_COMPUTE_PHASES: ReadonlySet<string> = new Set([
  SPINNER_OPERATION_PHASES.AI_RUN.PREPARING_PAGE,
  SPINNER_OPERATION_PHASES.AI_RUN.CAPTURE_MARKED_CONTENT,
  SPINNER_OPERATION_PHASES.AI_RUN.PREPARE_SELECTOR_PAYLOAD,
  SPINNER_OPERATION_PHASES.AI_RUN.REFINING_STATIC_XPATHS,
  SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT,
]);

/**
 * Detects whether the projected spinner queue contains an active AI-run compute
 * lease (the synchronous prepare -> remote-wait phases). The brain uses this as
 * the single source of truth for aiBusy/aiComputing so the popup no longer
 * pushes those facts. Post-result AI-run phases (opening-preview, syncing-
 * markings) are intentionally excluded so they do not force the COMPUTING_AI
 * curtain.
 */
export function isAiRunComputeSpinnerActive(queue: readonly PopupSpinnerEntry[]): boolean {
  return queue.some(
    (entry) =>
      Boolean(entry) &&
      entry.operationKind === SPINNER_OPERATION_KINDS.AI_RUN &&
      typeof entry.operationPhase === "string" &&
      AI_RUN_COMPUTE_PHASES.has(entry.operationPhase),
  );
}

function blocksSurface(entry: PopupSpinnerEntry, surface: BlockingSurface): boolean {
  if (entry.blockSurfaces && typeof entry.blockSurfaces === "object") {
    return entry.blockSurfaces[surface] === true;
  }
  return true;
}

function rendersAsBanner(entry: PopupSpinnerEntry): boolean {
  if (!entry.blockSurfaces || typeof entry.blockSurfaces !== "object") {
    return false;
  }
  return entry.blockSurfaces.page !== true && entry.blockSurfaces.popup !== true;
}

function toSpinnerSelection(entry: PopupSpinnerEntry): SpinnerSelection | null {
  if (!entry.operationKind || !entry.operationPhase) {
    return null;
  }
  return {
    kind: entry.operationKind,
    phase: entry.operationPhase,
    startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : 0,
    deadlineAt: Number.isFinite(entry.deadlineAt) ? entry.deadlineAt : 0,
    operationId: entry.operationId || undefined,
    message: typeof entry.message === "string" ? entry.message : "",
    reason: typeof entry.reason === "string" ? entry.reason : "",
    source: typeof entry.source === "string" ? entry.source : "",
    spinnerKey: entry.key,
  };
}

function getSpinnerOrderTimestamp(entry: PopupSpinnerEntry, fallback = 0): number {
  return Number.isFinite(entry.startedAt) ? Number(entry.startedAt) : fallback;
}

function isNewerSpinnerEntry(
  candidate: PopupSpinnerEntry,
  candidateIndex: number,
  current: PopupSpinnerEntry,
  currentIndex: number,
): boolean {
  const candidateStartedAt = getSpinnerOrderTimestamp(candidate, candidateIndex);
  const currentStartedAt = getSpinnerOrderTimestamp(current, currentIndex);
  if (candidateStartedAt !== currentStartedAt) {
    return candidateStartedAt > currentStartedAt;
  }
  return candidateIndex < currentIndex;
}

function selectLatestSpinner(
  queue: readonly PopupSpinnerEntry[],
  predicate: (entry: PopupSpinnerEntry) => boolean,
): SpinnerSelection | null {
  let selectedEntry: PopupSpinnerEntry | null = null;
  let selectedIndex = -1;
  for (let index = 0; index < queue.length; index += 1) {
    const entry = queue[index];
    if (!predicate(entry) || !toSpinnerSelection(entry)) {
      continue;
    }
    if (!selectedEntry || isNewerSpinnerEntry(entry, index, selectedEntry, selectedIndex)) {
      selectedEntry = entry;
      selectedIndex = index;
    }
  }
  return selectedEntry ? toSpinnerSelection(selectedEntry) : null;
}

function isActiveSpinnerCandidate(entry: PopupSpinnerEntry): boolean {
  if (!entry) {
    return false;
  }
  if (!entry.blockSurfaces || typeof entry.blockSurfaces !== "object") {
    return true;
  }
  return entry.blockSurfaces.popup === true || entry.blockSurfaces.page === true;
}

function selectActiveSpinner(queue: readonly PopupSpinnerEntry[]): SpinnerSelection | null {
  const activeSelection = selectLatestSpinner(queue, isActiveSpinnerCandidate);
  if (activeSelection) {
    return activeSelection;
  }
  return queue.length ? toSpinnerSelection(queue[queue.length - 1]) : null;
}

export function deriveSpinnerSelectionsFromQueue(
  queue: readonly PopupSpinnerEntry[],
): SpinnerSelections {
  return {
    popup: selectActiveSpinner(queue),
    pageCurtain: selectLatestSpinner(queue, (entry) => blocksSurface(entry, "page")),
    banner: selectLatestSpinner(queue, rendersAsBanner),
  };
}

export function updateSpinnerSelectionsFromQueue(
  store: SpinnerStateStore,
  tabId: number,
  queue: readonly PopupSpinnerEntry[],
  reason: string,
): SpinnerSelections {
  const nextSelections = deriveSpinnerSelectionsFromQueue(queue);
  store.mutate(tabId, reason, (state) => {
    state.spinners.popup = nextSelections.popup;
    state.spinners.pageCurtain = nextSelections.pageCurtain;
    state.spinners.banner = nextSelections.banner;
  });
  return nextSelections;
}
