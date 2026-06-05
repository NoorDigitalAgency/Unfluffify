export const WORLD_MESSAGE_TYPES = Object.freeze({
  LIFECYCLE_EVENT: "ufLifecycleEvent",
  GET_BACKGROUND_STATE: "getUfBackgroundState",
  SPINNER_SET: "ufSpinnerSet",
  SPINNER_REMOVE: "ufSpinnerRemove",
  SPINNER_CLEAR: "ufSpinnerClear",
  BACKGROUND_STATE: "ufBackgroundState",
  TRACE_SET: "ufTraceSet",
  CONTENT_TRACE_SET: "setWorldTraceEnabled"
});

export const WORLD_PORTS = Object.freeze({
  POPUP_STATE_PREFIX: "ufPopupState:"
});

export const LIFECYCLE_KINDS = Object.freeze({
  ACTIVATION: "activation",
  CONTENT_READY: "content-ready",
  MODE: "mode",
  RENDER_MODE_INSPECTION: "render-mode-inspection",
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

export function buildPopupStatePortName(tabId) {
  return `${WORLD_PORTS.POPUP_STATE_PREFIX}${tabId}`;
}

export function isLifecycleTerminalPhase(phase) {
  return phase === LIFECYCLE_PHASES.FINISHED || phase === LIFECYCLE_PHASES.FAILED;
}
