import { refineXPathEntries } from "./common/xpath-utilities.js";

const OFFSCREEN_MESSAGE_TARGET = "offscreen";
const OFFSCREEN_REFINE_XPATHS_TYPE = "offscreenRefineXPaths";

interface OffscreenRefineRequest {
  type?: unknown;
  target?: unknown;
  renderedHtml?: unknown;
  rawHtml?: unknown;
  items?: unknown;
}

function isOffscreenRefineRequest(message: unknown): message is OffscreenRefineRequest {
  return Boolean(message) &&
    typeof message === "object" &&
    (message as OffscreenRefineRequest).type === OFFSCREEN_REFINE_XPATHS_TYPE &&
    (message as OffscreenRefineRequest).target === OFFSCREEN_MESSAGE_TARGET;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isOffscreenRefineRequest(message)) {
    return undefined;
  }

  const renderedHtml = typeof message.renderedHtml === "string" ? message.renderedHtml : "";
  const rawHtml = typeof message.rawHtml === "string" ? message.rawHtml : "";
  const items = Array.isArray(message.items) ? message.items : [];

  try {
    const refined = refineXPathEntries(renderedHtml, rawHtml, items);
    sendResponse({ ok: true, items: refined });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return undefined;
});
