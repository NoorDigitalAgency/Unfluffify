import type { EmulationMode } from "../domain/emulation";

export type ManagedEmulationDecision = Readonly<{
  mode: "mobile";
  scale: 1;
  allowReload: boolean;
}>;

/** Desktop is permitted only as an already-held silent-preview exception. */
export function managedEmulationDecision(input: Readonly<{
  recognized: boolean;
  heldMode: EmulationMode | null;
}>): ManagedEmulationDecision | null {
  // A held posture is durable background authority. Rewriting the same mobile
  // metrics on every page-context refresh creates a visible size flash; an
  // explicit desktop preview must likewise remain untouched.
  if (!input.recognized || input.heldMode !== null) {
    return null;
  }
  return {
    mode: "mobile",
    scale: 1,
    allowReload: input.heldMode !== "mobile",
  };
}
