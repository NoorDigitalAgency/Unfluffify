/**
 * @fileoverview Content loader script for the Unfluffify extension.
 * 
 * This script is the first content script injected into web pages. It's responsible for:
 * - Checking if the main content script is already loaded
 * - Loading and initializing the main content script (content-main.js) when needed
 * - Preventing duplicate loading of the main script
 * - Handling messages to activate content features
 * 
 * The content-main.js script is loaded dynamically via import() and executed
 * in the page's isolated world to access page content properly.
 */

const loaderState = globalThis as unknown as Record<string, unknown>;

// Avoid re-declaring globals if content-loader is injected multiple times.
if (!loaderState.__unfluffifyContentLoaderInitialized) {
  loaderState.__unfluffifyContentLoaderInitialized = true;

  const CONTENT_MAIN_FLAG = "__unfluffifyContentMainLoaded";
  const CONTENT_MAIN_LOADING = "__unfluffifyContentMainLoading";

  /**
   * Ensures the content main script is loaded and initialized.
   * Uses flags to prevent duplicate loading and handle concurrent requests.
   * @async
   * @returns {Promise<{ok: boolean, alreadyLoaded?: boolean}>}
   */
  async function ensureContentMainLoaded() {
    if (loaderState[CONTENT_MAIN_FLAG]) {
      return { ok: true, alreadyLoaded: true };
    }
    if (loaderState[CONTENT_MAIN_LOADING]) {
      await (loaderState[CONTENT_MAIN_LOADING] as Promise<void>);
      return { ok: true, alreadyLoaded: true };
    }
    const loadPromise = (async () => {
      const src = chrome.runtime.getURL("content-main.js");
      const contentMain = await import(src);
      if (contentMain && typeof contentMain.main === "function") {
        contentMain.main();
      }
      loaderState[CONTENT_MAIN_FLAG] = true;
    })();
    loaderState[CONTENT_MAIN_LOADING] = loadPromise;
    try {
      await loadPromise;
    } finally {
      loaderState[CONTENT_MAIN_LOADING] = null;
    }
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "activateContentMain") {
      return;
    }
    ensureContentMainLoaded()
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }));
    return true;
  });

  async function isDebugSpinnerQueueEnabled() {
    try {
      if (
        typeof window !== "undefined" &&
        window.localStorage &&
        window.localStorage.getItem("ufDebugSpinnerQueue") === "1"
      ) {
        return true;
      }
    } catch {
      // Fall through to the build-time feature flag.
    }
    try {
      const featureFlags = await import(chrome.runtime.getURL("common/feature-flags.js"));
      return Boolean(
        featureFlags &&
        typeof featureFlags.isDebugFlagEnabled === "function" &&
        featureFlags.isDebugFlagEnabled("ufDebugSpinnerQueue")
      );
    } catch {
      return false;
    }
  }

  // Debug hook: when debug mode is active, expose this tab's ID via a DOM
  // dataset attribute so Playwright can read it with:
  //   page.evaluate(() => document.documentElement.dataset.ufDebugTabId)
  // Activate through DEBUG_FLAGS.ufDebugSpinnerQueue or by setting the legacy
  // localStorage.ufDebugSpinnerQueue = "1" override on the page.
  isDebugSpinnerQueueEnabled().then((enabled) => {
    try {
      if (!enabled) {
        return;
      }
      chrome.runtime.sendMessage({ type: "getTabState" }, (response) => {
        if (
          response &&
          Number.isFinite(response.tabId) &&
          typeof document !== "undefined" &&
          document.documentElement
        ) {
          document.documentElement.dataset.ufDebugTabId = String(response.tabId);
        }
      });
    } catch {
      // Best-effort debug hook; never block normal extension operation.
    }
  }).catch(() => {});
}
