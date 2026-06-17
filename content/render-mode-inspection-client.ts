type RenderModeInspectionWindow = {
  sessionStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
  setTimeout?: (fn: () => void, ms?: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
};

type RenderModeInspectionClientDeps = {
  getWindow?: () => RenderModeInspectionWindow | null;
  RENDER_MODE_INSPECTION_SESSION_KEY: string;
};

type WatchdogOptions = {
  timeoutMs?: unknown;
  onTimeout?: (() => void) | null;
};

export function createRenderModeInspectionClient(deps: RenderModeInspectionClientDeps) {
  let watchdogTimer: ReturnType<typeof setTimeout> | 0 = 0;

  const getWindow = (): RenderModeInspectionWindow | null => {
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

  const writeActiveFlag = (active: unknown): void => {
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

  const clearWatchdog = (): void => {
    const windowRef = getWindow();
    if (!windowRef || !watchdogTimer) {
      return;
    }
    if (typeof windowRef.clearTimeout === "function") {
      windowRef.clearTimeout(watchdogTimer as ReturnType<typeof setTimeout>);
    }
    watchdogTimer = 0;
  };

  const armWatchdog = ({ timeoutMs, onTimeout }: WatchdogOptions = {}): void => {
    const windowRef = getWindow();
    clearWatchdog();
    if (!windowRef || typeof windowRef.setTimeout !== "function") {
      return;
    }
    const normalizedTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, Math.trunc(timeoutMs as number)) : 0;
    watchdogTimer = windowRef.setTimeout(() => {
      watchdogTimer = 0;
      if (typeof onTimeout === "function") {
        onTimeout();
      }
    }, normalizedTimeoutMs);
  };

  return {
    armWatchdog,
    clearWatchdog,
    readActiveFlag,
    writeActiveFlag
  };
}
