#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { arch, platform, release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build, version as esbuildVersion } from "esbuild";

import {
  ARTIFACT_SCHEMA_VERSION,
  BUDGETS,
  FIXTURES,
  LEGACY_SOURCE,
  OPERATION_NAMES,
  SELECTORS,
  SELECTORS_BY_MODE,
  createRunPlan,
  evaluateBudget,
  normalizeSemanticSignature,
  semanticDifference,
  summarizeSamples,
  validateInputLongTaskWindows,
} from "./p14/contract.mjs";
import { renderFixtureBody, renderFixturePage } from "./p14/fixture.mjs";
import { classifyParitySourceStatus } from "./p25/source-identity.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const p14Directory = join(scriptDirectory, "p14");
const outputDirectory = join(repositoryRoot, "output/playwright/p14-marking-performance");
const buildDirectory = join(outputDirectory, "build");
const archiveDirectory = join(buildDirectory, "legacy-archive");
const latestArtifactPath = join(outputDirectory, "latest.json");
const playwrightCli = resolve(
  process.env.P14_PLAYWRIGHT_CLI
    ?? join(p14Directory, "playwright-cli.sh"),
);
const playwrightWorkingDirectory = join(buildDirectory, "playwright-cli-session");
const expectedPlaywrightCliVersion = "0.1.17";

const smoke = process.argv.includes("--smoke");
const firstScenarioOnly = process.argv.includes("--first-scenario");
const scenarioArgument = process.argv.find((argument) => argument.startsWith("--scenario="));
const selectedScenarios = scenarioArgument
  ? new Set((scenarioArgument.split("=")[1] ?? "").split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isInteger))
  : null;
const counts = smoke ? { warmups: 1, samples: 5 } : { warmups: 3, samples: 21 };
const fullRunPlan = createRunPlan(counts);
const runPlan = selectedScenarios?.size
  ? fullRunPlan.filter((scenario) => selectedScenarios.has(scenario.sequence))
  : firstScenarioOnly
    ? fullRunPlan.slice(0, 1)
    : fullRunPlan;
const startedAt = new Date();
const diagnostic = runPlan.length !== fullRunPlan.length;
const runKind = diagnostic ? "diagnostic" : smoke ? "smoke" : "acceptance";
const artifactTimestamp = startedAt.toISOString().replaceAll(":", "-").replace(".", "-");
const retainedArtifactPath = join(outputDirectory, `${runKind}-${artifactTimestamp}.json`);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", resolvePromise)
      .on("error", reject);
  });
  return hash.digest("hex");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeArtifactAtomic(path, contents) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, path);
}

async function fileManifest(paths, baseDirectory = repositoryRoot) {
  const manifest = {};
  for (const path of [...new Set(paths)].sort()) {
    const absolutePath = resolve(baseDirectory, path);
    const displayPath = relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
    const fileStats = await stat(absolutePath);
    manifest[displayPath] = {
      bytes: fileStats.size,
      mode: (fileStats.mode & 0o777).toString(8),
      sha256: await sha256File(absolutePath),
    };
  }
  return manifest;
}

async function buildInputManifest(metafile, workingDirectory) {
  return fileManifest(Object.keys(metafile.inputs), workingDirectory);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error([
          `${command} ${args.join(" ")} exited ${code}`,
          stdout.trim(),
          stderr.trim(),
        ].filter(Boolean).join("\n")));
        return;
      }
      resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function git(...args) {
  return (await run("git", args)).stdout;
}

