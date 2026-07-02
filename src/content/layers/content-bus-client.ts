import { createBus, type Bus } from "../../common/bus/bus";
import { DIAGNOSTIC_REQUEST_TYPES } from "../../common/bus/contracts/index";
import {
  SESSION_REPORT_TYPES,
  SESSION_REQUEST_TYPES,
  type SessionFactsPatch,
  type SessionFactsReportedPayload,
  type SessionStateReply,
} from "../../common/bus/contracts/session-state";
import type {
  RenderModeContentBeginReply,
  RenderModeContentCaptureHtmlReply,
  RenderModeContentEndReply,
  RenderModeContentHideConsentReply,
} from "../../common/bus/contracts/render-mode";
import { isBusEnvelope, type BusEnvelope } from "../../common/bus/envelope";
import { REALMS } from "../../common/bus/realms";
import { createContentTransport } from "../../common/bus/transport/content-transport";
import type { Browser } from "../../common/browser";
import { startContentLayerHost } from "./layer-host";
import { setPageCurtainRenderer } from "./spinner-layer";
import { setPageInspectionUiActive, setPopupBusyOnPage } from "../core";
import { registerRenderModeInspectionExecutor } from "./modes/render-mode-inspection-executor";

let contentBus: Bus | null = null;
let contentTransport: ReturnType<typeof createContentTransport> | null = null;
let contentLayerHostStop: (() => void) | null = null;
let lastContentSessionFacts: SessionFactsPatch = {};

export type ContentBusClientOptions = {
  renderModeHandlers?: {
    beginInspection: (payload?: Record<string, unknown>) => RenderModeContentBeginReply;
    hideConsent: () => RenderModeContentHideConsentReply;
    captureHtml: (payload?: Record<string, unknown>) => Promise<RenderModeContentCaptureHtmlReply>;
    endInspection: (payload?: Record<string, unknown>) => RenderModeContentEndReply;
  };
};

export function startContentBusClient(options: ContentBusClientOptions = {}): Bus {
  if (contentBus && contentTransport) {
    return contentBus;
  }

  contentTransport = createContentTransport();
  contentTransport.start();
  contentBus = createBus({
    realm: REALMS.CONTENT,
    transport: contentTransport,
    logger: console,
  });
  contentBus.registerHandler(DIAGNOSTIC_REQUEST_TYPES.PING, (payload: { nonce: string }) => ({
    nonce: payload.nonce,
    realm: REALMS.CONTENT,
  }));
  contentBus.registerHandler(SESSION_REQUEST_TYPES.STATE_GET, (): SessionStateReply => ({
    source: "content",
    facts: lastContentSessionFacts,
  }));
  if (options.renderModeHandlers) {
    registerRenderModeInspectionExecutor(contentBus, {
      handlers: options.renderModeHandlers,
    });
  }
  // The page-world inspection curtain renders from the brain pageCurtain
  // broadcast: brain hide -> both popup and page clear together. Curtains that
  // declare page-blocking in their spinner contract (blockSurfaces.page — AI
  // run, save, reveal/freeze) must also raise the REAL page input block, not
  // just the inspection tint, so the user cannot interact with the page while
  // the data-affecting operation runs. The brain re-broadcasts the active
  // curtain roughly every heartbeat second (content deliveries are NOT deduped),
  // which re-arms the block's fail-open watchdog; if the brain goes silent the
  // block releases on its own.
  setPageCurtainRenderer((visible, state) => {
    setPageInspectionUiActive(visible);
    const blockSurfaces = state && typeof state === "object"
      ? (state.blockSurfaces as { page?: unknown } | null | undefined)
      : null;
    const pageBlocking = Boolean(visible && blockSurfaces && blockSurfaces.page === true);
    if (pageBlocking) {
      const operationId = typeof state?.operationId === "string" ? state.operationId : "";
      const rawDeadline = state?.deadlineAt;
      const releaseBy = typeof rawDeadline === "number" && Number.isFinite(rawDeadline)
        ? rawDeadline
        : undefined;
      const message = typeof state?.message === "string" ? state.message : "";
      setPopupBusyOnPage(true, message, { operationId, releaseBy });
    } else {
      setPopupBusyOnPage(false);
    }
  });
  contentLayerHostStop = startContentLayerHost(contentBus);
  return contentBus;
}

export async function handleContentBusMessage(
  message: unknown,
  sender?: Browser.runtime.MessageSender,
): Promise<BusEnvelope | void> {
  if (!contentTransport || !isBusEnvelope(message)) {
    return;
  }
  return await contentTransport.inbound(message, sender);
}

export function stopContentBusClient(): void {
  contentLayerHostStop?.();
  contentLayerHostStop = null;
  setPageCurtainRenderer(null);
  contentTransport?.stop();
  contentTransport = null;
  contentBus = null;
}

export function publishContentSessionFacts(facts: SessionFactsPatch): Promise<void> {
  if (!contentBus) {
    return Promise.resolve();
  }
  const payload: SessionFactsReportedPayload = {
    source: "content",
    facts,
  };
  lastContentSessionFacts = { ...lastContentSessionFacts, ...facts };
  return contentBus.publish(SESSION_REPORT_TYPES.FACTS_REPORTED, payload, {
    target: REALMS.BACKGROUND,
  });
}
