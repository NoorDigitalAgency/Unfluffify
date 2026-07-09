import { createRewriteBrainRuntime } from "./rewrite-brain-runtime";
import { createPropertyLockRuntime } from "./lock-runtime";
import { createRenderEmulationRuntime } from "./render-emulation-runtime";
import { createRewriteBackgroundServices } from "./services";
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
  offscreen?: Readonly<{
    hasDocument?: () => Promise<boolean> | boolean;
    createDocument?: (options: { url: string; reasons: string[]; justification: string }) => Promise<void> | void;
  }>;
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

async function ensureOffscreenDocument(api: RewriteExtensionApi): Promise<void> {
  if (!api.offscreen?.createDocument) {
    return;
  }
  const hasDocument = await Promise.resolve(api.offscreen.hasDocument?.() ?? false);
  if (hasDocument) {
    return;
  }
  await Promise.resolve(api.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Refine Unfluffify XPath rows against captured HTML",
  }));
}

let rewriteBackgroundStarted = false;

export function startRewriteBackground(): void {
  const api = getInstalledBrowserApi() as RewriteExtensionApi | null;
  if (rewriteBackgroundStarted || !api?.runtime?.onMessage) {
    return;
  }
  rewriteBackgroundStarted = true;
  const services = createRewriteBackgroundServices();
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
  const renderEmulation = createRenderEmulationRuntime({
    debuggerApi: api.debugger,
    tabs: api.tabs,
  });
  const lockRuntime = createPropertyLockRuntime({
    services,
    tabs: api.tabs,
    observeLockFacts(facts) {
      const brain = runtime.getBrain(facts.tabId);
      brain.observe({
        tabId: facts.tabId,
        source: "background",
        reason: "property-lock",
        facts: {
          tabId: facts.tabId,
          siteId: facts.siteId,
          baseUrl: facts.baseUrl,
          pageUrl: facts.pageUrl,
          lockRole: facts.lockRole,
          configPresent: facts.configPresent,
        },
      });
      const snapshot = brain.snapshot();
      if (snapshot) {
        void services.persistence.persistDurableFacts(snapshot);
      }
    },
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
      const brain = runtime.getBrain(tabId);
      const emitted = brain.emitSourceSignal(request.signal);
      const snapshot = brain.snapshot();
      if (snapshot) {
        void services.persistence.persistDurableFacts(snapshot);
      }
      return [emitted];
    } finally {
      release();
    }
  });
  bus.onCommand("signals.consume", (request) => {
    runtime.getBrain(request.tabId).markConsumed(request.organId, request.seq);
    return { ok: true as const };
  });
  bus.on("fact.reported", (envelope, meta) => {
    const tabId = envelope.sensation.tabId === 0
      ? parseSenderTabId(meta.sourceInstance) ?? 0
      : envelope.sensation.tabId;
    const brain = runtime.getBrain(tabId);
    brain.observe({
      ...envelope.sensation,
      tabId,
      facts: {
        ...envelope.sensation.facts,
        tabId,
      },
    });
    const snapshot = brain.snapshot();
    if (snapshot) {
      void services.persistence.persistDurableFacts(snapshot);
    }
    const siteId = typeof envelope.sensation.facts.siteId === "number" ? envelope.sensation.facts.siteId : snapshot?.siteId ?? null;
    if (envelope.sensation.reason === "activity-ping" && siteId !== null) {
      lockRuntime.activity(tabId, siteId);
    }
  });
  bus.onCommand("lock.directive", (request) => lockRuntime.directive(request));
  bus.onCommand("emulation.apply", (request) => renderEmulation.apply(request.tabId, request.mode, request.scale));
  bus.onCommand("emulation.clear", async (request) => {
    await renderEmulation.clear(request.tabId);
    return { status: "ok" as const };
  });
  bus.onCommand("renderMode.inspect", (request) => renderEmulation.inspect(request));
  bus.onCommand("offscreen.refineXpaths", async (request) => {
    await ensureOffscreenDocument(api);
    const response = await bus.request("offscreen.refineXpaths", request, { target: "offscreen" });
    return response.ok ? response.data : { rows: request.rows };
  });
  bus.onCommand("ai.run", async (snapshot) => {
    const result = await services.lynx.runAiJob(snapshot);
    return result.status === "ok"
      ? { status: result.status, sessionId: result.sessionId, selectors: result.selectors }
      : { status: result.status, httpStatus: "httpStatus" in result ? result.httpStatus : undefined };
  });
  bus.onCommand("config.save", async (snapshot) => {
    const result = await services.lynx.saveConfigSnapshot(snapshot);
    return result.status === "ok"
      ? { status: result.status }
      : { status: result.status, httpStatus: result.httpStatus };
  });
  void Promise.resolve(api.sidePanel?.setOptions?.({
    path: "popup.html",
    enabled: true,
  })).catch(reportActionOpenFailure);
  api.action?.onClicked?.addListener((tab: Readonly<{ id?: number }>) => {
    void openRewriteSidePanelForTab(tab, api).catch(reportActionOpenFailure);
  });
}
