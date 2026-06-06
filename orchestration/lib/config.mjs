import fs from "node:fs/promises";
import path from "node:path";
import { parseJsonc } from "./jsonc.mjs";

const DEFAULT_CONFIG_PATHS = [
  "orchestration/config.jsonc",
  "orchestration/config.json"
];
const DEFAULT_PROFILE_DIR = "orchestration/profiles/director";
const DEFAULT_TEST_PROPERTY_URL = "https://www.bonliva.no/";

export function parseCliArgs(argv = []) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function normalizeRole(value) {
  return value === "follower" ? "follower" : "director";
}

function normalizeSide(value, role) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return role === "follower" ? "B" : "A";
}

function normalizeDisplayMode(value) {
  return value === "xvfb" ? "xvfb" : "real";
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 8765;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveMaybeRelativePath(value, cwd) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  return path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized);
}

async function readJsoncIfExists(filePaths) {
  for (const filePath of filePaths) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return {
        configPath: filePath,
        config: parseJsonc(raw, filePath)
      };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return null;
}

export async function loadOrchestrationConfig(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const cli = options.cli || parseCliArgs(options.argv || []);
  const configuredPath =
    (typeof cli.config === "string" ? cli.config : "") ||
    (typeof env.UNFLUFFIFY_ORCHESTRATION_CONFIG === "string"
      ? env.UNFLUFFIFY_ORCHESTRATION_CONFIG
      : "");
  const configPathCandidates = configuredPath
    ? [resolveMaybeRelativePath(configuredPath, cwd)]
    : DEFAULT_CONFIG_PATHS.map((candidate) => resolveMaybeRelativePath(candidate, cwd));
  const fileResult = await readJsoncIfExists(configPathCandidates);
  const configPath = fileResult ? fileResult.configPath : configPathCandidates[0];
  const fileConfig = fileResult ? fileResult.config : null;
  if (!fileConfig && options.requireConfig) {
    throw new Error(`Missing orchestration config: ${configPathCandidates.join(" or ")}`);
  }

  const merged = {
    ...(fileConfig && typeof fileConfig === "object" ? fileConfig : {}),
    ...Object.fromEntries(
      Object.entries({
        role: cli.role,
        side: cli.side,
        account: cli.account,
        busHost: cli["bus-host"],
        busPort: cli["bus-port"],
        displayMode: cli["display-mode"],
        chromePath: cli["chrome-path"],
        playwrightModulePath: cli["playwright-module-path"],
        extensionPath: cli["extension-path"],
        profileDir: cli["profile-dir"],
        stageBase: cli["stage-base"],
        testPropertyUrl: cli["property-url"],
        captureSourceTitle: cli["capture-source-title"]
      }).filter(([, value]) => typeof value !== "undefined" && value !== true)
    )
  };

  const role = normalizeRole(merged.role);
  const side = normalizeSide(merged.side, role);
  const account = normalizeString(merged.account) || side;
  const busHost = normalizeString(merged.busHost) || "127.0.0.1";
  const busPort = normalizePort(merged.busPort);
  const extensionPath = resolveMaybeRelativePath(merged.extensionPath || ".", cwd);
  const profileDir = resolveMaybeRelativePath(merged.profileDir || DEFAULT_PROFILE_DIR, cwd);

  return {
    configPath,
    role,
    side,
    account,
    busHost,
    busPort,
    busUrl: `ws://${busHost}:${busPort}`,
    displayMode: normalizeDisplayMode(merged.displayMode),
    chromePath: resolveMaybeRelativePath(merged.chromePath, cwd),
    playwrightModulePath: resolveMaybeRelativePath(
      merged.playwrightModulePath || env.UNFLUFFIFY_PLAYWRIGHT_PATH || "",
      cwd
    ),
    extensionPath,
    profileDir,
    stageBase: normalizeString(merged.stageBase),
    testPropertyUrl: normalizeString(merged.testPropertyUrl) || DEFAULT_TEST_PROPERTY_URL,
    captureSourceTitle: normalizeString(merged.captureSourceTitle),
    runRoot: resolveMaybeRelativePath(merged.runRoot || "orchestration/runs", cwd)
  };
}
