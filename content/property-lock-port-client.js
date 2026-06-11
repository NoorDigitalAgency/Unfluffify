export function createPropertyLockPortClient(deps) {
  let port = null;
  let reconnectTimer = 0;

  const getTimerHost = () => {
    if (typeof deps.getTimerHost === "function") {
      const timerHost = deps.getTimerHost();
      if (timerHost) {
        return timerHost;
      }
    }
    return globalThis.window || globalThis;
  };

  const clearPortState = () => {
    if (typeof deps.onPortCleared === "function") {
      deps.onPortCleared();
    }
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }
    getTimerHost().clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  };

  const scheduleReconnect = (options = {}) => {
    const forceSiteIdRefresh = Boolean(options.forceSiteIdRefresh);
    if ((typeof deps.shouldSkipReconnect === "function" && deps.shouldSkipReconnect()) || reconnectTimer) {
      return;
    }
    reconnectTimer = getTimerHost().setTimeout(() => {
      reconnectTimer = 0;
      deps.runSync({ forceSiteIdRefresh });
    }, deps.PROPERTY_LOCK_RECONNECT_DELAY_MS);
  };

  const disconnect = ({ notifyBackground = true } = {}) => {
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
      } catch (error) {
        // Background may already have torn down the port.
      }
    }

    try {
      currentPort.disconnect();
    } catch (error) {
      // Port may already be disconnected.
    }
  };

  const connect = ({ connectPayload, onMessage, onDisconnect, forceSiteIdRefresh = false } = {}) => {
    let nextPort = null;
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

  const postMessage = (message) => {
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
