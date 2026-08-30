import { adoptEditorSession, type EditorSession } from "./identity";
import { checkNetworkReachability } from "./reachability";
import { reducePropertyLockState, INITIAL_PROPERTY_LOCK_STATE, type PropertyLockState } from "./reducer";
import {
  buildLockAuthenticationFrame,
  buildClientFrame,
  parseServerMessage,
  type LockClientMessageType,
  type LockServerMessage,
  type PropertyLockPresence,
} from "./ws";
import {
  PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS,
  PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS,
  PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS,
  PROPERTY_LOCK_RECONNECT_DELAY_MS,
  PROPERTY_LOCK_RECONNECT_MAX_DELAY_MS,
  PROPERTY_LOCK_STATUS_REFRESH_TIMEOUT_MS,
} from "./timings";

export type WebSocketLike = Readonly<{
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown }) => void): void;
}>;

const QUALIFYING_PRESENCE: PropertyLockPresence = {
  visible: true,
  focusedWindow: true,
  browserIdle: false,
};

export const PROPERTY_LOCK_AUTHENTICATION_TIMEOUT_MS = 5_000;

export type PropertyLockFence = Readonly<{
  editorSessionId: string;
  lockToken: string;
  ownershipGeneration?: number;
}>;

export type PropertyLockOwnershipTransfer = Readonly<{
  previous: PropertyLockFence;
  next: PropertyLockState;
}>;

function isAuthoritativeTransfer(
  message: LockServerMessage,
  editorSessionId: string,
  previous: PropertyLockFence | null,
): boolean {
  if (!previous || message.type !== "lock_state") {
    return false;
  }
  const holderSessionId = typeof message.editorSessionId === "string" ? message.editorSessionId : "";
  if (holderSessionId && holderSessionId !== editorSessionId) {
    return true;
  }
  if (message.isEditor === true) {
    return false;
  }
  return typeof message.ownershipGeneration === "number" &&
    typeof previous.ownershipGeneration === "number" &&
    message.ownershipGeneration > previous.ownershipGeneration;
}

