import { describe, expect, it, vi } from "vitest";

import { BUS_ERROR_CODES, BusError } from "../common/bus/bus-errors.js";
import { createBus } from "../common/bus/bus.js";
import { makeReplyEnvelope } from "../common/bus/envelope.js";
import { REALMS } from "../common/bus/realms.js";
import type { BusEnvelope } from "../common/bus/envelope.js";
import type { InboundTransportHandler, Transport } from "../common/bus/transport/transport-types.js";

function createFakeTransport(options: { send?: (env: BusEnvelope) => Promise<BusEnvelope | void> } = {}): Transport {
  let inboundHandler: InboundTransportHandler | null = null;

  return {
    send(env) {
      if (options.send) {
        return options.send(env);
      }
      return Promise.resolve(inboundHandler ? inboundHandler(env) : undefined);
    },
    onInbound(handler) {
      inboundHandler = handler;
    },
    start() {},
    stop() {
      inboundHandler = null;
    },
  };
}

describe("bus core", () => {
  it("throws on duplicate handlers", () => {
    const bus = createBus({
      realm: REALMS.BACKGROUND,
      transport: createFakeTransport(),
    });

    bus.registerHandler("diag.ping", () => ({ ok: true }));

    expect(() => bus.registerHandler("diag.ping", () => ({ ok: false }))).toThrowError(BusError);
    expect(() => bus.registerHandler("diag.ping", () => ({ ok: false }))).toThrow("diag.ping");
  });

  it("handles local request happy path", async () => {
    const bus = createBus({
      realm: REALMS.POPUP,
      transport: createFakeTransport(),
    });

    bus.registerHandler("diag.ping", (payload: { nonce: string }) => ({
      nonce: payload.nonce,
      realm: REALMS.POPUP,
    }));

    await expect(bus.request("diag.ping", { nonce: "n-1" })).resolves.toEqual({
      nonce: "n-1",
      realm: REALMS.POPUP,
    });
  });

  it("maps local handler failures to handler_failed", async () => {
    const bus = createBus({
      realm: REALMS.CONTENT,
      transport: createFakeTransport(),
    });

    bus.registerHandler("diag.ping", () => {
      throw new Error("broken");
    });

    await expect(bus.request("diag.ping", { nonce: "n-2" })).rejects.toMatchObject({
      code: BUS_ERROR_CODES.HANDLER_FAILED,
      message: "broken",
    });
  });

  it("routes remote requests through the transport", async () => {
    const transport = createFakeTransport({
      send: async (env) => makeReplyEnvelope(env, true, { nonce: "n-3", realm: REALMS.BACKGROUND }),
    });
    const bus = createBus({
      realm: REALMS.POPUP,
      transport,
    });

    await expect(bus.request("diag.ping", { nonce: "n-3" }, { target: REALMS.BACKGROUND })).resolves.toEqual({
      nonce: "n-3",
      realm: REALMS.BACKGROUND,
    });
  });

  it("publishes to multiple listeners and settles async listeners", async () => {
    const bus = createBus({
      realm: REALMS.BACKGROUND,
      transport: createFakeTransport(),
    });
    const calls: string[] = [];
    const ids = new Set<string>();

    bus.subscribe("diag.echo", async (_payload, meta) => {
      await Promise.resolve();
      ids.add(meta.id);
      calls.push("first");
    });
    bus.subscribe("diag.echo", (_payload, meta) => {
      ids.add(meta.id);
      calls.push("second");
    });

    await bus.publish("diag.echo", { nonce: "n-4" }, { target: REALMS.BACKGROUND });

    expect(calls).toEqual(["second", "first"]);
    expect(ids.size).toBe(1);
  });

  it("logs listener rejections without rejecting publish", async () => {
    const error = vi.fn();
    const bus = createBus({
      realm: REALMS.BACKGROUND,
      transport: createFakeTransport(),
      logger: { error },
    });

    bus.subscribe("diag.echo", async () => {
      throw new Error("listener failed");
    });

    await expect(bus.publish("diag.echo", { nonce: "n-5" }, { target: REALMS.BACKGROUND })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it("logs synchronous listener throws without rejecting publish", async () => {
    const error = vi.fn();
    const bus = createBus({
      realm: REALMS.BACKGROUND,
      transport: createFakeTransport(),
      logger: { error },
    });

    bus.subscribe("diag.echo", () => {
      throw new Error("sync listener failed");
    });

    await expect(bus.publish("diag.echo", { nonce: "n-5b" }, { target: REALMS.BACKGROUND })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it("times out unresolved remote requests", async () => {
    const bus = createBus({
      realm: REALMS.POPUP,
      transport: createFakeTransport({
        send: () => new Promise(() => {}),
      }),
    });

    await expect(
      bus.request("diag.ping", { nonce: "n-6" }, { target: REALMS.BACKGROUND, timeoutMs: 10 }),
    ).rejects.toMatchObject({
      code: BUS_ERROR_CODES.TIMEOUT,
    });
  });

  it("normalizes transport rejections into BusError replies", async () => {
    const bus = createBus({
      realm: REALMS.CONTENT,
      transport: createFakeTransport({
        send: async () => {
          const error = new Error("relay failed") as Error & { code?: string; details?: Record<string, unknown> };
          error.code = BUS_ERROR_CODES.UNREACHABLE_REALM;
          error.details = { target: REALMS.PAGE };
          throw error;
        },
      }),
    });

    await expect(
      bus.request("PAGE_WORLD_ARM", {}, { target: REALMS.PAGE }),
    ).rejects.toMatchObject({
      code: BUS_ERROR_CODES.UNREACHABLE_REALM,
      message: "relay failed",
      details: { target: REALMS.PAGE },
    });
  });

  it("preserves failure replies from remote handlers", async () => {
    const transport = createFakeTransport({
      send: async (env) => makeReplyEnvelope(env, false, {
        code: BUS_ERROR_CODES.NO_HANDLER,
        error: "remote failed",
        details: { type: env.t },
      }),
    });
    const bus = createBus({
      realm: REALMS.POPUP,
      transport,
    });

    await expect(
      bus.request("diag.ping", { nonce: "n-7" }, { target: REALMS.BACKGROUND }),
    ).rejects.toMatchObject({
      code: BUS_ERROR_CODES.NO_HANDLER,
      message: "remote failed",
      details: { type: "diag.ping" },
    });
  });
});
