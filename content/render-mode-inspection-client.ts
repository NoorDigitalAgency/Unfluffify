// @ts-nocheck
export function createRenderModeInspectionClient(deps) {
  let watchdogTimer = 0;

  const getWindow = () => {
    if (typeof deps.getWindow === "function") {
      return deps.getWindow();
    }
    return globalThis.window || null;
  };

  const readActiveFlag = () => {
    const windowRef = getWindow();
    if (!windowRef || !windowRef.sessionStorage) {
      return false;
    }
    try {
      return windowRef.sessionStorage.getItem(deps.RENDER_MODE_INSPECTION_SESSION_KEY) === "1";
    } catch {
      return false;
    }
  };

  const writeActiveFlag = (active) => {
    const windowRef = getWindow();
    if (!windowRef || !windowRef.sessionStorage) {
      return;
    }
    try {
      if (active) {
        windowRef.sessionStorage.setItem(deps.RENDER_MODE_INSPECTION_SESSION_KEY, "1");
      } else {
        windowRef.sessionStorage.removeItem(deps.RENDER_MODE_INSPECTION_SESSION_KEY);
      }
    } catch {
      // Some pages block sessionStorage; caller still has in-memory guard.
    }
  };

  const clearWatchdog = () => {
    const windowRef = getWindow();
    if (!windowRef || !watchdogTimer) {
      return;
    }
    windowRef.clearTimeout(watchdogTimer);
    watchdogTimer = 0;
  };

  const armWatchdog = ({ timeoutMs, onTimeout } = {}) => {
    const windowRef = getWindow();
    clearWatchdog();
    if (!windowRef || typeof windowRef.setTimeout !== "function") {
      return;
    }
    watchdogTimer = windowRef.setTimeout(() => {
      watchdogTimer = 0;
      if (typeof onTimeout === "function") {
        onTimeout();
      }
    }, timeoutMs);
  };

  return {
    armWatchdog,
    clearWatchdog,
    readActiveFlag,
    writeActiveFlag
  };
}
