import { createRewriteBrainRuntime } from "./rewrite-brain-runtime";
import { createPropertyLockRuntime } from "./lock-runtime";
import { createRenderEmulationRuntime } from "./render-emulation-runtime";
import { createRewriteBackgroundServices } from "./services";
import { createAuthTokenMonitor } from "./auth-token-monitor";
import { connectionSettingsOf } from "../storage/settings";
import { getInstalledBrowserApi } from "../common/browser";
import { createRealmBus } from "../messaging/realms";
import { createRuntimeTransport } from "../messaging/transports/runtime";
import { parseSenderTabId } from "../messaging/rewrite-signals";
import { canonicalPageKey, PropertySnapshotIntegrityError } from "../storage/property-snapshot-authority";

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
  const authTokenMonitor = createAuthTokenMonitor({
    validate: () => services.accounts.validate(),
    createAlarm(name, info) {
      api.alarms?.create(name, info);
    },
    clearAlarm(name) {
      api.alarms?.clear(name);
    },
    onInvalid() {
      console.warn("[Unfluffify][rewrite] Stored auth token was rejected; sign in again");
    },
    onError(error) {
      console.error("[Unfluffify][rewrite] Auth token check failed", error);
    },
  });
  void authTokenMonitor.start();
  api.alarms?.onAlarm?.addListener((alarm) => {
    runtime.keepAlive.handleAlarm(alarm);
    void authTokenMonitor.handleAlarm(alarm);
  });
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
          lockCanEdit: facts.canEdit,
          lockBlockedReason: facts.blockedReason,
          lockBanner: facts.lockBanner,
          configPresent: facts.configPresent,
        },
      });
      const snapshot = brain.snapshot();
      if (snapshot) {
        void services.persistence.persistDurableFacts(snapshot);
      }
    },
  });
  bus.onCommand("signals.pull", (request, meta) => {
    const tabId = request.tabId === 0 ? parseSenderTabId(meta.sourceInstance) ?? 0 : request.tabId;
    return [...(request.organId
      ? runtime.getBrain(tabId).pullForOrgan(request.organId, request.afterSeq)
      : runtime.getBrain(tabId).pullSignals(request.afterSeq))];
  });
  bus.onCommand("signals.consume", (request, meta) => {
    const tabId = request.tabId === 0 ? parseSenderTabId(meta.sourceInstance) ?? 0 : request.tabId;
    runtime.getBrain(tabId).markConsumed(request.organId, request.seq);
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
    if (envelope.sensation.reason === "content-started") {
      const baseUrl = typeof envelope.sensation.facts.baseUrl === "string" ? envelope.sensation.facts.baseUrl : "";
      lockRuntime.republish(tabId, baseUrl);
    }
  });
  bus.onCommand("lock.directive", (request) => lockRuntime.directive(request));
  bus.onCommand("emulation.apply", (request) => renderEmulation.apply(request.tabId, request.mode, request.scale, request.allowReload === true));
  bus.onCommand("emulation.clear", async (request) => {
    await renderEmulation.clear(request.tabId);
    return { status: "ok" as const };
  });
  /** What a freshly loaded page is, answered without the popup being open.
   *
   *  Consent hiding and the reveal/freeze ritual are page-load behaviours, and
   *  legacy made that explicit: consent runs on every property page regardless of
   *  candidacy or render mode, and the ritual runs once per visit for a page the
   *  crawler actually wants. Both need this answer before an operator does anything.
   *
   *  Cached per origin. Resolving a site id is a backend round-trip, and a page load
   *  is not a reason to make one per page — but it is a reason to make one per
   *  property per worker lifetime. */
  const pageContextCache = new Map<string, Readonly<{
    property: boolean;
    siteId: number | null;
    renderModeSet: boolean;
    pageMarkings: readonly string[];
    reason: string;
  }>>();
  bus.onCommand("page.context", async (request) => {
    const baseUrl = (() => {
      try {
        return request.pageUrl ? new URL(request.pageUrl).origin : "";
      } catch {
        return "";
      }
    })();
    const empty = { property: false, baseUrl, siteId: null, renderModeSet: false, candidatePage: false, hasPageRecords: false };
    if (!baseUrl) {
      return { ...empty, reason: "unparseable-url" };
    }
    const cached = pageContextCache.get(baseUrl);
    if (cached) {
      const currentPageKey = canonicalPageKey(request.pageUrl);
      return {
        property: cached.property,
        baseUrl,
        siteId: cached.siteId,
        renderModeSet: cached.renderModeSet,
        candidatePage: currentPageKey !== null && cached.pageMarkings.includes(currentPageKey),
        hasPageRecords: cached.pageMarkings.length > 0,
        reason: cached.reason,
      };
    }
    // Signed out there is nothing to ask and no property to confirm, and the
    // answer must not be cached — signing in changes it.
    if (!await services.accounts.hasToken()) {
      return { ...empty, reason: "signed-out" };
    }
    const site = await services.lynx.getSiteIdForUrl(request.pageUrl);
    if (site.siteId === null) {
      // A genuine miss is worth remembering; a network fault says nothing about
      // whether this is a property, so it is not cached.
      const reason = site.status === "not_found" ? "not-a-property" : "lookup-unavailable";
      if (site.status === "not_found") {
        pageContextCache.set(baseUrl, { property: false, siteId: null, renderModeSet: false, pageMarkings: [], reason });
      }
      return { ...empty, reason };
    }
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey) {
      return { ...empty, property: true, siteId: site.siteId, reason: "environment-unconfigured" };
    }
    const loaded = await services.lynx.loadConfigSnapshot(environmentKey, site.siteId);
    // Same adaptation as config.load: the authority rule takes {status, config}.
    const authority = await services.property.applyBackendLoad(environmentKey, site.siteId, loaded.status === "ok"
      ? { status: loaded.status, config: loaded.data }
      : { status: loaded.status });
    const pageMarkings = loaded.status === "ok" ? Object.keys(loaded.data.pages) : [];
    const currentPageKey = canonicalPageKey(request.pageUrl);
    const entry = {
      property: true,
      siteId: site.siteId,
      // The effective mode after the authority rule, so a locally-held choice for a
      // property with no backend configuration counts as set.
      renderModeSet: authority.renderMode !== undefined,
      pageMarkings,
      reason: loaded.status === "ok" ? "configured" : `config-${loaded.status}`,
    };
    // Only a settled answer is cached: a failed config read would otherwise freeze
    // "no render mode, no candidate pages" in for the worker's lifetime.
    if (loaded.status === "ok" || loaded.status === "not_found") {
      pageContextCache.set(baseUrl, entry);
    }
    return {
      property: true,
      baseUrl,
      siteId: entry.siteId,
      renderModeSet: entry.renderModeSet,
      candidatePage: currentPageKey !== null && entry.pageMarkings.includes(currentPageKey),
      hasPageRecords: entry.pageMarkings.length > 0,
      reason: entry.reason,
    };
  });
  bus.onCommand("renderMode.inspect", (request) => renderEmulation.inspect(request));
  bus.onCommand("offscreen.refineXpaths", async (request) => {
    await ensureOffscreenDocument(api);
    const response = await bus.request("offscreen.refineXpaths", request, { target: "offscreen" });
    return response.ok ? response.data : { rows: request.rows };
  });
  bus.onCommand("ai.run", async (request) => {
    const releaseKeepAlive = runtime.keepAlive.acquireUntilRelease("ai.run");
    try {
      const environmentKey = await services.lynx.currentEnvironmentKey();
      if (!environmentKey) {
        return { status: "environment_unconfigured" };
      }
      if (!request.snapshot.pages.some((page) => canonicalPageKey(page.url) === request.pageKey)) {
        return { status: "invalid_page_scope" };
      }
      const snapshot = await services.property.overlayAiCorpus(
        environmentKey,
        request.siteId,
        request.snapshot,
      );
      const result = await services.lynx.runAiJob(snapshot, {
        tabId: request.tabId,
        clientRunId: request.clientRunId,
        environmentKey,
        siteId: request.siteId,
        pageKey: request.pageKey,
      });
      return result.status === "ok"
        ? { status: result.status, sessionId: result.sessionId, selectors: result.selectors }
        : { status: result.status, httpStatus: "httpStatus" in result ? result.httpStatus : undefined };
    } finally {
      releaseKeepAlive();
    }
  });
  bus.onCommand("ai.resume", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey) {
      return { status: "environment_unconfigured" as const };
    }
    return await services.lynx.resumeAiJob({
      tabId: request.tabId,
      environmentKey,
      siteId: request.siteId,
      pageKey: request.pageKey,
    });
  });
  bus.onCommand("config.load", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey) {
      return { status: "environment_unconfigured" as const, renderModeSource: "local" as const };
    }
    const result = await services.lynx.loadConfigSnapshot(environmentKey, request.siteId);
    // The rule lives in services, not here and not in the popup: one place
    // decides what local data survives a backend answer.
    try {
      if (result.status === "ok") {
        const applied = await services.property.applyBackendLoad(
          environmentKey,
          request.siteId,
          { status: "ok", config: result.data },
        );
        return {
          status: "ok" as const,
          config: result.data,
          ...(applied.renderMode ? { renderMode: applied.renderMode } : {}),
          renderModeSource: "backend" as const,
        };
      }
      const applied = await services.property.applyBackendLoad(
        environmentKey,
        request.siteId,
        { status: result.status },
      );
      return {
        status: result.status,
        httpStatus: result.httpStatus,
        ...(applied.renderMode ? { renderMode: applied.renderMode } : {}),
        renderModeSource: applied.source,
      };
    } catch (error) {
      if (error instanceof PropertySnapshotIntegrityError) {
        return { status: "integrity_shrink" as const, renderModeSource: "local" as const };
      }
      throw error;
    }
  });
  bus.onCommand("renderMode.remember", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    return environmentKey
      ? services.property.rememberRenderMode(environmentKey, request.siteId, request.renderMode)
      : { stored: false as const, reason: "environment-unconfigured" as const };
  });
  bus.onCommand("config.save", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey || environmentKey !== request.environmentKey) {
      return { status: "environment_unconfigured" as const };
    }
    const result = await services.lynx.saveConfigSnapshot(request);
    if (result.status === "ok") {
      try {
        const config = await services.property.applyBackendSave(
          request.environmentKey,
          request.siteId,
          result.data,
        );
        return { status: "ok" as const, config };
      } catch (error) {
        if (error instanceof PropertySnapshotIntegrityError) {
          return { status: "integrity_shrink" as const };
        }
        throw error;
      }
    }
    return result.status === "conflict"
      ? { status: result.status, httpStatus: result.httpStatus, ...(result.data ? { config: result.data } : {}) }
      : { status: result.status, httpStatus: result.httpStatus };
  });
  bus.onCommand("settings.load", async () => {
    const stored = await services.settings.load();
    return {
      settings: connectionSettingsOf(stored),
      hasToken: Boolean(stored.token?.trim()),
    };
  });
  bus.onCommand("settings.save", async (settings) => {
    // Endpoints come wholly from the request so clearing a field clears it, but
    // the token is carried forward — the popup has no way to supply one. Going
    // through services.settings.update keeps this from racing a rotation that
    // lands mid-save.
    const saved = await services.settings.update((current) => ({
      ...settings,
      ...(current.token?.trim() ? { token: current.token } : {}),
    }));
    return {
      status: "ok" as const,
      settings: connectionSettingsOf(saved),
      hasToken: Boolean(saved.token?.trim()),
    };
  });
  bus.onCommand("accounts.login", async (credentials) => {
    const result = await services.accounts.login(credentials);
    return result.status === "ok"
      ? { status: result.status }
      : result.status === "skipped"
        ? { status: result.status }
        : result.status === "missing_token"
          ? { status: result.status, httpStatus: result.httpStatus }
          : { status: result.status, httpStatus: result.httpStatus, message: result.message };
  });
  bus.onCommand("accounts.logout", async () => {
    await services.accounts.logout();
    return { status: "ok" as const };
  });
  // Routed through the monitor so the manual check and the alarm share one
  // verdict rather than drifting apart.
  bus.onCommand("accounts.validate", async () => {
    const result = await authTokenMonitor.check();
    return result.status === "skipped"
      ? { status: result.status }
      : { status: result.status, httpStatus: result.httpStatus };
  });
  bus.onCommand("accounts.status", () => authTokenMonitor.status());
  void Promise.resolve(api.sidePanel?.setOptions?.({
    path: "popup.html",
    enabled: true,
  })).catch(reportActionOpenFailure);
  api.action?.onClicked?.addListener((tab: Readonly<{ id?: number }>) => {
    void openRewriteSidePanelForTab(tab, api).catch(reportActionOpenFailure);
  });
}
