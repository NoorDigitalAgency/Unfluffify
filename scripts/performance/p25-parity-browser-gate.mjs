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

function runGate(gate) {
  return new Promise((resolvePromise) => {
    const args = [gate.script, ...(smoke && gate.smoke ? ["--smoke"] : [])];
    const started = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childPid = child.pid ?? null;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolvePromise({
      id: gate.id,
      script: gate.script,
      smoke: smoke && gate.smoke,
      exitCode: -1,
      childPid,
      durationMs: Date.now() - started,
      stdout: stdout.trim(),
      stderr: [stderr.trim(), error.stack ?? error.message].filter(Boolean).join("\n"),
    }));
    child.on("close", (code) => resolvePromise({
      id: gate.id,
      script: gate.script,
      smoke: smoke && gate.smoke,
      exitCode: code ?? -1,
      childPid,
      durationMs: Date.now() - started,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }));
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
    const validated = schemaMatches && passMatchesExit && strictParityPass && provenance.pass;
    const reason = !schemaMatches
      ? "artifact-schema-mismatch"
      : !passMatchesExit
        ? "artifact-pass-disagrees-with-exit"
        : !strictParityPass
          ? "p14-strict-parity-failed"
          : !provenance.pass
            ? "child-artifact-provenance-failed"
          : null;
    return {
      validated,
      reason,
      expectedSchemaVersion: gate.schemaVersion,
      schemaVersion: parsed?.schemaVersion ?? null,
      pass: parsed?.pass ?? null,
      strictParity,
      provenance,
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

const preflightSource = await captureSourceIdentity();
const cleanSourceRequired = !smoke;
const preflightAccepted = !cleanSourceRequired || preflightSource.cleanSourceSet;
const results = [];
if (preflightAccepted) {
  for (const gate of PARITY_GATES) {
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
  pass: validation.pass && sourceAccepted,
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
    strictParity: {
      p14RewriteP95MaximumLegacyRatio: STRICT_P95_LEGACY_RATIO,
      inputLongTaskMaximumMs: STRICT_INPUT_LONG_TASK_BUDGET_MS,
      inputLongTaskAppliesTo: "rewrite physical input windows; legacy windows retained for comparison",
      override: "none",
    },
  },
  validation,
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
  retainedChildren: results.map(({ id, artifact: childArtifact }) => ({
    id,
    validated: childArtifact?.validated ?? false,
    path: childArtifact?.retainedPath ?? null,
  })),
}, null, 2)}\n`);
if (!artifact.pass) process.exitCode = 1;
