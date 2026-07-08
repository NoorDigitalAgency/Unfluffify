import { createRewriteBrainRuntime } from "./rewrite-brain-runtime";
import { getInstalledBrowserApi } from "../common/browser";
import { createRealmBus } from "../messaging/realms";
import { createRuntimeTransport } from "../messaging/transports/runtime";
import { parseSenderTabId } from "../messaging/rewrite-signals";

export { createRewriteBrain } from "./rewrite-brain";

type RewriteSidePanelApi = Readonly<{
  setOptions?: (options: { tabId?: number; path: string; enabled: boolean }) => Promise<void> | void;
  open?: (options: { tabId: number }) => Promise<void> | void;
}>;

type InstalledBrowserApi = NonNullable<ReturnType<typeof getInstalledBrowserApi>>;
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
    addMessageListener() {},
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
  runtime.keepAlive.clearIfIdle();
  api.alarms?.onAlarm?.addListener((alarm) => runtime.keepAlive.handleAlarm(alarm));
  const bus = createRealmBus({
    realm: "background",
    transport: createRuntimeTransport(api.runtime),
  });
  bus.onCommand("signals.pull", (request) =>
    [...(request.organId
      ? runtime.getBrain(request.tabId).pullForOrgan(request.organId, request.afterSeq)
      : runtime.getBrain(request.tabId).pullSignals(request.afterSeq))]
  );
  bus.onCommand("signals.emit", (request, meta) => {
    const release = runtime.keepAlive.acquire("emit");
    try {
      const tabId = request.tabId === 0 ? parseSenderTabId(meta.sourceInstance) ?? request.tabId : request.tabId;
      return [runtime.getBrain(tabId).emitSourceSignal(request.signal)];
    } finally {
      release();
    }
  });
  bus.onCommand("signals.consume", (request) => {
    runtime.getBrain(request.tabId).markConsumed(request.organId, request.seq);
    return { ok: true as const };
  });
  void Promise.resolve(api.sidePanel?.setOptions?.({
    path: "popup.html",
    enabled: true,
  })).catch(reportActionOpenFailure);
  api.action?.onClicked?.addListener((tab: Readonly<{ id?: number }>) => {
    void openRewriteSidePanelForTab(tab, api).catch(reportActionOpenFailure);
  });
}
