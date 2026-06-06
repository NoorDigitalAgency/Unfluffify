#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrchestrationConfig, parseCliArgs } from "./lib/config.mjs";
import {
  loadOrchestrationSecrets,
  resolveSecretAccount
} from "./lib/secrets.mjs";
import {
  createBrowserStepContext,
  launchBrowser,
  teardown
} from "./steps/browser.mjs";

export const AUTH_SETUP_SELECTORS = Object.freeze({
  configToggle: "#config-toggle",
  openConfiguration: "#config-open-view",
  configurationEndpointInput: "#config-endpoint-url",
  configurationEndpointSet: "#config-endpoint-url-set",
  configurationEndpointEdit: "#config-endpoint-url-edit",
  aiEndpointInput: "#endpoint-url",
  aiEndpointSet: "#endpoint-url-set",
  aiEndpointEdit: "#endpoint-url-edit",
  stageBaseInput: "#stage-base",
  stageBaseSet: "#stage-base-set",
  stageBaseEdit: "#stage-base-edit",
  emailInput: "#login-email",
  passwordInput: "#login-password",
  loginAction: "#login-action",
  tokenStatus: "#token-status"
});

export function validateAuthProfileTarget(config = {}) {
  const expectedProfileName =
    config.role === "follower" || String(config.side || "").toUpperCase() === "B"
      ? "follower"
      : "director";
  const profileName = path.basename(String(config.profileDir || "")).toLowerCase();
  if (
    (profileName === "director" || profileName === "follower") &&
    profileName !== expectedProfileName
  ) {
    throw new Error(
      `Refusing to seed ${expectedProfileName} auth into ${profileName} profile; ` +
        "pass --profile-dir for the intended side"
    );
  }
  return true;
}

export async function openConfigurationPopup(context) {
  if (!context.browserContext) {
    await launchBrowser(context);
  }
  const popup = await context.browserContext.newPage();
  await popup.goto(`chrome-extension://${context.extensionId}/popup.html`, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  const configurationVisible = await popup
    .waitForSelector(AUTH_SETUP_SELECTORS.configurationEndpointInput, {
      state: "visible",
      timeout: 5000
    })
    .then(() => true, () => false);
  if (configurationVisible) {
    return popup;
  }
  await popup.waitForSelector(AUTH_SETUP_SELECTORS.configToggle, { timeout: 30000 });
  await popup.click(AUTH_SETUP_SELECTORS.configToggle);
  await popup.waitForSelector(AUTH_SETUP_SELECTORS.openConfiguration, { timeout: 10000 });
  await popup.click(AUTH_SETUP_SELECTORS.openConfiguration);
  await popup.waitForSelector(AUTH_SETUP_SELECTORS.configurationEndpointInput, {
    state: "visible",
    timeout: 10000
  });
  return popup;
}

export async function ensureEditableField(page, { input, edit }) {
  await page.waitForSelector(input, { state: "visible", timeout: 10000 });
  const isReadOnly = await page.locator(input).evaluate((node) => Boolean(node.readOnly));
  if (!isReadOnly) {
    return;
  }
  const editButton = page.locator(edit).first();
  const editVisible = await editButton
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true, () => false);
  if (editVisible) {
    await editButton.click();
    await page.waitForFunction((selector) => {
      const inputEl = document.querySelector(selector);
      return inputEl && !inputEl.readOnly;
    }, input, { timeout: 10000 });
  }
  const stillReadOnly = await page.locator(input).evaluate((node) => Boolean(node.readOnly));
  if (stillReadOnly) {
    throw new Error(`Configuration field ${input} is read-only and ${edit} was not available`);
  }
}

async function setConfigurationField(page, { input, set, edit }, value) {
  await ensureEditableField(page, { input, edit });
  await page.fill(input, value);
  await page.click(set);
  await page.waitForFunction((selector) => {
    const inputEl = document.querySelector(selector);
    return inputEl && inputEl.readOnly;
  }, input, { timeout: 10000 }).catch(() => {});
}

async function readGlobalSettings(worker) {
  return worker.evaluate(async () => chrome.storage.sync.get([
    "globalConfigEndpoint",
    "globalEndpoint",
    "globalStageBase",
    "globalToken"
  ]));
}

export async function clearStoredAuthToken(worker) {
  await worker.evaluate(async () => {
    await chrome.storage.sync.set({ globalToken: "" });
  });
}

