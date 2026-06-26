/**
 * Property Edit Lock background module.
 * 
 * Manages WebSocket connections to the property lock hub, tracks content script ports,
 * and orchestrates lock state between the server and all connected clients.
 * 
 * Architecture:
 * - One WebSocket per property client session, keyed by siteId + stable clientId
 * - Each content script opens a long-lived port and supplies its page-session clientId
 * - Background forwards server messages only to ports for that client session
 * - Tab IDs are used only for local popup-to-port lookup, never as lock identity
 */

import { browser, type Browser } from "./browser";
import {
  PROPERTY_LOCK_PORT_NAME,
  PROPERTY_LOCK_CONTENT_CONNECT,
  PROPERTY_LOCK_CONTENT_DISCONNECT,
  PROPERTY_LOCK_CONTENT_ACTIVITY,
  PROPERTY_LOCK_CONTENT_DRAFT_STATUS,
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
  PROPERTY_LOCK_STATE_LOCKED,
  PROPERTY_LOCK_WS_SUBSCRIBE,
  PROPERTY_LOCK_WS_HEARTBEAT,
  PROPERTY_LOCK_WS_ACTIVITY,
  PROPERTY_LOCK_WS_TAKE_LOCK,
  PROPERTY_LOCK_WS_RELEASE_LOCK,
  PROPERTY_LOCK_WS_SUGGEST_TAKEOVER,
  PROPERTY_LOCK_WS_RESPOND_TO_SUGGESTION,
  PROPERTY_LOCK_WS_CONTINUE_EDITING,
  PROPERTY_LOCK_WS_CLIENT_STATUS,
  PROPERTY_LOCK_WS_SUBSCRIBED,
  PROPERTY_LOCK_WS_LOCK_STATE,
  PROPERTY_LOCK_WS_DISCONNECT_WARNING,
  PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION,
  PROPERTY_LOCK_WS_SUGGESTION_RESPONSE,
  PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED,
  PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS,
  PROPERTY_LOCK_ACTIVITY_DEBOUNCE_MS,
  PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS,
  PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS,
  PROPERTY_LOCK_NETWORK_CHECK_TIMEOUT_MS,
  PROPERTY_LOCK_NETWORK_CHECK_URLS,
  PROPERTY_LOCK_RECONNECT_DELAY_MS,
  PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS,
  normalizePropertyLockSiteId,
  normalizePropertyLockClientId,
  createPropertyLockClientId,
  buildPropertyLockWssUrl,
  normalizeLockStateMessage,
  createInactiveLockState
} from "./property-lock";
import {
  FEATURE_DISABLED_REASON,
  isFeatureEnabled
} from "./feature-flags";
import { getPropertyLockConnectionSettings } from "./settings-store";

/** Normalized lock-state shape produced by the property-lock helpers. */
type LockState = ReturnType<typeof createInactiveLockState>;

/** A property-lock message exchanged over content ports, the WebSocket, or runtime messaging. */
interface PropertyLockMessage {
  type?: string;
  siteId?: unknown;
  clientId?: unknown;
  tabId?: unknown;
  pageUrl?: unknown;
  hasUnsavedChanges?: unknown;
  accept?: unknown;
  suggestionId?: string;
  discardUnsaved?: unknown;
  discardPrevious?: unknown;
  force?: unknown;
  dirty?: unknown;
  identity?: unknown;
  name?: unknown;
  fromName?: unknown;
  [key: string]: unknown;
}

/** Outbound message payload serialized to the WebSocket or forwarded to ports/popup. */
type OutboundMessage = Record<string, unknown>;

/** Per-port bookkeeping for a connected content script. */
interface PortEntry {
  port: Browser.runtime.Port;
  siteId: number | null;
  clientId: string;
  connectionKey: string;
  tabId: number | null;
  pageUrl: string;
  hasUnsavedChanges: boolean;
}

/** A pending takeover suggestion tracked per runtime. */
interface TakeoverSuggestionEntry {
  fromName: string;
  createdAt: number;
}

/**
 * Coerce an arbitrary tab-id value to a finite integer tab id, or `null`.
 */
