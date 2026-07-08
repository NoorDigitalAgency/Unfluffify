import { createRealmBus } from "../../messaging/realms";

const offscreenBus = createRealmBus({ realm: "offscreen" });
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
