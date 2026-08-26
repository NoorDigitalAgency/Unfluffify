export type SignalScheduler = Readonly<{
  /** Requests work without creating more than one coalesced trailing run. */
  request(): Promise<void>;
  /** Ensures one request and waits until the active/trailing work is settled. */
  drain(): Promise<void>;
  dispose(): void;
}>;

/**
 * Single-flight scheduler for the content signal lane. An interval/event storm
 * may request one trailing pass while a pull is active; it can never build a
 * promise FIFO whose age grows with the page's mutation or network latency.
 */
export function createSignalScheduler(run: () => Promise<void>): SignalScheduler {
  let active: Promise<void> | null = null;
  let trailing = false;
  let disposed = false;

  const launch = (): Promise<void> => {
    if (disposed) {
      return Promise.resolve();
    }
    if (active) {
      trailing = true;
      return active;
    }
    active = (async () => {
      do {
        trailing = false;
        await run();
      } while (trailing && !disposed);
    })().finally(() => {
      active = null;
      trailing = false;
    });
    return active;
  };

  return {
    request: launch,
    async drain() {
      await launch();
      while (active) {
        await active;
      }
    },
    dispose() {
      disposed = true;
      trailing = false;
    },
  };
}
