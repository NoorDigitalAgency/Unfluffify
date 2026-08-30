export const CONSECUTIVE_ARTIFACT_SCHEMA_VERSION = "p25-consecutive-browser-gate/v1";
export const REQUIRED_CONSECUTIVE_PASSES = 3;

export function validateConsecutiveP25Runs(runs) {
  const expectedOrdinals = Array.from(
    { length: REQUIRED_CONSECUTIVE_PASSES },
    (_, index) => index + 1,
  );
  const actualOrdinals = runs.map((run) => run.ordinal);
  const headCommits = runs.map((run) => run.artifact?.source?.preflight?.headCommit).filter(Boolean);
  const artifactPaths = runs.map((run) => run.artifactPath).filter(Boolean);
  const checks = {
    complete: runs.length === REQUIRED_CONSECUTIVE_PASSES,
    ordered: JSON.stringify(actualOrdinals) === JSON.stringify(expectedOrdinals),
    childProcessesReaped: runs.every((run) => run.processReaped === true),
    exitsClean: runs.every((run) => run.exitCode === 0),
    p25Schema: runs.every((run) => run.artifact?.schemaVersion === "p25-parity-browser-gate/v2"),
    acceptanceMode: runs.every((run) => run.artifact?.mode === "acceptance"),
    p25Passes: runs.every((run) => run.artifact?.pass === true),
    sourceAccepted: runs.every((run) =>
      run.artifact?.source?.accepted === true
      && run.artifact?.source?.stable === true
      && run.artifact?.source?.preflight?.cleanSourceSet === true
    ),
    warmupsValidated: runs.every((run) => run.artifact?.warmup?.artifact?.validated === true),
    componentCatalogsValidated: runs.every((run) => run.artifact?.validation?.pass === true),
    sameHead: headCommits.length === REQUIRED_CONSECUTIVE_PASSES
      && new Set(headCommits).size === 1,
    distinctArtifacts: artifactPaths.length === REQUIRED_CONSECUTIVE_PASSES
      && new Set(artifactPaths).size === REQUIRED_CONSECUTIVE_PASSES,
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    expectedOrdinals,
    actualOrdinals,
    headCommit: checks.sameHead ? headCommits[0] : null,
  };
}
