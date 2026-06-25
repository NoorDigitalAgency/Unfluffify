import { describe, expect, it, vi } from "vitest";

import { MESSAGE_ERROR_CODES, MESSAGE_TARGETS, createRequestEnvelope } from "../src/common/message-protocol.js";
import { routeInboundContentRequestMessage } from "../src/content/inbound-content-request-dispatch.js";

describe("routeInboundContentRequestMessage", () => {
  it("ignores non-content requests", () => {
    const dispatch = vi.fn();
    const request = createRequestEnvelope("runtime:ping", {}, {
      target: MESSAGE_TARGETS.BACKGROUND,
    });

    expect(routeInboundContentRequestMessage(request, undefined, dispatch)).toEqual({ handled: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns reply promises for acknowledged requests", async () => {
    const request = createRequestEnvelope("content:ping", { ok: true }, {
      target: MESSAGE_TARGETS.CONTENT,
    });
    const dispatch = vi.fn().mockResolvedValue({ ok: true, result: { echoed: request.type } });

    const routed = routeInboundContentRequestMessage(request, undefined, dispatch);

    expect(routed.handled).toBe(true);
    await expect(routed.reply).resolves.toEqual({ ok: true, result: { echoed: "content:ping" } });
  });

  it("wraps acknowledged handler failures as failure envelopes", async () => {
    const request = createRequestEnvelope("content:ping", { ok: true }, {
      target: MESSAGE_TARGETS.CONTENT,
    });
    const dispatch = vi.fn().mockRejectedValue(new Error("boom"));

    const routed = routeInboundContentRequestMessage(request, undefined, dispatch);

    await expect(routed.reply).resolves.toMatchObject({
      ok: false,
      code: MESSAGE_ERROR_CODES.HANDLER_FAILED,
      error: "boom",
      id: request.id,
    });
  });

  it("keeps fire-and-forget requests immediate", async () => {
    const request = createRequestEnvelope("content:notify", { ok: true }, {
      target: MESSAGE_TARGETS.CONTENT,
      expectsReply: false,
    });
    let resolveDispatch: (() => void) | undefined;
    const dispatch = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDispatch = resolve;
        }),
    );

    const routed = routeInboundContentRequestMessage(request, undefined, dispatch);

    expect(routed).toEqual({ handled: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    resolveDispatch?.();
  });
});
