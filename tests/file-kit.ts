import { basename, dirname, extname, fromFileUrl, join, normalize, relative, resolve } from "jsr:@std/path";

export function readFileSync(pathOrUrl: string | URL, encoding = "utf8"): string {
  if (encoding && encoding !== "utf8") {
    throw new Error(`Unsupported encoding: ${encoding}`);
  }
  return Deno.readTextFileSync(pathOrUrl);
}

export async function readFile(pathOrUrl: string | URL, encoding = "utf8"): Promise<string> {
  if (encoding && encoding !== "utf8") {
    throw new Error(`Unsupported encoding: ${encoding}`);
  }
  return await Deno.readTextFile(pathOrUrl);
}

export function existsSync(pathOrUrl: string | URL): boolean {
  try {
    Deno.statSync(pathOrUrl);
    return true;
  } catch {
    return false;
  }
}

interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export function readdirSync(pathOrUrl: string | URL, options: { withFileTypes?: boolean } = {}): string[] | DirentLike[] {
  const entries: string[] | DirentLike[] = [];
  for (const entry of Deno.readDirSync(pathOrUrl)) {
    if (options.withFileTypes) {
      (entries as DirentLike[]).push({
        name: entry.name,
        isDirectory: () => entry.isDirectory,
        isFile: () => entry.isFile,
      });
      continue;
    }
    (entries as string[]).push(entry.name);
  }
  return entries;
}

export async function mkdtemp(prefix: string): Promise<string> {
  if (prefix.includes("/") || prefix.includes("\\")) {
    const dir = dirname(prefix);
    const namePrefix = basename(prefix) || "tmp-";
    return await Deno.makeTempDir({ dir, prefix: namePrefix });
  }
  return await Deno.makeTempDir({ prefix });
}

export async function mkdir(pathOrUrl: string | URL, options: { recursive?: boolean } = {}): Promise<void> {
  await Deno.mkdir(pathOrUrl, { recursive: Boolean(options.recursive) });
}

export async function writeFile(pathOrUrl: string | URL, data: string | Uint8Array): Promise<void> {
  if (typeof data === "string") {
    await Deno.writeTextFile(pathOrUrl, data);
    return;
  }

  await Deno.writeFile(pathOrUrl, data);
}

export async function rm(pathOrUrl: string | URL, options: { recursive?: boolean; force?: boolean } = {}): Promise<void> {
  try {
    await Deno.remove(pathOrUrl, { recursive: Boolean(options.recursive) });
  } catch (error) {
    if (!options.force) {
      throw error;
    }
  }
}

export async function execFile(command: string, args: string[] = [], options: { cwd?: string } = {}): Promise<{ stdout: Uint8Array; stderr: Uint8Array; code: number }> {
  const process = new Deno.Command(command, {
    args,
    cwd: options.cwd,
    stdout: "piped",
    stderr: "piped"
  });
  const result = await process.output();
  return result;
}

export function fileURLToPath(url: string | URL): string {
  return fromFileUrl(url);
}

export const path = {
  basename,
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
  sep: "/"
};