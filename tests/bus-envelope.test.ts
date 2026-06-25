import { describe, expect, it } from "vitest";

import { createRequestEnvelope } from "../src/common/message-protocol.js";
import { BUS_ERROR_CODES } from "../src/common/bus/bus-errors.js";
import {
  BUS_KINDS,
  BUS_PROTOCOL,
  isBusEnvelope,
  isBusEvent,
  isBusReply,
  isBusRequest,
  makeEventEnvelope,
  makeReplyEnvelope,
  makeRequestEnvelope,
  newId,
} from "../src/common/bus/envelope.js";
import { REALMS } from "../src/common/bus/realms.js";

describe("bus envelope", () => {
  it("creates request and reply envelopes with the bus protocol tag", () => {
    const request = makeRequestEnvelope("diag.ping", { nonce: "n-1" }, {
      src: REALMS.POPUP,
      dst: REALMS.BACKGROUND,
      tab: 7,
      frame: 0,
    });
    const reply = makeReplyEnvelope(request, true, { nonce: "n-1", realm: REALMS.BACKGROUND });

    expect(request.p).toBe(BUS_PROTOCOL);
    expect(request.k).toBe(BUS_KINDS.REQUEST);
    expect(request.src).toBe(REALMS.POPUP);
    expect(request.dst).toBe(REALMS.BACKGROUND);
    expect(reply.k).toBe(BUS_KINDS.REPLY);
    expect(reply.ok).toBe(true);
    expect(reply.src).toBe(REALMS.BACKGROUND);
    expect(reply.dst).toBe(REALMS.POPUP);
    expect(reply.payload).toEqual({ nonce: "n-1", realm: REALMS.BACKGROUND });
  });

  it("creates failure replies with code and details", () => {
    const request = makeRequestEnvelope("diag.ping", { nonce: "n-2" }, {
      src: REALMS.CONTENT,
      dst: REALMS.BACKGROUND,
    });

    const reply = makeReplyEnvelope(request, false, {
      code: BUS_ERROR_CODES.NO_HANDLER,
      error: "Missing handler",
      details: { type: request.t },
    });

    expect(reply.ok).toBe(false);
    expect(reply.code).toBe(BUS_ERROR_CODES.NO_HANDLER);
    expect(reply.error).toBe("Missing handler");
    expect(reply.payload).toEqual({ type: request.t });
  });

  it("guards envelopes by protocol before kind matching", () => {
    const request = makeRequestEnvelope("diag.echo", { nonce: "n-3" }, {
      src: REALMS.POPUP,
      dst: "broadcast",
      tab: 4,
    });
    const event = makeEventEnvelope("diag.echo", { nonce: "n-3" }, {
      src: REALMS.POPUP,
      dst: "broadcast",
      tab: 4,
    });
    const reply = makeReplyEnvelope(request, true, { ok: true });
    const legacyEnvelope = createRequestEnvelope("legacy.message", { foo: "bar" });

    expect(isBusEnvelope(request)).toBe(true);
    expect(isBusRequest(request)).toBe(true);
    expect(isBusEvent(request)).toBe(false);
    expect(isBusEnvelope(event)).toBe(true);
    expect(isBusEvent(event)).toBe(true);
    expect(isBusReply(reply)).toBe(true);
    expect(isBusEnvelope(legacyEnvelope)).toBe(false);
  });

  it("generates non-empty ids", () => {
    const first = newId();
    const second = newId();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});
