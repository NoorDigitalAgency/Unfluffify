/**
 * Launch the live test browser for the Unfluffify extension and bind the popup
 * to a target page — using ONLY the Chromium installed by the pinned
 * `npm:@playwright/mcp` package. This never touches the OS Chrome/Chromium
 * install, and it deliberately leaves no persistent external debugger attached
 * to the target tab once startup is complete.
 *
 * Usage:
 *   pnpm browser:live <target-url> [--no-build] [--bundle-source <bundle-dir>]
 *
 * What it does (the canonical, proven flow):
 *   1. Builds the current WXT unpacked extension (`pnpm build`) unless --no-build.
 *   2. Acquires exclusive launcher/profile/port ownership and verifies a trusted
 *      source-to-bundle attestation (including pinned legacy bundle sources).
 *   3. Resolves the current repo root and materializes a launchable, per-env
 *      copy of the placeholdered browser config into the gitignored `.temp/`
 *      (substituting the repo root and dropping `executablePath` so Playwright
 *      uses its managed Chromium).
 *   4. Ensures the MCP-managed Chromium is installed (idempotent).
 *   5. Drops only the unused profile's stale service-worker registration and
 *      stamps a temporary, normalized-away manifest launch counter.
 *   6. Resolves and starts the pinned package's managed Chromium directly,
 *      bound to `.wxt/browser-profile`, initially at `about:blank`.
 *   7. Opens the requested URL as an exact CDP-identified target and resolves the
 *      loaded extension id from the service worker (verifying it
 *      against the deterministic path-hash id).
 *   8. Reloads the target page (never the extension — see the bind script: the
 *      extension reload unloads the extension outright in the current managed
 *      Chromium).
 *   9. Resolves the target page's Chrome tab id via the service worker.
 *  10. Uses a temporary `popup.html?debugTabId=<pageTabId>` helper to open the
 *      real side panel for trusted popup-only commands such as render
 *      inspection, then closes the helper so only one popup client remains.
 *  11. Atomically emits launch-bound source/bundle/browser/profile/target
 *      provenance only after every runtime identity has been proven.
 *
 * The browser stays open until this process is stopped (Ctrl-C / kill <pid>).
 */
import { spawn, spawnSync } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  BROWSER_LIVE_BUILD_ATTESTATION_SCHEMA_VERSION,
  BROWSER_LIVE_PROVENANCE_SCHEMA_VERSION,
  PINNED_LEGACY_ATTESTATION_SCHEMA_VERSION,
  SOURCE_LOCKFILE,
  normalizedBundleInventory,
  pinnedLegacyAttestationFailures,
  validateBundleInventoryAttestation,
} from "./performance/p25/bundle-provenance.mjs";
import { normalizeLiveUrl } from "./performance/p25/live-comparison-contract.mjs";

const selfPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXT_DIR = join(repoRoot, ".output", "chrome-mv3");
const PROFILE_DIR = join(repoRoot, ".wxt", "browser-profile");
/** Whether a profile was already on disk when this run started. A profile this
 *  run created cannot be serving a service worker from a previous registration,
 *  so only a reused one needs the freshness caveat in the ready banner. */
const PROFILE_EXISTED = await stat(PROFILE_DIR).then(() => true, () => false);
const TEMP_DIR = join(repoRoot, ".temp");
const TEMP_CONFIG = join(TEMP_DIR, "browser-mcp.config.json");
const COMMITTED_CONFIG = join(repoRoot, ".vscode", "browser-mcp.config.json");
const BUNDLE_SWAP_MARKER = join(TEMP_DIR, "browser-live-bundle-swap.json");
const LAUNCH_LOCK = join(TEMP_DIR, "browser-live-launch.lock.json");
const BUNDLE_SWAP_SCHEMA = "browser-live-bundle-swap/v2";
const BUILD_ATTESTATION = join(TEMP_DIR, "browser-live-build-attestation.json");
const LAUNCH_PROVENANCE = join(TEMP_DIR, "browser-live-provenance.json");
const PINNED_LEGACY_ATTESTATION = join(repoRoot, "scripts", "performance", "p25", "pinned-legacy-bundle-attestation.json");
/** The MCP package/browser revision is PINNED, not floating.
 *
 *  `@latest` broke this harness twice in one day. First the Chromium it bundles
 *  began unloading the unpacked extension on chrome.runtime.reload(); then its
 *  browser_run_code_unsafe stopped answering altogether, which hangs the popup
 *  binding — the page loads and nothing else works, with no error that names the
 *  cause. Both cost real diagnosis time and neither was a change to this repo.
 *
 *  A test harness that silently changes under you is worse than an old one. Bump
 *  this deliberately, and verify the bind step still completes when you do. */
const PLAYWRIGHT_MCP_VERSION = "0.0.78";
const PLAYWRIGHT_MCP_PACKAGE = `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`;
const CDP_PORT = 9222;
const LAUNCH_LOCK_SCHEMA = "browser-live-launch-lock/v1";
const CONTROL_STATE_TIMEOUT_MS = 30_000;
const CONTROL_OBSERVE_TIMEOUT_MS = 10_000;
const XVFB_WRAP_ENV = "UNFLUFFIFY_BROWSER_LIVE_XVFB_WRAPPED";
const XVFB_RUN_ARGS = ["-a", "--server-args=-screen 0 1280x900x24"];
const MANUAL_XVFB_COMMAND =
  'xvfb-run -a --server-args="-screen 0 1280x900x24" pnpm browser:live <target-url> [--no-build] [--bundle-source <bundle-dir>]';

// --- args -----------------------------------------------------------------
const positionals = [];
const flags = new Set();
let bundleSourceArgument = null;
const rawArguments = process.argv.slice(2);
for (let index = 0; index < rawArguments.length; index += 1) {
  const argument = rawArguments[index];
  if (argument === "--bundle-source") {
    const value = rawArguments[index + 1];
    if (!value || value.startsWith("--")) {
      console.error("ERROR: --bundle-source requires a bundle directory");
      process.exit(2);
    }
    bundleSourceArgument = value;
    index += 1;
  } else if (argument.startsWith("--")) {
    flags.add(argument);
  } else {
    positionals.push(argument);
  }
}

let target = positionals[0];
if (!target) {
  console.error(
    [
      "ERROR: a target page URL is required.",
      "",
      "The user must instruct which page to load. If they did not, STOP and ask",
      "them for it — do not guess a default.",
      "",
      "Usage: pnpm browser:live <target-url> [--no-build] [--bundle-source <bundle-dir>]",
    ].join("\n"),
  );
  process.exit(2);
}
if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
try {
  const parsedTarget = new URL(target);
  if (!/^https?:$/.test(parsedTarget.protocol) || !parsedTarget.hostname) throw new Error("HTTP(S) host is missing");
  target = parsedTarget.href;
} catch (error) {
  console.error(`ERROR: invalid target page URL ${JSON.stringify(target)}: ${String(error?.message ?? error)}`);
  process.exit(2);
}
const doBuild = !flags.has("--no-build");
for (const flag of flags) {
  if (flag !== "--no-build") {
    console.error(`ERROR: unsupported browser:live option ${flag}`);
    process.exit(2);
  }
}
if (bundleSourceArgument && doBuild) {
  console.error("ERROR: --bundle-source selects an existing bundle and therefore requires --no-build");
  process.exit(2);
}

// --- helpers --------------------------------------------------------------
function commandExists(command) {
  const probe = spawnSync(command, ["--help"], { stdio: "ignore" });
  return probe.error?.code !== "ENOENT";
}

function hasUsableX11Display() {
  if (!process.env.DISPLAY) return false;
  const probe = spawnSync("xrandr", ["--current"], {
    encoding: "utf8",
    env: process.env,
  });
  // If xrandr is unavailable, retain the historical DISPLAY-based behavior.
  // A present but zero-sized RandR display is different: Chromium reaches the
  // GPU/bootstrap boundary and either stalls on Wayland DRM or exits SIGTRAP.
  if (probe.error?.code === "ENOENT") return true;
  if (probe.status !== 0) return false;
  const dimensions = String(probe.stdout ?? "").match(/current\s+(\d+)\s+x\s+(\d+)/i);
  if (!dimensions) return true;
  return Number(dimensions[1]) > 0 && Number(dimensions[2]) > 0;
}

function shouldWrapWithXvfb() {
  return (
   process.platform === "linux" &&
   !hasUsableX11Display() &&
   process.env[XVFB_WRAP_ENV] !== "1"
  );
}

