// @ts-nocheck
export const FEATURE_DISABLED_REASON = "feature_disabled";

export const FEATURE_FLAGS = Object.freeze({
  desktopPreview: false,
  deviceEmulationToggle: false,
  traceDiagnostics: false,
  renderModeAutoDetection: false,
  appearanceCustomization: false,
  cacheAndUnregisterTools: false,
  propertyLockCollaboration: false,
  previewExpandedStates: false
});

export const DEBUG_FLAGS = Object.freeze({
  ufDebugSpinnerQueue: true,
  fullWorldMessagingLogging: false,
  worldTraceEnabled: false
});

export function isFeatureEnabled(flagName) {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, flagName) &&
    FEATURE_FLAGS[flagName] === true;
}

export function getFeatureFlags() {
  return Object.freeze({ ...FEATURE_FLAGS });
}

export function isDebugFlagEnabled(flagName) {
  return Object.prototype.hasOwnProperty.call(DEBUG_FLAGS, flagName) &&
    DEBUG_FLAGS[flagName] === true;
}

export function getDebugFlags() {
  return Object.freeze({ ...DEBUG_FLAGS });
}
