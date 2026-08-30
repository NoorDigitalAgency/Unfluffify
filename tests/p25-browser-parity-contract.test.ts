import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import {
  FIXTURES,
  INPUT_OPERATION_NAMES_BY_MODE,
  OPERATION_NAMES,
  validateInputLongTaskWindows,
} from "../scripts/performance/p14/contract.mjs";
import {
  ARTIFACT_SCHEMA_VERSION,
  PARITY_GATES,
  STRICT_INPUT_LONG_TASK_BUDGET_MS,
  STRICT_P95_LEGACY_RATIO,
  validateChildArtifactProvenance,
  validateP14WarmupArtifact,
  validateP14StrictParity,
  validateParityResults,
} from "../scripts/performance/p25/contract.mjs";
import {
  PARITY_ARTIFACT_ROOTS,
  classifyParitySourceStatus,
  paritySourceDiffPathspecs,
} from "../scripts/performance/p25/source-identity.mjs";

describe("P25 parity browser gate contract", () => {
  it("pins the complete existing browser-gate sequence without budget overrides", () => {
    expect(ARTIFACT_SCHEMA_VERSION).toBe("p25-parity-browser-gate/v2");
    expect(PARITY_GATES).toEqual([
      { id: "p14-marking", script: "scripts/performance/p14-marking-browser-gate.mjs", smoke: true, schemaVersion: "p14-marking-browser-gate/v1", artifactRoot: "output/playwright/p14-marking-performance", smokeTempPrefix: null },
      { id: "p15-frozen-shield", script: "scripts/performance/p15-frozen-shield-browser-gate.mjs", smoke: true, schemaVersion: "p15-frozen-shield-browser-gate/v1", artifactRoot: "output/playwright/p15-frozen-shield", smokeTempPrefix: "unfluffify-p15-shield-smoke-" },
      { id: "p16-render-inspection", script: "scripts/performance/p16-render-inspection-browser-gate.mjs", smoke: true, schemaVersion: "p16-render-inspection-browser-gate/v1", artifactRoot: "output/playwright/p16-render-inspection", smokeTempPrefix: "unfluffify-p16-render-inspection-smoke-" },
      { id: "p17-preview", script: "scripts/performance/p17-preview-browser-gate.mjs", smoke: true, schemaVersion: "p17-preview-browser-gate/v1", artifactRoot: "output/playwright/p17-preview", smokeTempPrefix: "unfluffify-p17-preview-smoke-" },
      { id: "p18-transient-toast", script: "scripts/performance/p18-transient-toast-browser-gate.mjs", smoke: true, schemaVersion: "p18-transient-toast-browser-gate/v1", artifactRoot: "output/playwright/p18-transient-toast", smokeTempPrefix: "unfluffify-p18-transient-toast-smoke-" },
      { id: "p20-integrated", script: "scripts/performance/p20-integrated-browser-gate.mjs", smoke: true, schemaVersion: "p20-integrated-browser-gate/v1", artifactRoot: "output/playwright/p20-integrated", smokeTempPrefix: "unfluffify-p20-integrated-smoke-" },
      { id: "p23-frozen-presentation", script: "scripts/performance/p23-frozen-presentation-browser-gate.mjs", smoke: true, schemaVersion: "p23-frozen-presentation-browser-gate/v1", artifactRoot: "output/playwright/p23-frozen-presentation", smokeTempPrefix: "unfluffify-p23-frozen-presentation-" },
    ]);
    expect(packageJson.scripts["performance:p25"]).toBe(
      "node ./scripts/performance/p25-parity-browser-gate.mjs",
    );
    expect(packageJson.scripts["performance:p25:smoke"]).toBe(
      "node ./scripts/performance/p25-parity-browser-gate.mjs --smoke",
    );
  });

  it("treats only the exact parity evidence roots as non-source state", () => {
    expect(PARITY_ARTIFACT_ROOTS).toEqual([
      "output/playwright/p14-marking-performance/",
      "output/playwright/p15-frozen-shield/",
      "output/playwright/p16-render-inspection/",
      "output/playwright/p17-preview/",
      "output/playwright/p18-transient-toast/",
      "output/playwright/p20-integrated/",
      "output/playwright/p23-frozen-presentation/",
      "output/playwright/p25-parity/",
    ]);
    expect(classifyParitySourceStatus([
      "?? output/playwright/p14-marking-performance/acceptance-new.json",
      " M output/playwright/p23-frozen-presentation/acceptance-old.json",
      " M src/content/marking/engine.ts",
      "?? output/playwright/unrelated/report.json",
      "R  src/old.ts -> output/playwright/p25-parity/old.ts",
    ].join("\n"))).toEqual({
      cleanSourceSet: false,
      artifactStatus: [
        "?? output/playwright/p14-marking-performance/acceptance-new.json",
        " M output/playwright/p23-frozen-presentation/acceptance-old.json",
      ],
      status: [
        " M src/content/marking/engine.ts",
        "?? output/playwright/unrelated/report.json",
        "R  src/old.ts -> output/playwright/p25-parity/old.ts",
      ],
    });
    expect(classifyParitySourceStatus(
      "?? output/playwright/p25-parity/acceptance-new.json",
    ).cleanSourceSet).toBe(true);
    expect(paritySourceDiffPathspecs()).toEqual([
      ".",
      ...PARITY_ARTIFACT_ROOTS.map((root) => `:(exclude)${root}`),
    ]);
  });

  it("fails incomplete, reordered, or non-zero component evidence", () => {
    const passing = PARITY_GATES.map(({ id }) => ({ id, exitCode: 0, artifact: { validated: true } }));
    expect(validateParityResults(passing)).toMatchObject({
      pass: true,
      complete: true,
      orderMatches: true,
      missing: [],
      unexpected: [],
    });
    expect(validateParityResults(passing.slice(1))).toMatchObject({
      pass: false,
      complete: false,
      missing: ["p14-marking"],
      failed: ["p14-marking"],
    });
    expect(validateParityResults([...passing].reverse())).toMatchObject({
      pass: false,
      complete: true,
      orderMatches: false,
    });
    expect(validateParityResults(passing.map((entry, index) => ({
      ...entry,
      exitCode: index === 3 ? 1 : 0,
    })))).toMatchObject({ pass: false, failed: ["p17-preview"] });
    expect(validateParityResults(passing.map((entry, index) => ({
      ...entry,
      artifact: { validated: index !== 2 },
    })))).toMatchObject({ pass: false, failed: ["p16-render-inspection"] });
  });

  it("rejects stale, out-of-root, and source-mismatched child artifacts", () => {
    const gate = PARITY_GATES.find(({ id }) => id === "p15-frozen-shield")!;
    const p25StartedAt = "2026-08-28T10:00:00.000Z";
    const preflightSource = {
      headCommit: "a".repeat(40),
      cleanSourceSet: true,
      status: [],
    };
    const artifact = {
      generatedAt: "2026-08-28T10:00:01.000Z",
      source: { ...preflightSource },
    };
    const valid = validateChildArtifactProvenance({
      gate,
      mode: "acceptance",
      artifactPath: "/repo/output/playwright/p15-frozen-shield/acceptance.json",
      artifact,
      artifactMtimeMs: Date.parse("2026-08-28T10:00:02.000Z"),
      p25StartedAt,
      childPid: 321,
      repositoryRoot: "/repo",
      preflightSource,
    });
    expect(valid.pass).toBe(true);

    const stale = validateChildArtifactProvenance({
      gate,
      mode: "acceptance",
      artifactPath: "/repo/output/playwright/p15-frozen-shield/acceptance.json",
      artifact: { ...artifact, generatedAt: "2026-08-28T09:59:59.000Z" },
      artifactMtimeMs: Date.parse("2026-08-28T09:59:59.000Z"),
      p25StartedAt,
      childPid: 321,
      repositoryRoot: "/repo",
      preflightSource,
    });
    expect(stale.checks.filter(({ pass }) => !pass).map(({ id }) => id))
      .toEqual(expect.arrayContaining(["artifact-fresh-mtime", "artifact-fresh-timestamp"]));

    const tampered = validateChildArtifactProvenance({
      gate,
      mode: "acceptance",
      artifactPath: "/tmp/copied-p15.json",
      artifact: {
        ...artifact,
        source: { ...preflightSource, headCommit: "b".repeat(40), status: [" M src/tampered.ts"] },
      },
      artifactMtimeMs: Date.parse("2026-08-28T10:00:02.000Z"),
      p25StartedAt,
      childPid: 321,
      repositoryRoot: "/repo",
      preflightSource,
    });
    expect(tampered.checks.filter(({ pass }) => !pass).map(({ id }) => id))
      .toEqual(expect.arrayContaining(["artifact-owned-path", "artifact-source-head", "artifact-source-status"]));
  });

  it("accepts only the exact child-owned smoke artifact name in the system temp directory", () => {
    const gate = PARITY_GATES.find(({ id }) => id === "p15-frozen-shield")!;
    const preflightSource = { headCommit: "a".repeat(40), cleanSourceSet: false, status: [" M plan.md"] };
    const base = {
      gate,
      mode: "smoke",
      artifact: { finishedAt: "2026-08-28T10:00:02.000Z", source: preflightSource },
      artifactMtimeMs: Date.parse("2026-08-28T10:00:02.000Z"),
      p25StartedAt: "2026-08-28T10:00:00.000Z",
      childPid: 321,
      repositoryRoot: "/repo",
      preflightSource,
    } as const;
    expect(validateChildArtifactProvenance({
      ...base,
      artifactPath: "/tmp/unfluffify-p15-shield-smoke-321.json",
    }).pass).toBe(true);
    expect(validateChildArtifactProvenance({
      ...base,
      artifactPath: "/tmp/unfluffify-p15-shield-smoke-999.json",
    }).checks.find(({ id }) => id === "artifact-owned-path")?.pass).toBe(false);
  });

  it("enforces strict P14 p95 parity and real input long-task evidence without overrides", () => {
    expect(STRICT_P95_LEGACY_RATIO).toBe(1.05);
    expect(STRICT_INPUT_LONG_TASK_BUDGET_MS).toBe(50);
    const summaries = Object.fromEntries(Object.keys(FIXTURES).map((fixture) => [fixture, {
      rewrite: Object.fromEntries(OPERATION_NAMES.map((operation) => [operation, { p95: 105 }])),
      legacy: Object.fromEntries(OPERATION_NAMES.map((operation) => [operation, { p95: 100 }])),
    }]));
    const windowFor = (operation: string, duration = 0) => ({
      operation,
      startTime: 10,
      endTime: 20,
      supported: true,
      entries: duration > 0
        ? [{ name: "self", entryType: "longtask", startTime: 12, duration }]
        : [],
      maxDurationMs: duration,
    });
    const runs = Object.entries(INPUT_OPERATION_NAMES_BY_MODE).map(([mode, operations], sequence) => ({
      sequence,
      mode,
      runtime: "rewrite",
      inputLongTasks: operations.map((operation) => windowFor(operation)),
    }));
    const inputLongTasks = validateInputLongTaskWindows(runs);
    const artifact = { summaries, runs, validation: { inputLongTasks } };

    expect(validateP14StrictParity(artifact)).toMatchObject({
      pass: true,
      p95Ratio: 1.05,
      inputLongTaskBudgetMs: 50,
      longTasks: { pass: true },
    });
    expect(validateP14StrictParity(artifact).p95Checks).toHaveLength(
      Object.keys(FIXTURES).length * OPERATION_NAMES.length,
    );

    const slowP95Artifact = structuredClone(artifact);
    slowP95Artifact.summaries.large.rewrite.markingHover.p95 = 105.001;
    expect(validateP14StrictParity(slowP95Artifact)).toMatchObject({ pass: false });

    const longTaskArtifact = structuredClone(artifact);
    longTaskArtifact.runs[1].inputLongTasks[0] = windowFor("markingHover", 50.001);
    expect(validateP14StrictParity(longTaskArtifact)).toMatchObject({
      pass: false,
      longTasks: { pass: false },
    });

    const missingMetricArtifact = structuredClone(artifact);
    delete missingMetricArtifact.summaries.small.rewrite.silentActivation;
    expect(validateP14StrictParity(missingMetricArtifact)).toMatchObject({ pass: false });
  });

  it("accepts a complete P14 smoke warm-up without treating its noisy budgets as acceptance evidence", () => {
    const artifact = {
      mode: "smoke",
      runs: [{ sequence: 1 }],
      validation: {
        sampleCardinality: { pass: true },
        runPlan: { pass: true },
        timings: { pass: true },
        inputLongTasks: { pass: true },
        ephemeralCleanup: { pass: true },
        environment: { pass: true },
        pageErrors: { pass: true },
        semantics: [{ pass: true }],
        rewriteActivationTransactions: [{ pass: true }],
        mutationPressure: [{ pass: true }],
        budgets: [{ pass: false }],
      },
    };

    expect(validateP14WarmupArtifact(artifact)).toMatchObject({
      pass: true,
      budgetChecksIntentionallyExcluded: true,
    });
    artifact.validation.ephemeralCleanup.pass = false;
    expect(validateP14WarmupArtifact(artifact).pass).toBe(false);
  });
});
