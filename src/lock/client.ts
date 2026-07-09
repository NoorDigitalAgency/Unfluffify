import { adoptLockIdentity, type LockIdentity } from "./identity";
import { reducePropertyLockState, INITIAL_PROPERTY_LOCK_STATE, type PropertyLockState } from "./reducer";
import { buildClientFrame, parseServerMessage, type LockClientMessageType } from "./ws";
import { PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS, PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS } from "./timings";

export type WebSocketLike = Readonly<{
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown }) => void): void;
}>;

export function createPropertyLockClient(input: Readonly<{
  socket: WebSocketLike;
  tabId: number;
  siteId: number;
  pageUrl: string;
  identity: LockIdentity | null;
  persistIdentity: (identity: LockIdentity) => Promise<void> | void;
  hasUnsavedChanges?: () => boolean;
  onStateChange?: (state: PropertyLockState) => void;
  now?: () => number;
}>) {
  const now = input.now ?? Date.now;
  let state: PropertyLockState = INITIAL_PROPERTY_LOCK_STATE;
  let identity = input.identity;
  let pageUrl = input.pageUrl;
  let socketOpen = false;
  let subscribed = false;
  let closed = false;
  let lastActivityAt = now();
  let lastHeartbeatAt = Number.NEGATIVE_INFINITY;
  const pendingFrames: Array<{ type: LockClientMessageType; extra?: Readonly<Record<string, string | number | boolean>> }> = [];

  const setState = (next: PropertyLockState): void => {
    state = next;
    input.onStateChange?.(state);
  };

  const send = (type: LockClientMessageType, extra?: Readonly<Record<string, string | number | boolean>>): void => {
    if (closed) {
      return;
    }
    if (type !== "subscribe" && (!socketOpen || !identity || !subscribed)) {
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
      siteId: input.siteId,
      identity: identity?.identity ?? "pending",
      pageUrl,
      hasUnsavedChanges: input.hasUnsavedChanges?.() ?? false,
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
    if (message.type === "subscribed" && typeof message.identity === "string") {
      const adopted = adoptLockIdentity(identity, {
        tabId: input.tabId,
        siteId: input.siteId,
        identity: message.identity,
        updatedAt: now(),
      });
      identity = adopted.current;
      subscribed = true;
      void input.persistIdentity(adopted.current);
      while (pendingFrames.length > 0) {
        const pending = pendingFrames.shift();
        if (pending) send(pending.type, pending.extra);
      }
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
    setState({ ...state, role: "unknown", state: "locked" });
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
    setPageUrl(nextPageUrl: string): void {
      pageUrl = nextPageUrl;
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
    identity(): LockIdentity | null {
      return identity;
    },
    isClosed(): boolean {
      return closed;
    },
  };
}