async function maybeWrapWithXvfb() {
  if (!shouldWrapWithXvfb()) {
   return;
  }
  if (!commandExists("xvfb-run")) {
   console.warn("[launch] no usable X11 display detected.");
   console.warn(`[launch] headless Linux runs need xvfb-run. Re-run as: ${MANUAL_XVFB_COMMAND}`);
   process.exit(1);
  }
  console.log("[launch] no usable X11 display detected; relaunching inside xvfb-run...");
  const child = spawn(
   "xvfb-run",
   [
     ...XVFB_RUN_ARGS,
     process.execPath,
     selfPath,
     ...process.argv.slice(2),
   ],
   {
     cwd: repoRoot,
     env: { ...process.env, [XVFB_WRAP_ENV]: "1" },
     stdio: "inherit",
   },
  );
  activeCommandChildren.add(child);
  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
   child.once("error", (error) => {
     activeCommandChildren.delete(child);
     rejectPromise(error);
   });
   child.once("close", (code, signal) => {
     activeCommandChildren.delete(child);
     if (signal) {
       rejectPromise(new Error(`xvfb-run exited via signal ${signal}`));
       return;
     }
     resolvePromise(code ?? 0);
   });
  });
  process.exit(exitCode);
}

async function run(cmd, args) {
  const child = spawn(cmd, args, {
   cwd: repoRoot,
   env: process.env,
    stdio: "inherit",
  });
  activeCommandChildren.add(child);
  await new Promise((resolvePromise, rejectPromise) => {
   child.once("error", (error) => {
     activeCommandChildren.delete(child);
     rejectPromise(error);
   });
   child.once("close", (code, signal) => {
     activeCommandChildren.delete(child);
     if (signal) {
       rejectPromise(new Error(`\`${cmd} ${args.join(" ")}\` exited via signal ${signal}`));
       return;
     }
     if ((code ?? 0) !== 0) {
       rejectPromise(new Error(`\`${cmd} ${args.join(" ")}\` failed (code ${code ?? 0})`));
       return;
     }
     resolvePromise();
   });
  });
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, env: process.env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr ?? "").trim()}`);
  }
  return String(result.stdout ?? "").trim();
}

async function currentSourceIdentity() {
  const [head, tree, statusText, packageLock] = await Promise.all([
    Promise.resolve(git(["rev-parse", "HEAD"])),
    Promise.resolve(git(["rev-parse", "HEAD^{tree}"])),
    Promise.resolve(git(["status", "--porcelain=v1", "--untracked-files=all"])),
    readFile(join(repoRoot, SOURCE_LOCKFILE)),
  ]);
  return {
    head,
    tree,
    clean: statusText.length === 0,
    statusDigest: sha256(statusText),
    lockfile: SOURCE_LOCKFILE,
    packageLockSha256: sha256(packageLock),
    buildCommand: "pnpm build",
  };
}

function attestedBundle(inventory) {
  return {
    schemaVersion: inventory.schemaVersion,
    normalization: inventory.normalization,
    normalizedManifestVersion: inventory.normalizedManifestVersion,
    inventoryDigest: inventory.inventoryDigest,
    fileCount: inventory.fileCount,
    bytes: inventory.bytes,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function resolveLaunchAttestation({ builtCurrentSource, selectedBundleSource }) {
  const inventory = await normalizedBundleInventory(EXT_DIR);
  if (builtCurrentSource) {
    const source = await currentSourceIdentity();
    const attestation = {
      schemaVersion: BROWSER_LIVE_BUILD_ATTESTATION_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      implementation: "rewrite",
      source,
      bundle: attestedBundle(inventory),
    };
    await writeJsonAtomic(BUILD_ATTESTATION, attestation);
    return { implementation: "rewrite", source: { ...source, attestationSchema: attestation.schemaVersion }, inventory, attestation };
  }

  if (selectedBundleSource) {
    const attestation = await readJson(PINNED_LEGACY_ATTESTATION);
    const failures = pinnedLegacyAttestationFailures(attestation, inventory);
    if (failures.length > 0) {
      throw new Error(`Selected --bundle-source is not the trusted pinned legacy bundle: ${failures.join(", ")}`);
    }
    return {
      implementation: "legacy",
      source: {
        ...attestation.source,
        clean: true,
        statusDigest: sha256(""),
        attestationSchema: PINNED_LEGACY_ATTESTATION_SCHEMA_VERSION,
      },
      inventory,
      attestation,
    };
  }

  const [attestation, source] = await Promise.all([
    readJson(BUILD_ATTESTATION).catch(() => null),
    currentSourceIdentity(),
  ]);
  if (!attestation) {
    throw new Error(`--no-build requires a launcher-generated build attestation: ${BUILD_ATTESTATION}`);
  }
  const validation = validateBundleInventoryAttestation(inventory, attestation, {
    implementation: "rewrite",
    head: source.head,
    tree: source.tree,
    packageLockSha256: source.packageLockSha256,
    buildCommand: source.buildCommand,
  });
  const failures = [...validation.failures];
  if (attestation.schemaVersion !== BROWSER_LIVE_BUILD_ATTESTATION_SCHEMA_VERSION) failures.push("attestation-schema");
  for (const key of ["clean", "statusDigest", "lockfile"]) {
    if (attestation.source?.[key] !== source[key]) failures.push(`source-${key}`);
  }
  if (failures.length > 0) {
    throw new Error(`--no-build attestation does not match current source and bundle: ${[...new Set(failures)].join(", ")}`);
  }
  return {
    implementation: "rewrite",
    source: { ...source, attestationSchema: attestation.schemaVersion },
    inventory,
    attestation,
  };
}

async function writeLaunchProvenance({ launchAttestation, cdpBrowserIdentity, browserProcess, extensionId, requestedUrl, finalUrl, cdpTargetId, tabId }) {
  const inventory = await normalizedBundleInventory(EXT_DIR);
  if (inventory.inventoryDigest !== launchAttestation.inventory.inventoryDigest ||
      inventory.fileCount !== launchAttestation.inventory.fileCount || inventory.bytes !== launchAttestation.inventory.bytes) {
    throw new Error("Canonical extension bundle changed after its trusted build attestation; refusing provenance");
  }
  if (launchAttestation.implementation === "rewrite") {
    const current = await currentSourceIdentity();
    for (const key of ["head", "tree", "clean", "statusDigest", "lockfile", "packageLockSha256", "buildCommand"]) {
      if (current[key] !== launchAttestation.source[key]) {
        throw new Error(`Rewrite source changed after build attestation (${key}); refusing provenance`);
      }
    }
  }
  const profileRoot = await realpath(PROFILE_DIR);
  const fingerprint = sha256(JSON.stringify({
    browser: cdpBrowserIdentity.product,
    protocolVersion: cdpBrowserIdentity.protocolVersion,
    userAgent: cdpBrowserIdentity.userAgent,
    v8Version: cdpBrowserIdentity.v8Version,
  }));
  const provenance = {
    schemaVersion: BROWSER_LIVE_PROVENANCE_SCHEMA_VERSION,
    launchNonce: randomUUID(),
    createdAt: new Date().toISOString(),
    implementation: launchAttestation.implementation,
    source: launchAttestation.source,
    bundle: {
      canonicalRoot: inventory.root,
      inventoryDigest: inventory.inventoryDigest,
      fileCount: inventory.fileCount,
      bytes: inventory.bytes,
      manifestVersion: inventory.manifestVersion,
      normalizedManifestVersion: inventory.normalizedManifestVersion,
    },
    browser: {
      pid: browserProcess.pid,
      instanceNonce: sha256(cdpBrowserIdentity.webSocketDebuggerUrl).slice(0, 32),
      fingerprint,
      product: cdpBrowserIdentity.product,
      cdpPort: CDP_PORT,
    },
    profile: {
      root: profileRoot,
      pathDigest: sha256(profileRoot),
    },
    extensionId,
    target: {
      requestedUrl,
      normalizedUrl: normalizeLiveUrl(finalUrl),
      cdpTargetId,
      tabId,
    },
  };
  await writeJsonAtomic(LAUNCH_PROVENANCE, provenance);
  return provenance;
}

async function pathExists(path) {
  return stat(path).then(() => true, () => false);
}

let launcherLock = null;
let manifestStamp = null;
let activeBrowserStop = null;
let launchCleanupPromise = null;
const activeCommandChildren = new Set();

async function stopActiveCommandChildren() {
  const children = [...activeCommandChildren];
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await Promise.race([
      new Promise((resolvePromise) => {
        child.once("close", resolvePromise);
        child.once("error", resolvePromise);
      }),
      delay(5_000),
    ]);
  }));
  for (const child of children) activeCommandChildren.delete(child);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLauncherLock() {
  const lock = {
    schemaVersion: LAUNCH_LOCK_SCHEMA,
    pid: process.pid,
    token: randomUUID(),
    repoRoot,
    profileRoot: PROFILE_DIR,
    cdpPort: CDP_PORT,
    createdAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(LAUNCH_LOCK, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx" });
      launcherLock = lock;
      return lock;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const raw = await readFile(LAUNCH_LOCK, "utf8").catch(() => null);
      let existing = null;
      try { existing = raw ? JSON.parse(raw) : null; } catch { /* a corrupt stale lock is not an owner */ }
      if (existing?.schemaVersion !== LAUNCH_LOCK_SCHEMA || !Number.isInteger(existing?.pid) || typeof existing?.token !== "string") {
        throw new Error(`Invalid live-browser lock requires manual inspection before removal: ${LAUNCH_LOCK}`, { cause: error });
      }
      if (existing?.schemaVersion === LAUNCH_LOCK_SCHEMA && processAlive(existing.pid)) {
        throw new Error(`The live browser profile is owned by launcher pid ${existing.pid}; stop that launcher first`, { cause: error });
      }
      await rm(LAUNCH_LOCK, { force: true });
    }
  }
  throw new Error(`Could not acquire the exclusive live-browser lock: ${LAUNCH_LOCK}`);
}

async function releaseLauncherLock() {
  const owned = launcherLock;
  launcherLock = null;
  if (!owned) return false;
  const raw = await readFile(LAUNCH_LOCK, "utf8").catch(() => null);
  if (!raw) return false;
  let current;
  try { current = JSON.parse(raw); } catch { return false; }
  if (current?.pid !== owned.pid || current?.token !== owned.token) {
    throw new Error(`Refusing to remove a live-browser lock now owned by another launcher: ${LAUNCH_LOCK}`);
  }
  await rm(LAUNCH_LOCK, { force: true });
  return true;
}

async function assertCdpPortAvailable(timeoutMs = 1_000) {
  await new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection({ host: "127.0.0.1", port: CDP_PORT });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`Could not prove CDP port ${CDP_PORT} is free (probe timed out)`)));
    socket.once("connect", () => finish(new Error(
      `CDP port ${CDP_PORT} is already occupied; refusing to attach to or control a browser not owned by this launcher`,
    )));
    socket.once("error", (error) => {
      if (error?.code === "ECONNREFUSED") finish();
      else finish(new Error(`Could not prove CDP port ${CDP_PORT} is free: ${String(error?.message ?? error)}`));
    });
  });
}

async function assertProfileNotInUse() {
  const singletonLock = join(PROFILE_DIR, "SingletonLock");
  const lockStat = await lstat(singletonLock).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!lockStat) return;
  if (!lockStat.isSymbolicLink()) {
    throw new Error(`The Chromium profile has an unrecognized SingletonLock; refusing mutation: ${singletonLock}`);
  }
  const owner = await readlink(singletonLock);
  const pid = Number.parseInt(/-(\d+)$/.exec(owner)?.[1] ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`The Chromium profile SingletonLock has an unrecognized owner ${JSON.stringify(owner)}; refusing mutation`);
  }
  if (processAlive(pid)) {
    throw new Error(`The Chromium profile is already in use by browser pid ${pid}; stop that browser before launching`);
  }
}

async function readBundleSwapMarker() {
  const raw = await readFile(BUNDLE_SWAP_MARKER, "utf8").catch(() => null);
  if (!raw) return null;
  const marker = JSON.parse(raw);
  const validSchema = marker?.schemaVersion === BUNDLE_SWAP_SCHEMA;
  const validSource = typeof marker?.sourceRoot === "string" && isAbsolute(marker.sourceRoot) &&
    marker.sourceRoot !== EXT_DIR && !isPathWithin(EXT_DIR, marker.sourceRoot);
  const validBackup = typeof marker?.backupRoot === "string" &&
    resolve(marker.backupRoot) === marker.backupRoot && dirname(marker.backupRoot) === TEMP_DIR &&
    /^browser-live-bundle-backup-[0-9a-f-]+$/i.test(basename(marker.backupRoot));
  const validPreserved = marker?.preservedRoot === undefined || (
    typeof marker.preservedRoot === "string" && resolve(marker.preservedRoot) === marker.preservedRoot &&
    dirname(marker.preservedRoot) === TEMP_DIR && /^browser-live-bundle-preserved-[0-9a-f-]+$/i.test(basename(marker.preservedRoot))
  );
  const validPhase = ["preparing", "backed-up", "staged", "preserving-concurrent"].includes(marker?.phase);
  const validFingerprint = !["staged", "preserving-concurrent"].includes(marker?.phase) ||
    (typeof marker?.stagedFingerprint === "string" && /^[a-f0-9]{64}$/.test(marker.stagedFingerprint));
  if (!validSchema || marker?.canonicalRoot !== EXT_DIR || !validSource || !validBackup || !validPreserved || !validPhase || !validFingerprint ||
      (marker?.phase === "preserving-concurrent" && typeof marker?.preservedRoot !== "string") ||
      !Number.isInteger(marker?.pid) || typeof marker?.originalPresent !== "boolean") {
    throw new Error(`Unsafe or invalid browser-live bundle swap marker: ${BUNDLE_SWAP_MARKER}`);
  }
  return marker;
}

function isPathWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent !== "" && pathFromParent !== ".." && !pathFromParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(pathFromParent);
}

async function assertBundleDirectory(path, label) {
  const directory = await stat(path).catch(() => null);
  const manifest = await stat(join(path, "manifest.json")).catch(() => null);
  if (!directory?.isDirectory() || !manifest?.isFile()) {
    throw new Error(`${label} is not a validated extension bundle directory: ${path}`);
  }
}

async function fingerprintBundle(path) {
  await assertBundleDirectory(path, "Bundle fingerprint target");
  const hash = createHash("sha256");
  const visit = async (directory, relativeRoot = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        hash.update(`d:${relativePath}\0`);
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        hash.update(`f:${relativePath}\0`);
        hash.update(await readFile(absolutePath));
        hash.update("\0");
      } else {
        throw new Error(`Bundle contains an unsupported non-file entry: ${absolutePath}`);
      }
    }
  };
  await visit(path);
  return hash.digest("hex");
}

async function restoreBundleSwap({ allowCurrentProcess = false } = {}) {
  const marker = await readBundleSwapMarker();
  if (!marker) return false;
  if (processAlive(marker.pid) && !(allowCurrentProcess && marker.pid === process.pid)) {
    throw new Error(`A browser:live bundle swap is owned by live process ${marker.pid}; stop that launcher first`);
  }
  if (marker.phase === "preserving-concurrent") {
    if (await pathExists(marker.preservedRoot)) {
      await rm(BUNDLE_SWAP_MARKER, { force: true });
      console.warn(`[launch] kept a concurrent canonical build and preserved its predecessor at ${marker.preservedRoot}`);
      return true;
    }
    if (!(await pathExists(marker.backupRoot))) {
      throw new Error(`Cannot finish concurrent-build preservation; both paths are missing from ${BUNDLE_SWAP_MARKER}`);
    }
  }
  const backupExists = await pathExists(marker.backupRoot);
  if (!marker.originalPresent && backupExists) {
    throw new Error(`Bundle swap marker claims no original bundle but a backup exists: ${marker.backupRoot}`);
  }
  if (marker.originalPresent && backupExists) {
    await assertBundleDirectory(marker.backupRoot, "Canonical bundle backup");
    const canonicalExists = await pathExists(EXT_DIR);
    const canonicalFingerprint = canonicalExists ? await fingerprintBundle(EXT_DIR).catch(() => null) : null;
    const concurrentChange = canonicalExists && marker.stagedFingerprint && canonicalFingerprint !== marker.stagedFingerprint;
    if (concurrentChange) {
      const preservedRoot = marker.preservedRoot ?? join(TEMP_DIR, `browser-live-bundle-preserved-${randomUUID()}`);
      marker.phase = "preserving-concurrent";
      marker.preservedRoot = preservedRoot;
      await writeJsonAtomic(BUNDLE_SWAP_MARKER, marker);
      await rename(marker.backupRoot, preservedRoot);
      await rm(BUNDLE_SWAP_MARKER, { force: true });
      console.warn(`[launch] canonical output changed during the live run; kept it and preserved the pre-run bundle at ${preservedRoot}`);
      return true;
    }
    await rm(EXT_DIR, { recursive: true, force: true });
    await rename(marker.backupRoot, EXT_DIR);
  } else if (marker.originalPresent && marker.phase !== "preparing") {
    throw new Error(`Cannot recover canonical extension bundle; backup is missing: ${marker.backupRoot}`);
  } else if (!marker.originalPresent) {
    const canonicalExists = await pathExists(EXT_DIR);
    const canonicalFingerprint = canonicalExists ? await fingerprintBundle(EXT_DIR).catch(() => null) : null;
    if (!marker.stagedFingerprint || canonicalFingerprint === marker.stagedFingerprint) {
      await rm(EXT_DIR, { recursive: true, force: true });
    } else {
      console.warn("[launch] canonical output was created or changed during the live run; keeping it because no pre-run bundle existed");
    }
  }
  await rm(BUNDLE_SWAP_MARKER, { force: true });
  return true;
}

async function stageBundleSource(sourceArgument) {
  const sourceRoot = await realpath(resolve(repoRoot, sourceArgument));
  if (sourceRoot === EXT_DIR) return null;
  if (isPathWithin(EXT_DIR, sourceRoot)) {
    throw new Error(`Selected --bundle-source cannot be nested inside the canonical extension bundle: ${sourceRoot}`);
  }
  await assertBundleDirectory(sourceRoot, "Selected --bundle-source");
  const backupRoot = join(TEMP_DIR, `browser-live-bundle-backup-${randomUUID()}`);
  const marker = {
    schemaVersion: BUNDLE_SWAP_SCHEMA,
    pid: process.pid,
    canonicalRoot: EXT_DIR,
    sourceRoot,
    backupRoot,
    originalPresent: await pathExists(EXT_DIR),
    phase: "preparing",
    createdAt: new Date().toISOString(),
  };
  await writeFile(BUNDLE_SWAP_MARKER, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
  try {
    if (marker.originalPresent) await rename(EXT_DIR, backupRoot);
    marker.phase = "backed-up";
    await writeJsonAtomic(BUNDLE_SWAP_MARKER, marker);
    await cp(sourceRoot, EXT_DIR, { recursive: true, force: false, errorOnExist: true });
    marker.stagedFingerprint = await fingerprintBundle(EXT_DIR);
    marker.phase = "staged";
    await writeJsonAtomic(BUNDLE_SWAP_MARKER, marker);
    return marker;
  } catch (error) {
    await restoreBundleSwap({ allowCurrentProcess: true }).catch(() => undefined);
    throw error;
  }
}

function resolveManagedChromiumExecutable() {
  const probe = spawnSync(
    "npm",
    [
      "exec",
      "--yes",
      `--package=${PLAYWRIGHT_MCP_PACKAGE}`,
      "--",
      "sh",
      "-c",
      [
        'mcp_cli=$(readlink -f "$(command -v playwright-mcp)")',
        'mcp_node_modules=$(dirname "$(dirname "$(dirname "$mcp_cli")")")',
        '(cd "${TMPDIR:-/tmp}" && NODE_PATH="$mcp_node_modules" node -e \'console.log(require("playwright").chromium.executablePath())\')',
      ].join("; "),
    ],
    { cwd: repoRoot, env: process.env, encoding: "utf8" },
  );
  const executable = String(probe.stdout ?? "").trim();
  if (probe.status !== 0 || !executable) {
    throw new Error(
      `Could not resolve the managed Chromium executable from ${PLAYWRIGHT_MCP_PACKAGE}: ` +
      String(probe.stderr ?? "").trim(),
    );
  }
  return executable;
}

function spawnManagedChromium(executable, launchArgs, pageUrl) {
  const args = [
    ...launchArgs.filter((arg) =>
      typeof arg === "string" &&
      !arg.startsWith("--remote-debugging-port=") &&
      !arg.startsWith("--remote-allow-origins=") &&
      !arg.startsWith("--user-data-dir=") &&
      arg !== "--remote-debugging-pipe"),
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${PROFILE_DIR}`,
    "--disable-field-trial-config",
    "--enable-automation",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--disable-sync",
    "--window-size=1280,900",
    pageUrl,
  ];
  return spawn(executable, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Chrome derives an unpacked extension id from the absolute load path:
 *  first 16 bytes of SHA-256(path), each nibble mapped 0..15 -> 'a'..'p'. */
async function deterministicExtensionId(path) {
  const digest = createHash("sha256").update(path).digest().subarray(0, 16);
  let out = "";
  for (const b of digest) {
   out += String.fromCharCode(97 + (b >> 4));
    out += String.fromCharCode(97 + (b & 0x0f));
  }
  return out;
}

async function openCdpTab(url) {
  const endpoint = `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, { method: "PUT" });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`CDP could not open the popup tab (${response.status}): ${body.slice(0, 500)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`CDP returned an invalid popup target: ${body.slice(0, 500)}`);
  }
}

