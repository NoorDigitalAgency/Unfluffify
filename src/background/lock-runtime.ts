import {
  projectPropertyLockView,
  type PropertyLockPresence,
  type PropertyLockState,
  type PropertyLockView,
} from "../lock";
import type { LockBannerVocabulary, LockReason } from "../domain/schema/facts";
import type { RewriteBackgroundServices } from "./services";
import { createRealmBus, type LockStatus } from "../messaging/realms";
import { createTabTransport } from "../messaging/transports/tabs";
import { createPageContextRuntime } from "./page-context-runtime";
import type { PropertyMutationEnvelope } from "../storage/config";

export const PROPERTY_LOCK_HEARTBEAT_ALARM = "uf-property-lock-heartbeat";

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

const UNKNOWN_PRESENCE: PropertyLockPresence = {
  visible: false,
  focusedWindow: false,
  browserIdle: true,
  suspensionReason: "browser-presence-unknown",
};

function presenceQualifies(presence: PropertyLockPresence): boolean {
  return presence.visible && presence.focusedWindow && !presence.browserIdle;
}

export type MutationFenceFailure = Readonly<{
  ok: false;
  status: "stale_fence";
  propertyRevision: number;
  feedRevision: number;
  reason: string;
}>;

export type MutationFenceAuthorization<T extends PropertyMutationEnvelope> =
  | Readonly<{ ok: true; request: T }>
  | MutationFenceFailure;

