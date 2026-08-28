import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLE_INVENTORY_SCHEMA_VERSION,
  BUNDLE_MANIFEST_NORMALIZATION,
  BROWSER_LIVE_PROVENANCE_SCHEMA_VERSION,
  PINNED_BUILD_COMMAND,
  PINNED_LEGACY_ATTESTATION_SCHEMA_VERSION,
  PINNED_LEGACY_HEAD,
  PINNED_LEGACY_PACKAGE_LOCK_SHA256,
  PINNED_LEGACY_TREE,
  normalizedBundleInventory,
  pinnedLegacyAttestationFailures,
  validateBundleInventoryAttestation,
  validateBrowserLiveProvenance,
} from "../scripts/performance/p25/bundle-provenance.mjs";

const temporaryRoots: string[] = [];

async function fixture(version = "1.10.0") {
  const root = await mkdtemp(join(tmpdir(), "p25-bundle-provenance-"));
  temporaryRoots.push(root);
  await writeFile(join(root, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Legacy", version }));
  await writeFile(join(root, "background.js"), "const exact = true;\n");
  return root;
}

function attestation(inventory: Awaited<ReturnType<typeof normalizedBundleInventory>>) {
  return {
    schemaVersion: PINNED_LEGACY_ATTESTATION_SCHEMA_VERSION,
    implementation: "legacy",
    source: {
      head: PINNED_LEGACY_HEAD,
      tree: PINNED_LEGACY_TREE,
      lockfile: "pnpm-lock.yaml",
      packageLockSha256: PINNED_LEGACY_PACKAGE_LOCK_SHA256,
      buildCommand: PINNED_BUILD_COMMAND,
    },
    bundle: {
      schemaVersion: BUNDLE_INVENTORY_SCHEMA_VERSION,
      normalization: BUNDLE_MANIFEST_NORMALIZATION,
      normalizedManifestVersion: inventory.normalizedManifestVersion,
      inventoryDigest: inventory.inventoryDigest,
      fileCount: inventory.fileCount,
      bytes: inventory.bytes,
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("P25 bundle provenance", () => {
  it("tracks the exact reproducible pinned legacy authority", async () => {
    const tracked = JSON.parse(await readFile(new URL("../scripts/performance/p25/pinned-legacy-bundle-attestation.json", import.meta.url), "utf8"));
    expect(tracked).toMatchObject({
      schemaVersion: PINNED_LEGACY_ATTESTATION_SCHEMA_VERSION,
      implementation: "legacy",
      source: {
        head: PINNED_LEGACY_HEAD,
        tree: PINNED_LEGACY_TREE,
        lockfile: "pnpm-lock.yaml",
        packageLockSha256: PINNED_LEGACY_PACKAGE_LOCK_SHA256,
        buildCommand: PINNED_BUILD_COMMAND,
      },
      bundle: {
        normalization: BUNDLE_MANIFEST_NORMALIZATION,
        normalizedManifestVersion: "1.10.0",
        inventoryDigest: "886c12365e10d8cba98a64afcdda234924804fb4c555c50f807c026577f6c69e",
        fileCount: 39,
        bytes: 4393227,
      },
      reproduction: { consecutiveBuildCount: 2, consecutiveBuildsMatched: true },
    });
  });

  it("normalizes only a numeric fourth-component launch counter", async () => {
    const base = await fixture("1.10.0");
    const stamped = await fixture("1.10.0.65535");
    const baseInventory = await normalizedBundleInventory(base);
    const stampedInventory = await normalizedBundleInventory(stamped);

    expect(stampedInventory.inventoryDigest).toBe(baseInventory.inventoryDigest);
    expect(stampedInventory.normalizedManifestVersion).toBe("1.10.0");
    await writeFile(join(stamped, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Tampered", version: "1.10.0.7" }));
    expect((await normalizedBundleInventory(stamped)).inventoryDigest).not.toBe(baseInventory.inventoryDigest);
    await writeFile(join(stamped, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Legacy", version: "1.10.0.beta" }));
    await expect(normalizedBundleInventory(stamped)).rejects.toThrow(/optional numeric launch counter/);
  });

  it("rejects tampered bundle files and attested source authority", async () => {
    const root = await fixture();
    const inventory = await normalizedBundleInventory(root);
    const trusted = attestation(inventory);
    expect(pinnedLegacyAttestationFailures(trusted, inventory)).toEqual([]);

    await writeFile(join(root, "background.js"), `${await readFile(join(root, "background.js"), "utf8")}/* tampered */`);
    const tamperedInventory = await normalizedBundleInventory(root);
    expect(validateBundleInventoryAttestation(tamperedInventory, trusted).failures)
      .toEqual(expect.arrayContaining(["inventory-digest", "inventory-bytes"]));

    expect(pinnedLegacyAttestationFailures({
      ...trusted,
      source: { ...trusted.source, head: "f".repeat(40), tree: "e".repeat(40), packageLockSha256: "a".repeat(64), buildCommand: "pnpm build:debug" },
    }, inventory)).toEqual(expect.arrayContaining(["source-head", "source-tree", "package-lock", "build-command"]));
  });

  it("binds rewrite provenance to the exact source, runtime, profile, target, and normalized bundle", async () => {
    const root = await fixture("2.0.0.81");
    const inventory = await normalizedBundleInventory(root);
    const observed = {
      implementation: "rewrite",
      source: {
        head: "b".repeat(40),
        tree: "c".repeat(40),
        clean: true,
        statusDigest: "d".repeat(64),
        lockfile: "pnpm-lock.yaml",
        packageLockSha256: "e".repeat(64),
        buildCommand: "pnpm build",
        attestationSchema: "browser-live-build-attestation/v1",
      },
      bundle: {
        canonicalRoot: root,
        inventoryDigest: inventory.inventoryDigest,
        fileCount: inventory.fileCount,
        bytes: inventory.bytes,
        manifestVersion: inventory.manifestVersion,
        normalizedManifestVersion: inventory.normalizedManifestVersion,
      },
      browser: { instanceNonce: "f".repeat(32), fingerprint: "1".repeat(64), product: "Chrome/140", cdpPort: 9222 },
      profile: { root: "/tmp/profile", pathDigest: "2".repeat(64) },
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      target: { requestedUrl: "https://www.dpj.se/", normalizedUrl: "https://www.dpj.se/", cdpTargetId: "target-one", tabId: 7 },
    };
    const provenance = {
      schemaVersion: BROWSER_LIVE_PROVENANCE_SCHEMA_VERSION,
      launchNonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdAt: "2026-08-28T10:00:00.000Z",
      implementation: observed.implementation,
      source: observed.source,
      bundle: observed.bundle,
      browser: { pid: 1234, ...observed.browser },
      profile: observed.profile,
      extensionId: observed.extensionId,
      target: observed.target,
    };
    expect(validateBrowserLiveProvenance(provenance, observed, {
      nowMs: Date.parse(provenance.createdAt) + 1,
      fileMtimeMs: Date.parse(provenance.createdAt),
      pidAlive: true,
    }).pass).toBe(true);

    await writeFile(join(root, "background.js"), "const exact = false;\n");
    const modifiedInventory = await normalizedBundleInventory(root);
    const modified = {
      ...observed,
      bundle: { ...observed.bundle, inventoryDigest: modifiedInventory.inventoryDigest, bytes: modifiedInventory.bytes },
    };
    const validation = validateBrowserLiveProvenance(provenance, modified, {
      nowMs: Date.parse(provenance.createdAt) + 1,
      fileMtimeMs: Date.parse(provenance.createdAt),
      pidAlive: true,
    });
    expect(validation.pass).toBe(false);
    expect(validation.failures).toEqual(expect.arrayContaining(["bundle-inventoryDigest", "bundle-bytes"]));

    expect(validateBrowserLiveProvenance({
      ...provenance,
      source: { ...provenance.source, head: "9".repeat(40) },
      browser: { ...provenance.browser, instanceNonce: "8".repeat(32) },
    }, observed, {
      nowMs: Date.parse(provenance.createdAt) + 1,
      fileMtimeMs: Date.parse(provenance.createdAt),
      pidAlive: false,
    }).failures).toEqual(expect.arrayContaining(["source-head", "browser-instanceNonce", "browser-pid-alive"]));
  });
});