async function listCdpTargets() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP target list failed (${response.status})`);
  }
  const targets = await response.json();
  if (!Array.isArray(targets)) {
    throw new Error("CDP target list was not an array");
  }
  return targets;
}

async function readCdpBrowserIdentity(timeoutMs = 5_000) {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
  if (!response.ok) throw new Error(`CDP version endpoint failed (${response.status})`);
  const version = await response.json();
  if (typeof version?.webSocketDebuggerUrl !== "string") throw new Error("CDP version endpoint omitted the browser debugger URL");
  const processInfo = await sendCdpCommand(version.webSocketDebuggerUrl, "SystemInfo.getProcessInfo", {}, timeoutMs);
  const browser = processInfo?.processInfo?.find((entry) => entry.type === "browser");
  if (!Number.isInteger(browser?.id)) throw new Error("CDP did not report its owning browser process id");
  return {
    pid: browser.id,
    product: String(version.Browser ?? ""),
    protocolVersion: String(version["Protocol-Version"] ?? ""),
    userAgent: String(version["User-Agent"] ?? ""),
    v8Version: String(version["V8-Version"] ?? ""),
    webSocketDebuggerUrl: version.webSocketDebuggerUrl,
  };
}

async function waitForCdpBrowser(browserProcess, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) {
      throw new Error(
        `Managed Chromium exited before CDP became ready ` +
        `(code=${String(browserProcess.exitCode)}, signal=${String(browserProcess.signalCode)})`,
      );
    }
    try {
      await listCdpTargets();
      const identity = await readCdpBrowserIdentity();
      if (identity.pid !== browserProcess.pid) {
        const error = new Error(
          `CDP port ${CDP_PORT} belongs to browser pid ${identity.pid}, not launcher-owned pid ${browserProcess.pid}; refusing control`,
        );
        error.code = "CDP_OWNERSHIP_MISMATCH";
        throw error;
      }
      return identity;
    } catch (error) {
      if (error?.code === "CDP_OWNERSHIP_MISMATCH") throw error;
      await delay(250);
    }
  }
  throw new Error(`Managed Chromium did not expose CDP on port ${CDP_PORT}`);
}

async function waitForTargetPage(targetId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastUrls = [];
  while (Date.now() < deadline) {
    const targets = await listCdpTargets();
    lastUrls = targets.map((targetInfo) => String(targetInfo?.url ?? ""));
    const targetPage = targets.find((targetInfo) =>
      targetInfo?.type === "page" && String(targetInfo?.id ?? "") === String(targetId));
    if (targetPage) {
      const state = await evaluateCdpTarget(
        targetPage,
        "({ href: location.href, ready: document.readyState })",
        5_000,
      ).catch(() => null);
      if (state?.ready === "complete" && /^https?:\/\//i.test(String(state.href ?? ""))) {
        // The requested URL can redirect (Bonliva adds www). Bind against the
        // exact target id returned by /json/new and its current canonical URL, not
        // another HTTP tab from the reused profile or a target-list value sampled
        // while navigation was still in flight.
        return { ...targetPage, url: String(state.href) };
      }
    }
    await delay(250);
  }
  throw new Error(`Managed target page ${targetId} did not appear; targets=${JSON.stringify(lastUrls)}`);
}

async function closeStartupBlankPages(targetId) {
  const targets = await listCdpTargets();
  for (const targetInfo of targets) {
    const url = String(targetInfo?.url ?? "");
    if (targetInfo?.type === "page" && String(targetInfo?.id ?? "") !== String(targetId) &&
        (url === "about:blank" || url === "chrome://newtab/")) {
      await closeCdpTarget(targetInfo);
    }
  }
}

async function waitForCdpTarget(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastUrls = [];
  while (Date.now() < deadline) {
    const targets = await listCdpTargets();
    lastUrls = targets.map((targetInfo) => String(targetInfo?.url ?? ""));
    const popupTarget = targets.find((targetInfo) => targetInfo?.type === "page" && targetInfo?.url === url);
    if (popupTarget) return popupTarget;
    await delay(250);
  }
  throw new Error(`CDP popup target did not appear: ${url}; targets=${JSON.stringify(lastUrls)}`);
}

async function waitForCdpTargetClosed(targetId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listCdpTargets();
    if (!targets.some((targetInfo) => String(targetInfo?.id ?? "") === targetId)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`CDP helper target did not close: ${targetId}`);
}

async function closeCdpTarget(targetInfo) {
  const targetId = String(targetInfo?.id ?? "");
  if (!targetId) {
    throw new Error("CDP helper target has no id");
  }
  const endpoint = `http://127.0.0.1:${CDP_PORT}/json/close/${encodeURIComponent(targetId)}`;
  const response = await fetch(endpoint, { method: "PUT" });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`CDP could not close the helper popup (${response.status}): ${body.slice(0, 500)}`);
  }
  await waitForCdpTargetClosed(targetId);
}

