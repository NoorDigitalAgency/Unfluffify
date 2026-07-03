import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { createSignalLog } from "../src/background/brain/signal-log.js";
import { SIGNAL_NAMES } from "../src/common/bus/contracts/signals.js";

// REFLEX-ARC Phase 1: the brain-owned per-tab signal log — monotonic seq,
// double-fire dedupe, dedupeKey rule, bounded ring, cursor listing,
// serialize/hydrate for SW restarts.

function makeClock(start = 1000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => { t += ms; } };
}

const EMIT = {
  name: SIGNAL_NAMES.RUN_STARTED,
  source: "brain" as const,
  cause: "ai-run.started",
  payload: { sessionId: "s1" }
};

test("admission assigns per-tab monotonic seq and lists after a cursor", () => {
  const clock = makeClock();
  const log = createSignalLog({ now: clock.now });
  clock.tick(300);
  const a = log.admit(7, EMIT);
  clock.tick(300);
  const b = log.admit(7, { ...EMIT, name: SIGNAL_NAMES.RUN_COMPLETED, cause: "ai-run.resultsApplied" });
  clock.tick(300);
  const c = log.admit(9, EMIT);
  assert.equal(a.frame?.seq, 1);
  assert.equal(b.frame?.seq, 2);
  assert.equal(c.frame?.seq, 1, "seq is per tab");
  assert.equal(log.headSeq(7), 2);
  assert.deepEqual(log.listAfter(7, 1).map((f) => f.seq), [2]);
  assert.deepEqual(log.listAfter(7, 2), []);
  assert.equal(log.listAfter(7, 0).length, 2);
});

test("identical consecutive frames within the double-fire window are deduped", () => {
  const clock = makeClock();
  const log = createSignalLog({ now: clock.now });
  const first = log.admit(7, EMIT);
  clock.tick(100);
  const doubled = log.admit(7, EMIT);
  assert.equal(first.frame?.seq, 1);
  assert.equal(doubled.frame, null);
  assert.equal(doubled.deduped, true);
  clock.tick(500);
  const later = log.admit(7, EMIT);
  assert.equal(later.frame?.seq, 2, "outside the window it admits again");
  // A different cause inside the window is NOT a double-fire.
  clock.tick(50);
  const differentCause = log.admit(7, { ...EMIT, cause: "other-cause" });
  assert.equal(differentCause.frame?.seq, 3);
});

test("an explicit dedupeKey drops regardless of the window", () => {
  const clock = makeClock();
  const log = createSignalLog({ now: clock.now });
  const exitEmit = {
    name: SIGNAL_NAMES.PREVIEW_EXITED,
    source: "brain" as const,
    cause: "close-command-ack",
    payload: { restored: true },
    dedupeKey: "token:41"
  };
  assert.equal(log.admit(7, exitEmit).frame?.seq, 1);
  clock.tick(5000);
  const contentPush = log.admit(7, { ...exitEmit, cause: "content-close-push" });
  assert.equal(contentPush.frame, null, "same close token seconds later is the same close");
  const nextClose = log.admit(7, { ...exitEmit, dedupeKey: "token:42" });
  assert.equal(nextClose.frame?.seq, 2);
});

test("dedupe keys are scoped per signal name (a session keys started AND completed once each)", () => {
  const clock = makeClock();
  const log = createSignalLog({ now: clock.now });
  const key = "session:s1";
  assert.equal(log.admit(7, { ...EMIT, dedupeKey: key }).frame?.seq, 1);
  clock.tick(1000);
  const completed = log.admit(7, {
    name: SIGNAL_NAMES.RUN_COMPLETED,
    source: "brain",
    cause: "ai-run.resultsApplied",
    payload: { sessionId: "s1" },
    dedupeKey: key
  });
  assert.equal(completed.frame?.seq, 2, "same key under a different name admits");
  clock.tick(1000);
  const doubledCompleted = log.admit(7, {
    name: SIGNAL_NAMES.RUN_COMPLETED,
    source: "brain",
    cause: "ai-run.resultsApplied",
    payload: { sessionId: "s1" },
    dedupeKey: key
  });
  assert.equal(doubledCompleted.frame, null, "the live P1 duplicate: completed twice per session");
});

test("the ring is bounded but headSeq keeps counting", () => {
  const clock = makeClock();
  const log = createSignalLog({ now: clock.now });
  for (let i = 0; i < 140; i += 1) {
    clock.tick(300);
    log.admit(7, { ...EMIT, payload: { sessionId: `s${i}` } });
  }
  assert.equal(log.headSeq(7), 140);
  const frames = log.listAfter(7, 0);
  assert.equal(frames.length, 128, "ring capacity");
  assert.equal(frames[0].seq, 13, "oldest truncated");
});

test("serialize/hydrate keeps seq continuity across a SW restart", () => {
  const clock = makeClock();
  const log = createSignalLog({ now: clock.now });
  log.admit(7, EMIT);
  clock.tick(300);
  log.admit(7, { ...EMIT, cause: "second" });
  const restarted = createSignalLog({ now: clock.now });
  restarted.hydrate(JSON.parse(JSON.stringify(log.serialize())));
  assert.equal(restarted.headSeq(7), 2);
  assert.deepEqual(restarted.listAfter(7, 1).map((f) => f.seq), [2]);
  clock.tick(300);
  const next = restarted.admit(7, { ...EMIT, cause: "third" });
  assert.equal(next.frame?.seq, 3, "seq continues after hydration");
  restarted.resetTab(7);
  assert.equal(restarted.headSeq(7), 0);
});
