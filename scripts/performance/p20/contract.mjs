export const ACCEPTANCE_IDS = Object.freeze([
  "ACCEPT-P20-SPACE-RECOVERY",
  "ACCEPT-P20-LOCK-COPY",
]);

export const ARTIFACT_SCHEMA_VERSION = "p20-integrated-browser-gate/v1";
export const PLAYWRIGHT_CLI_VERSION = "0.1.17";
export const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
export const SPACE_WATCHDOG_MS = 1_200;

export const REQUIRED_PRODUCTION_SEAMS = Object.freeze([
  "src/entrypoints/content-loader.content.ts::default.main",
  "src/entrypoints/content-loader.content.ts::setSpacePassthrough",
  "src/popup/App.tsx::App",
  "src/popup/organ/machine.ts::transitionPopupState",
  "src/popup/copy.ts::resolvePopupLockCopy",
]);

export const FOCUSED_AUTHORITIES = Object.freeze({
  keyboardRecovery: "tests/c4-content-entrypoint.test.ts",
  lockVocabulary: "tests/src/lock/copy.test.ts",
  productionStripping: "tests/build-artifact-parity.test.ts",
});

export const REQUIRED_CHECK_IDS = Object.freeze([
  "space-passthrough-recovers-on-every-boundary",
  "production-lock-copy-is-curated",
  "debug-lock-fence-and-operation-are-retained",
  "no-browser-errors",
]);

export const LOCK_CASES = Object.freeze([
  { id: "extension-context-invalidated", banner: { visible: true, reason: "extension-context-invalidated" }, expected: "Extension context invalidated", status: "unavailable", role: "unknown" },
  { id: "connecting", banner: { visible: true, reason: "connecting" }, expected: "Property lock connecting", status: "ok", role: "passive" },
  { id: "transfer", banner: { visible: true, reason: "transfer", fromName: "Kai", toName: "Dana" }, expected: "Editing is being transferred from Kai to Dana", status: "ok", role: "passive" },
  { id: "disconnect-warning", banner: { visible: true, reason: "disconnect-warning" }, expected: "Connection lost; editor role may be released", status: "ok", role: "passive" },
  { id: "inactivity-warning", banner: { visible: true, reason: "inactivity-warning" }, expected: "No recent page interaction; editor role may be released", status: "ok", role: "passive" },
  { id: "off-candidate", banner: { visible: true, reason: "off-candidate" }, expected: "Return to a Live Page candidate to keep the editor role", status: "ok", role: "passive" },
  { id: "cross-property", banner: { visible: true, reason: "cross-property" }, expected: "Return to the previous property to keep the editor role", status: "ok", role: "passive" },
  { id: "takeover-suggested", banner: { visible: true, reason: "takeover-suggested", fromName: "Kai" }, expected: "Kai wants to take over editing", status: "ok", role: "passive" },
  { id: "editor", banner: { visible: false, reason: "editor" }, expected: "You hold the editor lock", status: "ok", role: "editor" },
  { id: "locked", banner: { visible: true, reason: "locked", editorName: "Dana" }, expected: "Locked by Dana", status: "ok", role: "passive" },
  { id: "not-configured", banner: { visible: true, reason: "not-configured" }, expected: "Property lock not configured", status: "not_configured", role: "unknown" },
  { id: "not-candidate", banner: { visible: true, reason: "not-candidate" }, expected: "Not a managed property", status: "not_candidate", role: "unknown" },
  { id: "candidate-removed", banner: { visible: true, reason: "candidate-removed" }, expected: "This page is no longer a candidate", status: "suspended_candidate_removed", role: "passive" },
  { id: "candidate-feed-conflict", banner: { visible: true, reason: "candidate-feed-conflict" }, expected: "Candidate feed assignments conflict", status: "suspended_candidate_feed_conflict", role: "passive" },
  { id: "signed-out", banner: { visible: true, reason: "signed-out" }, expected: "Sign in to use the property lock", status: "signed_out", role: "unknown" },
  { id: "unavailable", banner: { visible: true, reason: "unavailable" }, expected: "Property lock unavailable", status: "unavailable", role: "unknown" },
]);

export function validateCheckCatalog(checks) {
  const ids = checks.map((check) => check.id);
  const required = new Set(REQUIRED_CHECK_IDS);
  const missing = REQUIRED_CHECK_IDS.filter((id) => !ids.includes(id));
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  const unexpected = ids.filter((id) => !required.has(id));
  return {
    pass: missing.length === 0 && duplicates.length === 0 && unexpected.length === 0 &&
      checks.length === REQUIRED_CHECK_IDS.length && checks.every((check) => check.pass === true),
    missing,
    duplicates: [...new Set(duplicates)],
    unexpected: [...new Set(unexpected)],
  };
}
