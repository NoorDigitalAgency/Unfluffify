import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUS_ERROR_CODES } from "../common/bus/bus-errors.js";
import { BUS_KINDS, makeEventEnvelope, makeRequestEnvelope } from "../common/bus/envelope.js";
import { PAGE_WORLD_COMMANDS } from "../common/page-world-protocol.js";
import { REALMS } from "../common/bus/realms.js";
import { createPageRelayTransport } from "../common/bus/transport/page-relay-transport.js";
import * as pageWorldRelay from "../content/page-world-relay.js";

describe("page relay transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns reply envelopes for allowed page-world requests", async () => {
    vi.spyOn(pageWorldRelay, "isPageWorldRelayReady").mockReturnValue(true);
    vi.spyOn(pageWorldRelay, "requestPageWorldCommand").mockResolvedValue({ ok: true });

    const transport = createPageRelayTransport();
    const env = makeRequestEnvelope(PAGE_WORLD_COMMANDS.SET_MOTION_PAUSED, { paused: true }, {
      src: REALMS.CONTENT,
      dst: REALMS.PAGE,
      tab: 9,
      frame: 0,
    });

    const reply = await transport.send(env);

    expect(reply).toMatchObject({
      k: BUS_KINDS.REPLY,
      ok: true,
      dst: REALMS.CONTENT,
      src: REALMS.PAGE,
      payload: { ok: true },
    });
    expect(pageWorldRelay.requestPageWorldCommand).toHaveBeenCalledWith(
      PAGE_WORLD_COMMANDS.SET_MOTION_PAUSED,
      { paused: true },
    );
  });

  it("rejects non-allowed page commands", async () => {
    vi.spyOn(pageWorldRelay, "isPageWorldRelayReady").mockReturnValue(true);

    const transport = createPageRelayTransport();
    const env = makeRequestEnvelope("diag.ping", { nonce: "n-1" }, {
      src: REALMS.CONTENT,
      dst: REALMS.PAGE,
      tab: 1,
    });

    await expect(transport.send(env)).rejects.toMatchObject({
      code: BUS_ERROR_CODES.UNREACHABLE_REALM,
    });
  });

  it("rejects unreachable page relay sessions", async () => {
    vi.spyOn(pageWorldRelay, "isPageWorldRelayReady").mockReturnValue(false);

    const transport = createPageRelayTransport();
    const env = makeEventEnvelope(PAGE_WORLD_COMMANDS.DESTROY, {}, {
      src: REALMS.CONTENT,
      dst: REALMS.PAGE,
      tab: 2,
    });

    await expect(transport.send(env)).rejects.toMatchObject({
      code: BUS_ERROR_CODES.UNREACHABLE_REALM,
    });
  });
});
