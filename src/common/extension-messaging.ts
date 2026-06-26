import { defineExtensionMessaging } from "@webext-core/messaging";

import { browser, type Browser } from "./browser";
import { type BusEnvelope, BUS_PROTOCOL } from "./bus/envelope";
import { REALMS } from "./bus/realms";
import { MESSAGE_TARGETS, type RequestEnvelope } from "./message-protocol";

export const REQUEST_PROTOCOL = "uf-runtime-request/1" as const;

type OneShotProtocolMap = {
  [BUS_PROTOCOL]: (env: BusEnvelope) => BusEnvelope | void;
  [REQUEST_PROTOCOL]: (env: RequestEnvelope) => unknown;
};

const extensionMessaging = defineExtensionMessaging<OneShotProtocolMap>();

function getSendTarget(tabId?: number | null, frameId?: number | null): number | { tabId: number; frameId?: number } | undefined {
  if (!Number.isFinite(tabId) || !tabId || tabId <= 0) {
    return undefined;
  }
  const normalizedTabId = Math.trunc(tabId);
  if (Number.isFinite(frameId) && frameId !== null && frameId !== undefined && frameId >= 0) {
    return { tabId: normalizedTabId, frameId: Math.trunc(frameId) };
  }
  return normalizedTabId;
}

export function sendBusEnvelope(env: BusEnvelope): Promise<BusEnvelope | void> {
  if (env.dst !== REALMS.CONTENT) {
    return browser.runtime.sendMessage(env) as Promise<BusEnvelope | void>;
  }
  const target = getSendTarget(env.tab, env.frame);
  return extensionMessaging.sendMessage(BUS_PROTOCOL, env, target);
}

export function sendRequestEnvelope(env: RequestEnvelope): Promise<unknown> {
  if (env.target !== MESSAGE_TARGETS.CONTENT) {
    return browser.runtime.sendMessage(env);
  }
  const target = getSendTarget(env.tabId, env.frameId);
  return extensionMessaging.sendMessage(REQUEST_PROTOCOL, env, target);
}

export function addBusEnvelopeListener(
  listener: (env: BusEnvelope, sender?: Browser.runtime.MessageSender) => Promise<BusEnvelope | void> | BusEnvelope | void,
): () => void {
  return extensionMessaging.onMessage(BUS_PROTOCOL, ({ data, sender }) =>
    listener(data, sender as Browser.runtime.MessageSender | undefined),
  );
}

export function addRequestEnvelopeListener(
  listener: (env: RequestEnvelope, sender?: Browser.runtime.MessageSender) => Promise<unknown> | unknown,
): () => void {
  return extensionMessaging.onMessage(REQUEST_PROTOCOL, ({ data, sender }) =>
    listener(data, sender as Browser.runtime.MessageSender | undefined),
  );
}
