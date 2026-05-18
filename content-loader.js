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

// Avoid re-declaring globals if content-loader is injected multiple times.
if (!globalThis.__unfluffifyContentLoaderInitialized) {
  globalThis.__unfluffifyContentLoaderInitialized = true;

  const CONTENT_MAIN_FLAG = "__unfluffifyContentMainLoaded";
  const CONTENT_MAIN_LOADING = "__unfluffifyContentMainLoading";

  /**
   * Ensures the content main script is loaded and initialized.
   * Uses flags to prevent duplicate loading and handle concurrent requests.
   * @async
   * @returns {Promise<{ok: boolean, alreadyLoaded?: boolean}>}
   */
  async function ensureContentMainLoaded() {
    if (globalThis[CONTENT_MAIN_FLAG]) {
      console.log("Content main already loaded, skipping initialization");
      return { ok: true, alreadyLoaded: true };
    }
    if (globalThis[CONTENT_MAIN_LOADING]) {
      console.log("Content main loading in progress, waiting for completion");
      await globalThis[CONTENT_MAIN_LOADING];
      return { ok: true, alreadyLoaded: true };
    }
    const loadPromise = (async () => {
      const src = chrome.runtime.getURL("content-main.js");
      const contentMain = await import(src);
      if (contentMain && typeof contentMain.main === "function") {
        console.log("Initializing content main");
        contentMain.main();
      } else {
        console.error("Failed to load content main: missing or invalid main function");
      }
      globalThis[CONTENT_MAIN_FLAG] = true;
    })();
    globalThis[CONTENT_MAIN_LOADING] = loadPromise;
    try {
      await loadPromise;
    } finally {
      globalThis[CONTENT_MAIN_LOADING] = null;
    }
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.info("Content loader received message:", message);
    if (!message || message.type !== "activateContentMain") {
      return;
    }
    ensureContentMainLoaded()
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }));
    return true;
  });
}