async function bringCdpPageToFront(pageTarget) {
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error(`Could not focus managed page target ${String(pageTarget?.id ?? "unknown")}`);
  }
  await sendCdpCommand(pageTarget.webSocketDebuggerUrl, "Page.bringToFront", {}, 10_000);
}

async function openActualSidePanel(boundUrl, tabId) {
  const popupTarget = await waitForCdpTarget(boundUrl);
  const response = await sendCdpCommand(
    popupTarget.webSocketDebuggerUrl,
    "Runtime.evaluate",
    {
      expression: `chrome.sidePanel.open({ tabId: ${JSON.stringify(tabId)} })`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    10_000,
  );
  if (response?.exceptionDetails) {
    const description = response.exceptionDetails?.exception?.description
      ?? response.exceptionDetails?.text
      ?? "unknown side-panel error";
    throw new Error(`Could not open the actual extension side panel: ${description}`);
  }
  const sidePanelUrl = boundUrl.replace(/\?.*$/, "");
  await waitForCdpTarget(sidePanelUrl);
  // The debugTabId page exists only to issue chrome.sidePanel.open with a user
  // gesture. Leaving it alive creates a second popup client, which duplicates
  // property loads, lock refreshes, and signal polling. Close that exact target
  // only after the production side-panel target is present.
  await closeCdpTarget(popupTarget);
  await waitForCdpTarget(sidePanelUrl);
  return sidePanelUrl;
}

async function openOperatorSurface(boundUrl, tabId) {
  try {
    return { url: await openActualSidePanel(boundUrl, tabId), kind: "side panel" };
  } catch (error) {
    const description = String(error?.message ?? error);
    if (!description.includes("No active side panel")) {
      throw error;
    }
    // The pinned legacy build predates the persistent side-panel registration
    // used by the rewrite. Its bound popup is the real operator surface, so keep
    // that exact helper alive for legacy comparison instead of aborting launch.
    await waitForCdpTarget(boundUrl);
    console.warn("[launch] no active side panel; retaining the bound legacy popup as the operator surface");
    return { url: boundUrl, kind: "bound popup" };
  }
}

function sendCdpCommand(webSocketDebuggerUrl, method, params, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const requestId = 1;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`timeout waiting for CDP ${method}`));
    }, timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* the debug socket may already be closed */ }
      if (error) rejectPromise(error);
      else resolvePromise(value);
    }

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message?.id !== requestId) return;
      if (message.error) {
        finish(new Error(`CDP ${method} failed: ${JSON.stringify(message.error)}`));
        return;
      }
      finish(null, message.result);
    });
    socket.addEventListener("error", () => finish(new Error(`CDP ${method} socket failed`)));
    socket.addEventListener("close", () => finish(new Error(`CDP ${method} socket closed before replying`)));
  });
}

