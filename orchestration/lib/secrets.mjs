import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SECRETS_PATH = "orchestration/.secrets.json";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assertValidUrl(value, fieldName) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${fieldName} is required`);
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(`${fieldName} must be a valid http(s) URL`);
  }
}

export function normalizeStageBase(value) {
  if (!isNonEmptyString(value)) {
    return "";
  }
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function assertValidEmail(value, fieldName) {
  if (!isNonEmptyString(value) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new Error(`${fieldName} must be a valid email`);
  }
}

export function validateOrchestrationSecrets(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Secrets file must contain a JSON object");
  }

  const config = candidate.config && typeof candidate.config === "object"
    ? candidate.config
    : {};
  assertValidUrl(config.configurationEndpoint, "config.configurationEndpoint");
  assertValidUrl(config.aiEndpoint, "config.aiEndpoint");
  const stageBase = normalizeStageBase(config.stageBase);
  if (!stageBase) {
    throw new Error("config.stageBase must be a valid host name");
  }

  const accounts = candidate.accounts && typeof candidate.accounts === "object"
    ? candidate.accounts
    : {};
  const normalizedAccounts = {};
  for (const [key, value] of Object.entries(accounts)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    assertValidEmail(value.email, `accounts.${key}.email`);
    if (!isNonEmptyString(value.password)) {
      throw new Error(`accounts.${key}.password is required`);
    }
    normalizedAccounts[key] = {
      email: value.email.trim(),
      password: value.password
    };
  }

  if (!Object.keys(normalizedAccounts).length) {
    throw new Error("At least one account is required");
  }

  return {
    config: {
      configurationEndpoint: config.configurationEndpoint.trim(),
      aiEndpoint: config.aiEndpoint.trim(),
      stageBase
    },
    accounts: normalizedAccounts
  };
}

export async function loadOrchestrationSecrets(options = {}) {
  const cwd = options.cwd || process.cwd();
  const secretsPath = path.resolve(cwd, options.secretsPath || DEFAULT_SECRETS_PATH);
  let raw = "";
  try {
    raw = await fs.readFile(secretsPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`Missing orchestration secrets: ${secretsPath}`);
    }
    throw error;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in orchestration secrets: ${secretsPath}`);
  }

  return {
    secretsPath,
    secrets: validateOrchestrationSecrets(parsed)
  };
}

export function resolveSecretAccount(secrets, accountKey) {
  const normalizedAccountKey = isNonEmptyString(accountKey) ? accountKey.trim() : "";
  const account = secrets &&
    secrets.accounts &&
    normalizedAccountKey &&
    secrets.accounts[normalizedAccountKey];
  if (!account) {
    throw new Error(`Missing account in orchestration secrets: ${normalizedAccountKey || "(empty)"}`);
  }
  return account;
}
