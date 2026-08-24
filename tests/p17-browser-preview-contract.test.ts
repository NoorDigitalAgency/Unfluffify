import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_IDS,
  ARTIFACT_SCHEMA_VERSION,
  CANONICAL_CORPUS,
  ENTRYPOINT_RACE_AUTHORITIES,
  PLAYWRIGHT_CLI_VERSION,
  PREVIEW_CLASSIFICATIONS,
  REQUIRED_CHECK_IDS,
  SHADOW_PROVENANCE,
  VIEWPORT,
  validateCheckCatalog,
} from "../scripts/performance/p17/contract.mjs";
import { renderFixturePage } from "../scripts/performance/p17/fixture.mjs";

describe("P17 real-browser canonical preview gate contract", () => {
  it("pins both acceptance identities, browser, viewport, and exact check catalog", () => {
    expect(ACCEPTANCE_IDS).toEqual([
      "ACCEPT-P17-PREVIEW-TRANSPORT",
      "ACCEPT-P17-PREVIEW-COPY",
    ]);
    expect(ARTIFACT_SCHEMA_VERSION).toBe("p17-preview-browser-gate/v1");
    expect(PLAYWRIGHT_CLI_VERSION).toBe("0.1.17");
    expect(VIEWPORT).toEqual({ width: 1280, height: 900 });
    expect(ENTRYPOINT_RACE_AUTHORITIES).toEqual({
      delayedProjectAfterPreviewExit: "tests/src/popup/entrypoint.test.ts",
      immediateSameDocumentProjection: "tests/c4-content-entrypoint.test.ts",
    });
    expect(new Set(REQUIRED_CHECK_IDS).size).toBe(REQUIRED_CHECK_IDS.length);
    expect(REQUIRED_CHECK_IDS).toHaveLength(19);
    expect(REQUIRED_CHECK_IDS).toEqual([
      "canonical-six-class-corpus",
      "lossless-content-bus-popup-roundtrip",
      "readable-text-normalized-safe-leading",
      "production-simple-projection",
      "production-technical-detail-absent",
      "debug-full-detail-present",
      "shadow-provenance-roundtrip",
      "pointer-hover-exact-target",
      "pointer-leave-clears-emphasis",
      "pointer-click-centers-exact-target",
      "selector-only-reprojection-advances-revision",
      "retired-preview-occurrence-rejects-cycle-a",
      "mutation-stable-row-identity",
      "mutation-reuses-react-row-node",
      "post-mutation-id-command-ignores-stale-xpath",
      "stale-projection-rejected",
      "active-hover-mutation-rebinds-and-clears",
      "preview-rows-keyboard-operable",
      "no-browser-errors",
    ]);
  });

  it("pins exactly one readable row for every classification and all shadow provenance literals", () => {
    expect(PREVIEW_CLASSIFICATIONS).toEqual([
      "explicit-included",
      "implicit-included",
      "excluded",
      "undetected",
      "immutable",
      "closed-shadow",
    ]);
    expect(CANONICAL_CORPUS.map((row) => row.classification)).toEqual(PREVIEW_CLASSIFICATIONS);
    expect(new Set(CANONICAL_CORPUS.map((row) => row.fixtureId)).size).toBe(6);
    expect(CANONICAL_CORPUS.every((row) => row.text.length > 0 && row.text.length <= 80)).toBe(true);
    expect(SHADOW_PROVENANCE).toEqual([
      "light",
      "open",
      "force-open-closed",
      "inaccessible-closed",
    ]);
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
      pass: index !== 7,
    }))).pass).toBe(false);
  });

  it("renders the fixed corpus, safe readable sentinel, shadow hosts, and both bundles", () => {
    const production = renderFixturePage({ variant: "production" });
    const debug = renderFixturePage({ variant: "debug" });
    expect(production).toContain('<script src="/runtime-production.js"></script>');
    expect(debug).toContain('<script src="/runtime-debug.js"></script>');
    for (const page of [production, debug]) {
      for (const row of CANONICAL_CORPUS.filter((entry) => entry.fixtureId !== "implicit-shadow")) {
        expect(page).toContain(`data-p17-fixture-id="${row.fixtureId}"`);
      }
      expect(page).toContain("Useful unmatched &lt;script&gt; &amp; delivery details");
      expect(page).not.toContain("Useful unmatched <script>");
      expect(page).toContain('id="p17-force-open-shadow-host"');
      expect(page).toContain('data-uf-closed-shadow-host="true"');
      expect(page).toContain('id="p17-after-spacer"');
    }
  });
});