async function evaluateCdpTarget(targetInfo, expression, timeoutMs) {
  if (!targetInfo?.webSocketDebuggerUrl) {
    throw new Error(`CDP target has no debugger URL: ${String(targetInfo?.url ?? "unknown")}`);
  }
  const response = await sendCdpCommand(
    targetInfo.webSocketDebuggerUrl,
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    timeoutMs,
  );
  if (response?.exceptionDetails) {
    const description = response.exceptionDetails?.exception?.description
      ?? response.exceptionDetails?.text
      ?? "unknown evaluation error";
    throw new Error(`CDP Runtime.evaluate failed: ${description}`);
  }
  return response?.result?.value;
}

async function waitForLiveServiceWorker(expectedExtensionId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listCdpTargets();
    const workers = targets.filter((targetInfo) =>
      targetInfo?.type === "service_worker"
        && String(targetInfo?.url ?? "").startsWith(`chrome-extension://${expectedExtensionId}/`));
    for (const worker of workers) {
      try {
        const isLive = await evaluateCdpTarget(
          worker,
          "Boolean(globalThis.chrome && chrome.runtime && chrome.runtime.id)",
          5_000,
        );
        if (isLive) return worker;
      } catch {
        // A torn-down worker target can linger briefly; probe the next handle.
      }
    }
    await delay(500);
  }
  throw new Error(`No live extension service worker for deterministic extension id ${expectedExtensionId}`);
}

async function bindPopupWithCdp(pageTarget, pageUrl, expectedExtensionId) {
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error(`Could not bind managed page target ${String(pageTarget?.id ?? "unknown")} for ${pageUrl}`);
  }

  let worker = await waitForLiveServiceWorker(expectedExtensionId);
  const extId = String(worker.url).split("/")[2];
  if (extId !== expectedExtensionId) {
    throw new Error(`Loaded extension id ${extId} does not match deterministic canonical-path id ${expectedExtensionId}`);
  }

  // The page was first navigated before binding. Reload it without MCP's
  // context-wide wait-for-completion heuristic so a third-party iframe or live
  // request cannot wedge the request queue and prevent every later control.
  await sendCdpCommand(pageTarget.webSocketDebuggerUrl, "Page.reload", {}, 30_000);
  await delay(1_500);

  // URL equality is insufficient when a reused profile contains duplicate tabs,
  // and `active` is only a focus hint. Stamp the exact CDP target in MAIN world,
  // then ask the extension to prove which Chrome tab can read that nonce.
  const targetMarkerKey = `__UF_BROWSER_LIVE_TARGET_${randomUUID().replaceAll("-", "_")}`;
  const targetMarkerValue = randomUUID();
  await evaluateCdpTarget(pageTarget, `(() => {
    Object.defineProperty(globalThis, ${JSON.stringify(targetMarkerKey)}, {
      value: ${JSON.stringify(targetMarkerValue)}, configurable: true, enumerable: false
    });
    return true;
  })()`, 5_000);

  let tabId = null;
  let lastTabSnapshot = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    worker = await waitForLiveServiceWorker(expectedExtensionId, 5_000);
    const expression = `(async () => {
      const targetMarkerKey = ${JSON.stringify(targetMarkerKey)};
      const targetMarkerValue = ${JSON.stringify(targetMarkerValue)};
      const tabs = await chrome.tabs.query({});
      const proven = [];
      for (const tab of tabs) {
        if (!Number.isFinite(tab.id) || !/^https?:/i.test(String(tab.url || ''))) continue;
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: (key) => globalThis[key] ?? null,
            args: [targetMarkerKey],
          });
          if (results?.[0]?.result === targetMarkerValue) proven.push(tab);
        } catch {}
      }
      return {
        tabId: proven.length === 1 ? proven[0].id : null,
        provenTabIds: proven.map((tab) => tab.id),
        tabs: tabs.map((tab) => ({ id: tab.id, url: tab.url, status: tab.status })),
      };
    })()`;
    const result = await evaluateCdpTarget(worker, expression, 5_000).catch((error) => ({
      tabId: null,
      error: String(error?.message ?? error),
    }));
    tabId = result?.tabId ?? null;
    lastTabSnapshot = result;
    if (Number.isFinite(tabId)) break;
    await delay(500);
  }
  await evaluateCdpTarget(
    pageTarget,
    `(() => delete globalThis[${JSON.stringify(targetMarkerKey)}])()`,
    5_000,
  ).catch(() => undefined);
  if (!Number.isFinite(tabId)) {
    throw new Error(
      `Could not resolve a Chrome tab id for ${pageUrl}; ` +
      `last=${JSON.stringify(lastTabSnapshot)}`,
    );
  }

  return {
    extId,
    tabId,
    boundUrl: `chrome-extension://${extId}/popup.html?debugTabId=${tabId}`,
    pageUrl,
    refreshed: true,
  };
}

