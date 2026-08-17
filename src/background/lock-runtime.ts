import {
  PROPERTY_CONTEXT_RECOVERY_POLL_MS,
  PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
  PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS,
  PROPERTY_LOCK_SUSPENDED_RECOVERY_GRACE_MS,
  projectPropertyLockView,
  type PropertyLockPresence,
  type PropertyLockState,
  type PropertyLockView,
} from "../lock";
import type { LockAction, LockBannerVocabulary, LockReason } from "../domain/schema/facts";
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
  /** Background-owned recovery checks bypass the settled context cache. */
  refreshContext?: boolean;
}>;

export type LockActionRequest = Readonly<LockAction & { tabId: number }>;

type TabsLike = Readonly<{
  sendMessage(tabId: number, message: unknown): Promise<unknown> | unknown;
}>;

type LockClient = Awaited<ReturnType<RewriteBackgroundServices["createLockClient"]>>;

type LocalLockWarning = Readonly<{
  kind: "off-candidate" | "cross-property";
  key: string;
  deadlineAt: number;
  timer: ReturnType<typeof setTimeout>;
  target?: LockDirectiveRequest;
}>;

type SuspendedContext = {
  reason: "candidate_removed" | "candidate_feed_conflict";
  request: LockDirectiveRequest;
  recoveryDeadlineAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  refreshing: boolean;
};

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
  warning?: Pick<LocalLockWarning, "kind" | "deadlineAt">;
  blockedReason?: LockReason;
  now?: number;
  hasUnsavedWork?: boolean;
}>) {
  const view: PropertyLockView = input.warning
    ? {
        bannerVisible: true,
        reason: input.warning.kind,
        canEdit: false,
        countdownSeconds: Math.max(0, Math.ceil((input.warning.deadlineAt - (input.now ?? Date.now())) / 1000)),
      }
    : input.blockedReason
      ? { bannerVisible: true, reason: input.blockedReason, canEdit: false }
      : input.state
        ? projectPropertyLockView(input.state)
        : { bannerVisible: true, reason: NO_LOCK_STATE_REASON[input.status], canEdit: false };
  const lockRole = input.state?.role ?? "unknown";
  const blockedReason = view.reason;
  const authority = view.canEdit && input.state?.role === "editor" &&
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
    configPresent: (
      input.status === "ok" ||
      input.status === "suspended_candidate_removed" ||
      input.status === "suspended_candidate_feed_conflict"
    ) && input.siteId !== null,
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
      ...(view.actions ? {
        actions: view.actions.map((action) => action.kind === "accept-takeover" && input.hasUnsavedWork === false
          ? { ...action, confirmDiscard: undefined }
          : action),
      } : {}),
    },
  };
}

