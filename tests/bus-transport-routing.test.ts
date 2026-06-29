import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { BUS_ERROR_CODES } from "../src/common/bus/bus-errors.js";
import { BUS_KINDS, makeEventEnvelope, makeRequestEnvelope } from "../src/common/bus/envelope.js";
import { PAGE_WORLD_COMMANDS } from "../src/common/page-world-protocol.js";
import { REALMS } from "../src/common/bus/realms.js";
import { createPageRelayTransport } from "../src/common/bus/transport/page-relay-transport.js";
import { buildBusPortName } from "../src/common/bus/transport/transport-types.js";
import * as pageWorldRelay from "../src/content/page-world-relay.js";

async function loadBusTransportModule<T>(path: string): Promise<T> {
  vi.resetModules();
  return await import(path) as T;
}

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

function withBrowser(value: unknown, callback: () => Promise<void> | void) {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  globalThis.browser = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (typeof originalBrowser === "undefined") {
        delete globalThis.browser;
      } else {
        globalThis.browser = originalBrowser;
      }
      if (typeof originalChrome === "undefined") {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = originalChrome;
      }
    });
}

function createFakePort(name: string) {
  const onMessage = createPortEvent<unknown>();
  const onDisconnect = createPortEvent<chrome.runtime.Port>();
  const postedMessages: unknown[] = [];
  let postMessageError: Error | null = null;
  const port = {
    name,
    onMessage,
    onDisconnect,
    postMessage(message: unknown) {
      if (postMessageError) {
        throw postMessageError;
      }
      postedMessages.push(message);
    },
    disconnect() {
      onDisconnect.dispatch(port as unknown as chrome.runtime.Port);
    },
  };
  return {
    port: port as unknown as chrome.runtime.Port,
    postedMessages,
    setPostMessageError(error: Error | null) {
      postMessageError = error;
    },
    disconnect() {
      onDisconnect.dispatch(port as unknown as chrome.runtime.Port);
    },
  };
}

