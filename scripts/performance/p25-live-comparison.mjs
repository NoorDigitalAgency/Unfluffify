#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILD_VARIANTS,
  CANDIDATE_MATRIX,
  IMPLEMENTATIONS,
  LEGACY_DEBUG_UNAVAILABLE,
  P25_LIVE_ARTIFACT_ROOT,
  P25_LIVE_COMPARISON_SCHEMA_VERSION,
  P25_LIVE_SCHEMA_VERSION,
  PINNED_LEGACY_HEAD,
  REQUIRED_LIVE_STAGE_IDS,
  baseManifestVersion,
  createStageExpectation,
  matrixVariantDisposition,
  normalizeLiveUrl,
  resolveCandidateDisposition,
  safeArtifactLabel,
  sha256,
  validateComparisonPair,
  validateComparisonMatrix,
  validateRunAggregate,
  validateRunIdentity,
  validateStageRecord,
} from "./p25/live-comparison-contract.mjs";
import {
  CdpSession,
  ExtensionTrafficGuard,
  PERSISTENT_PUBLICATION_GUARD_SCHEMA_VERSION,
  listLiveTargets,
  readBrowserVersion,
  validatePersistentPublicationGuardEvidence,
} from "./p25/live-cdp.mjs";
import {
  captureCompactFrames,
  captureDocumentIdentity,
  capturePopupState,
  captureScreenshot,
  captureVisualSnapshot,
  performPhysicalShiftExclusion,
  prepareMarkingGestureTarget,
  probeMarkingGestures,
  probeResize,
  probeScrollFade,
  resolveLiveTargets,
  withPopupSession,
  withSiteSession,
} from "./p25/live-probes.mjs";
import {
  captureCandidateSignals,
  captureSiteWorkflowPosture,
  captureWorkflowPopupState,
  createCandidateDispositionRecord,
  measureTrustedProjectionInterval,
  physicalActivatePopupControl,
  physicalActivatePreviewPageTarget,
  physicalActivatePreviewRow,
  popupControlIsActionable,
  popupRecoveryTransitioned,
  proveRequestedRenderMode,
  readableTextsCorrespond,
  silentPosturePass,
  validateCandidateDispositionRecord,
  validateExactMarkingGestureEvidence,
  validateFullWorkflowEvidence,
  viewportPostureMatches,
  waitForWorkflowPopupState,
} from "./p25/workflow-probes.mjs";
import {
  BROWSER_LIVE_BUILD_ATTESTATION_SCHEMA_VERSION,
  BROWSER_LIVE_PROVENANCE_RELATIVE_PATH,
  PINNED_BUILD_COMMAND,
  PINNED_LEGACY_ATTESTATION_SCHEMA_VERSION,
  PINNED_LEGACY_PACKAGE_LOCK_SHA256,
  PINNED_LEGACY_TREE,
  SOURCE_LOCKFILE,
  normalizedBundleInventory,
  pinnedLegacyAttestationFailures,
  validateBrowserLiveProvenance,
} from "./p25/bundle-provenance.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const ARTIFACT_ROOT = resolve(REPO_ROOT, P25_LIVE_ARTIFACT_ROOT);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PUBLICATION_GUARD_HEARTBEAT_MS = 250;
const PUBLICATION_GUARD_STALE_MS = 2_000;
// Product AI authority owns an eight-minute terminal deadline. The live audit
// waits through that boundary plus a small evidence-drain allowance instead of
// misclassifying a legitimate asynchronous backend job as a client hang.
const AI_WORKFLOW_TIMEOUT_MS = 8 * 60_000 + 20_000;
const PINNED_LEGACY_ATTESTATION_PATH = join(REPO_ROOT, "scripts/performance/p25/pinned-legacy-bundle-attestation.json");
const BROWSER_LIVE_PROVENANCE_PATH = join(REPO_ROOT, BROWSER_LIVE_PROVENANCE_RELATIVE_PATH);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else { options[key] = next; index += 1; }
  }
  return { command, options };
}

function required(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${key} is required`);
  return value;
}

function integerOption(options, key, fallback = null) {
  if (options[key] === undefined) return fallback;
  const value = Number(options[key]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${key} must be a non-negative integer`);
  return value;
}

function numberOption(options, key, fallback = null) {
  if (options[key] === undefined) return fallback;
  const value = Number(options[key]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} must be a non-negative number`);
  return value;
}

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonExclusive(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, path);
}

function publicationGuardPaths(runDirectory) {
  const networkDirectory = join(runDirectory, "network");
  return {
    evidence: join(networkDirectory, "publication-guard.json"),
    stop: join(networkDirectory, "publication-guard.stop"),
    log: join(networkDirectory, "publication-guard.log"),
  };
}

function candidateDispositionPath(runDirectory) {
  return join(runDirectory, "candidate-disposition.json");
}

async function readAdoptedCandidateDisposition(runDirectory, identity, document = null) {
  const record = await readJson(candidateDispositionPath(runDirectory));
  const validation = validateCandidateDispositionRecord(record, identity, document);
  if (!validation.pass) throw new Error(`Candidate preflight disposition is invalid: ${validation.failures.join(", ")}`);
  return record;
}

function assertPublicationGuardEvidence(evidence, identity, { requireActive = true } = {}) {
  const validation = validatePersistentPublicationGuardEvidence(evidence, {
    runNonce: identity.runNonce,
    guardNonce: identity.publicationContract.guardNonce,
    extensionId: identity.publicationContract.extensionId,
  }, { requireActive, staleAfterMs: PUBLICATION_GUARD_STALE_MS });
  if (!validation.pass) throw new Error(`Persistent publication guard evidence is invalid: ${validation.failures.join(", ")}`);
  return evidence;
}

async function waitForPublicationGuardEvidence(runDirectory, identity, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 12_000);
  const path = publicationGuardPaths(runDirectory).evidence;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const evidence = assertPublicationGuardEvidence(await readJson(path), identity, { requireActive: options.requireActive !== false });
      const timestampFresh = options.freshAfterMs === undefined || Date.parse(evidence.heartbeatAt) >= options.freshAfterMs;
      const revisionFresh = options.afterRevision === undefined || evidence.revision > options.afterRevision;
      if (timestampFresh && revisionFresh) return evidence;
      lastError = new Error(`Publication guard snapshot is not newer than the requested boundary: heartbeat=${evidence.heartbeatAt}, revision=${evidence.revision}, afterRevision=${options.afterRevision ?? "n/a"}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Persistent publication guard did not produce coherent evidence: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

class PersistentPublicationGuardClient {
  constructor(runDirectory, identity, evidence) {
    this.runDirectory = runDirectory;
    this.identity = identity;
    this.current = evidence;
  }

  static async connect(runDirectory, identity) {
    return new PersistentPublicationGuardClient(
      runDirectory,
      identity,
      await waitForPublicationGuardEvidence(runDirectory, identity),
    );
  }

  async refresh(options = {}) {
    this.current = await waitForPublicationGuardEvidence(this.runDirectory, this.identity, {
      afterRevision: this.current.revision,
      ...options,
    });
    return this.current;
  }

  markNetworkBoundary() {
    return { at: Date.now(), sequence: this.current.sequence, entryIndex: this.current.entries.length };
  }

  evidenceSince(boundary) {
    return this.current.entries.slice(boundary.entryIndex);
  }

  evidence() {
    return this.current.entries;
  }

  publicationFenceEvidence() {
    return Object.fromEntries(Object.entries(this.current).filter(([key]) => !["entries", "legacyLoad"].includes(key)));
  }

  legacyLoadEvidence() {
    return this.current.legacyLoad;
  }
}

async function bundleIdentity(bundleRoot) {
  const root = await realpath(resolve(REPO_ROOT, bundleRoot));
  const inventory = await normalizedBundleInventory(root);
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  if (!files.length) throw new Error(`Bundle root is empty: ${root}`);
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of files) {
    const content = await readFile(path);
    const name = relative(root, path).replaceAll("\\", "/");
    hash.update(`${name}\0${content.length}\0`);
    hash.update(content);
    bytes += content.length;
  }
  const manifest = await readJson(join(root, "manifest.json"));
  return {
    root,
    rootDigest: sha256(root),
    sha256: hash.digest("hex"),
    fileCount: files.length,
    bytes,
    manifestVersion: manifest.version ?? null,
    manifestName: manifest.name ?? null,
    inventorySchemaVersion: inventory.schemaVersion,
    inventoryNormalization: inventory.normalization,
    inventoryDigest: inventory.inventoryDigest,
    normalizedManifestVersion: inventory.normalizedManifestVersion,
    normalizedBytes: inventory.bytes,
  };
}

async function sourceIdentity(sourceHead) {
  const workspaceHead = git(["rev-parse", "HEAD"]);
  const rawStatus = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const packageLockSha256 = sourceHead === PINNED_LEGACY_HEAD
    ? PINNED_LEGACY_PACKAGE_LOCK_SHA256
    : sha256(await readFile(join(REPO_ROOT, SOURCE_LOCKFILE)));
  return {
    head: sourceHead,
    tree: git(["rev-parse", `${sourceHead}^{tree}`]),
    workspaceHead,
    dirty: rawStatus.length > 0,
    clean: rawStatus.length === 0,
    statusDigest: sha256(rawStatus),
    statusLineCount: rawStatus ? rawStatus.split("\n").length : 0,
    lockfile: SOURCE_LOCKFILE,
    packageLockSha256,
    buildCommand: PINNED_BUILD_COMMAND,
  };
}

async function browserAndProfileIdentity(endpoint, profileRoot) {
  const [version, profilePath] = await Promise.all([
    readBrowserVersion(endpoint),
    realpath(resolve(REPO_ROOT, profileRoot)),
  ]);
  const browser = await new CdpSession({ type: "browser", id: "browser", url: "", webSocketDebuggerUrl: version.webSocketDebuggerUrl }).connect();
  let commandLine;
  try {
    commandLine = await browser.send("Browser.getBrowserCommandLine");
  } finally {
    browser.close();
  }
  const userDataArgument = (commandLine?.arguments ?? []).find((argument) => argument.startsWith("--user-data-dir="));
  if (!userDataArgument) throw new Error("Managed Chromium command line does not expose --user-data-dir");
  const observedProfilePath = await realpath(userDataArgument.slice("--user-data-dir=".length));
  if (observedProfilePath !== profilePath) {
    throw new Error(`Live browser profile mismatch: expected ${profilePath}, observed ${observedProfilePath}`);
  }
  const pathDigest = sha256(profilePath);
  return {
    browser: {
      fingerprint: sha256(JSON.stringify({
        browser: version.Browser,
        protocolVersion: version["Protocol-Version"],
        userAgent: version["User-Agent"],
        v8Version: version["V8-Version"],
      })),
      instanceNonce: sha256(version.webSocketDebuggerUrl).slice(0, 32),
      product: version.Browser ?? null,
      protocolVersion: version["Protocol-Version"] ?? null,
      userAgent: version["User-Agent"] ?? null,
      commandLineDigest: sha256(JSON.stringify(commandLine?.arguments ?? [])),
    },
    profile: {
      fingerprint: sha256(JSON.stringify({ pathDigest, launcher: "pnpm browser:live", managed: true })),
      pathDigest,
      root: profilePath,
      name: basename(profilePath),
      launcherOwned: true,
    },
  };
}

async function currentIdentityInputs({ endpoint, profileRoot, bundleRoot, sourceHead }) {
  const [source, buildBundle, runtime] = await Promise.all([
    sourceIdentity(sourceHead),
    bundleIdentity(bundleRoot),
    browserAndProfileIdentity(endpoint, profileRoot),
  ]);
  return { source, bundle: buildBundle, ...runtime };
}

