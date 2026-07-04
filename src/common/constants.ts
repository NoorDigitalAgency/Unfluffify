// Shared font stack for extension-owned UI that is injected into the page
// (toasts, banners, notices, popovers, motion-pause indicator text). Page-world
// injected styles cannot read the popup theme's `--font-sans` custom property,
// so this mirrors it as a literal. Keep it aligned with `--font-sans` in
// theme-color.css so extension chrome looks uniform everywhere.
export const EXTENSION_UI_FONT_STACK =
  "\"Inter\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif";

export const TAB_STATE_PREFIX = "tabState:";
export const DEVICE_EMULATION_PREFIX = "deviceEmulation:";
export const SCRIPT_INJECTED_PREFIX = "scriptInjected:";
export const SPINNER_QUEUE_PREFIX = "spinnerQueue:";

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

/**
 * Tags that are excluded by default. Some are immutable; others are user-
 * toggleable default boundaries.
 * @private
 */
const DEFAULT_EXCLUDED_TAG_SELECTORS = [
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
  "SVG"
];

/**
 * Tags that can be toggled between excluded and included by users.
 * This taxonomy is part of the locked marking contract.
 * Do not change it without an explicit marking-rules contract change.
 * @type {string[]}
 */
export const DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS = [
  "FOOTER",
  "FORM",
  "LABEL",
  "NAV",
  "HEADER",
  "DIALOG",
  "ASIDE",
  "BUTTON"
];

/**
 * Tags that are immutably excluded (cannot be toggled).
 * Computed as the difference between all default excluded tags and toggleable selectors.
 * @type {string[]}
 */
export const DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS = DEFAULT_EXCLUDED_TAG_SELECTORS.filter(
  (selector) => !DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS.includes(selector)
);
