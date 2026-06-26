import type { Browser } from "../common/browser";

type PropertyLockTimeoutId = ReturnType<WindowOrWorkerGlobalScope["setTimeout"]>;

type PropertyLockTimerHost = {
  setTimeout: (fn: () => void, ms?: number) => PropertyLockTimeoutId;
  clearTimeout: (id: PropertyLockTimeoutId) => void;
};

type PropertyLockPortClientDeps = {
  getTimerHost?: () => PropertyLockTimerHost | null;
  onPortCleared?: () => void;
  shouldSkipReconnect?: () => boolean;
  runSync: (options: { forceSiteIdRefresh: boolean }) => void;
  PROPERTY_LOCK_RECONNECT_DELAY_MS: number;
  getConnectedSiteId?: () => number | null;
  PROPERTY_LOCK_CONTENT_DISCONNECT: string;
  getClientId: () => string;
  connectRuntimePort: (options: { name: string }) => Browser.runtime.Port;
  PROPERTY_LOCK_PORT_NAME: string;
  consumeRuntimeLastErrorMessage: () => string;
};

export function createPropertyLockPortClient(deps: PropertyLockPortClientDeps) {
  let port: Browser.runtime.Port | null = null;
  let reconnectTimer: PropertyLockTimeoutId | 0 = 0;

  const getTimerHost = () => {
    if (typeof deps.getTimerHost === "function") {
      const timerHost = deps.getTimerHost();
      if (timerHost) {
        return timerHost;
      }
    }
    return (globalThis.window || globalThis) as PropertyLockTimerHost;
  };

  const clearPortState = () => {
    if (typeof deps.onPortCleared === "function") {
      deps.onPortCleared();
    }
  };

  const clearReconnectTimer = (): void => {
    if (!reconnectTimer) {
      return;
    }
    getTimerHost().clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  };

  const scheduleReconnect = (options: { forceSiteIdRefresh?: boolean } = {}): void => {
    const forceSiteIdRefresh = Boolean(options.forceSiteIdRefresh);
    if ((typeof deps.shouldSkipReconnect === "function" && deps.shouldSkipReconnect()) || reconnectTimer) {
      return;
    }
    reconnectTimer = getTimerHost().setTimeout(() => {
      reconnectTimer = 0;
      deps.runSync({ forceSiteIdRefresh });
    }, deps.PROPERTY_LOCK_RECONNECT_DELAY_MS);
  };

  const disconnect = ({ notifyBackground = true }: { notifyBackground?: boolean } = {}): void => {
    clearReconnectTimer();
    const currentPort = port;
    const currentSiteId = typeof deps.getConnectedSiteId === "function"
      ? deps.getConnectedSiteId()
      : null;

    port = null;
    clearPortState();

    if (!currentPort) {
      return;
    }

    if (notifyBackground && currentSiteId) {
      try {
        currentPort.postMessage({
          type: deps.PROPERTY_LOCK_CONTENT_DISCONNECT,
          siteId: currentSiteId,
          clientId: deps.getClientId()
        });
      } catch {
        // Background may already have torn down the port.
      }
    }

    try {
      currentPort.disconnect();
    } catch {
      // Port may already be disconnected.
    }
  };

  const connect = ({
    connectPayload,
    onMessage,
    onDisconnect,
    forceSiteIdRefresh = false
  }: {
    connectPayload?: unknown;
    onMessage?: ((message: unknown, port: Browser.runtime.Port) => void) | null;
    onDisconnect?: ((reason: string, options: { forceSiteIdRefresh: boolean }) => void) | null;
    forceSiteIdRefresh?: boolean;
  } = {}): Browser.runtime.Port => {
    let nextPort: Browser.runtime.Port | null = null;
    try {
      nextPort = deps.connectRuntimePort({ name: deps.PROPERTY_LOCK_PORT_NAME });
      port = nextPort;

      if (nextPort.onMessage && typeof nextPort.onMessage.addListener === "function" && typeof onMessage === "function") {
        nextPort.onMessage.addListener(onMessage);
      }

      if (nextPort.onDisconnect && typeof nextPort.onDisconnect.addListener === "function") {
        nextPort.onDisconnect.addListener(() => {
          const disconnectReason = deps.consumeRuntimeLastErrorMessage();
          if (port !== nextPort) {
            return;
          }
          port = null;
          clearPortState();
          if (typeof onDisconnect === "function") {
            onDisconnect(disconnectReason, { forceSiteIdRefresh });
          }
        });
      }

      if (connectPayload && typeof connectPayload === "object") {
        nextPort.postMessage(connectPayload);
      }

      return nextPort;
    } catch (error) {
      try {
        if (nextPort && typeof nextPort.disconnect === "function") {
          nextPort.disconnect();
        }
      } catch {
        // Ignore disconnect cleanup failures while connect already failed.
      }
      port = null;
      clearPortState();
      throw error;
    }
  };

  const postMessage = (message: unknown): void => {
    if (!port) {
      throw new Error("Property lock port unavailable");
    }
    port.postMessage(message);
  };

  return {
    clearReconnectTimer,
    connect,
    disconnect,
    getPort: () => port,
    hasPort: () => Boolean(port),
    hasReconnectTimer: () => Boolean(reconnectTimer),
    postMessage,
    scheduleReconnect
  };
}
