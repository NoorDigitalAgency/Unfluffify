import type { EmulationMode } from "../content/stabilization";

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
  if (!input.recognized || input.heldMode === "desktop") {
    return null;
  }
  return {
    mode: "mobile",
    scale: 1,
    allowReload: input.heldMode !== "mobile",
  };
}
