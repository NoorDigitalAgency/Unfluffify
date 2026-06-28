import { createBus } from "../../common/bus/bus";
import type { Browser } from "../../common/browser";
import { DIAGNOSTIC_REQUEST_TYPES } from "../../common/bus/contracts/index";
import { POPUP_STATE_EVENT_TYPES, POPUP_STATE_REQUEST_TYPES } from "../../common/bus/contracts/popup-state";
import { SESSION_REPORT_TYPES, type SessionFactsReportedPayload } from "../../common/bus/contracts/session-state";
import { SPINNER_EVENT_TYPES, type SpinnerSurface } from "../../common/bus/contracts/spinner";
import { REALMS } from "../../common/bus/realms";
import { createBackgroundTransport } from "../../common/bus/transport/background-transport";
import type { PopupSpinnerEntry } from "../../common/bus/contracts/popup-state";
import type { PopupBrokerState } from "../popup-state-broker";
import {
  getActivationSnapshot as getActivationSnapshotValue,
  mirrorActivationLifecycle as mirrorActivationLifecycleState,
  updateActivationBootstrapState as updateActivationBootstrapStateValue,
} from "./deciders/activation-decider";
import { getPopupView, updatePopupViewFromBrokerState } from "./deciders/popup-state-decider";
import {
  getRenderModeSnapshot as getRenderModeSnapshotValue,
  recordInspectionResult as recordRenderModeInspectionValue,
  recordNoJsHoldState as recordRenderModeNoJsHoldValue,
} from "./deciders/render-mode-decider";
import { updateSpinnerSelectionsFromQueue } from "./deciders/spinner-state-decider";
import { applySessionFactsPatch } from "./deciders/session-phase-decider";
import { createStateStore, type TabLayerState } from "./state-store";
import { projectSpinners, type SpinnerState } from "./spinner-authority";
import { projectViews } from "./view-projector";

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
  bus.subscribe(SESSION_REPORT_TYPES.FACTS_REPORTED, (payload, meta) => {
    if (!meta.tab || !payload || typeof payload !== "object") {
      return;
    }
    const typedPayload = payload as SessionFactsReportedPayload;
    const source = typedPayload.source === "content" ? "content" : "popup";
    const facts = typedPayload.facts && typeof typedPayload.facts === "object"
      ? typedPayload.facts
      : {};
    store.mutate(meta.tab, `session-facts:${source}`, (draft) => {
      const next = applySessionFactsPatch(draft.sessionFacts, facts);
      draft.sessionFactsReported = true;
      draft.sessionFacts = next.facts;
      draft.sessionDictation = next.dictation;
    });
  });

  return {
    bus,
    store,
    transport,
    getPopupView(tabId: number) {
      return getPopupView(store, tabId);
    },
    mirrorPopupState(tabId: number, brokerState: PopupBrokerState, reason: string) {
      return updatePopupViewFromBrokerState(store, tabId, brokerState, reason);
    },
    mirrorActivationLifecycle(tabId: number, lifecycle: PopupBrokerState["lifecycle"], reason: string) {
      if (!lifecycle) {
        return null;
      }
      return mirrorActivationLifecycleState(store, tabId, lifecycle, reason);
    },
    updateActivationBootstrapState(
      tabId: number,
      patch: Parameters<typeof updateActivationBootstrapStateValue>[2],
      reason: string,
    ) {
      return updateActivationBootstrapStateValue(store, tabId, patch, reason);
    },
    getActivationSnapshot(tabId: number) {
      return getActivationSnapshotValue(store, tabId);
    },
    recordRenderModeInspection(
      tabId: number,
      patch: Parameters<typeof recordRenderModeInspectionValue>[2],
      reason: string,
    ) {
      return recordRenderModeInspectionValue(store, tabId, patch, reason);
    },
    recordRenderModeNoJsHold(
      tabId: number,
      patch: Parameters<typeof recordRenderModeNoJsHoldValue>[2],
      reason: string,
    ) {
      return recordRenderModeNoJsHoldValue(store, tabId, patch, reason);
    },
    getRenderModeSnapshot(tabId: number) {
      return getRenderModeSnapshotValue(store, tabId);
    },
    syncProjectedSpinnerQueue(tabId: number, queue: readonly PopupSpinnerEntry[], reason: string) {
      return updateSpinnerSelectionsFromQueue(store, tabId, queue, reason);
    },
    registerPopupPort(tabId: number, port: Browser.runtime.Port): void {
      transport.registerPopupPort(tabId, port);
    },
  };
}
