import {
  buildPropertyLockWssUrl,
  checkNetworkReachability,
  createPropertyLockClient,
  type EditorSession,
  type PropertyLockPresence,
  type PropertyLockState,
  type WebSocketLike,
} from "../lock";
import {
  createConfigRepo,
  createDefaultStore,
  createEditorSessionRepo,
  createLocalPropertyRepo,
  createRenderInspectionRepo,
  createRunRecordRepo,
  createSettingsRepo,
  createShieldPostureRepo,
  createTabStateRepo,
  type KeyValueStore,
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
import { AI_RUN_TIMEOUT_MS, getAiRunResult, getAiRunStatus, startAiRun } from "../lynx/ai";
import { resolvePropertyContext } from "../lynx/context";
import { withTokenRotation } from "../lynx/token-rotation";
import { pollAiJob } from "../lynx/ai-job";
import { loadConfigSnapshot, publishConfigSnapshot, saveConfigSnapshot } from "../lynx/rest";
import { persistDurableFacts, rehydrateDurableFacts, reDeriveVolatile } from "./persistence";
import {
  assessAuthoritativeSnapshot,
  normalizeEnvironmentKey,
  overlayLivePageOnAuthoritativeCorpus,
} from "../storage/property-snapshot-authority";

export type AiRunContext = Readonly<{
  tabId: number;
  clientRunId: string;
  editorSessionId: string;
  environmentKey: string;
  siteId: number;
  pageKey: string;
}>;

export type AiRunScope = Readonly<AiRunContext>;

/** The subset createFetchJsonTransport needs to resolve a base URL and auth. */
type EndpointSettings = Readonly<{
  configEndpoint?: string;
  aiEndpoint?: string;
  stageBase?: string;
  token?: string;
}>;

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

export const JSON_REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_DIAGNOSTIC_LENGTH = 512;

function boundedDiagnostic(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_JSON_DIAGNOSTIC_LENGTH);
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
    if (request.signal?.aborted) {
      return {
        status: 0,
        body: { error: "request_cancelled" },
        headers: {},
        transportFailure: { kind: "cancelled", message: "The request was cancelled." },
      };
    }
    const controller = new AbortController();
    const startedAt = Date.now();
    const deadlineAt = Math.min(
      request.deadlineAt ?? Number.POSITIVE_INFINITY,
      startedAt + JSON_REQUEST_TIMEOUT_MS,
    );
    if (deadlineAt <= startedAt) {
      return {
        status: 0,
        body: { error: "request_timeout" },
        headers: {},
        transportFailure: { kind: "timeout", message: "The request timed out." },
      };
    }
    let timedOut = false;
    const onCallerAbort = (): void => controller.abort();
    request.signal?.addEventListener("abort", onCallerAbort, { once: true });
    const timeoutHandle = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.min(0x7fff_ffff, Math.max(1, deadlineAt - startedAt)));
    const sendToken = current.token && !isUnauthenticatedPath(request.path);
    try {
      const response = await fetch(url, {
        method: request.method,
        headers: {
          "content-type": "application/json",
          ...(sendToken ? { authorization: "Bearer " + current.token } : {}),
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      const text = await response.text();
      const headers = Object.fromEntries(response.headers.entries());
      if (!text.trim()) {
        return { status: response.status, body: null, headers };
      }
      try {
        return { status: response.status, body: JSON.parse(text), headers };
      } catch {
        const diagnostic = boundedDiagnostic(text);
        return {
          status: response.status,
          body: { error: "The service returned an unreadable response." },
          headers,
          transportFailure: {
            kind: "invalid_response",
            message: "The service returned an unreadable response.",
            ...(diagnostic ? { diagnostic } : {}),
          },
        };
      }
    } catch {
      const kind = timedOut ? "timeout" : request.signal?.aborted ? "cancelled" : "network";
      const message = kind === "timeout"
        ? "The request timed out."
        : kind === "cancelled"
          ? "The request was cancelled."
          : "The service could not be reached.";
      return {
        status: 0,
        body: { error: `request_${kind}` },
        headers: {},
        transportFailure: { kind, message },
      };
    } finally {
      globalThis.clearTimeout(timeoutHandle);
      request.signal?.removeEventListener("abort", onCallerAbort);
    }
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
  networkReachability?: () => Promise<boolean>;
  editorSessionIdFactory?: () => string;
  store?: KeyValueStore;
}> = {}) {
  const store = input.store ?? createDefaultStore();
  const tabStateRepo = createTabStateRepo(store);
  const configRepo = createConfigRepo(store);
  const runRecordRepo = createRunRecordRepo(store);
  const renderInspectionRepo = createRenderInspectionRepo(store);
  const shieldPostureRepo = createShieldPostureRepo(store);
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
  /** Property authority transitions are read-modify-write operations spanning
   *  the config and local-property repositories. Keep a queue per property so
   *  independent sites remain parallel while same-property loads, saves, and
   *  render-mode choices cannot overwrite one another from a shared baseline. */
  const propertyOperations = new Map<string, Promise<unknown>>();
  const withPropertyOperation = <T>(
    environmentKey: string,
    siteId: number,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const key = `${environmentKey.trim().toLowerCase()}:${siteId}`;
    const previous = propertyOperations.get(key) ?? Promise.resolve();
    const queued = previous.then(operation, operation);
    const tail = queued.then(() => undefined, () => undefined);
    propertyOperations.set(key, tail);
    void tail.finally(() => {
      if (propertyOperations.get(key) === tail) {
        propertyOperations.delete(key);
      }
    });
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
  type DurableAiScope = Readonly<{
    sessionId: string;
    tabId: number;
    clientRunId: string;
    editorSessionId: string;
    environmentKey: string;
    siteId: number;
    pageKey: string;
    startedAt: number;
    deadlineAt: number;
  }>;
  const aiContinuations = new Map<string, Promise<Awaited<ReturnType<typeof pollAiJob>>>>();
  const continueAiJob = (scope: DurableAiScope) => {
    const existing = aiContinuations.get(scope.sessionId);
    if (existing) {
      return existing;
    }
    const remainingMs = Math.max(1, scope.deadlineAt - Date.now());
    const continuation = pollAiJob(scope.sessionId, {
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      getStatus: (sessionId) => getAiRunStatus(transport, sessionId, { deadlineAt: scope.deadlineAt }),
      getResult: (sessionId) => getAiRunResult(transport, sessionId, { deadlineAt: scope.deadlineAt }),
      heartbeat: (state) => runRecordRepo.save({
        ...scope,
        sessionId: state.sessionId,
        phase: "running",
        updatedAt: state.updatedAt,
        deadlineAt: state.deadlineAt,
      }),
      acquireComputeLock: async () => () => undefined,
    }, { timeoutMs: remainingMs }).then(async (polled) => {
      if (polled.status === "fresh") {
        const selectors = SelectorSetSchema.parse(polled.selectors);
        await runRecordRepo.save({
          ...scope,
          phase: "fresh",
          updatedAt: Date.now(),
          selectors,
        });
        return { ...polled, selectors };
      }
      await runRecordRepo.save({
        ...scope,
        phase: "failed",
        updatedAt: Date.now(),
        error: polled.reason,
        failureStage: polled.failureStage,
        reason: polled.reason,
      });
      return polled;
    }).catch(async (_error: unknown) => {
      await runRecordRepo.save({
        ...scope,
        phase: "failed",
        updatedAt: Date.now(),
        error: "continuation_transport_error",
        failureStage: "transport",
        reason: "continuation_transport_error",
      });
      return {
        status: "error" as const,
        polls: 0,
        failureStage: "transport" as const,
        reason: "continuation_transport_error",
      };
    }).finally(() => {
      if (aiContinuations.get(scope.sessionId) === continuation) {
        aiContinuations.delete(scope.sessionId);
      }
    });
    aiContinuations.set(scope.sessionId, continuation);
    return continuation;
  };

  return {
    repos: {
      tabStateRepo,
      configRepo,
      runRecordRepo,
      renderInspectionRepo,
      shieldPostureRepo,
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
      applyBackendLoad(environmentKey: string, siteId: number, outcome: Readonly<{
        status: "ok" | "auth_error" | "not_found" | "invalid" | "error";
        config?: ConfigSnapshot;
      }>) {
        return withPropertyOperation(environmentKey, siteId, async () => {
          if (outcome.status === "auth_error" || outcome.status === "invalid" || outcome.status === "error") {
            const existing = await localPropertyRepo.load(environmentKey, siteId);
            return {
              renderMode: existing.ok ? existing.value?.renderMode : undefined,
              ...(existing.ok && existing.value?.pendingRenderModeDraft
                ? { pendingRenderMode: existing.value.pendingRenderModeDraft.renderMode }
                : {}),
              source: "local" as const,
            };
          }
          if (outcome.status === "ok") {
            const stored = await configRepo.load(environmentKey, siteId);
            const existingLocal = await localPropertyRepo.load(environmentKey, siteId);
            const adoption = assessAuthoritativeSnapshot(
              stored.ok ? stored.value : null,
              outcome.config,
              { environmentKey, siteId },
            );
            const draft = existingLocal.ok ? existingLocal.value?.pendingRenderModeDraft : undefined;
            const retainedDraft = draft &&
              draft.basePropertyRevision === adoption.snapshot.propertyRevision &&
              draft.baseRenderModeUpdatedAt === adoption.snapshot.renderModeUpdatedAt
              ? draft
              : undefined;
            await configRepo.save(adoption.snapshot);
            await localPropertyRepo.save({
              environmentKey,
              siteId,
              backendConfigPresent: true,
              ...(retainedDraft ? { pendingRenderModeDraft: retainedDraft } : {}),
              ...(adoption.integrityWarning ? {
                integrityWarning: {
                  ...adoption.integrityWarning,
                  removedPageKeys: [...adoption.integrityWarning.removedPageKeys],
                  detectedAt: new Date().toISOString(),
                },
              } : {}),
              updatedAt: new Date().toISOString(),
            });
            return {
              renderMode: adoption.snapshot.renderMode,
              ...(retainedDraft ? { pendingRenderMode: retainedDraft.renderMode } : {}),
              source: "backend" as const,
              snapshot: adoption.snapshot,
              integrityWarning: adoption.integrityWarning,
            };
          }
          await configRepo.clear(environmentKey, siteId);
          const existing = await localPropertyRepo.load(environmentKey, siteId);
          // A definitive 404 is an authoritative replacement, so a draft made
          // against the former backend baseline is retired. Only the original
          // first-config local exemption survives another 404.
          const keptRenderMode = existing.ok ? existing.value?.renderMode : undefined;
          await localPropertyRepo.save({
            environmentKey,
            siteId,
            backendConfigPresent: false,
            ...(keptRenderMode ? { renderMode: keptRenderMode } : {}),
            updatedAt: new Date().toISOString(),
          });
          return { renderMode: keptRenderMode, source: "local" as const };
        });
      },
      /** A validated successful save response atomically replaces the durable
       * background baseline. Unexpected shrink is adopted but leaves a durable
       * warning that closes subsequent mutations. */
      applyBackendSave(environmentKey: string, siteId: number, snapshot: ConfigSnapshot) {
        return withPropertyOperation(environmentKey, siteId, async () => {
          const stored = await configRepo.load(environmentKey, siteId);
          const adoption = assessAuthoritativeSnapshot(
            stored.ok ? stored.value : null,
            snapshot,
            { environmentKey, siteId },
          );
          await configRepo.save(adoption.snapshot);
          await localPropertyRepo.save({
            environmentKey,
            siteId,
            backendConfigPresent: true,
            ...(adoption.integrityWarning ? {
              integrityWarning: {
                ...adoption.integrityWarning,
                removedPageKeys: [...adoption.integrityWarning.removedPageKeys],
                detectedAt: new Date().toISOString(),
              },
            } : {}),
            updatedAt: new Date().toISOString(),
          });
          return adoption;
        });
      },
      /** Writes require readable, clean local integrity facts. Reads remain
       * fail-open and may continue projecting the last adopted authority. */
      mutationGate(environmentKey: string, siteId: number) {
        return withPropertyOperation(environmentKey, siteId, async () => {
          const local = await localPropertyRepo.load(environmentKey, siteId);
          if (!local.ok) {
            return {
              ok: false as const,
              status: "invalid_request" as const,
              reason: "property-integrity-state-unreadable",
            };
          }
          if (local.value?.integrityWarning) {
            return {
              ok: false as const,
              status: "integrity_shrink" as const,
              reason: local.value.integrityWarning.message,
            };
          }
          return { ok: true as const };
        });
      },
      overlayAiCorpus(environmentKey: string, siteId: number, live: Parameters<typeof overlayLivePageOnAuthoritativeCorpus>[1]) {
        return withPropertyOperation(environmentKey, siteId, async () => {
          const stored = await configRepo.load(environmentKey, siteId);
          return overlayLivePageOnAuthoritativeCorpus(stored.ok ? stored.value : null, live);
        });
      },
      /** Stores either the 404-only local choice or one revision-fenced draft
       *  for an existing backend configuration. The draft is explicitly not
       *  authority; config.load returns it separately and a Save is the only
       *  path that can put it on Hub. */
      rememberRenderMode(environmentKey: string, siteId: number, renderMode: RenderMode) {
        return withPropertyOperation(environmentKey, siteId, async () => {
          const existing = await localPropertyRepo.load(environmentKey, siteId);
          if (existing.ok && existing.value?.backendConfigPresent) {
            const authoritative = await configRepo.load(environmentKey, siteId);
            if (!authoritative.ok || !authoritative.value) {
              return { stored: false as const, reason: "backend-config-unavailable" as const };
            }
            const { pendingRenderModeDraft: _priorDraft, ...retained } = existing.value;
            if (authoritative.value.renderMode === renderMode) {
              await localPropertyRepo.save({
                ...retained,
                updatedAt: new Date().toISOString(),
              });
              return { stored: true as const, reason: "authoritative-match" as const };
            }
            await localPropertyRepo.save({
              ...retained,
              pendingRenderModeDraft: {
                renderMode,
                basePropertyRevision: authoritative.value.propertyRevision,
                baseRenderModeUpdatedAt: authoritative.value.renderModeUpdatedAt,
                updatedAt: new Date().toISOString(),
              },
              updatedAt: new Date().toISOString(),
            });
            return { stored: true as const, reason: "pending-save" as const };
          }
          await localPropertyRepo.save({
            environmentKey,
            siteId,
            backendConfigPresent: false,
            renderMode,
            updatedAt: new Date().toISOString(),
          });
          return { stored: true as const };
        });
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
        const startedAt = Date.now();
        const deadlineAt = startedAt + AI_RUN_TIMEOUT_MS;
        let started: Awaited<ReturnType<typeof startAiRun>>;
        try {
          started = await startAiRun(transport, snapshot, { deadlineAt });
        } catch {
          return {
            status: "error" as const,
            failureStage: "transport" as const,
            reason: "start_transport_error",
          };
        }
        if (started.status !== "ok") {
          return {
            ...started,
            failureStage: "start" as const,
            reason: started.status === "auth_error"
              ? "start_auth_error"
              : started.reason
                ? `start_${started.reason}`
                : "start_http_error",
          };
        }
        const recordScope = {
          sessionId: started.sessionId,
          tabId: context.tabId,
          clientRunId: context.clientRunId,
          editorSessionId: context.editorSessionId,
          environmentKey: context.environmentKey,
          siteId: context.siteId,
          pageKey: context.pageKey,
          startedAt,
          deadlineAt,
        };
        await runRecordRepo.save({
          ...recordScope,
          phase: "running",
          updatedAt: startedAt,
        }, { makeLatest: true });
        const polled = await continueAiJob(recordScope);
        if (polled.status === "fresh") {
          return {
            status: "ok" as const,
            sessionId: started.sessionId,
            selectors: SelectorSetSchema.parse(polled.selectors),
          };
        }
        return {
          status: polled.status,
          sessionId: started.sessionId,
          failureStage: polled.failureStage,
          reason: polled.reason,
          httpStatus: "httpStatus" in polled ? polled.httpStatus : undefined,
        };
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
          record.clientRunId !== scope.clientRunId ||
          record.editorSessionId !== scope.editorSessionId
        ) {
          return { status: "not_found" as const };
        }
        const common = {
          sessionId: record.sessionId,
          clientRunId: record.clientRunId,
          editorSessionId: record.editorSessionId,
          deadlineAt: record.deadlineAt,
        };
        if (record.phase === "fresh") {
          return record.selectors
            ? { status: "fresh" as const, ...common, selectors: record.selectors }
            : { status: "invalid" as const };
        }
        if (record.phase === "running") {
          if (!record.deadlineAt) {
            return { status: "invalid" as const };
          }
          void continueAiJob({
            sessionId: record.sessionId,
            tabId: record.tabId,
            clientRunId: record.clientRunId,
            editorSessionId: record.editorSessionId,
            environmentKey: record.environmentKey,
            siteId: record.siteId,
            pageKey: record.pageKey,
            startedAt: record.startedAt,
            deadlineAt: record.deadlineAt,
          }).catch(() => undefined);
          return { status: "running" as const, ...common };
        }
        return {
          status: record.phase === "failed" ? "failed" as const : "stale" as const,
          ...common,
          error: record.error,
          failureStage: record.failureStage,
          reason: record.reason,
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
      onOwnershipTransferred?: () => Promise<void> | void;
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
      const wsEndpoint = currentSettings.configEndpoint ?? currentSettings.stageBase ?? "";
      let wsToken = currentSettings.token ?? "";
      const allowDebugLoopbackQueryToken = typeof __UF_DEBUG_BUILD__ !== "undefined" && __UF_DEBUG_BUILD__;
      const lockSocketUrl = (): string => buildPropertyLockWssUrl(
        wsEndpoint,
        wsToken,
        { allowDebugLoopbackQueryToken },
      );
      return createPropertyLockClient({
        ...(input.socket ? { socket: input.socket } : {
          socketFactory: () => (input.socketFactory ?? createWebSocketSocket)(
            lockSocketUrl(),
          ),
          networkReachable: input.networkReachability ?? checkNetworkReachability,
        }),
        ...(
          input.socket || input.socketFactory || lockSocketUrl().includes("?token=")
            ? {}
            : { authentication: { currentToken: () => wsToken } }
        ),
        editorSession,
        presence: inputContext.presence,
        hasUnsavedWork: inputContext.hasUnsavedWork,
        onStateChange: inputContext.onStateChange,
        onOwnershipTransferred: inputContext.onOwnershipTransferred,
        persistEditorSession(session) {
          return editorSessionRepo.save(session);
        },
        async onTokenUpdate(token) {
          // A reconnect belongs to this same editor session, but authenticates
          // a fresh transport with the latest lock-channel rotation.
          wsToken = token;
          await updateSettings((current) => ({ ...current, token }));
        },
      });
    },
  };
}

export type RewriteBackgroundServices = ReturnType<typeof createRewriteBackgroundServices>;
