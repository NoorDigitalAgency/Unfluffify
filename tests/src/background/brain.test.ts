import { describe, expect, it } from "vitest";

import { createRewriteBrain } from "../../../src/background/index";
import { decideSignals } from "../../../src/background/brain/decide";
import { createInitialTabFacts, fold } from "../../../src/background/brain/fold";
import { projectBrainState } from "../../../src/background/brain/project";
import { createSignalLog } from "../../../src/background/brain/signals";
import { createKeepAliveController } from "../../../src/background/keepalive";
import { persistDurableFacts, reDeriveVolatile, rehydrateDurableFacts } from "../../../src/background/persistence";
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
});
