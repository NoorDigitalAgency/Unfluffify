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

/** Google's documented smartphone crawler identity. The Chrome build is filled
 *  from the browser doing the rendering so the claimed engine and actual engine
 *  never drift apart. */
const GOOGLEBOT_SMARTPHONE = {
  platform: "Android",
  platformVersion: "6.0.1",
  model: "Nexus 5X",
  build: "MMB29P",
} as const;

const GOOGLEBOT_SMARTPHONE_MEDIA_FEATURES = [
  { name: "pointer", value: "coarse" },
  { name: "hover", value: "none" },
  { name: "any-pointer", value: "coarse" },
  { name: "any-hover", value: "none" },
] as const;

/** Desktop is also an explicit crawler-review posture. Clearing the mobile
 * features would delegate pointer/hover truth to the operator's hardware (and
 * makes a touch-capable laptop nondeterministic), so assert the desktop half of
 * the contract just as deliberately as the mobile half. */
const DESKTOP_MEDIA_FEATURES = [
  { name: "pointer", value: "fine" },
  { name: "hover", value: "hover" },
  { name: "any-pointer", value: "fine" },
  { name: "any-hover", value: "hover" },
] as const;

/** Chrome's real user agent, rewritten into the Android form of the SAME build.
 *
 *  The version is carried across rather than hard-coded on purpose: a UA claiming
 *  a Chrome version this browser is not would be caught by any server that
 *  cross-checks it against client hints or TLS behaviour, and it would rot with
 *  every Chrome release. Returns "" when the real UA carries no Chrome token —
 *  better to leave the UA alone than to assert a version we did not read. */
export function deriveGooglebotSmartphoneUserAgent(realUserAgent: string): string {
  const version = /Chrome\/([\d.]+)/.exec(realUserAgent)?.[1];
  if (!version) {
    return "";
  }
  return `Mozilla/5.0 (Linux; ${GOOGLEBOT_SMARTPHONE.platform} ${GOOGLEBOT_SMARTPHONE.platformVersion}; `
    + `${GOOGLEBOT_SMARTPHONE.model} Build/${GOOGLEBOT_SMARTPHONE.build}) AppleWebKit/537.36 `
    + `(KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36 `
    + `(compatible; Googlebot/2.1; +http://www.google.com/bot.html)`;
}

/** The client-hint half of the same claim. Sites increasingly read
 *  `navigator.userAgentData.mobile` instead of parsing the UA string, and one of
 *  the two saying "desktop" defeats the point of spoofing the other. */
export function deriveGooglebotSmartphoneUserAgentMetadata(realUserAgent: string): Record<string, unknown> | null {
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
    platform: GOOGLEBOT_SMARTPHONE.platform,
    platformVersion: GOOGLEBOT_SMARTPHONE.platformVersion,
    architecture: "",
    model: GOOGLEBOT_SMARTPHONE.model,
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
  // Chrome can retain the compositor page scale chosen for the previous
  // desktop/mobile posture even after device metrics change. Reset it on every
  // explicit transition so a 412×960 device is also a 412×960 layout viewport.
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await client.send("Emulation.setTouchEmulationEnabled", mode === "mobile"
    ? { enabled: true, maxTouchPoints: 1 }
    : { enabled: false });
  await client.send("Emulation.setEmulatedMedia", {
    media: "",
    features: mode === "mobile"
      ? [...GOOGLEBOT_SMARTPHONE_MEDIA_FEATURES]
      : [...DESKTOP_MEDIA_FEATURES],
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
  const userAgent = deriveGooglebotSmartphoneUserAgent(realUserAgent);
  if (!userAgent) {
    return state;
  }
  const userAgentMetadata = deriveGooglebotSmartphoneUserAgentMetadata(realUserAgent);
  await client.send("Emulation.setUserAgentOverride", {
    userAgent,
    platform: GOOGLEBOT_SMARTPHONE.platform,
    ...(userAgentMetadata ? { userAgentMetadata } : {}),
  });
  return state;
}

export async function clearEmulationViaCdp(client: CdpClient, state: EmulationState): Promise<EmulationState> {
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await client.send("Emulation.setEmulatedMedia", { media: "", features: [] });
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await client.send("Emulation.clearDeviceMetricsOverride");
  return clearEmulation(state);
}