function normalizeTabId(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * WebSocket connection runtime for a single siteId.
 */
class PropertyLockConnectionRuntime {
  siteId: number | null;
  clientId: string;
  connectionKey: string;
  socket: WebSocket | null;
  state: LockState;
  myIdentity: string;
  myName: string;
  pageUrl: string;
  tabId: number | null;
  hasUnsavedChanges: boolean;
  isConnected: boolean;
  connectionStatus: string;
  connectionError: string;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  activityDebounceTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  connectionLossTimer: ReturnType<typeof setTimeout> | null;
  networkCheckAbortController: AbortController | null;
  lastActivityAt: number;
  reconnectAttempts: number;
  pendingSuggestions: Map<string, TakeoverSuggestionEntry>;
  keepAliveHeld: boolean;

  constructor(siteId: number | null, clientId: string) {
    this.siteId = siteId;
    this.clientId = clientId;
    this.connectionKey = buildConnectionKey(siteId, clientId);
    this.socket = null;
    this.state = createInactiveLockState();
    this.myIdentity = "";
    this.myName = "";
    this.pageUrl = "";
    this.tabId = null;
    this.hasUnsavedChanges = false;
    this.isConnected = false;
    this.connectionStatus = PROPERTY_LOCK_CONNECTION_INACTIVE;
    this.connectionError = "";
    this.heartbeatTimer = null;
    this.activityDebounceTimer = null;
    this.reconnectTimer = null;
    this.connectionLossTimer = null;
    this.networkCheckAbortController = null;
    this.lastActivityAt = 0;
    this.reconnectAttempts = 0;
    this.pendingSuggestions = new Map(); // suggestionId → {fromName, createdAt}
    this.keepAliveHeld = false;
  }

  dispose() {
    if (this.socket) {
      try {
        this.socket.close(1000);
      } catch (_e) {
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectionLossTimer) {
      clearTimeout(this.connectionLossTimer);
      this.connectionLossTimer = null;
    }
    if (this.networkCheckAbortController) {
      try {
        this.networkCheckAbortController.abort();
      } catch (_e) {
        // Ignore abort errors.
      }
      this.networkCheckAbortController = null;
    }
  }
}

// Global state
const lockConnections = new Map<string, PropertyLockConnectionRuntime>(); // `${siteId}:${clientId}` → PropertyLockConnectionRuntime
const contentScriptPorts = new Map<number, PortEntry>(); // portId → {port, siteId, clientId, connectionKey, tabId}
let portIdCounter = 0;
const PROPERTY_LOCK_FEATURE_NAME = "propertyLockCollaboration";

/** Optional service-worker keepalive injected by the background entry point. */
interface PropertyLockKeepAlive {
  acquire: () => void;
  release: () => void;
}
let propertyLockKeepAlive: PropertyLockKeepAlive | null = null;

/**
 * Hold the service-worker keepalive for the lifetime of an active connection
 * runtime so an idle suspension cannot tear down the live WebSocket and its
 * heartbeat/reconnect timers. Refcounted once per runtime via keepAliveHeld so
 * reconnects never double-acquire.
 */
function holdKeepAliveForRuntime(runtime: PropertyLockConnectionRuntime): void {
  if (!propertyLockKeepAlive || runtime.keepAliveHeld) {
    return;
  }
  runtime.keepAliveHeld = true;
  propertyLockKeepAlive.acquire();
}

function releaseKeepAliveForRuntime(runtime: PropertyLockConnectionRuntime): void {
  if (!propertyLockKeepAlive || !runtime.keepAliveHeld) {
    return;
  }
  runtime.keepAliveHeld = false;
  propertyLockKeepAlive.release();
}

function buildDisabledPropertyLockResponse() {
  return {
    ok: false,
    reason: FEATURE_DISABLED_REASON,
    feature: PROPERTY_LOCK_FEATURE_NAME,
    error: "Feature disabled"
  };
}

function isPropertyLockCollaborationEnabled() {
  return isFeatureEnabled(PROPERTY_LOCK_FEATURE_NAME);
}

function disposeAllPropertyLockConnections() {
  for (const [portId, portEntry] of contentScriptPorts.entries()) {
    contentScriptPorts.delete(portId);
    if (portEntry) {
      portEntry.siteId = null;
      portEntry.clientId = "";
      portEntry.connectionKey = "";
      if (portEntry.port) {
        try {
          portEntry.port.disconnect();
        } catch (_error) {
          // Port may already be closed.
        }
      }
    }
  }
  for (const [connectionKey, runtime] of lockConnections.entries()) {
    if (runtime) {
      releaseKeepAliveForRuntime(runtime);
      runtime.dispose();
    }
    lockConnections.delete(connectionKey);
  }
}

function ensurePropertyLockBackgroundActive() {
  if (isPropertyLockCollaborationEnabled()) {
    return true;
  }
  disposeAllPropertyLockConnections();
  return false;
}

function buildConnectionKey(siteId: unknown, clientId: unknown) {
  const normalizedSiteId = normalizePropertyLockSiteId(siteId);
  const normalizedClientId = normalizePropertyLockClientId(clientId);
  return normalizedSiteId && normalizedClientId ? `${normalizedSiteId}:${normalizedClientId}` : "";
}

function createUniqueClientIdForSite(siteId: unknown) {
  const normalizedSiteId = normalizePropertyLockSiteId(siteId);
  if (!normalizedSiteId) {
    return "";
  }
  let nextClientId: string;
  do {
    nextClientId = createPropertyLockClientId();
  } while (buildConnectionKey(normalizedSiteId, nextClientId) && lockConnections.has(buildConnectionKey(normalizedSiteId, nextClientId)));
  return nextClientId;
}

function resolveConnectionIdentityForPort(portId: number, portEntry: PortEntry, siteId: number | null, requestedClientId: string) {
  const normalizedSiteId = normalizePropertyLockSiteId(siteId);
  const normalizedClientId = normalizePropertyLockClientId(requestedClientId);
  const requestedConnectionKey = buildConnectionKey(normalizedSiteId, normalizedClientId);
  if (!requestedConnectionKey) {
    return { clientId: "", connectionKey: "" };
  }

  const conflictingPortEntry = Array.from(contentScriptPorts.entries()).find((entry) => {
    const [existingPortId, existingPortEntry] = entry;
    return existingPortId !== portId &&
      existingPortEntry &&
      existingPortEntry.connectionKey === requestedConnectionKey;
  });

  if (!conflictingPortEntry) {
    return {
      clientId: normalizedClientId,
      connectionKey: requestedConnectionKey
    };
  }

  const assignedClientId = createUniqueClientIdForSite(normalizedSiteId);
  return {
    clientId: assignedClientId,
    connectionKey: buildConnectionKey(normalizedSiteId, assignedClientId)
  };
}

function hasContentPortsForConnection(connectionKey: string) {
  return Array.from(contentScriptPorts.values()).some(
    (entry) => entry.connectionKey === connectionKey
  );
}

function consumeRuntimeLastErrorMessage() {
  try {
    if (!browser.runtime) {
      return "";
    }
    const lastError = browser.runtime.lastError;
    return lastError && typeof lastError.message === "string" ? lastError.message : "";
  } catch {
    return "";
  }
}

function detachPortFromConnection(portId: number, portEntry: PortEntry) {
  const currentConnectionKey = typeof (portEntry && portEntry.connectionKey) === "string"
    ? portEntry.connectionKey
    : "";
  if (!currentConnectionKey) {
    return null;
  }
  contentScriptPorts.delete(portId);
  portEntry.siteId = null;
  portEntry.clientId = "";
  portEntry.connectionKey = "";
  return currentConnectionKey;
}

function releaseAndDisposeConnection(connectionKey: string, options: { releaseLock?: boolean } = {}) {
  const { releaseLock = false } = options;
  if (!connectionKey) {
    return;
  }
  const runtime = lockConnections.get(connectionKey);
  if (!runtime) {
    return;
  }
  if (releaseLock && runtime.isConnected && runtime.socket && runtime.state && runtime.state.isEditor) {
    sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_RELEASE_LOCK));
  }
  releaseKeepAliveForRuntime(runtime);
  runtime.dispose();
  lockConnections.delete(connectionKey);
}