async function captureSourceIdentity() {
  const fullStatus = await git("status", "--porcelain=v1", "--untracked-files=all", "--", ".");
  const classifiedStatus = classifyParitySourceStatus(fullStatus);
  const trackedDiff = (await run("git", ["diff", "--binary", "HEAD", "--", "."])).stdout;
  const manifestPaths = (await git(
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ".gitignore",
    "package.json",
    "pnpm-lock.yaml",
    "scripts/performance/p14-marking-browser-gate.mjs",
    "scripts/performance/p14",
    "scripts/performance/p25/source-identity.mjs",
    "tests/p14-browser-performance-contract.test.ts",
  )).split("\n").filter(Boolean);
  return {
    headCommit: await git("rev-parse", "HEAD"),
    cleanSourceSet: classifiedStatus.cleanSourceSet,
    status: classifiedStatus.status,
    artifactStatus: classifiedStatus.artifactStatus,
    trackedDiffSha256: sha256(trackedDiff),
    harnessManifest: await fileManifest(manifestPaths),
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function occurrenceCount(source, token) {
  return source.split(token).length - 1;
}

async function appendInstrumentedSource(path, requirements, addition) {
  const original = await readFile(path, "utf8");
  for (const [token, expectedCount] of requirements) {
    assertEqual(occurrenceCount(original, token), expectedCount, `${path} occurrence of ${token}`);
  }
  await appendFile(path, addition, "utf8");
  return {
    originalSha256: sha256(original),
    appendedTextSha256: sha256(addition),
    instrumentedSha256: await sha256File(path),
  };
}

async function verifyAndExtractLegacy() {
  assertEqual(await git("cat-file", "-t", LEGACY_SOURCE.annotatedTagObject), "tag", "legacy annotated object type");
  assertEqual(
    await git("rev-parse", `${LEGACY_SOURCE.annotatedTagObject}^{}`),
    LEGACY_SOURCE.peeledCommit,
    "legacy peeled commit",
  );
  assertEqual(
    await git("rev-parse", `${LEGACY_SOURCE.annotatedTagObject}^{tree}`),
    LEGACY_SOURCE.tree,
    "legacy tree",
  );
  for (const [path, blob] of Object.entries(LEGACY_SOURCE.blobs)) {
    assertEqual(await git("rev-parse", `${LEGACY_SOURCE.peeledCommit}:${path}`), blob, `legacy blob ${path}`);
  }

  const archiveTar = join(buildDirectory, "legacy.tar");
  await mkdir(archiveDirectory, { recursive: true });
  await run("git", [
    "archive",
    "--format=tar",
    `--output=${archiveTar}`,
    LEGACY_SOURCE.peeledCommit,
  ]);
  await run("tar", ["-xf", archiveTar, "-C", archiveDirectory]);
  await rm(archiveTar);
  for (const [path, blob] of Object.entries(LEGACY_SOURCE.blobs)) {
    assertEqual(
      await git("hash-object", join(archiveDirectory, path)),
      blob,
      `archived legacy blob ${path}`,
    );
  }

  const coreAddition = `
// P14 benchmark seams: append-only read access to the pinned legacy closure.
export {
  getMarkId as __p14GetMarkId,
  removePageMarkingEntriesForPage as __p14RemovePageMarkingEntriesForPage
};
export function __p14GetCurrentPageEntry(): PageMarkingEntry | null {
  return state.currentPageEntry;
}
export function __p14GetMarkingClassifications(): Array<readonly [string, string]> {
  const collections = state.cachedCollections;
  const classifications = new Map<Element, string>();
  const put = (values: Iterable<Element> | null | undefined, classification: string): void => {
    for (const element of values || []) {
      if (element?.nodeType === 1) {
        classifications.set(element, classification);
      }
    }
  };
  put(collections?.defaultElements, "implicit-include");
  put(collections?.aiContentElements, "implicit-include");
  put(collections?.hiddenAiContentElements, "implicit-include");
  put(collections?.selectorExcludedElements, "exception");
  put(collections?.explicitExcludeElements, "exception");
  put(collections?.fetchedExplicitExcludeElements, "exception");
  put(collections?.sessionExplicitExcludeElements, "exception");
  put(collections?.explicitIncludeElements, "explicit-include");
  put(collections?.hiddenExplicitIncludeElements, "explicit-include");
  put(collections?.fetchedExplicitIncludeElements, "explicit-include");
  put(collections?.hiddenFetchedExplicitIncludeElements, "explicit-include");
  put(collections?.sessionExplicitIncludeElements, "explicit-include");
  put(collections?.hiddenSessionExplicitIncludeElements, "explicit-include");
  put(collections?.aiAnimatedExplicitIncludeElements, "explicit-include");
  put(collections?.hiddenAiAnimatedExplicitIncludeElements, "explicit-include");
  put(collections?.hardElements, "immutable");
  return Array.from(classifications, ([element, classification]) => [getXPath(element).toLowerCase(), classification]);
}
export function __p14GetExplicitMarkingClassifications(): Array<readonly [string, string]> {
  const classifications = new Map<Element, string>();
  const put = (values: Iterable<Element> | null | undefined, classification: string): void => {
    for (const element of values || []) {
      if (element?.nodeType === 1) {
        classifications.set(element, classification);
      }
    }
  };
  const currentEntry = state.currentPageEntry || getDraftPageEntry(location.href);
  const explicitCollections = collectExplicitMarkingElements(currentEntry);
  const split = splitExplicitMarkingCollectionsBySavedState(
    explicitCollections,
    getSavedPageEntry(location.href)
  );
  put(split.fetchedExplicitExcludeElements, "exception");
  put(split.sessionExplicitExcludeElements, "exception");
  put(split.fetchedExplicitIncludeElements, "explicit-include");
  put(split.sessionExplicitIncludeElements, "explicit-include");
  put(split.hiddenFetchedExplicitIncludeElements, "explicit-include");
  put(split.hiddenSessionExplicitIncludeElements, "explicit-include");
  return Array.from(classifications, ([element, classification]) => [getXPath(element).toLowerCase(), classification]);
}
`;
  const contentMainAddition = `
// P14 benchmark seams: append-only exports from the pinned legacy closure.
export {
  collectAiSubmissionXpathsForCurrentPage as __p14CollectAiSubmissionXpathsForCurrentPage,
  refreshSilentHighlightings as __p14RefreshSilentHighlightings,
  deactivateSilentHighlightings as __p14DeactivateSilentHighlightings,
  scheduleSilentHighlightReposition as __p14ScheduleSilentHighlightReposition,
  loadAndNormalizeConfigs as __p14LoadAndNormalizeConfigs
};
export function __p14GetSilentSemanticRows(): Array<{ xpath: string; excluded: boolean; explicit?: boolean }> {
  const rows = new Map<string, { xpath: string; excluded: boolean; explicit?: boolean }>();
  const add = (
    values: Map<Element, string> | null | undefined,
    excluded: boolean,
    explicit?: boolean
  ): void => {
    for (const xpath of values?.values?.() || []) {
      if (typeof xpath === "string" && xpath) {
        rows.set(xpath.toLowerCase(), explicit === undefined
          ? { xpath: xpath.toLowerCase(), excluded }
          : { xpath: xpath.toLowerCase(), excluded, explicit });
      }
    }
  };
  add(silentHighlightCollections?.implicitIncludeXpathByNode, false);
  for (const [node, rawXpath] of silentHighlightCollections?.excludedXpathByNode || []) {
    if (typeof rawXpath !== "string" || !rawXpath) {
      continue;
    }
    const xpath = rawXpath.toLowerCase();
    rows.set(xpath, silentHighlightCollections?.excludedSelectorByNode?.has(node)
      ? { xpath, excluded: true, explicit: true }
      : { xpath, excluded: true });
  }
  // Inclusion wins when selector groups overlap, matching the actual source maps.
  add(silentHighlightCollections?.explicitIncludeXpathByNode, false, true);
  return Array.from(rows.values());
}
export function __p14GetSilentClassifications(): Array<readonly [string, string]> {
  const classifications = new Map<string, string>();
  const put = (values: Map<Element, string> | null | undefined, classification: string): void => {
    for (const xpath of values?.values?.() || []) {
      if (typeof xpath === "string" && xpath) {
        classifications.set(xpath.toLowerCase(), classification);
      }
    }
  };
  put(silentHighlightCollections?.implicitIncludeXpathByNode, "implicit-include");
  put(silentHighlightCollections?.excludedXpathByNode, "exception");
  put(silentHighlightCollections?.explicitIncludeXpathByNode, "explicit-include");
  for (const element of silentHighlightCollections?.immutableNodes || []) {
    const xpath = core.getXPath(element);
    if (xpath) {
      classifications.set(xpath.toLowerCase(), "immutable");
    }
  }
  return Array.from(classifications.entries());
}
`;
  const layerHostAddition = `
// P14 benchmark seam: set the same module-local directive consumed by legacy.
export function __p14SetContentDirective(directive: ContentDirectiveLike | null): void {
  latestContentDirective = directive && typeof directive === "object" ? directive : null;
  notifyContentDirectiveListeners();
}
`;
  const transformations = {
    "src/content/core.ts": await appendInstrumentedSource(
      join(archiveDirectory, "src/content/core.ts"),
      [
        ["function getMarkId(", 1],
        ["function removePageMarkingEntriesForPage(", 1],
        ["export function collectExplicitMarkingElements(", 1],
        ["function splitExplicitMarkingCollectionsBySavedState(", 1],
      ],
      coreAddition,
    ),
    "src/content-main.ts": await appendInstrumentedSource(
      join(archiveDirectory, "src/content-main.ts"),
      [
        ["async function refreshSilentHighlightings()", 1],
        ["function deactivateSilentHighlightings()", 1],
        ["function scheduleSilentHighlightReposition(", 1],
        ["function collectAiSubmissionXpathsForCurrentPage(", 1],
        ["let silentHighlightCollections", 1],
      ],
      contentMainAddition,
    ),
    "src/content/layers/layer-host.ts": await appendInstrumentedSource(
      join(archiveDirectory, "src/content/layers/layer-host.ts"),
      [
        ["let latestContentDirective", 1],
        ["function notifyContentDirectiveListeners()", 1],
      ],
      layerHostAddition,
    ),
  };

  await copyFile(join(p14Directory, "legacy-runtime.ts"), join(archiveDirectory, "src/p14-runtime.ts"));
  await copyFile(join(p14Directory, "runtime-common.ts"), join(archiveDirectory, "src/p14-runtime-common.ts"));
  return transformations;
}

async function buildBrowserBundles() {
  const rewriteBundle = join(buildDirectory, "rewrite.js");
  const legacyBundle = join(buildDirectory, "legacy.js");
  const shared = {
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome116"],
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    define: { __UF_DEBUG_BUILD__: "false" },
    logLevel: "warning",
  };
  const rewriteBuild = await build({
    ...shared,
    absWorkingDir: repositoryRoot,
    entryPoints: ["scripts/performance/p14/rewrite-runtime.ts"],
    outfile: rewriteBundle,
    metafile: true,
  });
  const legacyBuild = await build({
    ...shared,
    absWorkingDir: archiveDirectory,
    entryPoints: ["src/p14-runtime.ts"],
    outfile: legacyBundle,
    nodePaths: [join(repositoryRoot, "node_modules")],
    metafile: true,
  });
  return {
    benchmarkCompiler: {
      name: "esbuild",
      version: esbuildVersion,
      packageManifest: (await fileManifest(["node_modules/esbuild/package.json"]))["node_modules/esbuild/package.json"],
    },
    rewrite: {
      generatedName: "rewrite.js (ephemeral; removed after hashing)",
      bytes: (await stat(rewriteBundle)).size,
      sha256: await sha256File(rewriteBundle),
      inputManifest: await buildInputManifest(rewriteBuild.metafile, repositoryRoot),
    },
    legacy: {
      generatedName: "legacy.js (ephemeral; removed after hashing)",
      bytes: (await stat(legacyBundle)).size,
      sha256: await sha256File(legacyBundle),
      inputManifest: await buildInputManifest(legacyBuild.metafile, archiveDirectory),
    },
  };
}

function contentType(pathname) {
  return pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
}

async function startFixtureServer() {
  let browserPayload = null;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("cache-control", "no-store");
      if (request.method === "GET" && url.pathname === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end("<!doctype html><title>P14 gate</title><p>P14 browser gate controller</p>");
        return;
      }
      if (request.method === "GET" && url.pathname === "/plan.json") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ scenarios: runPlan, selectorsByMode: SELECTORS_BY_MODE }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/fixture") {
        const fixture = url.searchParams.get("fixture") ?? "";
        const runtime = url.searchParams.get("runtime") ?? "";
        if (!FIXTURES[fixture] || !["rewrite", "legacy"].includes(runtime)) {
          response.statusCode = 400;
          response.end("Invalid fixture request");
          return;
        }
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(renderFixturePage({
          fixture,
          runtime,
          nonce: url.searchParams.get("sequence") ?? "0",
        }));
        return;
      }
      if (request.method === "GET" && ["/rewrite.js", "/legacy.js"].includes(url.pathname)) {
        response.setHeader("content-type", contentType(url.pathname));
        createReadStream(join(buildDirectory, url.pathname.slice(1))).pipe(response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/results") {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 50_000_000) {
            throw new Error("Browser result payload exceeded 50 MB");
          }
          chunks.push(chunk);
        }
        browserPayload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.statusCode = 404;
      response.end("Not found");
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error?.stack ?? error));
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine P14 fixture server port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    payload: () => browserPayload,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())),
  };
}

