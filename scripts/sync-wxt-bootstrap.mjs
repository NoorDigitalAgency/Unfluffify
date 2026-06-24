import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(repoRoot, "dist", "extension");
const outputRoot = join(repoRoot, ".output", "chrome-mv3");
const sourceManifestPath = join(repoRoot, "manifest.json");
const outputManifestPath = join(outputRoot, "manifest.json");

export function bridgeManifest(outputManifest, sourceManifest) {
  const next = structuredClone(outputManifest);
  if (sourceManifest?.background?.type && next?.background?.service_worker) {
    next.background = {
      ...next.background,
      type: sourceManifest.background.type,
    };
  }
  return next;
}

function copyTree(sourceDir, sourceRoot, outputRoot) {
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const relPath = relative(sourceRoot, sourcePath);

    if (relPath === "manifest.json") {
      continue;
    }

    const destPath = join(outputRoot, relPath);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyTree(sourcePath, sourceRoot, outputRoot);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    mkdirSync(dirname(destPath), { recursive: true });
    cpSync(sourcePath, destPath, { force: true });
  }
}

export function syncBootstrapOutput({
  sourceRoot,
  outputRoot,
  sourceManifestPath,
  outputManifestPath,
}) {
  if (!existsSync(sourceRoot)) {
    throw new Error(`Missing Deno release output: ${sourceRoot}`);
  }

  if (!existsSync(outputRoot)) {
    throw new Error(`Missing WXT output root: ${outputRoot}`);
  }

  copyTree(sourceRoot, sourceRoot, outputRoot);

  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
  const outputManifest = JSON.parse(readFileSync(outputManifestPath, "utf8"));
  const bridgedManifest = bridgeManifest(outputManifest, sourceManifest);
  writeFileSync(`${outputManifestPath}`, `${JSON.stringify(bridgedManifest, null, 2)}\n`);

  const copiedFiles = [];
  function collectFiles(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(abs);
        continue;
      }
      if (entry.isFile()) {
        copiedFiles.push(relative(outputRoot, abs));
      }
    }
  }

  collectFiles(outputRoot);
  console.log(
    `Mirrored Deno release files into ${outputRoot} (manifest bridged, ${copiedFiles.length} files present)`,
  );
}

function main() {
  syncBootstrapOutput({
    sourceRoot,
    outputRoot,
    sourceManifestPath,
    outputManifestPath,
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
