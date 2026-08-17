export type KeepAliveRelease = () => void;

export type KeepAliveHost = Readonly<{
  createAlarm?: (name: string, info: { periodInMinutes: number }) => void | Promise<void>;
  clearAlarm?: (name: string) => void | Promise<void>;
  addAlarmListener?: (listener: (alarm: { name?: string }) => void) => void;
  holdMs?: number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}>;

export function createKeepAliveController(host: KeepAliveHost = {}) {
  const activeReasons = new Map<string, number>();
  const alarmName = "uf-rewrite-brain-keepalive";
  const timers = new Map<symbol, unknown>();
  const setTimer: (callback: () => void, delay: number) => unknown =
    host.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const syncAlarm = (): void => {
    if (activeReasons.size > 0) {
      void host.createAlarm?.(alarmName, { periodInMinutes: 0.5 });
    } else {
      void host.clearAlarm?.(alarmName);
    }
  };
  const decrement = (reason: string): void => {
    const nextCount = (activeReasons.get(reason) ?? 0) - 1;
    if (nextCount > 0) {
      activeReasons.set(reason, nextCount);
    } else {
      activeReasons.delete(reason);
    }
    syncAlarm();
  };
  const acquire = (reason: string, bounded: boolean): KeepAliveRelease => {
    activeReasons.set(reason, (activeReasons.get(reason) ?? 0) + 1);
    syncAlarm();
    let completed = false;
    let released = false;
    const timerKey = Symbol(reason);
    if (bounded && host.holdMs && host.holdMs > 0) {
      timers.set(timerKey, setTimer(() => {
        timers.delete(timerKey);
        if (!completed) {
          completed = true;
          decrement(reason);
        }
      }, host.holdMs));
    }
    return () => {
      if (released) {
        return;
      }
      released = true;
      // Ordinary message work receives a bounded grace hold even when its
      // synchronous handler has returned. Long-running work opts out and owns
      // the lease until its promise settles.
      if (timers.has(timerKey)) {
        return;
      }
      if (!completed) {
        completed = true;
        decrement(reason);
      }
    };
  };
  return {
    acquire(reason: string): KeepAliveRelease {
      return acquire(reason, true);
    },
    acquireUntilRelease(reason: string): KeepAliveRelease {
      return acquire(reason, false);
    },
    isActive(): boolean {
      return activeReasons.size > 0;
    },
    reasons(): readonly string[] {
      return [...activeReasons.keys()];
    },
    alarmName(): string {
      return alarmName;
    },
    clearIfIdle(): void {
      if (activeReasons.size === 0) {
        void host.clearAlarm?.(alarmName);
      }
    },
    handleAlarm(alarm: { name?: string }): void {
      if (alarm.name === alarmName && activeReasons.size === 0) {
        void host.clearAlarm?.(alarmName);
      }
    },
  };
}
