import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_LIVE_BUILD_ATTESTATION_SCHEMA_VERSION,
  BROWSER_LIVE_PROVENANCE_SCHEMA_VERSION,
  normalizedBundleInventory,
  validateBrowserLiveProvenance,
  validateBundleInventoryAttestation,
} from "../scripts/performance/p25/bundle-provenance.mjs";

const repoRoot = new URL("../", import.meta.url);
const launcher = await readFile(new URL("scripts/launch-test-browser.mjs", repoRoot), "utf8");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("browser:live destructive and identity safety", () => {
  it("redacts popup input values and reports only presence plus updated ids", () => {
    const stateCollector = launcher.slice(
      launcher.indexOf("async function collectPopupState()"),
      launcher.indexOf("if (action === 'click'"),
    );
    expect(stateCollector).toContain("valuePresent: String(input.value || '').length > 0");
    expect(stateCollector).not.toMatch(/\bvalue:\s*(?:String\()?input\.value/);
    expect(launcher).toContain("return { action, updatedInputIds: Object.keys(inputValues), state };");
    expect(launcher).not.toContain("return { action, inputValues, state };");
  });

  it("proves exclusive launcher, profile, port, browser, extension, and target ownership", () => {
    const preflightLock = launcher.indexOf("await acquireLauncherLock()");
    const preflightPort = launcher.indexOf("await assertCdpPortAvailable()", preflightLock);
    const drop = launcher.indexOf("await dropServiceWorkerRegistration()");
    const finalProfileProof = launcher.lastIndexOf("await assertProfileNotInUse()", drop);
    const browserSpawn = launcher.indexOf("spawnManagedChromium(managedChromiumExecutable", drop);
    expect(preflightLock).toBeGreaterThan(0);
    expect(preflightPort).toBeGreaterThan(preflightLock);
    expect(finalProfileProof).toBeGreaterThan(preflightPort);
    expect(finalProfileProof).toBeLessThan(drop);
    expect(browserSpawn).toBeGreaterThan(drop);
    expect(launcher).toContain('join(PROFILE_DIR, "SingletonLock")');
    expect(launcher).toContain("if (processAlive(pid))");
    expect(launcher).toContain("if (identity.pid !== browserProcess.pid)");
    expect(launcher).toContain("startsWith(`chrome-extension://${expectedExtensionId}/`)");
    expect(launcher).toContain("String(targetInfo?.id ?? \"\") === String(targetId)");
    expect(launcher).toContain("__UF_BROWSER_LIVE_TARGET_");
    expect(launcher).toContain("proven.length === 1 ? proven[0].id : null");
  });

  it("constrains bundle recovery markers and preserves concurrent canonical builds", () => {
    expect(launcher).toContain('const BUNDLE_SWAP_SCHEMA = "browser-live-bundle-swap/v2"');
    expect(launcher).not.toContain('marker?.schemaVersion === "browser-live-bundle-swap/v1"');
    expect(launcher).toContain("dirname(marker.backupRoot) === TEMP_DIR");
    expect(launcher).toContain("!isPathWithin(EXT_DIR, marker.sourceRoot)");
    expect(launcher).toContain("canonicalFingerprint !== marker.stagedFingerprint");
    expect(launcher).toContain('marker.phase = "preserving-concurrent"');
    expect(launcher).toContain("kept it and preserved the pre-run bundle");
  });

  it("documents only exact-process cleanup and clean restart after rebuild", async () => {
    const skills = await Promise.all([
      ".github/skills/live-browser/SKILL.md",
      ".github/skills/live-round/SKILL.md",
      ".github/skills/live-watch/SKILL.md",
    ].map((path) => readFile(new URL(path, repoRoot), "utf8")));
    for (const skill of skills) {
      expect(skill).not.toMatch(/\bpkill\s+(?:-[^\s]+\s+)?["']/);
      expect(skill).not.toMatch(/(?:await\s+|void\s+|;\s*)chrome\.runtime\.reload\s*\(/);
    }
    expect(skills[0]).toContain("Restart after every rebuild");
    expect(skills[1]).toContain("pnpm dev:no-browser");
    expect(skills[1]).toContain("must perform its own current-source `pnpm build`");
  });
});

describe("browser:live attestation and launch provenance", () => {
  it("rejects a rewrite bundle changed after its trusted no-build inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "browser-live-rewrite-"));
    temporaryRoots.push(root);
    await writeFile(join(root, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Rewrite", version: "2.0.0" }));
    await writeFile(join(root, "background.js"), "const current = true;\n");
    const inventory = await normalizedBundleInventory(root);
    const attestation = {
      schemaVersion: BROWSER_LIVE_BUILD_ATTESTATION_SCHEMA_VERSION,
      implementation: "rewrite",
      source: { head: "a".repeat(40), tree: "b".repeat(40), packageLockSha256: "c".repeat(64), buildCommand: "pnpm build" },
      bundle: {
        schemaVersion: inventory.schemaVersion,
        normalization: inventory.normalization,
        normalizedManifestVersion: inventory.normalizedManifestVersion,
        inventoryDigest: inventory.inventoryDigest,
        fileCount: inventory.fileCount,
        bytes: inventory.bytes,
      },
    };
    expect(validateBundleInventoryAttestation(inventory, attestation).pass).toBe(true);
    await writeFile(join(root, "background.js"), "const current = false;\n");
    expect(validateBundleInventoryAttestation(await normalizedBundleInventory(root), attestation).failures)
      .toEqual(expect.arrayContaining(["inventory-digest"]));
  });

  it("atomically emits only a fresh runtime-bound record and rejects stale or mismatched evidence", () => {
    const observed = {
      implementation: "rewrite",
      source: { head: "a".repeat(40), tree: "b".repeat(40), clean: true, statusDigest: "c".repeat(64), lockfile: "pnpm-lock.yaml", packageLockSha256: "d".repeat(64), buildCommand: "pnpm build", attestationSchema: BROWSER_LIVE_BUILD_ATTESTATION_SCHEMA_VERSION },
      bundle: { canonicalRoot: "/repo/.output/chrome-mv3", inventoryDigest: "e".repeat(64), fileCount: 2, bytes: 200, manifestVersion: "2.0.0.8", normalizedManifestVersion: "2.0.0" },
      browser: { instanceNonce: "f".repeat(32), fingerprint: "1".repeat(64), product: "Chrome/140", cdpPort: 9222 },
      profile: { root: "/repo/.wxt/browser-profile", pathDigest: "2".repeat(64) },
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      target: { requestedUrl: "https://example.com/", normalizedUrl: "https://example.com/", cdpTargetId: "target-one", tabId: 7 },
    };
    const createdAt = "2026-08-28T18:00:00.000Z";
    const provenance = {
      schemaVersion: BROWSER_LIVE_PROVENANCE_SCHEMA_VERSION,
      launchNonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdAt,
      ...observed,
      browser: { pid: 1234, ...observed.browser },
    };
    const nowMs = Date.parse(createdAt) + 1;
    expect(validateBrowserLiveProvenance(provenance, observed, { nowMs, fileMtimeMs: Date.parse(createdAt), pidAlive: true }).pass).toBe(true);
    expect(validateBrowserLiveProvenance(provenance, observed, { nowMs, fileMtimeMs: Date.parse(createdAt) - 1, pidAlive: true }).failures)
      .toContain("fresh-file-mtime");
    expect(validateBrowserLiveProvenance(provenance, {
      ...observed,
      browser: { ...observed.browser, instanceNonce: "9".repeat(32) },
      target: { ...observed.target, cdpTargetId: "target-two" },
    }, { nowMs, fileMtimeMs: Date.parse(createdAt), pidAlive: true }).failures)
      .toEqual(expect.arrayContaining(["browser-instanceNonce", "target-cdpTargetId"]));

    const operatorProof = launcher.indexOf("const operatorSurface = await openOperatorSurface");
    const provenanceWrite = launcher.indexOf("await writeLaunchProvenance", operatorProof);
    expect(provenanceWrite).toBeGreaterThan(operatorProof);
    expect(launcher).toContain("await writeJsonAtomic(LAUNCH_PROVENANCE, provenance)");
    expect(launcher.indexOf("await rm(LAUNCH_PROVENANCE", launcher.indexOf("await acquireLauncherLock()"))).toBeGreaterThan(0);
  });
});
