const isDenoTestRuntime = typeof globalThis.Deno?.test === "function";

const denoPathRuntime = isDenoTestRuntime ? await import("@std/path") : null;
const nodeFsRuntime = isDenoTestRuntime ? null : await import("node:fs");
const nodeFsPromisesRuntime = isDenoTestRuntime ? null : await import("node:fs/promises");
const nodeOsRuntime = isDenoTestRuntime ? null : await import("node:os");
const nodePathRuntime = isDenoTestRuntime ? null : await import("node:path");
const nodeUrlRuntime = isDenoTestRuntime ? null : await import("node:url");
const nodeChildProcessRuntime = isDenoTestRuntime ? null : await import("node:child_process");

function assertUtf8(encoding = "utf8"): void {
  if (encoding && encoding !== "utf8") {
    throw new Error(`Unsupported encoding: ${encoding}`);
  }
}

function resolveTempPrefix(prefix: string): string {
  if (prefix.includes("/") || prefix.includes("\\")) {
    const dir = nodePathRuntime.dirname(prefix);
    const namePrefix = nodePathRuntime.basename(prefix) || "tmp-";
    return nodePathRuntime.join(dir, namePrefix);
  }
  return nodePathRuntime.join(nodeOsRuntime.tmpdir(), prefix);
}

function resolveNodeDenoPath(): string {
  const envPath = typeof process !== "undefined" && typeof process.env.DENO_BIN === "string"
    ? process.env.DENO_BIN.trim()
    : "";
  if (envPath) {
    return envPath;
  }

  const homeDir = nodeOsRuntime.homedir();
  const executableName = typeof process !== "undefined" && process.platform === "win32"
    ? "deno.exe"
    : "deno";
  const localInstallPath = nodePathRuntime.join(homeDir, ".deno", "bin", executableName);
  if (nodeFsRuntime.existsSync(localInstallPath)) {
    return localInstallPath;
  }

  return "deno";
}

export function readFileSync(pathOrUrl: string | URL, encoding = "utf8"): string {
  assertUtf8(encoding);
  if (isDenoTestRuntime) {
    return Deno.readTextFileSync(pathOrUrl);
  }
  return nodeFsRuntime.readFileSync(pathOrUrl, "utf8");
}

export async function readFile(pathOrUrl: string | URL, encoding = "utf8"): Promise<string> {
  assertUtf8(encoding);
  if (isDenoTestRuntime) {
    return await Deno.readTextFile(pathOrUrl);
  }
  return await nodeFsPromisesRuntime.readFile(pathOrUrl, "utf8");
}

export function existsSync(pathOrUrl: string | URL): boolean {
  if (isDenoTestRuntime) {
    try {
      Deno.statSync(pathOrUrl);
      return true;
    } catch {
      return false;
    }
  }
  return nodeFsRuntime.existsSync(pathOrUrl);
}

export function readdirSync(
  pathOrUrl: string | URL,
  options: { withFileTypes?: boolean } = {},
): unknown {
  if (isDenoTestRuntime) {
    const entries: Array<string | { name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    for (const entry of Deno.readDirSync(pathOrUrl)) {
      if (options.withFileTypes) {
        entries.push({
          name: entry.name,
          isDirectory: () => entry.isDirectory,
          isFile: () => entry.isFile,
        });
        continue;
      }
      entries.push(entry.name);
    }
    return entries;
  }
  return nodeFsRuntime.readdirSync(pathOrUrl, options);
}

export async function mkdtemp(prefix: string): Promise<string> {
  if (isDenoTestRuntime) {
    if (prefix.includes("/") || prefix.includes("\\")) {
      const dir = denoPathRuntime.dirname(prefix);
      const namePrefix = denoPathRuntime.basename(prefix) || "tmp-";
      return await Deno.makeTempDir({ dir, prefix: namePrefix });
    }
    return await Deno.makeTempDir({ prefix });
  }
  return await nodeFsPromisesRuntime.mkdtemp(resolveTempPrefix(prefix));
}

export async function mkdir(pathOrUrl: string | URL, options: { recursive?: boolean } = {}): Promise<void> {
  if (isDenoTestRuntime) {
    await Deno.mkdir(pathOrUrl, { recursive: Boolean(options.recursive) });
    return;
  }
  await nodeFsPromisesRuntime.mkdir(pathOrUrl, { recursive: Boolean(options.recursive) });
}

export async function writeFile(pathOrUrl: string | URL, data: string | Uint8Array): Promise<void> {
  if (isDenoTestRuntime) {
    if (typeof data === "string") {
      await Deno.writeTextFile(pathOrUrl, data);
      return;
    }
    await Deno.writeFile(pathOrUrl, data);
    return;
  }
  await nodeFsPromisesRuntime.writeFile(pathOrUrl, data);
}

export async function rm(pathOrUrl: string | URL, options: { recursive?: boolean; force?: boolean } = {}): Promise<void> {
  if (isDenoTestRuntime) {
    try {
      await Deno.remove(pathOrUrl, { recursive: Boolean(options.recursive) });
    } catch (error) {
      if (!options.force) {
        throw error;
      }
    }
    return;
  }
  await nodeFsPromisesRuntime.rm(pathOrUrl, {
    recursive: Boolean(options.recursive),
    force: Boolean(options.force),
  });
}

export async function execFile(
  command: string,
  args: string[] = [],
  options: { cwd?: string } = {},
): Promise<{ stdout: Uint8Array; stderr: Uint8Array; code: number }> {
  if (isDenoTestRuntime) {
    return await new Deno.Command(command, {
      args,
      cwd: options.cwd,
      stdout: "piped",
      stderr: "piped",
    }).output();
  }
  return await new Promise((resolve, reject) => {
    const child = nodeChildProcessRuntime.spawn(command, args, {
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

export function denoExecutable(): string {
  if (isDenoTestRuntime) {
    return Deno.execPath();
  }
  return resolveNodeDenoPath();
}

export function fileURLToPath(url: string | URL): string {
  if (isDenoTestRuntime) {
    return denoPathRuntime.fromFileUrl(url);
  }
  return nodeUrlRuntime.fileURLToPath(url);
}

export const path = isDenoTestRuntime ? denoPathRuntime : nodePathRuntime;
