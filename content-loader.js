const CONTENT_MAIN_FLAG = "__unfluffifyContentMainLoaded";
const CONTENT_MAIN_LOADING = "__unfluffifyContentMainLoading";

async function ensureContentMainLoaded() {
  if (globalThis[CONTENT_MAIN_FLAG]) {
    return { ok: true, alreadyLoaded: true };
  }
  if (globalThis[CONTENT_MAIN_LOADING]) {
    await globalThis[CONTENT_MAIN_LOADING];
    return { ok: true, alreadyLoaded: true };
  }
  const loadPromise = (async () => {
    const src = chrome.runtime.getURL("content-main.js");
    const contentMain = await import(src);
    if (contentMain && typeof contentMain.main === "function") {
      contentMain.main();
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
  if (!message || message.type !== "activateContentMain") {
    return;
  }
  ensureContentMainLoaded()
    .then((result) => sendResponse(result))
    .catch(() => sendResponse({ ok: false }));
  return true;
});
