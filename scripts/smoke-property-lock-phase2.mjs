#!/usr/bin/env node
async function resolvePlaywright() {
  const candidates = [
    process.env.UNFLUFFIFY_PLAYWRIGHT_PATH,
    "/home/rojan/Desktop/test/node_modules/playwright/index.mjs",
    "/home/rojan/Documents/Git/GitHub/arcana-text/node_modules/playwright/index.mjs"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch {
      // Try the next playwright candidate.
    }
  }
  try {
    return await import("playwright");
  } catch {
    // Fall back to the next playwright resolution path.
  }
  throw new Error("Could not resolve playwright; set UNFLUFFIFY_PLAYWRIGHT_PATH to a playwright/index.mjs");
}

import path from "path";
import fs from "fs/promises";
import os from "os";

const { chromium } = await resolvePlaywright();

const REPO = "/home/rojan/Documents/Git/GitHub/Unfluffify";
const useFreshProfile = process.env.UNFLUFFIFY_SMOKE_FRESH_PROFILE === "1";
const PROFILE = useFreshProfile
  ? await fs.mkdtemp(path.join(os.tmpdir(), "unfluffify-smoke-profile-"))
  : path.join(REPO, ".mcp-browser-profile");
const CHROME = "/home/rojan/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome";

const START_URL = process.argv[2] || "https://seo.se/";
const CROSS_PROPERTY_URL = process.argv[3] || "https://www.bonliva.no/artikler/barnehagevikar-lonn";

function logStep(label, payload) {
  const suffix = typeof payload === "undefined"
    ? ""
    : ` ${typeof payload === "string" ? payload : JSON.stringify(payload)}`;
  console.log(`[smoke] ${label}${suffix}`);
}

async function getExtensionServiceWorker(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  }
  return worker;
}

