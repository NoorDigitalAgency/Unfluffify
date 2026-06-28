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
export function isAiRunComputeSpinnerActive(
  queue: readonly PopupSpinnerEntry[],
  now: number = Date.now(),
): boolean {
  return queue.some(
    (entry) =>
      Boolean(entry) &&
      !isSpinnerEntryExpired(entry, now) &&
      entry.operationKind === SPINNER_OPERATION_KINDS.AI_RUN &&
      typeof entry.operationPhase === "string" &&
      AI_RUN_COMPUTE_PHASES.has(entry.operationPhase),
  );
}

/**
 * Brain-side fail-open: a spinner whose bounded deadline has elapsed is treated
 * as expired so a missed main-world "done" ack can never leave the curtain stuck
 * on either layer. Persistent spinners are explicitly exempt from expiry.
 */
function isSpinnerEntryExpired(entry: PopupSpinnerEntry, now: number): boolean {
  if (!entry || entry.persistent === true) {
    return false;
  }
  return Number.isFinite(entry.deadlineAt) && entry.deadlineAt > 0 && now >= entry.deadlineAt;
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

function selectLatestSpinner(
  queue: readonly PopupSpinnerEntry[],
  predicate: (entry: PopupSpinnerEntry) => boolean,
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

function selectActiveSpinner(queue: readonly PopupSpinnerEntry[]): SpinnerSelection | null {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const entry = queue[index];
    if (!entry) {
      continue;
    }
    if (!entry.blockSurfaces || typeof entry.blockSurfaces !== "object") {
      const selection = toSpinnerSelection(entry);
      if (selection) {
        return selection;
      }
      continue;
    }
    if (entry.blockSurfaces.popup === true || entry.blockSurfaces.page === true) {
      const selection = toSpinnerSelection(entry);
      if (selection) {
        return selection;
      }
    }
  }
  return queue.length ? toSpinnerSelection(queue[queue.length - 1]) : null;
}

export function deriveSpinnerSelectionsFromQueue(
  queue: readonly PopupSpinnerEntry[],
  now: number = Date.now(),
): SpinnerSelections {
  const liveQueue = queue.filter((entry) => entry && !isSpinnerEntryExpired(entry, now));
  return {
    popup: selectActiveSpinner(liveQueue),
    pageCurtain: selectLatestSpinner(liveQueue, (entry) => blocksSurface(entry, "page")),
    banner: selectLatestSpinner(liveQueue, rendersAsBanner),
  };
}

export function updateSpinnerSelectionsFromQueue(
  store: SpinnerStateStore,
  tabId: number,
  queue: readonly PopupSpinnerEntry[],
  reason: string,
  now: number = Date.now(),
): SpinnerSelections {
  const nextSelections = deriveSpinnerSelectionsFromQueue(queue, now);
  store.mutate(tabId, reason, (state) => {
    state.spinners.popup = nextSelections.popup;
    state.spinners.pageCurtain = nextSelections.pageCurtain;
    state.spinners.banner = nextSelections.banner;
  });
  return nextSelections;
}
