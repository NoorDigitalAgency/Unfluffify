export const FEATURE_DISABLED_REASON = "feature_disabled";

export const FEATURE_FLAGS: Readonly<Record<string, boolean>> = Object.freeze({
  desktopPreview: false,
  deviceEmulationToggle: false,
  traceDiagnostics: false,
  renderModeAutoDetection: false,
  appearanceCustomization: false,
  cacheAndUnregisterTools: false,
  propertyLockCollaboration: false,
  previewExpandedStates: false
});

export const DEBUG_FLAGS: Readonly<Record<string, boolean>> = Object.freeze({
  ufDebugSpinnerQueue: true,
  fullWorldMessagingLogging: false,
  worldTraceEnabled: false
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