export function createPropertyLockClient(input: Readonly<{
  socket?: WebSocketLike;
  socketFactory?: () => WebSocketLike;
  editorSession: EditorSession;
  persistEditorSession: (session: EditorSession) => Promise<void> | void;
  presence?: () => PropertyLockPresence;
  hasUnsavedWork?: () => boolean;
  onStateChange?: (state: PropertyLockState) => void;
  onTokenUpdate?: (token: string) => Promise<void> | void;
  onOwnershipTransferred?: (event: PropertyLockOwnershipTransfer) => Promise<void> | void;
  networkReachable?: () => Promise<boolean>;
  now?: () => number;
  operationId?: () => string;
  /** Production credential carrier. When present, no subscription or queued
   * traffic is sent until the server acknowledges the first auth frame. */
  authentication?: Readonly<{
    currentToken: () => string;
    timeoutMs?: number;
  }>;
}>) {
  const now = input.now ?? Date.now;
  const operationId = input.operationId ?? (() => globalThis.crypto?.randomUUID?.() ?? `lock-${now()}-${Math.random()}`);
  let editorSession = input.editorSession;
  let state: PropertyLockState = {
    ...INITIAL_PROPERTY_LOCK_STATE,
    environmentKey: editorSession.environmentKey,
    editorSessionId: editorSession.editorSessionId,
  };
  let currentSocket: WebSocketLike | null = null;
  let initialSocket = input.socket ?? null;
  let socketOpen = false;
  let subscribed = false;
  let authenticationReady = !input.authentication;
  let authenticationBlocked = false;
  let authenticationTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let wantsLock = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectionLossTimer: ReturnType<typeof setTimeout> | null = null;
  let lastOwnedFence: PropertyLockFence | null = null;
  let lastActivityAt = now();
  let lastHeartbeatAt = Number.NEGATIVE_INFINITY;
  const pendingFrames: Array<{
    type: LockClientMessageType;
    extra?: Readonly<Record<string, string | number | boolean>>;
  }> = [];
  let authoritativeStatusOccurrence = 0;
  const statusWaiters = new Set<{
    afterOccurrence: number;
    timeout: ReturnType<typeof setTimeout>;
    resolve: (state: PropertyLockState | null) => void;
  }>();

  const resolveStatusWaiters = (next: PropertyLockState | null): void => {
    for (const waiter of [...statusWaiters]) {
      if (next !== null && authoritativeStatusOccurrence <= waiter.afterOccurrence) {
        continue;
      }
      statusWaiters.delete(waiter);
      clearTimeout(waiter.timeout);
      waiter.resolve(next);
    }
  };

  const waitForStatusAfter = (
    afterOccurrence: number,
    timeoutMs: number,
  ): Promise<PropertyLockState | null> => new Promise((resolve) => {
    const waiter = {
      afterOccurrence,
      timeout: setTimeout(() => {
        statusWaiters.delete(waiter);
        resolve(null);
      }, Math.max(0, timeoutMs)),
      resolve,
    };
    statusWaiters.add(waiter);
  });

  const transferEnvelope = (): Readonly<Record<string, string | number | boolean>> => ({
    operationId: operationId(),
    expectedPropertyRevision: state.propertyRevision ?? 0,
    expectedFeedRevision: state.feedRevision ?? 0,
  });

  const setState = (next: PropertyLockState): void => {
    state = next;
    input.onStateChange?.(state);
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearConnectionLossTimer = (): void => {
    if (connectionLossTimer !== null) {
      clearTimeout(connectionLossTimer);
      connectionLossTimer = null;
    }
  };

  const clearAuthenticationTimer = (): void => {
    if (authenticationTimer !== null) {
      clearTimeout(authenticationTimer);
      authenticationTimer = null;
    }
  };

  const failAuthentication = (socket: WebSocketLike, reason: string): void => {
    if (disposed || currentSocket !== socket) return;
    clearAuthenticationTimer();
    authenticationReady = false;
    authenticationBlocked = true;
    disposed = true;
    currentSocket = null;
    socketOpen = false;
    subscribed = false;
    resolveStatusWaiters(null);
    pendingFrames.splice(0);
    setState({
      ...state,
      role: "unknown",
      connectivity: "unavailable",
      state: "locked",
      timings: {},
      disconnectReason: reason,
    });
    try {
      socket.close();
    } catch {
      // The unavailable state is already authoritative for this client.
    }
  };

  const send = (type: LockClientMessageType, extra?: Readonly<Record<string, string | number | boolean>>): void => {
    if (disposed) {
      return;
    }
    if (type === "subscribe" && (!socketOpen || !authenticationReady)) {
      return;
    }
    if (type !== "subscribe" && (!socketOpen || !subscribed)) {
      const existingIndex = pendingFrames.findIndex((frame) => frame.type === type);
      if (existingIndex >= 0) {
        pendingFrames[existingIndex] = { type, extra };
      } else {
        pendingFrames.push({ type, extra });
      }
      return;
    }
    if (!currentSocket) {
      return;
    }
    currentSocket.send(JSON.stringify(buildClientFrame({
      type,
      environmentKey: editorSession.environmentKey,
      siteId: editorSession.siteId,
      editorSessionId: editorSession.editorSessionId,
      presence: input.presence?.() ?? QUALIFYING_PRESENCE,
      hasUnsavedWork: input.hasUnsavedWork?.() ?? false,
      ...(type === "subscribe" || !state.lockToken ? {} : { lockToken: state.lockToken }),
      extra,
    })));
  };

  const startConnectionLossWatch = (): void => {
    if (connectionLossTimer !== null || (!input.socketFactory && !input.networkReachable)) {
      return;
    }
    connectionLossTimer = setTimeout(() => {
      connectionLossTimer = null;
      void (async () => {
        const reachable = await (input.networkReachable?.() ?? checkNetworkReachability()).catch(() => false);
        if (disposed || subscribed || socketOpen) {
          return;
        }
        if (!reachable) {
          setState({
            ...state,
            role: "unknown",
            connectivity: "unavailable",
            state: "locked",
            disconnectReason: "network_unavailable",
          });
        }
      })();
    }, PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS);
  };

  const scheduleReconnect = (): void => {
    if (disposed || !input.socketFactory || reconnectTimer !== null) {
      return;
    }
    reconnectAttempts += 1;
    const delay = Math.min(
      PROPERTY_LOCK_RECONNECT_DELAY_MS * 2 ** (reconnectAttempts - 1),
      PROPERTY_LOCK_RECONNECT_MAX_DELAY_MS,
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const handleTransportLoss = (socket: WebSocketLike, reason: string): void => {
    if (disposed || currentSocket !== socket) {
      return;
    }
    currentSocket = null;
    socketOpen = false;
    subscribed = false;
    authenticationReady = !input.authentication;
    clearAuthenticationTimer();
    resolveStatusWaiters(null);
    setState({
      ...state,
      role: "unknown",
      connectivity: "reconnecting",
      state: "disconnect_warning",
      timings: {},
      disconnectReason: reason,
    });
    startConnectionLossWatch();
    scheduleReconnect();
  };

  const observeAuthoritativeOwnership = (
    message: LockServerMessage,
    next: PropertyLockState,
  ): void => {
    if (message.type !== "lock_state") {
      return;
    }
    if (isAuthoritativeTransfer(message, editorSession.editorSessionId, lastOwnedFence)) {
      const previous = lastOwnedFence;
      lastOwnedFence = null;
      if (previous) {
        void Promise.resolve(input.onOwnershipTransferred?.({ previous, next })).catch((error) => {
          console.error("[Unfluffify][rewrite] Unable to discard the transferred lock draft", error);
        });
      }
      return;
    }
    if (
      message.isEditor === true &&
      message.editorSessionId === editorSession.editorSessionId &&
      typeof message.lockToken === "string"
    ) {
      lastOwnedFence = {
        editorSessionId: editorSession.editorSessionId,
        lockToken: message.lockToken,
        ...(typeof message.ownershipGeneration === "number"
          ? { ownershipGeneration: message.ownershipGeneration }
          : {}),
      };
    }
  };

  const attachSocket = (socket: WebSocketLike): void => {
    currentSocket = socket;
    socket.addEventListener("open", () => {
      if (disposed || currentSocket !== socket) {
        return;
      }
      socketOpen = true;
      if (!input.authentication) {
        send("subscribe");
        return;
      }
      const token = input.authentication.currentToken().trim();
      if (!token) {
        failAuthentication(socket, "authentication_credential_missing");
        return;
      }
      socket.send(JSON.stringify(buildLockAuthenticationFrame(token)));
      authenticationTimer = setTimeout(() => {
        failAuthentication(socket, "authentication_capability_unavailable");
      }, input.authentication.timeoutMs ?? PROPERTY_LOCK_AUTHENTICATION_TIMEOUT_MS);
    });
    socket.addEventListener("message", (event) => {
      if (disposed || currentSocket !== socket) {
        return;
      }
      let message: LockServerMessage;
      try {
        message = parseServerMessage(JSON.parse(String(event.data)));
      } catch {
        if (input.authentication && !authenticationReady) {
          failAuthentication(socket, "authentication_protocol_invalid");
        }
        return;
      }
      if (message.type === "authentication_failed") {
        failAuthentication(socket, "authentication_rejected");
        return;
      }
      if (message.type === "authenticated") {
        if (!input.authentication || message.protocol !== "bearer-frame-v1") {
          failAuthentication(socket, "authentication_protocol_invalid");
          return;
        }
        clearAuthenticationTimer();
        authenticationReady = true;
        if (typeof message.token === "string" && message.token.trim()) {
          void input.onTokenUpdate?.(message.token);
        }
        send("subscribe");
        return;
      }
      if (input.authentication && !authenticationReady) {
        failAuthentication(socket, "authentication_ack_required");
        return;
      }
      if (message.type === "token_update" && typeof message.token === "string" && message.token.trim()) {
        void input.onTokenUpdate?.(message.token);
      }
      if (message.type === "subscribed") {
        if (
          typeof message.editorSessionId === "string" &&
          message.editorSessionId !== editorSession.editorSessionId
        ) {
          setState({ ...state, role: "unknown", connectivity: "unavailable", state: "locked" });
          disposed = true;
          clearReconnectTimer();
          clearConnectionLossTimer();
          currentSocket = null;
          socket.close();
          pendingFrames.splice(0);
          return;
        }
        const adopted = adoptEditorSession(editorSession, {
          ...editorSession,
          updatedAt: now(),
        });
        editorSession = adopted.current;
        subscribed = true;
        reconnectAttempts = 0;
        clearReconnectTimer();
        clearConnectionLossTimer();
        void input.persistEditorSession(adopted.current);
        state = reducePropertyLockState(state, message);
        while (pendingFrames.length > 0) {
          const pending = pendingFrames.shift();
          if (pending) send(pending.type, pending.extra);
        }
        if (wantsLock) {
          send("take_lock");
        }
        setState(state);
        return;
      }
      const next = reducePropertyLockState(state, message);
      observeAuthoritativeOwnership(message, next);
      setState(next);
      if (message.type === "lock_state") {
        authoritativeStatusOccurrence += 1;
        resolveStatusWaiters(next);
      }
    });
    socket.addEventListener("error", () => {
      if (currentSocket !== socket || disposed) {
        return;
      }
      handleTransportLoss(socket, "socket_error");
      try {
        socket.close();
      } catch {
        // The loss is already recorded and reconnect scheduling is independent.
      }
    });
    socket.addEventListener("close", () => {
      handleTransportLoss(socket, "socket_closed");
    });
  };

  function connect(): void {
    if (disposed || authenticationBlocked || currentSocket) {
      return;
    }
    let socket: WebSocketLike | null;
    try {
      socket = initialSocket ?? input.socketFactory?.() ?? null;
    } catch {
      initialSocket = null;
      setState({
        ...state,
        role: "unknown",
        connectivity: "reconnecting",
        state: "disconnect_warning",
        timings: {},
        disconnectReason: "socket_connect_failed",
      });
      startConnectionLossWatch();
      scheduleReconnect();
      return;
    }
    initialSocket = null;
    if (!socket) {
      setState({ ...state, role: "unknown", connectivity: "unavailable", state: "locked" });
      return;
    }
    attachSocket(socket);
  }

  connect();

  return {
    claim(): void {
      wantsLock = true;
      if (socketOpen && subscribed) {
        send("take_lock");
      }
    },
    release(): void {
      wantsLock = false;
      send("release_lock");
    },
    heartbeat(): void {
      if (now() - lastActivityAt > PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS) {
        return;
      }
      if (now() - lastHeartbeatAt < PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS) {
        return;
      }
      lastHeartbeatAt = now();
      send("heartbeat");
    },
    activity(): void {
      lastActivityAt = now();
      send("activity");
    },
    clientStatus(): void {
      send("client_status");
    },
    async refreshStatus(timeoutMs = PROPERTY_LOCK_STATUS_REFRESH_TIMEOUT_MS): Promise<PropertyLockState | null> {
      if (disposed) {
        return null;
      }
      const deadline = Date.now() + Math.max(0, timeoutMs);
      // A status heartbeat only mirrors the authority row. It does not run
      // Hub's grant-time candidate-feed reconciliation, so a property whose
      // stored snapshot advanced out of band can still reject the following
      // mutation with a stale fence. Reacquiring the lock for this same
      // editor session is Hub's authoritative mutation-fence refresh: it
      // reconciles the feed first and returns the complete current grant.
      //
      // Run a drain round before the fence round. Save reconciliation reports
      // presence/dirty facts immediately before this call, and their earlier
      // client_status response may already be in flight. Without the drain,
      // that older frame can satisfy the waiter before the take_lock response
      // carrying Hub's reconciled mutation fence arrives.
      const drain = waitForStatusAfter(authoritativeStatusOccurrence, deadline - Date.now());
      send("take_lock");
      if (await drain === null || disposed) {
        return null;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return null;
      }
      const refreshed = waitForStatusAfter(authoritativeStatusOccurrence, remaining);
      send("take_lock");
      return await refreshed;
    },
    suggestTakeover(): void {
      send("suggest_takeover");
    },
    respondToSuggestion(suggestionId: string, accept: boolean, discardUnsaved: boolean): void {
      send("respond_to_suggestion", {
        suggestionId,
        accept,
        discardUnsaved,
        discardPrevious: discardUnsaved,
        ...(accept ? transferEnvelope() : {}),
      });
    },
    continueEditing(force: boolean, discardPrevious: boolean): void {
      send("continue_editing", { force, discardPrevious, discardUnsaved: discardPrevious, ...transferEnvelope() });
    },
    close(): void {
      if (disposed) {
        return;
      }
      wantsLock = false;
      send("release_lock");
      disposed = true;
      clearReconnectTimer();
      clearConnectionLossTimer();
      clearAuthenticationTimer();
      const socket = currentSocket;
      currentSocket = null;
      socketOpen = false;
      subscribed = false;
      authenticationReady = !input.authentication;
      resolveStatusWaiters(null);
      socket?.close();
      pendingFrames.splice(0);
    },
    state(): PropertyLockState {
      return state;
    },
    editorSession(): EditorSession {
      return editorSession;
    },
    isClosed(): boolean {
      return disposed;
    },
  };
}