async function runPlaywrightCli(baseUrl) {
  const session = `p14-gate-${process.pid}`;
  const cliEnvironment = {
    PLAYWRIGHT_CLI_SESSION: session,
    PLAYWRIGHT_CLI_TIMEOUT: smoke ? "600000" : "1800000",
  };
  await mkdir(playwrightWorkingDirectory, { recursive: true });
  let opened = false;
  let closeAttempted = false;
  let closed = false;
  let controllerResult;
  try {
    await run(playwrightCli, ["open", baseUrl], { env: cliEnvironment, cwd: playwrightWorkingDirectory });
    opened = true;
    await run(playwrightCli, ["resize", "1280", "900"], { env: cliEnvironment, cwd: playwrightWorkingDirectory });
    controllerResult = await run(playwrightCli, [
      "run-code",
      `--filename=${join(p14Directory, "playwright-controller.js")}`,
    ], { env: cliEnvironment, cwd: playwrightWorkingDirectory });
  } finally {
    if (opened) {
      closeAttempted = true;
      await run(playwrightCli, ["close"], { env: cliEnvironment, cwd: playwrightWorkingDirectory });
      closed = true;
    }
  }
  return {
    controllerResult,
    lifecycle: {
      session,
      opened,
      closeAttempted,
      closed,
      observer: "none",
      workingDirectory: relative(repositoryRoot, playwrightWorkingDirectory).replaceAll("\\", "/"),
      profilePolicy: "fresh gate-owned playwright-cli session under a pre-cleaned ephemeral build directory",
    },
  };
}

