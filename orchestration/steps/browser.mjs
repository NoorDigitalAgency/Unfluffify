import { dirname, join, resolve, toFileUrl } from "@std/path";

const DEFAULT_VIEWPORT = { width: 1280, height: 1024 };
const CHROME_PROFILE_PREFERENCES_PATH = join("Default", "Preferences");

async function resolvePlaywright(config) {
  const candidates = [
    config && config.playwrightModulePath,
    Deno.env.get("UNFLUFFIFY_PLAYWRIGHT_PATH"),
    "/home/rojan/Desktop/test/node_modules/playwright/index.mjs",
    "/home/rojan/Documents/Git/GitHub/arcana-text/node_modules/playwright/index.mjs"
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const specifier = String(candidate);
      return await import(specifier.startsWith("npm:") ? specifier : toFileUrl(resolve(specifier)).href);
    } catch {}
  }

  try {
    return await import("npm:playwright");
  } catch {}

  throw new Error("Could not resolve playwright; set playwrightModulePath or UNFLUFFIFY_PLAYWRIGHT_PATH");
}

export function buildChromeLaunchArgs(config = {}) {
  const extensionPath = config.extensionPath || Deno.cwd();
  const mediaMode = config.mediaMode === "real" ? "real" : "fake";
  const extraOrigins = Array.isArray(config.insecureOrigins) ? config.insecureOrigins : [];
  const originCandidates = [config.testPropertyUrl, config.supportPageUrl, ...extraOrigins]
    .filter((value) => typeof value === "string" && value.trim().length > 0);
  const insecureOrigins = Array.from(
    new Set(
      originCandidates.map((value) => {
        try {
          const parsed = new URL(value);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return "";
          }
          return parsed.origin;
        } catch {
          return "";
        }
      }).filter(Boolean)
    )
  );
  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--auto-accept-camera-and-microphone-capture",
    "--allow-http-screen-capture",
    "--disable-features=MediaRouter"
  ];

  if (mediaMode === "fake") {
    args.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream");
  }
  if (config.displayMode === "wayland") {
    args.push("--ozone-platform=wayland");
  }
  if (insecureOrigins.length) {
    args.push(`--unsafely-treat-insecure-origin-as-secure=${insecureOrigins.join(",")}`);
  }
  if (config.captureSourceTitle) {
    args.push(`--auto-select-desktop-capture-source=${config.captureSourceTitle}`);
  }
  if (Array.isArray(config.chromeArgs)) {
    args.push(...config.chromeArgs.filter((arg) => typeof arg === "string" && arg.trim()));
  }
  ensureChromeFeatureDisabled(args, "MediaRouter");
  ensureChromeFeatureEnabled(args, "WebRTCPipeWireCapturer");

  return Array.from(new Set(args));
}

function ensureChromeFeatureEnabled(args, featureName) {
  const indices = [];
  const allFeatures = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith("--enable-features=")) {
      indices.push(index);
      const rawFeatures = args[index].slice("--enable-features=".length);
      rawFeatures
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((feature) => {
          if (!allFeatures.includes(feature)) {
            allFeatures.push(feature);
          }
        });
    }
  }

  if (!allFeatures.includes(featureName)) {
    allFeatures.push(featureName);
  }

  const consolidated = `--enable-features=${allFeatures.join(",")}`;

  if (indices.length === 0) {
    args.push(consolidated);
    return;
  }

  args[indices[0]] = consolidated;
  for (let i = indices.length - 1; i >= 1; i -= 1) {
    args.splice(indices[i], 1);
  }
}

function ensureChromeFeatureDisabled(args, featureName) {
  const indices = [];
  const allFeatures = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith("--disable-features=")) {
      indices.push(index);
      const rawFeatures = args[index].slice("--disable-features=".length);
      rawFeatures
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((feature) => {
          if (!allFeatures.includes(feature)) {
            allFeatures.push(feature);
          }
        });
    }
  }

  if (!allFeatures.includes(featureName)) {
    allFeatures.push(featureName);
  }

  const consolidated = `--disable-features=${allFeatures.join(",")}`;

  if (indices.length === 0) {
    args.push(consolidated);
    return;
  }

  args[indices[0]] = consolidated;
  for (let i = indices.length - 1; i >= 1; i -= 1) {
    args.splice(indices[i], 1);
  }
}

export function createBrowserStepContext(config, options = {}) {
  return {
    config,
    playwright: options.playwright || null,
    browserContext: null,
    page: null,
    popup: null,
    worker: null,
    extensionId: "",
    tabId: null,
    artifacts: options.artifacts || null
  };
}

async function getExtensionServiceWorker(browserContext) {
  let worker = browserContext.serviceWorkers()[0];
  if (!worker) {
    worker = await browserContext.waitForEvent("serviceworker", { timeout: 15000 });
  }
  return worker;
}

