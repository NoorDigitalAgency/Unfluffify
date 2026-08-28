import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";

export const BUNDLE_INVENTORY_SCHEMA_VERSION = "browser-live-bundle-inventory/v1";
export const BUNDLE_MANIFEST_NORMALIZATION = "manifest-version-launch-counter-only/v1";
export const PINNED_LEGACY_ATTESTATION_SCHEMA_VERSION = "p25-pinned-legacy-bundle-attestation/v1";
export const BROWSER_LIVE_BUILD_ATTESTATION_SCHEMA_VERSION = "browser-live-build-attestation/v1";
export const BROWSER_LIVE_PROVENANCE_SCHEMA_VERSION = "browser-live-provenance/v1";
export const BROWSER_LIVE_PROVENANCE_RELATIVE_PATH = ".temp/browser-live-provenance.json";
export const PINNED_LEGACY_HEAD = "28974c2a0c859c91a7167f4757cf84a47ea31e28";
export const PINNED_LEGACY_TREE = "ebfb2f160763e3acc3331e62f9824ac18d45fcad";
export const PINNED_LEGACY_PACKAGE_LOCK_SHA256 = "16e388025ae49f0292b8153a099580e07606610d5d7f104e7f78c489796307f6";
export const PINNED_BUILD_COMMAND = "pnpm build";
export const SOURCE_LOCKFILE = "pnpm-lock.yaml";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function normalizedManifest(content) {
  let manifest;
  try {
    manifest = JSON.parse(content.toString("utf8"));
  } catch (error) {
    throw new Error(`Extension manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const observedVersion = manifest?.version;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(observedVersion ?? ""));
  if (!match) throw new Error(`Extension manifest version is not a base version with an optional numeric launch counter: ${JSON.stringify(observedVersion)}`);
  const normalizedVersion = `${match[1]}.${match[2]}.${match[3]}`;
  return {
    observedVersion,
    normalizedVersion,
    // The launcher serializes the parsed manifest when it adds its fourth version
    // component. Re-serializing here removes only that launcher-owned component
    // from the semantic inventory; every other manifest field/value remains part
    // of the attested bytes and a reordered property remains detectable.
    content: Buffer.from(JSON.stringify({ ...manifest, version: normalizedVersion })),
  };
}

export async function normalizedBundleInventory(bundleRoot) {
  const root = await realpath(bundleRoot);
  const paths = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Bundle inventory does not permit symbolic links: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error(`Bundle inventory does not permit special filesystem entries: ${path}`);
    }
  };
  await visit(root);
  if (paths.length === 0) throw new Error(`Bundle root is empty: ${root}`);

  let manifestVersion = null;
  let normalizedManifestVersion = null;
  const files = [];
  for (const path of paths) {
    const name = relative(root, path).replaceAll("\\", "/");
    const raw = await readFile(path);
    let content = raw;
    if (name === "manifest.json") {
      const normalized = normalizedManifest(raw);
      manifestVersion = normalized.observedVersion;
      normalizedManifestVersion = normalized.normalizedVersion;
      content = normalized.content;
    }
    files.push({ path: name, bytes: content.length, sha256: sha256(content) });
  }
  if (manifestVersion === null) throw new Error(`Bundle root has no manifest.json: ${root}`);
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const inventoryDigest = sha256(JSON.stringify({
    schemaVersion: BUNDLE_INVENTORY_SCHEMA_VERSION,
    normalization: BUNDLE_MANIFEST_NORMALIZATION,
    files,
  }));
  return {
    schemaVersion: BUNDLE_INVENTORY_SCHEMA_VERSION,
    normalization: BUNDLE_MANIFEST_NORMALIZATION,
    root,
    manifestVersion,
    normalizedManifestVersion,
    inventoryDigest,
    fileCount: files.length,
    bytes,
    files,
  };
}

export function validateBundleInventoryAttestation(inventory, attestation, expected = {}) {
  const failures = [];
  const check = (condition, id) => { if (!condition) failures.push(id); };
  check(inventory?.schemaVersion === BUNDLE_INVENTORY_SCHEMA_VERSION, "inventory-schema");
  check(inventory?.normalization === BUNDLE_MANIFEST_NORMALIZATION, "inventory-normalization");
  check(attestation?.bundle?.schemaVersion === BUNDLE_INVENTORY_SCHEMA_VERSION, "attestation-inventory-schema");
  check(attestation?.bundle?.normalization === BUNDLE_MANIFEST_NORMALIZATION, "attestation-normalization");
  check(attestation?.bundle?.inventoryDigest === inventory?.inventoryDigest, "inventory-digest");
  check(attestation?.bundle?.fileCount === inventory?.fileCount, "inventory-file-count");
  check(attestation?.bundle?.bytes === inventory?.bytes, "inventory-bytes");
  check(attestation?.bundle?.normalizedManifestVersion === inventory?.normalizedManifestVersion, "manifest-version");
  if (expected.implementation !== undefined) check(attestation?.implementation === expected.implementation, "implementation");
  if (expected.head !== undefined) check(attestation?.source?.head === expected.head, "source-head");
  if (expected.tree !== undefined) check(attestation?.source?.tree === expected.tree, "source-tree");
  if (expected.packageLockSha256 !== undefined) check(attestation?.source?.packageLockSha256 === expected.packageLockSha256, "package-lock");
  if (expected.buildCommand !== undefined) check(attestation?.source?.buildCommand === expected.buildCommand, "build-command");
  return { pass: failures.length === 0, failures };
}

export function pinnedLegacyAttestationFailures(attestation, inventory) {
  const validation = validateBundleInventoryAttestation(inventory, attestation, {
    implementation: "legacy",
    head: PINNED_LEGACY_HEAD,
    tree: PINNED_LEGACY_TREE,
    packageLockSha256: PINNED_LEGACY_PACKAGE_LOCK_SHA256,
    buildCommand: PINNED_BUILD_COMMAND,
  });
  const failures = [...validation.failures];
  if (attestation?.schemaVersion !== PINNED_LEGACY_ATTESTATION_SCHEMA_VERSION) failures.push("attestation-schema");
  if (attestation?.source?.lockfile !== SOURCE_LOCKFILE) failures.push("source-lockfile");
  return [...new Set(failures)];
}

export function validateBrowserLiveProvenance(provenance, observed, options = {}) {
  const failures = [];
  const check = (condition, id) => { if (!condition) failures.push(id); };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const createdAtMs = Date.parse(provenance?.createdAt);
  const nowMs = options.nowMs ?? Date.now();
  check(provenance?.schemaVersion === BROWSER_LIVE_PROVENANCE_SCHEMA_VERSION, "schema");
  check(typeof provenance?.launchNonce === "string" && /^[a-f0-9-]{16,80}$/i.test(provenance.launchNonce), "launch-nonce");
  check(Number.isFinite(createdAtMs) && createdAtMs <= nowMs, "created-at");
  if (options.fileMtimeMs !== undefined) check(Number.isFinite(options.fileMtimeMs) && options.fileMtimeMs >= createdAtMs, "fresh-file-mtime");
  if (options.pidAlive !== undefined) check(options.pidAlive === true, "browser-pid-alive");
  check(provenance?.implementation === observed?.implementation, "implementation");
  for (const key of ["head", "tree", "clean", "statusDigest", "lockfile", "packageLockSha256", "buildCommand", "attestationSchema"]) {
    check(same(provenance?.source?.[key] ?? null, observed?.source?.[key] ?? null), `source-${key}`);
  }
  for (const key of ["canonicalRoot", "inventoryDigest", "fileCount", "bytes", "manifestVersion", "normalizedManifestVersion"]) {
    check(same(provenance?.bundle?.[key] ?? null, observed?.bundle?.[key] ?? null), `bundle-${key}`);
  }
  for (const key of ["instanceNonce", "fingerprint", "product", "cdpPort"]) {
    check(same(provenance?.browser?.[key] ?? null, observed?.browser?.[key] ?? null), `browser-${key}`);
  }
  check(Number.isInteger(provenance?.browser?.pid) && provenance.browser.pid > 0, "browser-pid");
  for (const key of ["root", "pathDigest"]) {
    check(same(provenance?.profile?.[key] ?? null, observed?.profile?.[key] ?? null), `profile-${key}`);
  }
  check(provenance?.extensionId === observed?.extensionId, "extension-id");
  for (const key of ["requestedUrl", "normalizedUrl", "cdpTargetId", "tabId"]) {
    check(same(provenance?.target?.[key] ?? null, observed?.target?.[key] ?? null), `target-${key}`);
  }
  return { pass: failures.length === 0, failures: [...new Set(failures)] };
}