function buildPopupActionExpression(action, options = {}) {
  const clickSelector = options.clickSelector ? JSON.stringify(options.clickSelector) : "null";
  const inputValues = options.inputValues ? JSON.stringify(options.inputValues) : "null";
  const evalExpr = options.expr ? JSON.stringify(options.expr) : "null";
  return `(async () => {
  try {
  const action = ${JSON.stringify(action)};
  const clickSelector = ${clickSelector};
  const inputValues = ${inputValues};
  const evalExpr = ${evalExpr};
  const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

  async function collectPopupState() {
    const popupDebug = window.__UNFLUFFIFY_POPUP_DEBUG__;
    const debugHookAvailable = Boolean(popupDebug && typeof popupDebug.getViewState === 'function');
    const view = debugHookAvailable ? popupDebug.getViewState() : {};
    const activeView = document.querySelector('[data-view]')?.getAttribute('data-view') || '';
    const domIds = [
      'compute', 'marking-preview', 'page-save', 'page-revert', 'toggle-enabled',
      'desktop-preview-enabled', 'preview-latest', 'save-excludes',
      'render-mode-with-js', 'render-mode-without-js', 'render-mode-cancel',
    ];
    const dom = {};
    for (const id of domIds) {
      const element = document.getElementById(id);
      dom[id] = element
        ? {
          disabled: Boolean(element.disabled),
          checked: 'checked' in element ? Boolean(element.checked) : null,
          text: String(element.textContent || '').trim(),
          title: element.getAttribute('title') || '',
          ariaLabel: element.getAttribute('aria-label') || '',
          visible: Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
        }
        : null;
    }
    const viewKeys = [
      'previewActive', 'previewBlocked', 'previewItemsPending', 'previewWillRestoreMarking',
      'toggleEnabled', 'toggleEnabledDisabled', 'computeButtonDisabled',
      'markingPreviewVisible', 'markingPreviewDisabled',
      'pageSaveDisabled', 'pageRevertDisabled',
      'sessionHasPendingChanges', 'currentPageHasPendingChanges',
      'sessionRequiresAiRun', 'currentDraftDirty',
      'pageDraftStatusText', 'aiDirtyNoticeText',
      'isBusy', 'busyMessage',
      'previewBlockedReason', 'currentBaseUrl'
    ];
    const pickedView = {
      activeView,
      toggleEnabled: dom['toggle-enabled']?.checked,
      toggleEnabledDisabled: dom['toggle-enabled']?.disabled,
      computeButtonDisabled: dom.compute?.disabled,
      markingPreviewVisible: dom['marking-preview']?.visible,
      markingPreviewDisabled: dom['marking-preview']?.disabled,
      pageSaveDisabled: dom['page-save']?.disabled,
      pageRevertDisabled: dom['page-revert']?.disabled,
      isBusy: Boolean(document.querySelector('[aria-busy="true"]')),
      currentBaseUrl: String(document.getElementById('property-url-readout')?.textContent || '').trim(),
    };
    for (const key of viewKeys) {
      if (Object.prototype.hasOwnProperty.call(view, key)) pickedView[key] = view[key];
    }
    const inputs = Array.from(document.querySelectorAll('input[type=text], input[type=url], input[type=password], textarea'));
    const inputState = inputs.map((input) => ({
      id: input.id || input.name || '?',
      type: input instanceof HTMLInputElement ? input.type : 'textarea',
      valuePresent: String(input.value || '').length > 0,
      placeholder: input.placeholder || '',
      visible: Boolean(input.offsetWidth || input.offsetHeight),
    }));
    return { url: location.href, title: document.title, debugHookAvailable, activeView, view: pickedView, dom, inputs: inputState };
  }

  if (action === 'click' && clickSelector) {
    const before = await collectPopupState();
    const element = document.querySelector(clickSelector) || document.getElementById(clickSelector);
    if (!element) throw new Error('Element not found: ' + clickSelector);
    element.click();
    await sleep(2000);
    const after = await collectPopupState();
    return { action, selector: clickSelector, before, after };
  }

  if (action === 'set-inputs' && inputValues) {
    for (const [id, value] of Object.entries(inputValues)) {
      const element = document.getElementById(id) || document.querySelector('[name="' + id + '"]');
      if (element) {
        const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        const textareaValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        const valueSetter = element instanceof HTMLTextAreaElement ? textareaValueSetter : inputValueSetter;
        if (!valueSetter) throw new Error('Native input value setter is unavailable');
        valueSetter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    await sleep(500);
    const state = await collectPopupState();
    return { action, updatedInputIds: Object.keys(inputValues), state };
  }

  if (action === 'exit-preview') {
    const before = await collectPopupState();
    const button = document.querySelector('.preview-sidebar__dismiss');
    if (!button) throw new Error('Exit Preview button not found');
    button.click();
    await sleep(1500);
    const after = await collectPopupState();
    return { action, before, after };
  }

  if (action === 'eval' && evalExpr) {
    const result = await (0, eval)(evalExpr);
    return { action, result };
  }

  const state = await collectPopupState();
  return { action, state };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e), action: ${JSON.stringify(action)} };
  }
})()`;
}

async function runCdpStateAction(action, timeoutMs, options = {}, identity = {}) {
  const targets = await listCdpTargets();
  const pages = targets.filter((targetInfo) => targetInfo?.type === "page");
  const actualSidePanel = pages.find((targetInfo) =>
    String(targetInfo?.url ?? "") === `chrome-extension://${identity.extensionId}/popup.html`);
  const boundLegacyPopup = pages.find((targetInfo) =>
    String(targetInfo?.url ?? "").startsWith(`chrome-extension://${identity.extensionId}/popup.html?`));
  const popup = actualSidePanel ?? boundLegacyPopup;
  const targetPage = pages.find((targetInfo) => String(targetInfo?.id ?? "") === String(identity.targetId ?? ""));
  const pageUrls = pages.map((targetInfo) => String(targetInfo?.url ?? ""));
  if (!popup) {
    return { error: "Could not find the actual Unfluffify side panel", pages: pageUrls };
  }

  const result = asJson(await evaluateCdpTarget(
    popup,
    buildPopupActionExpression(action, options),
    timeoutMs,
  ));
  const targetState = options.includeTarget !== false && targetPage
    ? await evaluateCdpTarget(
      targetPage,
      "({ url: location.href, title: document.title, activeElement: document.activeElement ? document.activeElement.tagName : '' })",
      timeoutMs,
    ).catch((error) => ({ error: String(error?.message ?? error) }))
    : null;

  if (result.state) result.state = { popup: result.state, target: targetState };
  if (result.before) result.before = { popup: result.before, target: targetState };
  if (result.after) result.after = { popup: result.after, target: targetState };
  return { ...result, pages: pageUrls };
}

function asJson(value) {
  return value && typeof value === "object" ? value : {};
}

function summarizeButtonState(result) {
  const state = asJson(result.state ?? result.after ?? result);
  const popup = asJson(state.popup);
  const view = asJson(popup.view);
  const dom = asJson(popup.dom);
  return {
    previewActive: view.previewActive,
    previewWillRestoreMarking: view.previewWillRestoreMarking,
    toggleEnabled: view.toggleEnabled,
    toggleEnabledDisabled: view.toggleEnabledDisabled,
    computeButtonDisabled: view.computeButtonDisabled,
    markingPreviewDisabled: view.markingPreviewDisabled,
    pageSaveDisabled: view.pageSaveDisabled,
    pageRevertDisabled: view.pageRevertDisabled,
    sessionHasPendingChanges: view.sessionHasPendingChanges,
    currentPageHasPendingChanges: view.currentPageHasPendingChanges,
    sessionRequiresAiRun: view.sessionRequiresAiRun,
    pageDraftStatusText: view.pageDraftStatusText,
    dom
  };
}

