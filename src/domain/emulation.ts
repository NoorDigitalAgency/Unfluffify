import { DEVICE_EMULATION_PRESETS, DEVICE_SCALE_LIMITS } from "./constants";

export type EmulationMode = keyof typeof DEVICE_EMULATION_PRESETS;

export function clampDeviceScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return DEVICE_SCALE_LIMITS.max;
  }
  return Math.min(DEVICE_SCALE_LIMITS.max, Math.max(DEVICE_SCALE_LIMITS.min, scale));
}

/** Fits the complete simulated screen inside the operator's visible tab. Width
 * and height are both authoritative: fitting only the mobile width can leave
 * the bottom of a 412×960 device physically outside a shorter browser viewport. */
export function fitDeviceScale(
  mode: EmulationMode,
  available: Readonly<{ width: number; height: number }> | null,
  maximumScale = 1,
): number {
  const cappedMaximum = clampDeviceScale(maximumScale);
  if (
    !available ||
    !Number.isFinite(available.width) ||
    !Number.isFinite(available.height) ||
    available.width <= 0 ||
    available.height <= 0
  ) {
    return cappedMaximum;
  }
  const preset = DEVICE_EMULATION_PRESETS[mode];
  // The preference clamp protects normal UI input, but it is not a physical
  // safety boundary. A short/narrow tab can genuinely need less than 0.25 to
  // keep the complete simulated screen visible. Never round that fit upward
  // into clipping; CDP accepts a positive fractional view scale.
  return Math.max(0.01, Math.min(
    cappedMaximum,
    available.width / preset.width,
    available.height / preset.height,
  ));
}
