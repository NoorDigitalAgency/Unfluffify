#!/usr/bin/env node

import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDenoExecutable() {
  const envPath = typeof process.env.DENO_BIN === "string" ? process.env.DENO_BIN.trim() : "";
  if (envPath) {
    return envPath;
  }

  const executableName = process.platform === "win32" ? "deno.exe" : "deno";
  const localInstallPath = join(homedir(), ".deno", "bin", executableName);
  if (isExecutable(localInstallPath)) {
    return localInstallPath;
  }

  return "deno";
}

const child = spawn(resolveDenoExecutable(), process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  if (error && error.code === "ENOENT") {
    console.error(
      'Unable to find a Deno executable. Set DENO_BIN or install Deno in ~/.deno/bin/deno.',
    );
  } else {
    console.error(error);
  }
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
