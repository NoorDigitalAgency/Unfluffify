#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_SCHEMA_VERSION,
  PARITY_GATES,
  STRICT_INPUT_LONG_TASK_BUDGET_MS,
  STRICT_P95_LEGACY_RATIO,
  validateChildArtifactProvenance,
  validateP14WarmupArtifact,
  validateP14StrictParity,
  validateParityResults,
} from "./p25/contract.mjs";
import {
  PARITY_ARTIFACT_ROOTS,
  classifyParitySourceStatus,
  paritySourceDiffPathspecs,
} from "./p25/source-identity.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const smoke = process.argv.includes("--smoke");
const startedAt = new Date();
const runToken = startedAt.toISOString().replaceAll(":", "-").replace(".", "-");
const retainedChildDirectory = smoke
  ? join("/tmp", `unfluffify-p25-parity-smoke-${process.pid}-children`)
  : join(repositoryRoot, "output/playwright/p25-parity", `children-${runToken}`);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runCapture(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error([`${command} ${args.join(" ")} exited ${code}`, stdout, stderr]
          .filter(Boolean)
          .join("\n")));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

async function captureSourceIdentity() {
  const [headCommit, rawStatus, sourceDiff] = await Promise.all([
    runCapture("git", ["rev-parse", "HEAD"]),
    runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", "."]),
    runCapture("git", ["diff", "--binary", "HEAD", "--", ...paritySourceDiffPathspecs()]),
  ]);
  const classified = classifyParitySourceStatus(rawStatus);
  return {
    headCommit,
    ...classified,
    sourceDiffSha256: sha256(sourceDiff),
  };
}

function sameSourceIdentity(left, right) {
  return left.headCommit === right.headCommit &&
    left.sourceDiffSha256 === right.sourceDiffSha256 &&
    JSON.stringify(left.status) === JSON.stringify(right.status);
}

function isolatedGateEnvironment(gateId) {
  const environment = { ...process.env };
  delete environment.PLAYWRIGHT_CLI_SESSION;
  delete environment.PWDEBUG;
  return {
    ...environment,
    UF_P25_RUN_TOKEN: runToken,
    UF_P25_GATE_ID: gateId,
    UF_P25_EXTERNAL_OBSERVER: "none",
  };
}

