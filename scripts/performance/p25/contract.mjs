import {
  FIXTURES,
  INPUT_LONG_TASK_BUDGET_MS,
  OPERATION_NAMES,
  validateInputLongTaskWindows,
} from "../p14/contract.mjs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const ARTIFACT_SCHEMA_VERSION = "p25-parity-browser-gate/v1";

export const STRICT_P95_LEGACY_RATIO = 1.05;
export const STRICT_INPUT_LONG_TASK_BUDGET_MS = INPUT_LONG_TASK_BUDGET_MS;

export const PARITY_GATES = Object.freeze([
  { id: "p14-marking", script: "scripts/performance/p14-marking-browser-gate.mjs", smoke: true, schemaVersion: "p14-marking-browser-gate/v1", artifactRoot: "output/playwright/p14-marking-performance", smokeTempPrefix: null },
  { id: "p15-frozen-shield", script: "scripts/performance/p15-frozen-shield-browser-gate.mjs", smoke: true, schemaVersion: "p15-frozen-shield-browser-gate/v1", artifactRoot: "output/playwright/p15-frozen-shield", smokeTempPrefix: "unfluffify-p15-shield-smoke-" },
  { id: "p16-render-inspection", script: "scripts/performance/p16-render-inspection-browser-gate.mjs", smoke: true, schemaVersion: "p16-render-inspection-browser-gate/v1", artifactRoot: "output/playwright/p16-render-inspection", smokeTempPrefix: "unfluffify-p16-render-inspection-smoke-" },
  { id: "p17-preview", script: "scripts/performance/p17-preview-browser-gate.mjs", smoke: true, schemaVersion: "p17-preview-browser-gate/v1", artifactRoot: "output/playwright/p17-preview", smokeTempPrefix: "unfluffify-p17-preview-smoke-" },
  { id: "p18-transient-toast", script: "scripts/performance/p18-transient-toast-browser-gate.mjs", smoke: true, schemaVersion: "p18-transient-toast-browser-gate/v1", artifactRoot: "output/playwright/p18-transient-toast", smokeTempPrefix: "unfluffify-p18-transient-toast-smoke-" },
  { id: "p20-integrated", script: "scripts/performance/p20-integrated-browser-gate.mjs", smoke: true, schemaVersion: "p20-integrated-browser-gate/v1", artifactRoot: "output/playwright/p20-integrated", smokeTempPrefix: "unfluffify-p20-integrated-smoke-" },
  { id: "p23-frozen-presentation", script: "scripts/performance/p23-frozen-presentation-browser-gate.mjs", smoke: true, schemaVersion: "p23-frozen-presentation-browser-gate/v1", artifactRoot: "output/playwright/p23-frozen-presentation", smokeTempPrefix: "unfluffify-p23-frozen-presentation-" },
]);

function childArtifactSource(artifact) {
  return artifact?.source?.rewriteWorktree ?? artifact?.source ?? null;
}

function pathBelow(root, candidate) {
  const child = relative(root, candidate);
  return child.length > 0
    && child !== ".."
    && !child.startsWith("../")
    && !child.startsWith("..\\")
    && !isAbsolute(child);
}

