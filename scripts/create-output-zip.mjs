#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [sourceArg, archiveArg] = process.argv.slice(2);

if (!sourceArg || !archiveArg) {
  console.error("Usage: node ./scripts/create-output-zip.mjs <source-dir> <archive-path>");
  process.exit(1);
}

const sourceDir = resolve(sourceArg);
const archivePath = resolve(archiveArg);

if (!existsSync(sourceDir)) {
  console.error(`Source directory does not exist: ${sourceDir}`);
  process.exit(1);
}

rmSync(archivePath, { force: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error(`Unable to find required executable: ${command}`);
    } else {
      console.error(result.error);
    }
    process.exit(1);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

if (process.platform === "win32") {
  const escapedArchivePath = archivePath.replace(/'/g, "''");
  run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$ErrorActionPreference = 'Stop'; Compress-Archive -Path (Get-ChildItem -Force -LiteralPath .) -DestinationPath '${escapedArchivePath}' -Force`,
  ], {
    cwd: sourceDir,
  });
} else {
  run("zip", ["-qr", archivePath, "."], {
    cwd: sourceDir,
  });
}
