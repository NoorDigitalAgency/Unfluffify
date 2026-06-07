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
    const forceValue = key === "chrome-arg" || key === "chrome-args";
    const nextValue = !next || (!forceValue && next.startsWith("--")) ? true : next;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = Array.isArray(result[key])
        ? result[key].concat(nextValue)
        : [result[key], nextValue];
    } else {
      result[key] = nextValue;
    }
    if (nextValue !== true) {
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
  if (value === "xvfb") {
    return "xvfb";
  }
  if (value === "wayland") {
    return "wayland";
  }
  return "real";
}

function normalizeMediaMode(value) {
  return value === "real" ? "real" : "fake";
}

function deriveMediaMode(rawMediaMode, legacyUseFakeMedia) {
  const explicitMode = normalizeString(rawMediaMode);
  if (explicitMode) {
    return normalizeMediaMode(explicitMode);
  }
  if (legacyUseFakeMedia === null) {
    return "fake";
  }
  return legacyUseFakeMedia ? "fake" : "real";
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 8765;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function normalizeBooleanLike(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

function normalizeOriginList(value) {
  const values = normalizeStringList(value);
  const seen = new Set();
  const results = [];
  for (const candidate of values) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      const origin = parsed.origin;
      if (!seen.has(origin)) {
        seen.add(origin);
        results.push(origin);
      }
    } catch {}
  }
  return results;
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
        mediaMode: cli["media-mode"],
        useFakeMedia: cli["use-fake-media"],
        chromePath: cli["chrome-path"],
        playwrightModulePath: cli["playwright-module-path"],
        extensionPath: cli["extension-path"],
        profileDir: cli["profile-dir"],
        stageBase: cli["stage-base"],
        testPropertyUrl: cli["property-url"],
        supportPageUrl: cli["support-page-url"],
        captureSourceTitle: cli["capture-source-title"],
        insecureOrigins: (cli["insecure-origin"] !== undefined || cli["insecure-origins"] !== undefined)
          ? [cli["insecure-origin"], cli["insecure-origins"]].flat().filter((value) => typeof value === "string")
          : undefined,
        chromeArgs: cli["chrome-arg"] || cli["chrome-args"]
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
  const mediaModeFromLegacy = normalizeBooleanLike(merged.useFakeMedia);
  const mediaMode = deriveMediaMode(merged.mediaMode, mediaModeFromLegacy);

  return {
    configPath,
    role,
    side,
    account,
    busHost,
    busPort,
    busUrl: `ws://${busHost}:${busPort}`,
    displayMode: normalizeDisplayMode(merged.displayMode),
    mediaMode,
    useFakeMedia: mediaMode === "fake",
    chromePath: resolveMaybeRelativePath(merged.chromePath, cwd),
    playwrightModulePath: resolveMaybeRelativePath(
      merged.playwrightModulePath || env.UNFLUFFIFY_PLAYWRIGHT_PATH || "",
      cwd
    ),
    extensionPath,
    profileDir,
    stageBase: normalizeString(merged.stageBase),
    testPropertyUrl: normalizeString(merged.testPropertyUrl) || DEFAULT_TEST_PROPERTY_URL,
    supportPageUrl: normalizeString(merged.supportPageUrl),
    captureSourceTitle: normalizeString(merged.captureSourceTitle),
    insecureOrigins: normalizeOriginList(merged.insecureOrigins),
    chromeArgs: normalizeStringList(merged.chromeArgs),
    runRoot: resolveMaybeRelativePath(merged.runRoot || "orchestration/runs", cwd)
  };
}
