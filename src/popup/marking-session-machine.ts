// REFLEX-ARC session state machine (architect direction, 2026-07-03).
//
// The popup's marking-session surface is a finite state machine with
// MEMORIZED states: the brain (and the popup's own user actions) emit
// DISCRETE SIGNALS; the machine looks the transition up in a predefined
// table ("I am in state A, this signal puts me in state E") and state E's
// complete presentation is applied FROM MEMORY. Facts, heartbeats, and
// dictation churn are NOT signals — they can never move the machine, so
// they can never flicker the surface. The brain keeps decision authority
// (it decides WHEN 'post-ai'/'changed'/'saved' happen and still owns busy
// curtains/visibility surfaces); the machine is the popup's muscle memory
// for how each decided state LOOKS.
//
// Adoption: a fresh popup (reconnect) derives its INITIAL state once from
// the brain's projected snapshot, then moves only on signals.

export type MarkingSessionMachineState =
  | "boot"
  | "silent"
  | "silent_preview"
  | "pre_ai_clean"
  | "pre_ai_dirty"
  | "running"
  | "post_ai_clean"
  | "preview_open"
  | "exit_restoring"
  | "inspecting"
  | "reconciling";

export type MarkingSessionSignal =
  | "marking-enabled"
  | "marking-disabled"
  | "markings-changed"
  | "run-started"
  | "run-failed"
  | "post-ai-preview-opened"
  | "preview-opened"
  | "exit-clicked"
  | "exit-settled"
  | "saved"
  | "discarded"
  | "navigated"
  | "inspection-started"
  | "inspection-ended"
  | "reconciliation-started"
  | "reconciliation-ended"
  | "overlay-timeout";

// inspecting/reconciling are OVERLAY states: they render on top of a
// remembered prior session state and return to it on their -ended signal.
export const MARKING_SESSION_OVERLAY_STATES: readonly MarkingSessionMachineState[] =
  Object.freeze(["inspecting", "reconciling"]);

// Overlay fail-open deadline: the brain guarantees started->ended pairing at
// its store choke point, but a lost delivery or a wedged upstream phase must
// never strand the popup behind a curtain (the content page-blocker has the
// same fail-open rule). Entering an overlay arms this deadline; if the
// matching -ended has not arrived, the popup steps itself with
// "overlay-timeout", which returns any overlay to its remembered prior and is
// held (no-op) everywhere else.
export const MARKING_SESSION_OVERLAY_FAIL_OPEN_MS = 30_000;

const OVERLAY_ENTRY: Readonly<Partial<Record<MarkingSessionSignal, MarkingSessionMachineState>>> =
  Object.freeze({
    "inspection-started": "inspecting",
    "reconciliation-started": "reconciling",
  });

const OVERLAY_EXIT: Readonly<Partial<Record<MarkingSessionSignal, MarkingSessionMachineState>>> =
  Object.freeze({
    "inspection-ended": "inspecting",
    "reconciliation-ended": "reconciling",
  });

// The four marking action buttons; every state has a COMPLETE, frozen matrix.
export type MarkingSessionButtonsMemory = {
  computeButtonDisabled: boolean;
  markingPreviewDisabled: boolean;
  pageSaveDisabled: boolean;
  pageRevertDisabled: boolean;
};

type StateMemory = {
  // null = this surface is brain-owned in this state (busy curtains render the
  // disabled looks themselves); the machine still tracks the STATE, it just
  // does not paint buttons over the brain's busy projection.
  buttons: MarkingSessionButtonsMemory | null;
};

const frozenButtons = (
  computeButtonDisabled: boolean,
  markingPreviewDisabled: boolean,
  pageSaveDisabled: boolean,
  pageRevertDisabled: boolean
): MarkingSessionButtonsMemory =>
  Object.freeze({
    computeButtonDisabled,
    markingPreviewDisabled,
    pageSaveDisabled,
    pageRevertDisabled
  });

export const MARKING_SESSION_STATE_MEMORY: Readonly<
  Record<MarkingSessionMachineState, StateMemory>
