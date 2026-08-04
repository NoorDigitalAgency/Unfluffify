import { describe, expect, it } from "vitest";

import { createSignalCursor } from "../../../src/popup/signal-cursor";

/** A stand-in for the popup's pull: reads the cursor it was handed, waits, then
 *  answers everything after it — the shape that made two overlapping pulls
 *  deliver the same batch twice. */
function fakeStream(signals: readonly number[]) {
  const delivered: number[] = [];
  /** What each pull asked the bus for. A batch that repeats a seq an earlier pull
   *  already took is the waste the queue exists to prevent: the cursor guard would
   *  still drop it on arrival, but it was fetched, shipped and re-examined. */
  const batches: number[][] = [];
  return {
    delivered,
    batches,
    pull(cursor: ReturnType<typeof createSignalCursor>, delayTicks = 1): Promise<number> {
      return cursor.serialize(async (consumedThrough) => {
        const batch = signals.filter((seq) => seq > consumedThrough);
        batches.push(batch);
        for (let i = 0; i < delayTicks; i++) {
          await Promise.resolve();
        }
        let applied = 0;
        for (const seq of batch) {
          if (cursor.claim(seq)) {
            delivered.push(seq);
            applied += 1;
          }
        }
        return applied;
      });
    },
  };
}

/** Every seq any pull fetched, counted. Nothing should be fetched twice. */
function fetchCounts(batches: readonly number[][]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const batch of batches) {
    for (const seq of batch) {
      counts.set(seq, (counts.get(seq) ?? 0) + 1);
    }
  }
  return counts;
}

describe("popup signal cursor", () => {
  it("delivers each signal once when two pulls overlap", async () => {
    // The bug: both pulls read "consumed through 0", both fetch 1..6, both
    // deliver. The state machine hid it by ignoring a seq it had folded, but
    // everything else watching the stream saw every event twice.
    const stream = fakeStream([1, 2, 3, 4, 5, 6]);
    const cursor = createSignalCursor();

    const [first, second] = await Promise.all([stream.pull(cursor), stream.pull(cursor)]);

    expect(stream.delivered).toEqual([1, 2, 3, 4, 5, 6]);
    expect(first).toBe(6);
    // The second pull ran behind the first and found the cursor already advanced,
    // so it asked for nothing rather than re-fetching the whole batch.
    expect(second).toBe(0);
    expect(stream.batches).toEqual([[1, 2, 3, 4, 5, 6], []]);
    expect(cursor.consumedThrough()).toBe(6);
  });

  it("delivers each signal once across many concurrent pulls", async () => {
    const stream = fakeStream([1, 2, 3, 4, 5, 6, 7, 8]);
    const cursor = createSignalCursor();

    await Promise.all(Array.from({ length: 8 }, (_, i) => stream.pull(cursor, i + 1)));

    expect(stream.delivered).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // And nothing was fetched twice: the cursor guard would drop a repeat on
    // arrival, but eight pulls each shipping the same eight signals is the cost
    // the queue removes.
    for (const [seq, count] of fetchCounts(stream.batches)) {
      expect(count, `signal ${seq} was fetched ${count} times`).toBe(1);
    }
  });

  it("gives a queued pull the cursor the one ahead of it advanced", async () => {
    // Not the value from when it was queued — that is the whole defect.
    const seen: number[] = [];
    const cursor = createSignalCursor();

    const first = cursor.serialize(async (consumedThrough) => {
      seen.push(consumedThrough);
      await Promise.resolve();
      cursor.claim(5);
    });
    const second = cursor.serialize(async (consumedThrough) => {
      seen.push(consumedThrough);
    });
    await Promise.all([first, second]);

    expect(seen).toEqual([0, 5]);
  });

  it("picks up signals that arrive after a pull has finished", async () => {
    // Serializing must not mean "only ever fetch once".
    const cursor = createSignalCursor();
    const early = fakeStream([1, 2]);
    await early.pull(cursor);
    const late = fakeStream([1, 2, 3, 4]);
    await late.pull(cursor);

    expect(early.delivered).toEqual([1, 2]);
    expect(late.delivered).toEqual([3, 4]);
  });

  it("refuses a seq it has already consumed, whichever path offers it", async () => {
    // The emit tail can offer the same decisions a pull already took.
    const cursor = createSignalCursor();

    expect(cursor.claim(3)).toBe(true);
    expect(cursor.claim(3)).toBe(false);
    expect(cursor.claim(2)).toBe(false);
    expect(cursor.claim(4)).toBe(true);
    expect(cursor.consumedThrough()).toBe(4);
  });

  it("does not strand the queue when a body throws", async () => {
    const cursor = createSignalCursor();

    await expect(cursor.serialize(async () => {
      throw new Error("bus down");
    })).rejects.toThrow("bus down");
    // The next pull still runs, and still sees a live cursor.
    await expect(cursor.serialize(async (consumedThrough) => consumedThrough)).resolves.toBe(0);
  });

  it("forgets everything on a rebind, since the new tab's stream is unrelated", async () => {
    const cursor = createSignalCursor();
    cursor.claim(9);
    cursor.reset();

    expect(cursor.consumedThrough()).toBe(0);
    expect(cursor.claim(1)).toBe(true);
  });
});