function validateSemanticSignatures(signatures) {
  const checks = [];
  for (const fixture of Object.keys(FIXTURES)) {
    for (const mode of ["silent", "marking"]) {
      const stages = mode === "marking"
        ? ["before", "after-click", "after-mutation"]
        : ["before", "after-mutation"];
      for (const stage of stages) {
        const rewriteKey = `${fixture}/${mode}/rewrite/${stage}`;
        const legacyKey = `${fixture}/${mode}/legacy/${stage}`;
        const rewritePresent = Object.prototype.hasOwnProperty.call(signatures, rewriteKey);
        const legacyPresent = Object.prototype.hasOwnProperty.call(signatures, legacyKey);
        const rewriteSignature = rewritePresent ? signatures[rewriteKey] : null;
        const legacySignature = legacyPresent ? signatures[legacyKey] : null;
        const nonempty = Boolean(
          rewriteSignature?.rows?.length
          && rewriteSignature?.classes?.length
          && legacySignature?.rows?.length
          && legacySignature?.classes?.length,
        );
        if (!rewritePresent || !legacyPresent || !nonempty) {
          checks.push({
            fixture,
            mode,
            stage,
            rewriteKey,
            legacyKey,
            pass: false,
            reason: "missing-signature",
            present: { rewrite: rewritePresent, legacy: legacyPresent },
            counts: {
              rewriteRows: rewriteSignature?.rows?.length ?? 0,
              rewriteClasses: rewriteSignature?.classes?.length ?? 0,
              legacyRows: legacySignature?.rows?.length ?? 0,
              legacyClasses: legacySignature?.classes?.length ?? 0,
            },
            difference: null,
          });
          continue;
        }
        const shapePass = [rewriteSignature, legacySignature].every((signature) => {
          if (signature.rows.length !== signature.classes.length) {
            return false;
          }
          const rowIds = new Set(signature.rows.map((row) => row.id));
          const classIds = new Set(signature.classes.map((entry) => entry.id));
          return rowIds.size === signature.rows.length
            && classIds.size === signature.classes.length
            && rowIds.size === classIds.size
            && [...rowIds].every((id) => classIds.has(id));
        });
        if (!shapePass) {
          checks.push({
            fixture,
            mode,
            stage,
            rewriteKey,
            legacyKey,
            pass: false,
            reason: "invalid-signature-shape",
            difference: null,
          });
          continue;
        }
        const difference = semanticDifference(rewriteSignature, legacySignature);
        checks.push({
          fixture,
          mode,
          stage,
          rewriteKey,
          legacyKey,
          pass: difference === null,
          difference,
        });
      }
    }
  }
  return checks;
}

