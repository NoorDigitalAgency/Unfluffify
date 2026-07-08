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

export type CdpClient = Readonly<{
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}>;

export async function applyEmulationViaCdp(
  client: CdpClient,
  mode: EmulationMode,
  scale: number,
): Promise<EmulationState> {
  const state = applyEmulation(mode, scale);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: state.width,
    height: state.height,
    deviceScaleFactor: 1,
    mobile: mode === "mobile",
    scale: state.scale,
  });
  return state;
}

export async function clearEmulationViaCdp(client: CdpClient, state: EmulationState): Promise<EmulationState> {
  await client.send("Emulation.clearDeviceMetricsOverride");
  return clearEmulation(state);
}