function hasDisableReasons(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

function isDisabledUnpackedExtensionSetting(setting, extensionPath) {
  if (!setting || typeof setting !== "object" || typeof setting.path !== "string") {
    return false;
  }
  if (resolve(setting.path) !== extensionPath) {
    return false;
  }
  return setting.state === 0 || hasDisableReasons(setting.disable_reasons);
}

export async function clearDisabledUnpackedExtensionPreference(config = {}) {
  const profileDir = config.profileDir;
  if (!profileDir) {
    return { ok: true, cleared: 0, reason: "missingProfileDir" };
  }

  const extensionPath = resolve(config.extensionPath || Deno.cwd());
  const preferencesPath = join(profileDir, CHROME_PROFILE_PREFERENCES_PATH);
  let rawPreferences;
  try {
    rawPreferences = await Deno.readTextFile(preferencesPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { ok: true, cleared: 0, reason: "missingPreferences" };
    }
    throw error;
  }

  const preferences = JSON.parse(rawPreferences);
  const settings = preferences.extensions && preferences.extensions.settings;
  if (!settings || typeof settings !== "object") {
    return { ok: true, cleared: 0, reason: "missingExtensionSettings" };
  }

  const disabledExtensionIds = Object.entries(settings)
    .filter(([, setting]) => isDisabledUnpackedExtensionSetting(setting, extensionPath))
    .map(([extensionId]) => extensionId);

  for (const extensionId of disabledExtensionIds) {
    delete settings[extensionId];
  }

  if (!disabledExtensionIds.length) {
    return { ok: true, cleared: 0, preferencesPath };
  }

  await Deno.writeTextFile(preferencesPath, JSON.stringify(preferences));
  return {
    ok: true,
    cleared: disabledExtensionIds.length,
    extensionIds: disabledExtensionIds,
    preferencesPath
  };
}

export async function reloadExtension(browserContext, worker) {
  const nextWorkerPromise = browserContext
    .waitForEvent("serviceworker", { timeout: 15000 })
    .catch(() => null);
  await worker.evaluate(() => chrome.runtime.reload());
  const nextWorker = await nextWorkerPromise;
  if (nextWorker) {
    return nextWorker;
  }
  const [activeWorker] = browserContext.serviceWorkers();
  if (activeWorker) {
    return activeWorker;
  }
  return browserContext.waitForEvent("serviceworker", { timeout: 5000 });
}

async function getTargetTabId(worker, url) {
  return worker.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({});
    const normalizedTarget = String(targetUrl || "").replace(/#.*$/, "");
    const exact = tabs.find((tab) => (tab.url || "").replace(/#.*$/, "") === normalizedTarget);
    if (exact && Number.isFinite(exact.id)) {
      return exact.id;
    }
    const fallback = tabs.find((tab) => {
      const tabUrl = (tab.url || "").replace(/#.*$/, "");
      return tabUrl && normalizedTarget && tabUrl.startsWith(normalizedTarget.split("?")[0]);
    });
    return fallback && Number.isFinite(fallback.id) ? fallback.id : null;
  }, url);
}

async function activateContentMain(worker, tabId) {
  if (!worker || !Number.isFinite(tabId)) {
    return { ok: false, error: "Missing worker or tab id" };
  }
  return worker.evaluate(async (targetTabId) => {
    try {
      return await chrome.tabs.sendMessage(targetTabId, { type: "activateContentMain" });
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  }, tabId);
}

async function readBackgroundTabState(worker, tabId) {
  if (!worker || !Number.isFinite(tabId)) {
    return { ok: false, error: "Missing worker or tab id" };
  }
  return worker.evaluate(async (targetTabId) => {
    try {
      const rawInitialKey = `tabState:initial:${targetTabId}`;
      const rawLiveKey = `tabState:${targetTabId}`;
      const [liveState, initialState] = await Promise.all([
        chrome.runtime.sendMessage({ type: "getTabState", tabId: targetTabId }),
        chrome.runtime.sendMessage({
          type: "getTabState",
          tabId: targetTabId,
          scope: "initial",
          nullIfMissing: true
        })
      ]);
      const raw = await chrome.storage.session.get([rawLiveKey, rawInitialKey]);
      return { liveState, initialState, raw };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  }, tabId);
}

async function readPageBanner(page) {
  if (!page) {
    return { ok: false, error: "No active page" };
  }
  return page.evaluate(() => ({
    href: location.href,
    bannerText: document.querySelector("#unfluffify-lock-banner .uf-lock-banner-content")?.textContent?.trim() || ""
  }));
}

async function readPopupState(popup) {
  if (!popup) {
    return { ok: false, error: "No popup page" };
  }
  return popup.evaluate(() => {
    const candidateAnchors = Array.from(document.querySelectorAll(".todo-candidate a.todo-candidate-link"));
    const candidateSpans = Array.from(document.querySelectorAll(".todo-candidate span.todo-candidate-link"));
    return {
      propertyLockStatus: document.querySelector(".property-lock__status")?.textContent?.trim() || "",
      propertyLockDetail: document.querySelector(".property-lock__detail")?.textContent?.trim() || "",
      propertyLockButtons: Array.from(document.querySelectorAll(".property-lock__actions button"))
        .map((button) => button.textContent?.trim() || ""),
      markingEnabled: Boolean(document.querySelector("#toggle-enabled")?.checked),
      markingToggleDisabled: Boolean(document.querySelector("#toggle-enabled")?.disabled),
      desktopPreviewVisible: Boolean(document.querySelector("#desktop-preview-enabled")),
      desktopPreviewEnabled: Boolean(document.querySelector("#desktop-preview-enabled")?.checked),
      candidates: candidateAnchors.map((anchor) => ({
        label: anchor.textContent?.trim() || "",
        url: anchor.getAttribute("href") || ""
      })),
      disabledCandidates: candidateSpans.map((span) => span.textContent?.trim() || "")
    };
  });
}

async function writeArtifact(context, name, value) {
  if (!context.artifacts || !context.artifacts.runDir) {
    return "";
  }
  const filePath = join(context.artifacts.runDir, name);
  await Deno.mkdir(dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

export async function launchBrowser(context) {
  if (context.browserContext) {
    return { ok: true, reused: true, extensionId: context.extensionId };
  }

  const playwright = context.playwright || await resolvePlaywright(context.config);
  const launchOptions = {
    headless: false,
    args: buildChromeLaunchArgs(context.config),
    viewport: DEFAULT_VIEWPORT
  };
  if (context.config.chromePath) {
    launchOptions.executablePath = context.config.chromePath;
  }

  await Deno.mkdir(context.config.profileDir, { recursive: true });
  await clearDisabledUnpackedExtensionPreference(context.config);
  context.browserContext = await playwright.chromium.launchPersistentContext(
    context.config.profileDir,
    launchOptions
  );
  context.worker = await getExtensionServiceWorker(context.browserContext);
  context.extensionId = context.worker.url().split("/")[2] || "";

  return {
    ok: true,
    extensionId: context.extensionId,
    profileDir: context.config.profileDir,
    launchArgs: launchOptions.args
  };
}

export async function openProperty(context, params = {}) {
  if (!context.browserContext) {
    await launchBrowser(context);
  }
  const url = params.url || context.config.testPropertyUrl;
  context.page = context.page || await context.browserContext.newPage();
  await context.page.goto(url, {
    waitUntil: params.waitUntil || "domcontentloaded",
    timeout: Number(params.timeoutMs) || 30000
  });
  context.tabId = await getTargetTabId(context.worker, context.page.url());
  const activation = await activateContentMain(context.worker, context.tabId);
  return {
    ok: true,
    url: context.page.url(),
    tabId: context.tabId,
    activation
  };
}

export async function openPopup(context) {
  if (!context.browserContext) {
    await launchBrowser(context);
  }
  if (!context.tabId && context.page) {
    context.tabId = await getTargetTabId(context.worker, context.page.url());
  }
  if (!Number.isFinite(context.tabId)) {
    throw new Error("Open a property page before opening the popup");
  }
  if (context.popup) {
    await context.popup.close().catch(() => {});
  }
  context.popup = await context.browserContext.newPage();
  await context.popup.goto(
    `chrome-extension://${context.extensionId}/popup.html?debugTabId=${context.tabId}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );
  await context.popup.waitForFunction(() => {
    return Boolean(
      document.querySelector("#toggle-enabled") ||
        document.querySelector(".property-lock__status") ||
        document.querySelector(".property-lock") ||
        document.querySelector("#base-url-input") ||
        document.querySelector("#close-tab")
    );
  }, { timeout: 30000 });
  return {
    ok: true,
    tabId: context.tabId,
    popupUrl: context.popup.url()
  };
}

export async function readState(context) {
  const [pageBanner, popupState, tabState] = await Promise.all([
    readPageBanner(context.page),
    readPopupState(context.popup),
    readBackgroundTabState(context.worker, context.tabId)
  ]);
  const state = {
    ok: true,
    role: context.config.role,
    side: context.config.side,
    url: context.page ? context.page.url() : "",
    tabId: context.tabId,
    pageBanner,
    popupState,
    tabState
  };
  const artifactPath = await writeArtifact(context, "state-latest.json", state);
  return {
    ...state,
    artifactPath
  };
}

export async function teardown(context) {
  if (context.popup) {
    await context.popup.close().catch(() => {});
    context.popup = null;
  }
  if (context.page) {
    await context.page.close().catch(() => {});
    context.page = null;
  }
  if (context.browserContext) {
    await context.browserContext.close().catch(() => {});
    context.browserContext = null;
  }
  context.worker = null;
  context.extensionId = "";
  context.tabId = null;
  return { ok: true };
}

export function createBrowserStepRegistry(context) {
  return {
    launchBrowser: () => launchBrowser(context),
    openProperty: (params) => openProperty(context, params),
    openPopup: () => openPopup(context),
    readState: () => readState(context),
    teardown: () => teardown(context)
  };
}