function compactSemanticEvidence(signatures, checks) {
  const catalog = {};
  const runtimeEvidence = (key) => {
    const signature = signatures[key];
    if (!signature) {
      return { key, present: false };
    }
    const normalized = normalizeSemanticSignature(signature);
    const digest = sha256(JSON.stringify(normalized));
    if (!catalog[digest]) {
      catalog[digest] = normalized;
    }
    return {
      key,
      present: true,
      digest,
      rowCount: normalized.rows.length,
      classCount: normalized.classes.length,
      classificationCoverage: signature.classificationCoverage ?? null,
    };
  };
  return {
    signatureCatalog: catalog,
    checks: checks.map((check) => ({
      fixture: check.fixture,
      mode: check.mode,
      stage: check.stage,
      pass: check.pass,
      ...(check.reason ? { reason: check.reason } : {}),
      rewrite: runtimeEvidence(check.rewriteKey),
      legacy: runtimeEvidence(check.legacyKey),
      ...(check.difference ? { difference: check.difference } : {}),
    })),
  };
}

function summarizeRuns(runs) {
  const summaries = {};
  for (const fixture of Object.keys(FIXTURES)) {
    summaries[fixture] = {};
    for (const runtime of ["rewrite", "legacy"]) {
      summaries[fixture][runtime] = {};
      const measured = runs.filter((runItem) =>
        !runItem.warmup && runItem.fixture === fixture && runItem.runtime === runtime
      );
      for (const operation of Object.keys(BUDGETS[fixture])) {
        const values = measured.flatMap((runItem) =>
          typeof runItem.timings[operation] === "number" ? [runItem.timings[operation]] : []
        );
        if (values.length > 0) {
          summaries[fixture][runtime][operation] = summarizeSamples(values);
        }
      }
    }
  }
  return summaries;
}

function validateSampleCardinality(runs, summaries) {
  const scenarioChecks = [];
  for (const fixture of Object.keys(FIXTURES)) {
    for (const mode of ["silent", "marking"]) {
      for (const runtime of ["rewrite", "legacy"]) {
        const matching = runs.filter((runItem) =>
          runItem.fixture === fixture && runItem.mode === mode && runItem.runtime === runtime
        );
        const warmupCount = matching.filter((runItem) => runItem.warmup).length;
        const measuredCount = matching.filter((runItem) => !runItem.warmup).length;
        scenarioChecks.push({
          fixture,
          mode,
          runtime,
          warmupCount,
          measuredCount,
          expectedWarmups: counts.warmups,
          expectedSamples: counts.samples,
          pass: warmupCount === counts.warmups && measuredCount === counts.samples,
        });
      }
    }
  }
  const operationChecks = [];
  for (const fixture of Object.keys(FIXTURES)) {
    for (const runtime of ["rewrite", "legacy"]) {
      for (const operation of OPERATION_NAMES) {
        const actual = summaries[fixture]?.[runtime]?.[operation]?.count ?? 0;
        operationChecks.push({
          fixture,
          runtime,
          operation,
          actual,
          expected: counts.samples,
          pass: actual === counts.samples,
        });
      }
    }
  }
  return {
    pass: scenarioChecks.every((check) => check.pass) && operationChecks.every((check) => check.pass),
    scenarios: scenarioChecks,
    operations: operationChecks,
  };
}

function validateRunPlan(runs) {
  const identity = (runItem) => ({
    sequence: runItem.sequence,
    fixture: runItem.fixture,
    mode: runItem.mode,
    runtime: runItem.runtime,
    warmup: runItem.warmup,
    sample: runItem.sample,
  });
  const expected = runPlan.map(identity);
  const actual = runs.map(identity);
  const mismatchIndex = Array.from(
    { length: Math.max(expected.length, actual.length) },
    (_, index) => index,
  ).find((index) => JSON.stringify(expected[index]) !== JSON.stringify(actual[index]));
  return {
    pass: mismatchIndex === undefined,
    expectedCount: expected.length,
    actualCount: actual.length,
    expectedDigest: sha256(JSON.stringify(expected)),
    actualDigest: sha256(JSON.stringify(actual)),
    mismatchIndex: mismatchIndex ?? null,
    expectedAtMismatch: mismatchIndex === undefined ? null : expected[mismatchIndex] ?? null,
    actualAtMismatch: mismatchIndex === undefined ? null : actual[mismatchIndex] ?? null,
  };
}

