/** The popup's record of which decided signals it has already consumed, and the
 *  queue that keeps that record honest.
 *
 *  Signals arrive from several places — a poll tick, a fresh tab binding, the tail
 *  of an emit — and every one of them is a read-modify-write over the same cursor:
 *  read "consumed through N", fetch what came after, then advance. Left
 *  unserialized, two overlapping arrivals each read N, each fetch the same batch,
 *  and each deliver it. The state machine survives that, because it ignores a seq
 *  it has already folded, but the signals are consumed twice on the way in, and
 *  anything else watching the stream — the activity log, a counter, an effect —
 *  sees each event twice.
 *
 *  So the cursor is the single source of truth for what has been consumed, and it
 *  is only ever read inside the queue. */
export type SignalCursor = Readonly<{
  /** The highest seq consumed so far. */
  consumedThrough: () => number;
  /** Records a seq as consumed. False when it already was, which is what makes a
   *  second delivery of the same signal a no-op rather than a duplicate. */
  claim: (seq: number) => boolean;
  /** Runs `body` with the cursor as it stands, one body at a time. A body queued
   *  behind another sees the cursor the first one advanced, not the stale value
   *  from when it was queued. */
  serialize: <T>(body: (consumedThrough: number) => Promise<T>) => Promise<T>;
  /** Runs an operator-critical read immediately, without joining the polling
   *  FIFO. The body must still claim every signal it adopts. That monotonic
   *  claim makes a delayed older polling batch harmless when it eventually
   *  returns. */
  prioritize: <T>(body: (consumedThrough: number) => Promise<T>) => Promise<T>;
  /** Forgets everything consumed — for a rebind, where the new tab's stream is
   *  unrelated to the old one's. */
  reset: () => void;
}>;

export function createSignalCursor(): SignalCursor {
  let consumedThrough = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    consumedThrough: () => consumedThrough,
    claim(seq) {
      if (seq <= consumedThrough) {
        return false;
      }
      consumedThrough = seq;
      return true;
    },
    serialize(body) {
      // `then(run, run)` so one body's failure does not strand the queue.
      const run = () => body(consumedThrough);
      const queued = queue.then(run, run);
      queue = queued.catch(() => undefined);
      return queued;
    },
    prioritize(body) {
      return body(consumedThrough);
    },
    reset() {
      consumedThrough = 0;
    },
  };
}
