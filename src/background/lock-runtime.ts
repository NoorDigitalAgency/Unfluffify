import { projectPropertyLockView, type PropertyLockState, type PropertyLockView } from "../lock";
import type { LockBannerVocabulary, LockReason } from "../domain/schema/facts";
import type { RewriteBackgroundServices } from "./services";
import { createRealmBus, type LockStatus } from "../messaging/realms";
import { createTabTransport } from "../messaging/transports/tabs";
import { createPageContextRuntime } from "./page-context-runtime";

export type LockDirectiveRequest = Readonly<{
  tabId: number;
  pageUrl: string;
  baseUrl?: string;
  hasUnsavedChanges?: boolean;
}>;

type TabsLike = Readonly<{
  sendMessage(tabId: number, message: unknown): Promise<unknown> | unknown;
}>;

type LockClient = Awaited<ReturnType<RewriteBackgroundServices["createLockClient"]>>;

function baseUrlFor(url: string): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

/** There is no lock state to project when the site never resolved, and the
 *  reasons are not interchangeable: "this page is not a managed property" is a
 *  normal outcome on any other site, and "you are signed out" is a thing the
 *  operator can fix in one step, whereas an unreachable backend or a missing
 *  config is something else again. Reporting them all as "unavailable" sends the
 *  operator looking for a connection fault that is not there. */
const NO_LOCK_STATE_REASON: Readonly<Record<LockStatus, LockReason>> = {
  ok: "connecting",
  not_configured: "not-configured",
  not_candidate: "not-candidate",
  suspended_candidate_removed: "candidate-removed",
  suspended_candidate_feed_conflict: "candidate-feed-conflict",
  signed_out: "signed-out",
  unavailable: "unavailable",
};

function lockStateFromState(input: Readonly<{
  pageUrl: string;
  baseUrl: string;
  siteId: number | null;
  state: PropertyLockState | null;
  status: LockStatus;
}>) {
  const view: PropertyLockView = input.state
    ? projectPropertyLockView(input.state)
    : { bannerVisible: true, reason: NO_LOCK_STATE_REASON[input.status], canEdit: false };
  const lockRole = input.state?.role ?? "unknown";
  const blockedReason = view.reason;
  const authority = input.state?.role === "editor" &&
    input.state.environmentKey &&
    input.state.editorSessionId &&
    input.state.lockToken &&
    input.state.propertyRevision !== undefined &&
    input.state.feedRevision !== undefined
    ? {
        environmentKey: input.state.environmentKey,
        editorSessionId: input.state.editorSessionId,
        lockToken: input.state.lockToken,
        propertyRevision: input.state.propertyRevision,
        feedRevision: input.state.feedRevision,
      }
    : undefined;
  return {
    status: input.status,
    baseUrl: input.baseUrl,
    siteId: input.siteId,
    lockRole,
    configPresent: input.status === "ok" && input.siteId !== null,
    canEdit: view.canEdit,
    blockedReason,
    ...(authority ? { authority } : {}),
    lockBanner: {
      visible: view.bannerVisible,
      reason: view.reason,
      ...(view.countdownSeconds === undefined ? {} : { countdownSeconds: view.countdownSeconds }),
      ...(view.editorName ? { editorName: view.editorName } : {}),
      ...(view.fromName ? { fromName: view.fromName } : {}),
      ...(view.toName ? { toName: view.toName } : {}),
    },
  };
}

