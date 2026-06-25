import { BUS_ERROR_CODES, BusError } from "../bus-errors.js";
import { BUS_KINDS, isBusEnvelope, makeReplyEnvelope, type BusEnvelope, type BusRequestEnvelope } from "../envelope.js";
import { REALMS } from "../realms.js";
import { browser, type Browser } from "../../browser.js";
import { BUS_PORT_PREFIX, type InboundTransportHandler, type Transport } from "./transport-types.js";

function normalizeTabId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function normalizeFrameId(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : undefined;
}

function toBusError(error: unknown, fallbackCode: string, fallbackMessage: string): BusError {
  if (error instanceof BusError) {
    return error;
  }
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
    if (typeof candidate.code === "string" && candidate.code) {
      return new BusError(
        candidate.code,
        typeof candidate.message === "string" && candidate.message ? candidate.message : fallbackMessage,
        candidate.details && typeof candidate.details === "object" && !Array.isArray(candidate.details)
          ? candidate.details as Record<string, unknown>
          : {},
      );
    }
  }
  return new BusError(
    fallbackCode,
    error instanceof Error && error.message ? error.message : fallbackMessage,
  );
}

export type BackgroundTransport = Transport & {
  inbound(env: BusEnvelope, sender?: Browser.runtime.MessageSender): Promise<BusEnvelope | void>;
  registerPopupPort(tabId: number, port: Browser.runtime.Port): void;
};

