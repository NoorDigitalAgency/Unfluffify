/**
 * Property Edit Lock background module.
 * 
 * Manages WebSocket connections to the property lock hub, tracks content script ports,
 * and orchestrates lock state between the server and all connected clients.
 * 
 * Architecture:
 * - One WebSocket per siteId (shared across all tabs)
 * - Each content script opens a long-lived port to background (kept alive by content script)
 * - Background forwards server messages to all ports on the same siteId
 * - Ports are tracked to know when to close WebSocket (all ports disconnected)
 */

import {
  PROPERTY_LOCK_PORT_NAME,
  PROPERTY_LOCK_CONTENT_CONNECT,
  PROPERTY_LOCK_CONTENT_ACTIVITY,
  PROPERTY_LOCK_CONTENT_TAKE_LOCK,
  PROPERTY_LOCK_CONTENT_RELEASE,
  PROPERTY_LOCK_CONTENT_SUGGEST,
  PROPERTY_LOCK_CONTENT_RESPOND,
  PROPERTY_LOCK_CONTENT_CONTINUE,
  PROPERTY_LOCK_BACKGROUND_GET_STATE,
  PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
  PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
  PROPERTY_LOCK_CONNECTION_INACTIVE,
  PROPERTY_LOCK_CONNECTION_CONNECTING,
  PROPERTY_LOCK_CONNECTION_CONNECTED,
  PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
  PROPERTY_LOCK_WS_SUBSCRIBE,
  PROPERTY_LOCK_WS_HEARTBEAT,
  PROPERTY_LOCK_WS_ACTIVITY,
  PROPERTY_LOCK_WS_TAKE_LOCK,
  PROPERTY_LOCK_WS_RELEASE_LOCK,
  PROPERTY_LOCK_WS_SUGGEST_TAKEOVER,
  PROPERTY_LOCK_WS_RESPOND_TO_SUGGESTION,
  PROPERTY_LOCK_WS_CONTINUE_EDITING,
  PROPERTY_LOCK_WS_SUBSCRIBED,
  PROPERTY_LOCK_WS_LOCK_STATE,
  PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION,
  PROPERTY_LOCK_WS_SUGGESTION_RESPONSE,
  PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED,
  PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS,
  PROPERTY_LOCK_ACTIVITY_DEBOUNCE_MS,
  PROPERTY_LOCK_RECONNECT_DELAY_MS,
  PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS,
  buildPropertyLockWssUrl,
  normalizeLockStateMessage,
  createInactiveLockState
} from "./property-lock.js";
import * as utils from "./utilities.js";

/**
 * WebSocket connection runtime for a single siteId.
 */
class PropertyLockConnectionRuntime {
  constructor(siteId) {
    this.siteId = siteId;
    this.socket = null;
    this.state = createInactiveLockState();
    this.myIdentity = "";
    this.myName = "";
    this.isConnected = false;
    this.connectionStatus = PROPERTY_LOCK_CONNECTION_INACTIVE;
    this.connectionError = "";
    this.heartbeatTimer = null;
    this.activityDebounceTimer = null;
    this.lastActivityAt = 0;
    this.reconnectAttempts = 0;
    this.pendingSuggestions = new Map(); // suggestionId → {fromName, createdAt}
  }

  dispose() {
    if (this.socket) {
      try {
        this.socket.close(1000);
      } catch (e) {
        // Socket already closed
      }
      this.socket = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.activityDebounceTimer) {
      clearTimeout(this.activityDebounceTimer);
      this.activityDebounceTimer = null;
    }
  }
}

// Global state
const lockConnections = new Map(); // siteId → PropertyLockConnectionRuntime
const contentScriptPorts = new Map(); // portId → {port, siteId}
let portIdCounter = 0;

function hasContentPortsForSiteId(siteId) {
  return Array.from(contentScriptPorts.values()).some(
    (entry) => entry.siteId === siteId
  );
}

/**
 * Initialize property lock background module.
 * Sets up port listener for content script connections.
 */
export function initPropertyLockBackground() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === PROPERTY_LOCK_PORT_NAME) {
      handlePropertyLockPortConnect(port);
    }
  });
}

/**
 * Handle a new connection from content script.
 */
