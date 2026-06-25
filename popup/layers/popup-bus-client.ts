import { createBus, type Bus } from "../../common/bus/bus.js";
import {
  DIAGNOSTIC_REQUEST_TYPES,
  type DiagnosticPingPayload,
  type DiagnosticPingReply,
} from "../../common/bus/contracts/index.js";
import {
  POPUP_STATE_REQUEST_TYPES,
  type PopupStateGetPayload,
  type PopupStateGetReply,
} from "../../common/bus/contracts/popup-state.js";
import {
  SPINNER_REQUEST_TYPES,
  type SpinnerClearRequestPayload,
  type SpinnerMutationReply,
  type SpinnerRemoveRequestPayload,
  type SpinnerSetRequestPayload,
} from "../../common/bus/contracts/spinner.js";
import { REALMS } from "../../common/bus/realms.js";
import { createPopupTransport } from "../../common/bus/transport/popup-transport.js";
import { startPopupLayerHostWithOptions } from "./layer-host.js";

let popupBus: Bus | null = null;
let popupTransport: ReturnType<typeof createPopupTransport> | null = null;
let popupLayerHostStop: (() => void) | null = null;
let popupBusTabId: number | null = null;

export type PopupBusSelfTestLogger = (eventName: string, details?: Record<string, unknown>) => void;
export type PopupBusClientOptions = {
  applyPopupView?: (view: PopupStateGetReply) => void;
};

function buildDiagnosticNonce(tabId: number, target: string): string {
  return `popup:${tabId}:${target}:${Date.now()}`;
}

function assertDiagnosticReply(
  target: "background" | "content",
  nonce: string,
  reply: DiagnosticPingReply,
): void {
  if (reply.nonce !== nonce || reply.realm !== target) {
    throw new Error(`Unexpected diag.ping reply from ${target}`);
  }
}

export async function runPopupBusSelfTest(
  bus: Bus,
  tabId: number,
  log: PopupBusSelfTestLogger,
): Promise<void> {
  const targets = [REALMS.BACKGROUND, REALMS.CONTENT] as const;
  log("bus-self-test:start", { tabId });

  for (const target of targets) {
    const nonce = buildDiagnosticNonce(tabId, target);
    try {
      const reply = await bus.request<DiagnosticPingPayload, DiagnosticPingReply>(
        DIAGNOSTIC_REQUEST_TYPES.PING,
        { nonce },
        { target, tab: tabId, timeoutMs: 2000 },
      );
      assertDiagnosticReply(target, nonce, reply);
      log("bus-self-test:pass", { tabId, target, realm: reply.realm, nonce });
    } catch (error) {
      log("bus-self-test:fail", {
        tabId,
        target,
        nonce,
        error: error instanceof Error && error.message ? error.message : `diag.ping failed for ${target}`,
      });
      return;
    }
  }
}

export async function requestPopupView(bus: Bus, tabId: number): Promise<PopupStateGetReply | null> {
  if (!tabId) {
    return null;
  }
  try {
    return await bus.request<PopupStateGetPayload, PopupStateGetReply>(
      POPUP_STATE_REQUEST_TYPES.GET,
      {},
      { target: REALMS.BACKGROUND, tab: tabId, timeoutMs: 3000 },
    );
  } catch {
    return null;
  }
}

async function requestPopupSpinnerMutation<Payload>(
  type: string,
  tabId: number,
  payload: Payload,
): Promise<SpinnerMutationReply | null> {
  if (!tabId || !popupBus) {
    return null;
  }
  try {
    return await popupBus.request<Payload, SpinnerMutationReply>(
      type,
      payload,
      { target: REALMS.BACKGROUND, tab: tabId, timeoutMs: 3000 },
    );
  } catch {
    return null;
  }
}

export function requestPopupSpinnerSet(
  tabId: number,
  payload: SpinnerSetRequestPayload,
): Promise<SpinnerMutationReply | null> {
  return requestPopupSpinnerMutation(SPINNER_REQUEST_TYPES.SET, tabId, payload);
}

export function requestPopupSpinnerRemove(
  tabId: number,
  payload: SpinnerRemoveRequestPayload,
): Promise<SpinnerMutationReply | null> {
  return requestPopupSpinnerMutation(SPINNER_REQUEST_TYPES.REMOVE, tabId, payload);
}

export function requestPopupSpinnerClear(
  tabId: number,
  payload: SpinnerClearRequestPayload,
): Promise<SpinnerMutationReply | null> {
  return requestPopupSpinnerMutation(SPINNER_REQUEST_TYPES.CLEAR, tabId, payload);
}

export function startPopupBusClient(tabId: number, options: PopupBusClientOptions = {}): Bus {
  if (popupBus && popupTransport && popupBusTabId === tabId) {
    return popupBus;
  }

  popupLayerHostStop?.();
  popupTransport?.stop();

  popupTransport = createPopupTransport(tabId);
  popupTransport.start();
  popupBus = createBus({
    realm: REALMS.POPUP,
    transport: popupTransport,
    logger: console,
  });
  popupBus.registerHandler(DIAGNOSTIC_REQUEST_TYPES.PING, (payload: { nonce: string }) => ({
    nonce: payload.nonce,
    realm: REALMS.POPUP,
  }));
  popupLayerHostStop = startPopupLayerHostWithOptions(popupBus, options);
  popupBusTabId = tabId;
  return popupBus;
}
