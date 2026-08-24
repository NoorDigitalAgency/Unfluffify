import { describe, expect, it } from "vitest";

import type { BusFrame } from "../../../../src/messaging/contract";
import { createPortTransport, createRuntimeTransport } from "../../../../src/messaging/transports/runtime";

function frame(): BusFrame {
  return {
    kind: "uf-bus/1",
    frameType: "event",
    id: "evt-1",
    seq: 1,
    name: "diag.event",
    source: "popup",
    sourceInstance: "popup:default",
    target: "background",
    payload: { ok: true },
  };
}

function runtimeLike() {
  const listeners = new Set<
    (message: unknown, sender: { tab?: { id?: number }; frameId?: number; documentId?: string }) => unknown
  >();
  return {
    api: {
      sendMessage(message: unknown) {
        return message;
      },
      onMessage: {
        addListener(
          listener: (message: unknown, sender: { tab?: { id?: number }; frameId?: number; documentId?: string }) => unknown,
        ) {
          listeners.add(listener);
        },
        removeListener(
          listener: (message: unknown, sender: { tab?: { id?: number }; frameId?: number; documentId?: string }) => unknown,
        ) {
          listeners.delete(listener);
        },
      },
    },
    dispatch(
      message: unknown,
      sendResponse?: (response: unknown) => void,
      sender: { tab?: { id?: number }; frameId?: number; documentId?: string } = { tab: { id: 0 }, frameId: 0 },
    ) {
      return Array.from(listeners, (listener) => listener(message, sender, sendResponse))[0];
    },
  };
}