function handlePropertyLockPortConnect(port) {
  const portId = ++portIdCounter;
  let siteId = null;

  // Track port metadata
  const portEntry = {
    port,
    siteId: null
  };

  function onPortMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    const { type, siteId: msgSiteId, ...rest } = message;

    // First message should be connect
    if (type === PROPERTY_LOCK_CONTENT_CONNECT && msgSiteId) {
      siteId = typeof msgSiteId === "number" ? msgSiteId : null;
      portEntry.siteId = siteId;
      contentScriptPorts.set(portId, portEntry);

      if (siteId) {
        ensureConnectionForSiteId(siteId);
      }
      return;
    }

    // All other messages require prior connect
    if (!siteId) {
      return;
    }

    const runtime = lockConnections.get(siteId);
    if (!runtime || !runtime.isConnected) {
      return;
    }

    switch (type) {
      case PROPERTY_LOCK_CONTENT_ACTIVITY:
        debounceActivity(siteId);
        break;
      case PROPERTY_LOCK_CONTENT_TAKE_LOCK:
        sendToServer(runtime, { type: PROPERTY_LOCK_WS_TAKE_LOCK });
        break;
      case PROPERTY_LOCK_CONTENT_RELEASE:
        sendToServer(runtime, { type: PROPERTY_LOCK_WS_RELEASE_LOCK });
        break;
      case PROPERTY_LOCK_CONTENT_SUGGEST:
        sendToServer(runtime, { type: PROPERTY_LOCK_WS_SUGGEST_TAKEOVER });
        break;
      case PROPERTY_LOCK_CONTENT_RESPOND:
        if (typeof rest.accept === "boolean" && rest.suggestionId) {
          sendToServer(runtime, {
            type: PROPERTY_LOCK_WS_RESPOND_TO_SUGGESTION,
            suggestionId: String(rest.suggestionId),
            accept: rest.accept
          });
        }
        break;
      case PROPERTY_LOCK_CONTENT_CONTINUE:
        sendToServer(runtime, { type: PROPERTY_LOCK_WS_CONTINUE_EDITING });
        break;
    }
  }

  function onPortDisconnect() {
    contentScriptPorts.delete(portId);
    
    if (siteId) {
      scheduleDisconnectCheck(siteId);
    }
  }

  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(onPortDisconnect);
}

/**
 * Ensure WebSocket connection exists for a siteId.
 * Create if missing, reuse if exists.
 */
function ensureConnectionForSiteId(siteId) {
  if (typeof siteId !== "number") {
    return;
  }

  let runtime = lockConnections.get(siteId);
  if (runtime) {
    return; // Already exists
  }

  runtime = new PropertyLockConnectionRuntime(siteId);
  lockConnections.set(siteId, runtime);

  connectWebSocket(runtime);
}

function setConnectionStatus(runtime, status, error = "") {
  if (!runtime || (runtime.connectionStatus === status && runtime.connectionError === error)) {
    return;
  }
  runtime.connectionStatus = status;
  runtime.connectionError = error;
  broadcastToContentScriptPorts(runtime.siteId, {
    type: PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
    connectionStatus: status,
    error
  });
}

/**
 * Establish WebSocket connection for a runtime.
 */
function connectWebSocket(runtime) {
  if (runtime.isConnected || runtime.socket || !hasContentPortsForSiteId(runtime.siteId)) {
    return;
  }

  setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_CONNECTING);

  utils.storageGet(chrome.storage.sync, {
    globalConfigEndpoint: "",
    globalStageBase: "",
    globalToken: ""
  }).then((items) => {
    const endpointBase = items.globalConfigEndpoint || items.globalStageBase || "";
    const token = items.globalToken || "";

    const wssUrl = buildPropertyLockWssUrl(endpointBase, token);
    if (!wssUrl) {
      setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_UNAVAILABLE, token ? "invalid_endpoint" : "missing_token");
      scheduleReconnect(runtime);
      return;
    }

    try {
      runtime.socket = new WebSocket(wssUrl);
      runtime.socket.onopen = () => onWebSocketOpen(runtime);
      runtime.socket.onmessage = (event) => onWebSocketMessage(runtime, event);
      runtime.socket.onerror = () => onWebSocketError(runtime);
      runtime.socket.onclose = () => onWebSocketClose(runtime);
    } catch (e) {
      setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_UNAVAILABLE, "socket_create_failed");
      scheduleReconnect(runtime);
    }
  }).catch(() => {
    setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_UNAVAILABLE, "storage_unavailable");
    scheduleReconnect(runtime);
  });
}

