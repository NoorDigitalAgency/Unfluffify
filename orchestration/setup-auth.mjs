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

async function openConfigurationPopup(context) {
  if (!context.browserContext) {
    await launchBrowser(context);
  }
  const popup = await context.browserContext.newPage();
  await popup.goto(`chrome-extension://${context.extensionId}/popup.html`, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await popup.waitForSelector(AUTH_SETUP_SELECTORS.configToggle, { timeout: 30000 });
  await popup.click(AUTH_SETUP_SELECTORS.configToggle);
  await popup.waitForSelector(AUTH_SETUP_SELECTORS.openConfiguration, { timeout: 10000 });
  await popup.click(AUTH_SETUP_SELECTORS.openConfiguration);
  await popup.waitForSelector(AUTH_SETUP_SELECTORS.configurationEndpointInput, { timeout: 10000 });
  return popup;
}

async function ensureEditableField(page, { input, edit }) {
  const isReadOnly = await page.locator(input).evaluate((node) => Boolean(node.readOnly));
  if (!isReadOnly) {
    return;
  }
  const editButton = page.locator(edit);
  if (await editButton.count()) {
    const visible = await editButton.first().isVisible().catch(() => false);
    if (visible) {
      await editButton.first().click();
      await page.waitForFunction((selector) => {
        const inputEl = document.querySelector(selector);
        return inputEl && !inputEl.readOnly;
      }, input);
    }
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

async function waitForToken(worker, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const settings = await readGlobalSettings(worker);
    if (settings && typeof settings.globalToken === "string" && settings.globalToken.trim()) {
      return settings;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for authentication token");
}

export async function seedAuthProfile(options = {}) {
  const config = options.config || await loadOrchestrationConfig(options.configOptions || {});
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

    await popup.fill(AUTH_SETUP_SELECTORS.emailInput, account.email);
    await popup.fill(AUTH_SETUP_SELECTORS.passwordInput, account.password);
    await popup.waitForFunction((selector) => {
      const button = document.querySelector(selector);
      return button && !button.disabled;
    }, AUTH_SETUP_SELECTORS.loginAction, { timeout: 10000 });
    await popup.click(AUTH_SETUP_SELECTORS.loginAction);

    const settings = await waitForToken(context.worker);
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
