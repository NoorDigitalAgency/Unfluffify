import { createBus, type Bus } from "../../common/bus/bus.js";
import { DIAGNOSTIC_REQUEST_TYPES } from "../../common/bus/contracts/index.js";
import { REALMS } from "../../common/bus/realms.js";
import { createPopupTransport } from "../../common/bus/transport/popup-transport.js";
import { startPopupLayerHost } from "./layer-host.js";

let popupBus: Bus | null = null;
let popupTransport: ReturnType<typeof createPopupTransport> | null = null;
let popupLayerHostStop: (() => void) | null = null;
let popupBusTabId: number | null = null;

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
