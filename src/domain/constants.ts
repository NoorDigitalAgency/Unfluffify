export const EXTENSION_UI_FONT_STACK =
  "\"Inter\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif";

export const TAB_STATE_PREFIX = "tabState:";
export const DEVICE_EMULATION_PREFIX = "deviceEmulation:";
export const SCRIPT_INJECTED_PREFIX = "scriptInjected:";
export const SPINNER_QUEUE_PREFIX = "spinnerQueue:";

export const DEVICE_SCALE_DEFAULTS = {
  desktop: 0.7,
  mobile: 0.85,
} as const;

export const DEVICE_EMULATION_PRESETS = {
  desktop: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  },
  mobile: {
    width: 412,
    height: 960,
    deviceScaleFactor: 1,
    mobile: true,
  },
} as const;

// Verbatim contract transcription from src/common/constants.ts (INV-2.1..2.4).
export const DEFAULT_EXCLUDED_TAG_SELECTORS = [
  "IMG",
  "FOOTER",
  "FORM",
  "BUTTON",
  "INPUT",
  "LABEL",
  "NAV",
  "HEADER",
  "NOSCRIPT",
  "DIALOG",
  "ASIDE",
  "SELECT",
  "TITLE",
  "STYLE",
  "SCRIPT",
  "TEMPLATE",
  "IFRAME",
  "VIDEO",
  "SVG",
] as const;

export const DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS = [
  "FOOTER",
  "FORM",
  "LABEL",
  "NAV",
  "HEADER",
  "DIALOG",
  "ASIDE",
  "BUTTON",
] as const;

export const DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS = [
  "IMG",
  "INPUT",
  "NOSCRIPT",
  "SELECT",
  "TITLE",
  "STYLE",
  "SCRIPT",
  "TEMPLATE",
  "IFRAME",
  "VIDEO",
  "SVG",
] as const;

export const DEFAULT_SUBMISSION_VIEWPORT = {
  width: DEVICE_EMULATION_PRESETS.mobile.width,
  height: DEVICE_EMULATION_PRESETS.mobile.height,
} as const;

export const DEVICE_SCALE_LIMITS = {
  min: 0.25,
  max: 1,
} as const;
