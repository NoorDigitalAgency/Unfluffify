import { createRewriteBrainRuntime } from "./rewrite-brain-runtime";
import { createPropertyLockRuntime, PROPERTY_LOCK_HEARTBEAT_ALARM } from "./lock-runtime";
import { createRenderEmulationRuntime } from "./render-emulation-runtime";
import { managedEmulationDecision } from "./emulation-policy";
import { createRewriteBackgroundServices } from "./services";
import { createAuthTokenMonitor } from "./auth-token-monitor";
import { createPageContextRuntime } from "./page-context-runtime";
import {
  createLockBrowserLifecycle,
  type LockBrowserApi,
} from "./lock-browser-lifecycle";
import { connectionSettingsOf, replaceConnectionProfile } from "../storage/settings";
import { getInstalledBrowserApi } from "../common/browser";
import { createRealmBus } from "../messaging/realms";
import { createRuntimeTransport } from "../messaging/transports/runtime";
import { parseSenderTabId } from "../messaging/rewrite-signals";
import { canonicalPageKey, PropertySnapshotIntegrityError } from "../storage/property-snapshot-authority";
import { projectTodoCoverage } from "../domain/todo";
import type { ConfigSnapshot } from "../storage/config";
import { fetchStaticPageHtml } from "./static-html";
import { createTransferPayloadStore } from "./transfer-payload-store";
import { actionIconStateForContext, createActionIconController } from "./action-icon";
import { clearDomainCache } from "../storage/domain-cache";

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
  const transferPayloads = createTransferPayloadStore();
  const actionIcons = createActionIconController(api.action);
  const runtime = createRewriteBrainRuntime({
    addMessageListener() {},
    rehydrateDurableFacts: services.persistence.rehydrateDurableFacts,
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
  const bus = createRealmBus({
    realm: "background",
    transport: createRuntimeTransport(api.runtime),
  });
  const renderEmulation = createRenderEmulationRuntime({
    debuggerApi: api.debugger,
    tabs: api.tabs,
  });
  const pageContextRuntime = createPageContextRuntime({
    currentEnvironmentKey: services.lynx.currentEnvironmentKey,
    hasToken: services.accounts.hasToken,
    resolve: services.lynx.resolvePropertyContext,
  });
  const tabTerminations = new Map<number, Promise<void>>();
  const awaitTabTermination = async (tabId: number): Promise<void> => {
    while (tabTerminations.has(tabId)) {
      await tabTerminations.get(tabId);
    }
  };
  const clearTabContinuation = async (tabId: number): Promise<void> => {
    const latestRun = await services.repos.runRecordRepo.loadLatestForTab(tabId);
    if (latestRun.ok && latestRun.value) {
      await services.repos.runRecordRepo.clear(latestRun.value.sessionId);
    }
    await services.repos.tabStateRepo.clear(tabId);
  };
  const beginTabCleanup = (tabId: number, cleanup: () => Promise<void>): Promise<void> => {
    runtime.forgetBrain(tabId);
    const previous = tabTerminations.get(tabId);
    const termination = (async () => {
      if (previous) {
        await previous;
      }
      await cleanup();
    })();
    tabTerminations.set(tabId, termination);
    const clearTermination = () => {
      if (tabTerminations.get(tabId) === termination) {
        tabTerminations.delete(tabId);
      }
    };
    void termination.then(clearTermination, clearTermination);
    return termination;
  };
  const lockRuntime = createPropertyLockRuntime({
    services,
    context: pageContextRuntime,
    tabs: api.tabs,
    onAuthoritativeTransfer({ tabId }) {
      // A foreign/rotated fence is the ownership boundary. Clear only the old
      // continuation; the passive client remains connected for future handoff.
      return beginTabCleanup(tabId, () => clearTabContinuation(tabId));
    },
    async observeLockFacts(facts) {
      void actionIcons.apply(facts.tabId, facts.canEdit ? "active" : "locked").catch(() => undefined);
      await awaitTabTermination(facts.tabId);
      const brain = await runtime.getBrain(facts.tabId);
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
        await services.persistence.persistDurableFacts(snapshot);
      }
    },
  });
  const lockBrowserLifecycle = createLockBrowserLifecycle({
    api: api as unknown as LockBrowserApi,
    onPresenceChanged(tabId, presence) {
      lockRuntime.presenceChanged(tabId, presence);
    },
    onTabTerminated(tabId, reason) {
      // Navigation/reload and tab close are draft-terminal, unlike a transient
      // network failure. A close releases immediately; navigation retains only
      // the lease while its off-candidate/cross-property deadline is resolved.
      return beginTabCleanup(tabId, async () => {
        if (reason === "tab-closed") {
          await lockRuntime.terminateTab(tabId);
        } else {
          lockRuntime.navigationCommitted(tabId);
        }
        await clearTabContinuation(tabId);
      });
    },
  });
  void lockBrowserLifecycle.start().catch((error) => {
    console.error("[Unfluffify][rewrite] Unable to initialize browser lock presence", error);
  });
  // The lease belongs to the background editor session, not to the side-panel
  // document. Closing the panel therefore removes no client and no heartbeat.
  api.alarms?.create(PROPERTY_LOCK_HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  api.alarms?.onAlarm?.addListener((alarm) => {
    runtime.keepAlive.handleAlarm(alarm);
    void authTokenMonitor.handleAlarm(alarm);
    if (alarm.name === PROPERTY_LOCK_HEARTBEAT_ALARM) {
      lockRuntime.heartbeat();
    }
  });
  bus.onCommand("signals.pull", async (request, meta) => {
    const tabId = request.tabId === 0 ? parseSenderTabId(meta.sourceInstance) ?? 0 : request.tabId;
    await awaitTabTermination(tabId);
    const brain = await runtime.getBrain(tabId);
    return [...(request.organId
      ? brain.pullForOrgan(request.organId, request.afterSeq)
      : brain.pullSignals(request.afterSeq))];
  });
  bus.onCommand("signals.consume", async (request, meta) => {
    const tabId = request.tabId === 0 ? parseSenderTabId(meta.sourceInstance) ?? 0 : request.tabId;
    await awaitTabTermination(tabId);
    const brain = await runtime.getBrain(tabId);
    brain.markConsumed(request.organId, request.seq);
    return { ok: true as const };
  });
  bus.on("fact.reported", async (envelope, meta) => {
    const tabId = envelope.sensation.tabId === 0
      ? parseSenderTabId(meta.sourceInstance) ?? 0
      : envelope.sensation.tabId;
    await awaitTabTermination(tabId);
    const brain = await runtime.getBrain(tabId);
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
      await services.persistence.persistDurableFacts(snapshot);
      // This fact belongs to the tab, not the popup. Publishing it here keeps
      // heartbeats accurate while every UI surface is closed.
      lockRuntime.unsavedChanged(tabId, snapshot.hasUnsavedWork);
    }
    const siteId = typeof envelope.sensation.facts.siteId === "number" ? envelope.sensation.facts.siteId : snapshot?.siteId ?? null;
    if (envelope.sensation.reason === "activity-ping" && siteId !== null) {
      lockRuntime.activity(tabId, siteId);
    }
    if (envelope.sensation.reason === "content-started") {
      const baseUrl = typeof envelope.sensation.facts.baseUrl === "string" ? envelope.sensation.facts.baseUrl : "";
      const pageUrl = typeof envelope.sensation.facts.pageUrl === "string" ? envelope.sensation.facts.pageUrl : "";
      if (pageUrl) {
        await lockRuntime.directive({ tabId, pageUrl, baseUrl, hasUnsavedChanges: false });
      } else {
        lockRuntime.republish(tabId, baseUrl);
      }
    }
  });
  bus.onCommand("lock.directive", async (request) => {
    await awaitTabTermination(request.tabId);
    return await lockRuntime.directive(request);
  });
  bus.onCommand("lock.action", async (request, meta) => {
    const tabId = request.tabId ?? parseSenderTabId(meta.sourceInstance) ?? 0;
    await awaitTabTermination(tabId);
    return lockRuntime.action({ ...request, tabId });
  });
  bus.onCommand("staticHtml.fetch", (request) => fetchStaticPageHtml(request.url));
  bus.onCommand("emulation.apply", (request) => renderEmulation.apply(request.tabId, request.mode, request.scale, request.allowReload === true));
  bus.onCommand("emulation.clear", async (request) => {
    await renderEmulation.clear(request.tabId);
    return { status: "ok" as const };
  });
  /** Render-mode knowledge is presentation data, not property classification.
   * Keep its last settled value by authoritative identity so a transient context
   * retry does not make a configured property appear unconfigured. */
  const renderModeByProperty = new Map<string, boolean>();
  bus.onCommand("page.context", async (request, meta) => {
    const tabId = request.tabId ?? parseSenderTabId(meta.sourceInstance) ?? 0;
    void actionIcons.apply(tabId, "connecting").catch(() => undefined);
    const context = await pageContextRuntime.resolve({
      tabId,
      pageUrl: request.pageUrl,
      refresh: request.refresh,
    });
    void actionIcons.apply(tabId, actionIconStateForContext(context.status)).catch(() => undefined);
    // Content asks for page context at load time, before a popup necessarily
    // exists. That is the earliest authoritative point at which the background
    // knows this is a managed property tab, so establish the standing mobile
    // posture here. An explicit desktop preview is a held override and remains
    // untouched until the popup turns it off or marking begins.
    const emulationDecision = managedEmulationDecision({
      recognized: tabId > 0 && Boolean(context.environmentKey) && context.siteId !== null,
      heldMode: renderEmulation.heldMode(tabId),
    });
    if (emulationDecision) {
      await renderEmulation.apply(
        tabId,
        emulationDecision.mode,
        emulationDecision.scale,
        emulationDecision.allowReload,
      ).catch(() => undefined);
    }
    const propertyKey = context.environmentKey && context.siteId !== null
      ? `${context.environmentKey}\u0000${context.siteId}`
      : null;
    let renderModeSet = propertyKey ? renderModeByProperty.get(propertyKey) ?? false : false;
    let authoritativeConfig: ConfigSnapshot | null = null;
    if (context.environmentKey && context.siteId !== null) {
      const stored = await services.repos.configRepo.load(context.environmentKey, context.siteId);
      authoritativeConfig = stored.ok && stored.value ? stored.value : null;
    }
    if (
      propertyKey &&
      context.environmentKey &&
      context.siteId !== null &&
      (context.status === "managed_candidate" ||
        context.status === "managed_non_candidate" ||
        context.status === "suspended_candidate_removed" ||
        context.status === "suspended_candidate_feed_conflict")
    ) {
      const loaded = await services.lynx.loadConfigSnapshot(context.environmentKey, context.siteId);
      const authority = await services.property.applyBackendLoad(
        context.environmentKey,
        context.siteId,
        loaded.status === "ok"
          ? { status: loaded.status, config: loaded.data }
          : { status: loaded.status },
      );
      renderModeSet = authority.renderMode !== undefined;
      if (loaded.status === "ok" || loaded.status === "not_found") {
        renderModeByProperty.set(propertyKey, renderModeSet);
        const stored = await services.repos.configRepo.load(context.environmentKey, context.siteId);
        authoritativeConfig = stored.ok && stored.value ? stored.value : null;
      }
    }
    const todo = projectTodoCoverage(
      context.pageTypes,
      context.pageKey,
      new Set(Object.keys(authoritativeConfig?.pages ?? {})),
    );
    return { ...context, renderModeSet, todo };
  });
  bus.onCommand("renderMode.inspect", (request) => renderEmulation.inspect(request));
  bus.onCommand("transferPayload.put", async (request) => ({
    handle: await transferPayloads.put(request.scope, request.value),
  }));
  bus.onCommand("transferPayload.get", async (request, meta) => {
    if (meta.source !== "offscreen") {
      return { status: "missing" as const };
    }
    const value = await transferPayloads.get(request.handle);
    return value === null
      ? { status: "missing" as const }
      : { status: "ok" as const, value };
  });
  bus.onCommand("transferPayload.release", (request) => ({
    released: transferPayloads.releaseScope(request.scope),
  }));
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
        editorSessionId: request.editorSessionId,
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
      clientRunId: request.clientRunId,
      editorSessionId: request.editorSessionId,
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
        const snapshot = applied.snapshot;
        if (!snapshot) {
          throw new PropertySnapshotIntegrityError("Validated backend load did not produce a snapshot.");
        }
        if (applied.integrityWarning) {
          return {
            status: "integrity_shrink" as const,
            config: snapshot,
            renderMode: applied.renderMode,
            renderModeSource: "backend" as const,
            reason: applied.integrityWarning.message,
          };
        }
        return {
          status: "ok" as const,
          config: snapshot,
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
        return { status: "invalid" as const, renderModeSource: "local" as const };
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
    const integrity = await services.property.mutationGate(request.environmentKey, request.siteId);
    if (!integrity.ok) {
      return { status: integrity.status, reason: integrity.reason };
    }
    const authorization = lockRuntime.authorizeMutation(request);
    if (!authorization.ok) {
      return {
        status: authorization.status,
        httpStatus: 409,
        reason: authorization.reason,
      };
    }
    const result = await services.lynx.saveConfigSnapshot(authorization.request);
    if (result.status === "ok") {
      try {
        const adoption = await services.property.applyBackendSave(
          request.environmentKey,
          request.siteId,
          result.data,
        );
        return adoption.integrityWarning
          ? {
              status: "integrity_shrink" as const,
              config: adoption.snapshot,
              reason: adoption.integrityWarning.message,
            }
          : { status: "ok" as const, config: adoption.snapshot };
      } catch (error) {
        if (error instanceof PropertySnapshotIntegrityError) {
          return { status: "integrity_shrink" as const };
        }
        throw error;
      }
    }
    return result.status === "conflict"
      ? { status: result.status, httpStatus: result.httpStatus, ...(result.data ? { config: result.data } : {}) }
      : {
          status: result.status,
          httpStatus: result.httpStatus,
          ...("reason" in result && result.reason ? { reason: result.reason } : {}),
        };
  });
  bus.onCommand("config.publish", async (request) => {
    const environmentKey = await services.lynx.currentEnvironmentKey();
    if (!environmentKey || environmentKey !== request.environmentKey) {
      return { status: "environment_unconfigured" as const };
    }
    const integrity = await services.property.mutationGate(request.environmentKey, request.siteId);
    if (!integrity.ok) {
      return { status: integrity.status, reason: integrity.reason };
    }
    const authorization = lockRuntime.authorizeMutation(request);
    if (!authorization.ok) {
      return {
        status: authorization.status,
        httpStatus: 409,
        reason: authorization.reason,
      };
    }
    const result = await services.lynx.publishConfigSnapshot(authorization.request);
    if ("data" in result) {
      try {
        const adoption = await services.property.applyBackendSave(
          request.environmentKey,
          request.siteId,
          result.data,
        );
        if (adoption.integrityWarning) {
          return {
            status: "integrity_shrink" as const,
            config: adoption.snapshot,
            reason: adoption.integrityWarning.message,
          };
        }
        return {
          status: result.status,
          httpStatus: result.httpStatus,
          config: adoption.snapshot,
        };
      } catch (error) {
        if (error instanceof PropertySnapshotIntegrityError) {
          return { status: "integrity_shrink" as const };
        }
        throw error;
      }
    }
    return {
      status: result.status,
      httpStatus: result.httpStatus,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  });
  bus.onCommand("settings.load", async () => {
    const stored = await services.settings.load();
    return {
      settings: connectionSettingsOf(stored),
      hasToken: Boolean(stored.token?.trim()),
    };
  });
  bus.onCommand("settings.save", async (settings) => {
    // The parsed request is the complete profile: clearing a field clears it.
    // Profile and credential land in one repository write, so no request can
    // observe a new backend paired with the old backend's JWT. Formatting-only
    // edits retain the credential because comparison uses normalized identity.
    const saved = await services.settings.update((current) => replaceConnectionProfile(current, settings));
    return {
      status: "ok" as const,
      settings: connectionSettingsOf(saved),
      hasToken: Boolean(saved.token?.trim()),
    };
  });
  bus.onCommand("cache.clearDomain", ({ origin }) => clearDomainCache(api.browsingData, origin));
  bus.onCommand("session.unregister", async ({ tabId }) => {
    await beginTabCleanup(tabId, async () => {
      await lockRuntime.terminateTab(tabId);
      await clearTabContinuation(tabId);
      // Session authority is terminal even when Chrome cannot detach the CDP
      // posture (for example a tab that vanished between confirmation and this
      // command). The caller already deactivated content and can report that
      // cosmetic cleanup independently.
      await renderEmulation.clear(tabId).catch(() => undefined);
    });
    await actionIcons.apply(tabId, "unregistered").catch(() => undefined);
    return { status: "ok" as const };
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
