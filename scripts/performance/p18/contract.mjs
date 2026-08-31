export const ACCEPTANCE_IDS = Object.freeze([
  "ACCEPT-P18-TRANSIENT-ESCAPE",
  "ACCEPT-P18-TOASTS",
]);

export const ARTIFACT_SCHEMA_VERSION = "p18-transient-toast-browser-gate/v1";
export const PLAYWRIGHT_CLI_VERSION = "0.1.17";

export const VIEWPORT = Object.freeze({ width: 1280, height: 900 });

export const TOAST_DEADLINES_MS = Object.freeze({
  success: 1_800,
  warning: 4_000,
  danger: 6_000,
});

/** These behaviors terminate in extension entrypoints or timer resource
 * ownership. The browser gate reaches their real UI boundary but must not
 * reproduce the background brain, preview lifecycle, or timer controller. */
export const FOCUSED_AUTHORITIES = Object.freeze({
  previewExitRequest: "tests/src/popup/entrypoint.test.ts",
  previewExitRestoration: "tests/c4-content-entrypoint.test.ts",
  busyOperationContinuation: "tests/src/popup/entrypoint.test.ts",
  transientManagerLifecycle: "tests/src/ui/transient-surface-manager.test.ts",
  toastTimerCleanup: "tests/src/ui/toast-controller.test.ts",
  popupScrollRestoration: "tests/src/popup/scroll-lock.test.ts",
  noGlobalShortcuts: "tests/manifest-permissions.test.ts",
  productionDisclosure: "tests/build-artifact-parity.test.ts",
});

/** The fixture imports the real App and content entrypoint. These are the only
 * production API names the harness is allowed to wait for; it may not replace
 * them with a local surface stack or toast scheduler. */
export const REQUIRED_PRODUCTION_SEAMS = Object.freeze([
  "src/ui/transient-surface-manager.ts::createTransientSurfaceManager",
  "src/ui/toast-controller.ts::createToastController",
  "src/ui/toast-controller.ts::TOAST_DURATION_MS",
  "src/ui/toast-controller.ts::TransientToast",
  "src/popup/App.tsx::App",
  "src/entrypoints/content-loader.content.ts::default.main",
]);

export const FIXTURE_ROUTES = Object.freeze({
  popupProduction: "/popup?variant=production",
  popupDebug: "/popup?variant=debug",
  contentProduction: "/content?variant=production",
});

export const REQUIRED_CHECK_IDS = Object.freeze([
  "popup-menu-mutual-exclusion",
  "outside-pointer-dismisses-current-menu",
  "nested-escape-dismisses-topmost-only",
  "busy-surface-resists-escape-and-outside",
  "escape-never-runs-edit-or-terminal-actions",
  "preview-escape-requests-normal-exit-boundary",
  "panel-scroll-restored-after-dismissal",
  "marking-right-click-preserves-native-context-menu",
  "native-context-menu-dismissal-preserves-marking-interaction",
  "production-toast-replaces-current",
  "production-toast-manual-close-stays-dismissed",
  "toast-deadlines-exact-1800-4000-6000",
  "production-debug-toast-disclosure-consistent",
  "no-browser-errors",
]);

export function validateCheckCatalog(checks) {
  const ids = checks.map((check) => check.id);
  const required = new Set(REQUIRED_CHECK_IDS);
  const missing = REQUIRED_CHECK_IDS.filter((id) => !ids.includes(id));
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const unexpected = ids.filter((id) => !required.has(id));
  return {
    pass: missing.length === 0
      && duplicates.length === 0
      && unexpected.length === 0
      && checks.length === REQUIRED_CHECK_IDS.length
      && checks.every((check) => check.pass === true),
    missing,
    duplicates: [...new Set(duplicates)],
    unexpected: [...new Set(unexpected)],
  };
}
