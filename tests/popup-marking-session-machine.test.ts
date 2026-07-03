import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import {
  MARKING_SESSION_STATE_MEMORY,
  MARKING_SESSION_SURFACE_MEMORY,
  adoptMarkingSessionState,
  resolveMarkingSessionButtonsMemory,
  resolveMarkingSessionSurfaceMemory,
  stepMarkingSession,
  transitionMarkingSessionState
} from "../src/popup/marking-session-machine.js";

// REFLEX-ARC session machine: the popup holds ONE marking-session state;
// discrete signals move it through a predefined table ("I am in state A, this
// signal puts me in state E") and each state's complete presentation applies
// from memory. Facts/heartbeats/dictation churn are not signals: no signal, no
// move — the surface can neither flicker nor strand in a wrong end state.

test("the happy path is fully memorized: enable -> mark -> run -> preview -> exit", () => {
  let s = transitionMarkingSessionState("silent", "marking-enabled");
  assert.equal(s.to, "pre_ai_clean");
  s = transitionMarkingSessionState(s.to, "markings-changed");
  assert.equal(s.to, "pre_ai_dirty");
  s = transitionMarkingSessionState(s.to, "run-started");
  assert.equal(s.to, "running");
  s = transitionMarkingSessionState(s.to, "post-ai-preview-opened");
  assert.equal(s.to, "preview_open");
  s = transitionMarkingSessionState(s.to, "exit-clicked");
  assert.equal(s.to, "exit_restoring");
  s = transitionMarkingSessionState(s.to, "exit-settled");
  assert.equal(s.to, "post_ai_clean", "the memorized post-exit answer: Save/Show/Discard");
});

test("post-exit follow-ups are memorized transitions", () => {
  assert.equal(transitionMarkingSessionState("post_ai_clean", "markings-changed").to, "pre_ai_dirty");
  assert.equal(transitionMarkingSessionState("post_ai_clean", "saved").to, "silent");
  assert.equal(transitionMarkingSessionState("post_ai_clean", "discarded").to, "pre_ai_clean");
  assert.equal(transitionMarkingSessionState("post_ai_clean", "preview-opened").to, "preview_open");
  assert.equal(transitionMarkingSessionState("running", "run-failed").to, "pre_ai_dirty");
});

test("the machine remembers where a preview came from", () => {
  // Marking-backed preview exit lands in post_ai_clean...
  assert.equal(transitionMarkingSessionState("preview_open", "exit-settled").to, "post_ai_clean");
  assert.equal(transitionMarkingSessionState("exit_restoring", "exit-settled").to, "post_ai_clean");
  // ...a Silent Preview exit lands back in silent.
  assert.equal(transitionMarkingSessionState("silent", "preview-opened").to, "silent_preview");
  assert.equal(transitionMarkingSessionState("silent_preview", "exit-settled").to, "silent");
});

test("non-signals cannot move the machine (noise immunity)", () => {
  // A signal not defined for the current state holds the state: a spurious
  // 'exit-settled' in pre_ai_clean, a duplicate 'run-started' mid-run, etc.
  const held = transitionMarkingSessionState("pre_ai_clean", "exit-settled");
  assert.equal(held.moved, false);
  assert.equal(held.to, "pre_ai_clean");
  const dupRun = transitionMarkingSessionState("running", "run-started");
  assert.equal(dupRun.moved, false);
  // post_ai_clean survives anything that is not one of its defined signals —
  // the +45s spurious requires_ai_run level flip of rounds 9/10 has no signal
  // and therefore no effect.
  const spurious = transitionMarkingSessionState("post_ai_clean", "exit-settled");
  assert.equal(spurious.moved, false);
});

