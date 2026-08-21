import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_ID,
  ARTIFACT_SCHEMA_VERSION,
  PLAYWRIGHT_CLI_VERSION,
  REQUIRED_CHECK_IDS,
  VIEWPORT,
  validateCheckCatalog,
} from "../scripts/performance/p16/contract.mjs";
import { renderFixturePage } from "../scripts/performance/p16/fixture.mjs";

describe("P16 real-browser durable render-inspection gate contract", () => {
  it("pins the acceptance identity, Playwright CLI, viewport, and complete check catalog", () => {
    expect(ACCEPTANCE_ID).toBe("ACCEPT-P16-INSPECTION-LIFECYCLE");
    expect(ARTIFACT_SCHEMA_VERSION).toBe("p16-render-inspection-browser-gate/v1");
    expect(PLAYWRIGHT_CLI_VERSION).toBe("0.1.17");
    expect(VIEWPORT).toEqual({ width: 1280, height: 900 });
    expect(new Set(REQUIRED_CHECK_IDS).size).toBe(REQUIRED_CHECK_IDS.length);
    expect(REQUIRED_CHECK_IDS).toHaveLength(13);
    expect(REQUIRED_CHECK_IDS).toEqual([
      "durable-start-reloads-replacement-document",
      "replacement-adopts-before-page-context",
      "curtain-painted-before-acknowledgement",
      "curtain-carries-exact-session-identity",
      "panel-close-does-not-cancel",
      "worker-restart-reconstructs-session",
      "stale-acknowledgement-is-rejected",
      "matching-acknowledgement-is-terminal",
      "matching-terminal-clears-curtain",
      "terminal-matrix-is-exact",
      "generation-is-monotonic",
      "legacy-inspection-facts-have-no-authority",
      "no-browser-errors",
    ]);
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
      pass: index !== 4,
    }))).pass).toBe(false);
  });

  it("renders an adversarial pre-opened top layer before the actual content runtime", () => {
    const page = renderFixturePage();
    const popoverIndex = page.indexOf('id="pre-inspection-popover"');
    const openIndex = page.indexOf("showPopover()");
    const runtimeIndex = page.indexOf('<script src="/runtime.js"></script>');
    expect(popoverIndex).toBeGreaterThan(0);
    expect(openIndex).toBeGreaterThan(popoverIndex);
    expect(runtimeIndex).toBeGreaterThan(openIndex);
    expect(page).toContain('popover="manual"');
    expect(page).toContain("pointer-events: auto !important");
    expect(page).toContain('id="top-layer-action"');
    expect(page).toContain("Durable render-inspection fixture");
  });
});
