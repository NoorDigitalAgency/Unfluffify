import { createBus, type Bus } from "../../common/bus/bus";
import {
  DIAGNOSTIC_REQUEST_TYPES,
  type DiagnosticPingPayload,
  type DiagnosticPingReply,
  RENDER_MODE_REQUEST_TYPES,
} from "../../common/bus/contracts/index";
import {
  SESSION_REPORT_TYPES,
  type SessionFactsPatch,
  type SessionFactsReportedPayload,
} from "../../common/bus/contracts/session-state";
import {
  POPUP_STATE_REQUEST_TYPES,
  type PopupStateGetPayload,
  type PopupStateGetReply,
} from "../../common/bus/contracts/popup-state";
import type {
  RenderModeContentCaptureHtmlPayload,
  RenderModeContentCaptureHtmlReply,
  RenderModeContentHideConsentPayload,
  RenderModeContentHideConsentReply,
  RenderModeEndInspectionPayload,
  RenderModeEndInspectionReply,
  RenderModeRunInspectionPayload,
  RenderModeRunInspectionReply,
} from "../../common/bus/contracts/render-mode";
import {
  SPINNER_REQUEST_TYPES,
  type SpinnerClearRequestPayload,
  type SpinnerMutationReply,
  type SpinnerRemoveRequestPayload,
  type SpinnerSetRequestPayload,
} from "../../common/bus/contracts/spinner";
import { REALMS, type BusTarget } from "../../common/bus/realms";
import { createPopupTransport } from "../../common/bus/transport/popup-transport";
import { startPopupLayerHostWithOptions } from "./layer-host";

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

export function publishPopupSessionFacts(
  tabId: number,
  facts: SessionFactsPatch,
): Promise<void> {
  if (!tabId || !popupBus) {
    return Promise.resolve();
  }
  const payload: SessionFactsReportedPayload = {
    source: "popup",
    facts,
  };
  return popupBus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, payload, {
    target: REALMS.BACKGROUND,
    tab: tabId,
  });
}

async function requestPopupRenderMode<Payload, Reply>(
  type: string,
  tabId: number,
  payload: Payload,
  timeoutMs: number,
  target: BusTarget = REALMS.BACKGROUND,
): Promise<Reply> {
  if (!tabId || !popupBus) {
    throw new Error("Popup bus unavailable");
  }
  return await popupBus.request<Payload, Reply>(
    type,
    payload,
    { target, tab: tabId, timeoutMs },
  );
}

export function requestPopupRenderModeRun(
  tabId: number,
  payload: RenderModeRunInspectionPayload,
): Promise<RenderModeRunInspectionReply> {
  return requestPopupRenderMode(
    RENDER_MODE_REQUEST_TYPES.RUN_INSPECTION,
    tabId,
    payload,
    120000,
  );
}

export function requestPopupRenderModeEnd(
  tabId: number,
  payload: RenderModeEndInspectionPayload,
  timeoutMs = 15000,
): Promise<RenderModeEndInspectionReply> {
  return requestPopupRenderMode(
    RENDER_MODE_REQUEST_TYPES.END_INSPECTION,
    tabId,
    payload,
    timeoutMs,
  );
}

export function requestPopupRenderModeHideConsent(
  tabId: number,
  payload: RenderModeContentHideConsentPayload = {},
): Promise<RenderModeContentHideConsentReply> {
  return requestPopupRenderMode(
    RENDER_MODE_REQUEST_TYPES.CONTENT_HIDE_CONSENT,
    tabId,
    payload,
    3000,
    REALMS.CONTENT,
  );
}

export function requestPopupRenderModeCaptureHtml(
  tabId: number,
  payload: RenderModeContentCaptureHtmlPayload,
): Promise<RenderModeContentCaptureHtmlReply> {
  return requestPopupRenderMode(
    RENDER_MODE_REQUEST_TYPES.CONTENT_CAPTURE_HTML,
    tabId,
    payload,
    15000,
    REALMS.CONTENT,
  );
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
