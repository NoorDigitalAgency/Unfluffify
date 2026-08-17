import { projectPropertyLockView, type PropertyLockState } from "../lock";
import type { RewriteBackgroundServices } from "./services";
import { createRealmBus, type LockStatus } from "../messaging/realms";
import { createTabTransport } from "../messaging/transports/tabs";

export type LockDirectiveRequest = Readonly<{
  tabId: number;
  pageUrl: string;
  baseUrl?: string;
  siteId?: number | null;
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
const NO_LOCK_STATE_TEXT: Readonly<Record<LockStatus, string>> = {
  ok: "Property lock connecting",
  not_configured: "Property lock not configured",
  not_candidate: "Not a managed property",
  signed_out: "Sign in to use the property lock",
  unavailable: "Property lock unavailable",
};

function directiveFromState(input: Readonly<{
  pageUrl: string;
  baseUrl: string;
  siteId: number | null;
  state: PropertyLockState | null;
  status: LockStatus;
}>) {
  const view = input.state
    ? projectPropertyLockView(input.state)
    : { bannerVisible: true, text: NO_LOCK_STATE_TEXT[input.status], canEdit: false };
  const lockRole = input.state?.role ?? "unknown";
  const blockedReason = view.canEdit
    ? ""
    : input.status === "not_candidate"
      ? "not-candidate"
      : input.status === "signed_out"
        ? "signed-out"
        : "property-lock";
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
    siteId: input.siteId,
    lockRole,
    ...(authority ? { authority } : {}),
    lockBanner: {
      visible: view.bannerVisible,
      text: view.text,
      ...(view.countdownSeconds === undefined ? {} : { countdownSeconds: view.countdownSeconds }),
    },
    directive: {
      baseUrl: input.baseUrl,
      configPresent: input.status === "ok" && input.siteId !== null,
      lockRole,
      reconciliationPending: false,
      content: {
        markingEditsBlocked: !view.canEdit,
        blockedReason,
        curtain: { visible: !view.canEdit, text: view.text || "Property locked" },
        banner: { visible: view.bannerVisible, text: view.text },
        blockOwner: "lock" as const,
      },
    },
  };
}

export function createPropertyLockRuntime(input: Readonly<{
  services: RewriteBackgroundServices;
  tabs?: TabsLike;
  observeLockFacts?: (facts: Readonly<{ tabId: number; siteId: number | null; baseUrl: string; pageUrl: string; lockRole: "unknown" | "editor" | "passive"; configPresent: boolean }>) => void;
}>) {
  const clients = new Map<string, LockClient>();
  const pageUrls = new Map<string, string>();
  const unsavedByKey = new Map<string, boolean>();
  const claimedKeys = new Set<string>();
  const publishedDirectives = new Map<string, string>();
  const activeKeyByTab = new Map<number, string>();
  const siteCache = new Map<string, Readonly<{ status: "ok" | "network_error" | "not_found"; siteId: number | null }>>();

  const publishDirective = async (tabId: number, directive: unknown): Promise<void> => {
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
        name: "directive.content",
        tabId,
        payload: directive,
      }, { target: "content" });
    } finally {
      bus.dispose();
    }
  };

  const publishDirectiveIfChanged = (key: string, tabId: number, directive: unknown): void => {
    const serialized = JSON.stringify(directive);
    if (publishedDirectives.get(key) === serialized) {
      return;
    }
    publishedDirectives.set(key, serialized);
    void publishDirective(tabId, directive);
  };

  const releaseKey = (key: string): void => {
    clients.get(key)?.close();
    clients.delete(key);
    pageUrls.delete(key);
    unsavedByKey.delete(key);
    claimedKeys.delete(key);
    publishedDirectives.delete(key);
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
        const response = directiveFromState({ pageUrl, baseUrl, siteId, state, status: "ok" });
        input.observeLockFacts?.({
          tabId: request.tabId,
          siteId,
          baseUrl,
          pageUrl,
          lockRole: state.role,
          configPresent: true,
        });
        publishDirectiveIfChanged(key, request.tabId, response.directive);
      },
    });
    clients.set(key, client);
    pageUrls.set(key, request.pageUrl);
    return client;
  };

  return {
    async directive(request: LockDirectiveRequest) {
      const baseUrl = request.baseUrl ?? baseUrlFor(request.pageUrl);
      // Resolving a site id needs an authenticated call, and the lock socket
      // authenticates with the same token. With none stored there is nothing to
      // ask, so asking anyway would spend a request per page activation to be
      // told what is already known — and would surface as a connection fault.
      // Any lock held before signing out is released here.
      if (!await input.services.accounts.hasToken()) {
        releaseActiveForTab(request.tabId);
        return directiveFromState({ pageUrl: request.pageUrl, baseUrl, siteId: null, state: null, status: "signed_out" });
      }
      const siteCacheKey = `${request.tabId}:${request.pageUrl}`;
      const cachedSite = siteCache.get(siteCacheKey);
      const resolvedSite = request.siteId === undefined
        ? cachedSite ?? await input.services.lynx.getSiteIdForUrl(request.pageUrl)
        : { status: "ok" as const, siteId: request.siteId };
      if (!cachedSite && request.siteId === undefined && resolvedSite.status !== "network_error") {
        for (const key of siteCache.keys()) {
          if (key.startsWith(`${request.tabId}:`) && key !== siteCacheKey) {
            siteCache.delete(key);
          }
        }
        siteCache.set(siteCacheKey, resolvedSite);
      }
      if (resolvedSite.status === "network_error") {
        activeKeyByTab.delete(request.tabId);
        return directiveFromState({ pageUrl: request.pageUrl, baseUrl, siteId: null, state: null, status: "unavailable" });
      }
      if (resolvedSite.siteId === null) {
        releaseActiveForTab(request.tabId);
        return directiveFromState({ pageUrl: request.pageUrl, baseUrl, siteId: null, state: null, status: "not_candidate" });
      }
      const key = `${request.tabId}:${resolvedSite.siteId}`;
      releaseActiveForTab(request.tabId, key);
      activeKeyByTab.set(request.tabId, key);
      const client = await getOrCreateClient(request, resolvedSite.siteId, baseUrl);
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
      input.observeLockFacts?.({
        tabId: request.tabId,
        siteId: resolvedSite.siteId,
        baseUrl,
        pageUrl: request.pageUrl,
        lockRole: state.role,
        configPresent: true,
      });
      return directiveFromState({ pageUrl: request.pageUrl, baseUrl, siteId: resolvedSite.siteId, state, status: "ok" });
    },
    activity(tabId: number, siteId: number): void {
      clients.get(`${tabId}:${siteId}`)?.activity();
    },
  };
}
