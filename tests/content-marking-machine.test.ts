import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import {
  CONTENT_MARKING_MACHINE_INITIAL,
  resolveContentExitDestination,
  stepContentMarkingMachine
} from "../src/content/marking-machine.js";

// REFLEX-ARC content machine (§3.2): content is the executor, so the machine
// steps at content's own routine boundaries. The exit destination is
// MEMORIZED at routine entry (previousEnabled/restoreMarkingOnExit) — the
// record that used to live as loose flags on aiPreviewState.

test("the marking-backed preview round trip returns to marking from memory", () => {
  let m = CONTENT_MARKING_MACHINE_INITIAL;
  m = stepContentMarkingMachine(m, "marking-enabled").machine;
  assert.equal(m.state, "marking");
  m = stepContentMarkingMachine(m, "preview-opened", { enabledAtEntry: true }).machine;
  assert.equal(m.state, "preview");
  assert.equal(m.previousEnabled, true);
  m = stepContentMarkingMachine(m, "exit-begun").machine;
  assert.equal(m.state, "restoring");
  assert.equal(resolveContentExitDestination(m), "marking");
  m = stepContentMarkingMachine(m, "exit-settled").machine;
  assert.equal(m.state, "marking", "the memorized destination");
  assert.equal(m.previousEnabled, false, "entry memory consumed");
});

test("a silent preview returns to silent; the machine remembers where it came from", () => {
  let m = CONTENT_MARKING_MACHINE_INITIAL;
  m = stepContentMarkingMachine(m, "preview-opened", { enabledAtEntry: false }).machine;
  assert.equal(m.state, "preview");
  m = stepContentMarkingMachine(m, "exit-begun").machine;
  assert.equal(resolveContentExitDestination(m), "silent");
  m = stepContentMarkingMachine(m, "exit-settled").machine;
  assert.equal(m.state, "silent");
});

test("compute_lock ALWAYS restores marking, and preview inherits the lock's memory", () => {
  let m = stepContentMarkingMachine(CONTENT_MARKING_MACHINE_INITIAL, "marking-enabled").machine;
  m = stepContentMarkingMachine(m, "compute-lock-begun", { enabledAtEntry: true }).machine;
  assert.equal(m.state, "compute_lock");
  assert.equal(m.restoreMarkingOnExit, true, "the lock displaced the session");
  // The run completes into the preview: the lock's entry memory carries over.
  m = stepContentMarkingMachine(m, "preview-opened").machine;
  assert.equal(m.state, "preview");
  assert.equal(m.restoreMarkingOnExit, true);
  m = stepContentMarkingMachine(m, "exit-begun").machine;
  assert.equal(resolveContentExitDestination(m), "marking");
  // Even a silent-entered compute_lock restores marking on exit.
  let s = stepContentMarkingMachine(CONTENT_MARKING_MACHINE_INITIAL, "compute-lock-begun", { enabledAtEntry: false }).machine;
  s = stepContentMarkingMachine(s, "exit-begun").machine;
  assert.equal(resolveContentExitDestination(s), "marking");
});

test("undefined steps are held: the executor cannot be moved by noise", () => {
  const preview = stepContentMarkingMachine(
    CONTENT_MARKING_MACHINE_INITIAL,
    "preview-opened",
    { enabledAtEntry: true }
  ).machine;
  // Re-entry and out-of-order settles hold.
  assert.equal(stepContentMarkingMachine(preview, "preview-opened").moved, false);
  assert.equal(stepContentMarkingMachine(preview, "exit-settled").moved, false);
  assert.equal(stepContentMarkingMachine(preview, "marking-enabled").moved, false);
  const restoring = stepContentMarkingMachine(preview, "exit-begun").machine;
  assert.equal(stepContentMarkingMachine(restoring, "preview-opened").moved, false);
  assert.equal(stepContentMarkingMachine(restoring, "compute-lock-begun").moved, false);
  assert.equal(stepContentMarkingMachine(restoring, "exit-begun").moved, false);
  assert.equal(stepContentMarkingMachine(CONTENT_MARKING_MACHINE_INITIAL, "exit-settled").moved, false);
  assert.equal(stepContentMarkingMachine(CONTENT_MARKING_MACHINE_INITIAL, "navigated").moved, false);
});

test("navigation tears every routine down to silent", () => {
  for (const build of [
    () => stepContentMarkingMachine(CONTENT_MARKING_MACHINE_INITIAL, "marking-enabled").machine,
    () => stepContentMarkingMachine(CONTENT_MARKING_MACHINE_INITIAL, "preview-opened", { enabledAtEntry: true }).machine,
    () => stepContentMarkingMachine(CONTENT_MARKING_MACHINE_INITIAL, "compute-lock-begun", { enabledAtEntry: true }).machine,
    () => {
      const p = stepContentMarkingMachine(CONTENT_MARKING_MACHINE_INITIAL, "preview-opened", { enabledAtEntry: true }).machine;
      return stepContentMarkingMachine(p, "exit-begun").machine;
    }
  ]) {
    const t = stepContentMarkingMachine(build(), "navigated");
    assert.equal(t.moved, true);
    assert.equal(t.machine.state, "silent");
    assert.equal(t.machine.previousEnabled, false);
    assert.equal(t.machine.restoreMarkingOnExit, false);
  }
});
