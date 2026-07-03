import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_SOURCE_ROOT = join(REPO_ROOT, ".output", "chrome-mv3");
let SOURCE_ROOT = REPO_ROOT;
const KNOWN_ASSET_EXTENSIONS = new Set([
  ".css",
  ".gif",
  ".html",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".mjs",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2"
]);
const JS_EXTENSIONS = new Set([".js", ".mjs"]);
const HTML_EXTENSIONS = new Set([".html"]);
const CSS_EXTENSIONS = new Set([".css"]);
const DEFAULT_RELEASE_TAG = "extension-latest";

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, rawInlineValue] = token.split("=", 2);
    const key = rawKey.slice(2);
    if (!key) {
      continue;
    }

    if (typeof rawInlineValue === "string") {
      args[key] = rawInlineValue;
      continue;
    }

    const nextToken = argv[index + 1];
    if (typeof nextToken === "string" && !nextToken.startsWith("--")) {
      args[key] = nextToken;
      index += 1;
      continue;
    }

    args[key] = true;
  }

  return args;
}

function formatTimestamp(date = new Date()) {
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}`;
}

function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== "string") {
    return "";
  }

  const normalized = relativePath.replace(/\\/g, "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.startsWith("../")) {
    return "";
  }

  const resolved = normalize(normalized);
  if (!resolved || resolved === "." || resolved.startsWith("../")) {
    return "";
  }

  return resolved;
}

function isLocalAssetSpecifier(specifier) {
  if (typeof specifier !== "string") {
    return false;
  }

  const trimmedSpecifier = specifier.trim();
  if (!trimmedSpecifier) {
    return false;
  }

  if (
    trimmedSpecifier.startsWith("#") ||
    trimmedSpecifier.startsWith("data:") ||
    trimmedSpecifier.startsWith("javascript:") ||
    trimmedSpecifier.startsWith("mailto:") ||
    trimmedSpecifier.startsWith("tel:") ||
    trimmedSpecifier.includes("://")
  ) {
    return false;
  }

  return true;
}

function stripQueryAndHash(specifier) {
  return String(specifier || "").split(/[?#]/, 1)[0];
}

function hasKnownAssetExtension(specifier) {
  const extension = extname(stripQueryAndHash(specifier)).toLowerCase();
  return KNOWN_ASSET_EXTENSIONS.has(extension);
}

function resolveAssetSpecifier(fromRelativePath, specifier) {
  if (!isLocalAssetSpecifier(specifier) || !hasKnownAssetExtension(specifier)) {
    return "";
  }

  const sanitizedSpecifier = stripQueryAndHash(specifier);
  const basePath = fromRelativePath
    ? `https://extension.invalid/${normalizeRelativePath(fromRelativePath)}`
    : "https://extension.invalid/";
  const resolvedPath = new URL(sanitizedSpecifier, basePath).pathname.replace(/^\/+/, "");
  return normalizeRelativePath(resolvedPath);
}

async function isFile(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function expandManifestResource(resourcePath) {
  if (typeof resourcePath !== "string") {
    return [];
  }

  if (!resourcePath.includes("*")) {
    const normalized = normalizeRelativePath(resourcePath);
    return normalized ? [normalized] : [];
  }

  const wildcardIndex = resourcePath.indexOf("*");
  const slashIndex = resourcePath.lastIndexOf("/", wildcardIndex);
  if (slashIndex < 0) {
    return [];
  }

  const directory = normalizeRelativePath(resourcePath.slice(0, slashIndex));
  if (!directory) {
    return [];
  }

  const prefix = resourcePath.slice(slashIndex + 1, wildcardIndex);
  const suffix = resourcePath.slice(wildcardIndex + 1);
  const directoryPath = join(SOURCE_ROOT, directory);
  const matches = [];

  try {
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      if (prefix && !entry.name.startsWith(prefix)) {
        continue;
      }
      if (suffix && !entry.name.endsWith(suffix)) {
        continue;
      }
      matches.push(normalizeRelativePath(join(directory, entry.name)));
    }
  } catch {
    return [];
  }

  return matches.filter(Boolean);
}