/**
 * Initialize property lock background module.
 * Sets up port listener for content script connections.
 */
export function initPropertyLockBackground(
  options: { keepAlive?: PropertyLockKeepAlive } = {}
) {
  propertyLockKeepAlive = options.keepAlive || null;
  if (!ensurePropertyLockBackgroundActive()) {
    return;
  }
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PROPERTY_LOCK_PORT_NAME) {
      handlePropertyLockPortConnect(port);
    }
  });
}

/**
 * Read-only snapshot of property-lock connection runtimes for diagnostics.
 *
 * Exposes how many WebSocket connections the service worker currently owns and
 * their socket readiness, so service-worker suspension diagnostics can report
 * whether long-lived connections are at risk of being torn down.
 */
export function getPropertyLockConnectionDiagnostics() {
  let openSockets = 0;
  let connectingSockets = 0;
  let closingOrClosedSockets = 0;
  let connectedRuntimes = 0;
  let pendingReconnectTimers = 0;
  for (const runtime of lockConnections.values()) {
    if (runtime.isConnected) {
      connectedRuntimes += 1;
    }
    if (runtime.reconnectTimer) {
      pendingReconnectTimers += 1;
    }
    const socket = runtime.socket;
    if (!socket) {
      continue;
    }
    if (socket.readyState === WebSocket.OPEN) {
      openSockets += 1;
    } else if (socket.readyState === WebSocket.CONNECTING) {
      connectingSockets += 1;
    } else {
      closingOrClosedSockets += 1;
    }
  }
  return {
    totalConnections: lockConnections.size,
    connectedRuntimes,
    openSockets,
    connectingSockets,
    closingOrClosedSockets,
    pendingReconnectTimers,
    contentPorts: contentScriptPorts.size
  };
}

/**
 * Handle a new connection from content script.
 */
