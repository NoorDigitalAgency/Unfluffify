import "../../public/assets/fonts/fonts.css";
import "../../theme-color.css";
import "../../theme-components.css";
import "../../popup.css";
import "../../theme-utilities.css";
import "../../public/assets/materialdesignicons.min.css";
import React from "react";
import { createRoot } from "react-dom/client";

import { App, resolvePopupActionButtons } from "../../popup/App";
import { createPopupStore } from "../../popup/store";
import type { BrainSignal } from "../../domain/schema/signals";
import { browser, getInstalledBrowserApi } from "../../common/browser";
import { createRealmBus } from "../../messaging/realms";
import { createRuntimeTransport } from "../../messaging/transports/runtime";
import { emitRewriteSignal, pullRewriteSignals, type RewriteSignalBus } from "../../messaging/rewrite-signals";

type PopupDebugApi = Readonly<{
  getViewState: () => Record<string, unknown>;
}>;

declare global {
  interface Window {
    __UNFLUFFIFY_POPUP_DEBUG__?: PopupDebugApi;
  }
}

const rootElement = document.getElementById("app") ?? document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
const store = createPopupStore({ name: "silent", lastConsumedSeq: 0, reconciliationReason: "" });
const root = createRoot(rootElement);
let seq = 0;
let boundTabId: number | null = null;
let boundTabKey: string | null = null;
let signalPollHandle: ReturnType<Window["setInterval"]> | null = null;
let lastPulledBrainSeq = 0;
let popupBus: RewriteSignalBus | null = null;

type TargetTabContext = Readonly<{
  tabId: number;
  url: string;
}>;

function getRuntimeBrowser() {
  return getInstalledBrowserApi() ?? browser;
}

function getPopupBus(): RewriteSignalBus {
  if (!popupBus) {
    popupBus = createRealmBus({
      realm: "popup",
      transport: createRuntimeTransport(getRuntimeBrowser().runtime),
    });
  }
  return popupBus;
}

function nextSignal(tabId: number, name: BrainSignal["name"], payload: BrainSignal["payload"] = {}): BrainSignal {
  seq += 1;
  return {
    kind: "uf-signal/1",
    tabId,
    seq,
    name,
    source: "brain",
    cause: "popup-entrypoint",
    at: Date.now(),
    payload,
  };
}