/**
 * Handle WebSocket open.
 */
function onWebSocketOpen(runtime) {
  runtime.isConnected = true;
  runtime.reconnectAttempts = 0;
  setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_CONNECTED);

  // Send subscribe message with siteId
  sendToServer(runtime, {
    type: PROPERTY_LOCK_WS_SUBSCRIBE,
    siteId: runtime.siteId
  });

  // Start heartbeat
  if (runtime.heartbeatTimer) {
    clearInterval(runtime.heartbeatTimer);
  }
  runtime.heartbeatTimer = setInterval(() => {
    if (runtime.isConnected && runtime.socket) {
      sendToServer(runtime, { type: PROPERTY_LOCK_WS_HEARTBEAT });
    }
  }, PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS);
}

/**
 * Handle WebSocket message from server.
 */
function onWebSocketMessage(runtime, event) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch (e) {
    return;
  }

  if (!message || typeof message !== "object") {
    return;
  }

  const { type } = message;

  switch (type) {
    case PROPERTY_LOCK_WS_SUBSCRIBED:
      runtime.myIdentity = String(message.identity || runtime.myIdentity);
      runtime.myName = String(message.name || runtime.myIdentity);
      break;
    case PROPERTY_LOCK_WS_LOCK_STATE:
      runtime.state = normalizeLockStateMessage(message);
      break;
    case PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION:
      if (message.suggestionId) {
        runtime.pendingSuggestions.set(message.suggestionId, {
          fromName: String(message.fromName || ""),
          createdAt: Date.now()
        });
      }
      break;
    case PROPERTY_LOCK_WS_SUGGESTION_RESPONSE:
      if (message.suggestionId) {
        runtime.pendingSuggestions.delete(message.suggestionId);
      }
      break;
    case PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED:
      if (message.suggestionId) {
        runtime.pendingSuggestions.delete(message.suggestionId);
      }
      break;
  }

  // Broadcast message to all content script ports on this siteId
  broadcastToContentScriptPorts(runtime.siteId, message);
}

/**
 * Handle WebSocket error.
 */
function onWebSocketError(runtime) {
  runtime.isConnected = false;
  setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_UNAVAILABLE, "socket_error");
  scheduleReconnect(runtime);
}

/**
 * Handle WebSocket close.
 */
function onWebSocketClose(runtime) {
  runtime.isConnected = false;
  if (runtime.heartbeatTimer) {
    clearInterval(runtime.heartbeatTimer);
    runtime.heartbeatTimer = null;
  }
  setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_CONNECTING, "socket_closed");
  scheduleReconnect(runtime);
}

/**
 * Send message to WebSocket server.
 */
function sendToServer(runtime, message) {
  if (!runtime.isConnected || !runtime.socket) {
    return;
  }

  try {
    runtime.socket.send(JSON.stringify(message));
  } catch (e) {
    runtime.isConnected = false;
  }
}

/**
 * Broadcast server message to all content script ports on a siteId.
 */
function broadcastToContentScriptPorts(siteId, message) {
  for (const [, portEntry] of contentScriptPorts) {
    if (portEntry.siteId === siteId && portEntry.port) {
      try {
        portEntry.port.postMessage({
          type: PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
          message
        });
      } catch (e) {
        // Port may be closed
      }
    }
  }

  try {
    const updatePromise = chrome.runtime.sendMessage({
      type: PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
      siteId,
      message
    });
    if (updatePromise && typeof updatePromise.catch === "function") {
      updatePromise.catch(() => {});
    }
  } catch (e) {
    // No popup listener may be open.
  }
}

/**
 * Debounce activity messages (5s window).
 */
function debounceActivity(siteId) {
  const runtime = lockConnections.get(siteId);
  if (!runtime) {
    return;
  }

  const now = Date.now();
  if (now - runtime.lastActivityAt < PROPERTY_LOCK_ACTIVITY_DEBOUNCE_MS) {
    return; // Still in debounce window
  }

  runtime.lastActivityAt = now;
  sendToServer(runtime, { type: PROPERTY_LOCK_WS_ACTIVITY });
}

/**
 * Schedule WebSocket reconnect with exponential backoff.
 */