function handlePropertyLockPortConnect(port: Browser.runtime.Port) {
  if (!ensurePropertyLockBackgroundActive()) {
    try {
      port.disconnect();
    } catch (_error) {
      // Port may already be closed.
    }
    return;
  }
  const portId = ++portIdCounter;
  let siteId: number | null = null;
  let clientId = "";
  let connectionKey = "";

  // Track port metadata
  const portEntry: PortEntry = {
    port,
    siteId: null,
    clientId: "",
    connectionKey: "",
    tabId: normalizeTabId(port.sender?.tab?.id),
    pageUrl: "",
    hasUnsavedChanges: false
  };

  function onPortMessage(message: PropertyLockMessage) {
    if (!ensurePropertyLockBackgroundActive()) {
      try {
        port.postMessage({
          type: PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
          connectionStatus: PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
          error: FEATURE_DISABLED_REASON
        });
      } catch (_error) {
        // Port may already be closed.
      }
      return;
    }
    if (!message || typeof message !== "object") {
      return;
    }

    const { type, siteId: msgSiteId, ...rest } = message;

    // First message should be connect
    if (type === PROPERTY_LOCK_CONTENT_CONNECT) {
      const nextSiteId = normalizePropertyLockSiteId(msgSiteId);
      const requestedClientId = normalizePropertyLockClientId(rest.clientId);
      if (!nextSiteId) {
        port.postMessage({
          type: PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
          connectionStatus: PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
          error: "invalid_site_id"
        });
        return;
      }
      if (!requestedClientId) {
        port.postMessage({
          type: PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
          connectionStatus: PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
          error: "invalid_client_id"
        });
        return;
      }
      const resolvedIdentity = resolveConnectionIdentityForPort(
        portId,
        portEntry,
        nextSiteId,
        requestedClientId
      );
      const nextClientId = resolvedIdentity.clientId;
      const nextConnectionKey = resolvedIdentity.connectionKey;
      if (connectionKey && nextConnectionKey && connectionKey !== nextConnectionKey) {
        const previousConnectionKey = detachPortFromConnection(portId, portEntry);
        if (previousConnectionKey) {
          scheduleDisconnectCheck(previousConnectionKey);
        }
      }
      siteId = nextSiteId;
      clientId = nextClientId;
      connectionKey = nextConnectionKey;
      portEntry.siteId = siteId;
      portEntry.clientId = clientId;
      portEntry.connectionKey = connectionKey;
      portEntry.pageUrl = typeof rest.pageUrl === "string" ? rest.pageUrl : "";
      portEntry.hasUnsavedChanges = Boolean(rest.hasUnsavedChanges);
      contentScriptPorts.set(portId, portEntry);

      if (connectionKey) {
        const runtime = ensureConnectionForClient(siteId, clientId);
        if (runtime) {
          runtime.tabId = portEntry.tabId;
          runtime.pageUrl = portEntry.pageUrl || runtime.pageUrl;
          runtime.hasUnsavedChanges = portEntry.hasUnsavedChanges;
          runtime.lastActivityAt = runtime.lastActivityAt || Date.now();
          sendClientStatus(runtime);
        }
      }
      return;
    }

    // All other messages require prior connect
    if (!siteId) {
      return;
    }

    if (type === PROPERTY_LOCK_CONTENT_DISCONNECT) {
      const disconnectedConnectionKey = detachPortFromConnection(portId, portEntry) || connectionKey;
      siteId = null;
      clientId = "";
      connectionKey = "";
      if (disconnectedConnectionKey) {
        scheduleDisconnectCheck(disconnectedConnectionKey);
      }
      return;
    }

    if (type === PROPERTY_LOCK_CONTENT_DRAFT_STATUS) {
      portEntry.hasUnsavedChanges = Boolean(rest.hasUnsavedChanges);
      const runtime = lockConnections.get(connectionKey);
      if (runtime) {
        runtime.hasUnsavedChanges = portEntry.hasUnsavedChanges;
        runtime.pageUrl = typeof rest.pageUrl === "string" ? rest.pageUrl : runtime.pageUrl;
        sendClientStatus(runtime);
      }
      return;
    }

    const runtime = lockConnections.get(connectionKey);
    if (!runtime || !runtime.isConnected) {
      return;
    }

    switch (type) {
      case PROPERTY_LOCK_CONTENT_ACTIVITY:
        debounceActivity(connectionKey);
        break;
      case PROPERTY_LOCK_CONTENT_TAKE_LOCK:
        markRuntimeActive(runtime);
        sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_TAKE_LOCK));
        break;
      case PROPERTY_LOCK_CONTENT_RELEASE:
        sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_RELEASE_LOCK));
        break;
      case PROPERTY_LOCK_CONTENT_SUGGEST:
        sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_SUGGEST_TAKEOVER));
        break;
      case PROPERTY_LOCK_CONTENT_RESPOND:
        if (typeof rest.accept === "boolean" && rest.suggestionId) {
          sendToServer(runtime, {
            type: PROPERTY_LOCK_WS_RESPOND_TO_SUGGESTION,
            suggestionId: String(rest.suggestionId),
            accept: rest.accept,
            clientId: runtime.clientId,
            hasUnsavedChanges: runtime.hasUnsavedChanges,
            discardUnsaved: Boolean(rest.discardUnsaved)
          });
        }
        break;
      case PROPERTY_LOCK_CONTENT_CONTINUE:
        markRuntimeActive(runtime);
        promoteRuntimeAsLocalEditor(runtime);
        sendToServer(runtime, {
          ...createClientPayload(runtime, PROPERTY_LOCK_WS_CONTINUE_EDITING),
          force: Boolean(rest.force),
          discardPrevious: Boolean(rest.force || rest.discardPrevious)
        });
        break;
    }
  }

  function onPortDisconnect() {
    consumeRuntimeLastErrorMessage();
    const disconnectedConnectionKey = detachPortFromConnection(portId, portEntry) || connectionKey;
    siteId = null;
    clientId = "";
    connectionKey = "";

    if (disconnectedConnectionKey) {
      scheduleDisconnectCheck(disconnectedConnectionKey);
    }
  }

  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(onPortDisconnect);
}

export function handlePropertyLockBackgroundTabRemoved(tabId: number) {
  if (!ensurePropertyLockBackgroundActive()) {
    return;
  }
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return;
  }
  const connectionKeysToDispose = new Set<string>();
  for (const [portId, portEntry] of contentScriptPorts.entries()) {
    if (!portEntry || portEntry.tabId !== normalizedTabId) {
      continue;
    }
    const connectionKey = detachPortFromConnection(portId, portEntry);
    if (connectionKey) {
      connectionKeysToDispose.add(connectionKey);
    }
  }
  connectionKeysToDispose.forEach((connectionKey) => {
    releaseAndDisposeConnection(connectionKey, { releaseLock: true });
  });
}

function createClientPayload(runtime: PropertyLockConnectionRuntime, type: string) {
  return {
    type,
    siteId: runtime.siteId,
    clientId: runtime.clientId,
    pageUrl: runtime.pageUrl || "",
    hasUnsavedChanges: Boolean(runtime.hasUnsavedChanges)
  };
}

function markRuntimeActive(runtime: PropertyLockConnectionRuntime) {
  if (runtime) {
    runtime.lastActivityAt = Date.now();
  }
}

/**
 * Ensure WebSocket connection exists for a property client session.
 * Create if missing, reuse if the same page session reconnects.
 */
