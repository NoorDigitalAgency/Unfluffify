#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version as esbuildVersion } from "esbuild";

import {
  ACCEPTANCE_ID,
  ARTIFACT_SCHEMA_VERSION,
  HOVER_BUDGET_MS,
  PLAYWRIGHT_CLI_VERSION,
  REQUIRED_CHECK_IDS,
  SILENT_BUDGET_MS,
  VIEWPORT,
  validateCheckCatalog,
} from "./p23/contract.mjs";
import { classifyParitySourceStatus } from "./p25/source-identity.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const harnessDirectory = join(scriptDirectory, "p23");
const outputDirectory = join(repositoryRoot, "output/playwright/p23-frozen-presentation");
const buildDirectory = join(outputDirectory, "build");
const playwrightWorkingDirectory = join(buildDirectory, "playwright-cli-session");
const playwrightCli = join(scriptDirectory, "p14/playwright-cli.sh");
const smoke = process.argv.includes("--smoke");
const startedAt = new Date();

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
        reject(new Error([
          command + " " + args.join(" ") + " exited " + code,
          result.stdout,
          result.stderr,
        ].filter(Boolean).join("\n")));
        return;
      }
      resolvePromise(result);
    });
  });
}

function fixtureHtml() {
  const targets = Array.from({ length: 8 }, (_, index) =>
    '<p data-p23-target="' + String(index + 1) + '">Frozen presentation target ' + String(index + 1) + "</p>"
  ).join("");
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>P23 frozen presentation gate</title>",
    "<style>",
    "html,body{margin:0;padding:0}body{font:16px system-ui;background:#fff}",
    "main{padding:24px;width:720px}",
    "[data-p23-target]{box-sizing:border-box;height:64px;margin:0 0 12px;padding:20px;border:1px solid #ccd}",
    ".p23-spacer{height:1800px}",
    "</style>",
    "<script>",
    "window.__p23StarvedRafRequests=0;",
    "let p23FrameToken=0;",
    "window.requestAnimationFrame=function(){window.__p23StarvedRafRequests+=1;return ++p23FrameToken};",
    "window.cancelAnimationFrame=function(){};",
    "</script></head><body><main>",
    targets,
    '<div class="p23-spacer"></div>',
    "</main>",
    '<script src="/runtime.js"></script>',
    "</body></html>",
  ].join("");
}

async function startServer() {
  let payload = null;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("cache-control", "no-store");
      if (request.method === "GET" && url.pathname === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end("<!doctype html><title>P23 controller</title>");
        return;
      }
      if (request.method === "GET" && url.pathname === "/fixture") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(fixtureHtml());
        return;
      }
      if (request.method === "GET" && url.pathname === "/runtime.js") {
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.end(await readFile(join(buildDirectory, "runtime.js")));
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/results") {
        const chunks = [];
        for await (const chunk of request) {
          chunks.push(chunk);
        }
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.setHeader("content-type", "application/json");
        response.end('{"ok":true}');
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
    throw new Error("Unable to determine P23 fixture port");
  }
  return {
    baseUrl: "http://127.0.0.1:" + String(address.port),
    payload: () => payload,
    close: () => new Promise((resolvePromise, reject) =>
      server.close((error) => error ? reject(error) : resolvePromise())
    ),
  };
}

async function runBrowser(baseUrl) {
  const environment = {
    PLAYWRIGHT_CLI_SESSION: "p23-gate-" + String(process.pid),
    PLAYWRIGHT_CLI_TIMEOUT: "300000",
  };
  await mkdir(playwrightWorkingDirectory, { recursive: true });
  let opened = false;
  try {
    await run(playwrightCli, ["open", baseUrl], {
      cwd: playwrightWorkingDirectory,
      env: environment,
    });
    opened = true;
    await run(playwrightCli, ["resize", String(VIEWPORT.width), String(VIEWPORT.height)], {
      cwd: playwrightWorkingDirectory,
      env: environment,
    });
    return await run(playwrightCli, [
      "run-code",
      "--filename=" + join(harnessDirectory, "playwright-controller.js"),
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

function validate(payload) {
  const checks = [];
  const check = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), detail });
  check("starved-raf-exercised", payload.scheduling.starvedRafRequests > 0, payload.scheduling);
  check("eight-physical-targets", payload.targets.length === 8 && payload.hovers.length === 8, {
    targets: payload.targets.length,
    hovers: payload.hovers.length,
  });
  for (const [index, hover] of payload.hovers.entries()) {
    check(
      "hover-" + String(index + 1) + "-identity",
      hover.state.currentXpath === hover.target.xpath && hover.state.xpath === hover.target.xpath,
      hover,
    );
    check(
      "hover-" + String(index + 1) + "-latency",
      Number.isFinite(hover.state.latencyMs) && hover.state.latencyMs <= HOVER_BUDGET_MS,
      hover.state.latencyMs,
    );
  }
  check(
    "silent-scroll-fades-before-reposition-and-restores",
    payload.silentDuring.retained &&
      payload.silentDuring.allBoxesRetained &&
      !payload.silentDuring.geometryChanged &&
      payload.silentDuring.rootScrolling &&
      payload.silentDuring.allRetainedLayersTransparent &&
      payload.silentAfter.retained &&
      payload.silentAfter.allBoxesRetained &&
      payload.silentAfter.geometryChanged &&
      !payload.silentAfter.rootScrolling &&
      payload.silentAfter.allRetainedLayersVisible,
    { before: payload.silentBefore, during: payload.silentDuring, after: payload.silentAfter },
  );
  check(
    "silent-overlay-retained",
    payload.silentAfter.retained &&
      payload.silentAfter.count === payload.silentBefore.count &&
      payload.silentAfter.currentTop !== payload.silentBefore.initialTop,
    { before: payload.silentBefore, after: payload.silentAfter },
  );
  check(
    "silent-scroll-latency",
    Number.isFinite(payload.silentAfter.latencyMs) &&
      payload.silentAfter.latencyMs <= SILENT_BUDGET_MS,
    payload.silentAfter.latencyMs,
  );
  check("canonical-rows-unchanged", payload.semantic.unchanged, payload.semantic.rows);
  check("scheduler-drained", payload.scheduling.pendingClockWork === 0, payload.scheduling);
  check("page-errors-empty", payload.pageErrors.length === 0, payload.pageErrors);
  check("console-errors-empty", payload.consoleErrors.length === 0, payload.consoleErrors);
  return checks;
}

async function sourceIdentity() {
  const [head, rawStatus] = await Promise.all([
    run("git", ["rev-parse", "HEAD"]),
    run("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", "."]),
  ]);
  const classified = classifyParitySourceStatus(rawStatus.stdout);
  return {
    headCommit: head.stdout,
    ...classified,
  };
}

