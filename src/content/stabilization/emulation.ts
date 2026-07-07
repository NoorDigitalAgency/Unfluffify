import { DEVICE_EMULATION_PRESETS, DEVICE_SCALE_LIMITS } from "../../domain/constants";

export type EmulationMode = "mobile" | "desktop";

export type EmulationState = Readonly<{
  mode: EmulationMode;
  width: number;
  height: number;
  scale: number;
  active: boolean;
}>;

export function clampDeviceScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return DEVICE_SCALE_LIMITS.max;
  }
  return Math.min(DEVICE_SCALE_LIMITS.max, Math.max(DEVICE_SCALE_LIMITS.min, scale));
}

export function applyEmulation(mode: EmulationMode, scale: number): EmulationState {
  const preset = DEVICE_EMULATION_PRESETS[mode];
  return {
    mode,
    width: preset.width,
    height: preset.height,
    scale: clampDeviceScale(scale),
    active: true,
  };
}

export function clearEmulation(state: EmulationState): EmulationState {
  return { ...state, active: false };
}