function childProcessReaped(childPid) {
  if (!Number.isInteger(childPid)) {
    return true;
  }
  try {
    process.kill(childPid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function runGate(gate, options = {}) {
  return new Promise((resolvePromise) => {
    const gateId = options.id ?? gate.id;
    const gateArguments = options.args
      ?? (smoke && gate.smoke ? ["--smoke"] : []);
    const args = [gate.script, ...gateArguments];
    const started = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: repositoryRoot,
      env: isolatedGateEnvironment(gateId),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childPid = child.pid ?? null;
    let settled = false;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const finish = (exitCode, error = null) => {
      if (settled) return;
      settled = true;
      resolvePromise({
      id: gateId,
      script: gate.script,
      arguments: gateArguments,
      smoke: gateArguments.includes("--smoke"),
      exitCode,
      childPid,
      processReaped: childProcessReaped(childPid),
      durationMs: Date.now() - started,
      stdout: stdout.trim(),
      stderr: [stderr.trim(), error?.stack ?? error?.message].filter(Boolean).join("\n"),
      });
    };
    child.on("error", (error) => finish(-1, error));
    child.on("close", (code) => finish(code ?? -1));
  });
}

function parseLastJsonObject(output) {
  const source = String(output).trim();
  let start = source.lastIndexOf("{");
  while (start >= 0) {
    try {
      return JSON.parse(source.slice(start));
    } catch {
      start = source.lastIndexOf("{", start - 1);
    }
  }
  return null;
}

async function retainGateArtifact(gate, result, index) {
  const summary = parseLastJsonObject(result.stdout);
  const reportedPath = summary?.artifactPath ?? summary?.artifact ?? null;
  if (typeof reportedPath !== "string" || reportedPath.length === 0) {
    return {
      validated: false,
      reason: "child-summary-omitted-artifact-path",
      summary,
    };
  }
  const sourcePath = isAbsolute(reportedPath) ? reportedPath : resolve(repositoryRoot, reportedPath);
  try {
    const [serialized, sourceFile] = await Promise.all([
      readFile(sourcePath, "utf8"),
      stat(sourcePath),
    ]);
    const parsed = JSON.parse(serialized);
    await mkdir(retainedChildDirectory, { recursive: true });
    const retainedPath = join(
      retainedChildDirectory,
      `${String(index + 1).padStart(2, "0")}-${gate.id}.json`,
    );
    await writeFile(retainedPath, serialized);
    const schemaMatches = parsed?.schemaVersion === gate.schemaVersion;
    const passMatchesExit = parsed?.pass === (result.exitCode === 0);
    const strictParity = gate.id === "p14-marking"
      ? validateP14StrictParity(parsed)
      : null;
    const strictParityPass = strictParity?.pass ?? true;
    const cleanup = gate.id === "p14-marking"
      ? parsed?.validation?.ephemeralCleanup ?? null
      : parsed?.cleanup ?? null;
    const teardown = {
      processReaped: result.processReaped === true,
      artifactCleanupReported: cleanup !== null,
      artifactCleanupPass: cleanup?.pass ?? null,
      requiredArtifactCleanup: true,
    };
    teardown.pass = teardown.processReaped
      && (!teardown.requiredArtifactCleanup || teardown.artifactCleanupPass === true)
      && (teardown.artifactCleanupPass !== false);
    const provenance = validateChildArtifactProvenance({
      gate,
      mode: smoke ? "smoke" : "acceptance",
      artifactPath: sourcePath,
      artifact: parsed,
      artifactMtimeMs: sourceFile.mtimeMs,
      p25StartedAt: startedAt.toISOString(),
      childPid: result.childPid,
      repositoryRoot,
      preflightSource,
    });
    const validated = schemaMatches && passMatchesExit && strictParityPass && provenance.pass && teardown.pass;
    const reason = !schemaMatches
      ? "artifact-schema-mismatch"
      : !passMatchesExit
        ? "artifact-pass-disagrees-with-exit"
        : !strictParityPass
          ? "p14-strict-parity-failed"
          : !provenance.pass
            ? "child-artifact-provenance-failed"
            : !teardown.pass
              ? "child-teardown-failed"
          : null;
    return {
      validated,
      reason,
      expectedSchemaVersion: gate.schemaVersion,
      schemaVersion: parsed?.schemaVersion ?? null,
      pass: parsed?.pass ?? null,
      strictParity,
      provenance,
      teardown,
      summary,
      sourcePath,
      retainedPath,
      bytes: Buffer.byteLength(serialized),
      sha256: sha256(serialized),
    };
  } catch (error) {
    return {
      validated: false,
      reason: "child-artifact-unreadable",
      summary,
      sourcePath,
      error: String(error?.stack ?? error),
    };
  }
}

async function retainP14WarmupArtifact(gate, result) {
  const summary = parseLastJsonObject(result.stdout);
  const reportedPath = summary?.artifactPath ?? summary?.artifact ?? null;
  if (typeof reportedPath !== "string" || reportedPath.length === 0) {
    return { validated: false, reason: "warmup-summary-omitted-artifact-path", summary };
  }
  const sourcePath = isAbsolute(reportedPath) ? reportedPath : resolve(repositoryRoot, reportedPath);
  try {
    const [serialized, sourceFile] = await Promise.all([
      readFile(sourcePath, "utf8"),
      stat(sourcePath),
    ]);
    const parsed = JSON.parse(serialized);
    await mkdir(retainedChildDirectory, { recursive: true });
    const retainedPath = join(retainedChildDirectory, "00-p14-warmup.json");
    await writeFile(retainedPath, serialized);
    const functional = validateP14WarmupArtifact(parsed);
    const provenance = validateChildArtifactProvenance({
      gate,
      mode: "acceptance",
      artifactPath: sourcePath,
      artifact: parsed,
      artifactMtimeMs: sourceFile.mtimeMs,
      p25StartedAt: startedAt.toISOString(),
      childPid: result.childPid,
      repositoryRoot,
      preflightSource,
    });
    const teardown = {
      processReaped: result.processReaped === true,
      artifactCleanupPass: parsed?.validation?.ephemeralCleanup?.pass === true,
      playwrightSessionClosed: parsed?.validation?.ephemeralCleanup?.playwrightSessionClosed === true,
    };
    teardown.pass = Object.values(teardown).every(Boolean);
    const validated = parsed?.schemaVersion === gate.schemaVersion
      && functional.pass
      && provenance.pass
      && teardown.pass;
    return {
      validated,
      reason: validated ? null : "p14-warmup-validation-failed",
      schemaVersion: parsed?.schemaVersion ?? null,
      childExitCode: result.exitCode,
      functional,
      provenance,
      teardown,
      summary,
      sourcePath,
      retainedPath,
      bytes: Buffer.byteLength(serialized),
      sha256: sha256(serialized),
    };
  } catch (error) {
    return {
      validated: false,
      reason: "p14-warmup-artifact-unreadable",
      summary,
      sourcePath,
      error: String(error?.stack ?? error),
    };
  }
}

const preflightSource = await captureSourceIdentity();
const cleanSourceRequired = !smoke;
const preflightAccepted = !cleanSourceRequired || preflightSource.cleanSourceSet;
const results = [];
let warmup = null;
if (preflightAccepted) {
  const p14Gate = PARITY_GATES[0];
  process.stdout.write("[P25] p14 deterministic warm-up (fresh smoke child)\n");
  const warmupResult = await runGate(p14Gate, {
    id: "p14-warmup",
    args: ["--smoke"],
  });
  warmupResult.artifact = await retainP14WarmupArtifact(p14Gate, warmupResult);
  warmup = warmupResult;
  for (const gate of warmup.artifact.validated ? PARITY_GATES : []) {
    process.stdout.write(`[P25] ${gate.id}${smoke && gate.smoke ? " (smoke)" : ""}\n`);
    const result = await runGate(gate);
    result.artifact = await retainGateArtifact(gate, result, results.length);
    results.push(result);
  }
}

const validation = validateParityResults(results);
const postflightSource = await captureSourceIdentity();
const sourceStable = sameSourceIdentity(preflightSource, postflightSource);
const sourceAccepted = preflightAccepted && sourceStable;
const artifact = {
  schemaVersion: ARTIFACT_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  startedAt: startedAt.toISOString(),
  mode: smoke ? "smoke" : "acceptance",
  pass: warmup?.artifact?.validated === true && validation.pass && sourceAccepted,
  source: {
    requiredClean: cleanSourceRequired,
    accepted: sourceAccepted,
    stable: sourceStable,
    allowedArtifactRoots: PARITY_ARTIFACT_ROOTS,
    preflight: preflightSource,
    postflight: postflightSource,
  },
  contract: {
    order: PARITY_GATES.map(({ id }) => id),
    artifactSchemas: Object.fromEntries(PARITY_GATES.map(({ id, schemaVersion }) => [id, schemaVersion])),
    budgetPolicy: "Each component gate runs unchanged; P25 supplies no budget overrides.",
    p14Warmup: {
      child: "fresh process and fresh playwright-cli session/profile",
      samples: "full smoke run retained as functional warm-up evidence; budget outcomes do not replace measured acceptance samples",
      externalObserver: "none",
      teardown: "warm-up child, browser session, and ephemeral profile must be closed before measured P14 starts",
    },
    strictParity: {
      p14RewriteP95MaximumLegacyRatio: STRICT_P95_LEGACY_RATIO,
      inputLongTaskMaximumMs: STRICT_INPUT_LONG_TASK_BUDGET_MS,
      inputLongTaskAppliesTo: "rewrite physical input windows; legacy windows retained for comparison",
      override: "none",
    },
  },
  validation,
  warmup,
  results,
};
const timestamp = artifact.generatedAt.replaceAll(":", "-").replace(".", "-");
const artifactPath = smoke
  ? join("/tmp", `unfluffify-p25-parity-smoke-${process.pid}.json`)
  : join(repositoryRoot, "output/playwright/p25-parity", `acceptance-${timestamp}.json`);
await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  pass: artifact.pass,
  artifact: artifactPath,
  completed: results.map(({ id }) => id),
  complete: validation.complete,
  missing: validation.missing,
  failed: validation.failed,
  warmup: {
    validated: warmup?.artifact?.validated ?? false,
    path: warmup?.artifact?.retainedPath ?? null,
  },
  retainedChildren: results.map(({ id, artifact: childArtifact }) => ({
    id,
    validated: childArtifact?.validated ?? false,
    path: childArtifact?.retainedPath ?? null,
  })),
}, null, 2)}\n`);
if (!artifact.pass) process.exitCode = 1;
