#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { arch, platform, release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version as esbuildVersion } from "esbuild";

import {
  ACCEPTANCE_IDS,
  ARTIFACT_SCHEMA_VERSION,
  FIXTURE_ROUTES,
  FOCUSED_AUTHORITIES,
  PLAYWRIGHT_CLI_VERSION,
  REQUIRED_CHECK_IDS,
  REQUIRED_PRODUCTION_SEAMS,
  TOAST_DEADLINES_MS,
  VIEWPORT,
  validateCheckCatalog,
} from "./p18/contract.mjs";
import {
  renderContentFixturePage,
  renderPopupFixturePage,
} from "./p18/fixture.mjs";
import { classifyParitySourceStatus } from "./p25/source-identity.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const p18Directory = join(scriptDirectory, "p18");
const outputDirectory = join(repositoryRoot, "output/playwright/p18-transient-toast");
const buildDirectory = join(outputDirectory, "build");
const playwrightWorkingDirectory = join(buildDirectory, "playwright-cli-session");
const playwrightCli = resolve(process.env.P18_PLAYWRIGHT_CLI ?? join(p18Directory, "playwright-cli.sh"));
const smoke = process.argv.includes("--smoke");
const startedAt = new Date();
const artifactTimestamp = startedAt.toISOString().replaceAll(":", "-").replace(".", "-");
const retainedArtifactPath = smoke
  ? join("/tmp", `unfluffify-p18-transient-toast-smoke-${process.pid}.json`)
  : join(outputDirectory, `acceptance-${artifactTimestamp}.json`);

const activeChildProcesses = new Set();
let playwrightSessionOpened = false;
let playwrightSessionClosed = false;
let fixtureServerClosed = false;
let buildDirectoryRemoved = false;

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
    if (child.pid) activeChildProcesses.add(child.pid);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (child.pid) activeChildProcesses.delete(child.pid);
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
  const classifiedStatus = classifyParitySourceStatus(rawStatus);
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
    "scripts/performance/p18-transient-toast-browser-gate.mjs",
    "scripts/performance/p18",
    "scripts/performance/p25/source-identity.mjs",
    "tests/p18-browser-transient-toast-contract.test.ts",
  )).split("\n").filter(Boolean);
  const harnessManifest = await fileManifest(manifestPaths);
  return {
    headCommit: await git("rev-parse", "HEAD"),
    cleanSourceSet: classifiedStatus.cleanSourceSet,
    status: classifiedStatus.status,
    artifactStatus: classifiedStatus.artifactStatus,
    trackedDiffSha256: sha256(trackedDiff),
    harnessManifest,
    harnessManifestSha256: sha256(JSON.stringify(harnessManifest)),
  };
}

async function buildRuntimeBundles() {
  const definitions = [
    {
      name: "popupProduction",
      entryPoint: "scripts/performance/p18/popup-runtime.tsx",
      generatedName: "popup-runtime-production.js",
      realm: "popup",
      debugBuild: false,
    },
    {
      name: "popupDebug",
      entryPoint: "scripts/performance/p18/popup-runtime.tsx",
      generatedName: "popup-runtime-debug.js",
      realm: "popup",
      debugBuild: true,
    },
    {
      name: "contentProduction",
      entryPoint: "scripts/performance/p18/content-runtime.ts",
      generatedName: "content-runtime-production.js",
      realm: "content",
      debugBuild: false,
    },
  ];
  const variants = {};
  for (const definition of definitions) {
    const outfile = join(buildDirectory, definition.generatedName);
    const result = await build({
      absWorkingDir: repositoryRoot,
      entryPoints: [definition.entryPoint],
      outfile,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: ["chrome116"],
      sourcemap: false,
      legalComments: "none",
      charset: "utf8",
      metafile: true,
      logLevel: "warning",
      loader: { ".css": "text" },
      define: { __UF_DEBUG_BUILD__: JSON.stringify(definition.debugBuild) },
    });
    const inputManifest = await fileManifest(Object.keys(result.metafile.inputs), repositoryRoot);
    variants[definition.name] = {
      generatedName: `${definition.generatedName} (ephemeral; removed after hashing)`,
      realm: definition.realm,
      debugBuild: definition.debugBuild,
      bytes: (await stat(outfile)).size,
      sha256: await sha256File(outfile),
      inputManifest,
      inputManifestSha256: sha256(JSON.stringify(inputManifest)),
    };
  }
  return {
    compiler: {
      name: "esbuild",
      version: esbuildVersion,
      packageManifest: (await fileManifest(["node_modules/esbuild/package.json"]))["node_modules/esbuild/package.json"],
    },
    variants,
  };
}

