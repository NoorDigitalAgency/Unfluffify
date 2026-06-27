import { mkdir as fsMkdir, stat as fsStat } from "node:fs/promises";

import { execFile, existsSync, fileURLToPath, path, readFile, rm, writeFile } from "./file-kit.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.join(REPO_ROOT, ".output", "chrome-mv3");
const MANIFEST_PATH = path.join(OUTPUT_ROOT, "manifest.json");
const BUILD_LOCK_PATH = path.join(REPO_ROOT, ".output", ".vitest-build-lock");
const BUILD_LOCK_OWNER_PATH = path.join(BUILD_LOCK_PATH, "owner.json");
const BUILD_LOCK_HEARTBEAT_PATH = path.join(BUILD_LOCK_PATH, "heartbeat");
const BUILD_LOCK_HEARTBEAT_INTERVAL_MS = 1_000;
const BUILD_LOCK_WAIT_MS = 200;
const BUILD_LOCK_TIMEOUT_MS = 40_000;
const BUILD_LOCK_STALE_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBuild(): Promise<void> {
  const result = await execFile("pnpm", ["build"], { cwd: REPO_ROOT });
  if (result.code !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

async function isBuildLockStale(): Promise<boolean> {
  try {
    const heartbeatStats = await fsStat(BUILD_LOCK_HEARTBEAT_PATH);
    return Date.now() - heartbeatStats.mtimeMs >= BUILD_LOCK_STALE_MS;
  } catch (error) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (errorCode === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (errorCode === "ESRCH") {
      return false;
    }
    return true;
  }
}

async function readBuildLockOwnerPid(): Promise<number | null> {
  try {
    const owner = JSON.parse(await readFile(BUILD_LOCK_OWNER_PATH, "utf8"));
    return typeof owner?.pid === "number" && Number.isInteger(owner.pid) ? owner.pid : null;
  } catch (error) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (errorCode === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function ensureBuildOutput(options: { force?: boolean } = {}): Promise<void> {
  const force = options.force === true;

  if (!force && existsSync(MANIFEST_PATH) && !existsSync(BUILD_LOCK_PATH)) {
    return;
  }

  await fsMkdir(path.dirname(BUILD_LOCK_PATH), { recursive: true });

  const deadline = Date.now() + BUILD_LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fsMkdir(BUILD_LOCK_PATH, { recursive: false });
      try {
        await writeFile(BUILD_LOCK_OWNER_PATH, `${JSON.stringify({ pid: process.pid })}\n`);
        await writeFile(BUILD_LOCK_HEARTBEAT_PATH, `${Date.now()}`);
        const heartbeatTimer = setInterval(() => {
          void writeFile(BUILD_LOCK_HEARTBEAT_PATH, `${Date.now()}`);
        }, BUILD_LOCK_HEARTBEAT_INTERVAL_MS);
        if (force || !existsSync(MANIFEST_PATH)) {
          try {
            await runBuild();
          } finally {
            clearInterval(heartbeatTimer);
          }
        } else {
          clearInterval(heartbeatTimer);
        }
        return;
      } finally {
        await rm(BUILD_LOCK_PATH, { recursive: true, force: true });
      }
    } catch (error) {
      if (await isBuildLockStale()) {
        const ownerPid = await readBuildLockOwnerPid();
        if (ownerPid === null || !isProcessAlive(ownerPid)) {
          await rm(BUILD_LOCK_PATH, { recursive: true, force: true });
          if (!force && existsSync(MANIFEST_PATH)) {
            return;
          }
          continue;
        }
      }
      if (!force && existsSync(MANIFEST_PATH) && !existsSync(BUILD_LOCK_PATH)) {
        return;
      }
      const errorCode = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (errorCode && errorCode !== "EEXIST") {
        throw error;
      }
      await sleep(BUILD_LOCK_WAIT_MS);
    }
  }

  throw new Error("Timed out waiting for shared test build output");
}