function ensureConnectionForClient(siteId: number | null, clientId: string) {
  if (!ensurePropertyLockBackgroundActive()) {
    return null;
  }
  siteId = normalizePropertyLockSiteId(siteId);
  clientId = normalizePropertyLockClientId(clientId);
  const connectionKey = buildConnectionKey(siteId, clientId);
  if (!connectionKey) {
    return null;
  }

  let runtime = lockConnections.get(connectionKey);
  if (runtime) {
    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }
    return runtime;
  }

  runtime = new PropertyLockConnectionRuntime(siteId, clientId);
  lockConnections.set(connectionKey, runtime);
  holdKeepAliveForRuntime(runtime);

  connectWebSocket(runtime);
  return runtime;
}

function setConnectionStatus(runtime: PropertyLockConnectionRuntime, status: string, error = "") {
  if (!runtime || (runtime.connectionStatus === status && runtime.connectionError === error)) {
    return;
  }
  runtime.connectionStatus = status;
  runtime.connectionError = error;
  broadcastToContentScriptPorts(runtime.connectionKey, {
    type: PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
    connectionStatus: status,
    error
  });
}

/**
 * Establish WebSocket connection for a runtime.
 */
function connectWebSocket(runtime: PropertyLockConnectionRuntime) {
  if (!ensurePropertyLockBackgroundActive()) {
    return;
  }
  if (runtime.isConnected || runtime.socket || !hasContentPortsForConnection(runtime.connectionKey)) {
    return;
  }

  setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_CONNECTING);

  getPropertyLockConnectionSettings().then((settings) => {
    const endpointBase = settings.endpointBase;
    const token = settings.tokenValue;

    const wssUrl = buildPropertyLockWssUrl(endpointBase, token);
    if (!wssUrl) {
      setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_UNAVAILABLE, token ? "invalid_config" : "missing_token");
      scheduleReconnect(runtime);
      return;
    }

    try {
      runtime.socket = new WebSocket(wssUrl);
      runtime.socket.onopen = () => onWebSocketOpen(runtime);
      runtime.socket.onmessage = (event: MessageEvent) => onWebSocketMessage(runtime, event);
      runtime.socket.onerror = () => onWebSocketError(runtime);
      runtime.socket.onclose = () => onWebSocketClose(runtime);
    } catch (_e) {
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
function onWebSocketOpen(runtime: PropertyLockConnectionRuntime) {
  runtime.isConnected = true;
  runtime.reconnectAttempts = 0;
  if (runtime.connectionLossTimer) {
    clearTimeout(runtime.connectionLossTimer);
    runtime.connectionLossTimer = null;
  }
  setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_CONNECTED);

  sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_SUBSCRIBE));
  sendClientStatus(runtime);

  if (runtime.heartbeatTimer) {
    clearInterval(runtime.heartbeatTimer);
  }
  runtime.heartbeatTimer = setInterval(() => {
    if (runtime.isConnected && runtime.socket) {
      const now = Date.now();
      if (runtime.lastActivityAt && now - runtime.lastActivityAt > PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS) {
        return;
      }
      sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_HEARTBEAT));
    }
  }, PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS);
}

function findLocalEditorRuntime(runtime: PropertyLockConnectionRuntime) {
  if (!runtime || !runtime.myIdentity) {
    return null;
  }
  return Array.from(lockConnections.values()).find((candidate) =>
    candidate !== runtime &&
    candidate.siteId === runtime.siteId &&
    candidate.state &&
    candidate.state.isEditor &&
    candidate.myIdentity &&
    candidate.myIdentity === runtime.myIdentity
  ) || null;
}

function promoteRuntimeAsLocalEditor(runtime: PropertyLockConnectionRuntime) {
  if (!runtime || !runtime.myIdentity) {
    return;
  }
  const previousEditor = findLocalEditorRuntime(runtime);
  if (previousEditor) {
    previousEditor.state = {
      ...previousEditor.state,
      isEditor: false,
      isSameUserEditor: true,
      otherTabHasUnsavedChanges: false,
      canContinueHere: false
    };
    previousEditor.hasUnsavedChanges = false;
    broadcastToContentScriptPorts(previousEditor.connectionKey, {
      type: PROPERTY_LOCK_WS_LOCK_STATE,
      ...previousEditor.state
    });
  }
  runtime.state = {
    ...runtime.state,
    state: PROPERTY_LOCK_STATE_LOCKED,
    isEditor: true,
    isSameUserEditor: false,
    editorIdentity: runtime.myIdentity,
    editorName: runtime.myName || runtime.myIdentity,
    editorClientId: runtime.clientId,
    otherTabHasUnsavedChanges: false,
    canContinueHere: false
  };
  broadcastToContentScriptPorts(runtime.connectionKey, {
    type: PROPERTY_LOCK_WS_LOCK_STATE,
    ...runtime.state
  });
}

