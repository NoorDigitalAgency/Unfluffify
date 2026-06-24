import { createBus, type Bus } from "../../common/bus/bus.js";
import {
  DIAGNOSTIC_REQUEST_TYPES,
  type DiagnosticPingPayload,
  type DiagnosticPingReply,
} from "../../common/bus/contracts/index.js";
import { REALMS } from "../../common/bus/realms.js";
import { createPopupTransport } from "../../common/bus/transport/popup-transport.js";
import { startPopupLayerHost } from "./layer-host.js";

let popupBus: Bus | null = null;
let popupTransport: ReturnType<typeof createPopupTransport> | null = null;
let popupLayerHostStop: (() => void) | null = null;
let popupBusTabId: number | null = null;

export type PopupBusSelfTestLogger = (eventName: string, details?: Record<string, unknown>) => void;

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

export function startPopupBusClient(tabId: number): Bus {
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
  popupLayerHostStop = startPopupLayerHost(popupBus);
  popupBusTabId = tabId;
  return popupBus;
}