function makeControlChannel(identity) {
  let queue = Promise.resolve();
  let observing = true;
  let lastObserved = "";
  let readlineInterface = null;

  function enqueue(task) {
    const next = queue.then(task, task);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async function runStateAction(action, timeoutMs = CONTROL_STATE_TIMEOUT_MS, options = {}) {
    return await runCdpStateAction(action, timeoutMs, options, identity);
  }

  function printJson(prefix, value) {
    console.log(`${prefix} ${JSON.stringify(value, null, 2)}`);
  }

  async function observeLoop() {
    while (observing) {
      try {
        const result = await enqueue(() => runStateAction("state", CONTROL_OBSERVE_TIMEOUT_MS, {
          includeTarget: false,
        }));
        const summary = summarizeButtonState(result);
        const serialized = JSON.stringify(summary);
        if (serialized !== lastObserved) {
          lastObserved = serialized;
          console.log(`[observe:buttons] ${new Date().toISOString()} ${serialized}`);
        }
      } catch (error) {
        console.log(`[observe:buttons:error] ${String(error && error.message ? error.message : error)}`);
      }
      await delay(500);
    }
  }

  async function handleCommand(rawLine) {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    if (line === "help") {
      console.log("[control] commands: help, state, exit-preview, observe, stop-observe, click <selector>, set-inputs <json>, eval <expr>");
      return;
    }
    if (line === "observe") {
      if (!observing) {
        observing = true;
        void observeLoop();
      }
      console.log("[control] button-state observation enabled");
      return;
    }
    if (line === "stop-observe") {
      observing = false;
      console.log("[control] button-state observation disabled");
      return;
    }
    if (line === "state") {
      const resumeObserve = observing;
      observing = false;
      try {
        const result = await enqueue(() => runStateAction("state", CONTROL_STATE_TIMEOUT_MS, {
          includeTarget: false,
        }));
        printJson("[control:state]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    if (line === "exit-preview") {
      const resumeObserve = observing;
      observing = false;
      try {
        const result = await enqueue(() => runStateAction("exit-preview", CONTROL_STATE_TIMEOUT_MS, {
          includeTarget: false,
        }));
        printJson("[control:exit-preview]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    if (line.startsWith("click ")) {
      const selector = line.slice(6).trim();
      const resumeObserve = observing;
      observing = false;
      try {
        // Popup commands are intentionally popup-only. Attaching a second CDP
        // client to the website tab here would race the extension's own
        // chrome.debugger session during render inspection.
        const result = await enqueue(() => runStateAction("click", CONTROL_STATE_TIMEOUT_MS, {
          clickSelector: selector,
          includeTarget: false,
        }));
        printJson("[control:click]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    if (line.startsWith("set-inputs ")) {
      const jsonStr = line.slice(11).trim();
      let inputValues;
      try { inputValues = JSON.parse(jsonStr); } catch { console.log("[control:error] invalid JSON for set-inputs"); return; }
      const resumeObserve = observing;
      observing = false;
      try {
        const result = await enqueue(() => runStateAction("set-inputs", CONTROL_STATE_TIMEOUT_MS, {
          inputValues,
          includeTarget: false,
        }));
        printJson("[control:set-inputs]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    if (line.startsWith("eval ")) {
      const expr = line.slice(5).trim();
      const resumeObserve = observing;
      observing = false;
      try {
        const result = await enqueue(() => runStateAction("eval", CONTROL_STATE_TIMEOUT_MS, {
          expr,
          includeTarget: false,
        }));
        printJson("[control:eval]", result);
      } catch (error) {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      }
      if (resumeObserve) {
        observing = true;
        void observeLoop();
      }
      return;
    }
    console.log(`[control] unknown command ${JSON.stringify(line)}; type "help"`);
  }

  async function readCommands() {
    readlineInterface = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    for await (const line of readlineInterface) {
      handleCommand(line).catch((error) => {
        console.log(`[control:error] ${String(error && error.message ? error.message : error)}`);
      });
    }
  }

  return {
    start() {
      console.log("[control] commands: help, state, exit-preview, observe, stop-observe, click <selector>, set-inputs <json>, eval <expr>");
      console.log("[control] automatic button-state observation is enabled");
      void observeLoop();
      void readCommands();
    },
    stop() {
      observing = false;
      readlineInterface?.close();
    }
  };
}

let emergencyCleanupStarted = false;
async function emergencyCleanup(error, exitCode = 1) {
  if (emergencyCleanupStarted) return;
  emergencyCleanupStarted = true;
  try {
    if (activeBrowserStop) await activeBrowserStop().catch(() => undefined);
    await cleanupLaunchArtifacts().catch(() => undefined);
  } finally {
    activeBrowserStop = null;
  }
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(exitCode);
}
process.on("uncaughtException", (error) => { void emergencyCleanup(error); });
process.on("unhandledRejection", (error) => { void emergencyCleanup(error); });
process.on("SIGINT", () => {
  console.log("\n[launch] stopping…");
  void emergencyCleanup(new Error("Live browser stopped by SIGINT"), 130);
});
process.on("SIGTERM", () => {
  void emergencyCleanup(new Error("Live browser stopped by SIGTERM"), 143);
});

// --- prepare --------------------------------------------------------------
await maybeWrapWithXvfb();
await mkdir(TEMP_DIR, { recursive: true });
await acquireLauncherLock();
await assertCdpPortAvailable();
await assertProfileNotInUse();
await rm(LAUNCH_PROVENANCE, { force: true });
if (await restoreBundleSwap()) {
  console.log("[launch] recovered a stale canonical extension bundle swap");
}

console.log(`[launch] repo root: ${repoRoot}`);
console.log(`[launch] target:    ${target}`);
console.log(`[launch] extension: ${EXT_DIR}${bundleSourceArgument ? " (canonical staged bundle)" : ""}`);

if (doBuild) {
  console.log("[launch] building unpacked WXT extension (pnpm build)…");
  if (!process.env.UNFLUFFIFY_SOURCEMAP) {
    process.env.UNFLUFFIFY_SOURCEMAP = "true";
  }
  console.log(`[launch] sourcemaps: ${process.env.UNFLUFFIFY_SOURCEMAP}`);
  await run("pnpm", ["build"]);
}
const stagedBundle = bundleSourceArgument ? await stageBundleSource(bundleSourceArgument) : null;
if (stagedBundle) {
  console.log(`[launch] staged ${stagedBundle.sourceRoot} into canonical ${EXT_DIR}`);
}
const launchAttestation = await resolveLaunchAttestation({
  builtCurrentSource: doBuild,
  selectedBundleSource: Boolean(bundleSourceArgument),
});
console.log(`[launch] trusted ${launchAttestation.implementation} bundle inventory ${launchAttestation.inventory.inventoryDigest}`);
/** Chrome re-registers an unpacked extension's service worker when it sees a new
 *  VERSION. Without that it keeps serving the worker it registered for this
 *  profile on a previous run — so a rebuilt background answers with the previous
 *  build's code, and the only tells are a NO_HANDLER on a newly added bus command
 *  or, worse, a command that silently behaves the old way. That cost two
 *  misdiagnoses before it was understood.
 *
 *  Reloading the extension used to paper over this, until the reload started
 *  unloading the extension outright (see the bind script). Bumping the version is
 *  the honest fix: Chrome treats it as an update and re-reads everything from disk,
 *  with nothing to unload and no profile to throw away. The base version is left
 *  alone and a monotonic build counter occupies the fourth component, which the
 *  manifest format allows (four integers, each 0..65535). */
/** Drops ONLY the profile's service-worker registration and script cache.
 *
 *  Chrome keeps serving the worker it registered for a profile, and neither a
 *  version bump nor a fresh browser process reliably dislodges one that is already
 *  registered — measured, not assumed: a rebuilt background answered with the
 *  previous build's code through both. The alternative was throwing the whole
 *  profile away, which also throws away the operator's endpoints, their token and
 *  every property's stored state, and costs them a full re-setup for a code change
 *  they did not make.
 *
 *  The registration lives in `Default/Service Worker/` and the extension's own data
 *  in `Default/IndexedDB/chrome-extension_<id>_0…`. They are separate directories,
 *  so the registration can go while the data stays. ~500KB against ~40MB, and the
 *  operator keeps their session. */
async function dropServiceWorkerRegistration() {
  const swDir = join(PROFILE_DIR, "Default", "Service Worker");
  try {
    await stat(swDir);
  } catch {
    return false;
  }
  await rm(swDir, { recursive: true, force: true });
  return true;
}

async function stampBuildVersion() {
  const manifestPath = join(EXT_DIR, "manifest.json");
  const counterPath = join(TEMP_DIR, "build-counter");
  let originalManifest;
  let manifest;
  try {
    originalManifest = await readFile(manifestPath, "utf8");
    manifest = JSON.parse(originalManifest);
  } catch {
    return null;
  }
  const base = String(manifest.version ?? "0.0.0").split(".").slice(0, 3).join(".");
  const previous = Number.parseInt(await readFile(counterPath, "utf8").catch(() => "0"), 10);
  const counter = (Number.isFinite(previous) ? previous + 1 : 1) % 65536;
  const stamped = `${base}.${counter}`;
  const stampedManifest = JSON.stringify({ ...manifest, version: stamped });
  await mkdir(TEMP_DIR, { recursive: true });
  await writeFile(counterPath, String(counter), "utf8");
  await writeFile(manifestPath, stampedManifest, "utf8");
  manifestStamp = { manifestPath, originalManifest, stampedManifest };
  return stamped;
}

async function restoreStampedManifest() {
  const stamp = manifestStamp;
  manifestStamp = null;
  if (!stamp) return false;

  const currentManifest = await readFile(stamp.manifestPath, "utf8").catch(() => null);
  // Never overwrite a build that completed while the live browser was running.
  if (currentManifest !== stamp.stampedManifest) return false;

  await writeFile(stamp.manifestPath, stamp.originalManifest, "utf8");
  return true;
}

function cleanupLaunchArtifacts() {
  launchCleanupPromise ??= (async () => {
    try {
      await stopActiveCommandChildren();
      await rm(LAUNCH_PROVENANCE, { force: true });
      await restoreStampedManifest();
    } finally {
      try {
        await restoreBundleSwap({ allowCurrentProcess: true });
      } finally {
        activeBrowserStop = null;
        await releaseLauncherLock();
      }
    }
  })();
  return launchCleanupPromise;
}

try {
  await stat(join(EXT_DIR, "manifest.json"));
} catch {
  throw new Error(
    `${EXT_DIR}/manifest.json not found. Run \`pnpm build\` first ` +
      `(or omit --no-build).`,
  );
}

const rawConfig = await readFile(COMMITTED_CONFIG, "utf8");
const config = JSON.parse(rawConfig.replaceAll("__UNFLUFFIFY_REPO_ROOT__", repoRoot));
// Force Playwright's managed Chromium — never the OS browser.
if (config?.browser?.launchOptions) delete config.browser.launchOptions.executablePath;
if (config?.browser?.launchOptions) {
  const args = Array.isArray(config.browser.launchOptions.args)
    ? config.browser.launchOptions.args
    : [];
  config.browser.launchOptions.args = [
    ...args.filter((arg) =>
      typeof arg === "string" &&
      !arg.startsWith("--remote-debugging-port=") &&
      !arg.startsWith("--remote-allow-origins=")
    ),
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-allow-origins=*",
  ];
}
const serializedConfig = JSON.stringify(config, null, 2);
if (serializedConfig.includes("__UNFLUFFIFY_REPO_ROOT__") || serializedConfig.includes("__CHROMIUM_EXECUTABLE_PATH__") ||
    Object.prototype.hasOwnProperty.call(config?.browser?.launchOptions ?? {}, "executablePath")) {
  throw new Error("Temp config still contains a known placeholder or an executablePath; aborting");
}
await writeFile(TEMP_CONFIG, serializedConfig);
console.log(`[launch] wrote ${TEMP_CONFIG}`);

console.log("[launch] ensuring MCP-managed Chromium is installed (idempotent)…");
await run("npx", ["-y", PLAYWRIGHT_MCP_PACKAGE, "install-browser", "chromium"]);

const predictedId = await deterministicExtensionId(EXT_DIR);
console.log(`[launch] deterministic extension id for ${EXT_DIR}: ${predictedId}`);
console.log(`[launch] CDP endpoint: http://127.0.0.1:${CDP_PORT} (for same-browser debug/control)`);

// --- launch the pinned package's managed Chromium + drive over transient CDP
const managedChromiumExecutable = resolveManagedChromiumExecutable();
console.log(`[launch] managed Chromium: ${managedChromiumExecutable}`);
console.log(`[launch] starting npm:${PLAYWRIGHT_MCP_PACKAGE} managed Chromium without a persistent debugger…`);
const launchArgs = Array.isArray(config?.browser?.launchOptions?.args)
  ? config.browser.launchOptions.args
  : [];

// Re-prove both resources immediately before the only profile mutation and
// browser spawn. Installation/building may take long enough for an older
// launcher or a manually opened managed Chromium to appear after preflight.
await assertCdpPortAvailable();
await assertProfileNotInUse();
const droppedWorker = await dropServiceWorkerRegistration();
if (droppedWorker) {
  console.log("[launch] dropped the profile's service-worker registration (extension data kept)");
}

const stampedVersion = await stampBuildVersion();
if (stampedVersion) {
  console.log(`[launch] stamped manifest version ${stampedVersion} so Chrome re-registers the worker`);
} else {
  console.warn("[launch] WARNING: could not stamp the manifest version; a reused profile may serve a stale worker");
}

const browserProcess = spawnManagedChromium(managedChromiumExecutable, launchArgs, "about:blank");
browserProcess.stdout?.on("data", (chunk) => process.stdout.write(chunk));
browserProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));
const browserClosed = new Promise((resolvePromise, rejectPromise) => {
  browserProcess.once("error", rejectPromise);
  browserProcess.once("close", (code, signal) => resolvePromise({ code, signal }));
});
let controlChannel = null;
let stopPromise = null;
let stopping = false;

const stop = () => {
  stopPromise ??= (async () => {
    stopping = true;
    controlChannel?.stop();
    try {
      if (browserProcess.exitCode === null && browserProcess.signalCode === null) {
        browserProcess.kill("SIGTERM");
      }
      await browserClosed.catch(() => undefined);
    } finally {
      await cleanupLaunchArtifacts();
    }
  })();
  return stopPromise;
};
activeBrowserStop = stop;

try {
  const cdpBrowserIdentity = await waitForCdpBrowser(browserProcess);
  const openedTarget = await openCdpTab(target);
  const openedTargetId = String(openedTarget?.id ?? "");
  if (!openedTargetId) throw new Error("CDP did not return an identity for the requested target page");
  const targetInfo = await waitForTargetPage(openedTargetId);
  await closeStartupBlankPages(openedTargetId);
  const finalUrl = String(targetInfo.url);
  console.log(`[launch] page loaded: ${finalUrl}`);

  console.log("[launch] binding popup to the page tab (debugTabId)…");
  await bringCdpPageToFront(targetInfo);
  const bindInfo = await bindPopupWithCdp(targetInfo, finalUrl, predictedId);
  const { extId, tabId, boundUrl } = bindInfo;

  if (extId && tabId && boundUrl) {
    console.log("[launch] opening temporary side-panel helper through the managed browser CDP endpoint…");
    await openCdpTab(boundUrl);
    await waitForCdpTarget(boundUrl);
    // The property lock tracks the bound website tab, not the debug popup. A new
    // popup becomes Chrome's active tab by default and therefore suspends the lock
    // as `tab-hidden`; return focus to the target while retaining CDP control of
    // the hidden popup.
    await bringCdpPageToFront(targetInfo);
    const operatorSurface = await openOperatorSurface(boundUrl, tabId);
    const provenTargetUrl = await evaluateCdpTarget(targetInfo, "location.href", 5_000);
    const provenance = await writeLaunchProvenance({
      launchAttestation,
      cdpBrowserIdentity,
      browserProcess,
      extensionId: extId,
      requestedUrl: target,
      finalUrl: String(provenTargetUrl),
      cdpTargetId: openedTargetId,
      tabId,
    });
    console.log("");
    console.log("================ live test browser ready ================");
    console.log(`  target page : ${finalUrl}`);
    console.log(`  extension id: ${extId} (matches canonical path hash)`);
    console.log(`  browser pid : ${cdpBrowserIdentity.pid} (owned endpoint)`);
    console.log(`  provenance  : ${LAUNCH_PROVENANCE} (${provenance.launchNonce})`);
    console.log(`  page tabId  : ${tabId}`);
    console.log(`  helper popup: ${boundUrl} (closed after side-panel open)`);
    console.log(`  ${operatorSurface.kind.padEnd(12)}: ${operatorSurface.url}`);
    // The banner is evidence of what is actually running, so it must not claim more
    // than the launch can guarantee. A reused profile can still serve a worker from
    // a previous registration; only a fresh one rules that out.
    console.log(`  freshness   : ${bindInfo.refreshed
      ? `${droppedWorker ? "worker registration dropped" : "no prior worker registration"}`
        + `${stampedVersion ? `, version ${stampedVersion}` : ", WARNING: version not stamped"}`
        + `; page reloaded; profile ${PROFILE_EXISTED ? "reused (data kept)" : "new"}`
      : "WARNING: not refreshed; the worker may be running a previous build"}`);
    console.log("=========================================================");
    console.log("Browser is open. Stop with Ctrl-C or `kill <pid>` to close it.");
    controlChannel = makeControlChannel({ extensionId: extId, targetId: openedTargetId });
    controlChannel.start();
  } else {
    console.error("[launch] popup binding did not return the expected result");
    console.error("[launch] the page is loaded; browser left open for inspection.");
  }

  await browserClosed;
} catch (error) {
  if (!stopping) {
    throw error;
  }
} finally {
  controlChannel?.stop();
  if (browserProcess.exitCode === null && browserProcess.signalCode === null) {
    browserProcess.kill("SIGTERM");
    await browserClosed.catch(() => undefined);
  }
  await cleanupLaunchArtifacts();
}
