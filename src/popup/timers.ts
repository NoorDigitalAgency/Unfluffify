type PopupTimeoutId = ReturnType<Window["setTimeout"]>;
type PopupIntervalId = ReturnType<Window["setInterval"]>;

type PopupTimerWindow = {
  setTimeout: (fn: () => void, delay?: number) => PopupTimeoutId;
  clearTimeout: (id: PopupTimeoutId) => void;
  setInterval: (fn: () => void, delay?: number) => PopupIntervalId;
  clearInterval: (id: PopupIntervalId) => void;
};

type PopupTimerRecord =
  | { kind: "timeout"; id: PopupTimeoutId }
  | { kind: "interval"; id: PopupIntervalId };

function toSafeDelay(value: number | null | undefined, fallback: number | null | undefined = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return Math.max(0, Number(fallback) || 0);
  }
  return Math.trunc(numeric);
}

export function createPopupTimerGroup(options: { windowRef?: PopupTimerWindow } = {}) {
  const windowRef: PopupTimerWindow = options.windowRef || window;
  const timersByKey = new Map<unknown, PopupTimerRecord>();

  function clear(key: unknown): void {
    if (!timersByKey.has(key)) {
      return;
    }
    const timer = timersByKey.get(key);
    timersByKey.delete(key);
    if (!timer) {
      return;
    }
    if (timer.kind === "interval") {
      windowRef.clearInterval(timer.id);
      return;
    }
    windowRef.clearTimeout(timer.id);
  }

  function has(key: unknown): boolean {
    return timersByKey.has(key);
  }

  function setTimeoutTimer(key: unknown, callback: () => void, delayMs: number | null | undefined = 0): PopupTimeoutId {
    clear(key);
    const id = windowRef.setTimeout(() => {
      timersByKey.delete(key);
      callback();
    }, toSafeDelay(delayMs));
    timersByKey.set(key, {
      kind: "timeout",
      id
    });
    return id;
  }

  function setIntervalTimer(key: unknown, callback: () => void, intervalMs: number | null | undefined = 0): PopupIntervalId {
    clear(key);
    const id = windowRef.setInterval(callback, toSafeDelay(intervalMs));
    timersByKey.set(key, {
      kind: "interval",
      id
    });
    return id;
  }

  function clearAll(): void {
    for (const key of [...timersByKey.keys()]) {
      clear(key);
    }
  }

  return {
    clear,
    clearAll,
    has,
    setTimeout: setTimeoutTimer,
    setInterval: setIntervalTimer
  };
}
