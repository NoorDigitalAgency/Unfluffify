import { build } from "npm:esbuild";
import { dirname, extname, join, relative } from "jsr:@std/path";

const ROOT = Deno.cwd();
const isDev = Deno.args.includes("--dev");
const outDir = Deno.args.includes("--dev")
  ? join(ROOT, "dist", "extension-dev")
  : join(ROOT, "dist", "extension");

const ROOT_FILES = [
  "manifest.json",
  "background.ts",
  "content-loader.ts",
  "content-main.ts",
  "popup.ts",
  "popup.html",
  "popup.css",
  "theme-color.css",
  "theme-components.css",
  "theme-utilities.css"
];

const ROOT_DIRS = ["assets", "background", "common", "content", "cursors", "icons", "popup"];
const CODE_EXTENSIONS = new Set([".js", ".mjs", ".ts"]);

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dirPath)) {
    const child = join(dirPath, entry.name);
    if (entry.isDirectory) {
      files.push(...await collectFiles(child));
      continue;
    }
    if (entry.isFile) {
      files.push(child);
    }
  }
  return files;
}

async function ensureParent(path: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
}

async function addDevReloadArtifacts(targetDir: string): Promise<void> {
  const buildId = new Date().toISOString();
  const clientPath = join(targetDir, "dev-reload-client.js");
  const markerPath = join(targetDir, "dev-reload-marker.json");
  const backgroundPath = join(targetDir, "background.js");
  const clientSource = `const POLL_MS = 1500;
let lastBuildId = "";

async function readBuildMarker() {
  try {
    const response = await fetch(chrome.runtime.getURL("dev-reload-marker.json"), { cache: "no-store" });
    if (!response.ok) {
      return "";
    }
    const payload = await response.json();
    return payload && typeof payload.buildId === "string" ? payload.buildId : "";
  } catch {
    return "";
  }
}

async function pollForReload() {
  const nextBuildId = await readBuildMarker();
  if (!nextBuildId) {
    return;
  }
  if (!lastBuildId) {
    lastBuildId = nextBuildId;
    return;
  }
  if (nextBuildId !== lastBuildId) {
    chrome.runtime.reload();
  }
}

setInterval(() => {
  pollForReload();
}, POLL_MS);
`;

  await Deno.writeTextFile(clientPath, clientSource);
  await Deno.writeTextFile(markerPath, `${JSON.stringify({ buildId }, null, 2)}\n`);

  try {
    const backgroundSource = await Deno.readTextFile(backgroundPath);
    const importLine = 'import "./dev-reload-client.js";\n';
    if (!backgroundSource.startsWith(importLine)) {
      await Deno.writeTextFile(backgroundPath, `${importLine}${backgroundSource}`);
    }
  } catch {
    // Ignore background injection if background.js does not exist in the output.
  }
}

async function main(): Promise<void> {
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
  await Deno.mkdir(outDir, { recursive: true });

  const allFiles = new Set<string>();
  for (const rootFile of ROOT_FILES) {
    const abs = join(ROOT, rootFile);
    if (await pathExists(abs)) {
      allFiles.add(abs);
    }
  }

  for (const rootDir of ROOT_DIRS) {
    const absDir = join(ROOT, rootDir);
    if (!(await pathExists(absDir))) {
      continue;
    }
    for (const filePath of await collectFiles(absDir)) {
      allFiles.add(filePath);
    }
  }

  const codeEntryPoints: string[] = [];
  for (const filePath of allFiles) {
    const relPath = relative(ROOT, filePath).replaceAll("\\", "/");
    const ext = extname(relPath).toLowerCase();
    const outPath = join(outDir, relPath);

    // Type-only declaration files describe vendored/runtime modules for the
    // strict TypeScript build; they are never shipped or used as esbuild entry
    // points (esbuild would try to emit them and fail on body-less declarations).
    if (relPath.endsWith(".d.ts")) {
      continue;
    }

    if (CODE_EXTENSIONS.has(ext)) {
      codeEntryPoints.push(filePath);
      continue;
    }

    await ensureParent(outPath);
    await Deno.copyFile(filePath, outPath);
  }

  if (codeEntryPoints.length > 0) {
    await build({
      entryPoints: codeEntryPoints,
      outdir: outDir,
      outbase: ROOT,
      bundle: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      sourcemap: isDev ? "inline" : false,
      logLevel: "info"
    });
  }

  if (isDev) {
    await addDevReloadArtifacts(outDir);
  }

  console.log(`Built ${codeEntryPoints.length} code files to ${outDir}`);
}

await main();
