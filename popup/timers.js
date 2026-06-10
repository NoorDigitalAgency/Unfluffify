function toSafeDelay(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return Math.max(0, Number(fallback) || 0);
  }
  return Math.trunc(numeric);
}

export function createPopupTimerGroup(options = {}) {
  const windowRef = options.windowRef || window;
  const timersByKey = new Map();

  function clear(key) {
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

  function has(key) {
    return timersByKey.has(key);
  }

  function setTimeoutTimer(key, callback, delayMs = 0) {
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

  function setIntervalTimer(key, callback, intervalMs = 0) {
    clear(key);
    const id = windowRef.setInterval(callback, toSafeDelay(intervalMs));
    timersByKey.set(key, {
      kind: "interval",
      id
    });
    return id;
  }

  function clearAll() {
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
