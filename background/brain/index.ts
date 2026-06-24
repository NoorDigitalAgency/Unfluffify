import { createBus } from "../../common/bus/bus.js";
import { DIAGNOSTIC_REQUEST_TYPES } from "../../common/bus/contracts/index.js";
import { REALMS } from "../../common/bus/realms.js";
import { createBackgroundTransport } from "../../common/bus/transport/background-transport.js";
import { createStateStore, type TabLayerState } from "./state-store.js";
import { projectSpinners, type SpinnerState } from "./spinner-authority.js";
import { projectViews } from "./view-projector.js";

function publishSpinnerSurface(
  bus: ReturnType<typeof createBus>,
  tabId: number,
  surface: "popup" | "pageCurtain" | "banner",
  state: SpinnerState | null,
): void {
  const target = surface === "popup" ? REALMS.POPUP : REALMS.CONTENT;
  const eventType = state ? "spinner.set" : "spinner.clear";
  const payload = state
    ? { surface, state }
    : { surface };
  void bus.publish(eventType, payload, { target, tab: tabId });
}

function publishProjectedState(
  bus: ReturnType<typeof createBus>,
  tabId: number,
  state: TabLayerState,
): void {
  const { popupView, contentDirective } = projectViews(state);
  const spinners = projectSpinners(state);

  void bus.publish("view.popup", popupView, { target: REALMS.POPUP, tab: tabId });
  void bus.publish("directive.content", contentDirective, { target: REALMS.CONTENT, tab: tabId });
  publishSpinnerSurface(bus, tabId, "popup", spinners.popup);
  publishSpinnerSurface(bus, tabId, "pageCurtain", spinners.pageCurtain);
  publishSpinnerSurface(bus, tabId, "banner", spinners.banner);
}

export function createBrain(options: { logger?: Pick<Console, "error"> } = {}) {
  const transport = createBackgroundTransport();
  const bus = createBus({
    realm: REALMS.BACKGROUND,
    transport,
    logger: options.logger || console,
  });
  const store = createStateStore();

  transport.start();
  store.onProjection((tabId, state) => {
    publishProjectedState(bus, tabId, state);
  });

  bus.registerHandler(DIAGNOSTIC_REQUEST_TYPES.PING, (payload: { nonce: string }) => ({
    nonce: payload.nonce,
    realm: REALMS.BACKGROUND,
  }));

  return {
    bus,
    store,
    transport,
    registerPopupPort(tabId: number, port: chrome.runtime.Port): void {
      transport.registerPopupPort(tabId, port);
    },
  };
}
