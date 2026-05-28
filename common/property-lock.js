/**
 * Property Edit Lock constants and helpers.
 * 
 * Manages single-editor ownership of properties via WebSocket hub.
 * Lock state is maintained server-side in PropertyLockService.
 */

/**
 * Lock state constants (from server).
 */
export const PROPERTY_LOCK_STATE_UNLOCKED = "unlocked";
export const PROPERTY_LOCK_STATE_LOCKED = "locked";
export const PROPERTY_LOCK_STATE_EXPIRY_WARNING = "expiry_warning";
export const PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE = "takeover_available";
export const PROPERTY_LOCK_STATE_TRANSFER = "transfer";
export const PROPERTY_LOCK_STATE_DISCONNECTED = "locked"; // Treated as locked client-side

export const PROPERTY_LOCK_CONNECTION_INACTIVE = "inactive";
export const PROPERTY_LOCK_CONNECTION_CONNECTING = "connecting";
export const PROPERTY_LOCK_CONNECTION_CONNECTED = "connected";
export const PROPERTY_LOCK_CONNECTION_UNAVAILABLE = "unavailable";

/**
 * WebSocket message types (client to server).
 */
export const PROPERTY_LOCK_WS_SUBSCRIBE = "subscribe";
export const PROPERTY_LOCK_WS_HEARTBEAT = "heartbeat";
export const PROPERTY_LOCK_WS_ACTIVITY = "activity";
export const PROPERTY_LOCK_WS_TAKE_LOCK = "take_lock";
export const PROPERTY_LOCK_WS_RELEASE_LOCK = "release_lock";
export const PROPERTY_LOCK_WS_SUGGEST_TAKEOVER = "suggest_takeover";
export const PROPERTY_LOCK_WS_RESPOND_TO_SUGGESTION = "respond_to_suggestion";
export const PROPERTY_LOCK_WS_CONTINUE_EDITING = "continue_editing";

/**
 * WebSocket message types (server to client).
 */
export const PROPERTY_LOCK_WS_SUBSCRIBED = "subscribed";
export const PROPERTY_LOCK_WS_LOCK_STATE = "lock_state";
export const PROPERTY_LOCK_WS_DISCONNECT_WARNING = "disconnect_warning";
export const PROPERTY_LOCK_WS_INACTIVITY_WARNING = "inactivity_warning";
export const PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION = "takeover_suggestion";
export const PROPERTY_LOCK_WS_SUGGESTION_PENDING = "suggestion_pending";
export const PROPERTY_LOCK_WS_SUGGESTION_RESPONSE = "suggestion_response";
export const PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED = "suggestion_accepted";
export const PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN = "transfer_countdown";
export const PROPERTY_LOCK_WS_ERROR = "error";

/**
 * Timing constants.
 */
export const PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS = 120_000; // 2 minutes
export const PROPERTY_LOCK_ACTIVITY_DEBOUNCE_MS = 5_000; // 5 seconds
export const PROPERTY_LOCK_RECONNECT_DELAY_MS = 2_000; // 2 seconds
export const PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS = 5_000; // 5 seconds before closing WebSocket if no ports

/**
 * Content script to background message types.
 */
export const PROPERTY_LOCK_PORT_NAME = "propertyLock";
export const PROPERTY_LOCK_CONTENT_CONNECT = "propertyLockConnect";
export const PROPERTY_LOCK_CONTENT_DISCONNECT = "propertyLockDisconnect";
export const PROPERTY_LOCK_CONTENT_ACTIVITY = "propertyLockActivity";
export const PROPERTY_LOCK_CONTENT_TAKE_LOCK = "propertyLockTakeLock";
export const PROPERTY_LOCK_CONTENT_RELEASE = "propertyLockRelease";
export const PROPERTY_LOCK_CONTENT_SUGGEST = "propertyLockSuggest";
export const PROPERTY_LOCK_CONTENT_RESPOND = "propertyLockRespondToSuggestion";
export const PROPERTY_LOCK_CONTENT_CONTINUE = "propertyLockContinueEditing";
export const PROPERTY_LOCK_BACKGROUND_GET_STATE = "getPropertyLockState";
export const PROPERTY_LOCK_BACKGROUND_STATE_UPDATE = "propertyLockStateUpdate";
export const PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS = "propertyLockConnectionStatus";

