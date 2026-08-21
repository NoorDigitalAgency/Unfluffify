import { BusFrameSchema, type BusFrame } from "../contract";
import type { Transport, Unsubscribe } from "../bus";

type RuntimeMessageSender = Readonly<{
  tab?: Readonly<{ id?: number }>;
  frameId?: number;
  /** Chrome's stable identifier for one document lifetime. Unlike frameId it
   * changes on reload/navigation and therefore fences delayed content calls. */
  documentId?: string;
}>;

type RuntimeOnMessage = Readonly<{
  addListener(listener: (message: unknown, sender: RuntimeMessageSender, sendResponse?: (response: unknown) => void) => unknown): void;
  removeListener(listener: (message: unknown, sender: RuntimeMessageSender, sendResponse?: (response: unknown) => void) => unknown): void;
}>;

type RuntimeLike = Readonly<{
  sendMessage(message: unknown, responseCallback?: (response: unknown) => void): Promise<unknown> | unknown;
  onMessage: RuntimeOnMessage;
}>;

type PortLike = Readonly<{
  postMessage(message: unknown): void;
  onMessage: Readonly<{
    addListener(listener: (message: unknown) => void): void;
    removeListener(listener: (message: unknown) => void): void;
  }>;
  onDisconnect?: Readonly<{
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
  }>;
}>;

type PortTransportOptions = Readonly<{
  peerInstanceId?: string;
  requestTimeoutMs?: number;
}>;

type PendingPortReply = Readonly<{
  resolve: (reply: BusFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>;

function parseFrame(message: unknown): BusFrame | null {
  const parsed = BusFrameSchema.safeParse(message);
  return parsed.success ? parsed.data : null;
}

function withSenderInstance(frame: BusFrame, sender: RuntimeMessageSender): BusFrame {
  const tabId = sender.tab?.id;
  if (typeof tabId === "number") {
    const documentPart = sender.documentId
      ? `:document:${encodeURIComponent(sender.documentId)}`
      : "";
    const routingInstance = `tab:${tabId}:frame:${sender.frameId ?? 0}${documentPart}`;
    return {
      ...frame,
      sourceInstance: frame.sourceInstance
        ? `${routingInstance}:${frame.sourceInstance}`
        : routingInstance,
    };
  }
  if (frame.sourceInstance) {
    return frame;
  }
  return frame;
}

function withPeerInstance(frame: BusFrame, peerInstanceId: string | undefined): BusFrame {
  if (!peerInstanceId) {
    return frame;
  }
  return {
    ...frame,
    sourceInstance: frame.sourceInstance
      ? `${peerInstanceId}:${frame.sourceInstance}`
      : peerInstanceId,
  };
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return Boolean(value) && typeof (value as PromiseLike<T>).then === "function";
}

function sendRuntimeMessage(runtime: RuntimeLike, frame: BusFrame): Promise<BusFrame | void> {
  const nativeCallbackApi = runtime.sendMessage.length === 0 && /\[native code\]/.test(String(runtime.sendMessage));
  if (!nativeCallbackApi) {
    return Promise.resolve(runtime.sendMessage(frame)).then((response) => parseFrame(response) ?? undefined);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
    };
    try {
      const maybePromise = runtime.sendMessage(frame, (response) => {
        finish(() => resolve(parseFrame(response) ?? undefined));
      });
      if (isPromiseLike<unknown>(maybePromise)) {
        void maybePromise.then(
          (response) => finish(() => resolve(parseFrame(response) ?? undefined)),
          (error) => finish(() => reject(error)),
        );
      } else if (maybePromise !== undefined) {
        finish(() => resolve(parseFrame(maybePromise) ?? undefined));
      }
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export function createRuntimeTransport(runtime: RuntimeLike): Transport {
  const listeners = new Set<(frame: BusFrame) => Promise<BusFrame | void> | BusFrame | void>();
  const runtimeListener = (message: unknown, sender: RuntimeMessageSender, sendResponse?: (response: unknown) => void) => {
    const parsedFrame = parseFrame(message);
    const frame = parsedFrame ? withSenderInstance(parsedFrame, sender) : null;
    if (!frame) {
      return undefined;
    }
    const [listener] = listeners;
    if (!listener) {
      return undefined;
    }
    const result = listener(frame);
    if (result === undefined) {
      return undefined;
    }
    if (frame.frameType === "event") {
      void Promise.resolve(result).catch(() => undefined);
      return undefined;
    }
    void Promise.resolve(result).then((reply) => {
      if (reply !== undefined) {
        sendResponse?.(reply);
      }
    });
    return true;
  };
  runtime.onMessage.addListener(runtimeListener);

  return {
    async send(frame: BusFrame): Promise<BusFrame | void> {
      if (frame.frameType === "event") {
        void sendRuntimeMessage(runtime, frame).catch(() => undefined);
        return undefined;
      }
      return await sendRuntimeMessage(runtime, frame);
    },
    onReceive(handler): Unsubscribe {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}

export function createPortTransport(port: PortLike, options: PortTransportOptions = {}): Transport {
  const listeners = new Set<(frame: BusFrame) => Promise<BusFrame | void> | BusFrame | void>();
  const pendingReplies = new Map<string, PendingPortReply>();
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const rejectPending = (message: string): void => {
    for (const [id, pending] of pendingReplies) {
      clearTimeout(pending.timer);
      pendingReplies.delete(id);
      pending.reject(new Error(message));
    }
  };
  const portListener = (message: unknown): void => {
    const parsedFrame = parseFrame(message);
    const frame = parsedFrame ? withPeerInstance(parsedFrame, options.peerInstanceId) : null;
    if (!frame) {
      return;
    }
    if (frame.frameType === "reply") {
      const pending = pendingReplies.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingReplies.delete(frame.id);
        pending.resolve(frame);
      }
      return;
    }
    for (const listener of listeners) {
      void Promise.resolve(listener(frame)).then((reply) => {
        if (reply) {
          port.postMessage(reply);
        }
      });
    }
  };
  port.onMessage.addListener(portListener);
  const disconnectListener = (): void => rejectPending("Port disconnected before reply");
  port.onDisconnect?.addListener(disconnectListener);

  return {
    async send(frame: BusFrame): Promise<BusFrame | void> {
      if (frame.frameType === "request") {
        return await new Promise<BusFrame>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingReplies.delete(frame.id);
            reject(new Error(`Port request timed out for ${frame.name}`));
          }, requestTimeoutMs);
          pendingReplies.set(frame.id, { resolve, reject, timer });
          try {
            port.postMessage(frame);
          } catch (error) {
            const pending = pendingReplies.get(frame.id);
            if (pending) {
              clearTimeout(pending.timer);
              pendingReplies.delete(frame.id);
            }
            reject(error instanceof Error ? error : new Error("Port postMessage failed"));
          }
        });
      }
      port.postMessage(frame);
    },
    onReceive(handler): Unsubscribe {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
        if (listeners.size === 0) {
          port.onMessage.removeListener(portListener);
          port.onDisconnect?.removeListener(disconnectListener);
          rejectPending("Port transport disposed before reply");
        }
      };
    },
  };
}
