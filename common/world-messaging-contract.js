export const WORLD_MESSAGE_TYPES = Object.freeze({
  LIFECYCLE_EVENT: "ufLifecycleEvent",
  SPINNER_SET: "ufSpinnerSet",
  SPINNER_REMOVE: "ufSpinnerRemove",
  SPINNER_CLEAR: "ufSpinnerClear",
  BACKGROUND_STATE: "ufBackgroundState"
});

export const WORLD_PORTS = Object.freeze({
  POPUP_STATE_PREFIX: "ufPopupState:"
});

export const LIFECYCLE_KINDS = Object.freeze({
  ACTIVATION: "activation",
  CONTENT_READY: "content-ready",
  MODE: "mode",
  RENDER_MODE_INSPECTION: "render-mode-inspection",
  SILENT_HIGHLIGHTING: "silent-highlighting",
  UNKNOWN: "unknown"
});

export const LIFECYCLE_PHASES = Object.freeze({
  STARTED: "started",
  REVEAL_STARTED: "reveal-started",
  REVEAL_FINISHED: "reveal-finished",
  HTML_CAPTURED: "html-captured",
  FINISHED: "finished",
  FAILED: "failed",
  UNKNOWN: "unknown"
});

export const CONTENT_MODES = Object.freeze({
  MARKING: "marking",
  SILENT: "silent"
});

export const SPINNER_OWNERS = Object.freeze({
  POPUP: "popup"
});

// Well-known spinner queue keys shared across worlds. The navigation-inspection
// curtain is pushed as a persistent spinner so it survives a popup close while
// an inspection is genuinely in flight; background clears it authoritatively
// when the owning lifecycle (inspection/activation) reaches a terminal phase.
export const SPINNER_KEYS = Object.freeze({
  NAV_INSPECT: "navInspect"
});

// Lifecycle kinds whose terminal phase (finished/failed) means the page
// inspection curtain should be torn down. Other terminal kinds (e.g.
// content-ready, which fires on every load) must not clear the curtain.
export const CURTAIN_BEARING_LIFECYCLE_KINDS = Object.freeze([
  LIFECYCLE_KINDS.ACTIVATION,
  LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
  LIFECYCLE_KINDS.SILENT_HIGHLIGHTING
]);

export function isCurtainBearingLifecycleKind(kind) {
  return CURTAIN_BEARING_LIFECYCLE_KINDS.includes(kind);
}

export function buildPopupStatePortName(tabId) {
  return `${WORLD_PORTS.POPUP_STATE_PREFIX}${tabId}`;
}

export function isLifecycleTerminalPhase(phase) {
  return phase === LIFECYCLE_PHASES.FINISHED || phase === LIFECYCLE_PHASES.FAILED;
}