export function createBackgroundTransport(): BackgroundTransport {
  let inboundHandler: InboundTransportHandler | null = null;
  const popupPortsByTabId = new Map<number, Set<Browser.runtime.Port>>();
  const pendingPopupReplies = new Map<string, {
    port: Browser.runtime.Port;
    resolve: (value: BusEnvelope | void) => void;
    reject: (reason: unknown) => void;
  }>();

  function applySenderContext(env: BusEnvelope, sender?: Browser.runtime.MessageSender): BusEnvelope {
    const senderTabId = normalizeTabId(sender?.tab?.id);
    const senderFrameId = normalizeFrameId(sender?.frameId);
    const shouldPatchTab = env.tab == null && senderTabId != null;
    const shouldPatchFrame = senderFrameId !== undefined && (env.frame == null || (env.frame === 0 && senderFrameId > 0));
    if (!shouldPatchTab && !shouldPatchFrame) {
      return env;
    }
    return {
      ...env,
      tab: shouldPatchTab ? senderTabId : env.tab,
      frame: shouldPatchFrame ? senderFrameId : env.frame,
    };
  }

  function handlePopupMessage(port: Browser.runtime.Port, message: unknown): void {
    if (!isBusEnvelope(message)) {
      return;
    }
    if (message.k === BUS_KINDS.REPLY) {
      const pending = pendingPopupReplies.get(message.id);
      if (!pending) {
        return;
      }
      pendingPopupReplies.delete(message.id);
      pending.resolve(message);
      return;
    }
    if (!inboundHandler) {
      return;
    }
    inboundHandler(message)
      .then((reply) => {
        if (message.k === BUS_KINDS.REQUEST && reply) {
          port.postMessage(reply);
        }
      })
      .catch((error: unknown) => {
        if (message.k !== BUS_KINDS.REQUEST) {
          return;
        }
        const busError = toBusError(error, BUS_ERROR_CODES.HANDLER_FAILED, `Bus handler failed for ${message.t}`);
        port.postMessage(makeReplyEnvelope(message as BusRequestEnvelope, false, {
          code: BUS_ERROR_CODES.HANDLER_FAILED,
          error: busError.message,
          details: busError.details,
        }));
      });
  }

  function postToPopupPorts(tabId: number, env: BusEnvelope): Promise<BusEnvelope | void> {
    const ports = popupPortsByTabId.get(tabId);
    const activePorts = ports ? Array.from(ports) : [];
    if (activePorts.length === 0) {
      if (env.k === BUS_KINDS.EVENT) {
        return Promise.resolve();
      }
      return Promise.reject(new BusError(
        BUS_ERROR_CODES.UNREACHABLE_REALM,
        `No popup bus port is connected for tab ${tabId}`,
        { tabId, type: env.t },
      ));
    }

    if (env.k === BUS_KINDS.EVENT) {
      for (const port of activePorts) {
        port.postMessage(env);
      }
      return Promise.resolve();
    }

    const targetPort = activePorts[0];
    return new Promise<BusEnvelope | void>((resolve, reject) => {
      pendingPopupReplies.set(env.id, { port: targetPort, resolve, reject });
      targetPort.postMessage(env);
    });
  }

  async function sendToContent(env: BusEnvelope): Promise<BusEnvelope | void> {
    const tabId = normalizeTabId(env.tab);
    if (!tabId) {
      return Promise.reject(new BusError(
        BUS_ERROR_CODES.UNREACHABLE_REALM,
        `Content delivery requires a tab for ${env.t}`,
        { type: env.t },
      ));
    }
    try {
      return await browser.tabs.sendMessage(
        tabId,
        env,
        normalizeFrameId(env.frame) !== undefined ? { frameId: normalizeFrameId(env.frame) } : undefined,
      ) as BusEnvelope | void;
    } catch (error) {
      throw new BusError(
        BUS_ERROR_CODES.TRANSPORT_FAILED,
        error instanceof Error && error.message ? error.message : `Content delivery failed for ${env.t}`,
        { type: env.t, tabId },
      );
    }
  }

  async function send(env: BusEnvelope): Promise<BusEnvelope | void> {
    if (env.dst === REALMS.CONTENT) {
      return await sendToContent(env);
    }
    if (env.dst === REALMS.POPUP) {
      const tabId = normalizeTabId(env.tab);
      if (!tabId) {
        throw new BusError(BUS_ERROR_CODES.UNREACHABLE_REALM, `Popup delivery requires a tab for ${env.t}`, {
          type: env.t,
        });
      }
      return await postToPopupPorts(tabId, env);
    }
    if (env.dst === "broadcast") {
      if (env.k === BUS_KINDS.REQUEST) {
        throw new BusError(BUS_ERROR_CODES.UNREACHABLE_REALM, `Broadcast requests are unsupported for ${env.t}`, {
          type: env.t,
        });
      }
      const deliveries: Array<Promise<BusEnvelope | void>> = [];
      if (env.src !== REALMS.CONTENT) {
        deliveries.push(sendToContent({ ...env, dst: REALMS.CONTENT }));
      }
      const popupTabId = normalizeTabId(env.tab);
      if (env.src !== REALMS.POPUP && popupTabId) {
        deliveries.push(postToPopupPorts(popupTabId, { ...env, dst: REALMS.POPUP }));
      }
      await Promise.allSettled(deliveries);
      return;
    }
    throw new BusError(BUS_ERROR_CODES.UNREACHABLE_REALM, `Background transport cannot reach ${env.dst}`, {
      dst: env.dst,
      type: env.t,
    });
  }

  return {
    async send(env: BusEnvelope): Promise<BusEnvelope | void> {
      return await send(env);
    },
    onInbound(handler: InboundTransportHandler): void {
      inboundHandler = handler;
    },
    start(): void {},
    stop(): void {
      pendingPopupReplies.clear();
      popupPortsByTabId.clear();
    },
    async inbound(env: BusEnvelope, sender?: Browser.runtime.MessageSender): Promise<BusEnvelope | void> {
      const routedEnv = applySenderContext(env, sender);
      if (routedEnv.dst === REALMS.BACKGROUND) {
        if (!inboundHandler) {
          throw new BusError(BUS_ERROR_CODES.NO_HANDLER, `Background inbound handler is not installed for ${routedEnv.t}`);
        }
        return await inboundHandler(routedEnv);
      }
      if (routedEnv.dst === "broadcast") {
        if (routedEnv.k === BUS_KINDS.REQUEST) {
          throw new BusError(BUS_ERROR_CODES.UNREACHABLE_REALM, `Broadcast requests are unsupported for ${routedEnv.t}`, {
            type: routedEnv.t,
          });
        }
        if (inboundHandler) {
          await inboundHandler(routedEnv);
        }
        return await send(routedEnv);
      }
      return await send(routedEnv);
    },
    registerPopupPort(tabId: number, port: Browser.runtime.Port): void {
      if (!port.name.startsWith(BUS_PORT_PREFIX)) {
        return;
      }
      if (!popupPortsByTabId.has(tabId)) {
        popupPortsByTabId.set(tabId, new Set());
      }
      const ports = popupPortsByTabId.get(tabId) as Set<Browser.runtime.Port>;
      ports.add(port);
      port.onMessage.addListener((message) => handlePopupMessage(port, message));
      port.onDisconnect.addListener(() => {
        ports.delete(port);
        for (const [requestId, pending] of pendingPopupReplies.entries()) {
          if (pending.port !== port) {
            continue;
          }
          pendingPopupReplies.delete(requestId);
          pending.reject(new BusError(
            BUS_ERROR_CODES.TRANSPORT_FAILED,
            `Popup bus port disconnected before replying for tab ${tabId}`,
            { requestId, tabId },
          ));
        }
        if (ports.size === 0) {
          popupPortsByTabId.delete(tabId);
        }
      });
    },
  };
}
