import { createRewriteBrainRuntime } from "./rewrite-brain-runtime";
import { getInstalledBrowserApi } from "../common/browser";

export { createRewriteBrain } from "./rewrite-brain";

type RewriteSidePanelApi = Readonly<{
  setOptions?: (options: { tabId?: number; path: string; enabled: boolean }) => Promise<void> | void;
  open?: (options: { tabId: number }) => Promise<void> | void;
}>;

type InstalledBrowserApi = NonNullable<ReturnType<typeof getInstalledBrowserApi>>;
type RewriteMessageResponder = (response: unknown) => void;
type RewriteExtensionApi = InstalledBrowserApi & Readonly<{
  sidePanel?: RewriteSidePanelApi;
}>;

function reportActionOpenFailure(error: unknown): void {
  console.error("[Unfluffify][rewrite] Unable to open side panel", error);
}

async function openRewriteSidePanelForTab(tab: Readonly<{ id?: number }>, api: RewriteExtensionApi): Promise<void> {
  if (typeof tab.id !== "number" || !api.sidePanel?.setOptions || !api.sidePanel.open) {
    reportActionOpenFailure(new Error("Missing tab id or sidePanel API"));
    return;
  }
  void Promise.resolve(api.sidePanel.setOptions({
    tabId: tab.id,
    path: "popup.html",
    enabled: true,
  })).catch(reportActionOpenFailure);
  await api.sidePanel.open({ tabId: tab.id });
}

let rewriteBackgroundStarted = false;

export function startRewriteBackground(): void {
  const api = getInstalledBrowserApi() as RewriteExtensionApi | null;
  if (rewriteBackgroundStarted || !api?.runtime?.onMessage) {
    return;
  }
  rewriteBackgroundStarted = true;
  const runtime = createRewriteBrainRuntime({
    addMessageListener(listener) {
      api.runtime.onMessage.addListener((message: unknown, sender: unknown, sendResponse: RewriteMessageResponder) => listener(message, sender, sendResponse));
    },
    createAlarm(name, info) {
      api.alarms?.create(name, info);
    },
    clearAlarm(name) {
      api.alarms?.clear(name);
    },
    addAlarmListener(listener) {
      api.alarms?.onAlarm?.addListener(listener);
    },
  });
  runtime.start();
  void Promise.resolve(api.sidePanel?.setOptions?.({
    path: "popup.html",
    enabled: true,
  })).catch(reportActionOpenFailure);
  api.action?.onClicked?.addListener((tab: Readonly<{ id?: number }>) => {
    void openRewriteSidePanelForTab(tab, api).catch(reportActionOpenFailure);
  });
  api.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: RewriteMessageResponder) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return false;
    }
    const request = message as { type?: unknown; tabId?: unknown; afterSeq?: unknown };
    if (request.type === "uf.rewrite.ping") {
      sendResponse({ ok: true, tree: "rewrite" });
      return true;
    }
    if (request.type === "uf.rewrite.signals.pull" && typeof request.tabId === "number") {
      sendResponse({
        ok: true,
        signals: runtime.getBrain(request.tabId).pullSignals(typeof request.afterSeq === "number" ? request.afterSeq : 0),
      });
      return true;
    }
    return false;
  });
}
