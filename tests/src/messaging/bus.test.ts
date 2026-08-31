import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { BusFrame } from "../../../src/messaging/contract";
import { defineBus, type Transport } from "../../../src/messaging/bus";
import { defineContract } from "../../../src/messaging/contract";

const contract = defineContract({
  commands: {
    "diag.ping": {
      request: z.object({ nonce: z.string() }),
      response: z.object({ pong: z.string() }),
    },
  },
  events: {
    "diag.event": z.object({ value: z.number() }),
  },
});

function memoryTransport(): Transport & { inbound(frame: BusFrame): Promise<BusFrame | void> } {
  let handler: ((frame: BusFrame) => Promise<BusFrame | void> | BusFrame | void) | null = null;
  return {
    async send(frame) {
      return await handler?.(frame);
    },
    onReceive(nextHandler) {
      handler = nextHandler;
      return () => {
        handler = null;
      };
    },
    async inbound(frame) {
      return await handler?.(frame);
    },
  };
}

describe("P1 defineBus (INV-10.9, INV-10.11)", () => {
  it("returns exactly one typed reply for local commands", async () => {
    const bus = defineBus(contract, { realm: "background" });
    bus.onCommand("diag.ping", (payload) => ({ pong: payload.nonce }));

    await expect(bus.request("diag.ping", { nonce: "n1" })).resolves.toEqual({
      ok: true,
      data: { pong: "n1" },
    });
  });

  it("terminalizes a never-settling transported request with a typed deadline", async () => {
    vi.useFakeTimers();
    try {
      const transport: Transport = {
        async send() {
          return await new Promise<BusFrame>(() => undefined);
        },
        onReceive() {
          return () => undefined;
        },
      };
      const bus = defineBus(contract, { realm: "popup", transport });
      const pending = bus.request("diag.ping", { nonce: "timeout" }, {
        target: "background",
        timeoutMs: 25,
      });

      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toEqual({
        ok: false,
        failure: {
          code: "REQUEST_TIMEOUT",
          message: "Request timed out for diag.ping",
          details: { timeoutMs: 25 },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the configured deadline to local handlers and ignores a late rejection", async () => {
    vi.useFakeTimers();
    try {
      let rejectHandler!: (reason?: unknown) => void;
      const bus = defineBus(contract, { realm: "background", requestTimeoutMs: 20 });
      bus.onCommand("diag.ping", () => new Promise<{ pong: string }>((_resolve, reject) => {
        rejectHandler = reject;
      }));
      const pending = bus.request("diag.ping", { nonce: "local-timeout" });

      await vi.advanceTimersByTimeAsync(20);
      await expect(pending).resolves.toMatchObject({
        ok: false,
        failure: { code: "REQUEST_TIMEOUT", details: { timeoutMs: 20 } },
      });

      // The request result is immutable after its deadline, and the rejection is
      // still observed by the deadline wrapper rather than becoming unchecked.
      rejectHandler(new Error("late handler failure"));
      await Promise.resolve();
      await expect(pending).resolves.toMatchObject({ failure: { code: "REQUEST_TIMEOUT" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the request deadline when a transported reply wins the race", async () => {
    vi.useFakeTimers();
    try {
      const transport: Transport = {
        send(frame) {
          return new Promise<BusFrame>((resolve) => {
            setTimeout(() => resolve({
              ...frame,
              frameType: "reply",
              source: "background",
              target: frame.source,
              ok: true,
              payload: { pong: "before-deadline" },
            }), 5);
          });
        },
        onReceive() {
          return () => undefined;
        },
      };
      const bus = defineBus(contract, { realm: "popup", transport });
      const pending = bus.request("diag.ping", { nonce: "fast" }, {
        target: "background",
        timeoutMs: 10,
      });

      await vi.advanceTimersByTimeAsync(5);
      await expect(pending).resolves.toEqual({ ok: true, data: { pong: "before-deadline" } });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminalizes outstanding requests on disposal and consumes a late rejection", async () => {
    vi.useFakeTimers();
    try {
      let rejectTransport!: (reason?: unknown) => void;
      const transport: Transport = {
        send() {
          return new Promise<BusFrame>((_resolve, reject) => {
            rejectTransport = reject;
          });
        },
        onReceive() {
          return () => undefined;
        },
      };
      const bus = defineBus(contract, { realm: "popup", transport });
      const pending = bus.request("diag.ping", { nonce: "dispose" }, {
        target: "background",
        timeoutMs: 10_000,
      });

      bus.dispose();

      await expect(pending).resolves.toMatchObject({
        ok: false,
        failure: { code: "BUS_DISPOSED" },
      });
      expect(vi.getTimerCount()).toBe(0);
      rejectTransport(new Error("late transport failure"));
      await Promise.resolve();
      await expect(bus.request("diag.ping", { nonce: "after-dispose" })).resolves.toMatchObject({
        ok: false,
        failure: { code: "BUS_DISPOSED" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns structured failures for invalid payload, no handler, and invalid response", async () => {
    const invalidPayload = defineBus(contract, { realm: "background" });
    expect(await invalidPayload.request("diag.ping", { nonce: 1 } as { nonce: string })).toMatchObject({
      ok: false,
      failure: { code: "INVALID_PAYLOAD" },
    });

    const noHandler = defineBus(contract, { realm: "background" });
    expect(await noHandler.request("diag.ping", { nonce: "n1" })).toMatchObject({
      ok: false,
      failure: { code: "NO_HANDLER" },
    });

    const invalidResponse = defineBus(contract, { realm: "background" });
    invalidResponse.onCommand("diag.ping", () => ({ wrong: true } as unknown as { pong: string }));
    expect(await invalidResponse.request("diag.ping", { nonce: "n1" })).toMatchObject({
      ok: false,
      failure: { code: "INVALID_RESPONSE" },
    });
  });

  it("dedupes replayed request sequences and returns the cached reply once", async () => {
    const transport = memoryTransport();
    const bus = defineBus(contract, { realm: "background", transport });
    let calls = 0;
    bus.onCommand("diag.ping", (payload) => {
      calls += 1;
      return { pong: payload.nonce };
    });
    const frame: BusFrame = {
      kind: "uf-bus/1",
      frameType: "request",
      id: "req-1",
      seq: 7,
      name: "diag.ping",
      source: "content",
      sourceInstance: "tab:1:frame:0",
      target: "background",
      payload: { nonce: "n7" },
    };

    const first = await transport.inbound(frame);
    const second = await transport.inbound({ ...frame, id: "req-replay" });

    expect(first).toMatchObject({ ok: true, payload: { pong: "n7" } });
    expect(second).toMatchObject({
      id: "req-replay",
      ok: true,
      payload: { pong: "n7" },
      sourceInstance: expect.stringMatching(/^background:/),
    });
    expect(calls).toBe(1);
  });

  it("bounds the replay cache while preserving recent duplicate replies", async () => {
    const transport = memoryTransport();
    const bus = defineBus(contract, { realm: "background", transport });
    let calls = 0;
    bus.onCommand("diag.ping", (payload) => {
      calls += 1;
      return { pong: payload.nonce };
    });
    const makeFrame = (seq: number): BusFrame => ({
      kind: "uf-bus/1",
      frameType: "request",
      id: `req-${seq}`,
      seq,
      name: "diag.ping",
      source: "content",
      sourceInstance: "tab:1:frame:0",
      target: "background",
      payload: { nonce: `n${seq}` },
    });

    for (let seq = 1; seq <= 129; seq += 1) {
      await transport.inbound(makeFrame(seq));
    }
    const replayRecent = await transport.inbound({ ...makeFrame(129), id: "req-129-replay" });
    const replayExpired = await transport.inbound({ ...makeFrame(1), id: "req-1-replay" });

    expect(replayRecent).toMatchObject({ id: "req-129-replay", payload: { pong: "n129" } });
    expect(replayExpired).toMatchObject({ id: "req-1-replay", payload: { pong: "n1" } });
    expect(calls).toBe(130);
  });

  it("does not collide replay caches for different sender instances with the same sequence", async () => {
    const transport = memoryTransport();
    const bus = defineBus(contract, { realm: "background", transport });
    const seen: string[] = [];
    bus.onCommand("diag.ping", (payload) => {
      seen.push(payload.nonce);
      return { pong: payload.nonce };
    });
    const base = {
      kind: "uf-bus/1" as const,
      frameType: "request" as const,
      id: "req-1",
      seq: 1,
      name: "diag.ping",
      source: "content" as const,
      target: "background" as const,
    };

    const first = await transport.inbound({
      ...base,
      sourceInstance: "tab:1:frame:0",
      payload: { nonce: "one" },
    });
    const second = await transport.inbound({
      ...base,
      id: "req-2",
      sourceInstance: "tab:2:frame:0",
      payload: { nonce: "two" },
    });

    expect(first).toMatchObject({ payload: { pong: "one" } });
    expect(second).toMatchObject({ payload: { pong: "two" } });
    expect(seen).toEqual(["one", "two"]);
  });

  it("dedupes concurrent duplicate request sequences before the handler settles", async () => {
    const transport = memoryTransport();
    const bus = defineBus(contract, { realm: "background", transport });
    let calls = 0;
    let release: ((value: { pong: string }) => void) | null = null;
    bus.onCommand("diag.ping", () => {
      calls += 1;
      return new Promise<{ pong: string }>((resolve) => {
        release = resolve;
      });
    });
    const frame: BusFrame = {
      kind: "uf-bus/1",
      frameType: "request",
      id: "req-1",
      seq: 9,
      name: "diag.ping",
      source: "content",
      sourceInstance: "tab:1:frame:0",
      target: "background",
      payload: { nonce: "n9" },
    };

    const first = transport.inbound(frame);
    const second = transport.inbound({ ...frame, id: "req-replay" });
    release?.({ pong: "settled" });

    await expect(first).resolves.toMatchObject({ payload: { pong: "settled" } });
    await expect(second).resolves.toMatchObject({ id: "req-replay", payload: { pong: "settled" } });
    expect(calls).toBe(1);
  });

  it("serializes structured failures with a JSON-safe payload", async () => {
    const transport = memoryTransport();
    defineBus(contract, { realm: "background", transport });
    const reply = await transport.inbound({
      kind: "uf-bus/1",
      frameType: "request",
      id: "bad-1",
      seq: 11,
      name: "diag.ping",
      source: "content",
      sourceInstance: "tab:1:frame:0",
      target: "background",
      payload: { nonce: 1 },
    });
    const serialized = JSON.parse(JSON.stringify(reply));

    expect(serialized).toMatchObject({
      frameType: "reply",
      ok: false,
      payload: null,
      failure: { code: "INVALID_PAYLOAD" },
    });
  });

  it("ignores requests targeted at another realm and broadcast requests", async () => {
    const transport = memoryTransport();
    const bus = defineBus(contract, { realm: "popup", transport });
    let calls = 0;
    bus.onCommand("diag.ping", (payload) => {
      calls += 1;
      return { pong: payload.nonce };
    });
    const request: BusFrame = {
      kind: "uf-bus/1",
      frameType: "request",
      id: "req-1",
      seq: 12,
      name: "diag.ping",
      source: "content",
      sourceInstance: "tab:1:frame:0",
      target: "background",
      payload: { nonce: "n12" },
    };

    expect(await transport.inbound(request)).toBeUndefined();
    expect(await transport.inbound({ ...request, target: "broadcast" })).toBeUndefined();
    expect(bus.receive(request)).toBeUndefined();
    expect(calls).toBe(0);
    bus.dispose();
  });

  it("emits validated events to local listeners and transport", async () => {
    const sent: BusFrame[] = [];
    const transport: Transport = {
      async send(frame) {
        sent.push(frame);
      },
      onReceive() {
        return () => undefined;
      },
    };
    const bus = defineBus(contract, {
      realm: "popup",
      transport,
      nextId: () => "evt-1",
      instanceId: "popup:test",
    });
    const seen: number[] = [];
    bus.on("diag.event", (payload) => {
      seen.push(payload.value);
    });

    await bus.emit("diag.event", { value: 42 }, { target: "content", seq: 3 });

    expect(seen).toEqual([42]);
    expect(sent).toMatchObject([
      {
        frameType: "event",
        id: "evt-1",
        seq: 3,
        name: "diag.event",
        source: "popup",
        sourceInstance: "popup:test",
        target: "content",
        payload: { value: 42 },
      },
    ]);
  });
});