test("every state has a complete frozen memory; silent surfaces stay brain-owned", () => {
  for (const [name, memory] of Object.entries(MARKING_SESSION_STATE_MEMORY)) {
    assert.ok(Object.isFrozen(memory), `${name} memory frozen`);
    if (memory.buttons) {
      assert.ok(Object.isFrozen(memory.buttons), `${name} matrix frozen`);
      assert.deepEqual(
        Object.keys(memory.buttons).sort(),
        ["computeButtonDisabled", "markingPreviewDisabled", "pageRevertDisabled", "pageSaveDisabled"],
        `${name} matrix complete`
      );
    }
  }
  assert.equal(resolveMarkingSessionButtonsMemory("silent"), null);
  assert.equal(resolveMarkingSessionButtonsMemory("boot"), null);
  assert.deepEqual(resolveMarkingSessionButtonsMemory("post_ai_clean"), {
    computeButtonDisabled: true,
    markingPreviewDisabled: false,
    pageSaveDisabled: false,
    pageRevertDisabled: false
  });
  assert.deepEqual(resolveMarkingSessionButtonsMemory("pre_ai_dirty"), {
    computeButtonDisabled: false,
    markingPreviewDisabled: true,
    pageSaveDisabled: true,
    pageRevertDisabled: false
  });
});

test("boot adoption derives the starting state once, from the projected snapshot", () => {
  assert.equal(
    adoptMarkingSessionState({ markingActive: false, previewOpen: false, restorePending: false, runInFlight: false, postAi: false, dirty: false }),
    "silent"
  );
  assert.equal(
    adoptMarkingSessionState({ markingActive: true, previewOpen: false, restorePending: false, runInFlight: false, postAi: true, dirty: false }),
    "post_ai_clean"
  );
  assert.equal(
    adoptMarkingSessionState({ markingActive: true, previewOpen: true, restorePending: false, runInFlight: false, postAi: true, dirty: false }),
    "preview_open"
  );
  assert.equal(
    adoptMarkingSessionState({ markingActive: true, previewOpen: false, restorePending: true, runInFlight: false, postAi: true, dirty: false }),
    "exit_restoring"
  );
  assert.equal(
    adoptMarkingSessionState({ markingActive: true, previewOpen: false, restorePending: false, runInFlight: true, postAi: false, dirty: true }),
    "running"
  );
});

// P2: overlay states render on top of a remembered prior and return to it;
// session signals during an overlay move the PRIOR (the session continues
// underneath the presentation).
test("overlays remember the prior state and return to it", () => {
  const m = { state: "post_ai_clean" as const, priorState: null };
  let s = stepMarkingSession(m, "inspection-started");
  assert.deepEqual(s.machine, { state: "inspecting", priorState: "post_ai_clean" });
  // Switching overlays keeps the ORIGINAL prior.
  s = stepMarkingSession(s.machine, "reconciliation-started");
  assert.deepEqual(s.machine, { state: "reconciling", priorState: "post_ai_clean" });
  // Non-matching -ended is held; matching returns to prior.
  assert.equal(stepMarkingSession(s.machine, "inspection-ended").moved, false);
  s = stepMarkingSession(s.machine, "reconciliation-ended");
  assert.deepEqual(s.machine, { state: "post_ai_clean", priorState: null });
});

test("session signals during an overlay transition the prior state", () => {
  let s = stepMarkingSession({ state: "post_ai_clean", priorState: null }, "reconciliation-started");
  s = stepMarkingSession(s.machine, "markings-changed");
  assert.deepEqual(s.machine, { state: "reconciling", priorState: "pre_ai_dirty" });
  s = stepMarkingSession(s.machine, "reconciliation-ended");
  assert.equal(s.machine.state, "pre_ai_dirty", "the session moved underneath the overlay");
  // Duplicate overlay entry is held; unknown session signal under overlay is held.
  const held = stepMarkingSession({ state: "inspecting", priorState: "silent" }, "inspection-started");
  assert.equal(held.moved, false);
});

