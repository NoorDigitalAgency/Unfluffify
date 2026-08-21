import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_IDS,
  ARTIFACT_SCHEMA_VERSION,
  FIXTURE_ROUTES,
  FOCUSED_AUTHORITIES,
  PLAYWRIGHT_CLI_VERSION,
  REQUIRED_CHECK_IDS,
  REQUIRED_PRODUCTION_SEAMS,
  TOAST_DEADLINES_MS,
  VIEWPORT,
  validateCheckCatalog,
} from "../scripts/performance/p18/contract.mjs";
import {
  renderContentFixturePage,
  renderPopupFixturePage,
} from "../scripts/performance/p18/fixture.mjs";

describe("P18 real-browser transient-surface and toast gate contract", () => {
  it("pins both acceptance identities, browser, viewport, deadlines, and exact catalog", () => {
    expect(ACCEPTANCE_IDS).toEqual([
      "ACCEPT-P18-TRANSIENT-ESCAPE",
      "ACCEPT-P18-TOASTS",
    ]);
    expect(ARTIFACT_SCHEMA_VERSION).toBe("p18-transient-toast-browser-gate/v1");
    expect(PLAYWRIGHT_CLI_VERSION).toBe("0.1.17");
    expect(VIEWPORT).toEqual({ width: 1280, height: 900 });
    expect(TOAST_DEADLINES_MS).toEqual({ success: 1_800, warning: 4_000, danger: 6_000 });
    expect(new Set(REQUIRED_CHECK_IDS).size).toBe(REQUIRED_CHECK_IDS.length);
    expect(REQUIRED_CHECK_IDS).toHaveLength(14);
    expect(REQUIRED_CHECK_IDS).toEqual([
      "popup-menu-mutual-exclusion",
      "outside-pointer-dismisses-current-menu",
      "nested-escape-dismisses-topmost-only",
      "busy-surface-resists-escape-and-outside",
      "escape-never-runs-edit-or-terminal-actions",
      "preview-escape-requests-normal-exit-boundary",
      "panel-scroll-restored-after-dismissal",
      "marking-right-click-commits-canonical-action",
      "marking-menu-dismissal-preserves-marking-interaction",
      "production-toast-replaces-current",
      "production-toast-manual-close-stays-dismissed",
      "toast-deadlines-exact-1800-4000-6000",
      "production-debug-toast-disclosure-consistent",
      "no-browser-errors",
    ]);
  });

  it("pins production seams and keeps lifecycle, timer, manifest, and build authority explicit", () => {
    expect(REQUIRED_PRODUCTION_SEAMS).toEqual([
      "src/ui/transient-surface-manager.ts::createTransientSurfaceManager",
      "src/ui/toast-controller.ts::createToastController",
      "src/ui/toast-controller.ts::TOAST_DURATION_MS",
      "src/ui/toast-controller.ts::TransientToast",
      "src/popup/App.tsx::App",
      "src/entrypoints/content-loader.content.ts::default.main",
    ]);
    expect(FOCUSED_AUTHORITIES).toEqual({
      previewExitRequest: "tests/src/popup/entrypoint.test.ts",
      previewExitRestoration: "tests/c4-content-entrypoint.test.ts",
      busyOperationContinuation: "tests/src/popup/entrypoint.test.ts",
      transientManagerLifecycle: "tests/src/ui/transient-surface-manager.test.ts",
      toastTimerCleanup: "tests/src/ui/toast-controller.test.ts",
      popupScrollRestoration: "tests/src/popup/scroll-lock.test.ts",
      noGlobalShortcuts: "tests/manifest-permissions.test.ts",
      productionDisclosure: "tests/build-artifact-parity.test.ts",
    });
  });

  it("rejects missing, duplicate, unexpected, or failing browser evidence", () => {
    const passing = REQUIRED_CHECK_IDS.map((id) => ({ id, pass: true }));
    expect(validateCheckCatalog(passing)).toEqual({
      pass: true,
      missing: [],
      duplicates: [],
      unexpected: [],
    });
    expect(validateCheckCatalog(passing.slice(1))).toMatchObject({
      pass: false,
      missing: [REQUIRED_CHECK_IDS[0]],
    });
    expect(validateCheckCatalog([...passing, passing[0]!])).toMatchObject({
      pass: false,
      duplicates: [REQUIRED_CHECK_IDS[0]],
    });
    expect(validateCheckCatalog([...passing, { id: "not-in-contract", pass: true }])).toMatchObject({
      pass: false,
      unexpected: ["not-in-contract"],
    });
    expect(validateCheckCatalog(passing.map((entry, index) => ({
      ...entry,
      pass: index !== 4,
    }))).pass).toBe(false);
  });

  it("renders separate popup variants and a deterministic content right-click target", () => {
    expect(FIXTURE_ROUTES).toEqual({
      popupProduction: "/popup?variant=production",
      popupDebug: "/popup?variant=debug",
      contentProduction: "/content?variant=production",
    });
    const production = renderPopupFixturePage({ variant: "production" });
    const debug = renderPopupFixturePage({ variant: "debug" });
    const content = renderContentFixturePage({ variant: "production" });

    expect(production).toContain('<script src="/popup-runtime-production.js"></script>');
    expect(debug).toContain('<script src="/popup-runtime-debug.js"></script>');
    for (const popup of [production, debug]) {
      expect(popup).toContain('id="p18-popup-root"');
      expect(popup).toContain('id="p18-popup-outside-target"');
      expect(popup).toContain('id="p18-popup-scroll-sentinel"');
    }
    expect(content).toContain('<script src="/content-runtime-production.js"></script>');
    expect(content).toContain('data-p18-mark-target="primary"');
    expect(content).toContain('data-p18-mark-target="replacement"');
    expect(content).toContain('id="p18-page-action"');
  });
});
