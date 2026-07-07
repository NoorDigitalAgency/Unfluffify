import { describe, expect, it } from "vitest";

import {
  BusFrameSchema,
  type BusFrame,
} from "../../../../src/messaging/contract";
import {
  createPageTransport,
  isPageCommandName,
  PAGE_BUS_PROTOCOL,
  type PageRequestMessage,
  type PageResponseMessage,
} from "../../../../src/messaging/transports/page";

function requestFrame(name: string): BusFrame {
  return {
    kind: "uf-bus/1",
    frameType: "request",
    id: "req-1",
    seq: 1,
    name,
    source: "content",
    target: "page",
    payload: { paused: true },
  };
}

function endpoint() {
  const listeners = new Set<(message: unknown) => void>();
  const posted: PageRequestMessage[] = [];
  return {
    posted,
    api: {
      postMessage(message: PageRequestMessage) {
        posted.push(message);
      },
      onMessage(listener: (message: unknown) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    reply(message: PageResponseMessage) {
      for (const listener of listeners) {
        listener(message);
      }
    },
  };
}

describe("P1 page transport (INV-10.12..INV-10.14)", () => {
  it("accepts only the fixed page command allow-list", () => {
    expect(isPageCommandName("ARM")).toBe(true);
    expect(isPageCommandName("SET_MOTION_PAUSED")).toBe(true);
    expect(isPageCommandName("SET_LAZY_LOADING_SUPPRESSED")).toBe(true);
    expect(isPageCommandName("DESTROY")).toBe(true);
    expect(isPageCommandName("DIAG_PING")).toBe(false);
  });

  it("requires response nonce and originating command to match", async () => {
    const fake = endpoint();
    const transport = createPageTransport(fake.api, { nextNonce: () => "nonce-1" });
    const pending = transport.send(requestFrame("SET_MOTION_PAUSED"));

    expect(fake.posted).toEqual([
      {
        kind: PAGE_BUS_PROTOCOL,
        type: "request",
        nonce: "nonce-1",
        command: "SET_MOTION_PAUSED",
        payload: { paused: true },
      },
    ]);

    fake.reply({
      kind: PAGE_BUS_PROTOCOL,
      type: "response",
      nonce: "wrong",
      command: "SET_MOTION_PAUSED",
      ok: true,
      payload: { ignored: true },
    });
    fake.reply({
      kind: PAGE_BUS_PROTOCOL,
      type: "response",
      nonce: "nonce-1",
      command: "ARM",
      ok: true,
      payload: { ignored: true },
    });
    fake.reply({
      kind: PAGE_BUS_PROTOCOL,
      type: "response",
      nonce: "nonce-1",
      command: "SET_MOTION_PAUSED",
      ok: true,
      payload: { applied: true },
    });

    await expect(pending).resolves.toMatchObject({
      frameType: "reply",
      ok: true,
      payload: { applied: true },
    });
  });

  it("returns structured failures for rejected commands", async () => {
    const fake = endpoint();
    const transport = createPageTransport(fake.api, { nextNonce: () => "nonce-1" });

    await expect(transport.send(requestFrame("DIAG_PING"))).resolves.toMatchObject({
      frameType: "reply",
      ok: false,
      payload: null,
      failure: { code: "PAGE_COMMAND_REJECTED" },
    });
  });

  it("normalizes malformed page failure responses to a valid bus failure", async () => {
    const fake = endpoint();
    const transport = createPageTransport(fake.api, { nextNonce: () => "nonce-1" });
    const pending = transport.send(requestFrame("DESTROY"));
    fake.reply({
      kind: PAGE_BUS_PROTOCOL,
      type: "response",
      nonce: "nonce-1",
      command: "DESTROY",
      ok: false,
      failure: { code: "BROKEN" } as unknown as PageResponseMessage["failure"],
    });

    await expect(pending).resolves.toMatchObject({
      frameType: "reply",
      ok: false,
      payload: null,
      failure: { code: "PAGE_COMMAND_FAILED" },
    });
  });

  it("keeps page failure replies valid after JSON serialization", async () => {
    const fake = endpoint();
    const transport = createPageTransport(fake.api, { nextNonce: () => "nonce-1" });
    const reply = await transport.send(requestFrame("DIAG_PING"));
    const serialized = JSON.parse(JSON.stringify(reply)) as BusFrame;

    expect(BusFrameSchema.safeParse(serialized).success).toBe(true);
    expect(serialized).toMatchObject({
      frameType: "reply",
      ok: false,
      payload: null,
    });
  });

  it("returns a structured timeout failure when the page does not respond", async () => {
    const fake = endpoint();
    const transport = createPageTransport(fake.api, {
      nextNonce: () => "nonce-1",
      responseTimeoutMs: 1,
    });

    await expect(transport.send(requestFrame("ARM"))).resolves.toMatchObject({
      frameType: "reply",
      ok: false,
      payload: null,
      failure: { code: "PAGE_COMMAND_TIMEOUT" },
    });
  });
});
