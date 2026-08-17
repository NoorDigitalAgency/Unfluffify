import { describe, expect, it, vi } from "vitest";

import { createRewriteBrain } from "../../../src/background/index";
import { decideSignals } from "../../../src/background/brain/decide";
import { createInitialTabFacts, fold } from "../../../src/background/brain/fold";
import { projectBrainState } from "../../../src/background/brain/project";
import { createSignalLog } from "../../../src/background/brain/signals";
import { createKeepAliveController } from "../../../src/background/keepalive";
import { persistDurableFacts, reDeriveVolatile, rehydrateDurableFacts } from "../../../src/background/persistence";
import { createRewriteBrainRuntime } from "../../../src/background/rewrite-brain-runtime";
import { createSignalCursor } from "../../../src/popup/signal-cursor";
import { createMemoryStore, createTabStateRepo } from "../../../src/storage";

describe("P3 background brain", () => {
  it("folds facts and disables marking on navigation", () => {
    const initial = fold(null, {
      tabId: 1,
      source: "content",
      reason: "activate",
      facts: {
        tabId: 1,
        pageUrl: "https://example.com/a",
        baseUrl: "https://example.com",
        markingEnabled: true,
        configPresent: true,
        lockRole: "editor",
      },
    });

    const next = fold(initial, {
      tabId: 1,
      source: "content",
      reason: "navigation",
      facts: {
        tabId: 1,
        pageUrl: "https://example.com/b",
      },
    });

    expect(next.markingEnabled).toBe(false);
    expect(next).toMatchObject({
      markingEnabled: false,
      markingToggleSeq: 0,
      runPhase: "idle",
      previewActive: false,
      previewExitRequested: false,
      reconciliationPending: false,
    });
  });

  it("preserves omitted fields on partial fact patches", () => {
    const initial = fold(null, {
      tabId: 1,
      source: "content",
      reason: "activate",
      facts: {
        tabId: 1,
        baseUrl: "https://example.com",
        markingEnabled: true,
        lockRole: "editor",
        configPresent: true,
      },
    });
    const next = fold(initial, {
      tabId: 1,
      source: "content",
      reason: "minor-update",
      facts: {
        tabId: 1,
        candidate: true,
      },
    });

    expect(next).toMatchObject({
      markingEnabled: true,
      lockRole: "editor",
      configPresent: true,
      candidate: true,
    });
  });

  it("decides activation, navigation, and reconciliation signals", () => {
    const prev = createInitialTabFacts(1);
    const next = {
      ...prev,
      baseUrl: "https://example.com",
      pageUrl: "https://example.com/a",
      markingEnabled: true,
      reconciliationPending: true,
    };

    expect(decideSignals(prev, next).map((decision) => decision.name)).toEqual([
      "marking.enabled",
      "reconciliation.started",
    ]);
    expect(decideSignals(prev, next)[0]?.payload).toMatchObject({
      pageUrl: "https://example.com/a",
    });
    expect(decideSignals(next, {
      ...next,
      pageUrl: "https://example.com/b",
      markingEnabled: false,
      reconciliationPending: false,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "session.navigated", payload: expect.objectContaining({ pageUrl: "https://example.com/b" }) }),
      expect.objectContaining({ name: "marking.disabled", payload: expect.objectContaining({ pageUrl: "https://example.com/b" }) }),
    ]));
    expect(decideSignals(next, {
      ...next,
      pageUrl: "https://example.com/b",
      markingEnabled: false,
      reconciliationPending: false,
    }).map(
      (decision) => decision.name,
    )).toEqual(["session.navigated", "marking.disabled", "reconciliation.ended"]);
  });

  it("decides preview exit request and restored completion as separate edges", () => {
    const open = {
      ...createInitialTabFacts(1),
      pageUrl: "https://example.com/page",
      previewActive: true,
      previewExitRequested: false,
    };
    const requested = { ...open, previewExitRequested: true };
    expect(decideSignals(open, requested)).toEqual([
      expect.objectContaining({
        name: "preview.exit.requested",
        payload: { pageUrl: "https://example.com/page", restore: true },
      }),
    ]);

    expect(decideSignals(requested, {
      ...requested,
      previewActive: false,
      previewExitRequested: false,
    })).toEqual([
      expect.objectContaining({
        name: "preview.exited",
        payload: { pageUrl: "https://example.com/page", restored: true },
      }),
    ]);
  });

  it("emits monotonic consumed-once signals", () => {
    const log = createSignalLog({ tabId: 1, now: () => 100 });
    const first = log.append({ name: "marking.enabled", cause: "activate-ok", payload: { baseUrl: "x" } });
    const second = log.append({ name: "session.saved", cause: "save-confirmed" });

    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(log.pull(1)).toEqual([second]);
    expect(log.pullUnconsumed("popup").map((signal) => signal.seq)).toEqual([1, 2]);
    log.markConsumed("popup", 1);
    expect(log.pullUnconsumed("popup").map((signal) => signal.seq)).toEqual([2]);
  });

  it("projects a minimal phase without per-field dictation", () => {
    expect(projectBrainState({
      tabId: 1,
      markingEnabled: true,
      lockRole: "editor",
      configPresent: true,
      reconciliationPending: false,
      lastSignalSeq: 2,
    }, 2)).toEqual({
      tabId: 1,
      phase: "marking",
      signalHead: 2,
      canEdit: true,
      blockedReason: "",
    });
  });

  it("persists durable facts and re-derives volatile state on wake", async () => {
    const repo = createTabStateRepo(createMemoryStore());
    const facts = {
      tabId: 3,
      markingEnabled: true,
      lockRole: "editor" as const,
      configPresent: true,
      reconciliationPending: true,
      lastSignalSeq: 5,
    };

    await persistDurableFacts(repo, facts, 10);
    const rehydrated = await rehydrateDurableFacts(repo, 3);

    expect(rehydrated).toEqual(facts);
    expect(reDeriveVolatile(facts).reconciliationPending).toBe(false);
  });

  it("tracks active keepalive reasons idempotently", () => {
    const keepAlive = createKeepAliveController();
    const release = keepAlive.acquire("ai-run");
    const releaseSecond = keepAlive.acquire("ai-run");

    expect(keepAlive.isActive()).toBe(true);
    expect(keepAlive.reasons()).toEqual(["ai-run"]);
    release();
    expect(keepAlive.isActive()).toBe(true);
    releaseSecond();
    release();
    expect(keepAlive.isActive()).toBe(false);
  });

  it("keeps an until-release lease beyond the ordinary bounded hold", () => {
    const timers: Array<() => void> = [];
    const cleared: string[] = [];
    const keepAlive = createKeepAliveController({
      holdMs: 30_000,
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
      createAlarm() {},
      clearAlarm(name) {
        cleared.push(name);
      },
    });
    const releaseOrdinary = keepAlive.acquire("ordinary-event");
    const releaseAi = keepAlive.acquireUntilRelease("ai.run");

    releaseOrdinary();
    timers.forEach((callback) => callback());
    keepAlive.handleAlarm({ name: keepAlive.alarmName() });

    expect(keepAlive.isActive()).toBe(true);
    expect(keepAlive.reasons()).toEqual(["ai.run"]);
    expect(cleared).toEqual([]);

    releaseAi();
    expect(keepAlive.isActive()).toBe(false);
    expect(cleared).toEqual([keepAlive.alarmName()]);
  });

  it("runs a headless observe -> signal -> projection loop", () => {
    const brain = createRewriteBrain(9);
    const emitted = brain.observe({
      tabId: 9,
      source: "popup",
      reason: "activate",
      facts: {
        tabId: 9,
        baseUrl: "https://example.com",
        markingEnabled: true,
        lockRole: "editor",
        configPresent: true,
      },
    });

    expect(emitted.map((signal) => signal.name)).toEqual(["marking.enabled"]);
    expect(brain.project()).toMatchObject({ phase: "marking", signalHead: 1 });
    expect(brain.snapshot()).toMatchObject({ lastSignalSeq: 1 });
    expect(brain.pullSignals(0)).toEqual(emitted);
  });

  it("decides exactly one marking-enabled signal from repeated activation facts", () => {
    const brain = createRewriteBrain(9);
    const activationFact = {
      tabId: 9,
      source: "popup" as const,
      reason: "marking-activated",
      facts: {
        tabId: 9,
        pageUrl: "https://example.com/page",
        baseUrl: "https://example.com",
        markingEnabled: true,
      },
    };

    const first = brain.observe(activationFact);
    const duplicate = brain.observe(activationFact);

    expect(first).toMatchObject([{
      name: "marking.enabled",
      source: "brain",
      cause: "activate-ok",
    }]);
    expect(duplicate).toEqual([]);
    expect(brain.pullSignals(0).filter((signal) => signal.name === "marking.enabled")).toHaveLength(1);
  });

  it("starts signal sequencing from rehydrated facts", () => {
    const brain = createRewriteBrain(9, {
      tabId: 9,
      markingEnabled: false,
      lockRole: "unknown",
      configPresent: false,
      reconciliationPending: false,
      lastSignalSeq: 10,
    });
    const emitted = brain.observe({
      tabId: 9,
      source: "popup",
      reason: "activate",
      facts: {
        tabId: 9,
        baseUrl: "https://example.com",
        markingEnabled: true,
      },
    });

    expect(emitted[0].seq).toBe(11);
    expect(brain.snapshot()).toMatchObject({ lastSignalSeq: 11 });
  });

  it("does not let non-emitting patches roll back the brain-owned signal head", () => {
    const brain = createRewriteBrain(9, {
      tabId: 9,
      markingEnabled: false,
      lockRole: "unknown",
      configPresent: false,
      reconciliationPending: false,
      lastSignalSeq: 10,
    });

    const emitted = brain.observe({
      tabId: 9,
      source: "content",
      reason: "heartbeat",
      facts: {
        tabId: 9,
        candidate: true,
      },
    });

    expect(emitted).toEqual([]);
    expect(brain.snapshot()).toMatchObject({ lastSignalSeq: 10, candidate: true });
  });

  it("rehydrates the durable head once before the first post-restart signal", async () => {
    const repo = createTabStateRepo(createMemoryStore());
    const firstRuntime = createRewriteBrainRuntime({ addMessageListener() {} });
    const first = await firstRuntime.handle({
      type: "uf.rewriteBrain.observe",
      sensation: {
        tabId: 9,
        source: "popup",
        reason: "activate",
        facts: {
          tabId: 9,
          pageUrl: "https://example.com/page",
          baseUrl: "https://example.com",
          markingEnabled: true,
        },
      },
    }) as { signals: Array<{ seq: number }> };
    const firstBrain = await firstRuntime.getBrain(9);
    const durable = firstBrain.snapshot();
    expect(durable).not.toBeNull();
    if (!durable) {
      throw new Error("first runtime did not produce durable facts");
    }
    await persistDurableFacts(repo, durable, 10);

    const cursor = createSignalCursor();
    expect(cursor.claim(first.signals[0].seq)).toBe(true);
    const rehydrate = vi.fn((tabId: number) => rehydrateDurableFacts(repo, tabId));
    const restartedRuntime = createRewriteBrainRuntime({
      addMessageListener() {},
      rehydrateDurableFacts: rehydrate,
    });
    const [resumed, resumedBrain] = await Promise.all([
      restartedRuntime.handle({
        type: "uf.rewriteBrain.observe",
        sensation: {
          tabId: 9,
          source: "popup",
          reason: "deactivate",
          facts: { tabId: 9, markingEnabled: false },
        },
      }) as Promise<{ signals: Array<{ seq: number }> }>,
      restartedRuntime.getBrain(9),
    ]);

    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(resumed.signals[0].seq).toBe(2);
    expect(resumedBrain.snapshot()).toMatchObject({ lastSignalSeq: 2 });
    expect(cursor.claim(resumed.signals[0].seq)).toBe(true);
    expect(cursor.consumedThrough()).toBe(2);
  });

  it("serves consumed-once cursor requests through the mounted runtime", async () => {
    let listener: ((message: unknown) => unknown) | null = null;
    const alarms: string[] = [];
    const runtime = createRewriteBrainRuntime({
      addMessageListener(next) {
        listener = next;
      },
      createAlarm(name) {
        alarms.push(`create:${name}`);
      },
      clearAlarm(name) {
        alarms.push(`clear:${name}`);
      },
      addAlarmListener(listener) {
        listener({ name: "uf-rewrite-brain-keepalive" });
      },
    });
    runtime.start();

    const call = async (message: unknown): Promise<unknown> => await new Promise((resolve) => {
      const keepOpen = listener?.(message, null, (value: unknown) => {
        resolve(value);
      });
      expect(keepOpen).toBe(true);
    });

    const observed = await call({
      type: "uf.rewriteBrain.observe",
      sensation: {
        tabId: 1,
        source: "content",
        reason: "activate",
        facts: { tabId: 1, markingEnabled: true, baseUrl: "https://example.com" },
      },
    });
    expect(observed).toMatchObject({ ok: true, signals: [{ seq: 1, name: "marking.enabled" }] });
    expect(await call({ type: "uf.rewriteBrain.pull", tabId: 1, afterSeq: 0 })).toMatchObject({
      ok: true,
      signals: [{ seq: 1, name: "marking.enabled" }],
    });
    expect(await call({ type: "uf.rewriteBrain.consume", tabId: 1, organId: "popup", seq: 1 })).toEqual({ ok: true });
    expect(await call({ type: "uf.rewriteBrain.pull", tabId: 1, afterSeq: 0, organId: "popup" })).toEqual({
      ok: true,
      signals: [],
    });
    expect(await call({ type: "uf.rewriteBrain.snapshot", tabId: 1 })).toMatchObject({
      ok: true,
      projection: { signalHead: 1 },
    });
    expect(alarms).toContain("create:uf-rewrite-brain-keepalive");
    expect(alarms[0]).toBe("clear:uf-rewrite-brain-keepalive");
  });

  it("mounts runtime listeners through sendResponse", async () => {
    let mounted: ((message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown) | null = null;
    const runtime = createRewriteBrainRuntime({
      addMessageListener(listener) {
        mounted = listener;
      },
    });
    runtime.start();
    const response = await new Promise<unknown>((resolve) => {
      const keepChannelOpen = mounted?.({
        type: "uf.rewriteBrain.snapshot",
        tabId: 4,
      }, null, resolve);
      expect(keepChannelOpen).toBe(true);
    });

    expect(response).toMatchObject({ ok: true });
  });

  it("treats an operator toggle as the marking change, not the row count", async () => {
    const runtime = createRewriteBrainRuntime({ addMessageListener() {} });
    const observe = async (facts: Record<string, unknown>) => await runtime.handle({
      type: "uf.rewriteBrain.observe",
      tabId: 7,
      sensation: {
        tabId: 7,
        source: "content",
        reason: "marking-toggle",
        facts: { tabId: 7, pageUrl: "https://example.com/page", baseUrl: "https://example.com", markingEnabled: true, ...facts },
      },
    });

    // Arriving at the session emits nothing about markings.
    const first = await observe({ markingToggleSeq: 0 }) as { signals?: Array<{ name: string }> };
    expect((first.signals ?? []).map((signal: { name?: string }) => signal.name)).not.toContain("markings.changed");

    // One toggle, one change.
    const second = await observe({ markingToggleSeq: 1 }) as { signals?: Array<{ name: string }> };
    expect((second.signals ?? []).map((signal: { name?: string }) => signal.name)).toContain("markings.changed");

    // The same count again is not a new change, however much the page mutated.
    const third = await observe({ markingToggleSeq: 1 }) as { signals?: Array<{ name: string }> };
    expect((third.signals ?? []).map((signal: { name?: string }) => signal.name)).not.toContain("markings.changed");
  });

  it("derives popup outcomes as brain-sourced signals with their decision payloads", () => {
    const brain = createRewriteBrain(2);
    const observe = (reason: string, facts: Record<string, unknown>) => brain.observe({
      tabId: 2,
      source: "popup",
      reason,
      facts: { tabId: 2, pageUrl: "https://example.com/page", ...facts },
    });

    expect(observe("ai-run-started", {
      runPhase: "running",
      runSessionId: "client-1",
      runDeadlineAt: 480_000,
    })).toMatchObject([{
      name: "run.started",
      source: "brain",
      payload: { sessionId: "client-1", deadlineAt: 480_000 },
    }]);
    expect(observe("ai-run-completed", {
      runPhase: "completed",
      runSessionId: "client-1",
      runAiSessionId: "backend-1",
      runSelectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    })).toMatchObject([{
      name: "run.completed",
      source: "brain",
      payload: {
        sessionId: "client-1",
        aiSessionId: "backend-1",
        selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      },
    }]);
    expect(observe("preview-opened", { previewActive: true, previewOrigin: "silent" })).toMatchObject([{
      name: "preview.opened",
      source: "brain",
      payload: { origin: "silent" },
    }]);
    expect(observe("save-started", {
      reconciliationPending: true,
      reconciliationReason: "saving",
    })).toMatchObject([{
      name: "reconciliation.started",
      source: "brain",
      payload: { reason: "saving" },
    }]);
    expect(observe("session-saved", { savedSeq: 1 })).toMatchObject([{
      name: "session.saved",
      source: "brain",
    }]);
    expect(brain.pullSignals(0).every((signal) => signal.source === "brain")).toBe(true);
  });

  it("derives property-lock overlay edges from observed lock facts", () => {
    const brain = createRewriteBrain(2);
    const observe = (facts: Record<string, unknown>) => brain.observe({
      tabId: 2,
      source: "background",
      reason: "property-lock",
      facts: { tabId: 2, pageUrl: "https://example.com/page", ...facts },
    });

    expect(observe({
      lockRole: "passive",
      lockCanEdit: false,
      lockBlockedReason: "locked",
      lockBanner: { visible: true, reason: "locked", editorName: "Dana", countdownSeconds: 42 },
    })).toMatchObject([{
      name: "lock.blocked",
      source: "brain",
      payload: {
        blockedReason: "locked",
        banner: { visible: true, reason: "locked", editorName: "Dana", countdownSeconds: 42 },
      },
    }]);
    expect(observe({
      lockRole: "passive",
      lockCanEdit: false,
      lockBlockedReason: "locked",
      lockBanner: { visible: true, reason: "locked", editorName: "Dana", countdownSeconds: 42 },
    })).toEqual([]);
    expect(observe({
      lockRole: "editor",
      lockCanEdit: true,
      lockBlockedReason: "editor",
      lockBanner: { visible: false, reason: "editor" },
    })).toMatchObject([{ name: "lock.acquired", source: "brain" }]);
  });

  it("rejects the retired raw signal-emission runtime message", () => {
    const runtime = createRewriteBrainRuntime({ addMessageListener() {} });
    expect(runtime.handle({
      type: "uf.rewriteBrain.emit",
      tabId: 2,
      signal: {
        name: "session.saved",
        source: "popup",
        cause: "bypass",
        payload: {},
      },
    })).toBeUndefined();
  });
});
