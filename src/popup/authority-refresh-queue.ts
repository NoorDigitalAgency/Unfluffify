export type AuthorityRefreshQueueOptions = Readonly<{
  intervalMs: number;
  isPaused: () => boolean;
  run: (force: boolean) => Promise<void>;
  now?: () => number;
}>;

export type AuthorityRefreshQueue = Readonly<{
  queue(force?: boolean): Promise<void>;
  current(): Promise<void> | null;
  hasQueued(): boolean;
}>;

export function createAuthorityRefreshQueue(
  options: AuthorityRefreshQueueOptions,
): AuthorityRefreshQueue {
  const now = options.now ?? Date.now;
  let inFlight: Promise<void> | null = null;
  let queued = false;
  let forceQueued = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  const queue = (force = false): Promise<void> => {
    if (options.isPaused()) {
      queued = true;
      forceQueued ||= force;
      return Promise.resolve();
    }
    const effectiveForce = force || forceQueued;
    if (!effectiveForce && now() - lastStartedAt < options.intervalMs) {
      return Promise.resolve();
    }
    if (inFlight) {
      queued = true;
      forceQueued ||= force;
      return inFlight;
    }
    forceQueued ||= force;
    const operation = (async () => {
      do {
        queued = false;
        const runForced = forceQueued;
        forceQueued = false;
        lastStartedAt = now();
        await options.run(runForced);
      } while (queued && !options.isPaused());
    })();
    inFlight = operation.finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    queue,
    current: () => inFlight,
    hasQueued: () => queued,
  };
}
