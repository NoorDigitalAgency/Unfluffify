import { adoptEditorSession, type EditorSession } from "./identity";
import { reducePropertyLockState, INITIAL_PROPERTY_LOCK_STATE, type PropertyLockState } from "./reducer";
import {
  buildClientFrame,
  parseServerMessage,
  type LockClientMessageType,
  type PropertyLockPresence,
} from "./ws";
import { PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS, PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS } from "./timings";

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

export function createPropertyLockClient(input: Readonly<{
  socket: WebSocketLike;
  editorSession: EditorSession;
  persistEditorSession: (session: EditorSession) => Promise<void> | void;
  presence?: () => PropertyLockPresence;
  hasUnsavedWork?: () => boolean;
  onStateChange?: (state: PropertyLockState) => void;
  onTokenUpdate?: (token: string) => Promise<void> | void;
  now?: () => number;
}>) {
  const now = input.now ?? Date.now;
  let editorSession = input.editorSession;
  let state: PropertyLockState = {
    ...INITIAL_PROPERTY_LOCK_STATE,
    environmentKey: editorSession.environmentKey,
    editorSessionId: editorSession.editorSessionId,
  };
  let socketOpen = false;
  let subscribed = false;
  let closed = false;
  let lastActivityAt = now();
  let lastHeartbeatAt = Number.NEGATIVE_INFINITY;
  const pendingFrames: Array<{
    type: LockClientMessageType;
    extra?: Readonly<Record<string, string | number | boolean>>;
  }> = [];

  const setState = (next: PropertyLockState): void => {
    state = next;
    input.onStateChange?.(state);
  };

  const send = (type: LockClientMessageType, extra?: Readonly<Record<string, string | number | boolean>>): void => {
    if (closed) {
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
    input.socket.send(JSON.stringify(buildClientFrame({
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

  input.socket.addEventListener("open", () => {
    socketOpen = true;
    closed = false;
    send("subscribe");
  });
  input.socket.addEventListener("message", (event) => {
    const message = parseServerMessage(JSON.parse(String(event.data)));
    if (message.type === "token_update" && typeof message.token === "string" && message.token.trim()) {
      void input.onTokenUpdate?.(message.token);
    }
    if (message.type === "subscribed") {
      if (
        typeof message.editorSessionId === "string" &&
        message.editorSessionId !== editorSession.editorSessionId
      ) {
        setState({ ...state, role: "unknown", state: "locked" });
        input.socket.close();
        closed = true;
        pendingFrames.splice(0);
        return;
      }
      const adopted = adoptEditorSession(editorSession, {
        ...editorSession,
        updatedAt: now(),
      });
      editorSession = adopted.current;
      subscribed = true;
      void input.persistEditorSession(adopted.current);
      state = reducePropertyLockState(state, message);
      while (pendingFrames.length > 0) {
        const pending = pendingFrames.shift();
        if (pending) send(pending.type, pending.extra);
      }
      setState(state);
      return;
    }
    setState(reducePropertyLockState(state, message));
  });
  input.socket.addEventListener("error", () => {
    setState({ ...state, role: "unknown" });
  });
  input.socket.addEventListener("close", () => {
    socketOpen = false;
    subscribed = false;
    closed = true;
    pendingFrames.splice(0);
    setState({ ...state, role: "unknown", state: "locked", lockToken: undefined });
  });

  return {
    claim(): void {
      send("take_lock");
    },
    release(): void {
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
    suggestTakeover(): void {
      send("suggest_takeover");
    },
    respondToSuggestion(suggestionId: string, accept: boolean, discardUnsaved: boolean): void {
      send("respond_to_suggestion", { suggestionId, accept, discardUnsaved });
    },
    continueEditing(force: boolean, discardPrevious: boolean): void {
      send("continue_editing", { force, discardPrevious });
    },
    close(): void {
      send("release_lock");
      input.socket.close();
      closed = true;
      pendingFrames.splice(0);
    },
    state(): PropertyLockState {
      return state;
    },
    editorSession(): EditorSession {
      return editorSession;
    },
    isClosed(): boolean {
      return closed;
    },
  };
}
