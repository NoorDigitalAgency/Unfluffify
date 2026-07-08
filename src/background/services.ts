import { createPropertyLockClient, type WebSocketLike } from "../lock";
import {
  createConfigRepo,
  createIndexedDbStore,
  createLockIdentityRepo,
  createMemoryStore,
  createRunRecordRepo,
  createTabStateRepo,
} from "../storage";
import type { JsonTransport } from "../lynx";
import { getAiRunResult, getAiRunStatus, startAiRun } from "../lynx/ai";
import { buildCssInfoRequest, buildUpdateScrapingConditionsRequest, buildUrlSearchInfoRequest } from "../lynx/graphql";
import { loadConfigSnapshot, saveConfigSnapshot } from "../lynx/rest";
import { persistDurableFacts, rehydrateDurableFacts, reDeriveVolatile } from "./persistence";

function createBackgroundStore() {
  return typeof globalThis.indexedDB === "undefined"
    ? createMemoryStore()
    : createIndexedDbStore();
}

function createNoopSocket(): WebSocketLike {
  return {
    send() {},
    close() {},
    addEventListener() {},
  };
}

export function createRewriteBackgroundServices(input: Readonly<{
  transport?: JsonTransport;
  socket?: WebSocketLike;
}> = {}) {
  const store = createBackgroundStore();
  const tabStateRepo = createTabStateRepo(store);
  const configRepo = createConfigRepo(store);
  const runRecordRepo = createRunRecordRepo(store);
  const lockIdentityRepo = createLockIdentityRepo(store);
  const transport = input.transport ?? (async () => ({ status: 503, body: null, headers: {} }));

  return {
    repos: {
      tabStateRepo,
      configRepo,
      runRecordRepo,
      lockIdentityRepo,
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
      buildUrlSearchInfoRequest,
      buildCssInfoRequest,
      buildUpdateScrapingConditionsRequest,
    },
    createLockClient(inputContext: Readonly<{ tabId: number; siteId: number; pageUrl: string }>) {
      return createPropertyLockClient({
        socket: input.socket ?? createNoopSocket(),
        tabId: inputContext.tabId,
        siteId: inputContext.siteId,
        pageUrl: inputContext.pageUrl,
        identity: null,
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