function scheduleReconnect(runtime) {
  if (lockConnections.get(runtime.siteId) !== runtime || !hasContentPortsForSiteId(runtime.siteId)) {
    return;
  }

  if (runtime.socket) {
    try {
      runtime.socket.close();
    } catch (e) {
      // Already closed
    }
    runtime.socket = null;
  }

  runtime.reconnectAttempts = (runtime.reconnectAttempts || 0) + 1;
  const delay = Math.min(
    PROPERTY_LOCK_RECONNECT_DELAY_MS * Math.pow(2, runtime.reconnectAttempts - 1),
    60_000 // Cap at 60s
  );

  setTimeout(() => {
    if (lockConnections.get(runtime.siteId) === runtime && hasContentPortsForSiteId(runtime.siteId)) {
      connectWebSocket(runtime);
    }
  }, delay);
}

/**
 * Schedule check for port disconnection (after 30s delay).
 * Close WebSocket if no ports remain connected for this siteId.
 */
function scheduleDisconnectCheck(siteId) {
  setTimeout(() => {
    const portsForSiteId = Array.from(contentScriptPorts.values()).filter(
      (entry) => entry.siteId === siteId
    );

    if (portsForSiteId.length === 0) {
      const runtime = lockConnections.get(siteId);
      if (runtime) {
        runtime.dispose();
        lockConnections.delete(siteId);
      }
    }
  }, PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS);
}

/**
 * Handle getPropertyLockState message from popup.
 */
export async function handleGetPropertyLockState(message, sender) {
  const siteId = message.siteId;
  if (typeof siteId !== "number") {
    return { state: createInactiveLockState() };
  }

  const runtime = lockConnections.get(siteId);
  if (!runtime || !runtime.isConnected) {
    return {
      state: runtime ? runtime.state : createInactiveLockState(),
      connectionStatus: runtime ? runtime.connectionStatus : PROPERTY_LOCK_CONNECTION_INACTIVE,
      error: runtime ? runtime.connectionError : ""
    };
  }

  return {
    state: runtime.state,
    identity: runtime.myIdentity,
    name: runtime.myName,
    connectionStatus: runtime.connectionStatus,
    error: runtime.connectionError
  };
}

function handlePropertyLockCommand(message) {
  const siteId = message.siteId;
  if (typeof siteId !== "number") {
    return { ok: false };
  }

  const runtime = lockConnections.get(siteId);
  if (!runtime || !runtime.isConnected) {
    return { ok: false };
  }

  switch (message.type) {
    case PROPERTY_LOCK_CONTENT_TAKE_LOCK:
      sendToServer(runtime, { type: PROPERTY_LOCK_WS_TAKE_LOCK });
      return { ok: true };
    case PROPERTY_LOCK_CONTENT_RELEASE:
      sendToServer(runtime, { type: PROPERTY_LOCK_WS_RELEASE_LOCK });
      return { ok: true };
    case PROPERTY_LOCK_CONTENT_SUGGEST:
      sendToServer(runtime, { type: PROPERTY_LOCK_WS_SUGGEST_TAKEOVER });
      return { ok: true };
    case PROPERTY_LOCK_CONTENT_CONTINUE:
      sendToServer(runtime, { type: PROPERTY_LOCK_WS_CONTINUE_EDITING });
      return { ok: true };
    case PROPERTY_LOCK_CONTENT_RESPOND:
      if (typeof message.accept !== "boolean" || !message.suggestionId) {
        return { ok: false };
      }
      sendToServer(runtime, {
        type: PROPERTY_LOCK_WS_RESPOND_TO_SUGGESTION,
        suggestionId: String(message.suggestionId),
        accept: message.accept
      });
      return { ok: true };
    default:
      return { ok: false };
  }
}

/**
 * Message handler for all property lock background messages.
 */
export async function handlePropertyLockBackgroundMessage(message, sender) {
  if (!message || !message.type) {
    return { ok: false };
  }

  const { type } = message;

  if (type === PROPERTY_LOCK_BACKGROUND_GET_STATE) {
    return handleGetPropertyLockState(message, sender);
  }

  if (
    type === PROPERTY_LOCK_CONTENT_TAKE_LOCK ||
    type === PROPERTY_LOCK_CONTENT_RELEASE ||
    type === PROPERTY_LOCK_CONTENT_SUGGEST ||
    type === PROPERTY_LOCK_CONTENT_RESPOND ||
    type === PROPERTY_LOCK_CONTENT_CONTINUE
  ) {
    return handlePropertyLockCommand(message);
  }

  return { ok: false };
}
