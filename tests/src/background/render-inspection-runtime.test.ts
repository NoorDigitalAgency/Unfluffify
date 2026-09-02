import { describe, expect, it, vi } from "vitest";

import {
  createRenderInspectionRuntime,
  RENDER_INSPECTION_DEADLINE_ALARM,
  RENDER_INSPECTION_RESTORE_RETRY_MS,
  RENDER_INSPECTION_STATIC_HOLD_MS,
  renderInspectionFailOpenAlarmName,
  renderInspectionTabCleanupAlarmName,
} from "../../../src/background/render-inspection-runtime";
import {
  createMemoryStore,
  createRenderInspectionRepo,
  type KeyValueStore,
  type RenderInspectionRepo,
} from "../../../src/storage";

const PROPERTY = {
  environmentKey: "stage.example.com",
  siteId: 42,
  baseUrl: "https://example.com",
} as const;
const PAGE_URL = "https://example.com/jobs/1";

function harness(options: Readonly<{
  store?: KeyValueStore;
  now?: number;
  timeoutMs?: number;
}> = {}) {
  const store = options.store ?? createMemoryStore();
  const repo = createRenderInspectionRepo(store);
  let timestamp = options.now ?? 1_000;
  let token = 0;
  const javascript: Array<{ tabId: number; enabled: boolean }> = [];
  const reloads: number[] = [];
  const alarms: Array<{ name: string; when: number }> = [];
  const clearedAlarms: string[] = [];
  const runtime = createRenderInspectionRuntime({
    repo,
    now: () => timestamp,
    timeoutMs: options.timeoutMs ?? 500,
    tokenFactory: () => `token-${++token}`,
    driver: {
      async setJavascriptEnabled(tabId, enabled) {
        javascript.push({ tabId, enabled });
      },
      reload(tabId) {
        reloads.push(tabId);
      },
    },
    createAlarm(name, info) {
      alarms.push({ name, when: info.when });
    },
    clearAlarm(name) {
      clearedAlarms.push(name);
    },
  });
  return {
    store,
    repo,
    runtime,
    javascript,
    reloads,
    alarms,
    clearedAlarms,
    setNow(value: number) {
      timestamp = value;
    },
  };
}

async function startStatic(h: ReturnType<typeof harness>) {
  return h.runtime.start({
    tabId: 7,
    property: PROPERTY,
    pageUrl: PAGE_URL,
    javascriptEnabled: false,
    sourceDocumentId: "document-a",
  });
}

async function bindReplacement(h: ReturnType<typeof harness>, documentId = "document-b") {
  await h.runtime.navigationCommitted({ tabId: 7, documentId, pageUrl: PAGE_URL });
  return h.runtime.adopt({
    tabId: 7,
    documentId,
    pageUrl: PAGE_URL,
    documentNonce: "nonce-b",
  });
}

