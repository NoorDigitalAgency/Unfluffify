import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { mkdtemp as fsMkdtemp, mkdir as fsMkdir, readFile as fsReadFile, rm as fsRm, writeFile as fsWriteFile } from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function assertUtf8(encoding = "utf8"): void {
  if (encoding && encoding !== "utf8") {
    throw new Error(`Unsupported encoding: ${encoding}`);
  }
}

function resolveTempPrefix(prefix: string): string {
  if (prefix.includes("/") || prefix.includes("\\")) {
    const dir = path.dirname(prefix);
    const namePrefix = path.basename(prefix) || "tmp-";
    return path.join(dir, namePrefix);
  }
  return path.join(os.tmpdir(), prefix);
}

export function readFileSync(pathOrUrl: string | URL, encoding = "utf8"): string {
  assertUtf8(encoding);
  return fs.readFileSync(pathOrUrl, "utf8");
}

export async function readFile(pathOrUrl: string | URL, encoding = "utf8"): Promise<string> {
  assertUtf8(encoding);
  return await fsReadFile(pathOrUrl, "utf8");
}

export function existsSync(pathOrUrl: string | URL): boolean {
  return fs.existsSync(pathOrUrl);
}

export function readdirSync(
  pathOrUrl: string | URL,
  options: { withFileTypes?: boolean } = {},
): unknown {
  return fs.readdirSync(pathOrUrl, options);
}

export async function mkdtemp(prefix: string): Promise<string> {
  return await fsMkdtemp(resolveTempPrefix(prefix));
}

export async function mkdir(pathOrUrl: string | URL, options: { recursive?: boolean } = {}): Promise<void> {
  await fsMkdir(pathOrUrl, { recursive: Boolean(options.recursive) });
}

export async function writeFile(pathOrUrl: string | URL, data: string | Uint8Array): Promise<void> {
  await fsWriteFile(pathOrUrl, data);
}

export async function rm(pathOrUrl: string | URL, options: { recursive?: boolean; force?: boolean } = {}): Promise<void> {
  await fsRm(pathOrUrl, {
    recursive: Boolean(options.recursive),
    force: Boolean(options.force),
  });
}

export async function execFile(
  command: string,
  args: string[] = [],
  options: { cwd?: string } = {},
): Promise<{ stdout: Uint8Array; stderr: Uint8Array; code: number }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        code: code ?? 0,
      });
    });
  });
}

export { fileURLToPath, path };