async function reloadExtension(context, worker) {
  await worker.evaluate(() => chrome.runtime.reload());
  return context.waitForEvent("serviceworker", { timeout: 15000 });
}

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
async function getTargetTabId(worker, url) {
  return worker.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({});
    const normalizedTarget = targetUrl.replace(/#.*$/, "");
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

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
async function activateContentMain(worker, tabId) {
  return worker.evaluate(async (targetTabId) => {
    try {
      return await chrome.tabs.sendMessage(targetTabId, { type: "activateContentMain" });
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  }, tabId);
}

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
async function readBackgroundTabState(worker, tabId) {
  return worker.evaluate(async (targetTabId) => {
    try {
      const rawInitialKey = `tabState:initial:${targetTabId}`;
      const rawLiveKey = `tabState:${targetTabId}`;
      const [liveState, initialState] = await Promise.all([
        chrome.runtime.sendMessage({ type: "getTabState", tabId: targetTabId }),
        chrome.runtime.sendMessage({ type: "getTabState", tabId: targetTabId, scope: "initial", nullIfMissing: true })
      ]);
      const raw = await chrome.storage.session.get([rawLiveKey, rawInitialKey]);
      return { liveState, initialState, raw };
    } catch (error) {
      return { error: String(error && error.message ? error.message : error) };
    }
  }, tabId);
}

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
async function forceInitialRecoveryWrite(worker, tabId) {
  return worker.evaluate(async (targetTabId) => {
    const key = `tabState:initial:${targetTabId}`;
    await chrome.runtime.sendMessage({
      type: "setTabState",
      tabId: targetTabId,
      scope: "initial",
      state: {
        active: true,
        propertyLockRecoverySiteId: 999001,
        propertyLockRecoveryBaseUrl: "https://debug.example",
        propertyLockRecoveryClientId: "debug-client",
        propertyLockRecoveryDeadlineAt: 1234567890
      }
    });
    return chrome.storage.session.get([key]);
  }, tabId);
}

async function openPopupPage(context, extensionId, tabId) {
  const popup = await context.newPage();
  const popupConsole = [];
  popup.on("console", (msg) => {
    popupConsole.push(`${msg.type()}: ${msg.text()}`);
  });
  popup.on("pageerror", (error) => {
    popupConsole.push(`pageerror: ${error.message}`);
  });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?debugTabId=${tabId}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  // Wait for at least one meaningful UI element — not just any body text — so
  // we can distinguish a loaded popup from a blank flash before the first render.
  await popup.waitForFunction(() => {
    return Boolean(
      document.querySelector("#toggle-enabled") ||
      document.querySelector(".property-lock__status") ||
      document.querySelector(".property-lock") ||
      document.querySelector("#base-url-input") ||
      document.querySelector("#close-tab")
    );
  }, { timeout: 30000 });
  // Give the popup's async refreshUi() a chance to resolve property-lock state
  // and initial-tab-state before we inspect it. Retry up to 3 times if the
  // popup still looks unloaded.
  let attempts = 0;
  while (attempts < 3) {
    await popup.waitForTimeout(2000);
    const hasContent = await popup.evaluate(() => {
      const body = document.body?.innerText?.trim() || "";
      return body.length > 20;
    });
    if (hasContent) {
      break;
    }
    attempts++;
  }
  const popupBody = await popup.evaluate(() => document.body?.innerText?.trim() || "");
  logStep("popup-body", popupBody.slice(0, 500));
  if (popupConsole.length) {
    logStep("popup-console", popupConsole);
  }
  return popup;
}

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
async function readPopupState(popup) {
  return popup.evaluate(() => {
    const candidateAnchors = Array.from(document.querySelectorAll(".todo-candidate a.todo-candidate-link"));
    const candidateSpans = Array.from(document.querySelectorAll(".todo-candidate span.todo-candidate-link"));
    return {
      propertyLockStatus: document.querySelector(".property-lock__status")?.textContent?.trim() || "",
      propertyLockDetail: document.querySelector(".property-lock__detail")?.textContent?.trim() || "",
      propertyLockButtons: Array.from(document.querySelectorAll(".property-lock__actions button")).map((button) => button.textContent?.trim() || ""),
      markingEnabled: Boolean(document.querySelector("#toggle-enabled")?.checked),
      markingToggleDisabled: Boolean(document.querySelector("#toggle-enabled")?.disabled),
      desktopPreviewVisible: Boolean(document.querySelector("#desktop-preview-enabled")),
      desktopPreviewEnabled: Boolean(document.querySelector("#desktop-preview-enabled")?.checked),
      pageTypeNotice: document.querySelector(".page-types__notice, .warning-notice, .hint")?.textContent?.trim() || "",
      candidates: candidateAnchors.map((anchor) => ({
        label: anchor.textContent?.trim() || "",
        url: anchor.getAttribute("href") || ""
      })),
      disabledCandidates: candidateSpans.map((span) => span.textContent?.trim() || "")
    };
  });
}

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
async function readPageBanner(page) {
  return page.evaluate(() => ({
    bannerText: document.querySelector("#unfluffify-lock-banner .uf-lock-banner-content")?.textContent?.trim() || "",
    href: location.href
  }));
}

async function waitForPopupRefresh(popup, delayMs = 3500) {
  await popup.waitForTimeout(delayMs);
  return readPopupState(popup);
}

async function reopenPopup(context, extensionId, tabId, popup, delayMs = 1500) {
  if (popup) {
    await popup.close().catch(() => {});
  }
  const nextPopup = await openPopupPage(context, extensionId, tabId);
  await nextPopup.waitForTimeout(delayMs);
  return nextPopup;
}

async function ensureEditorRole(popup) {
  const state = await readPopupState(popup);
  if (/You are editing this property/i.test(state.propertyLockStatus)) {
    return state;
  }
  if (state.propertyLockButtons.includes("Take over")) {
    await popup.getByRole("button", { name: "Take over" }).click();
    return waitForPopupRefresh(popup);
  }
  if (state.propertyLockButtons.includes("Start editing again")) {
    await popup.getByRole("button", { name: "Start editing again" }).click();
    return waitForPopupRefresh(popup);
  }
  if (state.propertyLockButtons.includes("Continue editing")) {
    await popup.getByRole("button", { name: "Continue editing" }).click();
    return waitForPopupRefresh(popup);
  }
  return state;
}

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
async function collectSameOriginNonCandidateUrl(page, candidateUrls) {
  return page.evaluate((blockedUrls) => {
    const blocked = new Set(blockedUrls.map((url) => url.replace(/#.*$/, "")));
    const current = location.href.replace(/#.*$/, "");
    const origin = location.origin;
    const hrefs = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => anchor.href)
      .filter((href) => href && href.startsWith(origin))
      .map((href) => href.replace(/#.*$/, ""));
    return hrefs.find((href) => href !== current && !blocked.has(href)) || "";
  }, candidateUrls);
}

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  executablePath: CHROME,
  ignoreDefaultArgs: ["--disable-extensions"],
  chromiumSandbox: false,
  args: [
    "--no-sandbox",
    `--load-extension=${REPO}`,
    `--disable-extensions-except=${REPO}`
  ]
});

let exitCode = 0;
try {
  let worker = await getExtensionServiceWorker(context);
  worker = await reloadExtension(context, worker);
  const extensionId = new URL(worker.url()).host;
  logStep("extension", { extensionId });

  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  const syncConfig = await worker.evaluate(async () => {
    return chrome.storage.sync.get([
      "globalConfigEndpoint",
      "globalStageBase",
      "globalToken"
    ]);
  });
  logStep("sync-config", {
    hasConfigEndpoint: Boolean(syncConfig.globalConfigEndpoint),
    hasStageBase: Boolean(syncConfig.globalStageBase),
    hasToken: Boolean(syncConfig.globalToken)
  });

  const page = await context.newPage();
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);

  const tabId = await getTargetTabId(worker, START_URL);
  if (!Number.isFinite(tabId)) {
    throw new Error(`Could not resolve tabId for ${START_URL}`);
  }
  logStep("target-tab", { tabId, url: START_URL });

  const activation = await activateContentMain(worker, tabId);
  logStep("activate-content-main", activation);
  await page.waitForTimeout(2000);

  let popup = await openPopupPage(context, extensionId, tabId);
  let popupState = await ensureEditorRole(popup);
  const initialPopupState = popupState;
  let pageBanner = await readPageBanner(page);
  let backgroundTabState = await readBackgroundTabState(worker, tabId);
  logStep("initial-popup", popupState);
  logStep("initial-banner", pageBanner);
  logStep("initial-tab-state", backgroundTabState);
  logStep("forced-initial-write", await forceInitialRecoveryWrite(worker, tabId));
  backgroundTabState = await readBackgroundTabState(worker, tabId);
  logStep("post-force-tab-state", backgroundTabState);

  const candidateUrls = popupState.candidates.map((item) => item.url).filter(Boolean);
  const secondCandidateUrl = candidateUrls.find((url) => url.replace(/#.*$/, "") !== START_URL.replace(/#.*$/, ""));
  const nonCandidateUrl = await collectSameOriginNonCandidateUrl(page, candidateUrls);
  logStep("candidate-urls", candidateUrls);
  logStep("non-candidate-url", nonCandidateUrl || "<none>");

  if (secondCandidateUrl) {
    await page.goto(secondCandidateUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    popup = await reopenPopup(context, extensionId, tabId, popup);
    popupState = await readPopupState(popup);
    pageBanner = await readPageBanner(page);
    backgroundTabState = await readBackgroundTabState(worker, tabId);
    logStep("same-property-candidate", {
      url: secondCandidateUrl,
      popupState,
      pageBanner,
      backgroundTabState
    });
  } else {
    logStep("same-property-candidate", "skipped: no second candidate exposed in popup");
  }

  if (nonCandidateUrl) {
    await page.goto(nonCandidateUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    popup = await reopenPopup(context, extensionId, tabId, popup);
    popupState = await readPopupState(popup);
    pageBanner = await readPageBanner(page);
    backgroundTabState = await readBackgroundTabState(worker, tabId);
    logStep("same-property-off-candidate", {
      url: nonCandidateUrl,
      popupState,
      pageBanner,
      backgroundTabState
    });
  } else {
    logStep("same-property-off-candidate", "skipped: no same-origin non-candidate link found");
  }

  await page.goto(CROSS_PROPERTY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  popup = await reopenPopup(context, extensionId, tabId, popup);
  popupState = await readPopupState(popup);
  pageBanner = await readPageBanner(page);
  backgroundTabState = await readBackgroundTabState(worker, tabId);
  const crossPropertyPopupState = popupState;
  logStep("cross-property", {
    url: CROSS_PROPERTY_URL,
    popupState,
    pageBanner,
    backgroundTabState
  });

  const returnUrl = secondCandidateUrl || START_URL;
  await page.goto(returnUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  popup = await reopenPopup(context, extensionId, tabId, popup);
  popupState = await readPopupState(popup);
  pageBanner = await readPageBanner(page);
  backgroundTabState = await readBackgroundTabState(worker, tabId);
  logStep("return-to-original-property", {
    url: returnUrl,
    popupState,
    pageBanner,
    backgroundTabState
  });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });

  const checks = {
    initialEditor: /editing this property|Take over|Continue editing|Start editing again/i.test((initialPopupState.propertyLockStatus || "") + " " + initialPopupState.propertyLockButtons.join(" ")),
    crossPropertyCountdown: /Previous property held|return to it within/i.test(`${crossPropertyPopupState.propertyLockStatus} ${crossPropertyPopupState.propertyLockDetail}`),
    returnRecovered: /You are editing this property/i.test(popupState.propertyLockStatus)
  };
  logStep("checks", checks);
  if (!checks.initialEditor || !checks.crossPropertyCountdown || !checks.returnRecovered) {
    exitCode = 1;
  }

  if (consoleErrors.length) {
    logStep("console-errors", consoleErrors);
  }

  await popup.close();
  await page.close();
} catch (error) {
  exitCode = 1;
  console.error("[smoke] failure", error && error.stack ? error.stack : error);
} finally {
  await context.close();
  if (useFreshProfile) {
    await fs.rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  }
}

process.exit(exitCode);
