import {
  buildPropertyLockWssUrl,
  createPropertyLockClient,
  type EditorSession,
  type PropertyLockPresence,
  type PropertyLockState,
  type WebSocketLike,
} from "../lock";
import {
  createConfigRepo,
  createIndexedDbStore,
  createEditorSessionRepo,
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
import { resolvePropertyContext } from "../lynx/context";
import { withTokenRotation } from "../lynx/token-rotation";
import { pollAiJob } from "../lynx/ai-job";
import { loadConfigSnapshot, publishConfigSnapshot, saveConfigSnapshot } from "../lynx/rest";
import { persistDurableFacts, rehydrateDurableFacts, reDeriveVolatile } from "./persistence";
import {
  adoptAuthoritativeSnapshot,
  normalizeEnvironmentKey,
  overlayLivePageOnAuthoritativeCorpus,
} from "../storage/property-snapshot-authority";

export type AiRunContext = Readonly<{
  tabId: number;
  clientRunId: string;
  environmentKey: string;
  siteId: number;
  pageKey: string;
}>;

export type AiRunScope = Readonly<Pick<AiRunContext, "tabId" | "environmentKey" | "siteId" | "pageKey">>;

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
  editorSessionIdFactory?: () => string;
}> = {}) {
  const store = createBackgroundStore();
  const tabStateRepo = createTabStateRepo(store);
  const configRepo = createConfigRepo(store);
  const runRecordRepo = createRunRecordRepo(store);
  const editorSessionRepo = createEditorSessionRepo(store);
  const localPropertyRepo = createLocalPropertyRepo(store);
  const settingsStore = createSettingsRepo(store);
  const loadSettings = async (): Promise<Settings> => {
    const result = await settingsStore.load();
    return result.ok && result.value ? result.value : {};
  };
  const currentEnvironmentKey = async (): Promise<string | null> =>
    normalizeEnvironmentKey((await loadSettings()).stageBase);
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
      editorSessionRepo,
      localPropertyRepo,
      settingsStore,
    },
    property: {
      /** Applies the backend-authority rule to a load outcome.
       *
       *  A validated 200 atomically replaces the durable full-corpus baseline.
       *  A 404 clears it, retaining only the documented local render-mode
       *  exception. A transport, auth, or validation failure is not an
       *  authoritative answer and therefore leaves durable state untouched. */
      async applyBackendLoad(environmentKey: string, siteId: number, outcome: Readonly<{
        status: "ok" | "auth_error" | "not_found" | "invalid" | "error";
        config?: ConfigSnapshot;
      }>) {
        if (outcome.status === "auth_error" || outcome.status === "invalid" || outcome.status === "error") {
          const existing = await localPropertyRepo.load(environmentKey, siteId);
          return {
            renderMode: existing.ok ? existing.value?.renderMode : undefined,
            source: "local" as const,
          };
        }
        if (outcome.status === "ok") {
          const stored = await configRepo.load(environmentKey, siteId);
          const adopted = adoptAuthoritativeSnapshot(
            stored.ok ? stored.value : null,
            outcome.config,
            { environmentKey, siteId },
          );
          await configRepo.save(adopted);
          await localPropertyRepo.save({
            environmentKey,
            siteId,
            backendConfigPresent: true,
            updatedAt: new Date().toISOString(),
          });
          return { renderMode: adopted.renderMode, source: "backend" as const };
        }
        await configRepo.clear(environmentKey, siteId);
        const existing = await localPropertyRepo.load(environmentKey, siteId);
        const keptRenderMode = existing.ok ? existing.value?.renderMode : undefined;
        await localPropertyRepo.save({
          environmentKey,
          siteId,
          backendConfigPresent: false,
          ...(keptRenderMode ? { renderMode: keptRenderMode } : {}),
          updatedAt: new Date().toISOString(),
        });
        return { renderMode: keptRenderMode, source: "local" as const };
      },
      /** A validated successful save response atomically replaces the durable
       *  background baseline. Any unexplained shrink throws before storage. */
      async applyBackendSave(environmentKey: string, siteId: number, snapshot: ConfigSnapshot) {
        const stored = await configRepo.load(environmentKey, siteId);
        const adopted = adoptAuthoritativeSnapshot(
          stored.ok ? stored.value : null,
          snapshot,
          { environmentKey, siteId },
        );
        await configRepo.save(adopted);
        await localPropertyRepo.save({
          environmentKey,
          siteId,
          backendConfigPresent: true,
          updatedAt: new Date().toISOString(),
        });
        return adopted;
      },
      async overlayAiCorpus(environmentKey: string, siteId: number, live: Parameters<typeof overlayLivePageOnAuthoritativeCorpus>[1]) {
        const stored = await configRepo.load(environmentKey, siteId);
        return overlayLivePageOnAuthoritativeCorpus(stored.ok ? stored.value : null, live);
      },
      /** Refused when the backend already has a configuration for the property:
       *  local storage is only permitted while it does not. */
      async rememberRenderMode(environmentKey: string, siteId: number, renderMode: RenderMode) {
        const existing = await localPropertyRepo.load(environmentKey, siteId);
        if (existing.ok && existing.value?.backendConfigPresent) {
          return { stored: false as const, reason: "backend-config-present" as const };
        }
        await localPropertyRepo.save({
          environmentKey,
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
      currentEnvironmentKey,
      loadConfigSnapshot: (environmentKey: string, siteId: number) => loadConfigSnapshot(transport, environmentKey, siteId),
      saveConfigSnapshot: (request: Parameters<typeof saveConfigSnapshot>[1]) => saveConfigSnapshot(transport, request),
      publishConfigSnapshot: (request: Parameters<typeof publishConfigSnapshot>[1]) => publishConfigSnapshot(transport, request),
      startAiRun: (snapshot: Parameters<typeof startAiRun>[1]) => startAiRun(transport, snapshot),
      getAiRunStatus: (sessionId: string) => getAiRunStatus(transport, sessionId),
      getAiRunResult: (sessionId: string) => getAiRunResult(transport, sessionId),
      resolvePropertyContext: (environmentKey: string, url: string) =>
        resolvePropertyContext(transport, environmentKey, url),
      async runAiJob(snapshot: Parameters<typeof startAiRun>[1], context: AiRunContext) {
        const started = await startAiRun(transport, snapshot);
        if (started.status !== "ok") {
          return started;
        }
        const startedAt = Date.now();
        const recordScope = {
          sessionId: started.sessionId,
          tabId: context.tabId,
          clientRunId: context.clientRunId,
          environmentKey: context.environmentKey,
          siteId: context.siteId,
          pageKey: context.pageKey,
          startedAt,
        };
        await runRecordRepo.save({
          ...recordScope,
          phase: "running",
          updatedAt: startedAt,
          deadlineAt: startedAt + 480_000,
        }, { makeLatest: true });
        const polled = await pollAiJob(started.sessionId, {
          now: Date.now,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          getStatus: (sessionId) => getAiRunStatus(transport, sessionId),
          getResult: (sessionId) => getAiRunResult(transport, sessionId),
          heartbeat: (state) => runRecordRepo.save({
            ...recordScope,
            sessionId: state.sessionId,
            phase: state.phase,
            updatedAt: state.updatedAt,
            deadlineAt: state.deadlineAt,
          }),
          acquireComputeLock: async () => () => undefined,
        });
        if (polled.status === "fresh") {
          const selectors = SelectorSetSchema.parse(polled.selectors);
          await runRecordRepo.save({
            ...recordScope,
            phase: "fresh",
            updatedAt: Date.now(),
            selectors,
          });
          return { status: "ok" as const, sessionId: started.sessionId, selectors };
        }
        await runRecordRepo.save({
          ...recordScope,
          phase: "failed",
          updatedAt: Date.now(),
          error: polled.status,
        });
        return { status: polled.status, sessionId: started.sessionId };
      },
      /** Returns only the newest run for the exact property/page scope. The
       * environment and site id are authoritative; the URL origin never
       * participates in identity. */
      async resumeAiJob(scope: AiRunScope) {
        const loaded = await runRecordRepo.loadLatestForTab(scope.tabId);
        if (!loaded.ok) {
          return { status: "invalid" as const };
        }
        const record = loaded.value;
        if (
          !record ||
          record.environmentKey !== scope.environmentKey ||
          record.siteId !== scope.siteId ||
          record.pageKey !== scope.pageKey ||
          !record.clientRunId
        ) {
          return { status: "not_found" as const };
        }
        const common = {
          sessionId: record.sessionId,
          clientRunId: record.clientRunId,
          deadlineAt: record.deadlineAt,
        };
        if (record.phase === "fresh") {
          return record.selectors
            ? { status: "fresh" as const, ...common, selectors: record.selectors }
            : { status: "invalid" as const };
        }
        if (record.phase === "running") {
          return { status: "running" as const, ...common };
        }
        return {
          status: record.phase === "failed" ? "failed" as const : "stale" as const,
          ...common,
          error: record.error,
        };
      },
    },
    accounts: {
      /** Whether a token is stored at all. Answered from the settings store
       *  with no round-trip, so callers that need auth can decline to ask the
       *  backend a question it will only refuse. */
      async hasToken(): Promise<boolean> {
        return Boolean((await loadSettings()).token?.trim());
      },
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
      environmentKey: string;
      tabId: number;
      siteId: number;
      presence?: () => PropertyLockPresence;
      hasUnsavedWork?: () => boolean;
      onStateChange?: (state: PropertyLockState) => void;
    }>) {
      const loadedSession = await editorSessionRepo.load(
        inputContext.environmentKey,
        inputContext.tabId,
        inputContext.siteId,
      );
      const now = Date.now();
      const editorSession: EditorSession = loadedSession.ok && loadedSession.value
        ? loadedSession.value
        : {
            environmentKey: inputContext.environmentKey,
            tabId: inputContext.tabId,
            siteId: inputContext.siteId,
            editorSessionId: input.editorSessionIdFactory?.() ?? globalThis.crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
          };
      if (!loadedSession.ok || !loadedSession.value) {
        await editorSessionRepo.save(editorSession);
      }
      const currentSettings = await loadSettings();
      const wsUrl = buildPropertyLockWssUrl(currentSettings.configEndpoint ?? currentSettings.stageBase ?? "", currentSettings.token ?? "");
      const socket = input.socket ?? (input.socketFactory ?? createWebSocketSocket)(wsUrl);
      return createPropertyLockClient({
        socket,
        editorSession,
        presence: inputContext.presence,
        hasUnsavedWork: inputContext.hasUnsavedWork,
        onStateChange: inputContext.onStateChange,
        persistEditorSession(session) {
          return editorSessionRepo.save(session);
        },
        async onTokenUpdate(token) {
          await updateSettings((current) => ({ ...current, token }));
        },
      });
    },
  };
}

export type RewriteBackgroundServices = ReturnType<typeof createRewriteBackgroundServices>;