> = Object.freeze({
  boot: Object.freeze({ buttons: null }),
  // Silent highlighting: the marking actions are not on screen; the brain's
  // silent projection owns the surface.
  silent: Object.freeze({ buttons: null }),
  silent_preview: Object.freeze({ buttons: null }),
  // Fresh marking session, nothing to resolve: Run AI is the only forward action.
  pre_ai_clean: Object.freeze({ buttons: frozenButtons(false, true, true, true) }),
  // Markings changed since the last run/save: Run AI forward, Discard back.
  pre_ai_dirty: Object.freeze({ buttons: frozenButtons(false, true, true, false) }),
  // A run is in flight: every action is locked (the brain's curtain narrates).
  running: Object.freeze({ buttons: frozenButtons(true, true, true, true) }),
  // Run completed for the current markings: resolve via Save / Show / Discard.
  post_ai_clean: Object.freeze({ buttons: frozenButtons(true, false, false, false) }),
  // Preview sidebar open: the sidebar is the surface; actions are locked.
  preview_open: Object.freeze({ buttons: frozenButtons(true, true, true, true) }),
  // Exit clicked, restore in flight: locked until the settle signal lands.
  exit_restoring: Object.freeze({ buttons: frozenButtons(true, true, true, true) }),
  // Overlay states use the Phase-2 full-surface memory
  // (MARKING_SESSION_SURFACE_MEMORY below); the P0 four-button table has no
  // opinion for them.
  inspecting: Object.freeze({ buttons: null }),
  reconciling: Object.freeze({ buttons: null })
});

// The predefined transition table. Anything not listed is NOT a transition:
// the machine stays put (and the attempt is observable via the return value).
const TRANSITIONS: Readonly<
  Partial<Record<MarkingSessionMachineState, Partial<Record<MarkingSessionSignal, MarkingSessionMachineState>>>>
> = Object.freeze({
  silent: {
    "marking-enabled": "pre_ai_clean",
    "preview-opened": "silent_preview",
    navigated: "silent"
  },
  silent_preview: {
    "exit-clicked": "exit_restoring",
    "exit-settled": "silent",
    "marking-enabled": "pre_ai_clean",
    navigated: "silent"
  },
  pre_ai_clean: {
    "markings-changed": "pre_ai_dirty",
    "run-started": "running",
    "marking-disabled": "silent",
    discarded: "pre_ai_clean",
    navigated: "silent"
  },
  pre_ai_dirty: {
    "run-started": "running",
    "marking-disabled": "silent",
    discarded: "pre_ai_clean",
    saved: "silent",
    navigated: "silent"
  },
  running: {
    "post-ai-preview-opened": "preview_open",
    "run-failed": "pre_ai_dirty",
    "marking-disabled": "silent",
    navigated: "silent"
  },
  post_ai_clean: {
    "markings-changed": "pre_ai_dirty",
    "preview-opened": "preview_open",
    "run-started": "running",
    saved: "silent",
    discarded: "pre_ai_clean",
    "marking-disabled": "silent",
    navigated: "silent"
  },
  preview_open: {
    "exit-clicked": "exit_restoring",
    "exit-settled": "post_ai_clean",
    "marking-disabled": "silent",
    navigated: "silent"
  },
  exit_restoring: {
    // The memorized post-exit answer: a marking-restored exit ALWAYS lands in
    // post_ai_clean (Save/Show/Discard). A silent-preview exit signals
    // exit-settled from silent_preview and lands in silent instead — the
    // machine remembers where the preview came from.
    "exit-settled": "post_ai_clean",
    "marking-disabled": "silent",
    saved: "silent",
    discarded: "pre_ai_clean",
    navigated: "silent"
  }
});

export type MarkingSessionTransition = {
  from: MarkingSessionMachineState;
  to: MarkingSessionMachineState;
  moved: boolean;
};

export function transitionMarkingSessionState(
  from: MarkingSessionMachineState,
  signal: MarkingSessionSignal
): MarkingSessionTransition {
  const to = TRANSITIONS[from]?.[signal];
  if (!to) {
    return { from, to: from, moved: false };
  }
  return { from, to, moved: to !== from };
}

// One-time adoption for a fresh popup: derive the starting state from the
// brain-projected snapshot, then move only on signals.
export function adoptMarkingSessionState(snapshot: {
  markingActive: boolean;
  previewOpen: boolean;
  restorePending: boolean;
  runInFlight: boolean;
  postAi: boolean;
  dirty: boolean;
}): MarkingSessionMachineState {
  if (snapshot.restorePending) {
    return "exit_restoring";
  }
  if (snapshot.previewOpen) {
    return snapshot.markingActive || snapshot.postAi ? "preview_open" : "silent_preview";
  }
  if (!snapshot.markingActive) {
    return "silent";
  }
  if (snapshot.runInFlight) {
    return "running";
  }
  if (snapshot.postAi && !snapshot.dirty) {
    return "post_ai_clean";
  }
  return snapshot.dirty ? "pre_ai_dirty" : "pre_ai_clean";
}

