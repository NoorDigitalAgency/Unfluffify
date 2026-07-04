export const FEATURE_DISABLED_REASON = "feature_disabled";

export const FEATURE_FLAGS: Readonly<Record<string, boolean>> = Object.freeze({
  desktopPreview: false,
  deviceEmulationToggle: false,
  traceDiagnostics: false,
  renderModeAutoDetection: false,
  appearanceCustomization: false,
  cacheAndUnregisterTools: false,
  propertyLockCollaboration: false,
  previewExpandedStates: false,
  pageTypesChangeDetection: false,
  // Page-type assignment submission to the AI server: the backend endpoint
  // is not live yet, so every submit raised a 404 alongside the selector
  // submission. Enable once the backend ships.
  pageTypeAssignments: false
});

export const DEBUG_FLAGS: Readonly<Record<string, boolean>> = Object.freeze({
  ufDebugSpinnerQueue: true,
  fullWorldMessagingLogging: false,
  worldTraceEnabled: false,
  swLifecycleDiagnostics: false,
  layerMessageTrace: false
});

export function isFeatureEnabled(flagName: string): boolean {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, flagName) &&
    FEATURE_FLAGS[flagName] === true;
}

export function getFeatureFlags(): Readonly<Record<string, boolean>> {
  return Object.freeze({ ...FEATURE_FLAGS });
}

export function isDebugFlagEnabled(flagName: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEBUG_FLAGS, flagName) &&
    DEBUG_FLAGS[flagName] === true;
}

export function getDebugFlags(): Readonly<Record<string, boolean>> {
  return Object.freeze({ ...DEBUG_FLAGS });
}

/**
 * Whether this is a debug build in which debug-only affordances (e.g. the
 * `?directMode=1` popup query param) may be honored. True in the dev server
 * (`import.meta.env.DEV`) or when built with `UNFLUFFIFY_DEBUG=1` (which defines
 * the compile-time `__UF_DEBUG_BUILD__` constant). A plain `pnpm build` yields
 * false, so nothing debug-only is honored in a production build.
 */
export function isDebugBuild(): boolean {
  try {
    const meta = import.meta as unknown as { env?: { DEV?: boolean } };
    if (meta && meta.env && meta.env.DEV === true) {
      return true;
    }
  } catch {
    // import.meta.env not available in this context; fall through.
  }
  // `typeof` guard keeps this safe where Vite has not defined the constant
  // (e.g. the vitest runtime), avoiding a ReferenceError.
  return typeof __UF_DEBUG_BUILD__ !== "undefined" && __UF_DEBUG_BUILD__ === true;
}
