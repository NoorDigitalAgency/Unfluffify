#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONSECUTIVE_ARTIFACT_SCHEMA_VERSION,
  REQUIRED_CONSECUTIVE_PASSES,
  validateConsecutiveP25Runs,
} from "./p25/consecutive-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const p25Script = join(scriptDirectory, "p25-parity-browser-gate.mjs");
const startedAt = new Date();

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function childProcessReaped(childPid) {
  if (!Number.isInteger(childPid)) return true;
  try {
    process.kill(childPid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function runP25(ordinal) {
  return new Promise((resolvePromise) => {
    const environment = { ...process.env };
    delete environment.PLAYWRIGHT_CLI_SESSION;
    delete environment.PWDEBUG;
    const started = Date.now();
    const child = spawn(process.execPath, [p25Script], {
      cwd: repositoryRoot,
      env: {
        ...environment,
        UF_P25_CONSECUTIVE_ORDINAL: String(ordinal),
        UF_P25_EXTERNAL_OBSERVER: "none",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childPid = child.pid ?? null;
    let stdout = "";
    let stderr = "";
    let spawnError = null;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (code) => resolvePromise({
      ordinal,
      exitCode: code ?? -1,
      childPid,
      processReaped: childProcessReaped(childPid),
      durationMs: Date.now() - started,
      stdout: stdout.trim(),
      stderr: [stderr.trim(), spawnError?.stack ?? spawnError?.message].filter(Boolean).join("\n"),
    }));
  });
}

async function adoptArtifact(result) {
  const summary = parseLastJsonObject(result.stdout);
  const reportedPath = summary?.artifact ?? summary?.artifactPath ?? null;
  if (typeof reportedPath !== "string" || reportedPath.length === 0) {
    return { ...result, summary, artifactPath: null, artifact: null, artifactError: "summary-omitted-artifact" };
  }
  const artifactPath = isAbsolute(reportedPath) ? reportedPath : resolve(repositoryRoot, reportedPath);
  try {
    const [serialized, file] = await Promise.all([readFile(artifactPath, "utf8"), stat(artifactPath)]);
    return {
      ...result,
      summary,
      artifactPath,
      artifact: JSON.parse(serialized),
      artifactBytes: file.size,
      artifactSha256: sha256(serialized),
      stdout: undefined,
      stderr: result.stderr || undefined,
    };
  } catch (error) {
    return {
      ...result,
      summary,
      artifactPath,
      artifact: null,
      artifactError: String(error?.stack ?? error),
    };
  }
}

const runs = [];
for (let ordinal = 1; ordinal <= REQUIRED_CONSECUTIVE_PASSES; ordinal += 1) {
  process.stdout.write(`[P25 consecutive] pass ${ordinal}/${REQUIRED_CONSECUTIVE_PASSES}\n`);
  const run = await adoptArtifact(await runP25(ordinal));
  runs.push(run);
  if (run.exitCode !== 0 || run.artifact?.pass !== true) {
    break;
  }
}

const validation = validateConsecutiveP25Runs(runs);
const generatedAt = new Date().toISOString();
const artifact = {
  schemaVersion: CONSECUTIVE_ARTIFACT_SCHEMA_VERSION,
  generatedAt,
  startedAt: startedAt.toISOString(),
  pass: validation.pass,
  contract: {
    requiredConsecutivePasses: REQUIRED_CONSECUTIVE_PASSES,
    order: "strictly sequential; a failed pass breaks the sequence",
    source: "same clean HEAD for every child P25 acceptance",
    budgetOverride: "none",
    externalObserver: "none",
  },
  validation,
  runs: runs.map((run) => ({
    ...Object.fromEntries(Object.entries(run).filter(([key]) => key !== "artifact" && key !== "stdout")),
    artifact: run.artifact ? {
      schemaVersion: run.artifact.schemaVersion,
      generatedAt: run.artifact.generatedAt,
      mode: run.artifact.mode,
      pass: run.artifact.pass,
      source: run.artifact.source,
      warmup: run.artifact.warmup,
      validation: run.artifact.validation,
    } : null,
  })),
};
const timestamp = generatedAt.replaceAll(":", "-").replace(".", "-");
const artifactPath = join(
  repositoryRoot,
  "output/playwright/p25-parity",
  `consecutive-${timestamp}.json`,
);
await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  pass: artifact.pass,
  artifact: artifactPath,
  completed: runs.length,
  required: REQUIRED_CONSECUTIVE_PASSES,
  checks: validation.checks,
}, null, 2)}\n`);
if (!artifact.pass) process.exitCode = 1;