export function resolveMarkingSessionButtonsMemory(
  state: MarkingSessionMachineState
): MarkingSessionButtonsMemory | null {
  return MARKING_SESSION_STATE_MEMORY[state]?.buttons ?? null;
}

// ---------------------------------------------------------------------------
// REFLEX-ARC Phase 2: the machine with overlay support, and the FULL surface
// memories (buttons incl. toggle lock + visibility, mode, save reason, and
// session-curtain content — spinner narration is memory, the brain decides
// only entry/exit via signals).
// ---------------------------------------------------------------------------

export type MarkingSessionMachineShape = Readonly<{
  state: MarkingSessionMachineState;
  priorState: MarkingSessionMachineState | null;
}>;

export type MarkingSessionStep = Readonly<{
  machine: MarkingSessionMachineShape;
  moved: boolean;
}>;

// One deterministic rule set:
// - overlay-started from a session state: enter the overlay, remember prior.
// - overlay-started while ALREADY overlaid: switch the overlay, keep the
//   ORIGINAL prior (the underlying session state).
// - matching overlay-ended: return to prior. Non-matching -ended: held.
// - session signals during an overlay: transition the PRIOR state (the
//   overlay is presentation; the session continues underneath).
export function stepMarkingSession(
  machine: MarkingSessionMachineShape,
  signal: MarkingSessionSignal
): MarkingSessionStep {
  const isOverlaid = MARKING_SESSION_OVERLAY_STATES.includes(machine.state);
  const overlayEntry = OVERLAY_ENTRY[signal];
  if (overlayEntry) {
    if (machine.state === overlayEntry) {
      return { machine, moved: false };
    }
    return {
      machine: {
        state: overlayEntry,
        priorState: isOverlaid ? machine.priorState : machine.state,
      },
      moved: true,
    };
  }
  const overlayExit = OVERLAY_EXIT[signal];
  if (overlayExit) {
    if (machine.state !== overlayExit) {
      return { machine, moved: false };
    }
    return {
      machine: { state: machine.priorState ?? "silent", priorState: null },
      moved: true,
    };
  }
  if (signal === "overlay-timeout") {
    if (!isOverlaid) {
      return { machine, moved: false };
    }
    return {
      machine: { state: machine.priorState ?? "silent", priorState: null },
      moved: true,
    };
  }
  if (isOverlaid) {
    const prior = machine.priorState ?? "silent";
    const transition = transitionMarkingSessionState(prior, signal);
    if (!transition.moved) {
      return { machine, moved: false };
    }
    return {
      machine: { state: machine.state, priorState: transition.to },
      moved: true,
    };
  }
  const transition = transitionMarkingSessionState(machine.state, signal);
  if (!transition.moved) {
    return { machine, moved: false };
  }
  return { machine: { state: transition.to, priorState: null }, moved: true };
}

export type MarkingSessionButtonsSurface = Readonly<{
  computeButtonDisabled: boolean;
  computeButtonLoading: boolean;
  markingPreviewVisible: boolean;
  markingPreviewDisabled: boolean;
  pageSaveDisabled: boolean;
  pageRevertDisabled: boolean;
  toggleEnabledDisabled: boolean;
}>;

export type MarkingSessionCurtainMemory =
  | Readonly<{ visible: false }>
  | Readonly<{
      visible: true;
      message: string;
      note: string;
      operation: string;
      phase: string;
      // "run-countdown": the popup renderer fills timerText from the machine's
      // own run countdown (started by run.started's deadlineAt payload).
      timer: "run-countdown" | null;
    }>;

export type MarkingSessionSurfaceMemory = Readonly<{
  // null on any field = not owned in this state (boot passthrough / overlay
  // keeps the underlying mode).
  buttons: MarkingSessionButtonsSurface | null;
  mode: Readonly<{ mainUiHidden: boolean; silentModeActive: boolean }> | null;
  pageSaveBlockedReason: string | null;
  curtain: MarkingSessionCurtainMemory | null;
  // The marking toggle's CHECKED VALUE (the lock bit lives in buttons).
  // Marking-session states are definitionally enabled and silent states
  // definitionally not — a transient isEnabled fact flap during post-exit
  // reconcile must not blink the checkbox (live-caught: a 2.2s false dip at
  // +40s post-exit was the only C3 degrade of an otherwise stone-still run).
  toggleChecked: boolean | null;
}>;