export function normalizePropertyLockSiteId(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? Math.trunc(value) : null;
  }
  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value.trim());
    return Number.isFinite(numericValue) && numericValue > 0 ? Math.trunc(numericValue) : null;
  }
  return null;
}

/**
 * Build WebSocket URL for property lock service.
 * 
 * @param {string} endpointUrl - Config endpoint URL or host; path/query are replaced and the same origin/port is used.
 * @param {string} tokenValue - JWT token for authorization
 * @returns {string} WSS URL or empty string if invalid
 */
export function buildPropertyLockWssUrl(endpointUrl, tokenValue) {
  if (!endpointUrl || typeof endpointUrl !== "string") {
    return "";
  }

  let url;
  try {
    const trimmed = endpointUrl.trim();
    url = trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
  } catch (error) {
    return "";
  }
  const hostname = (url.hostname || "").replace(/^\.+/, "").replace(/\.+$/, "");
  if (!hostname) {
    return "";
  }

  if (!tokenValue || typeof tokenValue !== "string") {
    return "";
  }

  const trimmedToken = tokenValue.trim();
  if (!trimmedToken) {
    return "";
  }

  const isLocalDevHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost");
  const wsProtocol = url.protocol === "http:" && isLocalDevHost ? "ws:" : "wss:";
  const base = `${wsProtocol}//${url.host}/property-lock`;
  return `${base}?token=${encodeURIComponent(trimmedToken)}`;
}

/**
 * Normalize lock state message from server.
 * 
 * @param {object} message - Raw message from server
 * @returns {object} Normalized lock state
 */
export function normalizeLockStateMessage(message) {
  if (!message || typeof message !== "object") {
    return createInactiveLockState();
  }

  return {
    state: String(message.state || PROPERTY_LOCK_STATE_UNLOCKED),
    editorIdentity: String(message.editorIdentity || ""),
    editorName: String(message.editorName || ""),
    isEditor: Boolean(message.isEditor),
    isRecentEditor: Boolean(message.isRecentEditor),
    expiresAtUtc: String(message.expiresAtUtc || ""),
    secondsRemaining: typeof message.secondsRemaining === "number" ? Math.max(0, Math.floor(message.secondsRemaining)) : null
  };
}

/**
 * Normalize takeover suggestion message from server.
 * 
 * @param {object} message - Raw message from server
 * @returns {object} Normalized suggestion
 */
export function normalizeTakeoverSuggestionMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  return {
    suggestionId: String(message.suggestionId || ""),
    fromName: String(message.fromName || "")
  };
}

/**
 * Create inactive lock state (no connection, fully unlocked).
 * 
 * @returns {object} Inactive lock state
 */
export function createInactiveLockState() {
  return {
    state: PROPERTY_LOCK_STATE_UNLOCKED,
    editorIdentity: "",
    editorName: "",
    isEditor: false,
    isRecentEditor: false,
    expiresAtUtc: "",
    secondsRemaining: null
  };
}

/**
 * Determine if lock is fully unlocked (no editing in progress).
 * 
 * @param {object} lockState - Normalized lock state
 * @returns {boolean}
 */
export function isLockStateUnlocked(lockState) {
  return lockState && lockState.state === PROPERTY_LOCK_STATE_UNLOCKED;
}

/**
 * Determine if lock is held by someone else (passive subscriber).
 * 
 * @param {object} lockState - Normalized lock state
 * @returns {boolean}
 */
export function isLockStateLockedByOther(lockState) {
  return lockState && 
         !lockState.isEditor && 
         (lockState.state === PROPERTY_LOCK_STATE_LOCKED || 
          lockState.state === PROPERTY_LOCK_STATE_EXPIRY_WARNING);
}

/**
 * Determine if user can take over the lock.
 * 
 * @param {object} lockState - Normalized lock state
 * @returns {boolean}
 */
export function canTakeoverLock(lockState) {
  return lockState && 
         !lockState.isEditor && 
         lockState.state === PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE;
}

/**
 * Determine if user is editor and can continue editing (for recent editor).
 * 
 * @param {object} lockState - Normalized lock state
 * @returns {boolean}
 */
export function canContinueEditingAsRecentEditor(lockState) {
  return lockState && 
         lockState.isRecentEditor && 
         lockState.state === PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE;
}