async function collectManifestEntryPoints(manifest) {
  const entryPoints = new Set(["manifest.json"]);
  for (const extensionPage of ["popup.html", "offscreen.html"]) {
    const absolutePath = join(SOURCE_ROOT, extensionPage);
    if (await isFile(absolutePath)) {
      entryPoints.add(extensionPage);
    }
  }
  // Stable extension-page public assets (for example the popup logo and the
  // raw font/icon stylesheets) are not guaranteed to appear in built HTML after
  // bundling, so stage them explicitly when present in the build output.
  for (const staticAsset of [
    "logo.png",
    "assets/fonts/fonts.css",
    "assets/materialdesignicons.min.css",
  ]) {
    const absolutePath = join(SOURCE_ROOT, staticAsset);
    if (await isFile(absolutePath)) {
      entryPoints.add(staticAsset);
    }
  }

  if (manifest && manifest.background && typeof manifest.background.service_worker === "string") {
    entryPoints.add(normalizeRelativePath(manifest.background.service_worker));
  }

  if (manifest && manifest.action && typeof manifest.action.default_popup === "string") {
    entryPoints.add(normalizeRelativePath(manifest.action.default_popup));
  }

  if (typeof manifest.devtools_page === "string") {
    entryPoints.add(normalizeRelativePath(manifest.devtools_page));
  }

  if (manifest && manifest.options_ui && typeof manifest.options_ui.page === "string") {
    entryPoints.add(normalizeRelativePath(manifest.options_ui.page));
  }

  if (typeof manifest.options_page === "string") {
    entryPoints.add(normalizeRelativePath(manifest.options_page));
  }

  if (manifest && manifest.side_panel && typeof manifest.side_panel.default_path === "string") {
    entryPoints.add(normalizeRelativePath(manifest.side_panel.default_path));
  }

  for (const contentScript of Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []) {
    for (const scriptPath of Array.isArray(contentScript && contentScript.js) ? contentScript.js : []) {
      entryPoints.add(normalizeRelativePath(scriptPath));
    }
    for (const stylePath of Array.isArray(contentScript && contentScript.css) ? contentScript.css : []) {
      entryPoints.add(normalizeRelativePath(stylePath));
    }
  }

  for (const iconPath of Object.values(manifest && manifest.icons && typeof manifest.icons === "object" ? manifest.icons : {})) {
    if (typeof iconPath === "string") {
      entryPoints.add(normalizeRelativePath(iconPath));
    }
  }
  // Runtime-set action icons (chrome.action.setIcon with the icons/active/*
  // variants — see common/utilities.ts) never appear in the manifest, so the
  // manifest-driven staging above missed them and the shipped zip had no
  // active icons. Stage every icon set under icons/ from the build output.
  try {
    for (const iconSet of await readdir(join(SOURCE_ROOT, "icons"), { withFileTypes: true })) {
      if (!iconSet.isDirectory()) {
        continue;
      }
      for (const iconFile of await expandManifestResource(`icons/${iconSet.name}/*`)) {
        entryPoints.add(iconFile);
      }
    }
  } catch {
    // No icons directory in the build output; nothing to stage.
  }

  for (const resourceGroup of Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : []) {
    for (const resourcePath of Array.isArray(resourceGroup && resourceGroup.resources) ? resourceGroup.resources : []) {
      if (typeof resourcePath !== "string") {
        continue;
      }
      const expandedPaths = await expandManifestResource(resourcePath);
      for (const expandedPath of expandedPaths) {
        entryPoints.add(expandedPath);
      }
    }
  }

  const normalized = [];
  for (const candidate of entryPoints) {
    if (!candidate) {
      continue;
    }

    const absolutePath = join(SOURCE_ROOT, candidate);
    if (await isFile(absolutePath)) {
      normalized.push(candidate);
    }
  }

  return normalized;
}

async function collectDependencies(relativePath, collectorState) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath || collectorState.seenFiles.has(normalizedPath)) {
    return;
  }

  const absolutePath = join(SOURCE_ROOT, normalizedPath);
  if (!(await isFile(absolutePath))) {
    return;
  }

  collectorState.seenFiles.add(normalizedPath);
  collectorState.collectedFiles.add(normalizedPath);

  const extension = extname(normalizedPath).toLowerCase();
  if (!JS_EXTENSIONS.has(extension) && !HTML_EXTENSIONS.has(extension) && !CSS_EXTENSIONS.has(extension)) {
    return;
  }

  const source = await readFile(absolutePath, "utf8");
  let matches = [];
  if (JS_EXTENSIONS.has(extension)) {
    matches = collectJsAssetSpecifiers(source, normalizedPath);
  } else if (HTML_EXTENSIONS.has(extension)) {
    matches = collectHtmlAssetSpecifiers(source, normalizedPath);
  } else if (CSS_EXTENSIONS.has(extension)) {
    matches = collectCssAssetSpecifiers(source, normalizedPath);
  }

  for (const dependencyPath of matches) {
    await collectDependencies(dependencyPath, collectorState);
  }
}

