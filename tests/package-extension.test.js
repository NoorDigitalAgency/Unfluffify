import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

test("package script stages runtime files and excludes repo-only files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "unfluffify-package-test-"));
  const stageDir = path.join(tempDir, "stage");
  const metadataPath = path.join(tempDir, "metadata.json");

  try {
    await execFileAsync(process.execPath, [
      "./scripts/package-extension.mjs",
      "--timestamp",
      "240101-1200",
      "--stage-dir",
      stageDir,
      "--metadata-file",
      metadataPath
    ], {
      cwd: REPO_ROOT
    });

    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    const stagedManifest = JSON.parse(await fs.readFile(path.join(stageDir, "manifest.json"), "utf8"));

    assert.equal(metadata.archiveFileName, "Unfluffify-v1.1.0-240101-1200.zip");
    assert.equal(metadata.latestAliasFileName, "Unfluffify-latest.zip");
    assert.equal(metadata.releaseTag, "extension-latest");
    assert.equal(metadata.version, stagedManifest.version);
    assert.equal(metadata.stageDir, stageDir);

    assert.equal(metadata.stagedFiles.includes("manifest.json"), true);
    assert.equal(metadata.stagedFiles.includes("background.js"), true);
    assert.equal(metadata.stagedFiles.includes("content-main.js"), true);
    assert.equal(metadata.stagedFiles.includes("common/page-telemetry.js"), true);
    assert.equal(metadata.stagedFiles.includes("remote-support-viewer.html"), true);
    assert.equal(metadata.stagedFiles.includes("icons/default/icon16.png"), true);

    assert.equal(metadata.stagedFiles.includes("README.md"), false);
    assert.equal(metadata.stagedFiles.includes(".github/workflows/build-extension-package.yml"), false);
    assert.equal(metadata.stagedFiles.some((filePath) => filePath.startsWith("tests/")), false);

    await fs.access(path.join(stageDir, "common/page-telemetry.js"));
    await fs.access(path.join(stageDir, "icons/default/icon128.png"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});