function validateRunTimings(runs) {
  const expectedByMode = {
    silent: [
      "silentActivation",
      "silentMutationStabilization",
      "silentScrollReposition",
    ],
    marking: [
      "markingActivation",
      "markingClickCommitPaint",
      "markingHover",
      "markingMutationStabilization",
      "markingScrollReposition",
    ],
  };
  const checks = runs.map((runItem) => {
    const expectedKeys = expectedByMode[runItem.mode];
    const actualKeys = Object.keys(runItem.timings ?? {}).sort();
    const valuesValid = actualKeys.every((key) =>
      typeof runItem.timings[key] === "number"
      && Number.isFinite(runItem.timings[key])
      && runItem.timings[key] >= 0
    );
    return {
      sequence: runItem.sequence,
      expectedKeys,
      actualKeys,
      valuesValid,
      pass: JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) && valuesValid,
    };
  });
  return { pass: checks.length === runs.length && checks.every((check) => check.pass), checks };
}

function validateBrowserEnvironment(environment) {
  const checks = {
    viewportWidth: environment?.viewport?.width === 1280,
    viewportHeight: environment?.viewport?.height === 900,
    devicePixelRatio: environment?.devicePixelRatio === 1,
    browserVersion: typeof environment?.browserVersion === "string" && environment.browserVersion.length > 0,
    browserType: environment?.browserType === "chromium",
    chromiumUserAgent: typeof environment?.userAgent === "string" && /Chrom(?:e|ium)\//.test(environment.userAgent),
  };
  return { pass: Object.values(checks).every(Boolean), checks, actual: environment ?? null };
}

function evaluateBudgets(summaries, semantics) {
  const checks = [];
  for (const fixture of Object.keys(FIXTURES)) {
    for (const [operation, budget] of Object.entries(BUDGETS[fixture])) {
      const mode = operation.startsWith("silent") ? "silent" : "marking";
      const semanticPairs = semantics.filter((check) => check.fixture === fixture && check.mode === mode);
      const expectedPairCount = mode === "silent" ? 2 : 3;
      const semanticIdentityPass = semanticPairs.length === expectedPairCount
        && semanticPairs.every((check) => check.pass);
      if (!semanticIdentityPass) {
        checks.push({
          fixture,
          operation,
          pass: false,
          skipped: true,
          reason: "semantic-mismatch",
          semanticStages: semanticPairs.map((check) => ({ stage: check.stage, pass: check.pass })),
        });
        continue;
      }
      const rewrite = summaries[fixture].rewrite[operation];
      const legacy = summaries[fixture].legacy[operation];
      if (!rewrite || !legacy) {
        checks.push({ fixture, operation, pass: false, reason: "missing-summary" });
        continue;
      }
      checks.push({ fixture, operation, ...evaluateBudget(rewrite, legacy, budget) });
    }
  }
  return checks;
}

function validateRewriteActivation(runs) {
  return runs
    .filter((runItem) => runItem.runtime === "rewrite")
    .map((runItem) => {
      const expected = runItem.mode === "silent"
        ? ["bridge", "store-evaluate", "candidate-index", "silent-render"]
        : ["bridge", "store-evaluate", "candidate-index", "marking-render", "silent-render"];
      const actual = runItem.activation.stages;
      return {
        sequence: runItem.sequence,
        fixture: runItem.fixture,
        mode: runItem.mode,
        pass: JSON.stringify(actual) === JSON.stringify(expected)
          && runItem.activation.seededSelectors === (runItem.mode === "silent"),
        expected,
        actual,
        seededSelectors: runItem.activation.seededSelectors,
      };
    });
}

function validateMutationPressure(runs) {
  return runs
    .filter((runItem) => runItem.runtime === "rewrite"
      && runItem.fixture === "large"
      && runItem.mode === "marking")
    .map((runItem) => {
      const pressure = runItem.mutationPressure;
      const bridgeSample = runItem.activation.workSamples
        ?.find((sample) => sample.stage === "bridge");
      const pass = pressure?.ticks > 0
        && pressure?.lateConsentInsertions > 0
        && pressure?.consentRootHidden === true
        && pressure?.structuralRefreshCount === 0
        && bridgeSample?.nodeCount > 1_600;
      return {
        sequence: runItem.sequence,
        pass,
        ticks: pressure?.ticks ?? null,
        lateConsentInsertions: pressure?.lateConsentInsertions ?? null,
        consentRootHidden: pressure?.consentRootHidden ?? null,
        structuralRefreshCount: pressure?.structuralRefreshCount ?? null,
        activationNodeCount: bridgeSample?.nodeCount ?? null,
        workSamples: pressure?.workSamples ?? null,
      };
    });
}