export function createPropertyLockRuntime(input: Readonly<{
  services: RewriteBackgroundServices;
  context?: Pick<ReturnType<typeof createPageContextRuntime>, "resolve">;
  tabs?: TabsLike;
  onAuthoritativeTransfer?: (event: Readonly<{
    tabId: number;
    environmentKey: string;
    siteId: number;
  }>) => Promise<void> | void;
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
  now?: () => number;
}>) {
  const now = input.now ?? Date.now;
  const clients = new Map<string, LockClient>();
  const clientCreations = new Map<string, Promise<LockClient>>();
  const pageUrls = new Map<string, string>();
  const baseUrls = new Map<string, string>();
  const unsavedByTab = new Map<number, boolean>();
  const unsavedKnownTabs = new Set<number>();
  const claimedKeys = new Set<string>();
  const publishedLockStates = new Map<string, string>();
  const latestLockStates = new Map<number, ReturnType<typeof lockStateFromState>>();
  const activeKeyByTab = new Map<number, string>();
  const presenceByTab = new Map<number, PropertyLockPresence>();
  const generationByTab = new Map<number, number>();
  const localWarningByTab = new Map<number, LocalLockWarning>();
  const suspendedContextByTab = new Map<number, SuspendedContext>();
  const contextRuntime = input.context ?? createPageContextRuntime({
    currentEnvironmentKey: input.services.lynx.currentEnvironmentKey,
    hasToken: input.services.accounts.hasToken,
    resolve: input.services.lynx.resolvePropertyContext,
  });
  const basePresenceForTab = (tabId: number): PropertyLockPresence =>
    presenceByTab.get(tabId) ?? UNKNOWN_PRESENCE;

  const presenceForTab = (tabId: number): PropertyLockPresence => {
    const base = basePresenceForTab(tabId);
    const suspended = suspendedContextByTab.get(tabId);
    if (suspended) {
      return { ...base, suspensionReason: suspended.reason };
    }
    const warning = localWarningByTab.get(tabId);
    if (warning) {
      // Off-candidate/cross-property pages cannot renew the prior property's
      // lease even when the browser page itself is selected and focused.
      return {
        ...base,
        visible: false,
        suspensionReason: warning.kind === "off-candidate" ? "off_candidate" : "cross_property",
      };
    }
    return base;
  };

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

  const projectClientState = (
    key: string,
    tabId: number,
    siteId: number,
    state: PropertyLockState,
  ): ReturnType<typeof lockStateFromState> => lockStateFromState({
    pageUrl: pageUrls.get(key) ?? "",
    baseUrl: baseUrls.get(key) ?? baseUrlFor(pageUrls.get(key) ?? ""),
    siteId,
    state,
    status: "ok",
    warning: localWarningByTab.get(tabId),
    now: now(),
    ...(unsavedKnownTabs.has(tabId) ? { hasUnsavedWork: unsavedByTab.get(tabId) === true } : {}),
  });

  const observeAndPublishClientState = (
    key: string,
    tabId: number,
    siteId: number,
    state: PropertyLockState,
  ): void => {
    if (activeKeyByTab.get(tabId) !== key) {
      return;
    }
    const pageUrl = pageUrls.get(key) ?? "";
    const response = projectClientState(key, tabId, siteId, state);
    const observation = observeLockState(tabId, pageUrl, response);
    if (observation) {
      void observation.then(
        () => publishLockStateIfChanged(`tab:${tabId}`, tabId, response),
        (error: unknown) => {
          console.error("[Unfluffify][rewrite] Unable to observe property-lock facts", error);
          publishLockStateIfChanged(`tab:${tabId}`, tabId, response);
        },
      );
    } else {
      publishLockStateIfChanged(`tab:${tabId}`, tabId, response);
    }
  };

  const releaseKey = async (key: string): Promise<void> => {
    const client = clients.get(key);
    const session = client?.editorSession();
    clients.delete(key);
    pageUrls.delete(key);
    baseUrls.delete(key);
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

  const clearLocalWarning = (tabId: number): void => {
    const warning = localWarningByTab.get(tabId);
    if (!warning) {
      return;
    }
    clearTimeout(warning.timer);
    localWarningByTab.delete(tabId);
  };

  const publishActiveClient = (tabId: number): void => {
    const key = activeKeyByTab.get(tabId);
    const client = key ? clients.get(key) : undefined;
    if (!key || !client) {
      return;
    }
    observeAndPublishClientState(key, tabId, client.editorSession().siteId, client.state());
  };

  const expireLocalWarning = async (tabId: number, warning: LocalLockWarning): Promise<void> => {
    if (localWarningByTab.get(tabId) !== warning) {
      return;
    }
    localWarningByTab.delete(tabId);
    if (activeKeyByTab.get(tabId) === warning.key) {
      activeKeyByTab.delete(tabId);
      await releaseKey(warning.key);
    }
    if (warning.target) {
      await runDirective({ ...warning.target, refreshContext: true });
    }
  };

  const startLocalWarning = (
    tabId: number,
    inputWarning: Readonly<Omit<LocalLockWarning, "timer" | "deadlineAt"> & {
      durationMs: number;
      deadlineAt?: number;
    }>,
  ): LocalLockWarning => {
    const existing = localWarningByTab.get(tabId);
    if (
      existing?.kind === inputWarning.kind &&
      existing.key === inputWarning.key &&
      (existing.target?.pageUrl === inputWarning.target?.pageUrl || !inputWarning.target)
    ) {
      return existing;
    }
    const preservedDeadlineAt = existing?.kind === inputWarning.kind &&
      existing.key === inputWarning.key &&
      !existing.target
      ? existing.deadlineAt
      : undefined;
    clearLocalWarning(tabId);
    const deadlineAt = inputWarning.deadlineAt ?? preservedDeadlineAt ?? now() + inputWarning.durationMs;
    const armTick = (): LocalLockWarning => {
      const warning: LocalLockWarning = {
        kind: inputWarning.kind,
        key: inputWarning.key,
        deadlineAt,
        ...(inputWarning.target ? { target: inputWarning.target } : {}),
        timer: setTimeout(() => {
          if (localWarningByTab.get(tabId) !== warning) {
            return;
          }
          if (deadlineAt <= now()) {
            void expireLocalWarning(tabId, warning).catch((error) => {
              console.error("[Unfluffify][rewrite] Unable to release an elapsed property lock warning", error);
            });
            return;
          }
          const next = armTick();
          localWarningByTab.set(tabId, next);
          publishActiveClient(tabId);
        }, Math.min(1_000, Math.max(0, deadlineAt - now()))),
      };
      return warning;
    };
    const warning = armTick();
    localWarningByTab.set(tabId, warning);
    return warning;
  };

  const clearSuspendedContext = (tabId: number): void => {
    const suspended = suspendedContextByTab.get(tabId);
    if (!suspended) {
      return;
    }
    if (suspended.timer !== null) {
      clearTimeout(suspended.timer);
    }
    suspendedContextByTab.delete(tabId);
    const key = activeKeyByTab.get(tabId);
    clients.get(key ?? "")?.clientStatus();
  };

  const scheduleSuspendedRefresh = (tabId: number, delayMs: number): void => {
    const suspended = suspendedContextByTab.get(tabId);
    if (!suspended || suspended.refreshing) {
      return;
    }
    if (suspended.timer !== null) {
      clearTimeout(suspended.timer);
    }
    const qualifies = presenceQualifies(basePresenceForTab(tabId));
    if (!qualifies && suspended.recoveryDeadlineAt !== null && suspended.recoveryDeadlineAt <= now()) {
      suspended.timer = null;
      return;
    }
    suspended.timer = setTimeout(() => {
      const current = suspendedContextByTab.get(tabId);
      if (current !== suspended || current.refreshing) {
        return;
      }
      current.timer = null;
      const stillQualifies = presenceQualifies(basePresenceForTab(tabId));
      if (!stillQualifies && current.recoveryDeadlineAt !== null && current.recoveryDeadlineAt <= now()) {
        return;
      }
      current.refreshing = true;
      void runDirective({ ...current.request, refreshContext: true })
        .catch((error) => {
          console.error("[Unfluffify][rewrite] Candidate recovery context refresh failed", error);
        })
        .finally(() => {
          const latest = suspendedContextByTab.get(tabId);
          if (latest !== current) {
            return;
          }
          current.refreshing = false;
          scheduleSuspendedRefresh(tabId, PROPERTY_CONTEXT_RECOVERY_POLL_MS);
        });
    }, Math.max(0, delayMs));
  };

  const beginSuspendedContext = (
    tabId: number,
    reason: SuspendedContext["reason"],
    request: LockDirectiveRequest,
  ): void => {
    const existing = suspendedContextByTab.get(tabId);
    const qualifies = presenceQualifies(basePresenceForTab(tabId));
    const suspended: SuspendedContext = existing ?? {
      reason,
      request,
      recoveryDeadlineAt: qualifies ? null : now() + PROPERTY_LOCK_SUSPENDED_RECOVERY_GRACE_MS,
      timer: null,
      refreshing: false,
    };
    suspended.reason = reason;
    suspended.request = { ...request, refreshContext: undefined };
    if (!qualifies && suspended.recoveryDeadlineAt === null) {
      suspended.recoveryDeadlineAt = now() + PROPERTY_LOCK_SUSPENDED_RECOVERY_GRACE_MS;
    }
    suspendedContextByTab.set(tabId, suspended);
    const key = activeKeyByTab.get(tabId);
    clients.get(key ?? "")?.clientStatus();
    scheduleSuspendedRefresh(tabId, PROPERTY_CONTEXT_RECOVERY_POLL_MS);
  };

  const mirrorSuspendedDeadline = (tabId: number, state: PropertyLockState): void => {
    const suspended = suspendedContextByTab.get(tabId);
    const value = state.timings.recoveryGraceUntilUtc;
    if (!suspended || !value) {
      return;
    }
    const deadlineAt = Date.parse(value);
    if (Number.isFinite(deadlineAt)) {
      suspended.recoveryDeadlineAt = deadlineAt;
      scheduleSuspendedRefresh(tabId, PROPERTY_CONTEXT_RECOVERY_POLL_MS);
    }
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
      presence: () => presenceForTab(request.tabId),
      hasUnsavedWork: () => unsavedByTab.get(request.tabId) === true,
      onOwnershipTransferred: () => {
        // A rotated/foreign fence is authoritative. Discard draft status before
        // publishing the passive state so no subsequent frame can advertise the
        // previous owner's unsaved work.
        unsavedByTab.set(request.tabId, false);
        unsavedKnownTabs.add(request.tabId);
        return input.onAuthoritativeTransfer?.({
          tabId: request.tabId,
          environmentKey,
          siteId,
        });
      },
      onStateChange: (state) => {
        mirrorSuspendedDeadline(request.tabId, state);
        observeAndPublishClientState(key, request.tabId, siteId, state);
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
        baseUrls.set(key, baseUrl);
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

  async function runDirective(
    request: LockDirectiveRequest,
  ): Promise<ReturnType<typeof lockStateFromState>> {
      const generation = generationByTab.get(request.tabId) ?? 0;
      const context = await contextRuntime.resolve({
        tabId: request.tabId,
        pageUrl: request.pageUrl,
        refresh: request.refreshContext === true,
      });
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
        if (context.status === "suspended_candidate_removed") {
          beginSuspendedContext(request.tabId, "candidate_removed", request);
        } else if (context.status === "suspended_candidate_feed_conflict") {
          beginSuspendedContext(request.tabId, "candidate_feed_conflict", request);
        }
        const activeKey = activeKeyByTab.get(request.tabId);
        const activeClient = activeKey ? clients.get(activeKey) : undefined;
        const suspensionReason = context.status === "suspended_candidate_removed"
          ? "candidate-removed" as const
          : context.status === "suspended_candidate_feed_conflict"
            ? "candidate-feed-conflict" as const
            : undefined;
        const response = lockStateFromState({
          pageUrl: request.pageUrl,
          baseUrl,
          siteId: context.siteId,
          state: suspensionReason ? activeClient?.state() ?? null : null,
          status: blockedStatus,
          ...(suspensionReason ? { blockedReason: suspensionReason } : {}),
        });
        await observeLockState(request.tabId, request.pageUrl, response);
        publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
        return response;
      }
      if (context.status === "unmanaged" || context.siteId === null) {
        clearSuspendedContext(request.tabId);
        clearLocalWarning(request.tabId);
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
      if (context.status === "managed_non_candidate") {
        clearSuspendedContext(request.tabId);
        const activeKey = activeKeyByTab.get(request.tabId);
        const activeClient = activeKey ? clients.get(activeKey) : undefined;
        if (activeKey === key && activeClient?.state().role === "editor") {
          pageUrls.set(key, request.pageUrl);
          baseUrls.set(key, baseUrl);
          const warning = startLocalWarning(request.tabId, {
            kind: "off-candidate",
            key,
            durationMs: PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS,
            target: request,
          });
          activeClient.clientStatus();
          const response = lockStateFromState({
            pageUrl: request.pageUrl,
            baseUrl,
            siteId: context.siteId,
            state: activeClient.state(),
            status: "ok",
            warning,
            now: now(),
          });
          await observeLockState(request.tabId, request.pageUrl, response);
          publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
          return response;
        }
        clearLocalWarning(request.tabId);
        await releaseActiveForTab(request.tabId);
        const response = lockStateFromState({
          pageUrl: request.pageUrl,
          baseUrl,
          siteId: null,
          state: null,
          status: "not_candidate",
        });
        await observeLockState(request.tabId, request.pageUrl, response);
        publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
        return response;
      }
      clearSuspendedContext(request.tabId);
      const previousActiveKey = activeKeyByTab.get(request.tabId);
      if (previousActiveKey && previousActiveKey !== key) {
        const previousClient = clients.get(previousActiveKey);
        if (previousClient) {
          pageUrls.set(previousActiveKey, request.pageUrl);
          baseUrls.set(previousActiveKey, baseUrl);
          const warning = startLocalWarning(request.tabId, {
            kind: "cross-property",
            key: previousActiveKey,
            durationMs: PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
            target: request,
          });
          previousClient.clientStatus();
          const response = lockStateFromState({
            pageUrl: request.pageUrl,
            baseUrl,
            siteId: context.siteId,
            state: previousClient.state(),
            status: "ok",
            warning,
            now: now(),
          });
          await observeLockState(request.tabId, request.pageUrl, response);
          publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
          return response;
        }
      }
      clearLocalWarning(request.tabId);
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
      const previousUnsaved = unsavedByTab.get(request.tabId);
      const nextUnsaved = unsavedKnownTabs.has(request.tabId)
        ? previousUnsaved === true
        : request.refreshContext === true
          ? previousUnsaved === true
          : request.hasUnsavedChanges === true;
      unsavedByTab.set(request.tabId, nextUnsaved);
      pageUrls.set(key, request.pageUrl);
      baseUrls.set(key, baseUrl);
      if (!claimedKeys.has(key)) {
        client.claim();
        claimedKeys.add(key);
      }
      if (previousPageUrl !== request.pageUrl || previousUnsaved !== nextUnsaved) {
        client.clientStatus();
      }
      if (presenceQualifies(presenceForTab(request.tabId))) {
        client.heartbeat();
      }
      const state = client.state();
      const response = lockStateFromState({ pageUrl: request.pageUrl, baseUrl, siteId: context.siteId, state, status: "ok" });
      await observeLockState(request.tabId, request.pageUrl, response);
      publishLockStateIfChanged(`tab:${request.tabId}`, request.tabId, response);
      return response;
  }

  return {
    directive: runDirective,
    action(request: LockActionRequest): Readonly<{ status: "ok" | "unavailable" }> {
      const activeKey = activeKeyByTab.get(request.tabId);
      const client = activeKey ? clients.get(activeKey) : undefined;
      if (!client || client.isClosed()) {
        return { status: "unavailable" };
      }
      switch (request.kind) {
        case "continue-here":
          client.continueEditing(false, request.confirmDiscard === true);
          break;
        case "suggest-takeover":
          client.suggestTakeover();
          break;
        case "accept-takeover":
          if (!request.suggestionId) return { status: "unavailable" };
          client.respondToSuggestion(request.suggestionId, true, request.confirmDiscard === true);
          break;
        case "reject-takeover":
          if (!request.suggestionId) return { status: "unavailable" };
          client.respondToSuggestion(request.suggestionId, false, false);
          break;
        case "take-over":
          client.claim();
          break;
      }
      return { status: "ok" };
    },
    unsavedChanged(tabId: number, value: boolean): void {
      const previous = unsavedByTab.get(tabId);
      unsavedKnownTabs.add(tabId);
      unsavedByTab.set(tabId, value);
      if (previous === value) {
        return;
      }
      const activeKey = activeKeyByTab.get(tabId);
      clients.get(activeKey ?? "")?.clientStatus();
      publishActiveClient(tabId);
    },
    activity(tabId: number, siteId: number): void {
      const activeKey = activeKeyByTab.get(tabId);
      const client = activeKey ? clients.get(activeKey) : undefined;
      if (
        client?.editorSession().siteId === siteId &&
        presenceQualifies(presenceForTab(tabId))
      ) {
        client.activity();
      }
    },
    presenceChanged(tabId: number, presence: PropertyLockPresence): void {
      presenceByTab.set(tabId, presence);
      const suspended = suspendedContextByTab.get(tabId);
      if (suspended) {
        if (presenceQualifies(presence)) {
          suspended.recoveryDeadlineAt = null;
          scheduleSuspendedRefresh(tabId, 0);
        } else {
          suspended.recoveryDeadlineAt ??= now() + PROPERTY_LOCK_SUSPENDED_RECOVERY_GRACE_MS;
          scheduleSuspendedRefresh(tabId, PROPERTY_CONTEXT_RECOVERY_POLL_MS);
        }
      }
      const activeKey = activeKeyByTab.get(tabId);
      const client = activeKey ? clients.get(activeKey) : undefined;
      if (!client || client.isClosed()) {
        return;
      }
      client.clientStatus();
      if (presenceQualifies(presenceForTab(tabId))) {
        client.heartbeat();
      }
    },
    heartbeat(): void {
      for (const client of clients.values()) {
        const session = client.editorSession();
        if (
          !client.isClosed() &&
          presenceQualifies(presenceForTab(session.tabId))
        ) {
          client.heartbeat();
        }
      }
    },
    navigationCommitted(tabId: number): void {
      // Navigation terminates the document draft immediately but keeps the
      // prior lease long enough for same-property/off-candidate and
      // cross-property deadline handling on the next canonical context.
      generationByTab.set(tabId, (generationByTab.get(tabId) ?? 0) + 1);
      const activeKey = activeKeyByTab.get(tabId);
      if (activeKey) {
        unsavedByTab.set(tabId, false);
        unsavedKnownTabs.add(tabId);
      }
      clearSuspendedContext(tabId);
      if (activeKey && clients.has(activeKey)) {
        startLocalWarning(tabId, {
          kind: "cross-property",
          key: activeKey,
          durationMs: PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
        });
      }
      latestLockStates.delete(tabId);
      publishedLockStates.delete(`tab:${tabId}`);
      clients.get(activeKey ?? "")?.clientStatus();
    },
    async terminateTab(
      tabId: number,
      options: Readonly<{ forgetPresence?: boolean }> = {},
    ): Promise<void> {
      generationByTab.set(tabId, (generationByTab.get(tabId) ?? 0) + 1);
      clearSuspendedContext(tabId);
      clearLocalWarning(tabId);
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
      unsavedByTab.delete(tabId);
      unsavedKnownTabs.delete(tabId);
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
      const clientTabId = client?.editorSession().tabId;
      if (
        !client ||
        client.isClosed() ||
        (clientTabId !== undefined && (
          localWarningByTab.has(clientTabId) || suspendedContextByTab.has(clientTabId)
        )) ||
        state?.role !== "editor" ||
        !projectPropertyLockView(state).canEdit ||
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
