import { assert, test } from "./test-kit.ts";
import { execFile, existsSync, fileURLToPath, mkdtemp, path, readFileSync, rm } from "./file-kit.ts";
import { ensureBuildOutput } from "./build-output-kit.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
// The packaged version follows package.json — read it so version bumps do
// not break the packaging contracts.
const PACKAGE_VERSION = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "package.json"))
).version;
const PACKAGE_BUILD_TIMEOUT_MS = 45_000;
const NODE_EXECUTABLE = process.execPath;

async function runCommand(command, args, cwd) {
  const result = await execFile(command, args, { cwd });
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
    await ensureBuildOutput();

    await runCommand(
      NODE_EXECUTABLE,
      [
        "./scripts/package-extension.mjs",
        "--timestamp",
        "240101-1200",
        "--stage-dir",
        stageDir,
        "--metadata-file",
        metadataPath
      ],
      REPO_ROOT
    );

    const metadata = JSON.parse(readFileSync(metadataPath));
    const stagedManifest = JSON.parse(readFileSync(path.join(stageDir, "manifest.json")));

    assert.equal(metadata.archiveFileName, `Unfluffify-v${PACKAGE_VERSION}-240101-1200.zip`);
    assert.equal(metadata.latestAliasFileName, "Unfluffify-latest.zip");
    assert.equal(metadata.versionLatestAliasFileName, `Unfluffify-v${PACKAGE_VERSION}-latest.zip`);
    assert.equal(metadata.releaseTag, "extension-latest");
    assert.equal(metadata.version, stagedManifest.version);
    assert.equal(metadata.originalVersion, PACKAGE_VERSION);
    assert.equal(metadata.releaseDisplayVersion, null);
    assert.equal(metadata.stageDir, stageDir);

    assert.equal(metadata.stagedFiles.includes("manifest.json"), true);
    assert.equal(metadata.stagedFiles.includes("background.js"), true);
    assert.equal(metadata.stagedFiles.includes("popup.html"), true);
    assert.equal(metadata.stagedFiles.includes("content-scripts/content-loader.js"), true);
    assert.equal(metadata.stagedFiles.includes("content-scripts/page-motion-freeze-bridge.js"), true);
    assert.equal(metadata.stagedFiles.includes("content-main.js"), false);
    assert.equal(metadata.stagedFiles.includes("content/submission-rules.js"), false);
    assert.equal(metadata.stagedFiles.includes("common/config.js"), false);
    assert.equal(metadata.stagedFiles.includes("assets/fonts/fonts.css"), true);
    assert.equal(metadata.stagedFiles.includes("assets/materialdesignicons.min.css"), true);
    assert.equal(metadata.stagedFiles.includes("assets/fonts/inter-latin-400-normal.woff2"), true);
    assert.equal(metadata.stagedFiles.includes("assets/materialdesignicons-webfont.woff2"), true);
    assert.equal(metadata.stagedFiles.includes("cursors/exclude.svg"), true);
    assert.equal(metadata.stagedFiles.includes("cursors/include.svg"), true);
    assert.equal(metadata.stagedFiles.includes("icons/default/icon16.png"), true);
    assert.equal(metadata.stagedFiles.includes("logo.png"), true);

    assert.equal(metadata.stagedFiles.includes("README.md"), false);
    assert.equal(metadata.stagedFiles.includes(".github/workflows/build-extension-package.yml"), false);
    assert.equal(metadata.stagedFiles.some((filePath) => filePath.startsWith("tests/")), false);

    assert.equal(existsSync(path.join(stageDir, "content-scripts/page-motion-freeze-bridge.js")), true);
    assert.equal(existsSync(path.join(stageDir, "content-scripts/content-loader.js")), true);
    assert.equal(existsSync(path.join(stageDir, "content/submission-rules.js")), false);
    assert.equal(existsSync(path.join(stageDir, "common/config.js")), false);
    assert.equal(existsSync(path.join(stageDir, "assets/fonts/fonts.css")), true);
    assert.equal(existsSync(path.join(stageDir, "assets/materialdesignicons.min.css")), true);
    assert.equal(existsSync(path.join(stageDir, "assets/fonts/inter-latin-400-normal.woff2")), true);
    assert.equal(existsSync(path.join(stageDir, "assets/materialdesignicons-webfont.woff2")), true);
    assert.equal(existsSync(path.join(stageDir, "cursors/exclude.svg")), true);
    assert.equal(existsSync(path.join(stageDir, "cursors/include.svg")), true);
    assert.equal(existsSync(path.join(stageDir, "icons/default/icon128.png")), true);
    assert.equal(existsSync(path.join(stageDir, "logo.png")), true);
    assert.equal(existsSync(path.join(stageDir, "popup.html")), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}, PACKAGE_BUILD_TIMEOUT_MS);

test("package script adds a release-only build display version to the staged manifest", async () => {
  const tempDir = await mkdtemp("unfluffify-package-build-version-test-");
  const stageDir = path.join(tempDir, "stage");
  const metadataPath = path.join(tempDir, "metadata.json");

  try {
    await ensureBuildOutput();

    await runCommand(
      NODE_EXECUTABLE,
      [
        "./scripts/package-extension.mjs",
        "--timestamp",
        "240101-1200",
        "--build-version",
        "2605122318",
        "--stage-dir",
        stageDir,
        "--metadata-file",
        metadataPath
      ],
      REPO_ROOT
    );

    const metadata = JSON.parse(readFileSync(metadataPath));
    const stagedManifest = JSON.parse(readFileSync(path.join(stageDir, "manifest.json")));

    assert.equal(metadata.version, PACKAGE_VERSION);
    assert.equal(metadata.originalVersion, PACKAGE_VERSION);
    assert.equal(metadata.releaseDisplayVersion, `${PACKAGE_VERSION}.2605122318`);
    assert.equal(stagedManifest.version, PACKAGE_VERSION);
    assert.equal(stagedManifest.version_name, `${PACKAGE_VERSION}.2605122318`);
    assert.equal(metadata.archiveFileName, `Unfluffify-v${PACKAGE_VERSION}-240101-1200.zip`);
    assert.equal(metadata.versionLatestAliasFileName, `Unfluffify-v${PACKAGE_VERSION}-latest.zip`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}, PACKAGE_BUILD_TIMEOUT_MS);