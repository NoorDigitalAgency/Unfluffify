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

/** The device the mobile viewport corresponds to. 412x960 is a Pixel-class
 *  viewport, so the spoofed identity says the same thing the metrics do — a site
 *  that reads both must not find them contradicting each other. */
const MOBILE_DEVICE = {
  platform: "Android",
  platformVersion: "13",
  model: "Pixel 7",
} as const;

/** Chrome's real user agent, rewritten into the Android form of the SAME build.
 *
 *  The version is carried across rather than hard-coded on purpose: a UA claiming
 *  a Chrome version this browser is not would be caught by any server that
 *  cross-checks it against client hints or TLS behaviour, and it would rot with
 *  every Chrome release. Returns "" when the real UA carries no Chrome token —
 *  better to leave the UA alone than to assert a version we did not read. */
export function deriveMobileUserAgent(realUserAgent: string): string {
  const version = /Chrome\/([\d.]+)/.exec(realUserAgent)?.[1];
  if (!version) {
    return "";
  }
  return `Mozilla/5.0 (Linux; ${MOBILE_DEVICE.platform} ${MOBILE_DEVICE.platformVersion}; ${MOBILE_DEVICE.model}) `
    + `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`;
}

/** The client-hint half of the same claim. Sites increasingly read
 *  `navigator.userAgentData.mobile` instead of parsing the UA string, and one of
 *  the two saying "desktop" defeats the point of spoofing the other. */
export function deriveMobileUserAgentMetadata(realUserAgent: string): Record<string, unknown> | null {
  const fullVersion = /Chrome\/([\d.]+)/.exec(realUserAgent)?.[1];
  if (!fullVersion) {
    return null;
  }
  const major = fullVersion.split(".")[0];
  const brands = [
    { brand: "Chromium", version: major },
    { brand: "Google Chrome", version: major },
    { brand: "Not=A?Brand", version: "99" },
  ];
  return {
    brands,
    fullVersionList: brands.map((entry) => ({ brand: entry.brand, version: fullVersion })),
    fullVersion,
    platform: MOBILE_DEVICE.platform,
    platformVersion: MOBILE_DEVICE.platformVersion,
    architecture: "",
    model: MOBILE_DEVICE.model,
    mobile: true,
  };
}

export type CdpClient = Readonly<{
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}>;

export async function applyEmulationViaCdp(
  client: CdpClient,
  mode: EmulationMode,
  scale: number,
  options: Readonly<{ realUserAgent?: string }> = {},
): Promise<EmulationState> {
  const state = applyEmulation(mode, scale);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: state.width,
    height: state.height,
    deviceScaleFactor: 1,
    mobile: mode === "mobile",
    scale: state.scale,
  });
  // The viewport alone does not convince a site that sniffs identity rather than
  // measuring the window, and those sites serve a different page — which is the
  // page the crawler gets. Desktop restores the browser's own UA rather than
  // asserting a second fiction; with the metadata omitted the real client hints
  // come back with it.
  const realUserAgent = options.realUserAgent?.trim();
  if (!realUserAgent) {
    return state;
  }
  if (mode === "desktop") {
    await client.send("Emulation.setUserAgentOverride", { userAgent: realUserAgent });
    return state;
  }
  const userAgent = deriveMobileUserAgent(realUserAgent);
  if (!userAgent) {
    return state;
  }
  const userAgentMetadata = deriveMobileUserAgentMetadata(realUserAgent);
  await client.send("Emulation.setUserAgentOverride", {
    userAgent,
    platform: MOBILE_DEVICE.platform,
    ...(userAgentMetadata ? { userAgentMetadata } : {}),
  });
  return state;
}

export async function clearEmulationViaCdp(client: CdpClient, state: EmulationState): Promise<EmulationState> {
  await client.send("Emulation.clearDeviceMetricsOverride");
  return clearEmulation(state);
}
