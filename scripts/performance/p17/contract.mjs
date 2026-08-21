export const ACCEPTANCE_IDS = Object.freeze([
  "ACCEPT-P17-PREVIEW-TRANSPORT",
  "ACCEPT-P17-PREVIEW-COPY",
]);

export const ARTIFACT_SCHEMA_VERSION = "p17-preview-browser-gate/v1";
export const PLAYWRIGHT_CLI_VERSION = "0.1.17";

export const VIEWPORT = Object.freeze({ width: 1280, height: 900 });

/** These races are owned by side-effectful extension entrypoints. Their real
 * entrypoint regressions are contract support; the page harness must not model
 * either lifecycle coordinator locally. */
export const ENTRYPOINT_RACE_AUTHORITIES = Object.freeze({
  delayedProjectAfterPreviewExit: "tests/src/popup/entrypoint.test.ts",
  immediateSameDocumentProjection: "tests/c4-content-entrypoint.test.ts",
});

export const PREVIEW_CLASSIFICATIONS = Object.freeze([
  "explicit-included",
  "implicit-included",
  "excluded",
  "undetected",
  "immutable",
  "closed-shadow",
]);

export const SHADOW_PROVENANCE = Object.freeze([
  "light",
  "open",
  "force-open-closed",
  "inaccessible-closed",
]);

/** This is an independent fixture oracle, not a projection implementation. The
 * browser runtime asks the production evaluator/controller to classify these
 * elements and the controller compares the result to this fixed corpus. */
export const CANONICAL_CORPUS = Object.freeze([
  Object.freeze({
    fixtureId: "explicit",
    classification: "explicit-included",
    text: "Captured shadow account balance",
    selector: ".p17-explicit",
    shadow: "force-open-closed",
  }),
  Object.freeze({
    fixtureId: "implicit-shadow",
    classification: "implicit-included",
    text: "Captured shadow account balance",
    selector: ".p17-explicit",
    shadow: "force-open-closed",
  }),
  Object.freeze({
    fixtureId: "excluded",
    classification: "excluded",
    text: "Navigation promotions and sponsored links",
    selector: ".p17-excluded",
    shadow: "light",
  }),
  Object.freeze({
    fixtureId: "undetected",
    classification: "undetected",
    text: "Useful unmatched <script> & delivery details",
    shadow: "light",
  }),
  Object.freeze({
    fixtureId: "immutable",
    classification: "immutable",
    text: "Quarterly revenue chart",
    shadow: "light",
  }),
  Object.freeze({
    fixtureId: "closed-shadow",
    classification: "closed-shadow",
    text: "Unavailable account summary",
    shadow: "inaccessible-closed",
  }),
]);

export const REQUIRED_CHECK_IDS = Object.freeze([
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
  "preview-rows-not-keyboard-focusable",
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