describe("durable render inspection runtime", () => {
  it("accepts a www redirect authorized for the canonical property host", async () => {
    const h = harness();

    await expect(h.runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: "https://www.example.com/jobs/1",
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    })).resolves.toMatchObject({
      status: "started",
      session: { phase: "awaiting_document" },
    });

    expect(h.javascript).toEqual([{ tabId: 7, enabled: false }]);
    expect(h.reloads).toEqual([7]);
  });

  it("retains the unrelated-host fence around render inspection", async () => {
    const h = harness();

    await expect(h.runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: "https://example.net/jobs/1",
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    })).resolves.toMatchObject({
      status: "error",
      reason: "inspection-page-outside-property",
      session: { terminalReason: "start-failed" },
    });

    expect(h.javascript).toEqual([{ tabId: 7, enabled: true }]);
    expect(h.reloads).toEqual([7]);
  });

  it("does not treat reload acceptance as inspection success", async () => {
    const h = harness();
    const started = await startStatic(h);

    expect(started).toMatchObject({
      status: "started",
      session: {
        generation: 1,
        phase: "awaiting_document",
        javascriptEnabled: false,
        documentId: null,
        terminalReason: null,
      },
    });
    expect(h.javascript).toEqual([{ tabId: 7, enabled: false }]);
    expect(h.reloads).toEqual([7]);
    expect(h.alarms).toContainEqual({
      name: RENDER_INSPECTION_DEADLINE_ALARM,
      when: 1_500,
    });
    await expect(h.runtime.current(7)).resolves.toMatchObject({
      status: "active",
      session: { phase: "awaiting_document" },
    });
  });

  it("accepts only a matching replacement document and matching post-paint fence", async () => {
    const h = harness();
    const started = await startStatic(h);
    if (started.status !== "started") throw new Error("inspection did not start");
    await expect(bindReplacement(h)).resolves.toMatchObject({
      status: "adopt",
      session: {
        phase: "adopted",
        documentId: "document-b",
        documentNonce: "nonce-b",
      },
    });

    await expect(h.runtime.acknowledgePaint({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation + 1,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    })).resolves.toMatchObject({ status: "stale" });

    await expect(h.runtime.acknowledgePaint({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    })).resolves.toMatchObject({
      status: "ok",
      session: { phase: "terminal", terminalReason: "paint-acknowledged" },
    });
    // A successfully painted static view is held for a bounded comparison
    // window; the background, rather than the operator, owns its restoration.
    expect(h.javascript).toEqual([{ tabId: 7, enabled: false }]);
    await expect(h.runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { generation: 1, terminalReason: "paint-acknowledged" },
    });
    expect(h.alarms.at(-1)).toEqual({
      name: RENDER_INSPECTION_DEADLINE_ALARM,
      when: 31_000,
    });

    await h.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-c",
      pageUrl: PAGE_URL,
    });
    await expect(h.runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { terminalReason: "unexpected-navigation" },
    });
    expect(h.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });
  });

  it("terminalizes JavaScript-on from document adoption only and mode-gates both acknowledgements", async () => {
    const h = harness();
    const started = await h.runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-a",
    });
    if (started.status !== "started") throw new Error("reload did not start");
    await h.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
    });
    await h.runtime.adopt({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    });
    const fence = {
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    };

    await expect(h.runtime.acknowledgePaint(fence)).resolves.toMatchObject({
      status: "stale",
      reason: "inspection-acknowledgement-mode-mismatch",
      session: { phase: "adopted", javascriptEnabled: true },
    });
    await expect(h.runtime.acknowledgeReload(fence)).resolves.toMatchObject({
      status: "ok",
      session: {
        phase: "terminal",
        terminalReason: "reload-acknowledged",
        javascriptEnabled: true,
      },
    });
    expect(h.javascript).toEqual([{ tabId: 7, enabled: true }]);
    expect(h.reloads).toEqual([7]);

    const staticHarness = harness();
    const staticStarted = await startStatic(staticHarness);
    if (staticStarted.status !== "started") throw new Error("static inspection did not start");
    await bindReplacement(staticHarness);
    await expect(staticHarness.runtime.acknowledgeReload({
      ...fence,
      token: staticStarted.session.token,
      generation: staticStarted.session.generation,
    })).resolves.toMatchObject({
      status: "stale",
      reason: "inspection-acknowledgement-mode-mismatch",
      session: { phase: "adopted", javascriptEnabled: false },
    });
  });

  it("rejects the source document, a different page, and a second navigation", async () => {
    const source = harness();
    await startStatic(source);
    await expect(source.runtime.adopt({
      tabId: 7,
      documentId: "document-a",
      pageUrl: PAGE_URL,
      documentNonce: "old-realm",
    })).resolves.toMatchObject({ status: "stale" });

    await source.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-b",
      pageUrl: "https://example.com/jobs/2",
    });
    await expect(source.runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { terminalReason: "unexpected-navigation" },
    });
    expect(source.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });

    const second = harness();
    await startStatic(second);
    await second.runtime.navigationCommitted({ tabId: 7, documentId: "document-b", pageUrl: PAGE_URL });
    await second.runtime.navigationCommitted({ tabId: 7, documentId: "document-c", pageUrl: PAGE_URL });
    await expect(second.runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { terminalReason: "unexpected-navigation" },
    });
  });

  it("restores JavaScript before cancellation, failure, timeout, and Unregister settle", async () => {
    const cancelled = harness();
    const start = await startStatic(cancelled);
    if (start.status !== "started") throw new Error("inspection did not start");
    await expect(cancelled.runtime.cancel({
      tabId: 7,
      token: start.session.token,
      generation: start.session.generation,
    })).resolves.toMatchObject({
      status: "ok",
      session: { terminalReason: "cancelled" },
    });
    expect(cancelled.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });

    const failed = harness();
    const failedStart = await startStatic(failed);
    if (failedStart.status !== "started") throw new Error("inspection did not start");
    await bindReplacement(failed);
    await failed.runtime.fail({
      tabId: 7,
      token: failedStart.session.token,
      generation: failedStart.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
      reason: "curtain-render-failed",
    });
    expect(failed.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });

    const timedOut = harness();
    await startStatic(timedOut);
    timedOut.setNow(1_501);
    await timedOut.runtime.handleAlarm({ name: RENDER_INSPECTION_DEADLINE_ALARM });
    await expect(timedOut.runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { terminalReason: "timeout" },
    });
    expect(timedOut.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });

    const unregistered = harness();
    await startStatic(unregistered);
    await unregistered.runtime.terminateTab(7, "unregistered");
    await expect(unregistered.runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { terminalReason: "unregistered" },
    });
    expect(unregistered.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });
  });

  it("recovers an awaiting generation after worker restart and reissues only its missing reload", async () => {
    const first = harness();
    const started = await startStatic(first);
    if (started.status !== "started") throw new Error("inspection did not start");

    const restarted = harness({ store: first.store, now: 1_100 });
    await restarted.runtime.initialize();
    expect(restarted.javascript).toEqual([{ tabId: 7, enabled: false }]);
    expect(restarted.reloads).toEqual([7]);
    await expect(restarted.runtime.current(7)).resolves.toMatchObject({
      status: "active",
      session: { token: started.session.token, generation: 1 },
    });

    await restarted.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
    });
    await expect(restarted.runtime.adopt({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "restart-nonce",
    })).resolves.toMatchObject({ status: "adopt" });
  });

  it("serializes first use behind initialization so a crossing start reloads exactly once", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    let releaseIndex: (() => void) | undefined;
    const indexGate = new Promise<void>((resolve) => { releaseIndex = resolve; });
    let firstIndexRead = true;
    const repo: RenderInspectionRepo = {
      ...durable,
      async listTabIds() {
        if (firstIndexRead) {
          firstIndexRead = false;
          await indexGate;
        }
        return durable.listTabIds();
      },
    };
    const reload = vi.fn();
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "initialization-fence",
      driver: { setJavascriptEnabled: vi.fn().mockResolvedValue(undefined), reload },
    });

    const initializing = runtime.initialize();
    const starting = runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    releaseIndex?.();

    await expect(initializing).resolves.toBeUndefined();
    await expect(starting).resolves.toMatchObject({ status: "started" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("lets a commit crossing initialization bind without a duplicate recovery reload", async () => {
    const first = harness();
    await startStatic(first);
    let releaseIndex: (() => void) | undefined;
    const indexGate = new Promise<void>((resolve) => { releaseIndex = resolve; });
    let firstIndexRead = true;
    const repo: RenderInspectionRepo = {
      ...first.repo,
      async listTabIds() {
        if (firstIndexRead) {
          firstIndexRead = false;
          await indexGate;
        }
        return first.repo.listTabIds();
      },
    };
    const reload = vi.fn();
    const restarted = createRenderInspectionRuntime({
      repo,
      now: () => 1_100,
      driver: { setJavascriptEnabled: vi.fn().mockResolvedValue(undefined), reload },
    });

    const initializing = restarted.initialize();
    const committing = restarted.navigationCommitted({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
    });
    releaseIndex?.();
    await initializing;
    await committing;

    expect(reload).not.toHaveBeenCalled();
    await expect(restarted.current(7)).resolves.toMatchObject({
      status: "active",
      session: { phase: "awaiting_document", documentId: "document-b" },
    });
  });

  it("recovers an adopted session without reloading and preserves it across panel closure", async () => {
    const first = harness();
    await startStatic(first);
    await bindReplacement(first);

    // A new runtime over the same repository models both panel closure (which
    // performs no mutation) and MV3 worker recreation.
    const restarted = harness({ store: first.store, now: 1_100 });
    await restarted.runtime.initialize();
    expect(restarted.javascript).toEqual([{ tabId: 7, enabled: false }]);
    expect(restarted.reloads).toEqual([]);
    await expect(restarted.runtime.current(7)).resolves.toMatchObject({
      status: "active",
      session: { phase: "adopted", documentNonce: "nonce-b" },
    });
  });

  it("preserves the durable document across the first post-restart hash notification", async () => {
    const first = harness();
    await startStatic(first);
    await bindReplacement(first);

    // The new runtime models an MV3 worker whose lifecycle module has no
    // process-local last-document entry yet.
    const restarted = harness({ store: first.store, now: 1_100 });
    await restarted.runtime.initialize();
    await expect(restarted.runtime.preservesNavigationCommit({
      tabId: 7,
      documentId: "document-b",
      pageUrl: `${PAGE_URL}#details`,
    })).resolves.toBe(true);
    await expect(restarted.runtime.preservesNavigationCommit({
      tabId: 7,
      documentId: "document-b",
      pageUrl: `${PAGE_URL}?sort=recent`,
    })).resolves.toBe(false);
    await expect(restarted.runtime.preservesNavigationCommit({
      tabId: 7,
      documentId: "document-c",
      pageUrl: PAGE_URL,
    })).resolves.toBe(false);
    await restarted.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-b",
      pageUrl: `${PAGE_URL}#details`,
    });
    await restarted.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
    });

    await expect(restarted.runtime.current(7)).resolves.toMatchObject({
      status: "active",
      session: {
        phase: "adopted",
        documentId: "document-b",
        terminalReason: null,
      },
    });
    expect(restarted.javascript).toEqual([{ tabId: 7, enabled: false }]);

    await restarted.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-b",
      pageUrl: `${PAGE_URL}?sort=recent`,
    });
    await expect(restarted.runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { terminalReason: "unexpected-navigation" },
    });
    expect(restarted.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });
  });

  it("still terminalizes a real document replacement after worker restart", async () => {
    const first = harness();
    await startStatic(first);
    await bindReplacement(first);
    const restarted = harness({ store: first.store, now: 1_100 });
    await restarted.runtime.initialize();

    await restarted.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-c",
      pageUrl: `${PAGE_URL}#same-route`,
    });

    await expect(restarted.runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { terminalReason: "unexpected-navigation" },
    });
    expect(restarted.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });
  });

  it("increments from the durable tombstone and fences an old acknowledgement", async () => {
    const h = harness();
    const first = await startStatic(h);
    if (first.status !== "started") throw new Error("inspection did not start");
    await h.runtime.cancel({
      tabId: 7,
      token: first.session.token,
      generation: first.session.generation,
    });
    await h.runtime.navigationFailed(7);
    const second = await h.runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-a",
    });
    if (second.status !== "started") throw new Error("replacement inspection did not start");
    expect(second.session.generation).toBe(2);
    expect(second.session.token).not.toBe(first.session.token);

    await expect(h.runtime.acknowledgePaint({
      tabId: 7,
      token: first.session.token,
      generation: first.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    })).resolves.toMatchObject({ status: "stale" });
    await expect(h.runtime.current(7)).resolves.toMatchObject({
      status: "active",
      session: { token: second.session.token, generation: 2 },
    });
  });

  it("reuses an identical active session and refuses an opposite-mode supersession", async () => {
    const h = harness();
    const first = await startStatic(h);
    if (first.status !== "started") throw new Error("inspection did not start");

    await expect(startStatic(h)).resolves.toMatchObject({
      status: "started",
      session: { token: first.session.token, generation: first.session.generation },
    });
    await expect(h.runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-a",
    })).resolves.toMatchObject({
      status: "error",
      reason: "inspection-already-active",
      session: {
        token: first.session.token,
        generation: first.session.generation,
        javascriptEnabled: false,
      },
    });

    expect(h.reloads).toEqual([7]);
    expect(h.javascript).toEqual([{ tabId: 7, enabled: false }]);
  });

  it("checks navigation authority immediately before reload and fails open when it changed", async () => {
    const h = harness();
    await expect(h.runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
      stillCurrent: () => false,
    })).resolves.toMatchObject({
      status: "error",
      reason: "inspection-navigation-changed",
      session: { terminalReason: "unexpected-navigation" },
    });

    expect(h.reloads).toEqual([]);
    expect(h.javascript).toEqual([]);
  });

  it("keeps same-generation terminal timestamps monotonic for authoritative successors", async () => {
    const h = harness({ now: 1_000 });
    const started = await startStatic(h);
    if (started.status !== "started") throw new Error("inspection did not start");
    const adopted = await bindReplacement(h);
    if (adopted.status !== "adopt") throw new Error("inspection did not adopt");
    const acknowledged = await h.runtime.acknowledgePaint({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    });
    if (acknowledged.status !== "ok") throw new Error("inspection did not acknowledge");

    await h.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-c",
      pageUrl: PAGE_URL,
    });
    const current = await h.runtime.current(7);
    if (current.status !== "terminal") throw new Error("inspection did not terminalize");
    expect(current.session.terminalReason).toBe("unexpected-navigation");
    expect(current.session.updatedAt).toBeGreaterThan(acknowledged.session.updatedAt);
  });

  it("invalidates one static generation on debugger detach without poisoning the next", async () => {
    const h = harness();
    const first = await startStatic(h);
    if (first.status !== "started") throw new Error("inspection did not start");
    await bindReplacement(h);

    await h.runtime.debuggerDetached(7);
    await expect(h.runtime.acknowledgePaint({
      tabId: 7,
      token: first.session.token,
      generation: first.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    })).resolves.toMatchObject({
      status: "stale",
      session: { terminalReason: "content-failed" },
    });
    expect(h.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });

    const second = await h.runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-b",
    });
    if (second.status !== "started") throw new Error("inspection did not restart");
    await h.runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-c",
      pageUrl: PAGE_URL,
    });
    await h.runtime.adopt({
      tabId: 7,
      documentId: "document-c",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-c",
    });
    await expect(h.runtime.acknowledgePaint({
      tabId: 7,
      token: second.session.token,
      generation: second.session.generation,
      documentId: "document-c",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-c",
    })).resolves.toMatchObject({
      status: "ok",
      session: { terminalReason: "paint-acknowledged" },
    });
  });

  it("fails open and leaves a terminal tombstone when arming cannot configure scripts", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    const setJavascriptEnabled = vi.fn()
      .mockRejectedValueOnce(new Error("debugger unavailable"))
      .mockResolvedValue(undefined);
    const runtime = createRenderInspectionRuntime({
      repo,
      tokenFactory: () => "broken-token",
      now: () => 1_000,
      driver: { setJavascriptEnabled, reload: vi.fn() },
    });

    await expect(runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    })).resolves.toMatchObject({
      status: "error",
      session: { phase: "terminal", terminalReason: "start-failed" },
    });
    expect(setJavascriptEnabled).toHaveBeenLastCalledWith(7, true);
  });

  it("lets an authoritative commit outrank a late reload-callback rejection", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    let rejectReload: ((reason?: unknown) => void) | null = null;
    const reload = new Promise<void>((_resolve, reject) => {
      rejectReload = reject;
    });
    const runtime = createRenderInspectionRuntime({
      repo,
      tokenFactory: () => "late-rejection",
      now: () => 1_000,
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: () => reload,
      },
    });
    await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    await runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
    });
    rejectReload?.(new Error("late browser callback"));
    await Promise.resolve();
    await Promise.resolve();

    await expect(runtime.current(7)).resolves.toMatchObject({
      status: "active",
      session: { phase: "awaiting_document", documentId: "document-b" },
    });
  });

  it("removes an invalid persisted record and restores JavaScript on startup", async () => {
    const store = createMemoryStore({
      "renderInspection:state": { version: 1, records: [{
        version: 1,
        tabId: 7,
        token: "corrupt",
        generation: 1,
        phase: "terminal",
        property: PROPERTY,
        pageUrl: PAGE_URL,
        javascriptEnabled: false,
        sourceDocumentId: "document-a",
        documentId: null,
        documentNonce: null,
        startedAt: 1_000,
        updatedAt: 1_000,
        deadlineAt: 1_500,
        // Structurally impossible: terminal without a tombstone reason.
        terminalReason: null,
      }] },
    });
    const h = harness({ store });

    await h.runtime.initialize();

    expect(h.javascript).toContainEqual({ tabId: 7, enabled: true });
    await expect(h.repo.load(7)).resolves.toEqual({ ok: true, value: null });
    await expect(h.repo.listTabIds()).resolves.toEqual([]);
  });

  it("fails open and preserves the generation when a terminal write is rejected", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    let rejectTerminal = true;
    const repo: RenderInspectionRepo = {
      ...durable,
      async save(record) {
        if (rejectTerminal && record.phase === "terminal") {
          throw new Error("terminal storage unavailable");
        }
        await durable.save(record);
      },
    };
    const setJavascriptEnabled = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    let token = 0;
    const runtime = createRenderInspectionRuntime({
      repo,
      tokenFactory: () => `terminal-write-${++token}`,
      now: () => 1_000,
      driver: { setJavascriptEnabled, reload },
    });
    const started = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (started.status !== "started") throw new Error("inspection did not start");

    await expect(runtime.cancel({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
    })).rejects.toThrow("terminal storage unavailable");

    expect(setJavascriptEnabled).toHaveBeenLastCalledWith(7, true);
    expect(reload).toHaveBeenCalledTimes(2);
    await expect(durable.load(7)).resolves.toMatchObject({
      ok: true,
      value: {
        token: started.session.token,
        generation: started.session.generation,
        phase: "awaiting_document",
        deadlineAt: 1_000,
      },
    });

    rejectTerminal = false;
    await runtime.handleAlarm({ name: RENDER_INSPECTION_DEADLINE_ALARM });
    await runtime.navigationFailed(7);
    const retried = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    expect(retried).toMatchObject({
      status: "started",
      session: { token: "terminal-write-2", generation: 2 },
    });
  });

  it("restores JavaScript without erasing unreadable generation authority", async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const repo: RenderInspectionRepo = {
      load: vi.fn().mockRejectedValue(new Error("render inspection read failed")),
      listTabIds: vi.fn().mockResolvedValue([7]),
      list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      save: vi.fn().mockResolvedValue(undefined),
      clear,
    };
    const setJavascriptEnabled = vi.fn().mockResolvedValue(undefined);
    const runtime = createRenderInspectionRuntime({
      repo,
      driver: { setJavascriptEnabled, reload: vi.fn() },
    });

    await expect(runtime.current(7)).rejects.toThrow("render inspection read failed");

    expect(setJavascriptEnabled).toHaveBeenCalledWith(7, true);
    expect(clear).not.toHaveBeenCalled();
  });

  it("persists a failed terminal restore and retries it through the alarm and worker restart", async () => {
    const store = createMemoryStore();
    const repo = createRenderInspectionRepo(store);
    const firstRestore = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("transient debugger failure"))
      .mockResolvedValue(undefined);
    const first = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      timeoutMs: 500,
      tokenFactory: () => "restore-retry",
      driver: { setJavascriptEnabled: firstRestore, reload: vi.fn() },
    });
    const started = await first.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (started.status !== "started") throw new Error("inspection did not start");
    await first.cancel({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
    });
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { phase: "terminal", terminalReason: "cancelled", restorePending: true },
    });

    await first.handleAlarm({ name: RENDER_INSPECTION_DEADLINE_ALARM });
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { restorePending: false },
    });
    expect(firstRestore).toHaveBeenLastCalledWith(7, true);

    await first.navigationFailed(7);

    const secondStart = await first.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (secondStart.status !== "started") throw new Error("inspection did not restart");
    const failingAgain = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("terminal restore unavailable"));
    const terminalWriter = createRenderInspectionRuntime({
      repo,
      now: () => 1_100,
      driver: { setJavascriptEnabled: failingAgain, reload: vi.fn() },
    });
    await terminalWriter.initialize();
    await terminalWriter.cancel({
      tabId: 7,
      token: secondStart.session.token,
      generation: secondStart.session.generation,
    });
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { restorePending: true },
    });

    const restartRestore = vi.fn().mockResolvedValue(undefined);
    const restarted = createRenderInspectionRuntime({
      repo,
      now: () => 1_200,
      driver: { setJavascriptEnabled: restartRestore, reload: vi.fn() },
    });
    await restarted.initialize();
    expect(restartRestore).toHaveBeenCalledWith(7, true);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { restorePending: false },
    });
  });

  it("schedules an independent retry when the one-shot alarm cannot read the index", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    let failIndex = false;
    const repo: RenderInspectionRepo = {
      ...durable,
      async listTabIds() {
        if (failIndex) throw new Error("index unavailable");
        return durable.listTabIds();
      },
    };
    let timestamp = 1_000;
    const alarms: Array<{ name: string; when: number }> = [];
    const setJavascriptEnabled = vi.fn().mockResolvedValue(undefined);
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => timestamp,
      timeoutMs: 500,
      tokenFactory: () => "index-retry",
      driver: { setJavascriptEnabled, reload: vi.fn() },
      createAlarm(name, info) {
        alarms.push({ name, when: info.when });
      },
    });
    await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });

    timestamp = 1_501;
    failIndex = true;
    await expect(runtime.handleAlarm({ name: RENDER_INSPECTION_DEADLINE_ALARM }))
      .rejects.toThrow("index unavailable");
    expect(alarms.at(-1)).toEqual({
      name: RENDER_INSPECTION_DEADLINE_ALARM,
      when: timestamp + RENDER_INSPECTION_RESTORE_RETRY_MS,
    });

    failIndex = false;
    await runtime.handleAlarm({ name: RENDER_INSPECTION_DEADLINE_ALARM });
    await expect(runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { terminalReason: "timeout" },
    });
    expect(setJavascriptEnabled).toHaveBeenLastCalledWith(7, true);
  });

  it("fails open when navigation starts during worker recovery without waiting for commit", async () => {
    const first = harness();
    await startStatic(first);
    let releaseJavascript: (() => void) | undefined;
    const javascriptGate = new Promise<void>((resolve) => { releaseJavascript = resolve; });
    const setJavascriptEnabled = vi.fn().mockImplementation(() => javascriptGate);
    const reload = vi.fn();
    const restarted = createRenderInspectionRuntime({
      repo: first.repo,
      now: () => 1_100,
      driver: { setJavascriptEnabled, reload },
    });

    const initializing = restarted.initialize();
    await vi.waitFor(() => expect(setJavascriptEnabled).toHaveBeenCalledWith(7, false));
    restarted.observeNavigationStart(7, "https://example.com/jobs/2");
    releaseJavascript?.();
    await initializing;

    expect(reload).not.toHaveBeenCalled();
    expect(setJavascriptEnabled).toHaveBeenLastCalledWith(7, true);
    await expect(restarted.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { terminalReason: "unexpected-navigation" },
    });
  });

  it("clears a closed tab promptly even while global initialization is blocked", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    await durable.save({
      version: 1,
      tabId: 7,
      token: "closed-tab",
      generation: 1,
      phase: "awaiting_document",
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
      documentId: null,
      documentNonce: null,
      startedAt: 1_000,
      updatedAt: 1_001,
      deadlineAt: 1_500,
      terminalReason: null,
      restorePending: false,
    });
    const never = new Promise<number[]>(() => undefined);
    const repo: RenderInspectionRepo = {
      ...durable,
      listTabIds: () => never,
    };
    const runtime = createRenderInspectionRuntime({
      repo,
      driver: { setJavascriptEnabled: vi.fn(), reload: vi.fn() },
    });
    void runtime.initialize();

    await runtime.terminateTab(7, "tab-closed");

    await expect(durable.load(7)).resolves.toEqual({ ok: true, value: null });
    await expect(durable.listTabIds()).resolves.toEqual([]);
  });

  it("matches the expected reload by URL and heals a wrong-route document after commit", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    let releaseTerminalSave: (() => void) | undefined;
    const terminalSaveGate = new Promise<void>((resolve) => { releaseTerminalSave = resolve; });
    const repo: RenderInspectionRepo = {
      ...durable,
      async save(record) {
        if (record.phase === "terminal") {
          await terminalSaveGate;
        }
        await durable.save(record);
      },
    };
    const javascript = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "wrong-route",
      driver: { setJavascriptEnabled: javascript, reload },
    });
    await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });

    expect(runtime.observeNavigationStart(7, "https://example.com/jobs/2")).toBe(false);
    const started = runtime.navigationStarted(7);
    await vi.waitFor(() => expect(javascript).toHaveBeenCalledWith(7, false));
    const committed = runtime.navigationCommitted({
      tabId: 7,
      documentId: "document-b",
      pageUrl: "https://example.com/jobs/2",
    });
    releaseTerminalSave?.();
    await started;
    await committed;

    expect(javascript).toHaveBeenLastCalledWith(7, true);
    // First reload is the inspection request; second is the JS-on healing load
    // of the destination which may already have committed while restore waited.
    expect(reload).toHaveBeenCalledTimes(2);
    await expect(runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { generation: 1, terminalReason: "unexpected-navigation" },
    });
  });

  it("does not let a late reload rejection consume a newer expected occurrence", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    let rejectFirst: ((reason?: unknown) => void) | undefined;
    const firstReload = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const reload = vi.fn()
      .mockReturnValueOnce(firstReload)
      .mockResolvedValue(undefined);
    let token = 0;
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => `occurrence-${++token}`,
      driver: { setJavascriptEnabled: vi.fn().mockResolvedValue(undefined), reload },
    });
    const first = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (first.status !== "started") throw new Error("first inspection did not start");
    expect(runtime.observeNavigationStart(7, PAGE_URL)).toBe(true);
    await runtime.navigationCommitted({ tabId: 7, documentId: "document-b", pageUrl: PAGE_URL });
    await runtime.cancel({ tabId: 7, token: first.session.token, generation: first.session.generation });
    await runtime.navigationFailed(7);
    const second = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-b",
    });
    if (second.status !== "started") throw new Error("second inspection did not start");

    rejectFirst?.(new Error("late first occurrence failure"));
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.observeNavigationStart(7, PAGE_URL)).toBe(true);
  });

  it("restores and reloads a successful static view after its bounded hold", async () => {
    const h = harness();
    const started = await startStatic(h);
    if (started.status !== "started") throw new Error("inspection did not start");
    await bindReplacement(h);
    await h.runtime.acknowledgePaint({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    });

    h.setNow(1_000 + RENDER_INSPECTION_STATIC_HOLD_MS + 1);
    await h.runtime.handleAlarm({ name: RENDER_INSPECTION_DEADLINE_ALARM });

    expect(h.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });
    expect(h.reloads).toEqual([7, 7]);
    await expect(h.runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { generation: 1, terminalReason: "timeout", javascriptEnabled: false },
    });
  });

  it("hydrates a durable fail-open alarm, preserves its generation, and increments the retry", async () => {
    const first = harness();
    const started = await startStatic(first);
    if (started.status !== "started") throw new Error("inspection did not start");
    const failOpenAlarm = renderInspectionFailOpenAlarmName(7);
    const failingRepo: RenderInspectionRepo = {
      ...first.repo,
      load: vi.fn().mockRejectedValue(new Error("transient read failure")),
      clear: vi.fn().mockRejectedValue(new Error("transient clear failure")),
    };
    const alarmNames: string[] = [];
    const failingRuntime = createRenderInspectionRuntime({
      repo: failingRepo,
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn(),
      },
      createAlarm(name) {
        alarmNames.push(name);
      },
    });
    await expect(failingRuntime.current(7)).rejects.toThrow("transient read failure");
    expect(alarmNames).toContain(failOpenAlarm);

    const javascript = vi.fn().mockResolvedValue(undefined);
    const restarted = createRenderInspectionRuntime({
      repo: first.repo,
      now: () => 1_100,
      listAlarms: async () => [{ name: failOpenAlarm }],
      driver: { setJavascriptEnabled: javascript, reload: vi.fn().mockResolvedValue(undefined) },
      clearAlarm: vi.fn().mockResolvedValue(true),
    });
    await restarted.initialize();

    expect(javascript).not.toHaveBeenCalledWith(7, false);
    expect(javascript).toHaveBeenCalledWith(7, true);
    await expect(first.repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { generation: started.session.generation, phase: "terminal", terminalReason: "content-failed" },
    });
    const retry = await restarted.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-c",
    });
    expect(retry).toMatchObject({ status: "started", session: { generation: 2 } });
  });

  it("awaits alarm hook ordering and does not let pre-arm failure block restore", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    let releaseClear: (() => void) | undefined;
    const clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
    const events: string[] = [];
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "alarm-order",
      driver: { setJavascriptEnabled: vi.fn().mockResolvedValue(undefined), reload: vi.fn() },
      async clearAlarm() {
        events.push("clear-start");
        await clearGate;
        events.push("clear-end");
      },
      async createAlarm() {
        events.push("create");
      },
    });
    const scanning = runtime.sweepExpired();
    await vi.waitFor(() => expect(events).toEqual(["clear-start"]));
    const starting = runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    await Promise.resolve();
    expect(events).toEqual(["clear-start"]);
    releaseClear?.();
    await scanning;
    await starting;
    expect(events.slice(0, 3)).toEqual(["clear-start", "clear-end", "create"]);

    let rejectAlarm = false;
    const javascript = vi.fn().mockResolvedValue(undefined);
    const rejectingRuntime = createRenderInspectionRuntime({
      repo: createRenderInspectionRepo(createMemoryStore()),
      now: () => 1_000,
      tokenFactory: () => "alarm-reject",
      driver: { setJavascriptEnabled: javascript, reload: vi.fn() },
      async createAlarm() {
        if (rejectAlarm) throw new Error("alarm unavailable");
      },
    });
    const active = await rejectingRuntime.start({
      tabId: 8,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (active.status !== "started") throw new Error("inspection did not start");
    rejectAlarm = true;
    await expect(rejectingRuntime.cancel({
      tabId: 8,
      token: active.session.token,
      generation: active.session.generation,
    })).resolves.toMatchObject({ status: "ok" });
    expect(javascript).toHaveBeenLastCalledWith(8, true);
  });

  it("lets a pending cold commit outrank canRecover and bind without posture replay", async () => {
    const first = harness();
    await startStatic(first);
    const canRecover = vi.fn().mockResolvedValue(false);
    const javascript = vi.fn().mockResolvedValue(undefined);
    const restarted = createRenderInspectionRuntime({
      repo: first.repo,
      now: () => 1_100,
      canRecover,
      driver: { setJavascriptEnabled: javascript, reload: vi.fn() },
    });
    const commit = { tabId: 7, documentId: "document-b", pageUrl: PAGE_URL };
    restarted.observeNavigationCommit(commit);
    await restarted.navigationCommitted(commit);

    expect(canRecover).not.toHaveBeenCalled();
    expect(javascript).not.toHaveBeenCalled();
    await expect(restarted.current(7)).resolves.toMatchObject({
      status: "active",
      session: { generation: 1, documentId: "document-b" },
    });
  });

  it("retires canRecover=false as the same generation before permitting generation plus one", async () => {
    const first = harness();
    const started = await startStatic(first);
    if (started.status !== "started") throw new Error("inspection did not start");
    const restarted = createRenderInspectionRuntime({
      repo: first.repo,
      now: () => 1_100,
      tokenFactory: () => "replacement-token",
      canRecover: async () => false,
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
      },
    });
    await restarted.initialize();
    await expect(restarted.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { token: started.session.token, generation: 1, terminalReason: "unexpected-navigation" },
    });
    const next = await restarted.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-c",
    });
    expect(next).toMatchObject({ status: "started", session: { generation: 2 } });
  });

  it("keeps failed paint terminalization non-successful and same-generation through alarm recovery", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    let rejectTerminal = true;
    const repo: RenderInspectionRepo = {
      ...durable,
      async save(record) {
        if (rejectTerminal && record.phase === "terminal") {
          throw new Error("terminal unavailable");
        }
        await durable.save(record);
      },
    };
    const alarms: string[] = [];
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "paint-save-failure",
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
      },
      createAlarm(name) { alarms.push(name); },
      clearAlarm: vi.fn(),
    });
    const started = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (started.status !== "started") throw new Error("inspection did not start");
    await runtime.navigationCommitted({ tabId: 7, documentId: "document-b", pageUrl: PAGE_URL });
    await runtime.adopt({ tabId: 7, documentId: "document-b", pageUrl: PAGE_URL, documentNonce: "nonce-a" });
    await expect(runtime.acknowledgePaint({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-a",
    })).rejects.toThrow("terminal unavailable");
    expect(alarms).toContain(renderInspectionFailOpenAlarmName(7));

    rejectTerminal = false;
    await runtime.handleAlarm({ name: renderInspectionFailOpenAlarmName(7) });
    await expect(durable.load(7)).resolves.toMatchObject({
      ok: true,
      value: {
        token: started.session.token,
        generation: started.session.generation,
        phase: "terminal",
        terminalReason: "content-failed",
        failOpenPending: false,
      },
    });
  });

  it("recovers a double terminal/restore failure into the same generation, then increments", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    let rejectTerminal = true;
    const repo: RenderInspectionRepo = {
      ...durable,
      async save(record) {
        if (rejectTerminal && record.phase === "terminal") throw new Error("terminal unavailable");
        await durable.save(record);
      },
    };
    const javascript = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("restore unavailable"))
      .mockResolvedValue(undefined);
    let token = 0;
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => `double-${++token}`,
      driver: { setJavascriptEnabled: javascript, reload: vi.fn().mockResolvedValue(undefined) },
      createAlarm: vi.fn(),
      clearAlarm: vi.fn(),
    });
    const started = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (started.status !== "started") throw new Error("inspection did not start");
    await expect(runtime.cancel({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
    })).rejects.toThrow("terminal unavailable");

    rejectTerminal = false;
    await runtime.handleAlarm({ name: renderInspectionFailOpenAlarmName(7) });
    await expect(durable.load(7)).resolves.toMatchObject({
      ok: true,
      value: { generation: 1, phase: "terminal", terminalReason: "cancelled" },
    });
    const next = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-a",
    });
    expect(next).toMatchObject({ status: "started", session: { generation: 2 } });
  });

  it("retries a failed tab-close deletion after restart without touching CDP", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    await durable.save({
      version: 1,
      tabId: 7,
      token: "closed-generation",
      generation: 1,
      phase: "awaiting_document",
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
      documentId: null,
      documentNonce: null,
      startedAt: 1_000,
      updatedAt: 1_001,
      deadlineAt: 1_500,
      terminalReason: null,
      restorePending: false,
      reloadPending: false,
      restoreAt: null,
      failOpenPending: false,
    });
    const failingRepo: RenderInspectionRepo = {
      ...durable,
      clear: vi.fn().mockRejectedValue(new Error("delete unavailable")),
    };
    const alarms: string[] = [];
    const first = createRenderInspectionRuntime({
      repo: failingRepo,
      driver: { setJavascriptEnabled: vi.fn(), reload: vi.fn() },
      createAlarm(name) { alarms.push(name); },
    });
    await expect(first.terminateTab(7, "tab-closed")).rejects.toThrow("delete unavailable");
    const cleanupAlarm = alarms.find((name) => name.startsWith(renderInspectionTabCleanupAlarmName(7)));
    expect(cleanupAlarm).toBeDefined();
    if (!cleanupAlarm) throw new Error("cleanup alarm was not armed");

    const javascript = vi.fn();
    const reload = vi.fn();
    const restarted = createRenderInspectionRuntime({
      repo: durable,
      listAlarms: async () => [{ name: cleanupAlarm }],
      driver: { setJavascriptEnabled: javascript, reload },
      clearAlarm: vi.fn().mockResolvedValue(true),
    });
    await restarted.initialize();
    expect(javascript).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    await expect(durable.load(7)).resolves.toEqual({ ok: true, value: null });
  });

  it("fails open immediately when commit binding or adoption persistence fails", async () => {
    for (const failingPhase of ["commit", "adopt"] as const) {
      const durable = createRenderInspectionRepo(createMemoryStore());
      let failed = false;
      const repo: RenderInspectionRepo = {
        ...durable,
        async save(record) {
          const shouldFail = !failed && (
            failingPhase === "commit"
              ? record.phase === "awaiting_document" && record.documentId === "document-b"
              : record.phase === "adopted"
          );
          if (shouldFail) {
            failed = true;
            throw new Error(`${failingPhase} save unavailable`);
          }
          await durable.save(record);
        },
      };
      const javascript = vi.fn().mockResolvedValue(undefined);
      const runtime = createRenderInspectionRuntime({
        repo,
        now: () => 1_000,
        tokenFactory: () => `${failingPhase}-failure`,
        driver: { setJavascriptEnabled: javascript, reload: vi.fn().mockResolvedValue(undefined) },
      });
      const started = await runtime.start({
        tabId: 7,
        property: PROPERTY,
        pageUrl: PAGE_URL,
        javascriptEnabled: false,
        sourceDocumentId: "document-a",
      });
      if (started.status !== "started") throw new Error("inspection did not start");
      await runtime.navigationCommitted({ tabId: 7, documentId: "document-b", pageUrl: PAGE_URL });
      if (failingPhase === "adopt") {
        await expect(runtime.adopt({
          tabId: 7,
          documentId: "document-b",
          pageUrl: PAGE_URL,
          documentNonce: "nonce-b",
        })).resolves.toMatchObject({ status: "terminal" });
      }
      expect(javascript).toHaveBeenLastCalledWith(7, true);
      await expect(durable.load(7)).resolves.toMatchObject({
        ok: true,
        value: { generation: started.session.generation, phase: "terminal", terminalReason: "content-failed" },
      });
    }
  });

  it("salvages a valid generation from a corrupt envelope into a non-success tombstone", async () => {
    const store = createMemoryStore({
      "renderInspection:state": {
        version: 2,
        records: [{
          version: 1,
          tabId: 7,
          token: "salvaged-generation",
          generation: 3,
          phase: "awaiting_document",
          property: PROPERTY,
          pageUrl: PAGE_URL,
          javascriptEnabled: false,
          sourceDocumentId: "document-a",
          documentId: null,
          documentNonce: null,
          startedAt: 1_000,
          updatedAt: 1_001,
          deadlineAt: 31_000,
          terminalReason: null,
          restorePending: false,
          reloadPending: false,
          restoreAt: null,
          failOpenPending: false,
        }],
      },
    });
    const repo = createRenderInspectionRepo(store);
    const javascript = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 2_000,
      tokenFactory: () => "salvaged-next",
      driver: { setJavascriptEnabled: javascript, reload },
    });

    await runtime.initialize();
    await expect(runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: {
        token: "salvaged-generation",
        generation: 3,
        terminalReason: "content-failed",
      },
    });
    expect(javascript).toHaveBeenCalledWith(7, true);
    expect(reload).toHaveBeenCalledWith(7);

    const retry = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-c",
    });
    expect(retry).toMatchObject({ status: "started", session: { generation: 4 } });
  });

  it("scopes a tab-close cleanup alarm to the closed occurrence", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    const alarms: string[] = [];
    let token = 0;
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => `cleanup-${++token}`,
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
      },
      createAlarm(name) {
        alarms.push(name);
      },
      async clearAlarm(name) {
        if (name.startsWith(renderInspectionTabCleanupAlarmName(7))) {
          throw new Error("cleanup alarm removal failed");
        }
      },
    });
    await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-a",
    });
    await runtime.terminateTab(7, "tab-closed");
    const staleAlarm = alarms.find((name) => name.startsWith(renderInspectionTabCleanupAlarmName(7)));
    if (!staleAlarm) throw new Error("cleanup alarm was not armed");

    const replacement = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-new",
    });
    expect(replacement).toMatchObject({
      status: "started",
      session: { token: "cleanup-2", generation: 1 },
    });

    await runtime.handleAlarm({ name: staleAlarm });
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { token: "cleanup-2", generation: 1, phase: "awaiting_document" },
    });
  });

  it("resolves a tab-close occurrence after a transient first read and fences stale cleanup alarms", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    await durable.save({
      version: 1,
      tabId: 7,
      token: "closed-occurrence",
      generation: 4,
      phase: "awaiting_document",
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-old",
      documentId: null,
      documentNonce: null,
      startedAt: 1_000,
      updatedAt: 1_001,
      deadlineAt: 31_000,
      terminalReason: null,
      restorePending: false,
      reloadPending: false,
      restoreAt: null,
      failOpenPending: false,
    });
    let loadCount = 0;
    const repo: RenderInspectionRepo = {
      async load(tabId) {
        loadCount += 1;
        if (loadCount === 1) throw new Error("transient first read");
        return durable.load(tabId);
      },
      listTabIds: () => durable.listTabIds(),
      list: () => durable.list(),
      save: (record) => durable.save(record),
      clear: (tabId) => durable.clear(tabId),
      isCleanupAlarmDismissed: (alarmName) => durable.isCleanupAlarmDismissed?.(alarmName) ?? Promise.resolve(false),
      dismissCleanupAlarm: (alarmName) => durable.dismissCleanupAlarm?.(alarmName) ?? Promise.resolve(),
    };
    const alarms: string[] = [];
    const javascript = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 2_000,
      tokenFactory: () => "replacement-occurrence",
      classifyTabCleanupOccurrence: async (record) =>
        record.token === "replacement-occurrence" ? "current" : "stale",
      driver: { setJavascriptEnabled: javascript, reload },
      createAlarm(name) {
        alarms.push(name);
      },
    });

    await runtime.terminateTab(7, "tab-closed");
    expect(javascript).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    await expect(durable.load(7)).resolves.toEqual({ ok: true, value: null });
    const staleCleanupAlarms = [...new Set(alarms.filter((name) =>
      name.startsWith(renderInspectionTabCleanupAlarmName(7))))];
    expect(staleCleanupAlarms.length).toBeGreaterThan(0);

    const replacement = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-new",
    });
    expect(replacement).toMatchObject({
      status: "started",
      session: { token: "replacement-occurrence", generation: 1 },
    });
    for (const alarmName of staleCleanupAlarms) {
      await runtime.handleAlarm({ name: alarmName });
    }
    await expect(durable.load(7)).resolves.toMatchObject({
      ok: true,
      value: { token: "replacement-occurrence", phase: "awaiting_document" },
    });
  });

  it("retains an unresolved close through a storage outage, then safely recovers across restart and reuse", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    await durable.save({
      version: 1,
      tabId: 7,
      token: "closed-before-outage",
      generation: 6,
      phase: "awaiting_document",
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-old",
      documentId: null,
      documentNonce: null,
      startedAt: 1_000,
      updatedAt: 1_001,
      deadlineAt: 31_000,
      terminalReason: null,
      restorePending: false,
      reloadPending: false,
      restoreAt: null,
      failOpenPending: false,
    });
    const unavailableRepo: RenderInspectionRepo = {
      load: vi.fn().mockRejectedValue(new Error("storage unavailable")),
      listTabIds: () => durable.listTabIds(),
      list: () => durable.list(),
      save: (record) => durable.save(record),
      clear: (tabId) => durable.clear(tabId),
    };
    const armed: string[] = [];
    const closing = createRenderInspectionRuntime({
      repo: unavailableRepo,
      driver: { setJavascriptEnabled: vi.fn(), reload: vi.fn() },
      createAlarm(name) {
        armed.push(name);
      },
    });

    await expect(closing.terminateTab(7, "tab-closed")).rejects.toThrow("storage unavailable");
    const unresolvedAlarm = armed.find((name) =>
      name.startsWith(`${renderInspectionTabCleanupAlarmName(7)}:unresolved:`));
    if (!unresolvedAlarm) throw new Error("unresolved cleanup alarm was not armed");
    await expect(durable.load(7)).resolves.toMatchObject({
      ok: true,
      value: { token: "closed-before-outage", generation: 6 },
    });

    const javascript = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const restarted = createRenderInspectionRuntime({
      repo: durable,
      now: () => 2_000,
      tokenFactory: () => "reused-tab-occurrence",
      listAlarms: async () => [{ name: unresolvedAlarm }],
      classifyTabCleanupOccurrence: async (record) =>
        record.token === "reused-tab-occurrence" ? "current" : "stale",
      driver: { setJavascriptEnabled: javascript, reload },
      createAlarm: vi.fn(),
      clearAlarm: vi.fn().mockResolvedValue(true),
    });
    await restarted.initialize();
    expect(javascript).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    await expect(durable.load(7)).resolves.toEqual({ ok: true, value: null });

    const replacement = await restarted.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: true,
      sourceDocumentId: "document-new",
    });
    expect(replacement).toMatchObject({
      status: "started",
      session: { token: "reused-tab-occurrence", generation: 1 },
    });
    await restarted.handleAlarm({ name: unresolvedAlarm });
    await expect(durable.load(7)).resolves.toMatchObject({
      ok: true,
      value: { token: "reused-tab-occurrence", phase: "awaiting_document" },
    });
  });

  it("durably dismisses stale generic cleanup while a reused tab navigation is unsettled", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    const javascript = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const classifyTabCleanupOccurrence = vi.fn().mockResolvedValue("current" as const);
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "current-static-occurrence",
      classifyTabCleanupOccurrence,
      driver: { setJavascriptEnabled: javascript, reload },
      createAlarm: vi.fn(),
    });
    const started = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-current",
    });
    if (started.status !== "started") throw new Error("inspection did not start");
    expect(runtime.observeNavigationStart(7, PAGE_URL)).toBe(true);
    const genericCleanupAlarm = renderInspectionTabCleanupAlarmName(7);
    const javascriptCallsBeforeAlarm = javascript.mock.calls.length;
    const reloadCallsBeforeAlarm = reload.mock.calls.length;

    await expect(runtime.handleAlarm({ name: genericCleanupAlarm })).resolves.toBeUndefined();

    expect(classifyTabCleanupOccurrence).toHaveBeenCalledTimes(1);
    expect(javascript).toHaveBeenCalledTimes(javascriptCallsBeforeAlarm);
    expect(reload).toHaveBeenCalledTimes(reloadCallsBeforeAlarm);
    await expect(repo.isCleanupAlarmDismissed?.(genericCleanupAlarm)).resolves.toBe(true);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: {
        token: "current-static-occurrence",
        generation: 1,
        phase: "awaiting_document",
      },
    });
  });

  it("retains unrelated pending cleanup until navigation handling durably fences the live occurrence", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    let dismissalAttempts = 0;
    const repo: RenderInspectionRepo = {
      ...durable,
      async dismissCleanupAlarm(alarmName) {
        dismissalAttempts += 1;
        if (dismissalAttempts <= 3) throw new Error("dismissal storage unavailable");
        await durable.dismissCleanupAlarm?.(alarmName);
      },
    };
    const genericCleanupAlarm = renderInspectionTabCleanupAlarmName(7);
    let token = 0;
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => `unrelated-navigation-${++token}`,
      classifyTabCleanupOccurrence: vi.fn().mockResolvedValue("current" as const),
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
      },
      createAlarm: vi.fn(),
    });
    await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    expect(runtime.observeNavigationStart(7, "https://example.com/jobs/other")).toBe(false);

    await expect(runtime.handleAlarm({ name: genericCleanupAlarm }))
      .rejects.toThrow("dismissal storage unavailable");

    await expect(repo.isCleanupAlarmDismissed?.(genericCleanupAlarm)).resolves.toBe(false);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { token: "unrelated-navigation-1", phase: "awaiting_document" },
    });

    await expect(runtime.navigationStarted(7))
      .rejects.toThrow("dismissal storage unavailable");
    expect(dismissalAttempts).toBe(2);
    await expect(repo.isCleanupAlarmDismissed?.(genericCleanupAlarm)).resolves.toBe(false);
    const nextPageUrl = "https://example.com/jobs/other";
    const commit = { tabId: 7, documentId: "document-c", pageUrl: nextPageUrl };
    runtime.observeNavigationCommit(commit);
    await expect(runtime.navigationCommitted(commit))
      .rejects.toThrow("dismissal storage unavailable");
    expect(dismissalAttempts).toBe(3);

    // The cleanup alarm is the durable retry signal. Once dismissal storage
    // recovers, handling it resumes the exact commit retained above and
    // terminalizes the live generation before returning.
    await runtime.handleAlarm({ name: genericCleanupAlarm });
    expect(dismissalAttempts).toBe(4);
    await expect(repo.isCleanupAlarmDismissed?.(genericCleanupAlarm)).resolves.toBe(true);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: {
        token: "unrelated-navigation-1",
        generation: 1,
        phase: "terminal",
        terminalReason: "unexpected-navigation",
      },
    });

    const retry = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: nextPageUrl,
      javascriptEnabled: true,
      sourceDocumentId: "document-c",
    });
    expect(retry).toMatchObject({
      status: "started",
      session: { token: "unrelated-navigation-2", generation: 2 },
    });
  });

  it("durably fences generic cleanup through bind, later navigation, replay, and restart", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    let dismissalAttempts = 0;
    const repo: RenderInspectionRepo = {
      ...durable,
      async dismissCleanupAlarm(alarmName) {
        dismissalAttempts += 1;
        if (dismissalAttempts === 1) throw new Error("dismissal storage unavailable");
        await durable.dismissCleanupAlarm?.(alarmName);
      },
    };
    const javascript = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const classifyTabCleanupOccurrence = vi.fn().mockResolvedValue("current" as const);
    const genericCleanupAlarm = renderInspectionTabCleanupAlarmName(7);
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "commit-window-occurrence",
      classifyTabCleanupOccurrence,
      driver: { setJavascriptEnabled: javascript, reload },
      createAlarm: vi.fn(),
      async clearAlarm(name) {
        if (name === genericCleanupAlarm) throw new Error("generic alarm clear failed");
      },
    });
    const started = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (started.status !== "started") throw new Error("inspection did not start");
    expect(runtime.observeNavigationStart(7, PAGE_URL)).toBe(true);
    const commit = { tabId: 7, documentId: "document-b", pageUrl: PAGE_URL };
    runtime.observeNavigationCommit(commit);
    const javascriptCallsBeforeAlarm = javascript.mock.calls.length;
    const reloadCallsBeforeAlarm = reload.mock.calls.length;

    await expect(runtime.handleAlarm({ name: genericCleanupAlarm }))
      .rejects.toThrow("dismissal storage unavailable");

    expect(classifyTabCleanupOccurrence).toHaveBeenCalledTimes(1);
    expect(javascript).toHaveBeenCalledTimes(javascriptCallsBeforeAlarm);
    expect(reload).toHaveBeenCalledTimes(reloadCallsBeforeAlarm);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { token: "commit-window-occurrence", documentId: null, phase: "awaiting_document" },
    });

    await runtime.navigationCommitted(commit);
    expect(dismissalAttempts).toBe(2);
    await runtime.adopt({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    });
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: {
        token: "commit-window-occurrence",
        documentId: "document-b",
        phase: "adopted",
      },
    });

    const nextPageUrl = "https://example.com/jobs/2";
    expect(runtime.observeNavigationStart(7, nextPageUrl)).toBe(false);
    await runtime.navigationStarted(7);
    const nextCommit = { tabId: 7, documentId: "document-c", pageUrl: nextPageUrl };
    runtime.observeNavigationCommit(nextCommit);
    await runtime.navigationCommitted(nextCommit);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: {
        token: "commit-window-occurrence",
        generation: 1,
        phase: "terminal",
        terminalReason: "unexpected-navigation",
      },
    });

    await runtime.handleAlarm({ name: genericCleanupAlarm });
    expect(classifyTabCleanupOccurrence).toHaveBeenCalledTimes(1);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { token: "commit-window-occurrence", generation: 1, phase: "terminal" },
    });

    const restartedClassifier = vi.fn().mockResolvedValue("stale" as const);
    const restarted = createRenderInspectionRuntime({
      repo,
      now: () => 2_000,
      tokenFactory: () => "after-dismissal",
      listAlarms: async () => [{ name: genericCleanupAlarm }],
      classifyTabCleanupOccurrence: restartedClassifier,
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
      },
      async clearAlarm(name) {
        if (name === genericCleanupAlarm) throw new Error("generic alarm still cannot clear");
      },
    });
    await restarted.initialize();
    expect(restartedClassifier).not.toHaveBeenCalled();
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { token: "commit-window-occurrence", generation: 1, phase: "terminal" },
    });
    const retry = await restarted.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: nextPageUrl,
      javascriptEnabled: true,
      sourceDocumentId: "document-c",
    });
    expect(retry).toMatchObject({ status: "started", session: { generation: 2 } });
  });

  it("dismisses dormant generic cleanup before a cold worker accepts the replacement commit", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    const first = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "cold-commit-occurrence",
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
      },
    });
    await first.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    expect(first.observeNavigationStart(7, PAGE_URL)).toBe(true);

    const genericCleanupAlarm = renderInspectionTabCleanupAlarmName(7);
    const classifier = vi.fn().mockResolvedValue("stale" as const);
    const javascript = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    const restarted = createRenderInspectionRuntime({
      repo,
      now: () => 1_100,
      listAlarms: async () => [{ name: genericCleanupAlarm }],
      classifyTabCleanupOccurrence: classifier,
      driver: { setJavascriptEnabled: javascript, reload },
      async clearAlarm(name) {
        if (name === genericCleanupAlarm) throw new Error("generic alarm clear failed");
      },
    });
    const commit = { tabId: 7, documentId: "document-b", pageUrl: PAGE_URL };
    restarted.observeNavigationCommit(commit);
    await restarted.navigationCommitted(commit);

    expect(classifier).not.toHaveBeenCalled();
    expect(javascript).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    await expect(repo.isCleanupAlarmDismissed?.(genericCleanupAlarm)).resolves.toBe(true);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { token: "cold-commit-occurrence", documentId: "document-b" },
    });

    const nextPageUrl = "https://example.com/jobs/2";
    expect(restarted.observeNavigationStart(7, nextPageUrl)).toBe(false);
    await restarted.navigationStarted(7);
    const nextCommit = { tabId: 7, documentId: "document-c", pageUrl: nextPageUrl };
    restarted.observeNavigationCommit(nextCommit);
    await restarted.navigationCommitted(nextCommit);
    await restarted.handleAlarm({ name: genericCleanupAlarm });

    expect(classifier).not.toHaveBeenCalled();
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: {
        token: "cold-commit-occurrence",
        generation: 1,
        phase: "terminal",
        terminalReason: "unexpected-navigation",
      },
    });
  });

  it("persists a classifier-current dismissal across clear failure, restart, and later navigation", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    const genericCleanupAlarm = renderInspectionTabCleanupAlarmName(7);
    const classifier = vi.fn().mockResolvedValue("current" as const);
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "classifier-current",
      classifyTabCleanupOccurrence: classifier,
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
      },
      async clearAlarm(name) {
        if (name === genericCleanupAlarm) throw new Error("generic alarm clear failed");
      },
    });
    const started = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (started.status !== "started") throw new Error("inspection did not start");
    await runtime.navigationCommitted({ tabId: 7, documentId: "document-b", pageUrl: PAGE_URL });
    await runtime.adopt({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    });

    await runtime.handleAlarm({ name: genericCleanupAlarm });
    expect(classifier).toHaveBeenCalledTimes(1);
    await expect(repo.isCleanupAlarmDismissed?.(genericCleanupAlarm)).resolves.toBe(true);

    const restartedClassifier = vi.fn().mockResolvedValue("stale" as const);
    const restarted = createRenderInspectionRuntime({
      repo,
      now: () => 2_000,
      listAlarms: async () => [{ name: genericCleanupAlarm }],
      classifyTabCleanupOccurrence: restartedClassifier,
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
      },
      async clearAlarm(name) {
        if (name === genericCleanupAlarm) throw new Error("generic alarm still cannot clear");
      },
    });
    await restarted.initialize();
    expect(restartedClassifier).not.toHaveBeenCalled();

    const nextPageUrl = "https://example.com/jobs/2";
    expect(restarted.observeNavigationStart(7, nextPageUrl)).toBe(false);
    await restarted.navigationStarted(7);
    const nextCommit = { tabId: 7, documentId: "document-c", pageUrl: nextPageUrl };
    restarted.observeNavigationCommit(nextCommit);
    await restarted.navigationCommitted(nextCommit);
    await restarted.handleAlarm({ name: genericCleanupAlarm });

    expect(restartedClassifier).not.toHaveBeenCalled();
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: {
        token: "classifier-current",
        generation: 1,
        phase: "terminal",
        terminalReason: "unexpected-navigation",
      },
    });
  });

  it("heals every non-success terminal exit from an adopted static document", async () => {
    for (const action of ["fail", "cancel", "detach"] as const) {
      const h = harness();
      const started = await startStatic(h);
      if (started.status !== "started") throw new Error("inspection did not start");
      await bindReplacement(h);

      if (action === "fail") {
        await h.runtime.fail({
          tabId: 7,
          token: started.session.token,
          generation: started.session.generation,
          documentId: "document-b",
          pageUrl: PAGE_URL,
          documentNonce: "nonce-b",
          reason: "paint failed",
        });
      } else if (action === "cancel") {
        await h.runtime.cancel({
          tabId: 7,
          token: started.session.token,
          generation: started.session.generation,
        });
      } else {
        await h.runtime.debuggerDetached(7);
      }

      expect(h.javascript.at(-1)).toEqual({ tabId: 7, enabled: true });
      expect(h.reloads).toEqual([7, 7]);
      await expect(h.repo.load(7)).resolves.toMatchObject({
        ok: true,
        value: {
          phase: "terminal",
          terminalReason: action === "cancel" ? "cancelled" : "content-failed",
          reloadPending: false,
        },
      });
    }
  });

  it("keeps a failed static healing reload durable until the alarm retries it", async () => {
    const repo = createRenderInspectionRepo(createMemoryStore());
    const reload = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("healing reload failed"))
      .mockResolvedValue(undefined);
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "reload-retry",
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload,
      },
    });
    const started = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (started.status !== "started") throw new Error("inspection did not start");
    await runtime.navigationCommitted({ tabId: 7, documentId: "document-b", pageUrl: PAGE_URL });
    await runtime.adopt({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    });
    await runtime.fail({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
      reason: "paint failed",
    });
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { phase: "terminal", reloadPending: true },
    });

    await runtime.handleAlarm({ name: RENDER_INSPECTION_DEADLINE_ALARM });
    expect(reload).toHaveBeenCalledTimes(3);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { phase: "terminal", reloadPending: false },
    });
  });

  it("retires a fail-open fallback before current or reinjected content can adopt it", async () => {
    const durable = createRenderInspectionRepo(createMemoryStore());
    let rejectTerminal = true;
    const repo: RenderInspectionRepo = {
      ...durable,
      async save(record) {
        if (rejectTerminal && record.phase === "terminal") {
          throw new Error("terminal save failed");
        }
        await durable.save(record);
      },
    };
    const runtime = createRenderInspectionRuntime({
      repo,
      now: () => 1_000,
      tokenFactory: () => "unregister-fallback",
      driver: {
        setJavascriptEnabled: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
      },
    });
    const started = await runtime.start({
      tabId: 7,
      property: PROPERTY,
      pageUrl: PAGE_URL,
      javascriptEnabled: false,
      sourceDocumentId: "document-a",
    });
    if (started.status !== "started") throw new Error("inspection did not start");
    await runtime.navigationCommitted({ tabId: 7, documentId: "document-b", pageUrl: PAGE_URL });
    await runtime.adopt({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    });
    await expect(runtime.terminateTab(7, "unregistered")).rejects.toThrow("terminal save failed");
    await expect(durable.load(7)).resolves.toMatchObject({
      ok: true,
      value: { generation: 1, phase: "adopted", failOpenPending: true },
    });

    rejectTerminal = false;
    await expect(runtime.current(7)).resolves.toMatchObject({
      status: "terminal",
      session: { generation: 1, terminalReason: "unregistered" },
    });
    await expect(runtime.adopt({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-reinjected",
    })).resolves.toMatchObject({ status: "terminal" });
  });

  it("re-adopts a reinjected same document with a new nonce and fences the old nonce", async () => {
    const h = harness();
    const started = await startStatic(h);
    if (started.status !== "started") throw new Error("inspection did not start");
    await bindReplacement(h);
    await expect(h.runtime.adopt({
      tabId: 7,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-reinjected",
    })).resolves.toMatchObject({
      status: "adopt",
      session: { generation: 1, documentNonce: "nonce-reinjected" },
    });
    await expect(h.runtime.acknowledgePaint({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-b",
    })).resolves.toMatchObject({ status: "stale" });
    await expect(h.runtime.acknowledgePaint({
      tabId: 7,
      token: started.session.token,
      generation: started.session.generation,
      documentId: "document-b",
      pageUrl: PAGE_URL,
      documentNonce: "nonce-reinjected",
    })).resolves.toMatchObject({ status: "ok" });
  });
});
