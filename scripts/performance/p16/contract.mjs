export const ACCEPTANCE_ID = "ACCEPT-P16-INSPECTION-LIFECYCLE";
export const ARTIFACT_SCHEMA_VERSION = "p16-render-inspection-browser-gate/v1";
export const PLAYWRIGHT_CLI_VERSION = "0.1.17";

export const VIEWPORT = Object.freeze({ width: 1280, height: 900 });

export const REQUIRED_CHECK_IDS = Object.freeze([
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

export function validateCheckCatalog(checks) {
  const ids = checks.map((check) => check.id);
  const required = new Set(REQUIRED_CHECK_IDS);
  const missing = REQUIRED_CHECK_IDS.filter((id) => !ids.includes(id));
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const unexpected = ids.filter((id) => !required.has(id));
  return {
    pass: missing.length === 0 &&
      duplicates.length === 0 &&
      unexpected.length === 0 &&
      checks.length === REQUIRED_CHECK_IDS.length &&
      checks.every((check) => check.pass === true),
    missing,
    duplicates: [...new Set(duplicates)],
    unexpected: [...new Set(unexpected)],
  };
}
