import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUS_ERROR_CODES } from "../common/bus/bus-errors.js";
import { BUS_KINDS, makeEventEnvelope, makeRequestEnvelope } from "../common/bus/envelope.js";
import { PAGE_WORLD_COMMANDS } from "../common/page-world-protocol.js";
import { REALMS } from "../common/bus/realms.js";
import { createBackgroundTransport } from "../common/bus/transport/background-transport.js";
import { createPageRelayTransport } from "../common/bus/transport/page-relay-transport.js";
import { buildBusPortName } from "../common/bus/transport/transport-types.js";
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

type PortListener<T> = (payload: T) => void;

function createPortEvent<T>() {
  const listeners = new Set<PortListener<T>>();
  return {
    addListener(listener: PortListener<T>) {
      listeners.add(listener);
    },
    dispatch(payload: T) {
      for (const listener of listeners) {
        listener(payload);
      }
    },
  };
}

function createFakePort(name: string) {
  const onMessage = createPortEvent<unknown>();
  const onDisconnect = createPortEvent<chrome.runtime.Port>();
  const postedMessages: unknown[] = [];
  const port = {
    name,
    onMessage,
    onDisconnect,
    postMessage(message: unknown) {
      postedMessages.push(message);
    },
    disconnect() {
      onDisconnect.dispatch(port as unknown as chrome.runtime.Port);
    },
  };
  return {
    port: port as unknown as chrome.runtime.Port,
    postedMessages,
    disconnect() {
      onDisconnect.dispatch(port as unknown as chrome.runtime.Port);
    },
  };
}

describe("background transport", () => {
  it("rejects popup requests if the popup port disconnects before replying", async () => {
    const transport = createBackgroundTransport();
    const popupPort = createFakePort(buildBusPortName(9));
    transport.registerPopupPort(9, popupPort.port);

    const pendingReply = transport.send(makeRequestEnvelope("diag.ping", { nonce: "n-1" }, {
      src: REALMS.BACKGROUND,
      dst: REALMS.POPUP,
      tab: 9,
    }));

    expect(popupPort.postedMessages).toHaveLength(1);
    popupPort.disconnect();

    await expect(pendingReply).rejects.toMatchObject({
      code: BUS_ERROR_CODES.TRANSPORT_FAILED,
    });
  });

  it("fans out inbound broadcast events to non-source realms", async () => {
    const transport = createBackgroundTransport();
    const popupPort = createFakePort(buildBusPortName(9));
    const seenLocally: string[] = [];
    transport.registerPopupPort(9, popupPort.port);
    transport.onInbound((env) => {
      seenLocally.push(env.t);
    });

    await transport.inbound(makeEventEnvelope("diag.event", { ok: true }, {
      src: REALMS.CONTENT,
      dst: "broadcast",
      tab: 9,
    }), {
      tab: { id: 9 },
      frameId: 0,
    } as chrome.runtime.MessageSender);

    expect(seenLocally).toEqual(["diag.event"]);
    expect(popupPort.postedMessages).toHaveLength(1);
  });

  it("derives missing tab ids from the sender for popup routing", async () => {
    const transport = createBackgroundTransport();
    const popupPort = createFakePort(buildBusPortName(9));
    transport.registerPopupPort(9, popupPort.port);

    await transport.inbound(makeEventEnvelope("diag.event", { ok: true }, {
      src: REALMS.CONTENT,
      dst: REALMS.POPUP,
      tab: null,
    }), {
      tab: { id: 9 },
      frameId: 4,
    } as chrome.runtime.MessageSender);

    expect(popupPort.postedMessages).toHaveLength(1);
    expect(popupPort.postedMessages[0]).toMatchObject({
      tab: 9,
      frame: 4,
    });
  });
});
