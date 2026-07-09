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
  rows: [...refineXPathEntries(request.html, request.rows)],
}));
void offscreenBus.emit("signal.emitted", {
  kind: "uf-signal/1",
  tabId: 0,
  seq: 1,
  name: "inspection.ended",
  source: "popup",
  cause: "offscreen-ready",
  at: 0,
  payload: {},
}, { target: "offscreen" });