function compareIdentity(expected, actual) {
  const mismatches = [];
  const compare = (id, left, right) => { if (JSON.stringify(left) !== JSON.stringify(right)) mismatches.push({ id, expected: left, actual: right }); };
  compare("source-head", expected.build.source.head, actual.source.head);
  compare("source-tree", expected.build.source.tree, actual.source.tree);
  compare("workspace-head", expected.build.source.workspaceHead, actual.source.workspaceHead);
  compare("source-dirty", expected.build.source.dirty, actual.source.dirty);
  compare("source-status-digest", expected.build.source.statusDigest, actual.source.statusDigest);
  compare("source-package-lock", expected.build.source.packageLockSha256, actual.source.packageLockSha256);
  compare("bundle-root", expected.build.bundle.root, actual.bundle.root);
  compare("bundle-digest", expected.build.bundle.sha256, actual.bundle.sha256);
  compare("bundle-inventory-digest", expected.build.bundle.inventoryDigest, actual.bundle.inventoryDigest);
  compare("browser-fingerprint", expected.browser.fingerprint, actual.browser.fingerprint);
  compare("browser-instance", expected.browser.instanceNonce, actual.browser.instanceNonce);
  compare("profile-fingerprint", expected.profile.fingerprint, actual.profile.fingerprint);
  return mismatches;
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

function boundPopupTabId(popupTarget) {
  try {
    const value = new URL(popupTarget?.url ?? "").searchParams.get("debugTabId");
    return value !== null && /^\d+$/.test(value) ? Number(value) : null;
  } catch {
    return null;
  }
}

async function extensionBoundTab(popupTarget) {
  const declaredTabId = boundPopupTabId(popupTarget);
  return withPopupSession(popupTarget, (session) => session.evaluate(`(() => new Promise((resolve) => {
    const finish = (tab) => resolve(tab ? { id: tab.id ?? null, url: tab.url ?? null } : null);
    ${declaredTabId === null
      ? "chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => finish(tabs?.[0] ?? null));"
      : `chrome.tabs.get(${declaredTabId}, (tab) => finish(chrome.runtime.lastError ? null : tab));`}
  }))()`, { awaitPromise: true }));
}

async function assertTrustedLaunchProvenance({ implementation, expectedUrl, endpoint, resolvedTargets, inputs }) {
  if (inputs.source.clean !== true) {
    throw new Error("P25 live evidence requires a clean current source set before begin");
  }
  const canonicalRoot = await realpath(join(REPO_ROOT, ".output/chrome-mv3"));
  if (inputs.bundle.root !== canonicalRoot) {
    throw new Error(`P25 requires the launcher-owned canonical bundle root ${canonicalRoot}; observed ${inputs.bundle.root}`);
  }
  const pinnedAttestation = await readJson(PINNED_LEGACY_ATTESTATION_PATH);
  if (implementation === "legacy") {
    const inventory = {
      schemaVersion: inputs.bundle.inventorySchemaVersion,
      normalization: inputs.bundle.inventoryNormalization,
      inventoryDigest: inputs.bundle.inventoryDigest,
      normalizedManifestVersion: inputs.bundle.normalizedManifestVersion,
      fileCount: inputs.bundle.fileCount,
      bytes: inputs.bundle.normalizedBytes,
    };
    const failures = pinnedLegacyAttestationFailures(pinnedAttestation, inventory);
    if (failures.length) throw new Error(`Pinned legacy bundle attestation failed: ${failures.join(", ")}`);
  }

  const [provenance, provenanceFile] = await Promise.all([
    readJson(BROWSER_LIVE_PROVENANCE_PATH),
    stat(BROWSER_LIVE_PROVENANCE_PATH),
  ]);
  const boundTab = await extensionBoundTab(resolvedTargets.popup);
  if (!Number.isInteger(boundTab?.id) || normalizeLiveUrl(boundTab?.url ?? "") !== normalizeLiveUrl(resolvedTargets.site.url)) {
    throw new Error(`Extension operator surface is not bound to the exact P25 site target: ${JSON.stringify(boundTab)}`);
  }
  const endpointUrl = new URL(endpoint);
  const source = implementation === "legacy" ? {
    head: PINNED_LEGACY_HEAD,
    tree: PINNED_LEGACY_TREE,
    clean: true,
    statusDigest: sha256(""),
    lockfile: SOURCE_LOCKFILE,
    packageLockSha256: PINNED_LEGACY_PACKAGE_LOCK_SHA256,
    buildCommand: PINNED_BUILD_COMMAND,
    attestationSchema: PINNED_LEGACY_ATTESTATION_SCHEMA_VERSION,
  } : {
    head: inputs.source.head,
    tree: inputs.source.tree,
    clean: inputs.source.clean,
    statusDigest: inputs.source.statusDigest,
    lockfile: inputs.source.lockfile,
    packageLockSha256: inputs.source.packageLockSha256,
    buildCommand: inputs.source.buildCommand,
    attestationSchema: BROWSER_LIVE_BUILD_ATTESTATION_SCHEMA_VERSION,
  };
  const observed = {
    implementation,
    source,
    bundle: {
      canonicalRoot,
      inventoryDigest: inputs.bundle.inventoryDigest,
      fileCount: inputs.bundle.fileCount,
      bytes: inputs.bundle.normalizedBytes,
      manifestVersion: inputs.bundle.manifestVersion,
      normalizedManifestVersion: inputs.bundle.normalizedManifestVersion,
    },
    browser: {
      instanceNonce: inputs.browser.instanceNonce,
      fingerprint: inputs.browser.fingerprint,
      product: inputs.browser.product,
      cdpPort: Number(endpointUrl.port || (endpointUrl.protocol === "https:" ? 443 : 80)),
    },
    profile: { root: inputs.profile.root, pathDigest: inputs.profile.pathDigest },
    extensionId: resolvedTargets.extensionId,
    target: {
      requestedUrl: expectedUrl,
      normalizedUrl: normalizeLiveUrl(resolvedTargets.site.url),
      cdpTargetId: resolvedTargets.site.id,
      tabId: boundTab.id,
    },
  };
  const validation = validateBrowserLiveProvenance(provenance, observed, {
    fileMtimeMs: provenanceFile.mtimeMs,
    pidAlive: processAlive(provenance?.browser?.pid),
  });
  if (!validation.pass) throw new Error(`Browser-live provenance does not authorize this P25 run: ${validation.failures.join(", ")}`);
  return {
    schemaVersion: provenance.schemaVersion,
    launchNonce: provenance.launchNonce,
    createdAt: provenance.createdAt,
    sha256: sha256(JSON.stringify(provenance)),
    path: BROWSER_LIVE_PROVENANCE_PATH,
  };
}

async function beginRun(options) {
  const implementation = required(options, "implementation");
  if (!IMPLEMENTATIONS.includes(implementation)) throw new Error(`--implementation must be ${IMPLEMENTATIONS.join(" or ")}`);
  const label = safeArtifactLabel(required(options, "label"));
  const expectedUrl = required(options, "url");
  const buildVariant = required(options, "build-variant");
  if (!BUILD_VARIANTS.includes(buildVariant)) throw new Error(`--build-variant must be ${BUILD_VARIANTS.join(" or ")}`);
  const endpoint = typeof options.endpoint === "string" ? options.endpoint : "http://127.0.0.1:9222";
  const bundleRoot = typeof options["bundle-root"] === "string" ? options["bundle-root"] : ".output/chrome-mv3";
  const profileRoot = typeof options["profile-root"] === "string" ? options["profile-root"] : ".wxt/browser-profile";
  const authoritativeSourceHead = implementation === "legacy" ? PINNED_LEGACY_HEAD : git(["rev-parse", "HEAD"]);
  const sourceHead = typeof options["source-head"] === "string" ? options["source-head"] : authoritativeSourceHead;
  if (!/^[a-f0-9]{40}$/.test(sourceHead)) throw new Error("--source-head must be an exact 40-character git commit");
  if (sourceHead !== authoritativeSourceHead) throw new Error(`--source-head cannot override the authoritative ${implementation} source ${authoritativeSourceHead}`);
  // Runtime eligibility is never an operator assertion. The immutable manifest
  // retains only the matrix declaration; preflight later adopts live facts.
  const candidateDisposition = resolveCandidateDisposition({ label, url: expectedUrl, runtimeEligibility: "unavailable" });
  const matrixCandidate = CANDIDATE_MATRIX.find((candidate) => candidate.label === label);
  if (!matrixCandidate) throw new Error(`Unknown P25 candidate label: ${label}`);
  const targets = await listLiveTargets(endpoint);
  const resolvedTargets = resolveLiveTargets(targets, expectedUrl);
  const inputs = await currentIdentityInputs({ endpoint, profileRoot, bundleRoot, sourceHead });
  const launchProvenance = await assertTrustedLaunchProvenance({ implementation, expectedUrl, endpoint, resolvedTargets, inputs });
  if (implementation === "legacy" && inputs.bundle.manifestVersion && baseManifestVersion(inputs.bundle.manifestVersion) !== "1.10.0") {
    throw new Error(`Pinned legacy must load manifest version 1.10.0; observed ${inputs.bundle.manifestVersion}`);
  }
  if (implementation === "rewrite" && inputs.bundle.manifestVersion && baseManifestVersion(inputs.bundle.manifestVersion) !== "2.0.0") {
    throw new Error(`Rewrite must load manifest version 2.0.0; observed ${inputs.bundle.manifestVersion}`);
  }
  if (implementation === "legacy" && buildVariant === "debug") {
    throw new Error(`${LEGACY_DEBUG_UNAVAILABLE.reasonCode}: ${LEGACY_DEBUG_UNAVAILABLE.reason}`);
  }
  const runNonce = randomUUID();
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const runDirectory = join(ARTIFACT_ROOT, "runs", `${timestamp}-${runNonce.slice(0, 8)}-${implementation}-${label}`);
  await mkdir(join(ARTIFACT_ROOT, "runs"), { recursive: true });
  await mkdir(runDirectory, { recursive: false });
  await Promise.all([
    mkdir(join(runDirectory, "stages")),
    mkdir(join(runDirectory, "frames")),
    mkdir(join(runDirectory, "network")),
    mkdir(join(runDirectory, "screenshots")),
  ]);
  const legacyEnvironmentKey = implementation === "legacy"
    ? (typeof options["legacy-environment-key"] === "string" ? options["legacy-environment-key"] : "a.lynxdev.se")
    : null;
  const identity = {
    schemaVersion: P25_LIVE_SCHEMA_VERSION,
    runNonce,
    createdAt,
    label,
    expectedUrl,
    normalizedUrl: normalizeLiveUrl(expectedUrl),
    implementation,
    endpoint,
    build: { variant: buildVariant, source: inputs.source, bundle: inputs.bundle },
    browser: inputs.browser,
    profile: inputs.profile,
    launchProvenance,
    candidateDisposition,
    declaredCandidateDisposition: {
      ...candidateDisposition,
      matrixEligibility: matrixCandidate.eligibility,
    },
    publicationContract: {
      finalPublishForbidden: true,
      fenceRequiredBeforeActivation: true,
      zeroAttemptsRequired: true,
      route: "/publish",
      extensionId: resolvedTargets.extensionId,
      guardNonce: randomUUID(),
    },
    legacyLoadCompatibility: implementation === "legacy"
      ? { policy: "installed-before-activation", environmentKey: legacyEnvironmentKey }
      : { policy: "not-applicable", environmentKey: null },
  };
  const validation = validateRunIdentity(identity);
  if (!validation.pass) throw new Error(`Run identity is invalid: ${JSON.stringify(validation.checks.filter((check) => !check.pass))}`);
  await writeJsonExclusive(join(runDirectory, "manifest.json"), identity);
  await startPersistentPublicationGuard(runDirectory, identity);
  process.stdout.write(`${JSON.stringify({ runDirectory, identity, validation }, null, 2)}\n`);
}

async function loadRun(runOption) {
  const runDirectory = resolve(REPO_ROOT, runOption);
  const identity = await readJson(join(runDirectory, "manifest.json"));
  const validation = validateRunIdentity(identity);
  if (!validation.pass) throw new Error(`Run manifest is invalid: ${JSON.stringify(validation.checks.filter((check) => !check.pass))}`);
  if (!runDirectory.startsWith(`${ARTIFACT_ROOT}/`)) throw new Error(`Run directory must be below ${ARTIFACT_ROOT}`);
  return { runDirectory, identity };
}

async function startPersistentPublicationGuard(runDirectory, identity) {
  const paths = publicationGuardPaths(runDirectory);
  const logDescriptor = openSync(paths.log, "ax");
  let child;
  try {
    child = spawn(process.execPath, [SCRIPT_PATH, "guard-daemon", "--run", runDirectory], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", logDescriptor, logDescriptor],
    });
    child.unref();
  } finally {
    closeSync(logDescriptor);
  }
  try {
    return await waitForPublicationGuardEvidence(runDirectory, identity, { timeoutMs: 15_000 });
  } catch (error) {
    child?.kill("SIGTERM");
    throw error;
  }
}

async function runPublicationGuardDaemon(options) {
  const { runDirectory, identity } = await loadRun(required(options, "run"));
  const paths = publicationGuardPaths(runDirectory);
  let active = true;
  let stoppedAt = null;
  let heartbeatAt = new Date().toISOString();
  let persistenceError = null;
  let persistTail = Promise.resolve();
  let revision = 0;
  let guard = null;
  let coverageLost = false;
  const snapshot = () => {
    const fence = guard?.publicationFenceEvidence() ?? {};
    return {
      schemaVersion: PERSISTENT_PUBLICATION_GUARD_SCHEMA_VERSION,
      runNonce: identity.runNonce,
      guardNonce: identity.publicationContract.guardNonce,
      pid: process.pid,
      heartbeatAt,
      revision,
      active,
      stoppedAt,
      sequence: guard?.sequence ?? 0,
      entries: guard?.evidence() ?? [],
      legacyLoad: guard?.legacyLoadEvidence() ?? { installedBeforeActivation: false, patchCount: 0, patches: [] },
      ...fence,
    };
  };
  const persist = () => {
    persistTail = persistTail.then(() => {
      revision += 1;
      return writeJsonAtomic(paths.evidence, snapshot());
    }).catch((error) => {
      persistenceError = error;
    });
    return persistTail;
  };
  const requestStop = () => { active = false; };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    guard = new ExtensionTrafficGuard({
      implementation: identity.implementation,
      legacyEnvironmentKey: identity.legacyLoadCompatibility.environmentKey,
      extensionId: identity.publicationContract.extensionId,
      onEvidenceChange: persist,
      onCoverageLost: () => {
        coverageLost = true;
        active = false;
      },
    });
    await guard.installDynamic(identity.endpoint);
    heartbeatAt = new Date().toISOString();
    await persist();
    const expiresAt = Date.now() + 12 * 60 * 60 * 1_000;
    while (active) {
      if (persistenceError) throw persistenceError;
      if (Date.now() >= expiresAt) throw new Error("Persistent publication guard exceeded its 12-hour safety lifetime");
      const stop = await readJson(paths.stop).catch(() => null);
      if (stop) {
        if (stop.runNonce !== identity.runNonce || stop.guardNonce !== identity.publicationContract.guardNonce) {
          throw new Error("Persistent publication guard received a stop request for a different run");
        }
        active = false;
        break;
      }
      heartbeatAt = new Date().toISOString();
      await persist();
      await new Promise((resolve) => setTimeout(resolve, PUBLICATION_GUARD_HEARTBEAT_MS));
    }
    if (coverageLost) throw new Error("Browser-level dynamic publication coverage was lost");
  } catch (error) {
    guard?.recordError(`Persistent publication guard failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    active = false;
    await guard?.close().catch((error) => {
      guard?.recordError(`Persistent publication guard cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    stoppedAt = new Date().toISOString();
    heartbeatAt = stoppedAt;
    await persist();
    await persistTail;
  }
}