function enrichLockStateForRuntime(runtime: PropertyLockConnectionRuntime, lockState: LockState): LockState {
  if (!runtime || !lockState || typeof lockState !== "object") {
    return lockState;
  }
  const nextState = { ...lockState };
  if (
    nextState.editorClientId &&
    runtime.clientId &&
    nextState.editorClientId !== runtime.clientId
  ) {
    nextState.isEditor = false;
  }
  if (!nextState.isEditor && runtime.myIdentity && nextState.editorIdentity === runtime.myIdentity) {
    nextState.isSameUserEditor = true;
  }
  const localEditor = findLocalEditorRuntime(runtime);
  if (!nextState.isEditor && localEditor) {
    nextState.isSameUserEditor = true;
    nextState.otherTabHasUnsavedChanges = Boolean(localEditor.hasUnsavedChanges);
    nextState.canContinueHere = !localEditor.hasUnsavedChanges;
  } else if (nextState.isEditor && localEditor) {
    nextState.isEditor = false;
    nextState.isSameUserEditor = true;
    nextState.otherTabHasUnsavedChanges = Boolean(localEditor.hasUnsavedChanges);
    nextState.canContinueHere = !localEditor.hasUnsavedChanges;
  }
  return nextState;
}

function decorateServerMessageForRuntime(runtime: PropertyLockConnectionRuntime, message: PropertyLockMessage) {
  if (!message || typeof message !== "object") {
    return message;
  }
  if (message.type !== PROPERTY_LOCK_WS_LOCK_STATE) {
    return message;
  }
  const normalized = enrichLockStateForRuntime(runtime, normalizeLockStateMessage(message, {
    ownIdentity: runtime.myIdentity,
    clientId: runtime.clientId
  }));
  return {
    ...message,
    ...normalized
  };
}

function sendClientStatus(runtime: PropertyLockConnectionRuntime) {
  if (!runtime || !runtime.isConnected) {
    return;
  }
  sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_CLIENT_STATUS));
}

async function checkNetworkConnectivity(runtime: PropertyLockConnectionRuntime) {
  if (typeof fetch !== "function") {
    return true;
  }
  if (runtime.networkCheckAbortController) {
    try {
      runtime.networkCheckAbortController.abort();
    } catch (_e) {
      // Ignore abort errors.
    }
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  runtime.networkCheckAbortController = controller;
  const timeout = setTimeout(() => {
    if (controller) {
      controller.abort();
    }
  }, PROPERTY_LOCK_NETWORK_CHECK_TIMEOUT_MS);
  try {
    for (const url of PROPERTY_LOCK_NETWORK_CHECK_URLS) {
      try {
        await fetch(url, {
          cache: "no-store",
          mode: "no-cors",
          signal: controller ? controller.signal : undefined
        });
        return true;
      } catch (_e) {
        // Try the next stable endpoint.
      }
    }
    return false;
  } finally {
    clearTimeout(timeout);
    if (runtime.networkCheckAbortController === controller) {
      runtime.networkCheckAbortController = null;
    }
  }
}

function startConnectionLossWatch(runtime: PropertyLockConnectionRuntime, reason: string) {
  if (!ensurePropertyLockBackgroundActive()) {
    return;
  }
  if (!runtime || runtime.connectionLossTimer) {
    return;
  }
  if (runtime.state && runtime.state.isEditor) {
    broadcastToContentScriptPorts(runtime.connectionKey, {
      type: PROPERTY_LOCK_WS_DISCONNECT_WARNING,
      secondsRemaining: Math.ceil(PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS / 1000),
      reason: reason || "socket_closed"
    });
  }
  runtime.connectionLossTimer = setTimeout(async () => {
    runtime.connectionLossTimer = null;
    if (runtime.isConnected || lockConnections.get(runtime.connectionKey) !== runtime) {
      return;
    }
    const networkReachable = await checkNetworkConnectivity(runtime);
    if (!networkReachable && !runtime.isConnected) {
      setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_UNAVAILABLE, reason || "network_unavailable");
      runtime.state = {
        ...runtime.state,
        isEditor: false
      };
      broadcastToContentScriptPorts(runtime.connectionKey, {
        type: PROPERTY_LOCK_WS_LOCK_STATE,
        ...runtime.state
      });
    }
  }, PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS);
}

/**
 * Handle WebSocket message from server.
 */
function onWebSocketMessage(runtime: PropertyLockConnectionRuntime, event: MessageEvent) {
  let message: PropertyLockMessage;
  try {
    message = JSON.parse(event.data);
  } catch (_e) {
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
      runtime.state = enrichLockStateForRuntime(runtime, normalizeLockStateMessage(message, {
        ownIdentity: runtime.myIdentity,
        clientId: runtime.clientId
      }));
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

  broadcastToContentScriptPorts(runtime.connectionKey, decorateServerMessageForRuntime(runtime, message));
}

/**
 * Handle WebSocket error.
 */
function onWebSocketError(runtime: PropertyLockConnectionRuntime) {
  runtime.isConnected = false;
  setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_UNAVAILABLE, "socket_error");
  startConnectionLossWatch(runtime, "socket_error");
  scheduleReconnect(runtime);
}

/**
 * Handle WebSocket close.
 */
function onWebSocketClose(runtime: PropertyLockConnectionRuntime) {
  runtime.isConnected = false;
  if (runtime.heartbeatTimer) {
    clearInterval(runtime.heartbeatTimer);
    runtime.heartbeatTimer = null;
  }
  setConnectionStatus(runtime, PROPERTY_LOCK_CONNECTION_CONNECTING, "socket_closed");
  startConnectionLossWatch(runtime, "socket_closed");
  scheduleReconnect(runtime);
}

/**
 * Send message to WebSocket server.
 */
function sendToServer(runtime: PropertyLockConnectionRuntime, message: OutboundMessage) {
  if (!runtime.isConnected || !runtime.socket) {
    return;
  }

  try {
    runtime.socket.send(JSON.stringify(message));
  } catch (_e) {
    runtime.isConnected = false;
  }
}

