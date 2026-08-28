export const ACCEPTANCE_ID = "ACCEPT-P23-FROZEN-PRESENTATION";
export const ARTIFACT_SCHEMA_VERSION = "p23-frozen-presentation-browser-gate/v1";
export const PLAYWRIGHT_CLI_VERSION = "0.1.17";
export const VIEWPORT = Object.freeze({ width: 1000, height: 900 });
export const HOVER_BUDGET_MS = 40;
export const SILENT_BUDGET_MS = 50;

export const REQUIRED_CHECK_IDS = Object.freeze([
  "starved-raf-exercised",
  "eight-physical-targets",
  ...Array.from({ length: 8 }, (_, index) => [
    `hover-${index + 1}-identity`,
    `hover-${index + 1}-latency`,
  ]).flat(),
  "silent-scroll-fades-before-reposition-and-restores",
  "silent-overlay-retained",
  "silent-scroll-latency",
  "canonical-rows-unchanged",
  "scheduler-drained",
  "page-errors-empty",
  "console-errors-empty",
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
