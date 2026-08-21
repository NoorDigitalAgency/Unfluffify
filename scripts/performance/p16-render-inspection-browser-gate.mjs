#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { arch, platform, release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build, version as esbuildVersion } from "esbuild";

import {
  ACCEPTANCE_ID,
  ARTIFACT_SCHEMA_VERSION,
  PLAYWRIGHT_CLI_VERSION,
  REQUIRED_CHECK_IDS,
  VIEWPORT,
  validateCheckCatalog,
} from "./p16/contract.mjs";
import { renderFixturePage } from "./p16/fixture.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const p16Directory = join(scriptDirectory, "p16");
const outputDirectory = join(repositoryRoot, "output/playwright/p16-render-inspection");
const buildDirectory = join(outputDirectory, "build");
const playwrightWorkingDirectory = join(buildDirectory, "playwright-cli-session");
const playwrightCli = resolve(process.env.P16_PLAYWRIGHT_CLI ?? join(p16Directory, "playwright-cli.sh"));
const smoke = process.argv.includes("--smoke");
const startedAt = new Date();
const artifactTimestamp = startedAt.toISOString().replaceAll(":", "-").replace(".", "-");
const retainedArtifactPath = smoke
  ? join("/tmp", `unfluffify-p16-render-inspection-smoke-${process.pid}.json`)
  : join(outputDirectory, `acceptance-${artifactTimestamp}.json`);

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

async function writeArtifactAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents);
  await rename(temporaryPath, path);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code !== 0) {
        reject(Object.assign(new Error([
          `${command} ${args.join(" ")} exited ${code}`,
          result.stdout,
          result.stderr,
        ].filter(Boolean).join("\n")), { result }));
        return;
      }
      resolvePromise(result);
    });
  });
}

async function git(...args) {
  return (await run("git", args)).stdout;
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

async function sourceIdentity() {
  const rawStatus = await git("status", "--porcelain=v1", "--untracked-files=all", "--", ".");
  const status = rawStatus
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.slice(3).startsWith("output/playwright/p16-render-inspection/"));
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
    "scripts/performance/p16-render-inspection-browser-gate.mjs",
    "scripts/performance/p16",
    "tests/p16-browser-render-inspection-contract.test.ts",
  )).split("\n").filter(Boolean);
  return {
    headCommit: await git("rev-parse", "HEAD"),
    cleanSourceSet: status.length === 0,
    status,
    trackedDiffSha256: sha256(trackedDiff),
    harnessManifest: await fileManifest(manifestPaths),
  };
}

async function buildRuntimeBundle() {
  const outfile = join(buildDirectory, "runtime.js");
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["scripts/performance/p16/runtime.ts"],
    outfile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    metafile: true,
    logLevel: "warning",
    define: { __UF_DEBUG_BUILD__: "false" },
  });
  return {
    generatedName: "runtime.js (ephemeral; removed after hashing)",
    bytes: (await stat(outfile)).size,
    sha256: await sha256File(outfile),
    inputManifest: await fileManifest(Object.keys(result.metafile.inputs), repositoryRoot),
    compiler: {
      name: "esbuild",
      version: esbuildVersion,
      packageManifest: (await fileManifest(["node_modules/esbuild/package.json"]))["node_modules/esbuild/package.json"],
    },
  };
}

async function startFixtureServer() {
  let browserPayload = null;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("cache-control", "no-store");
      if (request.method === "GET" && url.pathname === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end("<!doctype html><title>P16 gate</title><p>P16 render-inspection controller</p>");
        return;
      }
      if (request.method === "GET" && url.pathname === "/fixture") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(renderFixturePage());
        return;
      }
      if (request.method === "GET" && url.pathname === "/runtime.js") {
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        createReadStream(join(buildDirectory, "runtime.js")).pipe(response);
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/extension-assets/")) {
        response.setHeader("content-type", "image/svg+xml");
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="5"/></svg>');
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/results") {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 5_000_000) throw new Error("P16 browser payload exceeded 5 MB");
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
  if (!address || typeof address === "string") throw new Error("Unable to determine P16 fixture port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    payload: () => browserPayload,
    close: () => new Promise((resolvePromise, reject) =>
      server.close((error) => error ? reject(error) : resolvePromise())),
  };
}

async function playwrightVersion() {
  const result = await run(playwrightCli, ["--version"]);
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
  const actual = match?.[1] ?? "unknown";
  if (actual !== PLAYWRIGHT_CLI_VERSION) {
    throw new Error(`P16 requires @playwright/cli ${PLAYWRIGHT_CLI_VERSION}, received ${actual}`);
  }
  return { expected: PLAYWRIGHT_CLI_VERSION, actual, raw: result.stdout };
}