async function startFixtureServer() {
  let browserPayload = null;
  const runtimePaths = new Set([
    "/popup-runtime-production.js",
    "/popup-runtime-debug.js",
    "/content-runtime-production.js",
  ]);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("cache-control", "no-store");
      if (request.method === "GET" && url.pathname === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end("<!doctype html><title>P18 gate</title><p>P18 transient-surface and toast controller</p>");
        return;
      }
      if (request.method === "GET" && url.pathname === "/popup") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(renderPopupFixturePage({ variant: url.searchParams.get("variant") ?? "production" }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/content") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(renderContentFixturePage({ variant: url.searchParams.get("variant") ?? "production" }));
        return;
      }
      if (request.method === "GET" && runtimePaths.has(url.pathname)) {
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        createReadStream(join(buildDirectory, url.pathname.slice(1))).pipe(response);
        return;
      }
      if (request.method === "GET" && url.pathname === "/logo.png") {
        response.setHeader("content-type", "image/svg+xml");
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#4f46e5"/></svg>');
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
          if (bytes > 10_000_000) throw new Error("P18 browser payload exceeded 10 MB");
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
  if (!address || typeof address === "string") throw new Error("Unable to determine P18 fixture port");
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
    throw new Error(`P18 requires @playwright/cli ${PLAYWRIGHT_CLI_VERSION}, received ${actual}`);
  }
  return { expected: PLAYWRIGHT_CLI_VERSION, actual, raw: result.stdout };
}

async function runPlaywrightCli(baseUrl) {
  const session = `p18-gate-${process.pid}`;
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
  try {
    await run(playwrightCli, ["open", baseUrl, `--config=${configPath}`], {
      cwd: playwrightWorkingDirectory,
      env: environment,
    });
    playwrightSessionOpened = true;
    return await run(playwrightCli, [
      "run-code",
      `--filename=${join(p18Directory, "playwright-controller.js")}`,
    ], { cwd: playwrightWorkingDirectory, env: environment });
  } finally {
    if (playwrightSessionOpened) {
      try {
        await run(playwrightCli, ["close"], { cwd: playwrightWorkingDirectory, env: environment });
        playwrightSessionClosed = true;
      } catch {
        playwrightSessionClosed = false;
      }
    }
  }
}

let source = null;
let bundles = null;
let cli = null;
let fixtureServer = null;
let controller = null;
let controllerFailure = null;
let browserPayload = null;
let fatal = null;

try {
  source = await sourceIdentity();
  await mkdir(buildDirectory, { recursive: true });
  bundles = await buildRuntimeBundles();
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
  if (fixtureServer) {
    try {
      await fixtureServer.close();
      fixtureServerClosed = true;
    } catch (error) {
      fatal = [fatal, `Fixture server cleanup failed: ${String(error?.stack ?? error)}`].filter(Boolean).join("\n");
    }
  } else {
    fixtureServerClosed = true;
  }
  try {
    await rm(buildDirectory, { recursive: true, force: true });
    await access(buildDirectory).then(
      () => { buildDirectoryRemoved = false; },
      () => { buildDirectoryRemoved = true; },
    );
  } catch (error) {
    fatal = [fatal, `Build cleanup failed: ${String(error?.stack ?? error)}`].filter(Boolean).join("\n");
  }
}

const cleanup = {
  fixtureServerClosed,
  playwrightSessionOpened,
  playwrightSessionClosed: !playwrightSessionOpened || playwrightSessionClosed,
  activeChildProcessCount: activeChildProcesses.size,
  buildDirectory,
  buildDirectoryRemoved,
};
cleanup.pass = cleanup.fixtureServerClosed
  && cleanup.playwrightSessionClosed
  && cleanup.activeChildProcessCount === 0
  && cleanup.buildDirectoryRemoved;

const checks = browserPayload?.checks ?? [];
const catalog = validateCheckCatalog(checks);
const sourceAccepted = smoke || source?.cleanSourceSet === true;
const pass = !fatal
  && !controllerFailure
  && browserPayload?.fatalError == null
  && catalog.pass
  && sourceAccepted
  && cleanup.pass;
const finishedAt = new Date();
const report = {
  schemaVersion: ARTIFACT_SCHEMA_VERSION,
  acceptanceIds: ACCEPTANCE_IDS,
  runKind: smoke ? "smoke" : "acceptance",
  pass,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  source,
  sourceRequirement: { requiredClean: !smoke, pass: sourceAccepted },
  host: { platform: platform(), release: release(), architecture: arch(), node: process.version },
  toolchain: { playwrightCli: cli, browserCompiler: bundles?.compiler ?? null },
  runtimeBundles: bundles?.variants ?? null,
  contract: {
    requiredChecks: REQUIRED_CHECK_IDS,
    catalog,
    viewport: VIEWPORT,
    fixtureRoutes: FIXTURE_ROUTES,
    toastDeadlinesMs: TOAST_DEADLINES_MS,
    requiredProductionSeams: REQUIRED_PRODUCTION_SEAMS,
    focusedAuthorities: FOCUSED_AUTHORITIES,
  },
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
  cleanup,
  fatal,
};

const failurePath = join("/tmp", `unfluffify-p18-transient-toast-failure-${process.pid}.json`);
const artifactPath = pass ? retainedArtifactPath : failurePath;
await writeArtifactAtomic(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
const digest = await sha256File(artifactPath);
console.log(JSON.stringify({
  acceptanceIds: ACCEPTANCE_IDS,
  runKind: report.runKind,
  pass,
  checksPassed: checks.filter((check) => check.pass).length,
  checksRequired: REQUIRED_CHECK_IDS.length,
  artifactPath,
  sha256: digest,
  cleanSourceSet: source?.cleanSourceSet ?? false,
  cleanup,
  controllerFailure,
  fatal,
}, null, 2));

if (!pass) process.exitCode = 1;
