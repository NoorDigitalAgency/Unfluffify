import { buildPropertyLockWssUrl, createPropertyLockClient, type LockIdentity, type PropertyLockState, type WebSocketLike } from "../lock";
import {
  createConfigRepo,
  createIndexedDbStore,
  createLockIdentityRepo,
  createMemoryStore,
  createRunRecordRepo,
  createSettingsRepo,
  createTabStateRepo,
} from "../storage";
import { SelectorSetSchema } from "../storage/config";
import type { JsonTransport } from "../lynx";
import { getAiRunResult, getAiRunStatus, startAiRun } from "../lynx/ai";
import { pollAiJob } from "../lynx/ai-job";
import { buildCssInfoRequest, buildUpdateScrapingConditionsRequest, buildUrlSearchInfoRequest, parseUrlSearchInfo } from "../lynx/graphql";
import { loadConfigSnapshot, saveConfigSnapshot } from "../lynx/rest";
import { persistDurableFacts, rehydrateDurableFacts, reDeriveVolatile } from "./persistence";

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
      : current.configEndpoint;
    const url = resolveEndpoint(base, request.path.replace(/^\//, ""));
    if (!url) {
      return { status: 503, body: { error: "endpoint_unconfigured" }, headers: {} };
    }
    const response = await fetch(url, {
      method: request.method,
      headers: {
        "content-type": "application/json",
        ...(current.token ? { authorization: "Bearer " + current.token } : {}),
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
  const settingsStore = createSettingsRepo(store);
  const loadSettings = async (): Promise<EndpointSettings> => {
    const result = await settingsStore.load();
    return result.ok && result.value ? result.value : {};
  };
  const transport = input.transport ?? (async (request) => {
    const currentSettings = await loadSettings();
    return await createFetchJsonTransport(() => currentSettings)(request);
  });

  return {
    repos: {
      tabStateRepo,
      configRepo,
      runRecordRepo,
      lockIdentityRepo,
      settingsStore,
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
        return parsed.notFound
          ? { status: "not_found" as const, siteId: null }
          : { status: "ok" as const, siteId: parsed.siteId };
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
