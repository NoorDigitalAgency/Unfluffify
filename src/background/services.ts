import { buildPropertyLockWssUrl, createPropertyLockClient, type LockIdentity, type PropertyLockState, type WebSocketLike } from "../lock";
import {
  createConfigRepo,
  createIndexedDbStore,
  createLockIdentityRepo,
  createLocalPropertyRepo,
  createMemoryStore,
  createRunRecordRepo,
  createSettingsRepo,
  createTabStateRepo,
} from "../storage";
import { SelectorSetSchema, type ConfigSnapshot } from "../storage/config";
import type { Settings } from "../storage/settings";
import type { RenderMode } from "../domain/schema/property";
import type { JsonTransport } from "../lynx";
import {
  buildAccountsEndpointBase,
  isAccountsPath,
  isUnauthenticatedPath,
  requestAuthLogin,
  validateAuthToken,
} from "../lynx/accounts";
import { getAiRunResult, getAiRunStatus, startAiRun } from "../lynx/ai";
import { withTokenRotation } from "../lynx/token-rotation";
import { pollAiJob } from "../lynx/ai-job";
import { buildCssInfoRequest, buildUpdateScrapingConditionsRequest, buildUrlSearchInfoRequest, parseUrlSearchInfo, readGraphqlErrorCode } from "../lynx/graphql";
import { loadConfigSnapshot, saveConfigSnapshot } from "../lynx/rest";
import { persistDurableFacts, rehydrateDurableFacts, reDeriveVolatile } from "./persistence";

/** The subset createFetchJsonTransport needs to resolve a base URL and auth. */
type EndpointSettings = Readonly<{
  configEndpoint?: string;
  aiEndpoint?: string;
  stageBase?: string;
  token?: string;
}>;

function createBackgroundStore() {
  return typeof globalThis.indexedDB === "undefined"
    ? createMemoryStore()
    : createIndexedDbStore();
}