// P2: every state carries a COMPLETE frozen full-surface memory (buttons incl.
// toggle lock + visibility, mode, save reason, curtain content). boot and the
// overlay MODE are the only pass-through (null) surfaces.
test("full-surface memories are complete, frozen, and faithful to the steady matrices", () => {
  for (const [name, memory] of Object.entries(MARKING_SESSION_SURFACE_MEMORY)) {
    assert.ok(Object.isFrozen(memory), `${name} surface frozen`);
    if (name === "boot") {
      assert.equal(memory.buttons, null);
      assert.equal(memory.mode, null);
      assert.equal(memory.curtain, null);
      continue;
    }
    assert.ok(memory.buttons, `${name} owns its buttons`);
    assert.deepEqual(
      Object.keys(memory.buttons!).sort(),
      [
        "computeButtonDisabled",
        "computeButtonLoading",
        "markingPreviewDisabled",
        "markingPreviewVisible",
        "pageRevertDisabled",
        "pageSaveDisabled",
        "toggleEnabledDisabled"
      ],
      `${name} button surface complete`
    );
    assert.ok(memory.curtain, `${name} owns its curtain`);
  }
  // The running curtain narrates from memory with the machine countdown.
  const running = resolveMarkingSessionSurfaceMemory("running");
  assert.deepEqual(running.curtain, {
    visible: true,
    message: "Computing selectors",
    note: "Waiting for AI results",
    operation: "computing_ai",
    phase: "computing_ai",
    timer: "run-countdown"
  });
  assert.equal(running.pageSaveBlockedReason, "busy");
  assert.equal(running.buttons?.computeButtonLoading, true);
  // The P0 four-bit matrices stay consistent with the full surface.
  const postAi = resolveMarkingSessionSurfaceMemory("post_ai_clean");
  assert.equal(postAi.buttons?.pageSaveDisabled, false);
  assert.equal(postAi.buttons?.toggleEnabledDisabled, true, "post-AI locks the toggle while active");
  assert.equal(resolveMarkingSessionSurfaceMemory("silent").buttons?.toggleEnabledDisabled, false);
  assert.equal(resolveMarkingSessionSurfaceMemory("pre_ai_dirty").pageSaveBlockedReason, "requires_ai_run");
});

// Source contracts: the machine is fed by discrete signals at the popup's own
// action sites, and its memory is applied at both dictation entry points.
test("signals are wired at the discrete call sites and memory applies at both patch sites", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  for (const wiring of [
    /bumpMarkingSessionEpoch\(\);\s*signalMarkingSession\("run-started"\);/,
    /bumpMarkingSessionEpoch\(\);\s*signalMarkingSession\("exit-settled"\);/,
    /signalMarkingSession\("marking-enabled"\);/,
    /signalMarkingSession\("marking-disabled"\);/,
    /signalMarkingSession\("post-ai-preview-opened"\);/,
    /signalMarkingSession\("preview-opened"\);/,
    /signalMarkingSession\("exit-clicked"\);/,
    /signalMarkingSession\("saved"\);/,
    /signalMarkingSession\("discarded"\);/,
    /signalMarkingSession\("navigated"\);/,
    /signalMarkingSession\("run-failed"\);/,
    /signalMarkingSession\("markings-changed"\);/
  ]) {
    assert.match(popupSource, wiring);
  }
  assert.match(
    popupSource,
    /overrideDictatedPreviewVisibility\(nextViewState\);\s*overrideDictatedMarkingButtons\(nextViewState\);/
  );
  assert.match(
    popupSource,
    /overrideDictatedPreviewVisibility\(snapshotPatch\);\s*overrideDictatedMarkingButtons\(snapshotPatch\);/
  );
  // The 'markings-changed' signal is an EDGE (clean -> dirty), never a level.
  assert.match(
    popupSource,
    /const dirtyEdge = !state\.currentDraftDirty && Boolean\(draftStatus\.dirty\);[\s\S]{0,700}if \(dirtyEdge\) \{[\s\S]{0,400}signalMarkingSession\("markings-changed"\);/
  );
});
