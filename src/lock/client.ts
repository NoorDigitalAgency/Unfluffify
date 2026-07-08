import { adoptLockIdentity, type LockIdentity } from "./identity";
import { reducePropertyLockState, INITIAL_PROPERTY_LOCK_STATE, type PropertyLockState } from "./reducer";
import { buildClientFrame, parseServerMessage, type LockClientMessageType } from "./ws";

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
  now?: () => number;
}>) {
  const now = input.now ?? Date.now;
  let state: PropertyLockState = INITIAL_PROPERTY_LOCK_STATE;
  let identity = input.identity;
  let socketOpen = false;
  let subscribed = false;
  let closed = false;
  const pendingFrames: Array<{ type: LockClientMessageType; extra?: Readonly<Record<string, string | number | boolean>> }> = [];

  const send = (type: LockClientMessageType, extra?: Readonly<Record<string, string | number | boolean>>): void => {
    if (closed) {
      return;
    }
    if (type !== "subscribe" && (!socketOpen || !identity || !subscribed)) {
      pendingFrames.push({ type, extra });
      return;
    }
    input.socket.send(JSON.stringify(buildClientFrame({
      type,
      siteId: input.siteId,
      identity: identity?.identity ?? "pending",
      pageUrl: input.pageUrl,
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
    state = reducePropertyLockState(state, message);
  });
  input.socket.addEventListener("error", () => {
    state = { ...state, role: "unknown" };
  });
  input.socket.addEventListener("close", () => {
    socketOpen = false;
    subscribed = false;
    closed = true;
    pendingFrames.splice(0);
    state = { ...state, role: "unknown", state: "locked" };
  });

  return {
    claim(): void {
      send("take_lock");
    },
    release(): void {
      send("release_lock");
    },
    heartbeat(): void {
      send("heartbeat");
    },
    continueEditing(force: boolean, discardPrevious: boolean): void {
      send("continue_editing", { force, discardPrevious });
    },
    state(): PropertyLockState {
      return state;
    },
    identity(): LockIdentity | null {
      return identity;
    },
  };
}
