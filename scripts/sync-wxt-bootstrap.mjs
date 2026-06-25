import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(repoRoot, "dist", "extension");
const outputRoot = join(repoRoot, ".output", "chrome-mv3");
const sourceManifestPath = join(repoRoot, "manifest.json");
const outputManifestPath = join(outputRoot, "manifest.json");
const WXT_OWNED_OUTPUT_PATHS = new Set([
  "content-loader.js",
  "common/page-motion-freeze-bridge.js",
  "popup.html",
  "offscreen.html",
]);
const WXT_CONTENT_SCRIPT_ALIASES = [
  {
    source: join("content-scripts", "content-loader.js"),
    destination: "content-loader.js",
  },
  {
    source: join("content-scripts", "page-motion-freeze-bridge.js"),
    destination: join("common", "page-motion-freeze-bridge.js"),
  },
];

function shouldSkipLegacyRootCodeInOutput(relPath) {
  return relPath === "content-main.js";
}

export function bridgeManifest(outputManifest, sourceManifest) {
  const next = structuredClone(outputManifest);
  if (sourceManifest?.action) {
    next.action = structuredClone(sourceManifest.action);
  }
  if (sourceManifest?.background) {
    next.background = {
      ...next.background,
      ...structuredClone(sourceManifest.background),
    };
  }
  if (Array.isArray(sourceManifest?.content_scripts)) {
    next.content_scripts = structuredClone(sourceManifest.content_scripts);
  }
  return next;
}

function copyTree(sourceDir, sourceRoot, outputRoot, options = {}) {
  const { skipWxtOwned = false } = options;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const relPath = relative(sourceRoot, sourcePath);

    if (
      relPath === "manifest.json" ||
      (skipWxtOwned && shouldSkipLegacyRootCodeInOutput(relPath)) ||
      (skipWxtOwned && WXT_OWNED_OUTPUT_PATHS.has(relPath))
    ) {
      continue;
    }

    const destPath = join(outputRoot, relPath);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyTree(sourcePath, sourceRoot, outputRoot, options);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    mkdirSync(dirname(destPath), { recursive: true });
    cpSync(sourcePath, destPath, { force: true });
  }
}

function materializeWxtRuntimeAliases(outputRoot) {
  for (const alias of WXT_CONTENT_SCRIPT_ALIASES) {
    const sourcePath = join(outputRoot, alias.source);
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing WXT content script output: ${sourcePath}`);
    }
    const destinationPath = join(outputRoot, alias.destination);
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath, { force: true });
  }
}

export function syncBootstrapOutput({
  sourceRoot,
  outputRoot,
  sourceManifestPath,
  outputManifestPath,
}) {
  const legacyRoot = join(outputRoot, "legacy");
  if (!existsSync(sourceRoot)) {
    throw new Error(`Missing Deno release output: ${sourceRoot}`);
  }

  if (!existsSync(outputRoot)) {
    throw new Error(`Missing WXT output root: ${outputRoot}`);
  }

  copyTree(sourceRoot, sourceRoot, outputRoot, { skipWxtOwned: true });
  copyTree(sourceRoot, sourceRoot, legacyRoot);
  materializeWxtRuntimeAliases(outputRoot);

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
