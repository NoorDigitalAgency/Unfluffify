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
  | "exit_restoring";

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
  | "navigated";

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
  exit_restoring: Object.freeze({ buttons: frozenButtons(true, true, true, true) })
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
  return MARKING_SESSION_STATE_MEMORY[state].buttons;
}