async function stopPersistentPublicationGuard(runDirectory, identity) {
  const paths = publicationGuardPaths(runDirectory);
  const request = {
    schemaVersion: "p25-live-publication-guard-stop/v1",
    runNonce: identity.runNonce,
    guardNonce: identity.publicationContract.guardNonce,
    requestedAt: new Date().toISOString(),
  };
  try {
    await writeJsonExclusive(paths.stop, request);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readJson(paths.stop);
    if (existing.runNonce !== request.runNonce || existing.guardNonce !== request.guardNonce) {
      throw new Error("Existing publication guard stop request belongs to another run", { cause: error });
    }
  }
  const deadline = Date.now() + 12_000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = assertPublicationGuardEvidence(await readJson(paths.evidence), identity, { requireActive: false });
      if (last.active === false && last.stoppedAt) return last;
    } catch {
      last = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Persistent publication guard did not stop cleanly; last evidence=${JSON.stringify(last)}`);
}

async function readStageRecords(runDirectory, identity = null) {
  const root = join(runDirectory, "stages");
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const records = [];
  for (const directory of directories) {
    const path = join(root, directory, "stage.json");
    try {
      const record = await readJson(path);
      records.push({ directory, path, record, file: await stat(path) });
    } catch (error) {
      if (error?.code !== "ENOENT" || !identity) throw error;
      const match = /^(\d+)-(.+)-([0-9a-f]{8})$/.exec(directory);
      if (!match) throw error;
      const file = await stat(join(root, directory));
      const [, sequenceRaw, id, noncePrefix] = match;
      const stageNonce = `${noncePrefix}-0000-4000-8000-000000000000`;
      const expectation = createStageExpectation({
        runIdentity: identity,
        id,
        sequence: Number(sequenceRaw),
        stageNonce,
        documentKey: null,
        renderMode: null,
      });
      const interruptedAt = new Date(file.mtimeMs).toISOString();
      records.push({
        directory,
        path,
        file,
        record: {
          ...expectation,
          startedAt: interruptedAt,
          finishedAt: interruptedAt,
          status: "failed",
          exitCode: 1,
          observedProcessExitCode: 1,
          documentFingerprint: null,
          document: null,
          screenshots: {},
          networkArtifacts: {},
          data: null,
          error: "Stage process ended before stage.json was committed; treated as interrupted and failed.",
          interrupted: true,
        },
      });
    }
  }
  return records;
}

async function captureStageScreenshots({ site, popup, runDirectory, id }) {
  const sitePath = join(runDirectory, "screenshots", `${id}-site.png`);
  const popupPath = join(runDirectory, "screenshots", `${id}-popup.png`);
  const [siteShot, popupShot] = await Promise.all([
    withSiteSession(site, (session) => captureScreenshot(session, sitePath)),
    withPopupSession(popup, (session) => captureScreenshot(session, popupPath)),
  ]);
  return { site: siteShot, popup: popupShot };
}

async function waitForPopupToggle(popup, expectedChecked, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let last = null;
  const timeline = [];
  let lastFingerprint = "";
  while (Date.now() < deadline) {
    last = await capturePopupState(popup);
    const toggle = last.controls.find((control) => control.id === "toggle-enabled");
    const sample = {
      offsetMs: Date.now() - startedAt,
      checked: toggle?.checked ?? null,
      disabled: toggle?.disabled ?? null,
      popupBusy: last.busy,
      temporarilyDisabled: last.temporarilyDisabled,
      curtainText: last.curtainText,
      toast: last.toast,
    };
    const fingerprint = JSON.stringify({ ...sample, offsetMs: 0 });
    if (fingerprint !== lastFingerprint) {
      timeline.push(sample);
      lastFingerprint = fingerprint;
    }
    if (toggle?.checked === expectedChecked && toggle.disabled === false && last.busy === false) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for marking toggle=${expectedChecked}; evidence=${JSON.stringify({ timeline, last })}`);
}

async function waitForPopupRefreshTerminal(popup, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let sawBusy = false;
  let last = null;
  const timeline = [];
  let lastFingerprint = "";
  let stableIdleSamples = 0;
  while (Date.now() < deadline) {
    last = await capturePopupState(popup);
    const refresh = last.controls.find((control) => control.id === "lock-refresh");
    const busy = refresh?.disabled === true || refresh?.ariaBusy === true;
    sawBusy ||= busy;
    const sample = {
      offsetMs: Date.now() - startedAt,
      disabled: refresh?.disabled ?? null,
      ariaBusy: refresh?.ariaBusy ?? null,
      popupBusy: last.busy,
      toast: last.toast,
    };
    const fingerprint = JSON.stringify({ ...sample, offsetMs: 0 });
    if (fingerprint !== lastFingerprint) {
      timeline.push(sample);
      lastFingerprint = fingerprint;
    }
    const terminalIdle = !busy && last.busy === false && refresh?.disabled === false;
    stableIdleSamples = terminalIdle ? stableIdleSamples + 1 : 0;
    if (sawBusy && terminalIdle) {
      return { state: last, timeline, sawBusy, terminalKind: "busy-to-idle" };
    }
    // A cached/no-op authority refresh can complete between the trusted click
    // acknowledgement and the first CDP sample. Accept only a stable, enabled
    // idle terminal; the stage's independently captured extension traffic and
    // marking activation still prove that the physical workflow proceeded.
    if (stableIdleSamples >= 3 && Date.now() - startedAt >= 100) {
      return { state: last, timeline, sawBusy, terminalKind: "stable-idle-fast-terminal" };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for explicit Refresh to terminalize; evidence=${JSON.stringify({ sawBusy, timeline, last })}`);
}

async function capturePopupAiFeedback(popup) {
  return await popup.evaluate(`(() => {
    const compute = document.querySelector('#compute');
    const spinner = document.querySelector('[role="status"], .spinner, .activity');
    const busyCurtain = document.querySelector('[data-transient-surface="popup-busy-curtain"]');
    const busyCurtainRect = busyCurtain?.getBoundingClientRect();
    const busyCurtainStyle = busyCurtain ? getComputedStyle(busyCurtain) : null;
    const busyCurtainVisible = Boolean(busyCurtain && !busyCurtain.hidden &&
      busyCurtainStyle?.display !== 'none' && busyCurtainStyle?.visibility !== 'hidden' &&
      Number(busyCurtainStyle?.opacity || '1') > 0 &&
      Number(busyCurtainRect?.width || 0) > 0 && Number(busyCurtainRect?.height || 0) > 0);
    return {
      capturedAtEpochMs: Date.now(),
      busy: busyCurtainVisible,
      computeDisabled: compute instanceof HTMLButtonElement ? compute.disabled : null,
      computeAriaBusy: compute?.getAttribute('aria-busy') === 'true',
      spinnerText: spinner?.textContent?.trim() ?? null,
    };
  })()`);
}

async function waitForSiteWorkflowPosture(target, predicate, timeoutMs) {
  return await withSiteSession(target, async (session) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        last = await captureSiteWorkflowPosture(session);
        lastError = null;
        if (predicate(last)) return last;
      } catch (error) {
        // An emulation change may reload the document between CDP evaluations.
        // Keep the tab session and wait for its replacement execution context.
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Site workflow posture did not terminalize: ${JSON.stringify({ last, lastError })}`);
  });
}

function viewportMatches(posture, width, height) {
  return viewportPostureMatches(posture, width, height);
}