async function main() {
  let server = null;
  try {
    let playwrightCliVersion;
    try {
      playwrightCliVersion = (await run(playwrightCli, ["--version"])).stdout.trim();
    } catch (error) {
      throw new Error(
        `Unable to run the required playwright-cli wrapper at ${playwrightCli}. Install the Playwright skill CLI or set P14_PLAYWRIGHT_CLI to its wrapper path; expected version ${expectedPlaywrightCliVersion}.`,
        { cause: error },
      );
    }
    if (playwrightCliVersion !== expectedPlaywrightCliVersion) {
      throw new Error(
        `Unsupported playwright-cli ${playwrightCliVersion || "<unknown>"}; expected ${expectedPlaywrightCliVersion}. Install that version or point P14_PLAYWRIGHT_CLI at the matching Playwright skill wrapper.`,
      );
    }
    const hostEnvironment = {
      node: process.version,
      npm: (await run("npm", ["--version"])).stdout,
      npx: (await run("npx", ["--version"])).stdout,
      pnpm: (await run("pnpm", ["--version"])).stdout,
      os: { platform: platform(), release: release(), arch: arch() },
    };
    await rm(buildDirectory, { recursive: true, force: true });
    await mkdir(buildDirectory, { recursive: true });
    const transformations = await verifyAndExtractLegacy();
    const bundles = await buildBrowserBundles();
    const sourceIdentity = await captureSourceIdentity();
    server = await startFixtureServer();
    let cliResult;
    let cliLifecycle;
    try {
      const cliRun = await runPlaywrightCli(server.baseUrl);
      cliResult = cliRun.controllerResult;
      cliLifecycle = cliRun.lifecycle;
    } finally {
      await server.close();
    }
    const browser = server.payload();
    server = null;
    if (!browser?.runs || !browser?.semanticSignatures) {
      throw new Error(`Playwright controller did not return browser results\n${cliResult?.stdout ?? ""}`);
    }
    await rm(buildDirectory, { recursive: true, force: true });
    const ephemeralCleanup = {
      playwrightSessionClosed: cliLifecycle?.closed === true,
      buildDirectoryAbsent: !(await pathExists(buildDirectory)),
      rootPlaywrightCliAbsent: !(await pathExists(join(repositoryRoot, ".playwright-cli"))),
    };
    ephemeralCleanup.pass = Object.values(ephemeralCleanup).every(Boolean);

    const semantics = validateSemanticSignatures(browser.semanticSignatures);
    const semanticEvidence = compactSemanticEvidence(browser.semanticSignatures, semantics);
    const summaries = summarizeRuns(browser.runs);
    const sampleCardinality = validateSampleCardinality(browser.runs, summaries);
    const runPlanCheck = validateRunPlan(browser.runs);
    const timingCheck = validateRunTimings(browser.runs);
    const inputLongTaskCheck = validateInputLongTaskWindows(browser.runs);
    const environmentCheck = validateBrowserEnvironment(browser.environment);
    const pageErrorsPass = Array.isArray(browser.pageErrors) && browser.pageErrors.length === 0;
    const semanticIdentityPass = semantics.every((check) => check.pass);
    const budgetChecks = evaluateBudgets(summaries, semantics);
    const activationChecks = validateRewriteActivation(browser.runs);
    const mutationPressureChecks = validateMutationPressure(browser.runs);
    const expectedScenarioCount = Object.keys(FIXTURES).length
      * (counts.warmups + counts.samples)
      * 2
      * 2;
    const countPass = browser.runs.length === expectedScenarioCount;
    const cleanSourceRequired = !smoke && !diagnostic;
    const sourceIdentityPass = !cleanSourceRequired || sourceIdentity.cleanSourceSet;
    const pass = countPass
      && sourceIdentityPass
      && sampleCardinality.pass
      && runPlanCheck.pass
      && timingCheck.pass
      && inputLongTaskCheck.pass
      && ephemeralCleanup.pass
      && environmentCheck.pass
      && pageErrorsPass
      && semanticIdentityPass
      && budgetChecks.every((check) => check.pass)
      && activationChecks.every((check) => check.pass)
      && mutationPressureChecks.every((check) => check.pass);

    const artifact = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      mode: runKind,
      pass,
      source: {
        rewriteWorktree: sourceIdentity,
        cleanSourceRequired,
        sourceIdentityPass,
        legacy: LEGACY_SOURCE,
        legacyTransformations: transformations,
        bundles,
        legacyBuildNote: "Both sides use the rewrite repository's pinned esbuild 0.28.1 as a common benchmark compiler; this is not a historical v1.10.0 production package build.",
      },
      protocol: {
        browser: "Chromium through bundled playwright-cli",
        playwrightCli: {
          package: "@playwright/cli@0.1.17",
          wrapper: "scripts/performance/p14/playwright-cli.sh",
          overrideUsed: Boolean(process.env.P14_PLAYWRIGHT_CLI),
          executable: playwrightCli,
          version: playwrightCliVersion,
          expectedVersion: expectedPlaywrightCliVersion,
          lifecycle: cliLifecycle,
        },
        externalObserver: "none",
        syntheticFixtureOrigin: "http://p14.test (route-fulfilled from the ephemeral control server so legacy default-port URL normalization remains exact)",
        viewport: { width: 1280, height: 900, devicePixelRatio: 1 },
        warmups: counts.warmups,
        samples: counts.samples,
        alternatingOrder: true,
        paintedCompletion: "persistent semantic/target-overlay condition followed by two requestAnimationFrame callbacks",
        physicalInput: ["mousemove", "click", "wheel"],
        inputLongTasks: {
          source: "Chromium PerformanceObserver with entry type longtask",
          windows: "Immediately before each physical-input arm/preparation through the operation's painted completion proof",
          maximumDurationMs: inputLongTaskCheck.budgetMs,
          budgetAppliesTo: "rewrite (legacy windows are retained as comparison evidence)",
        },
        mutation: "childList append at scrollY=0 after the real settle/throttle paths quiesce",
        mutationPressure: "Large marking scenarios continuously mutate a late consent-suppressed subtree during physical hover/click; rewrite structural work must remain zero while the later included mutation still refreshes.",
        semanticClassification: "Every canonical row is projected against each runtime's internal classification map; an absent entry is the literal undetected state. Extra evaluator-only wrapper entries are counted but are outside the canonical row domain.",
        legacyIncrementalClassification: "Legacy marking retains its exact activation cachedCollections classifications for unchanged nodes, overlays later live reconciled collections, and overlays exact explicit Element collections produced by collectExplicitMarkingElements + splitExplicitMarkingCollectionsBySavedState. No normalized row boolean is converted into a class.",
        rewriteInteractionAdapter: "Mirrors the production pointerdown/click physical-action dedupe, extension-target guard, mode resolution, synchronous cursor install, toggle counter, and report payload construction. Only the external asynchronous realm transport is a no-op because it does not gate committed overlay paint.",
        silentPaintCollapse: "Legacy silent rendering may collapse nested sources; timing readiness uses direct fixture targets, while complete semantic classification comes from the exact internal source collections.",
        fixtureDigests: Object.fromEntries(
          Object.keys(FIXTURES).map((fixture) => [fixture, sha256(renderFixtureBody(fixture))]),
        ),
        fixturePageDigests: Object.fromEntries(
          Object.keys(FIXTURES).flatMap((fixture) => ["rewrite", "legacy"].map((runtime) => [
            `${fixture}/${runtime}`,
            sha256(renderFixturePage({ fixture, runtime, nonce: "0" })),
          ])),
        ),
        fixtureSpecifications: FIXTURES,
        selectors: SELECTORS,
        selectorsByMode: SELECTORS_BY_MODE,
        budgets: BUDGETS,
      },
      environment: { browser: browser.environment, host: hostEnvironment },
      validation: {
        expectedScenarioCount,
        actualScenarioCount: browser.runs.length,
        countPass,
        sourceIdentity: { pass: sourceIdentityPass, requiredClean: cleanSourceRequired },
        sampleCardinality,
        runPlan: runPlanCheck,
        timings: timingCheck,
        inputLongTasks: inputLongTaskCheck,
        ephemeralCleanup,
        environment: environmentCheck,
        pageErrors: { pass: pageErrorsPass, values: browser.pageErrors ?? null },
        semantics: semanticEvidence.checks,
        rewriteActivationTransactions: activationChecks,
        mutationPressure: mutationPressureChecks,
        budgets: budgetChecks,
      },
      summaries,
      semanticSignatureCatalog: semanticEvidence.signatureCatalog,
      runs: browser.runs,
      cli: {
        package: "@playwright/cli@0.1.17",
        wrapper: "scripts/performance/p14/playwright-cli.sh",
        command: "scripts/performance/p14/playwright-cli.sh run-code --filename=scripts/performance/p14/playwright-controller.js",
        resolvedExecutable: playwrightCli,
        workingDirectory: "output/playwright/p14-marking-performance/build/playwright-cli-session (removed after run)",
        stdout: cliResult.stdout,
        stderr: cliResult.stderr,
      },
      elapsedMs: Date.now() - startedAt.getTime(),
    };
    await mkdir(outputDirectory, { recursive: true });
    const serializedArtifact = `${JSON.stringify(artifact, null, 2)}\n`;
    await writeArtifactAtomic(retainedArtifactPath, serializedArtifact);
    if (!diagnostic) {
      await writeArtifactAtomic(latestArtifactPath, serializedArtifact);
    }
    const displayedArtifact = relative(repositoryRoot, retainedArtifactPath).replaceAll("\\", "/");
    process.stdout.write(`${JSON.stringify({
      pass,
      artifact: displayedArtifact,
      latestUpdated: !diagnostic,
      scenarios: browser.runs.length,
      failedSemanticChecks: semantics.filter((check) => !check.pass).length,
      failedBudgetChecks: budgetChecks.filter((check) => !check.pass).length,
      failedActivationChecks: activationChecks.filter((check) => !check.pass).length,
      failedMutationPressureChecks: mutationPressureChecks.filter((check) => !check.pass).length,
      failedInputLongTaskChecks: inputLongTaskCheck.checks.filter((check) => !check.pass).length,
      sampleCardinalityPass: sampleCardinality.pass,
      environmentPass: environmentCheck.pass,
    }, null, 2)}\n`);
    if (!pass) {
      process.exitCode = 1;
    }
  } finally {
    await server?.close().catch(() => undefined);
    await rm(buildDirectory, { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  await mkdir(outputDirectory, { recursive: true });
  const failure = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: runKind,
    pass: false,
    fatalError: String(error?.stack ?? error),
  };
  const failurePath = join(outputDirectory, `failure-${artifactTimestamp}.json`);
  await writeArtifactAtomic(failurePath, `${JSON.stringify(failure, null, 2)}\n`).catch(() => undefined);
  process.stdout.write(`${JSON.stringify({
    pass: false,
    artifact: relative(repositoryRoot, failurePath).replaceAll("\\", "/"),
    fatalError: failure.fatalError,
  }, null, 2)}\n`);
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
