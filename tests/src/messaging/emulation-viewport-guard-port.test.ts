import { describe, expect, it, vi } from "vitest";
import {
  EMULATION_VIEWPORT_GUARD_PORT_NAME,
  createEmulationViewportGuardPortClient,
  installEmulationViewportGuardPortServer,
  type EmulationViewportGuardPort,
} from "../../../src/messaging/emulation-viewport-guard-port";

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

function portPair(name = EMULATION_VIEWPORT_GUARD_PORT_NAME) {
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
  const client: EmulationViewportGuardPort = {
    name,
    onMessage: clientMessages,
    onDisconnect: clientDisconnect,
    postMessage(message) { queueMicrotask(() => serverMessages.emit(message)); },
    disconnect,
  };
  const server: EmulationViewportGuardPort = {
    name,
    onMessage: serverMessages,
    onDisconnect: serverDisconnect,
    postMessage(message) { queueMicrotask(() => clientMessages.emit(message)); },
    disconnect,
  };
  return { client, server, disconnect };
}

describe("emulation viewport guard port", () => {
  it("primes one tab channel and returns the exact content-owned generation", async () => {
    const onConnect = event<(port: EmulationViewportGuardPort) => void>();
    const pair = portPair();
    const connect = vi.fn(() => {
      onConnect.emit(pair.server);
      return pair.client;
    });
    const guard = vi.fn((mode: "mobile" | "desktop") => ({
      ok: true,
      mode,
      stage: "guarding",
      guarded: true,
      coverage: true,
      generation: 41,
    }));
    const disposeServer = installEmulationViewportGuardPortServer({ onConnect }, guard);
    const client = createEmulationViewportGuardPortClient({ connect }, 100);

    expect(client.prime(7)).toBe(true);
    expect(client.prime(7)).toBe(true);
    await expect(client.guard(7, "mobile")).resolves.toBe(41);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(7, {
      name: EMULATION_VIEWPORT_GUARD_PORT_NAME,
      frameId: 0,
    });
    expect(guard).toHaveBeenCalledWith("mobile");

    client.dispose();
    disposeServer();
    expect(onConnect.size).toBe(0);
  });

  it("rejects malformed or inexact guardian authority", async () => {
    const onConnect = event<(port: EmulationViewportGuardPort) => void>();
    const pair = portPair();
    const client = createEmulationViewportGuardPortClient({
      connect: () => {
        onConnect.emit(pair.server);
        return pair.client;
      },
    }, 100);
    const disposeServer = installEmulationViewportGuardPortServer(
      { onConnect },
      () => ({
        ok: true,
        mode: "desktop",
        stage: "guarding",
        guarded: true,
        coverage: true,
        generation: 42,
      }),
    );

    await expect(client.guard(7, "mobile")).resolves.toBeNull();
    client.dispose();
    disposeServer();
  });

  it("terminalizes a missing reply and reconnects after document disconnect", async () => {
    vi.useFakeTimers();
    try {
      const first = portPair();
      const second = portPair();
      const pairs = [first, second];
      const connect = vi.fn(() => pairs.shift()!.client);
      const client = createEmulationViewportGuardPortClient({ connect }, 25);

      const missing = client.guard(7, "mobile");
      await vi.advanceTimersByTimeAsync(25);
      await expect(missing).resolves.toBeNull();

      first.disconnect();
      const afterNavigation = client.guard(7, "mobile");
      expect(connect).toHaveBeenCalledTimes(2);
      second.disconnect();
      await expect(afterNavigation).resolves.toBeNull();
      client.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
