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
import {
  SIGNAL_EVENT_TYPES,
  SIGNAL_NAMES,
  SIGNAL_REQUEST_TYPES,
  type SignalEmitPayload,
  type SignalEmitReply,
  type SignalFrame,
} from "../../common/bus/contracts/signals";
import {
  SPINNER_REQUEST_TYPES,
  type SpinnerRemoveRequestPayload,
  type SpinnerSetRequestPayload,
} from "../../common/bus/contracts/spinner";
import { isBusEnvelope, type BusEnvelope } from "../../common/bus/envelope";
import { REALMS } from "../../common/bus/realms";
import { createContentTransport } from "../../common/bus/transport/content-transport";
import type { Browser } from "../../common/browser";
import { startContentLayerHost } from "./layer-host";
import { setPageCurtainRenderer } from "./spinner-layer";
import { getSpinnerPhaseDefinition } from "../../common/spinner-contract";
import {
  resolveActiveContentOverlayMemory,
  setPageInspectionUiActive,
  setPopupBusyOnPage,
  setUserMarkingEditSignalReporter,
} from "../core";
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
  // REFLEX-ARC Phase 1: pushed signal frames (consumer plumbing only in P1;
  // the content machines consume in Phase 3).
  onSignal?: (frame: SignalFrame) => void;
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
  if (options.onSignal) {
    const onSignal = options.onSignal;
    contentBus.subscribe(SIGNAL_EVENT_TYPES.EMITTED, (payload) => {
      if (payload && typeof payload === "object") {
        onSignal(payload as SignalFrame);
      }
    });
  }
  // REFLEX-ARC Phase 3: content-born 'markings.changed' with provenance. The
  // reporter fires only from core's sole user marking-edit commit path, so
  // internal draft reshapes can never manufacture the signal.
  setUserMarkingEditSignalReporter((pageUrl) => {
    void emitContentSignal({
      name: SIGNAL_NAMES.MARKINGS_CHANGED,
      source: "content",
      cause: "user-marking-edit",
      payload: { pageUrl },
    });
  });
  // The page-world inspection curtain renders from the brain pageCurtain
  // broadcast: brain hide -> both popup and page clear together. The broadcast
  // is engagement vocabulary only ({kind, phase} + timing — P4 step 4.2); the
  // CONTENT resolves presentation locally: the marking machine's overlay
  // memory first (its visible-curtain states own message and input-block
  // policy), the shared phase-definition table second. Curtains that resolve
  // page-blocking must raise the REAL page input block, not just the
  // inspection tint, so the user cannot interact with the page while the
  // data-affecting operation runs. The brain re-broadcasts the active curtain
  // roughly every heartbeat second (content deliveries are NOT deduped),
  // which re-arms the block's fail-open watchdog; if the brain goes silent
  // the block releases on its own.
  setPageCurtainRenderer((visible, state) => {
    setPageInspectionUiActive(visible);
    const memoryCurtain = resolveActiveContentOverlayMemory().pageCurtain;
    const definition = state && typeof state === "object"
      ? getSpinnerPhaseDefinition(state.kind, state.phase)
      : null;
    const message = memoryCurtain.visible
      ? memoryCurtain.message
      : definition
        ? definition.title
        : "";
    const pageBlocking = Boolean(
      visible &&
        (memoryCurtain.visible
          ? memoryCurtain.blocksPageInput
          : definition?.blockSurfaces.page === true)
    );
    if (pageBlocking) {
      const operationId = typeof state?.operationId === "string" ? state.operationId : "";
      const rawDeadline = state?.deadlineAt;
      const releaseBy = typeof rawDeadline === "number" && Number.isFinite(rawDeadline)
        ? rawDeadline
        : undefined;
      setPopupBusyOnPage(true, message, { operationId, releaseBy });
    } else {
      setPopupBusyOnPage(false);
    }
  });
  contentLayerHostStop = startContentLayerHost(contentBus);
  return contentBus;
}

// Content-held spinner leases (calculation narration): same broker as the
// popup leases — the brain resolves the phase definition from the reason
// alias, projects the engagement, and both layers render the presentation
// from the shared table. The background stamps the tab id from the sender.
export async function requestContentSpinnerSet(
  payload: SpinnerSetRequestPayload,
): Promise<void> {
  if (!contentBus) {
    return;
  }
  try {
    await contentBus.request(SPINNER_REQUEST_TYPES.SET, payload, {
      target: REALMS.BACKGROUND,
      timeoutMs: 3000,
    });
  } catch {
    // Best-effort narration: a lost lease only costs feedback, never behavior.
  }
}

export async function requestContentSpinnerRemove(
  payload: SpinnerRemoveRequestPayload,
): Promise<void> {
  if (!contentBus) {
    return;
  }
  try {
    await contentBus.request(SPINNER_REQUEST_TYPES.REMOVE, payload, {
      target: REALMS.BACKGROUND,
      timeoutMs: 3000,
    });
  } catch {
    // Best-effort narration: the contract deadline reaps a lost REMOVE.
  }
}

export async function emitContentSignal(
  emit: SignalEmitPayload,
): Promise<SignalEmitReply | null> {
  if (!contentBus) {
    return null;
  }
  try {
    // The background stamps the tab id from the sender; content need not know it.
    return await contentBus.request<SignalEmitPayload, SignalEmitReply>(
      SIGNAL_REQUEST_TYPES.EMIT,
      emit,
      { target: REALMS.BACKGROUND, timeoutMs: 3000 },
    );
  } catch {
    return null;
  }
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