function getDebugTabId(): number | null {
  const value = new URL(location.href).searchParams.get("debugTabId") ?? "";
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function tabBindingKey(context: TargetTabContext): string {
  return `${context.tabId}|${context.url}`;
}

async function resolveTargetTabContext(): Promise<TargetTabContext | null> {
  const debugTabId = getDebugTabId();
  if (debugTabId !== null) {
    try {
      const tab = await getRuntimeBrowser().tabs.get(debugTabId);
      return { tabId: debugTabId, url: typeof tab?.url === "string" ? tab.url : "" };
    } catch {
      return { tabId: debugTabId, url: "" };
    }
  }
  const [activeTab] = await getRuntimeBrowser().tabs.query({ active: true, currentWindow: true });
  return typeof activeTab?.id === "number" && activeTab.id > 0
    ? { tabId: activeTab.id, url: typeof activeTab.url === "string" ? activeTab.url : "" }
    : null;
}

function dispatchSignal(signal: BrainSignal): void {
  store.dispatch(signal);
  seq = Math.max(seq, signal.seq);
}

function signalMatchesBinding(signal: BrainSignal, tabId: number, requestKey: string | null): boolean {
  if (signal.tabId !== tabId) {
    return false;
  }
  const pageUrl = typeof signal.payload.pageUrl === "string" ? signal.payload.pageUrl : "";
  if (pageUrl) {
    return tabBindingKey({ tabId, url: pageUrl }) === requestKey;
  }
  return ![
    "marking.enabled",
    "marking.disabled",
    "markings.changed",
    "session.discarded",
    "session.navigated",
  ].includes(signal.name);
}

function bindToTab(context: TargetTabContext): { changed: boolean; sameTabNavigation: boolean; key: string } {
  const nextKey = tabBindingKey(context);
  if (boundTabKey === nextKey) {
    return { changed: false, sameTabNavigation: false, key: nextKey };
  }
  const sameTabNavigation = boundTabId === context.tabId && boundTabKey !== null;
  boundTabId = context.tabId;
  boundTabKey = nextKey;
  lastPulledBrainSeq = 0;
  store.reset({ name: "silent", lastConsumedSeq: 0, reconciliationReason: "" });
  return { changed: true, sameTabNavigation, key: nextKey };
}

async function pullSignals(tabId: number, requestKey = boundTabKey): Promise<void> {
  const response = await pullRewriteSignals(getPopupBus(), {
    tabId,
    afterSeq: lastPulledBrainSeq,
  });
  if (!response.ok) {
    return;
  }
  if (boundTabId !== tabId || boundTabKey !== requestKey) {
    return;
  }
  for (const signal of response.data) {
    if (signal && typeof signal === "object" && (signal as BrainSignal).kind === "uf-signal/1" && signalMatchesBinding(signal as BrainSignal, tabId, requestKey)) {
      const brainSignal = signal as BrainSignal;
      lastPulledBrainSeq = Math.max(lastPulledBrainSeq, brainSignal.seq);
      dispatchSignal(brainSignal);
    }
  }
}

async function emitPopupSignal(tabId: number, name: BrainSignal["name"], payload: BrainSignal["payload"] = {}, requestKey = boundTabKey): Promise<void> {
  const response = await emitRewriteSignal(getPopupBus(), tabId, {
    name,
    source: "popup",
    cause: "popup-entrypoint",
    payload,
  });
  if (boundTabId !== tabId || boundTabKey !== requestKey) {
    return;
  }
  if (response.ok) {
    for (const signal of response.data) {
      if (signalMatchesBinding(signal, tabId, requestKey)) {
        lastPulledBrainSeq = Math.max(lastPulledBrainSeq, signal.seq);
        dispatchSignal(signal);
      }
    }
    return;
  }
  if (boundTabId !== tabId || boundTabKey !== requestKey) {
    return;
  }
  dispatchSignal(nextSignal(tabId, name, payload));
}

async function handleBoundContext(context: TargetTabContext): Promise<string> {
  const binding = bindToTab(context);
  if (binding.sameTabNavigation) {
    await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
    await emitPopupSignal(context.tabId, "session.navigated", { pageUrl: context.url }, binding.key);
  }
  return binding.key;
}

function ensureSignalPolling(context: TargetTabContext): void {
  void handleBoundContext(context).catch((error: unknown) => {
    console.error("[Unfluffify][rewrite] Unable to bind popup tab", error);
  });
  if (signalPollHandle !== null) {
    return;
  }
  signalPollHandle = window.setInterval(() => {
    void pollCurrentTabSignals().catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to pull rewrite brain signals", error);
    });
  }, 500);
}

async function pollCurrentTabSignals(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  const requestKey = await handleBoundContext(context);
  await pullSignals(context.tabId, requestKey);
  render();
}

async function initializePopupSignals(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    return;
  }
  ensureSignalPolling(context);
  await pullSignals(context.tabId, boundTabKey);
  await reconcileContentStatus(context, boundTabKey);
  render();
}

async function sendContentMessage(tabId: number, message: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await getRuntimeBrowser().tabs.sendMessage(tabId, message);
    return Boolean(response && typeof response === "object" && "ok" in response && response.ok === true);
  } catch (error) {
    console.error("[Unfluffify][rewrite] Unable to update content marking state", error);
    return false;
  }
}

