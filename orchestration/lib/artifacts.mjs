import fs from "node:fs/promises";
import path from "node:path";

export function createRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function ensureRunDir(runRoot, role, side, runId = createRunId()) {
  const safeRole = typeof role === "string" && role ? role : "runner";
  const safeSide = typeof side === "string" && side ? side : "X";
  const runDir = path.resolve(runRoot, `${runId}-${safeRole}-${safeSide}`);
  await fs.mkdir(runDir, { recursive: true });
  return runDir;
}

export async function appendJsonLine(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`);
}