describe("background transport", () => {
  it("rejects popup requests if the popup port disconnects before replying", async () => {
    const { createBackgroundTransport } = await loadBusTransportModule<typeof import("../src/common/bus/transport/background-transport.js")>("../src/common/bus/transport/background-transport.js");
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
    const { createBackgroundTransport } = await loadBusTransportModule<typeof import("../src/common/bus/transport/background-transport.js")>("../src/common/bus/transport/background-transport.js");
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
    const { createBackgroundTransport } = await loadBusTransportModule<typeof import("../src/common/bus/transport/background-transport.js")>("../src/common/bus/transport/background-transport.js");
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

  it("drops transient popup event delivery failures during popup disconnect windows", async () => {
    const { createBackgroundTransport } = await loadBusTransportModule<typeof import("../src/common/bus/transport/background-transport.js")>("../src/common/bus/transport/background-transport.js");
    const transport = createBackgroundTransport();
    const popupPort = createFakePort(buildBusPortName(9));
    popupPort.setPostMessageError(new Error("Attempting to use a disconnected port object"));
    transport.registerPopupPort(9, popupPort.port);

    await expect(transport.send(makeEventEnvelope("diag.event", { ok: true }, {
      src: REALMS.BACKGROUND,
      dst: REALMS.POPUP,
      tab: 9,
    }))).resolves.toBeUndefined();
  });

  it("maps browser tab send failures into transport errors", async () => {
    await withBrowser({
      runtime: { id: "test-runtime" },
      tabs: {
        sendMessage() {
          return Promise.reject(new Error("tab unreachable"));
        },
      },
    }, async () => {
      const { createBackgroundTransport } = await loadBusTransportModule<typeof import("../src/common/bus/transport/background-transport.js")>("../src/common/bus/transport/background-transport.js");
      const transport = createBackgroundTransport();

      await expect(transport.send(makeRequestEnvelope("diag.ping", { nonce: "n-1" }, {
        src: REALMS.BACKGROUND,
        dst: REALMS.CONTENT,
        tab: 9,
      }))).rejects.toMatchObject({
        code: BUS_ERROR_CODES.TRANSPORT_FAILED,
        message: "tab unreachable",
      });
    });
  });

  it("drops transient content event delivery failures during reload windows", async () => {
    await withBrowser({
      runtime: { id: "test-runtime" },
      tabs: {
        sendMessage() {
          return Promise.reject(new Error("tab unreachable"));
        },
      },
    }, async () => {
      const { createBackgroundTransport } = await loadBusTransportModule<typeof import("../src/common/bus/transport/background-transport.js")>("../src/common/bus/transport/background-transport.js");
      const transport = createBackgroundTransport();

      await expect(transport.send(makeEventEnvelope("diag.event", { ok: true }, {
        src: REALMS.BACKGROUND,
        dst: REALMS.CONTENT,
        tab: 9,
      }))).resolves.toBeUndefined();
    });
  });

  it("drops one-way content events when the async message channel closes", async () => {
    await withBrowser({
      runtime: { id: "test-runtime" },
      tabs: {
        sendMessage() {
          return Promise.reject(new Error(
            "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
          ));
        },
      },
    }, async () => {
      const { createBackgroundTransport } = await loadBusTransportModule<typeof import("../src/common/bus/transport/background-transport.js")>("../src/common/bus/transport/background-transport.js");
      const transport = createBackgroundTransport();

      await expect(transport.send(makeEventEnvelope("directive.content", { ok: true }, {
        src: REALMS.BACKGROUND,
        dst: REALMS.CONTENT,
        tab: 9,
      }))).resolves.toBeUndefined();
    });
  });
});

describe("content and popup transport", () => {
  it("uses the browser runtime promise path for content delivery", async () => {
    const sent: unknown[] = [];
    await withBrowser({
      runtime: {
        id: "test-runtime",
        sendMessage(message: unknown) {
          sent.push(message);
          return Promise.resolve({ ok: true });
        },
      },
    }, async () => {
      const { createContentTransport } = await loadBusTransportModule<typeof import("../src/common/bus/transport/content-transport.js")>("../src/common/bus/transport/content-transport.js");
      const transport = createContentTransport();
      const reply = await transport.send(makeRequestEnvelope("diag.ping", { nonce: "n-1" }, {
        src: REALMS.CONTENT,
        dst: REALMS.BACKGROUND,
        tab: 2,
      }));

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ p: "uf-bus/1", t: "diag.ping" });
      expect(reply).toMatchObject({ ok: true });
    });
  });

  it("uses the browser runtime promise path for popup request delivery", async () => {
    const sent: unknown[] = [];
    await withBrowser({
      runtime: {
        id: "test-runtime",
        connect() {
          throw new Error("connect should not be used for request/reply");
        },
        sendMessage(message: unknown) {
          sent.push(message);
          return Promise.resolve({ ok: true });
        },
      },
    }, async () => {
      const { createPopupTransport } = await loadBusTransportModule<typeof import("../src/common/bus/transport/popup-transport.js")>("../src/common/bus/transport/popup-transport.js");
      const transport = createPopupTransport(9);
      const reply = await transport.send(makeRequestEnvelope("diag.ping", { nonce: "n-1" }, {
        src: REALMS.POPUP,
        dst: REALMS.BACKGROUND,
        tab: 9,
      }));

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ p: "uf-bus/1", t: "diag.ping" });
      expect(reply).toMatchObject({ ok: true });
    });
  });

  it("keeps popup ports on runtime.connect while moving one-shot bus sends to extension messaging", () => {
    const popupTransportSource = readFileSync(new URL("../src/common/bus/transport/popup-transport.ts", import.meta.url), "utf8");
    const contentTransportSource = readFileSync(new URL("../src/common/bus/transport/content-transport.ts", import.meta.url), "utf8");
    const backgroundTransportSource = readFileSync(new URL("../src/common/bus/transport/background-transport.ts", import.meta.url), "utf8");

    expect(popupTransportSource).toMatch(/browser\.runtime\.connect\(\{ name: buildBusPortName\(tabId\) \}\)/);
    expect(contentTransportSource).toMatch(/sendBusEnvelope\(env\)/);
    expect(popupTransportSource).toMatch(/sendBusEnvelope\(env\)/);
    expect(backgroundTransportSource).toMatch(/sendBusEnvelope\(\{\s*\.\.\.env,/);
  });
});
