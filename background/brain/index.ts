import { createBus } from "../../common/bus/bus.js";
import { DIAGNOSTIC_REQUEST_TYPES } from "../../common/bus/contracts/index.js";
import { POPUP_STATE_EVENT_TYPES, POPUP_STATE_REQUEST_TYPES } from "../../common/bus/contracts/popup-state.js";
import { SPINNER_EVENT_TYPES, type SpinnerSurface } from "../../common/bus/contracts/spinner.js";
import { REALMS } from "../../common/bus/realms.js";
import { createBackgroundTransport } from "../../common/bus/transport/background-transport.js";
import type { PopupLegacySpinnerEntry } from "../../common/bus/contracts/popup-state.js";
import type { PopupBrokerState } from "../popup-state-broker.js";
import { getPopupView, updatePopupViewFromBrokerState } from "./deciders/popup-state-decider.js";
import { updateSpinnerSelectionsFromLegacyQueue } from "./deciders/spinner-state-decider.js";
import { createStateStore, type TabLayerState } from "./state-store.js";
import { projectSpinners, type SpinnerState } from "./spinner-authority.js";
import { projectViews } from "./view-projector.js";

function publishSpinnerSurface(
  bus: ReturnType<typeof createBus>,
  tabId: number,
  surface: SpinnerSurface,
  state: SpinnerState | null,
): void {
  const eventType = state ? SPINNER_EVENT_TYPES.SET : SPINNER_EVENT_TYPES.CLEAR;
  const payload = state
    ? { surface, state }
    : { surface };
  const targets = surface === "popup"
    ? [REALMS.POPUP]
    : [REALMS.CONTENT, REALMS.POPUP];
  for (const target of targets) {
    void bus.publish(eventType, payload, { target, tab: tabId });
  }
}

function publishProjectedState(
  bus: ReturnType<typeof createBus>,
  tabId: number,
  state: TabLayerState,
): void {
  const { popupView, contentDirective } = projectViews(state);
  const spinners = projectSpinners(state);

  void bus.publish(POPUP_STATE_EVENT_TYPES.VIEW_UPDATED, popupView, { target: REALMS.POPUP, tab: tabId });
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
  bus.registerHandler(POPUP_STATE_REQUEST_TYPES.GET, (_payload: Record<never, never>, meta) => {
    if (!meta.tab) {
      throw new Error("popup.view.get requires a tab id");
    }
    return getPopupView(store, meta.tab);
  });

  return {
    bus,
    store,
    transport,
    mirrorPopupState(tabId: number, brokerState: PopupBrokerState, reason: string) {
      return updatePopupViewFromBrokerState(store, tabId, brokerState, reason);
    },
    mirrorLegacySpinnerQueue(tabId: number, queue: readonly PopupLegacySpinnerEntry[], reason: string) {
      return updateSpinnerSelectionsFromLegacyQueue(store, tabId, queue, reason);
    },
    registerPopupPort(tabId: number, port: chrome.runtime.Port): void {
      transport.registerPopupPort(tabId, port);
    },
  };
}
