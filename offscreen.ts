import { refineXPathEntries } from "./common/xpath-utilities.js";
import { consumeTransferPayload } from "./background/transfer-payload-store.js";

const OFFSCREEN_MESSAGE_TARGET = "offscreen";
const OFFSCREEN_REFINE_XPATHS_TYPE = "offscreenRefineXPaths";

interface OffscreenRefineRequest {
  type?: unknown;
  target?: unknown;
  payloadKey?: unknown;
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

  const payloadKey = typeof message.payloadKey === "string" ? message.payloadKey : "";
  const items = Array.isArray(message.items) ? message.items : [];

  consumeTransferPayload(payloadKey, { expectedType: "object" }).then((loaded) => {
    const html = loaded.ok && loaded.payload && typeof loaded.payload === "object"
      ? (loaded.payload as { renderedHtml?: unknown; rawHtml?: unknown })
      : {};
    const renderedHtml = typeof html.renderedHtml === "string" ? html.renderedHtml : "";
    const rawHtml = typeof html.rawHtml === "string" ? html.rawHtml : "";
    try {
      const refined = refineXPathEntries(renderedHtml, rawHtml, items);
      sendResponse({ ok: true, items: refined });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }).catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return true;
});