const surfaceButtons = (
  computeButtonDisabled: boolean,
  computeButtonLoading: boolean,
  markingPreviewVisible: boolean,
  markingPreviewDisabled: boolean,
  pageSaveDisabled: boolean,
  pageRevertDisabled: boolean,
  toggleEnabledDisabled: boolean
): MarkingSessionButtonsSurface =>
  Object.freeze({
    computeButtonDisabled,
    computeButtonLoading,
    markingPreviewVisible,
    markingPreviewDisabled,
    pageSaveDisabled,
    pageRevertDisabled,
    toggleEnabledDisabled
  });

const HIDDEN_CURTAIN: MarkingSessionCurtainMemory = Object.freeze({ visible: false });
const MARKING_MODE = Object.freeze({ mainUiHidden: false, silentModeActive: false });
const SILENT_MODE = Object.freeze({ mainUiHidden: true, silentModeActive: true });
const ALL_ACTIONS_LOCKED = surfaceButtons(true, false, true, true, true, true, true);

export const MARKING_SESSION_SURFACE_MEMORY: Readonly<
  Record<MarkingSessionMachineState, MarkingSessionSurfaceMemory>
> = Object.freeze({
  boot: Object.freeze({ buttons: null, mode: null, pageSaveBlockedReason: null, curtain: null, toggleChecked: null }),
  silent: Object.freeze({
    buttons: surfaceButtons(true, false, false, true, true, true, false),
    mode: SILENT_MODE,
    pageSaveBlockedReason: "",
    curtain: HIDDEN_CURTAIN,
    toggleChecked: false
  }),
  silent_preview: Object.freeze({
    buttons: surfaceButtons(true, false, false, true, true, true, false),
    mode: SILENT_MODE,
    pageSaveBlockedReason: "",
    curtain: HIDDEN_CURTAIN,
    toggleChecked: false
  }),
  pre_ai_clean: Object.freeze({
    buttons: surfaceButtons(false, false, true, true, true, true, false),
    mode: MARKING_MODE,
    pageSaveBlockedReason: "no_session_changes",
    curtain: HIDDEN_CURTAIN,
    toggleChecked: true
  }),
  pre_ai_dirty: Object.freeze({
    buttons: surfaceButtons(false, false, true, true, true, false, false),
    mode: MARKING_MODE,
    pageSaveBlockedReason: "requires_ai_run",
    curtain: HIDDEN_CURTAIN,
    toggleChecked: true
  }),
  running: Object.freeze({
    buttons: surfaceButtons(true, true, true, true, true, true, true),
    mode: MARKING_MODE,
    pageSaveBlockedReason: "busy",
    curtain: Object.freeze({
      visible: true,
      message: "Computing selectors",
      note: "Waiting for AI results",
      operation: "computing_ai",
      phase: "computing_ai",
      timer: "run-countdown"
    } as const),
    toggleChecked: true
  }),
  post_ai_clean: Object.freeze({
    buttons: surfaceButtons(true, false, true, false, false, false, true),
    mode: MARKING_MODE,
    pageSaveBlockedReason: "",
    curtain: HIDDEN_CURTAIN,
    toggleChecked: true
  }),
  preview_open: Object.freeze({
    buttons: ALL_ACTIONS_LOCKED,
    mode: MARKING_MODE,
    pageSaveBlockedReason: "busy",
    curtain: HIDDEN_CURTAIN,
    toggleChecked: true
  }),
  exit_restoring: Object.freeze({
    buttons: ALL_ACTIONS_LOCKED,
    mode: MARKING_MODE,
    pageSaveBlockedReason: "busy",
    curtain: HIDDEN_CURTAIN,
    toggleChecked: true
  }),
  // Overlays: lock the actions and narrate; the underlying MODE stays the
  // prior state's (mode: null keeps the current view).
  inspecting: Object.freeze({
    buttons: ALL_ACTIONS_LOCKED,
    mode: null,
    pageSaveBlockedReason: "busy",
    curtain: Object.freeze({
      visible: true,
      message: "Inspecting the page",
      note: "Working… controls are temporarily blocked.",
      operation: "busy",
      phase: "render_mode_inspection",
      timer: null
    } as const),
    toggleChecked: null
  }),
  reconciling: Object.freeze({
    buttons: ALL_ACTIONS_LOCKED,
    mode: null,
    pageSaveBlockedReason: "server_sync_pending",
    curtain: HIDDEN_CURTAIN,
    toggleChecked: null
  })
});

export function resolveMarkingSessionSurfaceMemory(
  state: MarkingSessionMachineState
): MarkingSessionSurfaceMemory {
  return MARKING_SESSION_SURFACE_MEMORY[state] ?? MARKING_SESSION_SURFACE_MEMORY.boot;
}
