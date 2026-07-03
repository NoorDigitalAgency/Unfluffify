#!/usr/bin/env node

// Produce the SHIPPABLE, version-named extension zip locally — the same
// artifact the `build-extension-package` CI workflow uploads to the release.
// It reuses the exact staging engine (scripts/package-extension.mjs, where the
// active-icons staging fix lives) so the local zip matches CI's, then archives
// the staged tree with scripts/create-output-zip.mjs (the shared cross-platform
// zipper). Run `pnpm build` first (this reads the built manifest); the pnpm
// `deploy:zip` script chains that for you.
//
// Output: .output/Unfluffify-v<version>-<timestamp>.zip (canonical, matches CI)
//     and .output/Unfluffify-v<version>-latest.zip       (clean version alias)

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const BUILT_MANIFEST = join(REPO_ROOT, ".output", "chrome-mv3", "manifest.json");
const STAGE_DIR = join(REPO_ROOT, ".output", ".package-stage");
const METADATA_FILE = join(REPO_ROOT, ".output", ".package-metadata.json");
const OUTPUT_DIR = join(REPO_ROOT, ".output");

if (!existsSync(BUILT_MANIFEST)) {
  console.error(
    "No built extension found at .output/chrome-mv3. Run `pnpm build` first (or use `pnpm deploy:zip`, which does)."
  );
  process.exit(1);
}

// Mirror the CI timestamp/build-version scheme: yymmdd-HHMM (UTC), build
// version is the same with the separator dropped.
const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const timestamp =
  `${pad(now.getUTCFullYear() % 100)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
  `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
const buildVersion = timestamp.replace("-", "");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message || String(result.error));
    process.exit(1);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

// Clean any prior staging so the archive only contains this run's files.
rmSync(STAGE_DIR, { recursive: true, force: true });
rmSync(METADATA_FILE, { force: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

// Stage the manifest-referenced files (+ the active icon sets) exactly as CI.
run("node", [
  "./scripts/package-extension.mjs",
  "--timestamp", timestamp,
  "--build-version", buildVersion,
  "--stage-dir", STAGE_DIR,
  "--metadata-file", METADATA_FILE,
]);

const metadata = JSON.parse(readFileSync(METADATA_FILE, "utf8"));
const archivePath = join(OUTPUT_DIR, metadata.archiveFileName);
const versionLatestPath = join(OUTPUT_DIR, metadata.versionLatestAliasFileName);

// Archive the staged tree to the canonical versioned name, then copy to the
// clean version-latest alias (both are what CI publishes for the release).
run("node", ["./scripts/create-output-zip.mjs", STAGE_DIR, archivePath]);
copyFileSync(archivePath, versionLatestPath);

// Leave only the artifacts behind.
rmSync(STAGE_DIR, { recursive: true, force: true });
rmSync(METADATA_FILE, { force: true });

console.log("");
console.log(`Deployed versioned extension zip (manifest ${metadata.releaseDisplayVersion}):`);
console.log(`  ${archivePath}`);
console.log(`  ${versionLatestPath}`);