async function runPlaywrightCli(baseUrl) {
  const session = `p16-gate-${process.pid}`;
  const configPath = join(buildDirectory, "playwright-cli.json");
  await mkdir(playwrightWorkingDirectory, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    browser: {
      launchOptions: { headless: true },
      contextOptions: {
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
      },
    },
  }, null, 2));
  const environment = {
    PLAYWRIGHT_CLI_SESSION: session,
    PLAYWRIGHT_CLI_TIMEOUT: "300000",
  };
  let opened = false;
  try {
    await run(playwrightCli, ["open", baseUrl, `--config=${configPath}`], {
      cwd: playwrightWorkingDirectory,
      env: environment,
    });
    opened = true;
    return await run(playwrightCli, [
      "run-code",
      `--filename=${join(p16Directory, "playwright-controller.js")}`,
    ], { cwd: playwrightWorkingDirectory, env: environment });
  } finally {
    if (opened) {
      await run(playwrightCli, ["close"], {
        cwd: playwrightWorkingDirectory,
        env: environment,
      }).catch(() => undefined);
    }
  }
}

let source = null;
let bundle = null;
let cli = null;
let fixtureServer = null;
let controller = null;
let controllerFailure = null;
let browserPayload = null;
let fatal = null;

try {
  source = await sourceIdentity();
  await mkdir(buildDirectory, { recursive: true });
  bundle = await buildRuntimeBundle();
  cli = await playwrightVersion();
  fixtureServer = await startFixtureServer();
  try {
    controller = await runPlaywrightCli(fixtureServer.baseUrl);
    if (!fixtureServer.payload() && controller.stdout.includes("### Error")) {
      controllerFailure = controller.stdout;
    }
  } catch (error) {
    controllerFailure = String(error?.stack ?? error);
  }
  browserPayload = fixtureServer.payload();
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  await fixtureServer?.close().catch(() => undefined);
  await rm(buildDirectory, { recursive: true, force: true }).catch(() => undefined);
}

const checks = browserPayload?.checks ?? [];
const catalog = validateCheckCatalog(checks);
const sourceAccepted = smoke || source?.cleanSourceSet === true;
const pass = !fatal &&
  !controllerFailure &&
  browserPayload?.fatalError == null &&
  catalog.pass &&
  sourceAccepted;
const finishedAt = new Date();
const report = {
  schemaVersion: ARTIFACT_SCHEMA_VERSION,
  acceptanceId: ACCEPTANCE_ID,
  runKind: smoke ? "smoke" : "acceptance",
  pass,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  source,
  sourceRequirement: { requiredClean: !smoke, pass: sourceAccepted },
  host: { platform: platform(), release: release(), architecture: arch(), node: process.version },
  toolchain: { playwrightCli: cli, browserCompiler: bundle?.compiler ?? null },
  runtimeBundle: bundle ? {
    generatedName: bundle.generatedName,
    bytes: bundle.bytes,
    sha256: bundle.sha256,
    inputManifest: bundle.inputManifest,
  } : null,
  contract: { requiredChecks: REQUIRED_CHECK_IDS, catalog, viewport: VIEWPORT },
  browser: {
    environment: browserPayload?.browserEnvironment ?? null,
    checks,
    pageErrors: browserPayload?.pageErrors ?? [],
    consoleErrors: browserPayload?.consoleErrors ?? [],
    scenarioEvidence: browserPayload?.scenarioEvidence ?? {},
    fatalError: browserPayload?.fatalError ?? null,
    controller: controller ? { stdout: controller.stdout, stderr: controller.stderr } : null,
    controllerFailure,
  },
  fatal,
};

const failurePath = join("/tmp", `unfluffify-p16-render-inspection-failure-${process.pid}.json`);
const artifactPath = pass ? retainedArtifactPath : failurePath;
await writeArtifactAtomic(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
const digest = await sha256File(artifactPath);
console.log(JSON.stringify({
  acceptanceId: ACCEPTANCE_ID,
  runKind: report.runKind,
  pass,
  checksPassed: checks.filter((check) => check.pass).length,
  checksRequired: REQUIRED_CHECK_IDS.length,
  artifactPath,
  sha256: digest,
  cleanSourceSet: source?.cleanSourceSet ?? false,
  controllerFailure,
  fatal,
}, null, 2));

if (!pass) process.exitCode = 1;