async function readAuthStatus(popup) {
  if (!popup) {
    return null;
  }
  return popup.evaluate((selectors) => {
    const readText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
    return {
      tokenStatusText: readText(selectors.tokenStatus),
      toastText: readText("#toast")
    };
  }, AUTH_SETUP_SELECTORS).catch(() => null);
}

function formatAuthStatus(status) {
  const parts = [];
  if (status && status.tokenStatusText) {
    parts.push(`token status: ${status.tokenStatusText}`);
  }
  if (status && status.toastText) {
    parts.push(`toast: ${status.toastText}`);
  }
  return parts.length ? ` (${parts.join("; ")})` : "";
}

export async function waitForToken(worker, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 30000;
  const pollIntervalMs = Number(options.pollIntervalMs) || 500;
  const popup = options.popup || null;
  const startedAt = Date.now();
  let latestAuthStatus = null;
  while (Date.now() - startedAt <= timeoutMs) {
    const settings = await readGlobalSettings(worker);
    if (settings && typeof settings.globalToken === "string" && settings.globalToken.trim()) {
      return settings;
    }
    latestAuthStatus = await readAuthStatus(popup) || latestAuthStatus;
    const toastText = latestAuthStatus && latestAuthStatus.toastText
      ? latestAuthStatus.toastText
      : "";
    if (/login failed|missing token|login request failed/i.test(toastText)) {
      throw new Error(`Authentication failed before token was saved${formatAuthStatus(latestAuthStatus)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Timed out waiting for authentication token${formatAuthStatus(latestAuthStatus)}`);
}

export async function seedAuthProfile(options = {}) {
  const config = options.config || await loadOrchestrationConfig(options.configOptions || {});
  validateAuthProfileTarget(config);
  const secretsResult = options.secrets
    ? { secrets: options.secrets, secretsPath: "" }
    : await loadOrchestrationSecrets({
        cwd: options.cwd || process.cwd(),
        secretsPath: options.secretsPath
      });
  const secrets = secretsResult.secrets;
  const account = resolveSecretAccount(secrets, config.account);
  const context = createBrowserStepContext(config, {
    playwright: options.playwright,
    artifacts: options.artifacts || null
  });

  let popup = null;
  try {
    await launchBrowser(context);
    await clearStoredAuthToken(context.worker);
    popup = await openConfigurationPopup(context);
    await setConfigurationField(popup, {
      input: AUTH_SETUP_SELECTORS.configurationEndpointInput,
      set: AUTH_SETUP_SELECTORS.configurationEndpointSet,
      edit: AUTH_SETUP_SELECTORS.configurationEndpointEdit
    }, secrets.config.configurationEndpoint);
    await setConfigurationField(popup, {
      input: AUTH_SETUP_SELECTORS.aiEndpointInput,
      set: AUTH_SETUP_SELECTORS.aiEndpointSet,
      edit: AUTH_SETUP_SELECTORS.aiEndpointEdit
    }, secrets.config.aiEndpoint);
    await setConfigurationField(popup, {
      input: AUTH_SETUP_SELECTORS.stageBaseInput,
      set: AUTH_SETUP_SELECTORS.stageBaseSet,
      edit: AUTH_SETUP_SELECTORS.stageBaseEdit
    }, secrets.config.stageBase);

    await clearStoredAuthToken(context.worker);
    await popup.fill(AUTH_SETUP_SELECTORS.emailInput, account.email);
    await popup.fill(AUTH_SETUP_SELECTORS.passwordInput, account.password);
    await popup.waitForFunction((selector) => {
      const button = document.querySelector(selector);
      return button && !button.disabled;
    }, AUTH_SETUP_SELECTORS.loginAction, { timeout: 10000 });
    await popup.click(AUTH_SETUP_SELECTORS.loginAction);

    const settings = await waitForToken(context.worker, { popup });
    return {
      ok: true,
      account: config.account,
      profileDir: config.profileDir,
      settings: {
        globalConfigEndpoint: settings.globalConfigEndpoint || "",
        globalEndpoint: settings.globalEndpoint || "",
        globalStageBase: settings.globalStageBase || "",
        hasToken: Boolean(settings.globalToken)
      }
    };
  } finally {
    if (popup) {
      await popup.close().catch(() => {});
    }
    await teardown(context);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const cli = parseCliArgs(argv);
  const result = await seedAuthProfile({
    configOptions: { argv, requireConfig: cli["require-config"] === true },
    secretsPath: typeof cli.secrets === "string" ? cli.secrets : undefined
  });
  console.log(JSON.stringify(result, null, 2));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