export function validateChildArtifactProvenance({
  gate,
  mode,
  artifactPath,
  artifact,
  artifactMtimeMs,
  p25StartedAt,
  childPid,
  repositoryRoot,
  preflightSource,
}) {
  const checks = [];
  const push = (id, pass, detail = null) => checks.push({ id, pass: Boolean(pass), detail });
  const absolutePath = resolve(artifactPath);
  const expectedRoot = resolve(repositoryRoot, gate.artifactRoot);
  const inOwnedRoot = pathBelow(expectedRoot, absolutePath);
  const smokeName = basename(absolutePath);
  const expectedPidSuffix = Number.isInteger(childPid) ? `-${childPid}.json` : null;
  const inOwnedSmokeTemp = mode === "smoke"
    && typeof gate.smokeTempPrefix === "string"
    && dirname(absolutePath) === resolve(tmpdir())
    && smokeName.startsWith(gate.smokeTempPrefix)
    && expectedPidSuffix !== null
    && smokeName.endsWith(expectedPidSuffix);
  push("artifact-owned-path", inOwnedRoot || inOwnedSmokeTemp, {
    artifactPath: absolutePath,
    expectedRoot,
    smokeTempPrefix: gate.smokeTempPrefix,
    childPid,
  });

  const startedAtMs = Date.parse(p25StartedAt);
  const artifactTimestamp = artifact?.generatedAt ?? artifact?.finishedAt ?? null;
  const artifactTimestampMs = Date.parse(artifactTimestamp);
  push("artifact-fresh-mtime", Number.isFinite(artifactMtimeMs) && Number.isFinite(startedAtMs) && artifactMtimeMs >= startedAtMs, {
    artifactMtimeMs,
    p25StartedAt,
  });
  push("artifact-fresh-timestamp", typeof artifactTimestamp === "string" && Number.isFinite(artifactTimestampMs) && artifactTimestampMs >= startedAtMs, {
    artifactTimestamp,
    p25StartedAt,
  });

  const source = childArtifactSource(artifact);
  push("artifact-source-head", source?.headCommit === preflightSource?.headCommit, {
    expected: preflightSource?.headCommit ?? null,
    actual: source?.headCommit ?? null,
  });
  push("artifact-source-cleanliness", source?.cleanSourceSet === preflightSource?.cleanSourceSet, {
    expected: preflightSource?.cleanSourceSet ?? null,
    actual: source?.cleanSourceSet ?? null,
  });
  push("artifact-source-status", JSON.stringify(source?.status ?? []) === JSON.stringify(preflightSource?.status ?? []), {
    expected: preflightSource?.status ?? [],
    actual: source?.status ?? [],
  });
  return { pass: checks.every((check) => check.pass), checks };
}

export function validateParityResults(results) {
  const expected = PARITY_GATES.map(({ id }) => id);
  const actual = results.map(({ id }) => id);
  const missing = expected.filter((id) => !actual.includes(id));
  const unexpected = actual.filter((id) => !expected.includes(id));
  const complete = missing.length === 0
    && unexpected.length === 0
    && actual.length === expected.length;
  const orderMatches = complete && actual.every((id, index) => id === expected[index]);
  const resultFailures = results
    .filter(({ exitCode, artifact }) => exitCode !== 0 || artifact?.validated !== true)
    .map(({ id }) => id);
  return {
    pass: complete &&
      orderMatches &&
      results.every(({ exitCode, artifact }) => exitCode === 0 && artifact?.validated === true),
    complete,
    orderMatches,
    expected,
    actual,
    missing,
    unexpected,
    failed: [...new Set([...missing, ...resultFailures])],
  };
}

export function validateP14StrictParity(artifact) {
  const p95Checks = [];
  for (const fixture of Object.keys(FIXTURES)) {
    for (const operation of OPERATION_NAMES) {
      const rewriteP95 = artifact?.summaries?.[fixture]?.rewrite?.[operation]?.p95;
      const legacyP95 = artifact?.summaries?.[fixture]?.legacy?.[operation]?.p95;
      const valuesValid = typeof rewriteP95 === "number"
        && Number.isFinite(rewriteP95)
        && rewriteP95 >= 0
        && typeof legacyP95 === "number"
        && Number.isFinite(legacyP95)
        && legacyP95 >= 0;
      const limitMs = valuesValid ? legacyP95 * STRICT_P95_LEGACY_RATIO : null;
      p95Checks.push({
        fixture,
        operation,
        rewriteP95: valuesValid ? rewriteP95 : null,
        legacyP95: valuesValid ? legacyP95 : null,
        limitMs,
        ratio: STRICT_P95_LEGACY_RATIO,
        pass: valuesValid && rewriteP95 <= limitMs,
      });
    }
  }

  const measuredLongTasks = validateInputLongTaskWindows(artifact?.runs);
  const declaredLongTasks = artifact?.validation?.inputLongTasks;
  const longTasks = {
    ...measuredLongTasks,
    declaredPass: declaredLongTasks?.pass === true,
    declaredBudgetMs: declaredLongTasks?.budgetMs ?? null,
    pass: measuredLongTasks.pass
      && declaredLongTasks?.pass === true
      && declaredLongTasks?.budgetMs === STRICT_INPUT_LONG_TASK_BUDGET_MS,
  };
  return {
    pass: p95Checks.every((check) => check.pass) && longTasks.pass,
    p95Ratio: STRICT_P95_LEGACY_RATIO,
    inputLongTaskBudgetMs: STRICT_INPUT_LONG_TASK_BUDGET_MS,
    p95Checks,
    longTasks,
  };
}