export function createPropertyLockRuntime(input: Readonly<{
  services: RewriteBackgroundServices;
  context?: Pick<ReturnType<typeof createPageContextRuntime>, "resolve">;
  tabs?: TabsLike;
  observeLockFacts?: (facts: Readonly<{
    tabId: number;
    siteId: number | null;
    baseUrl: string;
    pageUrl: string;
    lockRole: "unknown" | "editor" | "passive";
    configPresent: boolean;
    canEdit: boolean;
    blockedReason: LockReason;
    lockBanner: LockBannerVocabulary;
  }>) => Promise<void> | void;
}>) {
  const clients = new Map<string, LockClient>();
  const pageUrls = new Map<string, string>();
  const unsavedByKey = new Map<string, boolean>();
  const claimedKeys = new Set<string>();
  const publishedLockStates = new Map<string, string>();
  const latestLockStates = new Map<number, ReturnType<typeof lockStateFromState>>();
  const activeKeyByTab = new Map<number, string>();
  const contextRuntime = input.context ?? createPageContextRuntime({
    currentEnvironmentKey: input.services.lynx.currentEnvironmentKey,
    hasToken: input.services.accounts.hasToken,
    resolve: input.services.lynx.resolvePropertyContext,
  });

  const observeLockState = (
    tabId: number,
    pageUrl: string,
    state: ReturnType<typeof lockStateFromState>,
  ): Promise<void> | void => input.observeLockFacts?.({
    tabId,
    siteId: state.siteId,
    baseUrl: state.baseUrl,
    pageUrl,
    lockRole: state.lockRole,
    configPresent: state.configPresent,
    canEdit: state.canEdit,
    blockedReason: state.blockedReason,
    lockBanner: state.lockBanner,
  });

  const publishLockState = async (tabId: number, state: ReturnType<typeof lockStateFromState>): Promise<void> => {
    if (!input.tabs) {
      return;
    }
    const bus = createRealmBus({
      realm: "background",
      transport: createTabTransport(input.tabs, tabId),
    });
    try {
      await bus.request("command.dispatch", {
        kind: "uf-command/1",
        name: "lock.state.changed",
        tabId,
        payload: {
          baseUrl: state.baseUrl,
          configPresent: state.configPresent,
          lockRole: state.lockRole,
          canEdit: state.canEdit,
          blockedReason: state.blockedReason,
          banner: state.lockBanner,
        },
      }, { target: "content" });
    } finally {
      bus.dispose();
    }
  };

  const publishLockStateIfChanged = (key: string, tabId: number, state: ReturnType<typeof lockStateFromState>): void => {
    latestLockStates.set(tabId, state);
    const serialized = JSON.stringify(state);
    if (publishedLockStates.get(key) === serialized) {
      return;
    }
    publishedLockStates.set(key, serialized);
    void publishLockState(tabId, state);
  };

  const releaseKey = (key: string): void => {
    clients.get(key)?.close();
    clients.delete(key);
    pageUrls.delete(key);
    unsavedByKey.delete(key);
    claimedKeys.delete(key);
    publishedLockStates.delete(key);
  };

  const releaseActiveForTab = (tabId: number, nextKey?: string): void => {
    const activeKey = activeKeyByTab.get(tabId);
    if (!activeKey || activeKey === nextKey) {
      return;
    }
    releaseKey(activeKey);
    activeKeyByTab.delete(tabId);
  };

  const getOrCreateClient = async (request: LockDirectiveRequest, siteId: number, baseUrl: string): Promise<LockClient> => {
    const key = `${request.tabId}:${siteId}`;
    const existing = clients.get(key);
    if (existing && !existing.isClosed()) {
      existing.setPageUrl(request.pageUrl);
      return existing;
    }
    if (existing?.isClosed()) {
      clients.delete(key);
      claimedKeys.delete(key);
    }
    const client = await input.services.createLockClient({
      tabId: request.tabId,
      siteId,
      pageUrl: request.pageUrl,
      hasUnsavedChanges: () => unsavedByKey.get(key) === true,
      onStateChange: (state) => {
        if (activeKeyByTab.get(request.tabId) !== key) {
          return;
        }
        const pageUrl = pageUrls.get(key) ?? request.pageUrl;
        const response = lockStateFromState({ pageUrl, baseUrl, siteId, state, status: "ok" });
        const observation = observeLockState(request.tabId, pageUrl, response);
        if (observation) {
          void observation.then(
            () => publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response),
            (error: unknown) => {
              console.error("[Unfluffify][rewrite] Unable to observe property-lock facts", error);
              publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
            },
          );
        } else {
          publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
        }
      },
    });
    clients.set(key, client);
    pageUrls.set(key, request.pageUrl);
    return client;
  };

  return {
    async directive(request: LockDirectiveRequest) {
      const context = await contextRuntime.resolve({ tabId: request.tabId, pageUrl: request.pageUrl });
      const baseUrl = context.baseUrl ?? request.baseUrl ?? baseUrlFor(request.pageUrl);
      const blockedStatus: LockStatus | null = context.status === "authentication_required"
        ? "signed_out"
        : context.status === "environment_not_registered"
          ? "not_configured"
          : context.status === "suspended_candidate_removed"
            ? "suspended_candidate_removed"
            : context.status === "suspended_candidate_feed_conflict"
              ? "suspended_candidate_feed_conflict"
              : context.status === "access_denied" || context.status === "unavailable" || context.status === "stale"
                ? "unavailable"
                : null;
      if (blockedStatus) {
        // Auth, transport, settings and candidate-feed suspension are retryable.
        // Keep any current client/draft alive but project a blocked directive.
        const response = lockStateFromState({
          pageUrl: request.pageUrl,
          baseUrl,
          siteId: context.siteId,
          state: null,
          status: blockedStatus,
        });
        await observeLockState(request.tabId, request.pageUrl, response);
        publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
        return response;
      }
      if (context.status === "unmanaged" || context.status === "managed_non_candidate" || context.siteId === null) {
        releaseActiveForTab(request.tabId);
        const response = lockStateFromState({ pageUrl: request.pageUrl, baseUrl, siteId: null, state: null, status: "not_candidate" });
        await observeLockState(request.tabId, request.pageUrl, response);
        publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
        return response;
      }
      const key = `${request.tabId}:${context.siteId}`;
      releaseActiveForTab(request.tabId, key);
      activeKeyByTab.set(request.tabId, key);
      const client = await getOrCreateClient(request, context.siteId, baseUrl);
      const previousPageUrl = pageUrls.get(key);
      const previousUnsaved = unsavedByKey.get(key);
      unsavedByKey.set(key, request.hasUnsavedChanges === true);
      if (!claimedKeys.has(key)) {
        client.claim();
        claimedKeys.add(key);
      }
      if (previousPageUrl !== request.pageUrl || previousUnsaved !== (request.hasUnsavedChanges === true)) {
        client.setPageUrl(request.pageUrl);
        client.clientStatus();
        pageUrls.set(key, request.pageUrl);
      }
      client.heartbeat();
      const state = client.state();
      const response = lockStateFromState({ pageUrl: request.pageUrl, baseUrl, siteId: context.siteId, state, status: "ok" });
      await observeLockState(request.tabId, request.pageUrl, response);
      publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
      return response;
    },
    activity(tabId: number, siteId: number): void {
      clients.get(`${tabId}:${siteId}`)?.activity();
    },
    republish(tabId: number, baseUrl: string): void {
      const state = latestLockStates.get(tabId);
      if (state?.baseUrl === baseUrl) {
        void publishLockState(tabId, state);
      }
    },
  };
}
