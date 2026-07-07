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
  const timers = new Map<string, unknown>();
  const setTimer: (callback: () => void, delay: number) => unknown =
    host.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const clearTimer: (handle: unknown) => void =
    host.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as number));
  const syncAlarm = (): void => {
    if (activeReasons.size > 0) {
      void host.createAlarm?.(alarmName, { periodInMinutes: 0.5 });
    } else {
      void host.clearAlarm?.(alarmName);
    }
  };
  return {
    acquire(reason: string): KeepAliveRelease {
      activeReasons.set(reason, (activeReasons.get(reason) ?? 0) + 1);
      syncAlarm();
      if (host.holdMs && host.holdMs > 0) {
        const existing = timers.get(reason);
        if (existing) {
          clearTimer(existing);
        }
        timers.set(reason, setTimer(() => {
          timers.delete(reason);
          activeReasons.delete(reason);
          syncAlarm();
        }, host.holdMs));
      }
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        const timer = timers.get(reason);
        if (!timer) {
          // Bounded holds stay alive until their timeout expires.
        }
        if (timer && !host.holdMs) {
          clearTimer(timer);
          timers.delete(reason);
        }
        if (timer && host.holdMs) {
          return;
        }
        const nextCount = (activeReasons.get(reason) ?? 0) - 1;
        if (nextCount > 0) {
          activeReasons.set(reason, nextCount);
        } else {
          activeReasons.delete(reason);
        }
        syncAlarm();
      };
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
