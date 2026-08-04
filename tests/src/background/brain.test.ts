import { describe, expect, it } from "vitest";

import { createRewriteBrain } from "../../../src/background/index";
import { decideSignals } from "../../../src/background/brain/decide";
import { createInitialTabFacts, fold } from "../../../src/background/brain/fold";
import { projectBrainState } from "../../../src/background/brain/project";
import { createSignalLog } from "../../../src/background/brain/signals";
import { createKeepAliveController } from "../../../src/background/keepalive";
import { persistDurableFacts, reDeriveVolatile, rehydrateDurableFacts } from "../../../src/background/persistence";
import { createRewriteBrainRuntime } from "../../../src/background/rewrite-brain-runtime";
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
    expect(next.reconciliationPending).toBe(false);
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

  it("serves consumed-once cursor requests through the mounted runtime", () => {
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

    const call = (message: unknown): unknown => {
      let response: unknown;
      listener?.(message, null, (value: unknown) => {
        response = value;
      });
      return response;
    };

    const observed = call({
      type: "uf.rewriteBrain.observe",
      sensation: {
        tabId: 1,
        source: "content",
        reason: "activate",
        facts: { tabId: 1, markingEnabled: true, baseUrl: "https://example.com" },
      },
    });
    expect(observed).toMatchObject({ ok: true, signals: [{ seq: 1, name: "marking.enabled" }] });
    expect(call({ type: "uf.rewriteBrain.pull", tabId: 1, afterSeq: 0 })).toMatchObject({
      ok: true,
      signals: [{ seq: 1, name: "marking.enabled" }],
    });
    expect(call({ type: "uf.rewriteBrain.consume", tabId: 1, organId: "popup", seq: 1 })).toEqual({ ok: true });
    expect(call({ type: "uf.rewriteBrain.pull", tabId: 1, afterSeq: 0, organId: "popup" })).toEqual({
      ok: true,
      signals: [],
    });
    expect(call({ type: "uf.rewriteBrain.snapshot", tabId: 1 })).toMatchObject({
      ok: true,
      projection: { signalHead: 1 },
    });
    expect(alarms).toContain("create:uf-rewrite-brain-keepalive");
    expect(alarms[0]).toBe("clear:uf-rewrite-brain-keepalive");
  });

  it("mounts runtime listeners through sendResponse", () => {
    let mounted: ((message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown) | null = null;
    const runtime = createRewriteBrainRuntime({
      addMessageListener(listener) {
        mounted = listener;
      },
    });
    runtime.start();
    let response: unknown = null;

    const keepChannelOpen = mounted?.({
      type: "uf.rewriteBrain.snapshot",
      tabId: 4,
    }, null, (value) => {
      response = value;
    });

    expect(keepChannelOpen).toBe(true);
    expect(response).toMatchObject({ ok: true });
  });

  it("treats an operator toggle as the marking change, not the row count", () => {
    const runtime = createRewriteBrainRuntime({ addMessageListener() {} });
    const observe = (facts: Record<string, unknown>) => runtime.handle({
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
    const first = observe({ markingToggleSeq: 0 });
    expect((first.signals ?? []).map((signal: { name?: string }) => signal.name)).not.toContain("markings.changed");

    // One toggle, one change.
    const second = observe({ markingToggleSeq: 1 });
    expect((second.signals ?? []).map((signal: { name?: string }) => signal.name)).toContain("markings.changed");

    // The same count again is not a new change, however much the page mutated.
    const third = observe({ markingToggleSeq: 1 });
    expect((third.signals ?? []).map((signal: { name?: string }) => signal.name)).not.toContain("markings.changed");
  });

  it("emits born-at-source signals through the runtime", () => {
    const runtime = createRewriteBrainRuntime({ addMessageListener() {} });
    const result = runtime.handle({
      type: "uf.rewriteBrain.emit",
      tabId: 2,
      signal: {
        name: "markings.changed",
        source: "content",
        cause: "user-marking-edit",
        payload: { pageUrl: "https://example.com", markedCount: 1 },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      signals: [{ name: "markings.changed", source: "content", cause: "user-marking-edit" }],
    });
  });

  it("attributes content-born tab-zero signal envelopes to the sender tab", () => {
    const runtime = createRewriteBrainRuntime({ addMessageListener() {} });
    const result = runtime.handle({
      type: "uf.rewriteBrain.emit",
      tabId: 0,
      signal: {
        name: "markings.changed",
        source: "content",
        cause: "content-click",
        payload: { pageUrl: "https://example.com", markedCount: 1 },
      },
    }, { tab: { id: 42 } });

    expect(result).toMatchObject({
      ok: true,
      signals: [{ tabId: 42, name: "markings.changed" }],
    });
    expect(runtime.handle({ type: "uf.rewriteBrain.pull", tabId: 42, afterSeq: 0 })).toMatchObject({
      ok: true,
      signals: [{ tabId: 42, name: "markings.changed" }],
    });
  });
});
