import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_ID,
  ARTIFACT_SCHEMA_VERSION,
  FIXTURE_POINTS,
  PLAYWRIGHT_CLI_VERSION,
  REQUIRED_CHECK_IDS,
  VIEWPORTS,
  validateCheckCatalog,
} from "../scripts/performance/p15/contract.mjs";
import { renderFixturePage } from "../scripts/performance/p15/fixture.mjs";

describe("P15 real-browser frozen interaction-shield gate contract", () => {
  it("pins the acceptance identity, Playwright CLI, viewports, and complete check catalog", () => {
    expect(ACCEPTANCE_ID).toBe("ACCEPT-P15-FROZEN-SHIELD");
    expect(ARTIFACT_SCHEMA_VERSION).toBe("p15-frozen-shield-browser-gate/v1");
    expect(PLAYWRIGHT_CLI_VERSION).toBe("0.1.17");
    expect(VIEWPORTS).toEqual({
      initial: { width: 1280, height: 900 },
      resized: { width: 930, height: 640 },
    });
    expect(new Set(REQUIRED_CHECK_IDS).size).toBe(REQUIRED_CHECK_IDS.length);
    expect(REQUIRED_CHECK_IDS).toHaveLength(36);
    expect(REQUIRED_CHECK_IDS).toEqual(expect.arrayContaining([
      "physical-hit-target",
      "page-top-layer-surfaces-neutralized",
      "shield-style-tamper-reasserted",
      "composed-shadow-target-blocked",
      "page-spoof-extension-marker-blocked",
      "shield-artifact-excluded-from-evaluation",
      "extension-surface-interactive",
      "wheel-scroll-preserved",
      "touch-scroll-preserved",
      "pre-extension-window-capture-order-evidenced",
      "local-pagehide-disposes-only-local-shield",
      "retained-adoption-precedes-deferred-page-context",
      "silent-reload-re-adopts-without-popup",
      "transient-context-reload-adopts-retained-shield",
      "reload-scroll-highlight-repositions",
      "post-ai-preview-active",
      "preview-row-commands-remain-interactive",
      "save-terminal-path",
      "discard-terminal-path",
      "unregister-terminal-path",
      "definitive-property-exit-terminal-path",
      "same-document-navigation-terminal-path",
      "failure-terminal-path",
      "extension-invalidation-terminal-path",
      "local-unload-disposes-only-local-shield",
      "local-unload-reload-re-adopts",
    ]));
  });

  it("rejects missing, duplicate, or failing browser evidence", () => {
    const passing = REQUIRED_CHECK_IDS.map((id) => ({ id, pass: true }));
    expect(validateCheckCatalog(passing)).toEqual({ pass: true, missing: [], duplicates: [] });
    expect(validateCheckCatalog(passing.slice(1))).toMatchObject({
      pass: false,
      missing: [REQUIRED_CHECK_IDS[0]],
    });
    expect(validateCheckCatalog([...passing, passing[0]!])).toMatchObject({
      pass: false,
      duplicates: [REQUIRED_CHECK_IDS[0]],
    });
    expect(validateCheckCatalog(passing.map((entry, index) => ({
      ...entry,
      pass: index !== 3,
    }))).pass).toBe(false);
  });

  it("renders stable, non-overlapping real-input targets and both runtime variants", () => {
    const points = Object.entries(FIXTURE_POINTS);
    for (const [index, [name, point]] of points.entries()) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.y).toBeGreaterThan(0);
      for (const [otherName, other] of points.slice(index + 1)) {
        if (new Set([name, otherName]).size === 2 && [name, otherName].every((value) => ["blank", "scroll"].includes(value))) {
          continue;
        }
        expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThan(80);
      }
    }

    const production = renderFixturePage({ variant: "production" });
    const debug = renderFixturePage({ variant: "debug" });
    expect(production).toContain('<script src="/runtime-production.js"></script>');
    expect(debug).toContain('<script src="/runtime-debug.js"></script>');
    for (const page of [production, debug]) {
      expect(page).toContain('id="hover-zone"');
      expect(page).toContain('id="page-button"');
      expect(page).toContain('id="page-link"');
      expect(page).toContain('id="pre-shield-popover"');
      expect(page).toContain('id="shadow-host"');
      expect(page).toContain('id="reload-scroll-target"');
      expect(page).toContain('id="preview-target"');
      expect(page).toContain('data-uf-extension-ui');
      expect(page).toContain('data-uf-fixture-spoof-surface');
      expect(page).toContain("attachShadow({ mode: \"open\" })");
      expect(page).toContain("min-height: 3600px");
    }
  });
});
