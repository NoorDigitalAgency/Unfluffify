/**
 * Service-worker keepalive.
 *
 * MV3 service workers idle-suspend after ~30s with no events. That would kill an
 * in-flight AI run poll loop or a live property-lock WebSocket — together with
 * the in-memory state they depend on — whenever nothing else keeps the worker
 * awake (for example when the side panel is closed mid-run). This refcounted
 * keepalive uses the documented pattern of periodically calling a cheap
 * extension API to reset the idle timer while at least one caller holds it.
 * Callers acquire() when long-lived work starts and release() when it ends; the
 * periodic ping runs only while the active count is above zero.
 */

type IntervalHandle = ReturnType<typeof setInterval>;

interface SwKeepAliveDeps {
  setIntervalRef: (callback: () => void, ms: number) => IntervalHandle;
  clearIntervalRef: (handle: IntervalHandle) => void;
  ping: () => void;
  intervalMs?: number;
}

// Below the 30s MV3 idle-suspension threshold so each interval resets the timer
// with margin to spare.
export const SW_KEEPALIVE_DEFAULT_INTERVAL_MS = 20000;

export function createSwKeepAlive(deps: SwKeepAliveDeps) {
  const intervalMs =
    typeof deps.intervalMs === "number" && Number.isFinite(deps.intervalMs) && deps.intervalMs > 0
      ? Math.trunc(deps.intervalMs)
      : SW_KEEPALIVE_DEFAULT_INTERVAL_MS;
  let refCount = 0;
  let timer: IntervalHandle | null = null;

  function runPing(): void {
    try {
      deps.ping();
    } catch {
      // Keepalive pings are best-effort; a failed ping must never throw.
    }
  }

  function start(): void {
    if (timer !== null) {
      return;
    }
    timer = deps.setIntervalRef(runPing, intervalMs);
    // Ping immediately so the idle timer is reset without waiting a full interval.
    runPing();
  }

  function stop(): void {
    if (timer === null) {
      return;
    }
    deps.clearIntervalRef(timer);
    timer = null;
  }

  function acquire(): void {
    refCount += 1;
    if (refCount === 1) {
      start();
    }
  }

  function release(): void {
    if (refCount === 0) {
      return;
    }
    refCount -= 1;
    if (refCount === 0) {
      stop();
    }
  }

  function getActiveCount(): number {
    return refCount;
  }

  function isRunning(): boolean {
    return timer !== null;
  }

  return {
    acquire,
    release,
    getActiveCount,
    isRunning
  };
}