function getRuntimePortTabId(runtime: PropertyLockConnectionRuntime | null | undefined) {
  if (!runtime) {
    return null;
  }
  if (Number.isFinite(runtime.tabId)) {
    return runtime.tabId;
  }
  const portEntry = Array.from(contentScriptPorts.values()).find(
    (entry) => entry.connectionKey === runtime.connectionKey && Number.isFinite(entry.tabId)
  );
  return portEntry ? portEntry.tabId : null;
}

/**
 * Broadcast server message to ports for one client session.
 */
function broadcastToContentScriptPorts(connectionKey: string, message: OutboundMessage) {
  const runtime = lockConnections.get(connectionKey);
  const siteId = runtime ? runtime.siteId : null;
  const clientId = runtime ? runtime.clientId : "";
  const tabId = getRuntimePortTabId(runtime);
  for (const [, portEntry] of contentScriptPorts) {
    if (portEntry.connectionKey === connectionKey && portEntry.port) {
      try {
        portEntry.port.postMessage({
          type: PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
          siteId,
          clientId,
          tabId,
          message
        });
      } catch (_e) {
        // Port may be closed
      }
    }
  }

  try {
    const updatePromise = browser.runtime.sendMessage({
      type: PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
      siteId,
      clientId,
      tabId,
      message
    });
    if (updatePromise && typeof updatePromise.catch === "function") {
      updatePromise.catch(() => {});
    }
  } catch (_e) {
    // No popup listener may be open.
  }
}

/**
 * Debounce activity messages (5s window).
 */
function debounceActivity(connectionKey: string) {
  const runtime = lockConnections.get(connectionKey);
  if (!runtime) {
    return;
  }

  const now = Date.now();
  if (now - runtime.lastActivityAt < PROPERTY_LOCK_ACTIVITY_DEBOUNCE_MS) {
    return; // Still in debounce window
  }

  runtime.lastActivityAt = now;
  sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_ACTIVITY));
}

/**
 * Schedule WebSocket reconnect with exponential backoff.
 */
function scheduleReconnect(runtime: PropertyLockConnectionRuntime) {
  if (!ensurePropertyLockBackgroundActive()) {
    return;
  }
  if (lockConnections.get(runtime.connectionKey) !== runtime || !hasContentPortsForConnection(runtime.connectionKey)) {
    return;
  }

  if (runtime.socket) {
    try {
      runtime.socket.close();
    } catch (_e) {
      // Already closed
    }
    runtime.socket = null;
  }

  runtime.reconnectAttempts = (runtime.reconnectAttempts || 0) + 1;
  const delay = Math.min(
    PROPERTY_LOCK_RECONNECT_DELAY_MS * Math.pow(2, runtime.reconnectAttempts - 1),
    60_000 // Cap at 60s
  );

  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
  }
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    if (lockConnections.get(runtime.connectionKey) === runtime && hasContentPortsForConnection(runtime.connectionKey)) {
      connectWebSocket(runtime);
    }
  }, delay);
}

/**
 * Schedule check for port disconnection after the navigation grace delay.
 * Close WebSocket if no ports remain connected for this siteId.
 */
function scheduleDisconnectCheck(connectionKey: string) {
  setTimeout(() => {
    const portsForConnection = Array.from(contentScriptPorts.values()).filter(
      (entry) => entry.connectionKey === connectionKey
    );

    if (portsForConnection.length === 0) {
      releaseAndDisposeConnection(connectionKey);
    }
  }, PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS);
}

/**
 * Handle getPropertyLockState message from popup.
 */
export async function handleGetPropertyLockState(message: PropertyLockMessage, sender?: Browser.runtime.MessageSender) {
  if (!ensurePropertyLockBackgroundActive()) {
    return {
      state: createInactiveLockState(),
      clientId: "",
      identity: "",
      name: "",
      connectionStatus: PROPERTY_LOCK_CONNECTION_INACTIVE,
      error: FEATURE_DISABLED_REASON
    };
  }
  const siteId = normalizePropertyLockSiteId(message.siteId);
  if (!siteId) {
    return { state: createInactiveLockState() };
  }

  const runtime = findRuntimeForRequest(message, sender);
  if (!runtime || !runtime.isConnected) {
    return {
      state: runtime ? runtime.state : createInactiveLockState(),
      clientId: runtime ? runtime.clientId : "",
      identity: runtime ? runtime.myIdentity : "",
      name: runtime ? runtime.myName : "",
      connectionStatus: runtime ? runtime.connectionStatus : PROPERTY_LOCK_CONNECTION_INACTIVE,
      error: runtime ? runtime.connectionError : ""
    };
  }

  return {
    state: enrichLockStateForRuntime(runtime, runtime.state),
    identity: runtime.myIdentity,
    name: runtime.myName,
    clientId: runtime.clientId,
    connectionStatus: runtime.connectionStatus,
    error: runtime.connectionError
  };
}

