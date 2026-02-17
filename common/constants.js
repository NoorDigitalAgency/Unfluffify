export const TAB_STATE_PREFIX = "tabState:";
export const DEVICE_EMULATION_PREFIX = "deviceEmulation:";
export const SCRIPT_INJECTED_PREFIX = "scriptInjected:";

export const DEVICE_SCALE_DEFAULTS = {
  desktop: 0.7,
  mobile: 0.85
};

export const DEVICE_EMULATION_PRESETS = {
  desktop: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  },
  mobile: {
    width: 412,
    height: 960,
    deviceScaleFactor: 1,
    mobile: true
  }
};

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
  "IFRAME",
  "VIDEO"
];

export const DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS = [
  "FOOTER",
  "FORM",
  "LABEL",
  "NAV",
  "HEADER",
  "DIALOG",
  "ASIDE"
];

export const DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS = DEFAULT_EXCLUDED_TAG_SELECTORS.filter(
  (selector) => !DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS.includes(selector)
);
