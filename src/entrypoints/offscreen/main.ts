import { createRealmBus } from "../../messaging/realms";
import { createRuntimeTransport } from "../../messaging/transports/runtime";
import { browser, getInstalledBrowserApi } from "../../common/browser";
import { refineXPathEntries } from "../../offscreen/xpath-refinement";

const runtimeBrowser = getInstalledBrowserApi() ?? browser;
const offscreenBus = createRealmBus({
  realm: "offscreen",
  transport: createRuntimeTransport(runtimeBrowser.runtime),
});
offscreenBus.onCommand("offscreen.refineXpaths", async (request) => {
  if (request.rawHtmlRef && request.rawHtmlRef.scope !== request.renderedHtmlRef.scope) {
    throw new Error("XPath refinement payload scopes do not match");
  }
  const rendered = await offscreenBus.request("transferPayload.get", {
    handle: request.renderedHtmlRef,
  }, { target: "background" });
  if (!rendered.ok || rendered.data.status !== "ok") {
    throw new Error("Rendered XPath refinement payload is unavailable");
  }
  let rawHtml = rendered.data.value;
  if (request.rawHtmlRef) {
    const raw = await offscreenBus.request("transferPayload.get", {
      handle: request.rawHtmlRef,
    }, { target: "background" });
    if (!raw.ok || raw.data.status !== "ok") {
      throw new Error("Raw XPath refinement payload is unavailable");
    }
    rawHtml = raw.data.value;
  }
  return {
    rows: [...refineXPathEntries(rendered.data.value, rawHtml, request.rows)],
  };
});