async function runRenderInspection(popup, { implementation, renderMode, timeoutMs }) {
  const proveMode = (state, mode) => proveRequestedRenderMode(state, mode, {
    requireInspectionLifecycle: implementation === "rewrite",
  });
  const controlId = implementation === "legacy"
    ? renderMode === "with-javascript" ? "render-mode-inspect-with-javascript" : "render-mode-inspect-without-javascript"
    : renderMode === "with-javascript" ? "render-mode-with-js" : "render-mode-without-js";
  let before = await capturePopupState(popup);
  let control = before.controls.find((candidate) => candidate.id === controlId);
  const activationOptions = implementation === "legacy"
    ? { hitTargetTimeoutMs: timeoutMs, pollIntervalMs: 100 }
    : undefined;
  let preconditionSwitch = null;
  if (!control || control.visible === false) {
    const openerId = implementation === "legacy" ? "render-mode-open-view" : "render-mode-open";
    const toggleId = implementation === "legacy" ? "config-toggle" : "header-kebab-toggle";
    let opener = before.controls.find((candidate) => candidate.id === openerId);
    if (!opener || opener.visible === false) {
      let toggle = before.controls.find((candidate) => candidate.id === toggleId);
      // The pinned legacy popup mounts its header before the authority-backed
      // configuration control. A fresh copied profile can therefore complete
      // preflight while #config-toggle is still absent for several seconds.
      // Wait for the real visible control instead of misclassifying that mount
      // window as a missing legacy capability.
      const toggleDeadline = Date.now() + Math.min(timeoutMs, 10_000);
      while (
        (!toggle || toggle.disabled || toggle.visible === false) &&
        Date.now() < toggleDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        before = await capturePopupState(popup);
        toggle = before.controls.find((candidate) => candidate.id === toggleId);
      }
      if (!toggle || toggle.disabled || toggle.visible === false) {
        throw new Error(`Render Inspection menu toggle #${toggleId} is unavailable: ${JSON.stringify(toggle)}`);
      }
      await physicalActivatePopupControl(popup, toggleId, "pointer", null, activationOptions);
      const openerDeadline = Date.now() + Math.min(timeoutMs, 10_000);
      while (Date.now() < openerDeadline) {
        before = await capturePopupState(popup);
        opener = before.controls.find((candidate) => candidate.id === openerId);
        if (opener && !opener.disabled && opener.visible !== false) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!opener || opener.disabled || opener.visible === false) {
      throw new Error(`Render Inspection opener #${openerId} is unavailable: ${JSON.stringify(opener)}`);
    }
    await physicalActivatePopupControl(popup, openerId, "pointer", null, activationOptions);
    const viewDeadline = Date.now() + Math.min(timeoutMs, 10_000);
    while (Date.now() < viewDeadline) {
      before = await capturePopupState(popup);
      control = before.controls.find((candidate) => candidate.id === controlId);
      const proof = proveMode(before, renderMode);
      if (control && control.visible !== false && (!control.disabled || (before.busy === false && proof.modeProven))) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  let settledProof = proveMode(before, renderMode);
  if (
    implementation === "rewrite" &&
    control?.disabled &&
    before.busy === false &&
    !settledProof.modeProven
  ) {
    const requestedReadyDeadline = Date.now() + Math.min(timeoutMs, 10_000);
    while (control?.disabled && Date.now() < requestedReadyDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      before = await capturePopupState(popup);
      control = before.controls.find((candidate) => candidate.id === controlId);
      settledProof = proveMode(before, renderMode);
      if (!control || control.visible === false || before.busy === true) continue;
      if (!control.disabled || settledProof.modeProven) break;
    }
  }
  if (control?.disabled && before.busy === false && settledProof.modeProven) {
    const alternateMode = renderMode === "with-javascript" ? "without-javascript" : "with-javascript";
    const alternateId = implementation === "legacy"
      ? alternateMode === "with-javascript" ? "render-mode-inspect-with-javascript" : "render-mode-inspect-without-javascript"
      : alternateMode === "with-javascript" ? "render-mode-with-js" : "render-mode-without-js";
    let alternate = before.controls.find((candidate) => candidate.id === alternateId);
    const alternateReadyDeadline = Date.now() + Math.min(timeoutMs, 10_000);
    while (
      implementation === "rewrite" &&
      (!alternate || alternate.disabled || alternate.visible === false) &&
      Date.now() < alternateReadyDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      before = await capturePopupState(popup);
      alternate = before.controls.find((candidate) => candidate.id === alternateId);
    }
    if (!alternate || alternate.disabled || alternate.visible === false) {
      throw new Error(`Cannot switch away from the already-selected ${renderMode} mode: ${JSON.stringify(alternate)}`);
    }
    const preconditionStartedAt = new Date().toISOString();
    const activation = await physicalActivatePopupControl(popup, alternateId, "pointer", null, activationOptions);
    const preconditionDeadline = Date.now() + timeoutMs;
    let last = before;
    while (Date.now() < preconditionDeadline) {
      last = await capturePopupState(popup);
      const requestedControl = last.controls.find((candidate) => candidate.id === controlId);
      const proof = proveMode(last, alternateMode);
      if (last.busy === false && requestedControl && !requestedControl.disabled && requestedControl.visible !== false && proof.modeProven) {
        preconditionSwitch = {
          requestedMode: alternateMode,
          controlId: alternateId,
          activation,
          startedAt: preconditionStartedAt,
          finishedAt: new Date().toISOString(),
          terminal: true,
          modeProven: true,
          proofSource: proof.proofSource,
          before,
          after: last,
        };
        before = last;
        control = requestedControl;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!preconditionSwitch) {
      throw new Error(`Timed out switching away from the already-selected ${renderMode} mode; last=${JSON.stringify(last)}`);
    }
  }
  if (!control || control.disabled) {
    throw new Error(`Render Inspection control #${controlId} is unavailable: ${JSON.stringify({ control, state: before })}`);
  }
  const startedAt = new Date().toISOString();
  const initialInspectionView = before.renderInspectionView;
  const controlActivation = await physicalActivatePopupControl(popup, controlId, "pointer", null, activationOptions);
  const deadline = Date.now() + timeoutMs;
  let sawBusy = false;
  let sawControlDisabled = false;
  let last = before;
  while (Date.now() < deadline) {
    last = await capturePopupState(popup);
    const currentControl = last.controls.find((candidate) => candidate.id === controlId);
    sawBusy ||= last.busy === true;
    sawControlDisabled ||= currentControl?.disabled === true;
    const transitionObserved = sawBusy || sawControlDisabled || (
      last.renderInspectionView === renderMode && initialInspectionView !== renderMode
    );
    const terminalControlSettled = implementation === "legacy"
      ? currentControl?.visible !== false
      : currentControl?.disabled === false;
    const terminal = transitionObserved && last.busy === false && terminalControlSettled;
    const { modeProven, proofSource } = proveMode(last, renderMode);
    if (terminal && modeProven) {
      return {
        requestedMode: renderMode,
        controlId,
        clicked: true,
        controlActivation,
        preconditionSwitch,
        startedAt,
        finishedAt: new Date().toISOString(),
        sawBusy,
        sawControlDisabled,
        initialInspectionView,
        modeProven,
        proofSource,
        terminal: true,
        before,
        after: last,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${renderMode} Render Inspection; last=${JSON.stringify(last)}`);
}

async function ensurePopupSessionView(popup, implementation, timeoutMs = 30_000) {
  const exitIds = implementation === "legacy"
    ? ["render-mode-edit", "render-mode-cancel"]
    : ["render-mode-cancel"];
  const deadline = Date.now() + timeoutMs;
  let state = await capturePopupState(popup);
  while (Date.now() < deadline) {
    const toggle = state.controls.find((control) => control.id === "toggle-enabled");
    if (toggle && !toggle.disabled && toggle.visible !== false && state.busy === false) return state;

    // The two immutable comparison stages intentionally finish on the second
    // inspection mode. If the retained render choice is the other mode, the
    // product correctly refuses Cancel until that retained choice has a current
    // document/generation proof. Re-prove it through the real inspection
    // control before attempting to leave the view.
    if (
      implementation === "rewrite" &&
      state.view === "render-mode" &&
      state.renderChoice &&
      state.renderInspectionView !== state.renderChoice
    ) {
      try {
        await runRenderInspection(popup, {
          implementation,
          renderMode: state.renderChoice,
          timeoutMs: Math.max(1_000, deadline - Date.now()),
        });
      } catch (error) {
        while (Date.now() < deadline) {
          const transitioned = await capturePopupState(popup);
          const transitionedToggle = transitioned.controls.find((control) => control.id === "toggle-enabled");
          if (
            transitionedToggle &&
            !transitionedToggle.disabled &&
            transitionedToggle.visible !== false &&
            transitioned.busy === false
          ) {
            return transitioned;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw error;
      }
      state = await capturePopupState(popup);
      continue;
    }

    // A prior immutable run can leave an extension-owned same-user edit lease in
    // the copied profile. Claiming that lease through the visible controls is a
    // required user workflow, not a privileged state mutation. Confirm first if
    // the two-step prompt is already open, then handle the initial action or an
    // outstanding Render Inspection view.
    const recoveryIds = [
      "lock-confirm-discard",
      "lock-continue-here",
      "lock-take-over",
      ...exitIds,
    ];
    const recovery = recoveryIds
      .map((id) => state.controls.find((control) => control.id === id))
      .find((control) => control && !control.disabled && control.visible !== false);
    if (recovery?.id) {
      const recoveryBefore = await capturePopupState(popup);
      if (!popupControlIsActionable(recoveryBefore, recovery.id)) {
        state = recoveryBefore;
        continue;
      }
      try {
        await physicalActivatePopupControl(
          popup,
          recovery.id,
          "pointer",
          null,
          implementation === "legacy" ? { hitTargetTimeoutMs: timeoutMs, pollIntervalMs: 100 } : undefined,
        );
      } catch (error) {
        const racedState = await capturePopupState(popup);
        const unavailableRace = error instanceof Error &&
          error.message.includes(`Real popup control #${recovery.id} is unavailable`) &&
          popupRecoveryTransitioned(recoveryBefore, racedState, recovery.id);
        if (!unavailableRace) throw error;
        state = racedState;
        continue;
      }
      const acknowledgementDeadline = Math.min(deadline, Date.now() + 2_000);
      let acknowledgedState = await capturePopupState(popup);
      while (
        Date.now() < acknowledgementDeadline &&
        !popupRecoveryTransitioned(recoveryBefore, acknowledgedState, recovery.id)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        acknowledgedState = await capturePopupState(popup);
      }
      state = acknowledgedState;
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    state = await capturePopupState(popup);
  }
  throw new Error(`Timed out returning to the marking session; last=${JSON.stringify(state)}`);
}

function compactPopupTransition(state, started) {
  const control = (id) => state.controls.find((candidate) => candidate.id === id) ?? null;
  return {
    elapsedMs: Date.now() - started,
    view: state.view,
    busy: state.busy,
    spinnerText: state.spinnerText,
    compute: control("compute"),
    markingPreview: control("marking-preview"),
    legacyPreview: control("preview-latest"),
    bodyTail: state.bodyLead.slice(-320),
  };
}

async function waitForTerminalGuardRequests(guard, boundary, predicate, { minCount = 1, timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let matching = [];
  while (Date.now() < deadline) {
    matching = guard.evidenceSince(boundary).filter(predicate);
    if (matching.length >= minCount && matching.every((entry) =>
      typeof entry.finishedAt === "number" &&
      entry.payloadHygiene?.inspected === true)) return matching;
    await guard.refresh({ timeoutMs: Math.max(100, Math.min(1_000, deadline - Date.now())) }).catch(() => undefined);
  }
  throw new Error(`Guard did not retain ${minCount} terminal request(s) before the evidence deadline; matching=${JSON.stringify(matching)}`);
}

async function runCurrentAi(popup, guard, options) {
  const before = await capturePopupState(popup);
  if (before.view === "preview") throw new Error("Run AI evidence requires Content List to be closed before activation");
  const compute = before.controls.find((control) => control.id === "compute");
  if (!compute || compute.disabled) throw new Error(`Current-run AI requires an enabled Run AI control; observed ${JSON.stringify(compute)}`);
  const boundary = guard.markNetworkBoundary();
  const started = Date.now();
  const transitions = [];
  let lastSignature = "";
  let feedbackMs = null;
  let operationObserved = false;
  let idleWithoutResultSince = null;
  let contentListOpenedAtMs = null;
  let contentListFirstPaintMs = null;
  const controlActivation = await physicalActivatePopupControl(popup, "compute", "pointer");
  const feedbackStartedAt = controlActivation.dispatchedAtEpochMs ?? started;
  const initialFeedback = await capturePopupAiFeedback(popup);
  if (
    initialFeedback.busy ||
    initialFeedback.computeDisabled === true ||
    initialFeedback.computeAriaBusy === true ||
    initialFeedback.spinnerText
  ) {
    feedbackMs = Math.max(0, initialFeedback.capturedAtEpochMs - feedbackStartedAt);
    operationObserved = true;
  }
  const deadline = started + integerOption(options, "ai-timeout-ms", AI_WORKFLOW_TIMEOUT_MS);
  let terminal = null;
  while (Date.now() < deadline) {
    const state = await capturePopupState(popup);
    const compact = compactPopupTransition(state, started);
    const signature = JSON.stringify({
      view: compact.view,
      busy: compact.busy,
      spinnerText: compact.spinnerText,
      computeDisabled: compact.compute?.disabled,
      markingPreviewDisabled: compact.markingPreview?.disabled,
      legacyPreviewDisabled: compact.legacyPreview?.disabled,
      bodyTail: compact.bodyTail,
    });
    if (signature !== lastSignature || compact.elapsedMs - (transitions.at(-1)?.elapsedMs ?? 0) >= 1_000) {
      transitions.push(compact);
      lastSignature = signature;
    }
    if (feedbackMs === null && (state.busy || compact.compute?.disabled === true || state.spinnerText)) {
      feedbackMs = Math.max(0, Date.now() - feedbackStartedAt);
    }
    operationObserved ||= state.busy || compact.compute?.disabled === true || Boolean(state.spinnerText);
    const previewReady = state.view === "preview";
    if (state.view === "preview" && contentListFirstPaintMs === null) {
      const previewState = await captureWorkflowPopupState(popup);
      contentListOpenedAtMs ??= compact.elapsedMs;
      if (previewState.preview.rowCount > 0) contentListFirstPaintMs = Math.max(0, compact.elapsedMs - contentListOpenedAtMs);
    }
    const visibleFailureText = [state.bodyLead, state.spinnerText].filter(Boolean).join("\n");
    const visibleFailure = /Run AI failed|AI[^\n]{0,80}(?:failed|error)|Content message timed out|Property lock unavailable|saved endpoints did not answer|site lookup/i
      .test(visibleFailureText);
    if (operationObserved && !state.busy) {
      if (previewReady || visibleFailure) {
        terminal = { state, previewReady, visibleFailure, visibleFailureText, idleWithoutResult: false };
        break;
      }
      idleWithoutResultSince ??= Date.now();
      if (Date.now() - idleWithoutResultSince >= 750) {
        terminal = { state, previewReady: false, visibleFailure: false, idleWithoutResult: true };
        break;
      }
    } else {
      idleWithoutResultSince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, Date.now() - started < 2_500 ? 25 : 150));
  }
  const requests = await waitForTerminalGuardRequests(
    guard,
    boundary,
    (entry) => /\/get_selectors(?:\?|$)/i.test(entry.url) && entry.method === "POST",
    { timeoutMs: 20_000 },
  );
  const durationMs = Date.now() - started;
  const requestSucceeded = requests.some((entry) => entry.status >= 200 && entry.status < 300 && !entry.failed);
  return {
    mode: "measured-current-run",
    parityEligible: true,
    success: Boolean(terminal?.previewReady && !terminal.visibleFailure && requestSucceeded),
    durationMs,
    feedbackMs,
    initialFeedback,
    requestCount: requests.length,
    requests,
    transitions,
    operationObserved,
    contentListAutoOpen: {
      opened: contentListOpenedAtMs !== null,
      openedAtMs: contentListOpenedAtMs,
      firstPaintMs: contentListFirstPaintMs,
    },
    terminal: terminal ? compactPopupTransition(terminal.state, started) : null,
    failure: !terminal
      ? `AI did not terminalize within ${durationMs} ms`
      : terminal.visibleFailure
        ? terminal.visibleFailureText.slice(-600)
        : terminal.idleWithoutResult
          ? "AI returned to idle without opening a usable Content List or showing a failure"
          : null,
    controlActivation,
  };
}

function workflowControl(state, id) {
  return state?.controls?.find((control) => control?.id === id) ?? null;
}

async function runContentListWorkflow(popup, siteTarget, aiEvidence) {
  const started = performance.now();
  const beforeOpen = await captureWorkflowPopupState(popup);
  const openActivation = beforeOpen.preview.open
    ? { method: "ai-auto-open", before: beforeOpen, dispatchedAt: null }
    : await physicalActivatePopupControl(popup, "marking-preview", "pointer");
  const firstPaint = await waitForWorkflowPopupState(
    popup,
    (state) => state.preview.open && state.preview.rowCount > 0,
    20_000,
  );
  const firstPaintMs = aiEvidence?.contentListAutoOpen?.opened && Number.isFinite(aiEvidence.contentListAutoOpen.firstPaintMs)
    ? aiEvidence.contentListAutoOpen.firstPaintMs
    : performance.now() - started;
  const site = await new CdpSession(siteTarget).connect();
  try {
    await site.send("Runtime.enable");
    await site.send("Page.enable");
    const beforeRowRoute = await captureSiteWorkflowPosture(site);
    const beforeFocusOwners = new Set(beforeRowRoute.focusOwners ?? []);
    const rowActivation = await physicalActivatePreviewRow(popup, firstPaint.preview.rowCount > 1 ? 1 : 0);
    let afterRowRoute = null;
    let correlatedFocusTarget = null;
    const rowDeadline = Date.now() + 2_000;
    while (Date.now() < rowDeadline) {
      afterRowRoute = await captureSiteWorkflowPosture(site);
      correlatedFocusTarget = afterRowRoute.focusTargets?.find((target) =>
        !beforeFocusOwners.has(target.owner) &&
        readableTextsCorrespond(rowActivation.before.readableText, target.readableText)) ?? null;
      if (correlatedFocusTarget) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await popup.evaluate("(document.getElementById('preview-exit') || document.querySelector('.preview-sidebar__dismiss'))?.focus()");
    const beforePageRoute = await captureWorkflowPopupState(popup);
    if (beforePageRoute.preview.domFocusedRowName !== null) throw new Error("Could not clear the prior row DOM focus before the page-to-row route probe");
    const pageActivation = await physicalActivatePreviewPageTarget(site);
    let pageFocused;
    try {
      pageFocused = await waitForWorkflowPopupState(
        popup,
        (state) => {
          const focused = state.preview.domFocusedRow ?? state.preview.selectedRow;
          return Boolean(focused &&
            readableTextsCorrespond(pageActivation.target.readableText, focused.readableText) &&
            focused.name !== beforePageRoute.preview.selectedRowName);
        },
        2_000,
      );
    } catch (error) {
      const last = await captureWorkflowPopupState(popup);
      throw new Error(`Content List page-to-row correlation did not terminalize; evidence=${JSON.stringify({
        pageActivation,
        beforePageRoute,
        last,
      })}`, { cause: error });
    }
    const correlatedRow = pageFocused.preview.domFocusedRow ?? pageFocused.preview.selectedRow;
    const exitActivation = await physicalActivatePopupControl(
      popup,
      "preview-exit",
      "pointer",
      ".preview-sidebar__dismiss",
      {
        trustedActivation: true,
        activationAckTimeoutMs: 250,
        maxDispatchAttempts: 3,
      },
    );
    const exited = await waitForWorkflowPopupState(popup, (state) => !state.preview.open && !state.busy, 20_000);
    return {
      openActivation,
      firstPaintMs,
      rowCount: firstPaint.preview.rowCount,
      firstRowName: firstPaint.preview.firstRowName,
      rowToPage: {
        ...rowActivation,
        activatedRow: rowActivation.before,
        before: beforeRowRoute,
        after: afterRowRoute,
        focusPainted: Boolean(correlatedFocusTarget),
        targetCorresponds: Boolean(correlatedFocusTarget),
        correlatedFocusTarget,
      },
      pageToRow: {
        ...pageActivation,
        before: beforePageRoute,
        rowFocused: Boolean(correlatedRow),
        focusedRowName: correlatedRow?.name ?? null,
        targetCorresponds: Boolean(correlatedRow && readableTextsCorrespond(pageActivation.target.readableText, correlatedRow.readableText)),
      },
      exitActivation,
      exited: !exited.preview.open,
    };
  } finally {
    site.close();
  }
}

async function waitForDirtyFreshnessProjection(popup, inputDispatchedAtEpochMs) {
  if (!Number.isFinite(inputDispatchedAtEpochMs)) {
    throw new Error("Dirty freshness projection requires the trusted input dispatch epoch");
  }
  const elapsedBeforeProjectionWaitMs = Math.max(0, Date.now() - inputDispatchedAtEpochMs);
  const state = await waitForWorkflowPopupState(popup, (candidate) => {
    const save = workflowControl(candidate, "page-save");
    const preview = workflowControl(candidate, "marking-preview");
    return save?.disabled === true && preview?.disabled === true &&
      save.blockedReason === "requires-ai-run" && preview.blockedReason === "requires-ai-run";
  }, Math.max(1, 1_000 - elapsedBeforeProjectionWaitMs));
  const timing = measureTrustedProjectionInterval(inputDispatchedAtEpochMs);
  return {
    ...timing,
    saveBlockedReason: workflowControl(state, "page-save")?.blockedReason ?? null,
    previewBlockedReason: workflowControl(state, "marking-preview")?.blockedReason ?? null,
    state,
  };
}

async function runDiscardWorkflow(popup) {
  const openActivation = await physicalActivatePopupControl(popup, "page-revert", "pointer");
  const decision = await waitForWorkflowPopupState(popup, (state) =>
    state.discardOpen || (!state.busy && workflowControl(state, "page-revert")?.disabled === true), 2_000);
  const confirmationRequired = decision.discardOpen;
  const confirmActivation = confirmationRequired
    ? await physicalActivatePopupControl(popup, "discard-confirm", "pointer")
    : null;
  const terminal = confirmationRequired
    ? await waitForWorkflowPopupState(popup, (state) => !state.discardOpen && !state.busy, 20_000)
    : decision;
  const discard = workflowControl(terminal, "page-revert");
  return {
    trustedPointer: openActivation.method === "pointer" && (!confirmationRequired || confirmActivation?.method === "pointer"),
    openActivation,
    opened: decision.discardOpen,
    confirmationRequired,
    confirmActivation,
    confirmed: true,
    terminal,
    restored: discard?.disabled === true,
  };
}

async function runMeasuredFullWorkflow({ popup, site, guard, identity, options }) {
  const initialAi = await runCurrentAi(popup, guard, options);
  if (!initialAi.success) {
    // Return the terminal evidence instead of throwing it away. Stage
    // acceptance still fails closed, but the exact popup transitions, control
    // activation, network boundary, and failure reason remain inspectable.
    return {
      initialAi,
      freshAi: null,
      failurePhase: "initial-ai",
      failure: initialAi.failure ?? "Initial AI run failed",
    };
  }
  const contentList = await runContentListWorkflow(popup, site, initialAi);
  const markingTargetOptions = {
    requireContextAuthority: identity.implementation === "rewrite",
    allowContextPreclean: identity.implementation === "rewrite",
  };

  const dirtyEdit = await withSiteSession(
    site,
    (session) => performPhysicalShiftExclusion(session, markingTargetOptions),
  );
  const freshness = await waitForDirtyFreshnessProjection(popup, dirtyEdit.inputDispatchedAtEpochMs);
  const discard = await runDiscardWorkflow(popup);

  const saveEdit = await withSiteSession(
    site,
    (session) => performPhysicalShiftExclusion(session, markingTargetOptions),
  );
  await waitForDirtyFreshnessProjection(popup, saveEdit.inputDispatchedAtEpochMs);
  const freshAi = await runCurrentAi(popup, guard, options);
  if (!freshAi.success) {
    return {
      initialAi,
      freshAi,
      contentList,
      dirtyEdit,
      freshness,
      discard,
      saveEdit,
      failurePhase: "fresh-ai",
      failure: freshAi.failure ?? "Fresh AI rerun failed",
    };
  }
  const freshPreviewState = await captureWorkflowPopupState(popup);
  const freshPreviewExit = freshPreviewState.preview.open
    ? await physicalActivatePopupControl(popup, "preview-exit", "pointer", ".preview-sidebar__dismiss")
    : null;
  if (freshPreviewExit) {
    await waitForWorkflowPopupState(popup, (state) => !state.preview.open && !state.busy, 20_000);
  }

  const currentPageHref = await withSiteSession(site, (session) => session.evaluate("location.href"));
  const expectedPageKey = (() => {
    const url = new URL(typeof currentPageHref === "string" ? currentPageHref : identity.expectedUrl);
    return `${url.pathname || "/"}${url.search}${url.hash}`;
  })();
  const saveBoundary = guard.markNetworkBoundary();
  const saveActivation = await physicalActivatePopupControl(popup, "page-save", "pointer");
  const silentTerminal = await waitForWorkflowPopupState(popup, (state) => {
    const toggle = workflowControl(state, "toggle-enabled");
    return toggle?.checked === false && state.silentAcknowledged && !state.busy;
  }, integerOption(options, "save-timeout-ms", 180_000));
  const saveRequests = await waitForTerminalGuardRequests(
    guard,
    saveBoundary,
    (entry) => entry.method === "POST" && /\/save(?:\?|$)/i.test(entry.url),
    { timeoutMs: 20_000 },
  );
  const saveEntry = saveRequests[0] ?? null;
  const authoritativeAdopted = saveRequests.length === 1 && saveEntry?.status === 200 &&
    typeof saveEntry.finishedAt === "number" && silentTerminal.silentAcknowledged;
  const currentPageOnly = saveEntry?.payloadHygiene?.hasSinglePageEnvelope === true &&
    saveEntry.payloadHygiene.pageKeyCount === 1 &&
    saveEntry.payloadHygiene.pageKeysSha256 === sha256(JSON.stringify([expectedPageKey]));
  const selectorRequests = [...initialAi.requests, ...freshAi.requests];
  const payloadEntries = [...selectorRequests, ...saveRequests];
  const payloadHygiene = {
    pass: payloadEntries.length > 0 && payloadEntries.every((entry) =>
      entry.payloadHygiene?.inspected === true && entry.payloadHygiene?.json === true && entry.payloadHygiene?.pass === true) && currentPageOnly,
    inspectedCount: payloadEntries.filter((entry) => entry.payloadHygiene?.inspected === true).length,
    forbiddenMarkers: [...new Set(payloadEntries.flatMap((entry) => entry.payloadHygiene?.forbiddenMarkers ?? []))],
    currentPageOnly,
  };
  return {
    initialAi,
    freshAi,
    freshPreviewExit,
    contentList,
    dirtyEdit,
    freshness,
    discard,
    saveEdit,
    save: {
      trustedPointer: saveActivation.method === "pointer",
      activation: saveActivation,
      requestCount: saveRequests.length,
      requests: saveRequests,
      authoritativeAdopted,
      currentPageOnly,
      terminal: silentTerminal,
    },
    silentTransition: {
      trustedPointer: saveActivation.method === "pointer",
      acknowledged: silentTerminal.silentAcknowledged && workflowControl(silentTerminal, "toggle-enabled")?.checked === false,
      source: "authoritative-save-transition",
      terminal: silentTerminal,
    },
    payloadHygiene,
  };
}

function stageAcceptanceFailures(id, action, implementation) {
  const failures = [];
  const requireValue = (condition, message) => { if (!condition) failures.push(message); };
  const data = action?.data ?? {};
  requireValue(data.publicationFence?.attemptCount === 0, "A final /publish request was attempted; it was blocked before transmission but the contract requires zero attempts");
  requireValue((data.publicationFence?.errors?.length ?? 0) === 0, `The publication/request guard reported ${data.publicationFence?.errors?.length ?? "unknown"} interception error(s)`);
  if (id === "preflight") {
    requireValue(data.candidatePreflight?.candidateDisposition?.source === "preflight", "Candidate disposition was not adopted from implementation-neutral preflight evidence");
    requireValue(data.candidatePreflight?.documentFingerprint === action?.document?.fingerprint, "Candidate disposition is not bound to the captured document");
  }
  if (id === "render-mode-with-javascript" || id === "render-mode-without-javascript") {
    requireValue(data.inspectionProof?.requestedMode === data.renderMode, "Render Inspection proof is for a different requested mode");
    requireValue(data.inspectionProof?.clicked === true, "The real Render Inspection control was not clicked");
    requireValue(data.inspectionProof?.terminal === true, "Render Inspection did not reach its terminal posture");
    requireValue(data.inspectionProof?.modeProven === true, "Render Inspection did not prove the requested mode");
    requireValue(["inspection-lifecycle", "confirmed-render-choice"].includes(data.inspectionProof?.proofSource), "Render Inspection proof has no implementation-neutral evidence source");
    requireValue(data.inspectionProof?.after?.renderInspectionView === data.renderMode || data.inspectionProof?.after?.renderChoice === data.renderMode, "Terminal popup evidence does not identify the requested mode");
    requireValue(data.inspectionProof?.sawBusy === true || data.inspectionProof?.sawControlDisabled === true || data.popup?.renderInspectionView === data.renderMode, "No Render Inspection lifecycle transition was observed");
    requireValue(data.popup?.busy === false, "Render inspection had not reached its acknowledged terminal popup posture");
  }
  if (id === "activation-network") {
    requireValue((data.activationNetwork?.length ?? 0) > 0, "Activation emitted no retained extension network evidence");
    requireValue(data.legacyLoad?.installedBeforeActivation === true, "Extension traffic guard was not installed before activation");
    if (implementation === "rewrite") {
      requireValue(data.silentDesktopSetup?.terminalChecked === true, "Activation did not establish the retained silent desktop preference");
      requireValue(viewportMatches(data.silentDesktopSetup?.posture, 1920, 1080), "Activation did not begin from exact 1920x1080 silent desktop posture");
      requireValue(viewportMatches(data.markingPosture, 412, 960), "Activation did not terminalize in exact 412x960 marking posture");
    }
  }
  if (id === "marking-visual") {
    requireValue(Number.isInteger(data.visual?.sourceCount), "Source cardinality was not captured");
    requireValue(Number.isInteger(data.visual?.sourceFragmentCount), "Source fragment cardinality was not captured");
    requireValue(Number.isInteger(data.visual?.paintedRectCount), "Painted rectangle cardinality was not captured");
    requireValue(Number.isInteger(data.visual?.physicalHitCount), "Physical hit cardinality was not captured");
    requireValue(data.visual?.extensionRootCount === 1, `Marking stage retained ${data.visual?.extensionRootCount ?? "unknown"} renderer roots`);
    requireValue(data.visual?.invisibleSourcePaintCount === 0, `Painted ${data.visual?.invisibleSourcePaintCount ?? "unknown"} invisible sources`);
  }
  if (id === "silent-visual") {
    requireValue(data.popup?.silentAcknowledged === true && workflowControl(data.popup, "toggle-enabled")?.checked === false, "Silent visual stage did not begin from the acknowledged disabled-marking posture");
    requireValue(silentPosturePass(data.silentPosture), "Silent visual stage lacks exact 1920x1080 highlight and full-viewport interactive shield proof");
    requireValue(data.visual?.extensionRootCount === 1, `Silent stage retained ${data.visual?.extensionRootCount ?? "unknown"} renderer roots`);
    requireValue(data.visual?.invisibleSourcePaintCount === 0, `Silent stage painted ${data.visual?.invisibleSourcePaintCount ?? "unknown"} invisible sources`);
  }
  if (id === "marking-gestures") {
    const exact = validateExactMarkingGestureEvidence(data.gestures, {
      requireContextMenu: implementation === "rewrite",
    });
    requireValue(exact.pass, `Exact target-keyed marking contract failed: ${exact.failures.join(", ")}`);
    requireValue((data.frames?.requestAnimationFrame?.worstLongTaskMs ?? Infinity) <= 50, `Marking input Long Task reached ${data.frames?.requestAnimationFrame?.worstLongTaskMs ?? "unknown"} ms`);
  }
  if (id.endsWith("scroll-fade")) {
    const probe = data.scrollFade;
    const notApplicable = probe?.applicable === false && probe?.reason === "no-scrollable-viewport-owner";
    requireValue(notApplicable || probe?.scrolled === true, "Physical wheel input did not move the resolved viewport owner");
    requireValue(notApplicable || probe?.faded === true, "Coordinate-dependent layers did not fade before movement");
    requireValue(notApplicable || probe?.repositioned === true, "Overlay rectangle signatures did not reposition after scroll");
    requireValue(notApplicable || probe?.restored === true, "Overlay presentation did not restore after scroll idle");
    requireValue((probe?.frames?.requestAnimationFrame?.worstLongTaskMs ?? Infinity) <= 50, `Scroll input Long Task reached ${probe?.frames?.requestAnimationFrame?.worstLongTaskMs ?? "unknown"} ms`);
    if (id.startsWith("silent-")) requireValue(silentPosturePass(data.silentPosture), "Silent scroll did not preserve the exact desktop shield/highlight posture");
  }
  if (id.endsWith("resize")) {
    const notApplicable = data.resize?.applicable === false &&
      data.resize?.reason === "source-highlight-geometry-unchanged";
    requireValue(notApplicable || data.resize?.repositioned === true, "Overlay rectangle signatures did not change during the resize probe");
    requireValue(data.resize?.beforePosture?.matches === true, `Resize probe did not begin in the authoritative ${id.startsWith("marking-") ? "marking-mobile" : "silent-desktop"} posture`);
    requireValue(data.resize?.afterPosture?.matches === true && data.resize?.appliedRestore?.matches === true && data.resize?.postureRestored === true, `Resize probe did not restore the exact authoritative ${id.startsWith("marking-") ? "marking-mobile" : "silent-desktop"} posture`);
    requireValue((data.resize?.frames?.requestAnimationFrame?.worstLongTaskMs ?? Infinity) <= 50, `Resize input Long Task reached ${data.resize?.frames?.requestAnimationFrame?.worstLongTaskMs ?? "unknown"} ms`);
    if (id.startsWith("silent-")) requireValue(silentPosturePass(data.silentPosture), "Silent resize did not preserve the exact desktop shield/highlight posture");
  }
  if (id === "workflow-summary") {
    if (data.ai?.mode === "measured-current-run") {
      requireValue(data.ai.success === true, data.ai.failure ?? "Current-run AI did not succeed");
      requireValue(data.ai.requestCount > 0, "Current-run AI emitted no retained selector request");
      requireValue(typeof data.ai.feedbackMs === "number" && data.ai.feedbackMs <= 100, `AI feedback took ${data.ai.feedbackMs ?? "unknown"} ms`);
    }
    const workflow = validateFullWorkflowEvidence(data.workflow);
    requireValue(workflow.pass, `Full real-control workflow failed: ${workflow.failures.join(", ")}`);
    requireValue(data.workflow?.freshAi?.success === true && data.workflow?.freshAi?.requestCount > 0, "Post-edit fresh AI rerun did not succeed with a retained selector request");
    requireValue(
      typeof data.workflow?.freshAi?.feedbackMs === "number" && data.workflow.freshAi.feedbackMs <= 100,
      `Post-edit fresh AI feedback took ${data.workflow?.freshAi?.feedbackMs ?? "unknown"} ms`,
    );
    requireValue(data.workflow?.save?.currentPageOnly === true, "Save payload was not exact current-page-only evidence");
  }
  if (id === "publication-fence") {
    requireValue(data.checklist?.activation?.method === "pointer", "Send-to-Lynx checklist was not opened with trusted physical pointer input");
    requireValue(data.checklist?.open === true, "Send-to-Lynx checklist did not open");
    requireValue(data.checklist?.sendInvoked === false, "Final checklist Send action was invoked");
    requireValue(["ready", "unknown", "error", "published"].includes(data.checklist?.phase), "Checklist did not reach an inspectable terminal phase");
  }
  return failures;
}

async function runStageAction({ id, options, identity, runDirectory, targets, guard }) {
  const screenshotDirectory = join(runDirectory, "screenshots");
  const frameDirectory = join(runDirectory, "frames");
  if (id === "preflight") {
    const { document, visual, candidateSignals, siteShot } = await withSiteSession(targets.site, async (session) => ({
      document: await captureDocumentIdentity(session, identity.expectedUrl),
      visual: await captureVisualSnapshot(session),
      candidateSignals: await captureCandidateSignals(session, identity.expectedUrl),
      siteShot: await captureScreenshot(session, join(screenshotDirectory, `${id}-site.png`)),
    }));
    const matrixCandidate = CANDIDATE_MATRIX.find((candidate) => candidate.label === identity.label);
    if (!matrixCandidate) throw new Error(`Candidate matrix entry disappeared for ${identity.label}`);
    const candidatePreflight = createCandidateDispositionRecord({
      identity,
      document,
      matrixEligibility: matrixCandidate.eligibility,
      captured: candidateSignals,
    });
    await writeJsonExclusive(candidateDispositionPath(runDirectory), candidatePreflight);
    const { popup, popupShot } = await withPopupSession(targets.popup, async (session) => ({
      popup: await capturePopupState(session),
      popupShot: await captureScreenshot(session, join(screenshotDirectory, `${id}-popup.png`)),
    }));
    const screenshots = { site: siteShot, popup: popupShot };
    return { data: { popup, visual, candidatePreflight }, document, screenshots };
  }
  if (id === "render-mode-with-javascript" || id === "render-mode-without-javascript") {
    const renderMode = id === "render-mode-with-javascript" ? "with-javascript" : "without-javascript";
    if (required(options, "render-mode") !== renderMode) throw new Error(`Stage ${id} requires --render-mode ${renderMode}`);
    const diagnosticObserveOnlyReason = typeof options["diagnostic-observe-only-reason"] === "string"
      ? options["diagnostic-observe-only-reason"].trim()
      : "";
    const inspectionProof = diagnosticObserveOnlyReason
      ? await withPopupSession(targets.popup, async (session) => {
        const observed = await capturePopupState(session);
        const proof = proveRequestedRenderMode(observed, renderMode, {
          requireInspectionLifecycle: identity.implementation === "rewrite",
        });
        return {
          requestedMode: renderMode,
          controlId: null,
          clicked: false,
          controlActivation: null,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          sawBusy: observed.busy === true,
          sawControlDisabled: false,
          initialInspectionView: observed.renderInspectionView,
          modeProven: proof.modeProven,
          proofSource: proof.proofSource,
          terminal: false,
          diagnosticObserveOnly: true,
          diagnosticObserveOnlyReason,
          before: observed,
          after: observed,
        };
      })
      : await withPopupSession(targets.popup, (session) => runRenderInspection(session, {
        implementation: identity.implementation,
        renderMode,
        timeoutMs: integerOption(options, "render-timeout-ms", 180_000),
      }));
    const { document, siteShot } = await withSiteSession(targets.site, async (session) => ({
      document: await captureDocumentIdentity(session, identity.expectedUrl),
      siteShot: await captureScreenshot(session, join(screenshotDirectory, `${id}-site.png`)),
    }));
    const { popup, popupShot } = await withPopupSession(targets.popup, async (session) => ({
      popup: await capturePopupState(session),
      popupShot: await captureScreenshot(session, join(screenshotDirectory, `${id}-popup.png`)),
    }));
    const screenshots = { site: siteShot, popup: popupShot };
    return {
      data: {
        renderMode,
        popup,
        inspectionProof,
        observerBoundary: diagnosticObserveOnlyReason
          ? "diagnostic-observe-only-no-render-control-dispatch"
          : "site-observer-attached-after-extension-terminal-acknowledgement",
      },
      document,
      screenshots,
      renderMode,
    };
  }
  if (id === "activation-network") {
    const popup = await new CdpSession(targets.popup).connect();
    try {
      await popup.send("Runtime.enable");
      const initialBefore = await ensurePopupSessionView(
        popup,
        identity.implementation,
        integerOption(options, "activation-timeout-ms", 45_000),
      );
      let silentDesktopSetup = null;
      if (identity.implementation === "rewrite") {
        const initialDesktopControl = workflowControl(initialBefore, "desktop-preview-enabled");
        if (!initialDesktopControl) throw new Error("Silent desktop preview control is missing");
        const controlActivation = initialDesktopControl.checked
          ? null
          : await physicalActivatePopupControl(popup, "desktop-preview-enabled", "pointer");
        const terminal = await waitForWorkflowPopupState(
          popup,
          (state) => state.view === "silent" &&
            state.busy === false &&
            workflowControl(state, "desktop-preview-enabled")?.checked === true,
          integerOption(options, "activation-timeout-ms", 45_000),
        );
        const posture = await waitForSiteWorkflowPosture(
          targets.site,
          (state) => viewportMatches(state, 1920, 1080),
          integerOption(options, "activation-timeout-ms", 45_000),
        );
        silentDesktopSetup = {
          alreadyEnabled: initialDesktopControl.checked === true,
          controlActivation,
          terminal,
          terminalChecked: workflowControl(terminal, "desktop-preview-enabled")?.checked === true,
          posture,
        };
      }
      const before = await capturePopupState(popup);
      const toggle = before.controls.find((control) => control.id === "toggle-enabled");
      if (!toggle) throw new Error("Enable marking toggle is missing");
      if (toggle.checked) throw new Error("Activation evidence requires marking to be disabled before the stage; disable it and retry in a fresh run");
      const boundary = guard.markNetworkBoundary();
      const refreshControl = before.controls.find((control) => control.id === "lock-refresh");
      const refreshTriggered = Boolean(
        refreshControl && !refreshControl.disabled && refreshControl.visible !== false,
      );
      const refreshActivation = refreshTriggered
        ? await physicalActivatePopupControl(popup, "lock-refresh", "pointer")
        : null;
      const refreshTerminal = refreshTriggered && identity.implementation === "rewrite"
        ? await waitForPopupRefreshTerminal(
          popup,
          integerOption(options, "activation-timeout-ms", 45_000),
        )
        : null;
      if (refreshTriggered && identity.implementation !== "rewrite") {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      const afterAuthorityRefresh = refreshTerminal?.state ?? await capturePopupState(popup);
      const started = performance.now();
      const controlActivation = await physicalActivatePopupControl(
        popup,
        "toggle-enabled",
        "pointer",
        null,
        {
          hitTargetTimeoutMs: 2_000,
          pollIntervalMs: 50,
          trustedActivation: true,
          activationAckTimeoutMs: 250,
          maxDispatchAttempts: 3,
        },
      );
      const after = await waitForPopupToggle(popup, true, integerOption(options, "activation-timeout-ms", 45_000));
      const markingPosture = identity.implementation === "rewrite"
        ? await waitForSiteWorkflowPosture(
          targets.site,
          (state) => viewportMatches(state, 412, 960),
          integerOption(options, "activation-timeout-ms", 45_000),
        )
        : null;
      const durationMs = performance.now() - started;
      const document = await withSiteSession(targets.site, (session) => captureDocumentIdentity(session, identity.expectedUrl));
      const screenshots = await captureStageScreenshots({ ...targets, runDirectory, id });
      const frames = await withSiteSession(targets.site, (session) => captureCompactFrames(session, { artifactDirectory: frameDirectory, name: id, durationMs: 900 }));
      await guard.refresh({ freshAfterMs: Date.now() });
      const activation = guard.evidenceSince(boundary);
      return {
        data: {
          initialBefore,
          before,
          silentDesktopSetup,
          afterAuthorityRefresh,
          refreshTriggered,
          refreshActivation,
          refreshTerminal,
          after,
          markingPosture,
          durationMs,
          controlActivation,
          activationNetwork: activation,
          publicationFence: guard.publicationFenceEvidence(),
          legacyLoad: guard.legacyLoadEvidence(),
          observerBoundary: "website-observer-attached-only-after-terminal-toggle-acknowledgement",
          frames,
        },
        document,
        screenshots,
      };
    } finally {
      popup.close();
    }
  }
  if (id === "marking-visual") {
    const data = await withSiteSession(targets.site, async (session) => ({
      visual: await captureVisualSnapshot(session),
      frames: await captureCompactFrames(session, { artifactDirectory: frameDirectory, name: id, durationMs: 1200 }),
    }));
    const document = await withSiteSession(targets.site, (session) => captureDocumentIdentity(session, identity.expectedUrl));
    const screenshots = await captureStageScreenshots({ ...targets, runDirectory, id });
    return { data, document, screenshots };
  }
  if (id === "silent-visual") {
    const popup = await withPopupSession(targets.popup, captureWorkflowPopupState);
    const data = await withSiteSession(targets.site, async (session) => ({
      popup,
      silentPosture: await captureSiteWorkflowPosture(session),
      visual: await captureVisualSnapshot(session),
      frames: await captureCompactFrames(session, { artifactDirectory: frameDirectory, name: id, durationMs: 1200 }),
    }));
    const document = await withSiteSession(targets.site, (session) => captureDocumentIdentity(session, identity.expectedUrl));
    const screenshots = await captureStageScreenshots({ ...targets, runDirectory, id });
    return { data, document, screenshots };
  }
  if (id === "marking-gestures") {
    // Candidate discovery performs full-document geometry and modifier-hover
    // preflights. Keep that harness work outside the operator frame/Long Task
    // window, then fail closed if the prepared target becomes owned before the
    // first physical gesture.
    const rewriteContextMenu = identity.implementation === "rewrite";
    const preparation = await withSiteSession(targets.site, (session) => prepareMarkingGestureTarget(session, {
      requireContextAuthority: rewriteContextMenu,
      allowContextPreclean: rewriteContextMenu,
    }));
    const target = preparation.target;
    if (!target) {
      throw new Error(`No stable exact and widenable clean marking target is available: ${JSON.stringify(preparation.diagnostics)}`);
    }
    const frames = await withSiteSession(targets.site, (session) => captureCompactFrames(session, {
      artifactDirectory: frameDirectory,
      name: id,
      durationMs: 2200,
      during: () => probeMarkingGestures(session, target, {
        requireContextMenu: rewriteContextMenu,
      }),
    }));
    const gestures = frames.action;
    const preparationReset = preparation.diagnostics.preclean
      ? await withPopupSession(targets.popup, async (popup) => {
        const before = await captureWorkflowPopupState(popup);
        const discard = workflowControl(before, "page-revert");
        if (!discard || discard.disabled) {
          return { required: false, before, discard: null, markingRestored: true };
        }
        const restored = await runDiscardWorkflow(popup);
        let terminal = restored.terminal;
        let toggle = workflowControl(terminal, "toggle-enabled");
        let markingActivation = null;
        if (toggle?.checked !== true) {
          markingActivation = await physicalActivatePopupControl(popup, "toggle-enabled", "pointer");
          terminal = await waitForWorkflowPopupState(
            popup,
            (state) => workflowControl(state, "toggle-enabled")?.checked === true && !state.busy,
            45_000,
          );
          toggle = workflowControl(terminal, "toggle-enabled");
        }
        return {
          required: true,
          before,
          discard: restored,
          markingActivation,
          terminal,
          markingRestored: toggle?.checked === true,
        };
      })
      : null;
    const document = await withSiteSession(targets.site, (session) => captureDocumentIdentity(session, identity.expectedUrl));
    const screenshots = await captureStageScreenshots({ ...targets, runDirectory, id });
    return {
      data: {
        gestures,
        frames,
        targetPreparation: preparation.diagnostics,
        preparationReset,
      },
      document,
      screenshots,
    };
  }
  if (id === "marking-scroll-fade" || id === "silent-scroll-fade") {
    const probe = await withSiteSession(targets.site, (session) => probeScrollFade(session, { artifactDirectory: frameDirectory, name: id }));
    const silentPosture = id.startsWith("silent-")
      ? await withSiteSession(targets.site, captureSiteWorkflowPosture)
      : null;
    const document = await withSiteSession(targets.site, (session) => captureDocumentIdentity(session, identity.expectedUrl));
    const screenshots = await captureStageScreenshots({ ...targets, runDirectory, id });
    return { data: { scrollFade: probe, ...(silentPosture ? { silentPosture } : {}) }, document, screenshots };
  }
  if (id === "marking-resize" || id === "silent-resize") {
    const probe = await withSiteSession(targets.site, (session) => probeResize(session, { artifactDirectory: frameDirectory, name: id }));
    const silentPosture = id.startsWith("silent-")
      ? await withSiteSession(targets.site, captureSiteWorkflowPosture)
      : null;
    const document = await withSiteSession(targets.site, (session) => captureDocumentIdentity(session, identity.expectedUrl));
    const screenshots = await captureStageScreenshots({ ...targets, runDirectory, id });
    return { data: { resize: probe, ...(silentPosture ? { silentPosture } : {}) }, document, screenshots };
  }
  if (id === "workflow-summary") {
    const mode = typeof options["ai-mode"] === "string" ? options["ai-mode"] : "not-run";
    let ai;
    let popup;
    let workflow = null;
    if (mode === "measured-current-run") {
      const session = await new CdpSession(targets.popup).connect();
      try {
        await session.send("Runtime.enable");
        workflow = await runMeasuredFullWorkflow({ popup: session, site: targets.site, guard, identity, options });
        ai = workflow.initialAi;
        popup = await capturePopupState(session);
      } finally {
        session.close();
      }
    } else if (mode === "retained-reference-only") {
      ai = {
        mode,
        parityEligible: false,
        reason: typeof options["ai-reason"] === "string" ? options["ai-reason"] : "Retained historical AI latency is reference-only and cannot establish current-run parity.",
        durationMs: numberOption(options, "ai-duration-ms"),
        referenceArtifact: required(options, "ai-evidence-artifact"),
      };
      popup = await withPopupSession(targets.popup, capturePopupState);
    } else {
      ai = {
        mode: "not-run",
        parityEligible: false,
        reason: typeof options["ai-reason"] === "string" ? options["ai-reason"] : "AI was not measured in this current run; no AI parity claim is permitted.",
      };
      popup = await withPopupSession(targets.popup, capturePopupState);
    }
    const document = await withSiteSession(targets.site, (session) => captureDocumentIdentity(session, identity.expectedUrl));
    const screenshots = await captureStageScreenshots({ ...targets, runDirectory, id });
    return { data: { ai, workflow, popup, network: guard.evidence(), publicationFence: guard.publicationFenceEvidence() }, document, screenshots };
  }
  if (id === "publication-fence") {
    const checklist = await withPopupSession(targets.popup, async (session) => {
      const before = await captureWorkflowPopupState(session);
      const activation = await physicalActivatePopupControl(session, "save-excludes", "pointer");
      const opened = await waitForWorkflowPopupState(
        session,
        (state) => state.checklist.open && !state.busy && ["ready", "unknown", "error", "published"].includes(state.checklist.phase),
        20_000,
      );
      const send = workflowControl(opened, "lynx-checklist-send");
      return {
        before,
        activation,
        opened,
        open: opened.checklist.open,
        phase: opened.checklist.phase,
        missingCount: opened.checklist.pageTypes.filter((pageType) => pageType.missing).length,
        sendDisabled: send?.disabled ?? null,
        sendInvoked: false,
      };
    });
    const popup = await withPopupSession(targets.popup, capturePopupState);
    const document = await withSiteSession(targets.site, (session) => captureDocumentIdentity(session, identity.expectedUrl));
    const screenshots = await captureStageScreenshots({ ...targets, runDirectory, id });
    await guard.refresh({ freshAfterMs: Date.now() });
    return {
      data: {
        popup,
        checklist,
        publicationFence: guard.publicationFenceEvidence(),
        contract: "The checklist surface may be inspected; final Send to Lynx publication is forbidden and /publish is aborted before transmission.",
      },
      document,
      screenshots,
    };
  }
  throw new Error(`Stage action is not implemented: ${id}`);
}

async function captureStage(options) {
  const { runDirectory, identity } = await loadRun(required(options, "run"));
  const id = required(options, "id");
  if (!REQUIRED_LIVE_STAGE_IDS.includes(id)) throw new Error(`Unknown stage ${id}`);
  const existing = await readStageRecords(runDirectory, identity);
  if (existing.some((stage) => stage.record.id === id)) throw new Error(`Stage ${id} already exists; stale stage reuse and overwrite are forbidden`);
  const adoptedCandidate = existing.length === 0
    ? null
    : await readAdoptedCandidateDisposition(runDirectory, identity, existing.find((stage) => stage.record.id === "preflight")?.record?.document ?? null);
  if (existing.length > 0 && !adoptedCandidate) throw new Error("Candidate-only stages require an adopted preflight disposition");
  const parityEligible = adoptedCandidate?.candidateDisposition?.parityEligible ?? identity.candidateDisposition.parityEligible;
  const requiredOrder = parityEligible === false
    ? ["preflight", "publication-fence"]
    : REQUIRED_LIVE_STAGE_IDS;
  const expectedId = requiredOrder[existing.length];
  if (id !== expectedId) {
    throw new Error(`Stage order mismatch: expected ${expectedId ?? "no further stage"}, received ${id}`);
  }
  const sequence = existing.length;
  const stageNonce = randomUUID();
  const stageDirectory = join(runDirectory, "stages", `${String(sequence).padStart(2, "0")}-${id}-${stageNonce.slice(0, 8)}`);
  await mkdir(stageDirectory, { recursive: false });
  const startedAt = new Date().toISOString();
  let exitCode = 0;
  let status = "passed";
  let action = null;
  let error = null;
  let guard = null;
  try {
    const current = await currentIdentityInputs({
      endpoint: identity.endpoint,
      profileRoot: identity.profile.root,
      bundleRoot: identity.build.bundle.root,
      sourceHead: identity.build.source.head,
    });
    const mismatches = compareIdentity(identity, current);
    if (mismatches.length) throw new Error(`Run identity changed after begin: ${JSON.stringify(mismatches)}`);
    const allTargets = await listLiveTargets(identity.endpoint);
    const targets = resolveLiveTargets(allTargets, identity.expectedUrl);
    guard = await PersistentPublicationGuardClient.connect(runDirectory, identity);
    action = await runStageAction({ id, options, identity, runDirectory, targets, guard });
    await guard.refresh({ freshAfterMs: Date.now() });
    action.data = {
      ...(action.data ?? {}),
      publicationFence: guard.publicationFenceEvidence(),
    };
    const acceptanceFailures = stageAcceptanceFailures(id, action, identity.implementation);
    if (acceptanceFailures.length) {
      exitCode = 1;
      status = "failed";
      error = `Stage acceptance failed: ${acceptanceFailures.join("; ")}`;
      action.data = { ...action.data, acceptanceFailures };
    }
  } catch (caught) {
    exitCode = 1;
    status = "failed";
    error = caught instanceof Error ? `${caught.name}: ${caught.message}\n${caught.stack ?? ""}` : String(caught);
  } finally {
    if (guard && !action?.data?.publicationFence) {
      action = {
        ...(action ?? {}),
        data: {
          ...(action?.data ?? {}),
          publicationFence: guard.publicationFenceEvidence(),
        },
      };
    }
  }
  const document = action?.document ?? null;
  const documentKey = document ? `document-${document.fingerprint.slice(0, 16)}` : null;
  const renderMode = action?.renderMode ?? null;
  const networkArtifacts = {};
  if (action?.data?.activationNetwork) {
    const path = join(runDirectory, "network", "activation-network.json");
    await writeJsonExclusive(path, { schemaVersion: "p25-live-network/v1", stage: id, entries: action.data.activationNetwork });
    networkArtifacts.activation = { path, sha256: sha256(JSON.stringify(action.data.activationNetwork)) };
  }
  if (action?.data?.network) {
    const path = join(runDirectory, "network", "workflow-network.json");
    await writeJsonExclusive(path, { schemaVersion: "p25-live-network/v1", stage: id, entries: action.data.network });
    networkArtifacts.workflow = { path, sha256: sha256(JSON.stringify(action.data.network)) };
  }
  if (action?.data?.publicationFence) {
    const path = join(runDirectory, "network", `${id}-publication-fence.json`);
    await writeJsonExclusive(path, { schemaVersion: "p25-live-publication-fence/v1", stage: id, ...action.data.publicationFence });
    networkArtifacts.publicationFence = { path, sha256: sha256(JSON.stringify(action.data.publicationFence)) };
  }
  const expectation = createStageExpectation({ runIdentity: identity, id, sequence, stageNonce, documentKey, renderMode });
  const stage = {
    ...expectation,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    exitCode,
    observedProcessExitCode: exitCode,
    documentFingerprint: document?.fingerprint ?? null,
    document,
    screenshots: action?.screenshots ?? {},
    networkArtifacts,
    data: action?.data ?? null,
    error,
  };
  const stagePath = join(stageDirectory, "stage.json");
  await writeJsonExclusive(stagePath, stage);
  process.stdout.write(`${JSON.stringify({ runDirectory, stagePath, id, status, exitCode, error }, null, 2)}\n`);
  process.exitCode = exitCode;
}

async function finalizeRun(options) {
  const { runDirectory, identity } = await loadRun(required(options, "run"));
  const records = await readStageRecords(runDirectory, identity);
  const documents = {};
  for (const { record } of records) if (record.documentKey && record.document) documents[record.documentKey] = record.document;
  const stages = records.map(({ directory, record, file }) => {
    const expected = createStageExpectation({
      runIdentity: identity,
      id: record.id,
      sequence: record.sequence,
      stageNonce: record.stageNonce,
      documentKey: record.documentKey,
      renderMode: record.renderMode,
    });
    const directoryCoherent = directory.endsWith(`-${record.stageNonce.slice(0, 8)}`) && directory.includes(`-${record.id}-`);
    const validation = validateStageRecord({
      stage: record,
      expected,
      runIdentity: identity,
      documents,
      fileMtimeMs: file.mtimeMs,
      observedExitCode: record.observedProcessExitCode,
    });
    if (!directoryCoherent) {
      validation.pass = false;
      validation.checks.push({ id: "stage-directory-coherence", pass: false, detail: { directory, stageNonce: record.stageNonce, id: record.id } });
    }
    if (record.interrupted === true) {
      validation.pass = false;
      validation.checks.push({ id: "interrupted-stage", pass: false, detail: { directory, id: record.id } });
    }
    return { ...record, validation };
  });
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  let candidateRecord;
  try {
    candidateRecord = await readAdoptedCandidateDisposition(runDirectory, identity, byId.get("preflight")?.document ?? null);
  } catch (error) {
    await stopPersistentPublicationGuard(runDirectory, identity).catch(() => undefined);
    throw error;
  }
  // All run/stage reads and validation happen while the daemon still guards
  // every extension target. Shutdown is the final external boundary, and the
  // returned snapshot is already stopped and fully drained.
  const finalGuardEvidence = await stopPersistentPublicationGuard(runDirectory, identity);
  const publicationAttempts = finalGuardEvidence.attempts;
  const markingVisual = byId.get("marking-visual")?.data?.visual ?? null;
  const aggregate = {
    schemaVersion: P25_LIVE_SCHEMA_VERSION,
    startedAt: identity.createdAt,
    finishedAt: new Date().toISOString(),
    identity,
    candidateDisposition: candidateRecord.candidateDisposition,
    documents,
    stages,
    probes: {
      cardinality: markingVisual ? {
        sourceCount: markingVisual.sourceCount,
        sourceFragmentCount: markingVisual.sourceFragmentCount,
        paintedRectCount: markingVisual.paintedRectCount,
        visibleLayerCount: markingVisual.visibleLayerCount,
        physicalHitCount: markingVisual.physicalHitCount,
        markableCandidateCount: markingVisual.markableCandidateCount,
      } : null,
      borders: markingVisual?.borders ?? [],
      layers: markingVisual?.layers ?? [],
      markingGestures: byId.get("marking-gestures")?.data?.gestures ?? null,
      markingScrollFade: byId.get("marking-scroll-fade")?.data?.scrollFade ?? null,
      markingResize: byId.get("marking-resize")?.data?.resize ?? null,
      silentScrollFade: byId.get("silent-scroll-fade")?.data?.scrollFade ?? null,
      silentResize: byId.get("silent-resize")?.data?.resize ?? null,
    },
    transitions: stages.map((stage) => ({
      id: stage.id,
      sequence: stage.sequence,
      startedAt: stage.startedAt,
      finishedAt: stage.finishedAt,
      status: stage.status,
      popup: stage.data?.popup ?? stage.data?.after ?? null,
    })),
    frames: stages.flatMap((stage) => {
      const values = [stage.data?.frames, stage.data?.scrollFade?.frames, stage.data?.resize?.frames].filter(Boolean);
      return values.map((value) => ({ stage: stage.id, path: value.path, sha256: value.sha256, rAF: value.requestAnimationFrame?.timing, worstLongTaskMs: value.requestAnimationFrame?.worstLongTaskMs, compositorFrames: value.compositor?.frameCount }));
    }),
    screenshots: Object.fromEntries(stages.map((stage) => [stage.id, stage.screenshots])),
    network: {
      activation: byId.get("activation-network")?.data?.activationNetwork ?? [],
      workflow: byId.get("workflow-summary")?.data?.network ?? [],
    },
    legacyLoadCompatibility: byId.get("activation-network")?.data?.legacyLoad ?? null,
    ai: byId.get("workflow-summary")?.data?.ai ?? {
      mode: "not-run",
      parityEligible: false,
      reason: "The workflow-summary stage is missing; no AI parity claim is permitted.",
    },
    workflow: byId.get("workflow-summary")?.data?.workflow ?? null,
    publicationFence: {
      installedBeforeActivation: Boolean(
        byId.get("activation-network")?.startedAt &&
        Date.parse(finalGuardEvidence.installedAt) <= Date.parse(byId.get("activation-network").startedAt)
      ),
      finalPublishForbidden: true,
      abortBeforeTransmission: true,
      dynamicCoverage: finalGuardEvidence.dynamicCoverage,
      extensionId: finalGuardEvidence.extensionId,
      attemptCount: publicationAttempts.length,
      attempts: publicationAttempts,
      errors: finalGuardEvidence.errors,
      coverageEvents: finalGuardEvidence.coverageEvents,
      installedAt: finalGuardEvidence.installedAt,
      stoppedAt: finalGuardEvidence.stoppedAt,
      evidenceArtifact: {
        path: publicationGuardPaths(runDirectory).evidence,
        sha256: sha256(JSON.stringify(finalGuardEvidence)),
      },
    },
  };
  const validation = validateRunAggregate(aggregate);
  const guardPass = finalGuardEvidence.dynamicCoverage === true && finalGuardEvidence.errors.length === 0;
  validation.checks.push({
    id: "persistent-publication-guard",
    pass: guardPass,
    detail: guardPass ? null : { dynamicCoverage: finalGuardEvidence.dynamicCoverage, errors: finalGuardEvidence.errors },
  });
  if (!guardPass) {
    validation.pass = false;
    validation.exitCode = 1;
  }
  aggregate.validation = validation;
  aggregate.overall = validation.pass
    ? aggregate.candidateDisposition.parityEligible ? "passed" : "n/a"
    : "failed";
  const outputPath = join(runDirectory, "aggregate.json");
  await writeJsonExclusive(outputPath, aggregate);
  process.stdout.write(`${JSON.stringify({ outputPath, overall: aggregate.overall, exitCode: validation.exitCode, failedChecks: validation.checks.filter((check) => !check.pass) }, null, 2)}\n`);
  process.exitCode = validation.exitCode;
}

function comparableDocumentFor(aggregate) {
  const preferred = aggregate.stages.find((stage) => stage.id === "preflight")?.document;
  return preferred ?? Object.values(aggregate.documents ?? {})[0] ?? null;
}

async function compareRuns(options) {
  const legacy = await readJson(resolve(REPO_ROOT, required(options, "legacy")));
  const rewrite = await readJson(resolve(REPO_ROOT, required(options, "rewrite")));
  const legacyDocument = comparableDocumentFor(legacy);
  const rewriteDocument = comparableDocumentFor(rewrite);
  const equivalent = Boolean(
    legacyDocument && rewriteDocument &&
    legacyDocument.normalizedUrl === rewriteDocument.normalizedUrl &&
    legacyDocument.comparableFingerprint === rewriteDocument.comparableFingerprint,
  );
  const pair = {
    schemaVersion: P25_LIVE_COMPARISON_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    label: legacy.identity?.label ?? rewrite.identity?.label ?? null,
    normalizedUrl: legacy.identity?.normalizedUrl ?? rewrite.identity?.normalizedUrl ?? null,
    runs: { legacy, rewrite },
    documentEquivalence: {
      equivalent,
      legacy: legacyDocument ? { fingerprint: legacyDocument.fingerprint, comparableFingerprint: legacyDocument.comparableFingerprint, normalizedUrl: legacyDocument.normalizedUrl } : null,
      rewrite: rewriteDocument ? { fingerprint: rewriteDocument.fingerprint, comparableFingerprint: rewriteDocument.comparableFingerprint, normalizedUrl: rewriteDocument.normalizedUrl } : null,
      reason: equivalent ? null : "Document URL/content/resource fingerprints differ; performance and cardinality parity are not comparable across these generations.",
    },
    aiParity: {
      claimed: legacy.ai?.mode === "measured-current-run" && rewrite.ai?.mode === "measured-current-run" && equivalent,
      legacyMode: legacy.ai?.mode ?? null,
      rewriteMode: rewrite.ai?.mode ?? null,
      retainedReferenceOnly: legacy.ai?.mode === "retained-reference-only" || rewrite.ai?.mode === "retained-reference-only",
    },
    comparison: {
      cardinality: {
        legacy: legacy.probes?.cardinality ?? null,
        rewrite: rewrite.probes?.cardinality ?? null,
      },
      markingGestureTiming: {
        legacy: legacy.probes?.markingGestures?.timing ?? null,
        rewrite: rewrite.probes?.markingGestures?.timing ?? null,
      },
      frames: {
        legacy: legacy.frames ?? [],
        rewrite: rewrite.frames ?? [],
      },
    },
    publicationContract: "Final Lynx publication is forbidden; any attempted /publish route is aborted before transmission and fails the pair.",
  };
  const validation = validateComparisonPair(pair);
  pair.validation = validation;
  const pairParityEligible = legacy.candidateDisposition?.parityEligible === true && rewrite.candidateDisposition?.parityEligible === true;
  pair.overall = validation.pass ? pairParityEligible ? "passed" : "n/a" : "failed";
  const outputDirectory = join(ARTIFACT_ROOT, "comparisons");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}-${safeArtifactLabel(pair.label)}.json`);
  await writeJsonExclusive(outputPath, pair);
  process.stdout.write(`${JSON.stringify({ outputPath, overall: pair.overall, exitCode: validation.exitCode, failedChecks: validation.checks.filter((check) => !check.pass) }, null, 2)}\n`);
  process.exitCode = validation.exitCode;
}

async function validateMatrix(options) {
  const buildVariant = required(options, "build-variant");
  if (!BUILD_VARIANTS.includes(buildVariant)) throw new Error(`--build-variant must be ${BUILD_VARIANTS.join(" or ")}`);
  const variantDisposition = matrixVariantDisposition(buildVariant);
  const paths = typeof options.comparisons === "string"
    ? options.comparisons.split(",").map((value) => resolve(REPO_ROOT, value.trim())).filter(Boolean)
    : [];
  if (buildVariant === "debug") {
    if (paths.length) throw new Error(`${LEGACY_DEBUG_UNAVAILABLE.reasonCode}: debug matrix accepts no pair artifacts because no authentic legacy debug baseline exists`);
    const output = {
      schemaVersion: "p25-live-comparison-matrix/v1",
      createdAt: new Date().toISOString(),
      buildVariant,
      overall: "n/a",
      comparisonCount: 0,
      failedLabels: [],
      missingEligible: [],
      dispositions: CANDIDATE_MATRIX.map((candidate) => ({
        label: candidate.label,
        url: candidate.url,
        eligibility: "n/a",
        reasonCode: LEGACY_DEBUG_UNAVAILABLE.reasonCode,
        reason: LEGACY_DEBUG_UNAVAILABLE.reason,
        comparisonArtifactPresent: false,
      })),
      variantDisposition,
      finalPublishForbidden: true,
      publishAttemptCount: 0,
    };
    const outputDirectory = join(ARTIFACT_ROOT, "comparisons");
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = join(outputDirectory, `${new Date().toISOString().replace(/[:.]/g, "-")}-debug-matrix.json`);
    await writeJsonExclusive(outputPath, output);
    process.stdout.write(`${JSON.stringify({ outputPath, ...output }, null, 2)}\n`);
    process.exitCode = 0;
    return;
  }
  if (!paths.length) throw new Error("Production matrix requires --comparisons with at least one production pair aggregate");
  const pairs = await Promise.all(paths.map(readJson));
  const matrixValidation = validateComparisonMatrix({ pairs, buildVariant });
  const observedLabels = new Set(pairs.map((pair) => pair.label));
  const dispositions = CANDIDATE_MATRIX.map((candidate) => ({
    label: candidate.label,
    url: candidate.url,
    eligibility: candidate.eligibility,
    reasonCode: candidate.unavailableReasonCode ?? null,
    reason: candidate.unavailableReason ?? null,
    comparisonArtifactPresent: observedLabels.has(candidate.label),
  }));
  const missingEligible = dispositions.filter((candidate) => matrixValidation.missingEligible.includes(candidate.label));
  const output = {
    schemaVersion: "p25-live-comparison-matrix/v1",
    createdAt: new Date().toISOString(),
    buildVariant,
    variantDisposition,
    overall: matrixValidation.pass ? "passed" : "failed",
    comparisonCount: pairs.length,
    failedLabels: matrixValidation.failedLabels,
    missingEligible,
    dispositions,
    finalPublishForbidden: true,
    publishAttemptCount: matrixValidation.publishAttemptCount,
    validation: matrixValidation,
  };
  const outputDirectory = join(ARTIFACT_ROOT, "comparisons");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${new Date().toISOString().replace(/[:.]/g, "-")}-matrix.json`);
  await writeJsonExclusive(outputPath, output);
  process.stdout.write(`${JSON.stringify({ outputPath, ...output }, null, 2)}\n`);
  process.exitCode = output.overall === "passed" ? 0 : 1;
}

function usage() {
  return `P25 live comparison (use only with a browser started by pnpm browser:live)

begin   --implementation legacy|rewrite --label <candidate> --url <url> --build-variant production|debug [--bundle-root <path>] [--profile-root <path>]
stage   --run <run-directory> --id <stage-id> [stage-specific evidence options]
finalize --run <run-directory>
compare --legacy <legacy-aggregate.json> --rewrite <rewrite-aggregate.json>
matrix  --comparisons <pair.json,pair.json,...>
        --build-variant production
matrix  --build-variant debug  # explicit N/A: no authentic legacy debug baseline

Required stage order:
${REQUIRED_LIVE_STAGE_IDS.map((id, index) => `  ${String(index).padStart(2, "0")} ${id}`).join("\n")}

The harness never launches Chromium and never clicks the final Lynx publication action. begin starts a run-lifetime browser-level guard; every current or restarted extension-target /publish request is failed at CDP Fetch Request stage and counted as a failing attempt until finalize records guarded shutdown.`;
}

const { command, options } = parseArgs(process.argv.slice(2));
try {
  if (command === "guard-daemon") await runPublicationGuardDaemon(options);
  else if (command === "begin") await beginRun(options);
  else if (command === "stage") await captureStage(options);
  else if (command === "finalize") await finalizeRun(options);
  else if (command === "compare") await compareRuns(options);
  else if (command === "matrix") await validateMatrix(options);
  else {
    process.stdout.write(`${usage()}\n`);
    if (command && command !== "help" && command !== "--help") process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
