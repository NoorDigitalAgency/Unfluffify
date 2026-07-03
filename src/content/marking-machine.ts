// REFLEX-ARC content marking machine (MAIN PLAN §3.2).
//
// Content is the EXECUTOR of the marking/preview/restore routines, so its
// machine steps at its own routine boundaries (begin preview, begin exit,
// settle) — the content-side mirror of the popup machine's action-site
// signals. The record folds what aiPreviewState previously carried as loose
// flags (active/mode/previousEnabled/restoreMarkingOnExit): the state names
// the routine, the two booleans are the ENTRY MEMORY the restoring routine
// replays on exit ("where do I return to").
//
// Like every reflex-arc machine: a predefined transition table, held (no-op)
// on anything not defined for the current state, and a complete memorized
// answer per state — no downstream re-derivation.

export type ContentMarkingMachineState =
  | "silent"
  | "marking"
  | "preview"
  | "compute_lock"
  | "restoring";

export type ContentMarkingStep =
  | "marking-enabled"
  | "marking-disabled"
  | "compute-lock-begun"
  | "preview-opened"
  | "exit-begun"
  | "exit-settled"
  | "navigated";

export type ContentMarkingMachine = Readonly<{
  state: ContentMarkingMachineState;
  // Entry memory captured when a preview/compute_lock routine begins: was
  // marking enabled at entry, and must the exit restore it regardless
  // (compute_lock always restores — its lock replaced the marking session).
  previousEnabled: boolean;
  restoreMarkingOnExit: boolean;
}>;

export const CONTENT_MARKING_MACHINE_INITIAL: ContentMarkingMachine = Object.freeze({
  state: "silent",
  previousEnabled: false,
  restoreMarkingOnExit: false,
});

export type ContentMarkingTransition = Readonly<{
  machine: ContentMarkingMachine;
  moved: boolean;
}>;

const held = (machine: ContentMarkingMachine): ContentMarkingTransition =>
  Object.freeze({ machine, moved: false });

const moved = (machine: ContentMarkingMachine): ContentMarkingTransition =>
  Object.freeze({ machine: Object.freeze(machine), moved: true });

// The exit destination is MEMORIZED at routine entry, not re-derived at exit:
// a preview entered from marking returns to marking; a compute_lock always
// returns to marking (its lock displaced the session); a silent-entered
// preview returns to silent.
export function resolveContentExitDestination(
  machine: ContentMarkingMachine
): Extract<ContentMarkingMachineState, "marking" | "silent"> {
  return machine.previousEnabled || machine.restoreMarkingOnExit ? "marking" : "silent";
}

export function stepContentMarkingMachine(
  machine: ContentMarkingMachine,
  step: ContentMarkingStep,
  detail: { enabledAtEntry?: boolean } = {}
): ContentMarkingTransition {
  const enabledAtEntry = Boolean(detail.enabledAtEntry);
  switch (step) {
    case "marking-enabled":
      if (machine.state !== "silent" && machine.state !== "marking") {
        return held(machine);
      }
      return machine.state === "marking"
        ? held(machine)
        : moved({ state: "marking", previousEnabled: false, restoreMarkingOnExit: false });
    case "marking-disabled":
      return machine.state === "marking"
        ? moved({ state: "silent", previousEnabled: false, restoreMarkingOnExit: false })
        : held(machine);
    case "compute-lock-begun":
      if (machine.state === "compute_lock" || machine.state === "restoring") {
        return held(machine);
      }
      // The AI-run lock: entered from marking (usual) or silent; ALWAYS
      // restores marking on exit — the lock displaced the marking session.
      return moved({
        state: "compute_lock",
        previousEnabled: machine.state === "preview" ? machine.previousEnabled : enabledAtEntry,
        restoreMarkingOnExit: true,
      });
    case "preview-opened":
      if (machine.state === "preview" || machine.state === "restoring") {
        return held(machine);
      }
      if (machine.state === "compute_lock") {
        // compute_lock -> preview keeps the lock's entry memory (the exit
        // still restores what the RUN displaced).
        return moved({
          state: "preview",
          previousEnabled: machine.previousEnabled,
          restoreMarkingOnExit: machine.restoreMarkingOnExit,
        });
      }
      return moved({
        state: "preview",
        previousEnabled: enabledAtEntry,
        restoreMarkingOnExit: false,
      });
    case "exit-begun":
      if (machine.state !== "preview" && machine.state !== "compute_lock") {
        return held(machine);
      }
      return moved({
        state: "restoring",
        previousEnabled: machine.previousEnabled,
        restoreMarkingOnExit: machine.restoreMarkingOnExit,
      });
    case "exit-settled": {
      if (machine.state !== "restoring") {
        return held(machine);
      }
      const destination = resolveContentExitDestination(machine);
      return moved({
        state: destination,
        previousEnabled: false,
        restoreMarkingOnExit: false,
      });
    }
    case "navigated":
      // A navigation tears the routines down wholesale; the fresh document
      // starts silent (the activation flow re-enters marking on its own).
      return machine.state === "silent"
        ? held(machine)
        : moved({ state: "silent", previousEnabled: false, restoreMarkingOnExit: false });
    default:
      return held(machine);
  }
}
