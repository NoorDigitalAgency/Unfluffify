import { assert, test } from "./test-kit.ts";
import { fileURLToPath, mkdtemp, path, readFileSync, rm } from "./file-kit.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function runCommand(args, cwd) {
  const command = new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped"
  });
  const result = await command.output();
  if (result.code !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout);
}

test("package script stages runtime files and excludes repo-only files", async () => {
  const tempDir = await mkdtemp("unfluffify-package-test-");
  const stageDir = path.join(tempDir, "stage");
  const metadataPath = path.join(tempDir, "metadata.json");

  try {
    await runCommand(["task", "build:release"], REPO_ROOT);

    await runCommand([
      "run",
      "-A",
      "./scripts/package-extension.mjs",
      "--source-root",
      "dist/extension",
      "--timestamp",
      "240101-1200",
      "--stage-dir",
      stageDir,
      "--metadata-file",
      metadataPath
    ], REPO_ROOT);

    const metadata = JSON.parse(readFileSync(metadataPath));
    const stagedManifest = JSON.parse(readFileSync(path.join(stageDir, "manifest.json")));

    assert.equal(metadata.archiveFileName, "Unfluffify-v1.2.0-240101-1200.zip");
    assert.equal(metadata.latestAliasFileName, "Unfluffify-latest.zip");
    assert.equal(metadata.versionLatestAliasFileName, "Unfluffify-v1.2.0-latest.zip");
    assert.equal(metadata.releaseTag, "extension-latest");
    assert.equal(metadata.version, stagedManifest.version);
    assert.equal(metadata.originalVersion, "1.2.0");
    assert.equal(metadata.releaseDisplayVersion, null);
    assert.equal(metadata.stageDir, stageDir);

    assert.equal(metadata.stagedFiles.includes("manifest.json"), true);
    assert.equal(metadata.stagedFiles.includes("background.js"), true);
    assert.equal(metadata.stagedFiles.includes("content-main.js"), true);
    assert.equal(metadata.stagedFiles.includes("popup.js"), true);
    assert.equal(metadata.stagedFiles.includes("common/config.js"), true);
    assert.equal(metadata.stagedFiles.includes("icons/default/icon16.png"), true);

    assert.equal(metadata.stagedFiles.includes("README.md"), false);
    assert.equal(metadata.stagedFiles.includes(".github/workflows/build-extension-package.yml"), false);
    assert.equal(metadata.stagedFiles.some((filePath) => filePath.startsWith("tests/")), false);

    await Deno.stat(path.join(stageDir, "common/config.js"));
    await Deno.stat(path.join(stageDir, "icons/default/icon128.png"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("package script adds a release-only build display version to the staged manifest", async () => {
  const tempDir = await mkdtemp("unfluffify-package-build-version-test-");
  const stageDir = path.join(tempDir, "stage");
  const metadataPath = path.join(tempDir, "metadata.json");

  try {
    await runCommand(["task", "build:release"], REPO_ROOT);

    await runCommand([
      "run",
      "-A",
      "./scripts/package-extension.mjs",
      "--source-root",
      "dist/extension",
      "--timestamp",
      "240101-1200",
      "--build-version",
      "2605122318",
      "--stage-dir",
      stageDir,
      "--metadata-file",
      metadataPath
    ], REPO_ROOT);

    const metadata = JSON.parse(readFileSync(metadataPath));
    const stagedManifest = JSON.parse(readFileSync(path.join(stageDir, "manifest.json")));

    assert.equal(metadata.version, "1.2.0");
    assert.equal(metadata.originalVersion, "1.2.0");
    assert.equal(metadata.releaseDisplayVersion, "1.2.0.2605122318");
    assert.equal(stagedManifest.version, "1.2.0");
    assert.equal(stagedManifest.version_name, "1.2.0.2605122318");
    assert.equal(metadata.archiveFileName, "Unfluffify-v1.2.0-240101-1200.zip");
    assert.equal(metadata.versionLatestAliasFileName, "Unfluffify-v1.2.0-latest.zip");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});