function resolveEndpoint(base: string | undefined, path: string): string {
  if (!base) {
    return "";
  }
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

function graphqlEndpointBase(stageBase: string | undefined): string | undefined {
  const host = stageBase?.trim();
  return host ? `https://api.${host}` : undefined;
}

export function createFetchJsonTransport(settings: () => EndpointSettings): JsonTransport {
  return async (request) => {
    const current = settings();
    const base = request.path.startsWith("/get_selectors")
      ? current.aiEndpoint
      : request.path === "/graphql"
        ? graphqlEndpointBase(current.stageBase)
        : isAccountsPath(request.path)
          ? buildAccountsEndpointBase(current.stageBase ?? "")
      : current.configEndpoint;
    const url = resolveEndpoint(base, request.path.replace(/^\//, ""));
    if (!url) {
      return { status: 503, body: { error: "endpoint_unconfigured" }, headers: {} };
    }
    const sendToken = current.token && !isUnauthenticatedPath(request.path);
    const response = await fetch(url, {
      method: request.method,
      headers: {
        "content-type": "application/json",
        ...(sendToken ? { authorization: "Bearer " + current.token } : {}),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      headers: Object.fromEntries(response.headers.entries()),
    };
  };
}

function createNoopSocket(): WebSocketLike {
  return {
    send() {},
    close() {},
    addEventListener() {},
  };
}

function createWebSocketSocket(url: string): WebSocketLike {
  if (!url || typeof globalThis.WebSocket !== "function") {
    return createNoopSocket();
  }
  return new globalThis.WebSocket(url);
}

export function createRewriteBackgroundServices(input: Readonly<{
  transport?: JsonTransport;
  socket?: WebSocketLike;
  socketFactory?: (url: string) => WebSocketLike;
}> = {}) {
  const store = createBackgroundStore();
  const tabStateRepo = createTabStateRepo(store);
  const configRepo = createConfigRepo(store);
  const runRecordRepo = createRunRecordRepo(store);
  const lockIdentityRepo = createLockIdentityRepo(store);
  const localPropertyRepo = createLocalPropertyRepo(store);
  const settingsStore = createSettingsRepo(store);
  const loadSettings = async (): Promise<Settings> => {
    const result = await settingsStore.load();
    return result.ok && result.value ? result.value : {};
  };
  /** Settings are read-modify-written from several places (an endpoint save, a
   *  login, a silent token rotation). Serializing them keeps a concurrent pair
   *  from each reading the same baseline and one losing the other's field. */
  let settingsWrites: Promise<unknown> = Promise.resolve();
  const updateSettings = (mutate: (current: Settings) => Settings): Promise<Settings> => {
    const run = async (): Promise<Settings> => {
      const next = mutate(await loadSettings());
      await settingsStore.save(next);
      return next;
    };
    const queued = settingsWrites.then(run, run);
    settingsWrites = queued.catch(() => undefined);
    return queued;
  };
  const baseTransport = input.transport ?? (async (request) => {
    const currentSettings = await loadSettings();
    return await createFetchJsonTransport(() => currentSettings)(request);
  });
  const transport = withTokenRotation(baseTransport, {
    currentToken: async () => (await loadSettings()).token ?? "",
    persistToken: async (token) => {
      await updateSettings((current) => ({ ...current, token }));
    },
    onPersistError: (error) => {
      console.error("[Unfluffify][rewrite] Unable to persist a rotated token", error);
    },
  });

  return {
    repos: {
      tabStateRepo,
      configRepo,
      runRecordRepo,
      lockIdentityRepo,
      localPropertyRepo,
      settingsStore,
    },
    property: {
      /** Applies the backend-authority rule to a load outcome.
       *
       *  A 200 and a 404 are both answers, so both remove local property data;
       *  the render mode survives a 404 only, because until a configuration
       *  exists there is nowhere else for the operator's choice to live. A
       *  transport or auth failure is not an answer — it says nothing about what
       *  the backend holds, so it must leave local data exactly as it was. */
      async applyBackendLoad(siteId: number, outcome: Readonly<{
        status: "ok" | "auth_error" | "not_found" | "error";
        config?: ConfigSnapshot;
      }>) {
        if (outcome.status === "auth_error" || outcome.status === "error") {
          const existing = await localPropertyRepo.load(siteId);
          return {
            renderMode: existing.ok ? existing.value?.renderMode : undefined,
            source: "local" as const,
          };
        }
        // Both answers invalidate the local mirror of the configuration.
        await configRepo.clear(siteId);
        if (outcome.status === "ok") {
          await localPropertyRepo.save({
            siteId,
            backendConfigPresent: true,
            updatedAt: new Date().toISOString(),
          });
          return { renderMode: outcome.config?.renderMode, source: "backend" as const };
        }
        const existing = await localPropertyRepo.load(siteId);
        const keptRenderMode = existing.ok ? existing.value?.renderMode : undefined;
        await localPropertyRepo.save({
          siteId,
          backendConfigPresent: false,
          ...(keptRenderMode ? { renderMode: keptRenderMode } : {}),
          updatedAt: new Date().toISOString(),
        });
        return { renderMode: keptRenderMode, source: "local" as const };
      },
      /** The backend now holds the configuration, so the local copy has served
       *  its purpose and must go. */
      async applyBackendSave(siteId: number) {
        await configRepo.clear(siteId);
        await localPropertyRepo.save({
          siteId,
          backendConfigPresent: true,
          updatedAt: new Date().toISOString(),
        });
      },
      /** Refused when the backend already has a configuration for the property:
       *  local storage is only permitted while it does not. */
      async rememberRenderMode(siteId: number, renderMode: RenderMode) {
        const existing = await localPropertyRepo.load(siteId);
        if (existing.ok && existing.value?.backendConfigPresent) {
          return { stored: false as const, reason: "backend-config-present" as const };
        }
        await localPropertyRepo.save({
          siteId,
          backendConfigPresent: false,
          renderMode,
          updatedAt: new Date().toISOString(),
        });
        return { stored: true as const };
      },
    },
    settings: {
      load: loadSettings,
      /** The only safe way to write settings: every writer shares one queue. */
      update: updateSettings,
    },
    persistence: {
      persistDurableFacts: (facts: Parameters<typeof persistDurableFacts>[1]) =>
        persistDurableFacts(tabStateRepo, facts),
      rehydrateDurableFacts: (tabId: number) =>
        rehydrateDurableFacts(tabStateRepo, tabId).then((facts) => facts ? reDeriveVolatile(facts) : null),
    },
    lynx: {
      loadConfigSnapshot: (siteId: number) => loadConfigSnapshot(transport, siteId),
      saveConfigSnapshot: (snapshot: Parameters<typeof saveConfigSnapshot>[1]) => saveConfigSnapshot(transport, snapshot),
      startAiRun: (snapshot: Parameters<typeof startAiRun>[1]) => startAiRun(transport, snapshot),
      getAiRunStatus: (sessionId: string) => getAiRunStatus(transport, sessionId),
      getAiRunResult: (sessionId: string) => getAiRunResult(transport, sessionId),
      async getSiteIdForUrl(url: string) {
        let response;
        try {
          response = await transport({
            method: "POST",
            path: "/graphql",
            body: buildUrlSearchInfoRequest(url),
          });
        } catch {
          return { status: "network_error" as const, siteId: null };
        }
        if (response.status < 200 || response.status >= 300) {
          return { status: "network_error" as const, siteId: null };
        }
        const parsed = parseUrlSearchInfo(response.body);
        if (parsed.notFound) {
          return { status: "not_found" as const, siteId: null };
        }
        if (parsed.siteId !== null) {
          return { status: "ok" as const, siteId: parsed.siteId };
        }
        // No site id and no explicit NotFound. A GraphQL error envelope here
        // (an expired token answers 200 + UNAUTHENTICATED) is a fault, and
        // reporting it as "not a managed property" sends the operator looking
        // at the wrong thing entirely.
        return readGraphqlErrorCode(response.body)
          ? { status: "network_error" as const, siteId: null }
          : { status: "not_found" as const, siteId: null };
      },
      async runAiJob(snapshot: Parameters<typeof startAiRun>[1]) {
        const started = await startAiRun(transport, snapshot);
        if (started.status !== "ok") {
          return started;
        }
        const startedAt = Date.now();
        await runRecordRepo.save({
          sessionId: started.sessionId,
          tabId: 0,
          phase: "running",
          startedAt,
          updatedAt: startedAt,
          deadlineAt: startedAt + 480_000,
        });
        const polled = await pollAiJob(started.sessionId, {
          now: Date.now,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          getStatus: (sessionId) => getAiRunStatus(transport, sessionId),
          getResult: (sessionId) => getAiRunResult(transport, sessionId),
          heartbeat: (state) => runRecordRepo.save({
            sessionId: state.sessionId,
            tabId: 0,
            phase: state.phase,
            startedAt,
            updatedAt: state.updatedAt,
            deadlineAt: state.deadlineAt,
          }),
          acquireComputeLock: async () => () => undefined,
        });
        if (polled.status === "fresh") {
          const selectors = SelectorSetSchema.parse(polled.selectors);
          await runRecordRepo.save({
            sessionId: started.sessionId,
            tabId: 0,
            phase: "fresh",
            startedAt,
            updatedAt: Date.now(),
          });
          return { status: "ok" as const, sessionId: started.sessionId, selectors };
        }
        await runRecordRepo.save({
          sessionId: started.sessionId,
          tabId: 0,
          phase: "failed",
          startedAt,
          updatedAt: Date.now(),
          error: polled.status,
        });
        return { status: polled.status, sessionId: started.sessionId };
      },
      buildUrlSearchInfoRequest,
      buildCssInfoRequest,
      buildUpdateScrapingConditionsRequest,
    },
    accounts: {
      /** On success the JWT is persisted here rather than returned to the
       *  caller — the popup never needs to hold the credential. */
      async login(credentials: Readonly<{ email: string; password: string }>) {
        const result = await requestAuthLogin(transport, credentials);
        if (result.status !== "ok") {
          return result;
        }
        // Queued behind any rotation the login response itself triggered, so the
        // freshly issued token is the one that lands last.
        await updateSettings((current) => ({ ...current, token: result.token }));
        return result;
      },
      async logout() {
        await updateSettings(({ token: _discarded, ...withoutToken }) => withoutToken);
      },
      async validate() {
        const current = await loadSettings();
        return await validateAuthToken(transport, {
          hasToken: Boolean(current.token?.trim()),
        });
      },
    },
    async createLockClient(inputContext: Readonly<{
      tabId: number;
      siteId: number;
      pageUrl: string;
      hasUnsavedChanges?: () => boolean;
      onStateChange?: (state: PropertyLockState) => void;
    }>) {
      const loadedIdentity = await lockIdentityRepo.load(inputContext.tabId, inputContext.siteId);
      const currentSettings = await loadSettings();
      const wsUrl = buildPropertyLockWssUrl(currentSettings.configEndpoint ?? currentSettings.stageBase ?? "", currentSettings.token ?? "");
      const socket = input.socket ?? (input.socketFactory ?? createWebSocketSocket)(wsUrl);
      return createPropertyLockClient({
        socket,
        tabId: inputContext.tabId,
        siteId: inputContext.siteId,
        pageUrl: inputContext.pageUrl,
        identity: loadedIdentity.ok && loadedIdentity.value
          ? {
            tabId: loadedIdentity.value.tabId,
            siteId: loadedIdentity.value.siteId,
            identity: loadedIdentity.value.identity,
            updatedAt: loadedIdentity.value.updatedAt,
          } satisfies LockIdentity
          : null,
        hasUnsavedChanges: inputContext.hasUnsavedChanges,
        onStateChange: inputContext.onStateChange,
        persistIdentity(identity) {
          return lockIdentityRepo.save({
            ...identity,
            issuedAt: identity.updatedAt,
          });
        },
      });
    },
  };
}

export type RewriteBackgroundServices = ReturnType<typeof createRewriteBackgroundServices>;
