import { defineContentScript } from "wxt/utils/define-content-script";
import { exposeDebugSpinnerQueueTabId, main } from "../content-main.js";

type ContentLoaderState = typeof globalThis & {
  __unfluffifyContentLoaderInitialized?: boolean;
  __unfluffifyContentMainLoaded?: boolean;
  __unfluffifyContentMainLoading?: Promise<void> | null;
};

const loaderState = globalThis as ContentLoaderState;

async function ensureContentMainLoaded() {
  if (loaderState.__unfluffifyContentMainLoaded) {
    return { ok: true, alreadyLoaded: true };
  }
  if (loaderState.__unfluffifyContentMainLoading) {
    await loaderState.__unfluffifyContentMainLoading;
    return { ok: true, alreadyLoaded: true };
  }

  const loadPromise = Promise.resolve().then(() => {
    main();
    loaderState.__unfluffifyContentMainLoaded = true;
  });
  loaderState.__unfluffifyContentMainLoading = loadPromise;

  try {
    await loadPromise;
  } finally {
    loaderState.__unfluffifyContentMainLoading = null;
  }

  return { ok: true };
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    if (loaderState.__unfluffifyContentLoaderInitialized) {
      return;
    }
    loaderState.__unfluffifyContentLoaderInitialized = true;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== "activateContentMain") {
        return;
      }
      ensureContentMainLoaded()
        .then((result) => sendResponse(result))
        .catch(() => sendResponse({ ok: false }));
      return true;
    });

    exposeDebugSpinnerQueueTabId();
  },
});