describe("P1 runtime transports", () => {
  it("round-trips runtime messages and ignores non-bus messages", async () => {
    const fake = runtimeLike();
    const transport = createRuntimeTransport(fake.api);
    const seen: string[] = [];
    transport.onReceive((message) => {
      seen.push(message.name);
      return { ...message, frameType: "reply", ok: true, payload: { ack: true } };
    });

    await expect(transport.send(frame())).resolves.toBeUndefined();
    expect(fake.dispatch({ not: "bus" })).toBeUndefined();
    let response: unknown;
    expect(fake.dispatch({ ...frame(), frameType: "request" }, (value) => {
      response = value;
    })).toBe(true);
    await Promise.resolve();
    expect(response).toMatchObject({
      frameType: "reply",
      ok: true,
      payload: { ack: true },
    });
    expect(fake.dispatch(frame())).toBeUndefined();
    expect(seen).toEqual(["diag.event", "diag.event"]);
  });

  it("does not claim runtime responses when the inbound handler ignores a frame", () => {
    const fake = runtimeLike();
    const transport = createRuntimeTransport(fake.api);
    transport.onReceive(() => undefined);

    expect(fake.dispatch(frame())).toBeUndefined();
  });

  it("waits for Chrome callback-style sendMessage replies", async () => {
    const reply = { ...frame(), frameType: "reply" as const, ok: true, payload: { ack: true } };
    const sendMessage = function (...args: unknown[]) {
        const callback = args[1] as ((response: unknown) => void) | undefined;
        setTimeout(() => callback?.(reply), 0);
        return undefined;
    };
    sendMessage.toString = () => "function sendMessage() { [native code] }";
    const fake = {
      sendMessage,
      onMessage: {
        addListener() {},
        removeListener() {},
      },
    };
    const transport = createRuntimeTransport(fake);

    await expect(transport.send({ ...frame(), frameType: "request" })).resolves.toEqual(reply);
  });

  it("consumes callback-style runtime.lastError and rejects the delivery", async () => {
    const runtime: {
      sendMessage: ((...args: unknown[]) => undefined) & { toString: () => string };
      onMessage: { addListener(): void; removeListener(): void };
      lastError?: { message: string };
    } = {
      sendMessage: (() => undefined) as ((...args: unknown[]) => undefined) & { toString: () => string },
      onMessage: { addListener() {}, removeListener() {} },
    };
    runtime.sendMessage = function (...args: unknown[]) {
      const callback = args[1] as ((response: unknown) => void) | undefined;
      runtime.lastError = { message: "The message port closed before a response was received." };
      callback?.(undefined);
      runtime.lastError = undefined;
      return undefined;
    } as typeof runtime.sendMessage;
    runtime.sendMessage.toString = () => "function sendMessage() { [native code] }";
    const transport = createRuntimeTransport(runtime);

    await expect(transport.send({ ...frame(), frameType: "request" }))
      .rejects.toThrow("message port closed");
  });

  it("combines runtime sender identity with the bus instance", async () => {
    const fake = runtimeLike();
    const transport = createRuntimeTransport(fake.api);
    const seen: string[] = [];
    transport.onReceive((message) => {
      seen.push(message.sourceInstance ?? "");
    });

    fake.dispatch({ ...frame(), sourceInstance: "content:default", source: "content" });

    expect(seen).toEqual(["tab:0:frame:0:content:default"]);
  });

  it("stamps and escapes the Chrome document identity for durable document fences", () => {
    const fake = runtimeLike();
    const transport = createRuntimeTransport(fake.api);
    const seen: string[] = [];
    transport.onReceive((message) => {
      seen.push(message.sourceInstance ?? "");
    });

    fake.dispatch(
      { ...frame(), sourceInstance: "content:default", source: "content" },
      undefined,
      { tab: { id: 7 }, frameId: 0, documentId: "doc:reload/1" },
    );

    expect(seen).toEqual(["tab:7:frame:0:document:doc%3Areload%2F1:content:default"]);
  });

  it("delivers port messages to listeners and posts replies", async () => {
    const listeners = new Set<(message: unknown) => void>();
    const posted: unknown[] = [];
    const port = {
      postMessage(message: unknown) {
        posted.push(message);
      },
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          listeners.add(listener);
        },
        removeListener(listener: (message: unknown) => void) {
          listeners.delete(listener);
        },
      },
    };
    const transport = createPortTransport(port);
    transport.onReceive((message) => ({
      ...message,
      frameType: "reply",
      ok: true,
      payload: { ack: true },
    }));

    await transport.send(frame());
    for (const listener of listeners) {
      listener(frame());
    }
    await Promise.resolve();

    expect(posted).toMatchObject([
      { name: "diag.event" },
      { frameType: "reply", ok: true, payload: { ack: true } },
    ]);
  });

  it("correlates port request replies by id", async () => {
    const listeners = new Set<(message: unknown) => void>();
    const posted: unknown[] = [];
    const port = {
      postMessage(message: unknown) {
        posted.push(message);
      },
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          listeners.add(listener);
        },
        removeListener(listener: (message: unknown) => void) {
          listeners.delete(listener);
        },
      },
    };
    const transport = createPortTransport(port);
    const request: BusFrame = { ...frame(), frameType: "request", id: "req-1" };
    const pending = transport.send(request);

    for (const listener of listeners) {
      listener({ ...request, frameType: "reply", source: "background", target: "popup", ok: true });
    }

    await expect(pending).resolves.toMatchObject({
      frameType: "reply",
      id: "req-1",
      ok: true,
    });
    expect(posted).toEqual([request]);
  });

  it("rejects pending port requests on timeout", async () => {
    const listeners = new Set<(message: unknown) => void>();
    const port = {
      postMessage(_message: unknown) {
        return undefined;
      },
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          listeners.add(listener);
        },
        removeListener(listener: (message: unknown) => void) {
          listeners.delete(listener);
        },
      },
    };
    const transport = createPortTransport(port, { requestTimeoutMs: 1 });
    const request: BusFrame = { ...frame(), frameType: "request", id: "req-timeout" };

    await expect(transport.send(request)).rejects.toThrow("Port request timed out");
  });

  it("rejects pending port requests on disconnect", async () => {
    const messageListeners = new Set<(message: unknown) => void>();
    const disconnectListeners = new Set<() => void>();
    const port = {
      postMessage(_message: unknown) {
        return undefined;
      },
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          messageListeners.add(listener);
        },
        removeListener(listener: (message: unknown) => void) {
          messageListeners.delete(listener);
        },
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnectListeners.add(listener);
        },
        removeListener(listener: () => void) {
          disconnectListeners.delete(listener);
        },
      },
    };
    const transport = createPortTransport(port, { requestTimeoutMs: 100 });
    const request: BusFrame = { ...frame(), frameType: "request", id: "req-disconnect" };
    const pending = transport.send(request);

    for (const listener of disconnectListeners) {
      listener();
    }

    await expect(pending).rejects.toThrow("Port disconnected before reply");
  });

  it("stamps inbound port frames with the peer identity", async () => {
    const listeners = new Set<(message: unknown) => void>();
    const port = {
      postMessage(_message: unknown) {
        return undefined;
      },
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          listeners.add(listener);
        },
        removeListener(listener: (message: unknown) => void) {
          listeners.delete(listener);
        },
      },
    };
    const transport = createPortTransport(port, { peerInstanceId: "tab:9:frame:0" });
    const seen: string[] = [];
    transport.onReceive((message) => {
      seen.push(message.sourceInstance ?? "");
    });

    for (const listener of listeners) {
      listener({ ...frame(), sourceInstance: "content:default", source: "content" });
    }

    expect(seen).toEqual(["tab:9:frame:0:content:default"]);
  });
});