let server = null;
let source = null;
let bundle = null;
let cli = null;
let cliVersion = null;
let payload = null;
let checks = [];
let catalog = validateCheckCatalog(checks);
let fatal = null;

try {
  source = await sourceIdentity();
  const versionResult = await run(playwrightCli, ["--version"]);
  cliVersion = versionResult.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? "unknown";
  if (cliVersion !== PLAYWRIGHT_CLI_VERSION) {
    throw new Error(`P23 requires @playwright/cli ${PLAYWRIGHT_CLI_VERSION}, received ${cliVersion}`);
  }
  await rm(buildDirectory, { recursive: true, force: true });
  await mkdir(buildDirectory, { recursive: true });
  bundle = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["scripts/performance/p23/runtime.ts"],
    outfile: join(buildDirectory, "runtime.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    sourcemap: false,
    legalComments: "none",
    define: { __UF_DEBUG_BUILD__: "false" },
    metafile: true,
  });
  server = await startServer();
  cli = await runBrowser(server.baseUrl);
  payload = server.payload();
  if (!payload) {
    throw new Error("P23 browser controller returned no payload\n" + cli.stdout);
  }
  checks = validate(payload);
  catalog = validateCheckCatalog(checks);
} catch (error) {
  fatal = String(error?.stack ?? error);
} finally {
  await server?.close().catch(() => undefined);
  await rm(buildDirectory, { recursive: true, force: true }).catch(() => undefined);
}

const sourceAccepted = smoke || source?.cleanSourceSet === true;
const pass = fatal === null && payload !== null && catalog.pass && sourceAccepted;
const generatedAt = new Date().toISOString();
const artifact = {
  schemaVersion: ARTIFACT_SCHEMA_VERSION,
  acceptanceId: ACCEPTANCE_ID,
  runKind: smoke ? "smoke" : "acceptance",
  generatedAt,
  startedAt: startedAt.toISOString(),
  pass,
  source,
  sourceRequirement: { requiredClean: !smoke, pass: sourceAccepted },
  protocol: {
    browser: `Chromium through pinned @playwright/cli@${PLAYWRIGHT_CLI_VERSION}`,
    viewport: VIEWPORT,
    pageRequestAnimationFrame: "permanently starved before runtime bundle evaluation",
    hoverBudgetMs: HOVER_BUDGET_MS,
    silentBudgetMs: SILENT_BUDGET_MS,
    physicalInputs: ["mousemove", "wheel"],
  },
  toolchain: {
    playwrightCli: { expected: PLAYWRIGHT_CLI_VERSION, actual: cliVersion },
    compiler: bundle ? {
      name: "esbuild",
      version: esbuildVersion,
      inputs: Object.keys(bundle.metafile.inputs).sort(),
    } : null,
  },
  contract: { requiredChecks: REQUIRED_CHECK_IDS, catalog },
  checks,
  browser: payload,
  cli: cli ? { stdout: cli.stdout, stderr: cli.stderr } : null,
  fatal,
};
await mkdir(outputDirectory, { recursive: true });
const timestamp = generatedAt.replaceAll(":", "-").replace(".", "-");
const artifactPath = smoke
  ? join("/tmp", `unfluffify-p23-frozen-presentation-${pass ? "smoke" : "failure"}-${process.pid}.json`)
  : join(outputDirectory, `${pass ? "acceptance" : "failure"}-${timestamp}.json`);
await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
process.stdout.write(JSON.stringify({
  acceptanceId: ACCEPTANCE_ID,
  runKind: artifact.runKind,
  pass,
  artifactPath,
  checksPassed: checks.filter((entry) => entry.pass).length,
  checksRequired: REQUIRED_CHECK_IDS.length,
  failedChecks: checks.filter((entry) => !entry.pass).map((entry) => entry.id),
  cleanSourceSet: source?.cleanSourceSet ?? false,
  fatal,
}, null, 2) + "\n");
if (!pass) process.exitCode = 1;
