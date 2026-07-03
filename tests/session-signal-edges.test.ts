import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { wrapMutateWithSessionSignalEdges } from "../src/background/brain/session-signal-edges.js";
import { SESSION_PHASES } from "../src/common/bus/contracts/session-state.js";
import { SIGNAL_NAMES, type SignalEmitPayload } from "../src/common/bus/contracts/signals.js";
import type { TabLayerState } from "../src/background/brain/state-store.js";

// REFLEX-ARC pairing guarantee: inspection/reconciliation signals are strict
// started->ended pairs observed at the store's mutate choke point. The live
// wedge this guards against (2026-07-03): the dictation phase left
// render_mode_inspection through a mutate path OUTSIDE foldSessionFacts, no
// inspection.ended was ever emitted, and the popup sat behind the
// "Inspecting the page" overlay until a navigation.

type Harness = {
  mutate: ReturnType<typeof wrapMutateWithSessionSignalEdges>;
  emitted: Array<{ tabId: number; emit: SignalEmitPayload }>;
  tabs: Map<number, TabLayerState>;
};

function makeHarness(): Harness {
  const tabs = new Map<number, TabLayerState>();
  const emitted: Harness["emitted"] = [];
  const rawMutate = (tabId: number, _reason: string, fn: (state: TabLayerState) => void) => {
    let state = tabs.get(tabId);
    if (!state) {
      state = {
        sessionFacts: {},
        sessionDictation: null,
      } as unknown as TabLayerState;
      tabs.set(tabId, state);
    }
    fn(state);
    return state;
  };
  const mutate = wrapMutateWithSessionSignalEdges(rawMutate, (tabId, emit) => {
    emitted.push({ tabId, emit });
  });
  return { mutate, emitted, tabs };
}

function setPhase(state: TabLayerState, phase: string | null): void {
  (state as { sessionDictation: unknown }).sessionDictation = phase === null
    ? null
    : { phase };
}

test("a phase flip through ANY mutate path emits the paired signal (wedge regression)", () => {
  const h = makeHarness();
  // Entry via a fold-like mutation.
  h.mutate(7, "fold", (draft) => setPhase(draft, SESSION_PHASES.RENDER_MODE_INSPECTION));
  assert.equal(h.emitted.length, 1);
  assert.equal(h.emitted[0].emit.name, SIGNAL_NAMES.INSPECTION_STARTED);
  assert.equal(h.emitted[0].emit.cause, "render-mode-inspection-phase");
  // Exit via a DIFFERENT path (curtain clear, lifecycle mirror, ...): the
  // closing -ended must still be born.
  h.mutate(7, "nav-curtain-clear", (draft) => setPhase(draft, null));
  assert.equal(h.emitted.length, 2);
  assert.equal(h.emitted[1].emit.name, SIGNAL_NAMES.INSPECTION_ENDED);
});

test("reconciliation pending flips pair the same way, with the reason payload", () => {
  const h = makeHarness();
  h.mutate(7, "fold", (draft) => {
    draft.sessionFacts = {
      ...draft.sessionFacts,
      pageSaveReconciliationPending: true,
      pageSaveReconciliationReason: "editor_preparing",
    };
  });
  h.mutate(7, "other-path", (draft) => {
    draft.sessionFacts = { ...draft.sessionFacts, pageSaveReconciliationPending: false };
  });
  assert.equal(h.emitted.length, 2);
  assert.equal(h.emitted[0].emit.name, SIGNAL_NAMES.RECONCILIATION_STARTED);
  assert.equal(h.emitted[0].emit.payload?.reason, "editor_preparing");
  assert.equal(h.emitted[0].emit.cause, "save-lifecycle");
  assert.equal(h.emitted[1].emit.name, SIGNAL_NAMES.RECONCILIATION_ENDED);
});

test("no flip, no emission — value churn cannot double-fire the pair", () => {
  const h = makeHarness();
  h.mutate(7, "fold", (draft) => setPhase(draft, SESSION_PHASES.RENDER_MODE_INSPECTION));
  h.mutate(7, "fold", (draft) => setPhase(draft, SESSION_PHASES.RENDER_MODE_INSPECTION));
  h.mutate(7, "unrelated", (draft) => {
    draft.sessionFacts = { ...draft.sessionFacts, busyVisible: true };
  });
  assert.equal(h.emitted.length, 1, "only the entry edge emitted");
});

test("pair members carry a per-cycle payload + dedupeKey so the 250ms admission window cannot drop a closing edge", () => {
  const h = makeHarness();
  const flip = (phase: string | null) =>
    h.mutate(7, "flap", (draft) => setPhase(draft, phase));
  flip(SESSION_PHASES.RENDER_MODE_INSPECTION);
  flip(null);
  flip(SESSION_PHASES.RENDER_MODE_INSPECTION);
  flip(null);
  assert.equal(h.emitted.length, 4);
  const [s1, e1, s2, e2] = h.emitted.map((entry) => entry.emit);
  assert.equal(s1.payload?.cycle, 1);
  assert.equal(e1.payload?.cycle, 1, "ended carries its started's cycle");
  assert.equal(s2.payload?.cycle, 2);
  assert.equal(e2.payload?.cycle, 2);
  // Distinct payloads + dedupeKeys across cycles: admission Rule 1
  // (name+cause+payload within the window) and Rule 2 (same dedupeKey) can
  // only ever drop a true double-fire of the SAME edge.
  assert.notEqual(s1.dedupeKey, s2.dedupeKey);
  assert.notEqual(e1.dedupeKey, e2.dedupeKey);
  assert.notEqual(s1.dedupeKey, e1.dedupeKey);
});

test("independent tabs keep independent cycles", () => {
  const h = makeHarness();
  h.mutate(1, "fold", (draft) => setPhase(draft, SESSION_PHASES.RENDER_MODE_INSPECTION));
  h.mutate(2, "fold", (draft) => setPhase(draft, SESSION_PHASES.RENDER_MODE_INSPECTION));
  assert.equal(h.emitted[0].tabId, 1);
  assert.equal(h.emitted[1].tabId, 2);
  assert.equal(h.emitted[0].emit.payload?.cycle, 1);
  assert.equal(h.emitted[1].emit.payload?.cycle, 1);
});

test("both edges from ONE mutation emit together (save fold flips reconciliation off and inspection on)", () => {
  const h = makeHarness();
  h.mutate(7, "fold", (draft) => {
    draft.sessionFacts = { ...draft.sessionFacts, pageSaveReconciliationPending: true };
  });
  h.emitted.length = 0;
  // The 2026-07-03 wedge's first half: one fold pass ended the reconciliation
  // AND entered the inspection phase.
  h.mutate(7, "save-finish-fold", (draft) => {
    draft.sessionFacts = { ...draft.sessionFacts, pageSaveReconciliationPending: false };
    setPhase(draft, SESSION_PHASES.RENDER_MODE_INSPECTION);
  });
  assert.deepEqual(
    h.emitted.map((entry) => entry.emit.name),
    [SIGNAL_NAMES.RECONCILIATION_ENDED, SIGNAL_NAMES.INSPECTION_STARTED]
  );
});