function collectJsAssetSpecifiers(source, fromRelativePath) {
  const dependencies = new Set();
  const importPatterns = [
    /\bimport\s+(?:[^"'`]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^"'`]*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  const assetLiteralPattern = /["']([^"'\n\r]+\.(?:css|gif|html|jpeg|jpg|js|json|mjs|otf|png|svg|ttf|webp|woff|woff2))(?:[?#][^"']*)?["']/g;

  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const resolved = resolveAssetSpecifier(fromRelativePath, match[1]);
      if (resolved) {
        dependencies.add(resolved);
      }
    }
  }

  for (const match of source.matchAll(assetLiteralPattern)) {
    const resolved = resolveAssetSpecifier(fromRelativePath, match[1]);
    if (resolved) {
      dependencies.add(resolved);
    }
  }

  return [...dependencies];
}

function collectHtmlAssetSpecifiers(source, fromRelativePath) {
  const dependencies = new Set();
  const assetPattern = /\b(?:src|href)=(["'])([^"']+)\1/g;

  for (const match of source.matchAll(assetPattern)) {
    const resolved = resolveAssetSpecifier(fromRelativePath, match[2]);
    if (resolved) {
      dependencies.add(resolved);
    }
  }

  return [...dependencies];
}

function collectCssAssetSpecifiers(source, fromRelativePath) {
  const dependencies = new Set();
  const importPattern = /@import\s+(?:url\()?\s*["']?([^"')\s]+)["']?\s*\)?/g;
  const urlPattern = /url\(\s*["']?([^"')\s]+)["']?\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    const resolved = resolveAssetSpecifier(fromRelativePath, match[1]);
    if (resolved) {
      dependencies.add(resolved);
    }
  }

  for (const match of source.matchAll(urlPattern)) {
    const resolved = resolveAssetSpecifier(fromRelativePath, match[1]);
    if (resolved) {
      dependencies.add(resolved);
    }
  }

  return [...dependencies];
}

async function stageCollectedFiles(collectedFiles, stagingDirectory) {
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });

  const sortedFiles = [...collectedFiles].sort((left, right) => left.localeCompare(right));
  for (const relativePath of sortedFiles) {
    const sourcePath = join(SOURCE_ROOT, relativePath);
    const destinationPath = join(stagingDirectory, relativePath);
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }

  return sortedFiles;
}

async function updateStagedManifestReleaseVersion(stagingDirectory, options = {}) {
  const buildVersion = typeof options.buildVersion === "string"
    ? options.buildVersion.trim()
    : "";
  const originalVersion = typeof options.originalVersion === "string"
    ? options.originalVersion.trim()
    : "";
  if (!buildVersion || !originalVersion) {
    return null;
  }

  const manifestPath = join(stagingDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const releaseDisplayVersion = `${originalVersion}.${buildVersion}`;
  manifest.version_name = releaseDisplayVersion;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return releaseDisplayVersion;
}

async function writeMetadataFile(metadataFilePath, metadata) {
  if (!metadataFilePath) {
    return;
  }

  await mkdir(dirname(metadataFilePath), { recursive: true });
  await writeFile(metadataFilePath, `${JSON.stringify(metadata, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = typeof args["source-root"] === "string" && args["source-root"].trim()
    ? resolve(REPO_ROOT, args["source-root"])
    : DEFAULT_SOURCE_ROOT;
  SOURCE_ROOT = sourceRoot;

  const manifestPath = join(SOURCE_ROOT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const originalVersion = typeof manifest.version === "string" && manifest.version.trim()
    ? manifest.version.trim()
    : "0.0.0";
  const timestamp = typeof args.timestamp === "string" && args.timestamp.trim()
    ? args.timestamp.trim()
    : formatTimestamp();
  const buildVersion = typeof args["build-version"] === "string" && args["build-version"].trim()
    ? args["build-version"].trim()
    : "";
  const archiveFileName = `Unfluffify-v${originalVersion}-${timestamp}.zip`;
  const latestAliasFileName = "Unfluffify-latest.zip";
  const versionLatestAliasFileName = `Unfluffify-v${originalVersion}-latest.zip`;
  const stagingDirectory = resolve(
    REPO_ROOT,
    typeof args["stage-dir"] === "string" && args["stage-dir"].trim()
      ? args["stage-dir"]
      : join(".tmp", "extension-package")
  );
  const metadataFilePath = typeof args["metadata-file"] === "string" && args["metadata-file"].trim()
    ? resolve(REPO_ROOT, args["metadata-file"])
    : "";

  const entryPoints = await collectManifestEntryPoints(manifest);
  const collectorState = {
    seenFiles: new Set(),
    collectedFiles: new Set()
  };

  for (const entryPoint of entryPoints) {
    await collectDependencies(entryPoint, collectorState);
  }

  const stagedFiles = await stageCollectedFiles(collectorState.collectedFiles, stagingDirectory);
  const releaseDisplayVersion = await updateStagedManifestReleaseVersion(stagingDirectory, {
    buildVersion,
    originalVersion
  });
  const metadata = {
    archiveFileName,
    latestAliasFileName,
    originalVersion,
    releaseTag: DEFAULT_RELEASE_TAG,
    releaseDisplayVersion,
    stagedFiles,
    stageDir: stagingDirectory,
    timestamp,
    version: originalVersion,
    versionLatestAliasFileName
  };

  await writeMetadataFile(metadataFilePath, metadata);
  console.log(JSON.stringify(metadata));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});