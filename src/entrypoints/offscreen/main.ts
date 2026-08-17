import { createRealmBus } from "../../messaging/realms";
import { createRuntimeTransport } from "../../messaging/transports/runtime";
import { browser, getInstalledBrowserApi } from "../../common/browser";
import { refineXPathEntries } from "../../offscreen/xpath-refinement";

const runtimeBrowser = getInstalledBrowserApi() ?? browser;
const offscreenBus = createRealmBus({
  realm: "offscreen",
  transport: createRuntimeTransport(runtimeBrowser.runtime),
});
offscreenBus.onCommand("offscreen.refineXpaths", (request) => ({
  rows: [...refineXPathEntries(
    request.renderedHtml,
    request.rawHtml ?? request.renderedHtml,
    request.rows,
  )],
}));