function clientKey(environmentKey: string, tabId: number, siteId: number): string {
  return `${environmentKey}\u0000${tabId}\u0000${siteId}`;
}

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
  const clientCreations = new Map<string, Promise<LockClient>>();
  const pageUrls = new Map<string, string>();
  const unsavedByKey = new Map<string, boolean>();
  const claimedKeys = new Set<string>();
  const publishedLockStates = new Map<string, string>();
  const latestLockStates = new Map<number, ReturnType<typeof lockStateFromState>>();
  const activeKeyByTab = new Map<number, string>();
  const presenceByTab = new Map<number, PropertyLockPresence>();
  const generationByTab = new Map<number, number>();
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

  const releaseKey = async (key: string): Promise<void> => {
    const client = clients.get(key);
    const session = client?.editorSession();
    clients.delete(key);
    pageUrls.delete(key);
    unsavedByKey.delete(key);
    claimedKeys.delete(key);
    publishedLockStates.delete(key);
    client?.close();
    if (session) {
      await input.services.repos.editorSessionRepo.clear(
        session.environmentKey,
        session.tabId,
        session.siteId,
      );
    }
  };

  const releaseActiveForTab = async (tabId: number, nextKey?: string): Promise<void> => {
    const activeKey = activeKeyByTab.get(tabId);
    if (!activeKey || activeKey === nextKey) {
      return;
    }
    activeKeyByTab.delete(tabId);
    await releaseKey(activeKey);
  };

  const getOrCreateClient = async (
    request: LockDirectiveRequest,
    environmentKey: string,
    siteId: number,
    baseUrl: string,
    generation: number,
  ): Promise<LockClient> => {
    const key = clientKey(environmentKey, request.tabId, siteId);
    const existing = clients.get(key);
    if (existing && !existing.isClosed()) {
      return existing;
    }
    const inFlight = clientCreations.get(key);
    if (inFlight) {
      return await inFlight;
    }
    if (existing?.isClosed()) {
      clients.delete(key);
      claimedKeys.delete(key);
    }
    const creation = input.services.createLockClient({
      environmentKey,
      tabId: request.tabId,
      siteId,
      presence: () => presenceByTab.get(request.tabId) ?? UNKNOWN_PRESENCE,
      hasUnsavedWork: () => unsavedByKey.get(key) === true,
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
    })
      .then(async (client) => {
        if ((generationByTab.get(request.tabId) ?? 0) !== generation) {
          client.close();
          await input.services.repos.editorSessionRepo.clearForTab(request.tabId);
          throw new Error("Property-lock directive was superseded by tab navigation");
        }
        clients.set(key, client);
        pageUrls.set(key, request.pageUrl);
        return client;
      });
    clientCreations.set(key, creation);
    try {
      return await creation;
    } finally {
      if (clientCreations.get(key) === creation) {
        clientCreations.delete(key);
      }
    }
  };

  return {
    async directive(request: LockDirectiveRequest) {
      const generation = generationByTab.get(request.tabId) ?? 0;
      const context = await contextRuntime.resolve({ tabId: request.tabId, pageUrl: request.pageUrl });
      if ((generationByTab.get(request.tabId) ?? 0) !== generation) {
        throw new Error("Property-lock directive was superseded by tab navigation");
      }
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
        await releaseActiveForTab(request.tabId);
        const response = lockStateFromState({ pageUrl: request.pageUrl, baseUrl, siteId: null, state: null, status: "not_candidate" });
        await observeLockState(request.tabId, request.pageUrl, response);
        publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
        return response;
      }
      if (!context.environmentKey) {
        const response = lockStateFromState({ pageUrl: request.pageUrl, baseUrl, siteId: context.siteId, state: null, status: "unavailable" });
        await observeLockState(request.tabId, request.pageUrl, response);
        publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
        return response;
      }
      const key = clientKey(context.environmentKey, request.tabId, context.siteId);
      await releaseActiveForTab(request.tabId, key);
      activeKeyByTab.set(request.tabId, key);
      const client = await getOrCreateClient(
        request,
        context.environmentKey,
        context.siteId,
        baseUrl,
        generation,
      );
      if ((generationByTab.get(request.tabId) ?? 0) !== generation) {
        throw new Error("Property-lock directive was superseded by tab navigation");
      }
      const previousPageUrl = pageUrls.get(key);
      const previousUnsaved = unsavedByKey.get(key);
      unsavedByKey.set(key, request.hasUnsavedChanges === true);
      if (!claimedKeys.has(key)) {
        client.claim();
        claimedKeys.add(key);
      }
      if (previousPageUrl !== request.pageUrl || previousUnsaved !== (request.hasUnsavedChanges === true)) {
        client.clientStatus();
        pageUrls.set(key, request.pageUrl);
      }
      if (presenceQualifies(presenceByTab.get(request.tabId) ?? UNKNOWN_PRESENCE)) {
        client.heartbeat();
      }
      const state = client.state();
      const response = lockStateFromState({ pageUrl: request.pageUrl, baseUrl, siteId: context.siteId, state, status: "ok" });
      await observeLockState(request.tabId, request.pageUrl, response);
      publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
      return response;
    },
    activity(tabId: number, siteId: number): void {
      const activeKey = activeKeyByTab.get(tabId);
      const client = activeKey ? clients.get(activeKey) : undefined;
      if (
        client?.editorSession().siteId === siteId &&
        presenceQualifies(presenceByTab.get(tabId) ?? UNKNOWN_PRESENCE)
      ) {
        client.activity();
      }
    },
    presenceChanged(tabId: number, presence: PropertyLockPresence): void {
      presenceByTab.set(tabId, presence);
      const activeKey = activeKeyByTab.get(tabId);
      const client = activeKey ? clients.get(activeKey) : undefined;
      if (!client || client.isClosed()) {
        return;
      }
      client.clientStatus();
      if (presenceQualifies(presence)) {
        client.heartbeat();
      }
    },
    heartbeat(): void {
      for (const client of clients.values()) {
        const session = client.editorSession();
        if (
          !client.isClosed() &&
          presenceQualifies(presenceByTab.get(session.tabId) ?? UNKNOWN_PRESENCE)
        ) {
          client.heartbeat();
        }
      }
    },
    async terminateTab(
      tabId: number,
      options: Readonly<{ forgetPresence?: boolean }> = {},
    ): Promise<void> {
      generationByTab.set(tabId, (generationByTab.get(tabId) ?? 0) + 1);
      const keys = [...clients.entries()]
        .filter(([, client]) => client.editorSession().tabId === tabId)
        .map(([key]) => key);
      activeKeyByTab.delete(tabId);
      for (const key of keys) {
        await releaseKey(key);
      }
      if (options.forgetPresence !== false) {
        presenceByTab.delete(tabId);
      }
      latestLockStates.delete(tabId);
      publishedLockStates.delete(`tab:${tabId}`);
      await input.services.repos.editorSessionRepo.clearForTab(tabId);
    },
    authorizeMutation<T extends PropertyMutationEnvelope>(request: T): MutationFenceAuthorization<T> {
      const client = [...clients.values()].find((candidate) => {
        const session = candidate.editorSession();
        return session.environmentKey === request.environmentKey &&
          session.siteId === request.siteId &&
          session.editorSessionId === request.editorSessionId;
      });
      const state = client?.state();
      if (
        !client ||
        client.isClosed() ||
        state?.role !== "editor" ||
        state.editorSessionId !== request.editorSessionId ||
        !state.lockToken ||
        state.lockToken !== request.lockToken
      ) {
        return {
          ok: false,
          status: "stale_fence",
          propertyRevision: state?.propertyRevision ?? request.expectedPropertyRevision,
          feedRevision: state?.feedRevision ?? request.expectedFeedRevision,
          reason: "The editor session no longer owns the current property lock fence.",
        };
      }
      return { ok: true, request };
    },
    republish(tabId: number, baseUrl: string): void {
      const state = latestLockStates.get(tabId);
      if (state?.baseUrl === baseUrl) {
        void publishLockState(tabId, state);
      }
    },
  };
}
