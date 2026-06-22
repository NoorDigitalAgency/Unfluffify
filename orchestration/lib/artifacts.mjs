import { dirname, resolve } from "@std/path";

export function createRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function ensureRunDir(runRoot, role, side, runId = createRunId()) {
  const safeRole = typeof role === "string" && role ? role : "runner";
  const safeSide = typeof side === "string" && side ? side : "X";
  const runDir = resolve(runRoot, `${runId}-${safeRole}-${safeSide}`);
  await Deno.mkdir(runDir, { recursive: true });
  return runDir;
}

export async function appendJsonLine(filePath, value) {
  await Deno.mkdir(dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, `${JSON.stringify(value)}\n`, { append: true });
}
