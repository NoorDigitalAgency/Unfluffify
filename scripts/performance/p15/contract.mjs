export const ACCEPTANCE_ID = "ACCEPT-P15-FROZEN-SHIELD";
export const ARTIFACT_SCHEMA_VERSION = "p15-frozen-shield-browser-gate/v1";
export const PLAYWRIGHT_CLI_VERSION = "0.1.17";

export const VIEWPORTS = Object.freeze({
  initial: Object.freeze({ width: 1280, height: 900 }),
  resized: Object.freeze({ width: 930, height: 640 }),
});

export const FIXTURE_POINTS = Object.freeze({
  hover: Object.freeze({ x: 110, y: 150 }),
  click: Object.freeze({ x: 350, y: 150 }),
  navigation: Object.freeze({ x: 590, y: 150 }),
  shadow: Object.freeze({ x: 830, y: 150 }),
  extension: Object.freeze({ x: 1080, y: 150 }),
  topLayerBefore: Object.freeze({ x: 1030, y: 350 }),
  topLayerAfter: Object.freeze({ x: 1030, y: 480 }),
  blank: Object.freeze({ x: 640, y: 520 }),
  scroll: Object.freeze({ x: 640, y: 520 }),
});

export const REQUIRED_CHECK_IDS = Object.freeze([
  "silent-production-active",
  "physical-hit-target",
  "page-top-layer-surfaces-neutralized",
  "shield-style-tamper-reasserted",
  "page-hover-click-navigation-blocked",
  "composed-shadow-target-blocked",
  "page-spoof-extension-marker-blocked",
  "shield-artifact-excluded-from-evaluation",
  "extension-surface-interactive",
  "wheel-scroll-preserved",
  "touch-scroll-preserved",
  "pre-extension-window-capture-order-evidenced",
  "viewport-and-visual-viewport-tracked",
  "late-max-z-layer-reasserted",
  "removed-shield-re-adopted",
  "local-pagehide-disposes-only-local-shield",
  "retained-adoption-precedes-deferred-page-context",
  "silent-reload-re-adopts-without-popup",
  "transient-context-reload-adopts-retained-shield",
  "reload-scroll-highlight-repositions",
  "silent-terminal-clear-removes-durable-posture",
  "production-debug-copy-absent",
  "debug-copy-remains-interactive",
  "post-ai-preview-active",
  "preview-row-commands-remain-interactive",
  "preview-terminal-exit-removes-shield",
  "save-terminal-path",
  "discard-terminal-path",
  "unregister-terminal-path",
  "definitive-property-exit-terminal-path",
  "same-document-navigation-terminal-path",
  "failure-terminal-path",
  "extension-invalidation-terminal-path",
  "local-unload-disposes-only-local-shield",
  "local-unload-reload-re-adopts",
  "no-browser-errors",
]);

export function validateCheckCatalog(checks) {
  const ids = checks.map((check) => check.id);
  const missing = REQUIRED_CHECK_IDS.filter((id) => !ids.includes(id));
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  return {
    pass: missing.length === 0 && duplicates.length === 0 && checks.every((check) => check.pass === true),
    missing,
    duplicates: [...new Set(duplicates)],
  };
}
