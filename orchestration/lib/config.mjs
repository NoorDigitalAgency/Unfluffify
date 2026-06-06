import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG_PATH = "orchestration/config.json";
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

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function loadOrchestrationConfig(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const cli = options.cli || parseCliArgs(options.argv || []);
  const configPath = resolveMaybeRelativePath(
    cli.config || env.UNFLUFFIFY_ORCHESTRATION_CONFIG || DEFAULT_CONFIG_PATH,
    cwd
  );
  const fileConfig = await readJsonIfExists(configPath);
  if (!fileConfig && options.requireConfig) {
    throw new Error(`Missing orchestration config: ${configPath}`);
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
