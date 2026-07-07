import type { MarkMode } from "./schema/marking";

export type MarkModeInput = Readonly<{
  enabled: boolean;
  hasOverlay: boolean;
  temporarilyDisabled: boolean;
  passThrough: boolean;
  altActive: boolean;
}>;

export function deriveMarkMode(input: MarkModeInput): MarkMode {
  if (!input.enabled || !input.hasOverlay || input.temporarilyDisabled) {
    return "disabled";
  }
  if (input.passThrough) {
    return "passthrough";
  }
  if (input.altActive) {
    return "include";
  }
  return "exclude";
}

export function resetHeldModifierLatches(): Readonly<{
  altActive: false;
  shiftActive: false;
  passThrough: false;
}> {
  return {
    altActive: false,
    shiftActive: false,
    passThrough: false,
  };
}
