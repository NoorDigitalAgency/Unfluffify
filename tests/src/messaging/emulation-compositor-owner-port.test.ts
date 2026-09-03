import { describe, expect, it, vi } from "vitest";

import {
  EMULATION_COMPOSITOR_OWNER_PORT_NAME,
  createEmulationCompositorOwnerPortClient,
  installEmulationCompositorOwnerPortServer,
  type EmulationCompositorOwnerPort,
} from "../../../src/messaging/emulation-compositor-owner-port";

function event<T extends (...args: never[]) => void>() {
  const listeners = new Set<T>();
  return {
    addListener(listener: T) { listeners.add(listener); },
    removeListener(listener: T) { listeners.delete(listener); },
    emit(...args: Parameters<T>) {
      for (const listener of [...listeners]) listener(...args);
    },
    get size() { return listeners.size; },
  };
}

function portPair(name = EMULATION_COMPOSITOR_OWNER_PORT_NAME) {
  const clientMessages = event<(message: unknown) => void>();
  const serverMessages = event<(message: unknown) => void>();
  const clientDisconnect = event<() => void>();
  const serverDisconnect = event<() => void>();
  let disconnected = false;
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    clientDisconnect.emit();
    serverDisconnect.emit();
  };
  const client: EmulationCompositorOwnerPort = {
    name,
    onMessage: clientMessages,
    onDisconnect: clientDisconnect,
    postMessage(message) { serverMessages.emit(message); },
    disconnect,
  };
  const server: EmulationCompositorOwnerPort = {
    name,
    onMessage: serverMessages,
    onDisconnect: serverDisconnect,
    postMessage(message) { clientMessages.emit(message); },
    disconnect,
  };
  return { client, server, disconnect };
}

describe("emulation compositor owner port", () => {
  it("tracks one live popup binding and transfers it across tabs", () => {
    const onConnect = event<(port: EmulationCompositorOwnerPort) => void>();
    const pair = portPair();
    const connect = vi.fn(() => {
      onConnect.emit(pair.server);
      return pair.client;
    });
    const onOwnershipChanged = vi.fn();
    const server = installEmulationCompositorOwnerPortServer(
      { onConnect },
      { onOwnershipChanged },
    );
    const client = createEmulationCompositorOwnerPortClient({ connect });

    expect(client.bind(7)).toBe(true);
    expect(client.bind(7)).toBe(true);
    expect(server.active(7)).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.bind(8)).toBe(true);
    expect(server.active(7)).toBe(false);
    expect(server.active(8)).toBe(true);

    client.dispose();
    expect(server.active(8)).toBe(false);
    expect(onOwnershipChanged.mock.calls).toEqual([
      [7, true],
      [7, false],
      [8, true],
      [8, false],
    ]);
    server.dispose();
    expect(onConnect.size).toBe(0);
  });

  it("ignores malformed and unrelated ports and retires ownership on disconnect", () => {
    const onConnect = event<(port: EmulationCompositorOwnerPort) => void>();
    const valid = portPair();
    const unrelated = portPair("another-port");
    const server = installEmulationCompositorOwnerPortServer({ onConnect });
    onConnect.emit(unrelated.server);
    onConnect.emit(valid.server);

    valid.client.postMessage({
      kind: "uf-emulation-compositor-owner/bind/1",
      tabId: 0,
    });
    expect(server.active(7)).toBe(false);
    valid.client.postMessage({
      kind: "uf-emulation-compositor-owner/bind/1",
      tabId: 7,
    });
    expect(server.active(7)).toBe(true);

    valid.disconnect();
    expect(server.active(7)).toBe(false);
    server.dispose();
  });

  it("emits only first-owner and last-owner edges when multiple panels bind the same tab", () => {
    const onConnect = event<(port: EmulationCompositorOwnerPort) => void>();
    const first = portPair();
    const second = portPair();
    const onOwnershipChanged = vi.fn();
    const server = installEmulationCompositorOwnerPortServer(
      { onConnect },
      { onOwnershipChanged },
    );
    onConnect.emit(first.server);
    onConnect.emit(second.server);

    first.client.postMessage({
      kind: "uf-emulation-compositor-owner/bind/1",
      tabId: 7,
    });
    second.client.postMessage({
      kind: "uf-emulation-compositor-owner/bind/1",
      tabId: 7,
    });
    expect(onOwnershipChanged.mock.calls).toEqual([[7, true]]);

    first.disconnect();
    expect(server.active(7)).toBe(true);
    expect(onOwnershipChanged.mock.calls).toEqual([[7, true]]);
    second.disconnect();
    expect(server.active(7)).toBe(false);
    expect(onOwnershipChanged.mock.calls).toEqual([[7, true], [7, false]]);
    server.dispose();
  });

  it("rebinds a still-live panel after its background port is disconnected", async () => {
    const onConnect = event<(port: EmulationCompositorOwnerPort) => void>();
    const pairs: ReturnType<typeof portPair>[] = [];
    const connect = vi.fn(() => {
      const pair = portPair();
      pairs.push(pair);
      onConnect.emit(pair.server);
      return pair.client;
    });
    const onOwnershipChanged = vi.fn();
    const server = installEmulationCompositorOwnerPortServer(
      { onConnect },
      { onOwnershipChanged },
    );
    const client = createEmulationCompositorOwnerPortClient({ connect });

    expect(client.bind(7)).toBe(true);
    pairs[0]?.disconnect();
    expect(server.active(7)).toBe(false);
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    expect(server.active(7)).toBe(true);

    client.dispose();
    expect(server.active(7)).toBe(false);
    expect(onOwnershipChanged.mock.calls).toEqual([
      [7, true],
      [7, false],
      [7, true],
      [7, false],
    ]);
    server.dispose();
  });
});