function findRuntimeForRequest(message: PropertyLockMessage, sender?: Browser.runtime.MessageSender) {
  const siteId = normalizePropertyLockSiteId(message.siteId);
  if (!siteId) {
    return null;
  }
  const senderTabId = normalizeTabId(sender?.tab?.id);
  const tabId = normalizeTabId(message.tabId) ?? senderTabId;
  if (tabId !== null) {
    const portEntry = Array.from(contentScriptPorts.values()).find(
      (entry) => entry.siteId === siteId && entry.tabId === tabId && entry.connectionKey
    );
    if (portEntry) {
      return lockConnections.get(portEntry.connectionKey) || null;
    }
  }
  const clientId = normalizePropertyLockClientId(message.clientId);
  if (clientId) {
    return lockConnections.get(buildConnectionKey(siteId, clientId)) || null;
  }
  const runtimes = Array.from(lockConnections.values()).filter(
    (runtime) => runtime.siteId === siteId
  );
  return runtimes.length === 1 ? runtimes[0] : null;
}

function handlePropertyLockCommand(message: PropertyLockMessage, sender?: Browser.runtime.MessageSender) {
  if (!ensurePropertyLockBackgroundActive()) {
    return buildDisabledPropertyLockResponse();
  }
  const runtime = findRuntimeForRequest(message, sender);
  if (!runtime || !runtime.isConnected) {
    return { ok: false };
  }

  switch (message.type) {
    case PROPERTY_LOCK_CONTENT_TAKE_LOCK:
      markRuntimeActive(runtime);
      sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_TAKE_LOCK));
      return { ok: true };
    case PROPERTY_LOCK_CONTENT_RELEASE:
      sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_RELEASE_LOCK));
      return { ok: true };
    case PROPERTY_LOCK_CONTENT_SUGGEST:
      sendToServer(runtime, createClientPayload(runtime, PROPERTY_LOCK_WS_SUGGEST_TAKEOVER));
      return { ok: true };
    case PROPERTY_LOCK_CONTENT_CONTINUE:
      markRuntimeActive(runtime);
      promoteRuntimeAsLocalEditor(runtime);
      sendToServer(runtime, {
        ...createClientPayload(runtime, PROPERTY_LOCK_WS_CONTINUE_EDITING),
        force: Boolean(message.force),
        discardPrevious: Boolean(message.force || message.discardPrevious)
      });
      return { ok: true };
    case PROPERTY_LOCK_CONTENT_RESPOND:
      if (typeof message.accept !== "boolean" || !message.suggestionId) {
        return { ok: false };
      }
      sendToServer(runtime, {
        type: PROPERTY_LOCK_WS_RESPOND_TO_SUGGESTION,
        suggestionId: String(message.suggestionId),
        accept: message.accept,
        clientId: runtime.clientId,
        hasUnsavedChanges: runtime.hasUnsavedChanges,
        discardUnsaved: Boolean(message.discardUnsaved)
      });
      return { ok: true };
    case PROPERTY_LOCK_CONTENT_DRAFT_STATUS:
      runtime.hasUnsavedChanges = Boolean(message.hasUnsavedChanges);
      runtime.pageUrl = typeof message.pageUrl === "string" ? message.pageUrl : runtime.pageUrl;
      sendClientStatus(runtime);
      return { ok: true };
    default:
      return { ok: false };
  }
}

/**
 * Message handler for all property lock background messages.
 */
export async function handlePropertyLockBackgroundMessage(message: PropertyLockMessage, sender?: Browser.runtime.MessageSender) {
  if (!ensurePropertyLockBackgroundActive()) {
    return buildDisabledPropertyLockResponse();
  }
  if (!message || !message.type) {
    return { ok: false };
  }

  const { type } = message;

  if (type === "pageDraftChanged") {
    return handlePageDraftStatusMessage(message, sender);
  }

  if (type === PROPERTY_LOCK_BACKGROUND_GET_STATE) {
    return handleGetPropertyLockState(message, sender);
  }

  if (
    type === PROPERTY_LOCK_CONTENT_TAKE_LOCK ||
    type === PROPERTY_LOCK_CONTENT_RELEASE ||
    type === PROPERTY_LOCK_CONTENT_SUGGEST ||
    type === PROPERTY_LOCK_CONTENT_RESPOND ||
    type === PROPERTY_LOCK_CONTENT_CONTINUE ||
    type === PROPERTY_LOCK_CONTENT_DRAFT_STATUS
  ) {
    return handlePropertyLockCommand(message, sender);
  }

  return { ok: false };
}

function handlePageDraftStatusMessage(message: PropertyLockMessage, sender?: Browser.runtime.MessageSender) {
  if (!ensurePropertyLockBackgroundActive()) {
    return buildDisabledPropertyLockResponse();
  }
  const senderTabId = normalizeTabId(sender?.tab?.id);
  if (senderTabId === null) {
    return { ok: false };
  }
  const pageUrl = typeof message.pageUrl === "string" ? message.pageUrl : "";
  const matchingEntries = Array.from(contentScriptPorts.values()).filter((entry) =>
    entry.tabId === senderTabId &&
    entry.connectionKey &&
    (!pageUrl || !entry.pageUrl || entry.pageUrl === pageUrl)
  );
  matchingEntries.forEach((entry) => {
    entry.hasUnsavedChanges = Boolean(message.dirty);
    if (pageUrl) {
      entry.pageUrl = pageUrl;
    }
    const runtime = lockConnections.get(entry.connectionKey);
    if (runtime) {
      runtime.hasUnsavedChanges = entry.hasUnsavedChanges;
      runtime.pageUrl = pageUrl || runtime.pageUrl;
      sendClientStatus(runtime);
    }
  });
  return { ok: matchingEntries.length > 0 };
}