async function reconcileContentStatus(context: TargetTabContext, requestKey = boundTabKey): Promise<void> {
  const runtimeBrowser = getRuntimeBrowser();
  let response: unknown;
  try {
    response = await runtimeBrowser.tabs.sendMessage(context.tabId, { type: "getContentMainStatus" });
  } catch {
    return;
  }
  if (boundTabId !== context.tabId || boundTabKey !== requestKey) {
    return;
  }
  if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true) {
    return;
  }
  const status = response as { active?: unknown; dirty?: unknown; pageUrl?: unknown; markedCount?: unknown };
  if (status.pageUrl && status.pageUrl !== context.url) {
    return;
  }
  if (status.active === true && store.getState().name === "silent") {
    await emitPopupSignal(context.tabId, "marking.enabled", {
      baseUrl: "",
      pageUrl: context.url,
      cause: "content-reconciliation",
    }, requestKey);
  }
  const markedCount = typeof status.markedCount === "number" ? status.markedCount : 0;
  if (
    status.active === true &&
    status.dirty === true &&
    ["silent", "pre_ai_clean", "post_ai_clean"].includes(store.getState().name)
  ) {
    await emitPopupSignal(context.tabId, "markings.changed", {
      pageUrl: context.url,
      markedCount,
    }, requestKey);
  }
}

async function setMarkingEnabled(enabled: boolean): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    console.error("[Unfluffify][rewrite] Unable to resolve an active tab for the popup");
    store.dispatch(nextSignal(0, "marking.disabled", { baseUrl: "", cause: "missing-tab" }));
    render();
    return;
  }
  const requestKey = await handleBoundContext(context);
  if (enabled) {
    ensureSignalPolling(context);
    await pullSignals(context.tabId, requestKey);
    const activated = await sendContentMessage(context.tabId, {
      type: "activateContentMain",
      pageUrl: context.url,
      realEditorActivation: true,
    });
    await emitPopupSignal(context.tabId, activated ? "marking.enabled" : "marking.disabled", {
      baseUrl: "",
      pageUrl: context.url,
      cause: activated ? "toggle" : "content-activation-failed",
    }, requestKey);
    await pullSignals(context.tabId, requestKey);
  } else {
    await sendContentMessage(context.tabId, { type: "deactivateContentMain" });
    await emitPopupSignal(context.tabId, "marking.disabled", { baseUrl: "", pageUrl: context.url, cause: "toggle" }, requestKey);
  }
  render();
}

async function discardMarkings(): Promise<void> {
  const context = await resolveTargetTabContext();
  if (context === null) {
    console.error("[Unfluffify][rewrite] Unable to resolve an active tab for discard");
    return;
  }
  const requestKey = await handleBoundContext(context);
  const reset = await sendContentMessage(context.tabId, { type: "resetContentMain" });
  if (!reset) {
    return;
  }
  await emitPopupSignal(context.tabId, "session.discarded", { baseUrl: "", pageUrl: context.url }, requestKey);
  await pullSignals(context.tabId, requestKey);
  render();
}

function getDebugViewState(): Record<string, unknown> {
  const state = store.getState();
  const presentation = store.getPresentation();
  const actionButtons = resolvePopupActionButtons(presentation, {
    runAi: false,
    save: false,
    discard: true,
    preview: false,
  });
  return {
    ...presentation,
    currentView: "Rewrite",
    sessionPhase: state.name,
    stateName: state.name,
    toggleEnabled: presentation.enableToggleChecked,
    buttons: {
      compute: actionButtons.compute,
      save: actionButtons.save,
      discard: actionButtons.discard,
      preview: actionButtons.preview,
      enable: { checked: presentation.enableToggleChecked },
      desktopPreview: { checked: presentation.desktopPreviewChecked },
    },
  };
}

function render(): void {
  root.render(
    <App
      presentation={store.getPresentation()}
      onEnableChange={(enabled) => { void setMarkingEnabled(enabled); }}
      onDiscard={() => { void discardMarkings(); }}
    />,
  );
}

if (typeof window !== "undefined") {
  window.__UNFLUFFIFY_POPUP_DEBUG__ = { getViewState: getDebugViewState };
}
store.subscribe(render);
render();
void initializePopupSignals().catch((error: unknown) => {
  console.error("[Unfluffify][rewrite] Unable to initialize popup signal state", error);
});
