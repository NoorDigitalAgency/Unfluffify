export const EMULATION_COMPOSITOR_OWNER_PORT_NAME =
  "uf-emulation-compositor-owner/v1";

type OwnerBinding = Readonly<{
  kind: "uf-emulation-compositor-owner/bind/1";
  tabId: number;
}>;

type PortEvent<T extends (...args: never[]) => void> = Readonly<{
  addListener(listener: T): void;
  removeListener?(listener: T): void;
}>;

export type EmulationCompositorOwnerPort = Readonly<{
  name: string;
  postMessage(message: unknown): void;
  disconnect?(): void;
  onMessage: PortEvent<(message: unknown) => void>;
  onDisconnect: PortEvent<() => void>;
}>;

export type EmulationCompositorOwnerRuntime = Readonly<{
  connect?(connectInfo: Readonly<{ name: string }>): EmulationCompositorOwnerPort;
  onConnect?: PortEvent<(port: EmulationCompositorOwnerPort) => void>;
}>;

function parseBinding(value: unknown): OwnerBinding | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "uf-emulation-compositor-owner/bind/1" &&
      Number.isInteger(candidate.tabId) && Number(candidate.tabId) > 0
    ? {
        kind: candidate.kind,
        tabId: Number(candidate.tabId),
      }
    : null;
}

/** Tracks which inspected tab has a live side-panel document capable of using
 * the earlier native resize boundary. Port disconnect is the compatibility
 * authority on Chrome versions predating sidePanel onOpened/onClosed events. */
export function installEmulationCompositorOwnerPortServer(
  runtime: EmulationCompositorOwnerRuntime,
  options: Readonly<{
    /** Emitted only for first-owner and last-owner edges. Duplicate binds and
     * removal of one of multiple owners are lifecycle no-ops. */
    onOwnershipChanged?: (tabId: number, active: boolean) => void;
  }> = {},
) {
  const owners = new Map<EmulationCompositorOwnerPort, number>();
  const messageListeners = new Map<
    EmulationCompositorOwnerPort,
    (message: unknown) => void
  >();
  const disconnectListeners = new Map<EmulationCompositorOwnerPort, () => void>();
  const ownerCount = (tabId: number): number =>
    [...owners.values()].filter((candidate) => candidate === tabId).length;
  const bind = (port: EmulationCompositorOwnerPort, tabId: number): void => {
    const priorTabId = owners.get(port);
    if (priorTabId === tabId) return;
    const newTabWasInactive = ownerCount(tabId) === 0;
    owners.set(port, tabId);
    if (priorTabId !== undefined && ownerCount(priorTabId) === 0) {
      options.onOwnershipChanged?.(priorTabId, false);
    }
    if (newTabWasInactive) {
      options.onOwnershipChanged?.(tabId, true);
    }
  };
  const detach = (port: EmulationCompositorOwnerPort): void => {
    const priorTabId = owners.get(port);
    const onMessage = messageListeners.get(port);
    const onDisconnect = disconnectListeners.get(port);
    if (onMessage) port.onMessage.removeListener?.(onMessage);
    if (onDisconnect) port.onDisconnect.removeListener?.(onDisconnect);
    messageListeners.delete(port);
    disconnectListeners.delete(port);
    owners.delete(port);
    if (priorTabId !== undefined && ownerCount(priorTabId) === 0) {
      options.onOwnershipChanged?.(priorTabId, false);
    }
  };
  const onConnect = (port: EmulationCompositorOwnerPort): void => {
    if (port.name !== EMULATION_COMPOSITOR_OWNER_PORT_NAME) return;
    const onMessage = (message: unknown): void => {
      const binding = parseBinding(message);
      if (binding) bind(port, binding.tabId);
    };
    const onDisconnect = (): void => detach(port);
    messageListeners.set(port, onMessage);
    disconnectListeners.set(port, onDisconnect);
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  };
  runtime.onConnect?.addListener(onConnect);
  return {
    active(tabId: number): boolean {
      return [...owners.values()].includes(tabId);
    },
    dispose(): void {
      runtime.onConnect?.removeListener?.(onConnect);
      for (const port of [...messageListeners.keys()]) detach(port);
    },
  };
}

/** One side-panel page owns one inspected tab at a time. Rebinding updates the
 * standing worker-side suppression before future physical resize events. */
export function createEmulationCompositorOwnerPortClient(
  runtime: EmulationCompositorOwnerRuntime,
) {
  let port: EmulationCompositorOwnerPort | null = null;
  let boundTabId: number | null = null;
  let desiredTabId: number | null = null;
  let portDisconnectListener: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let disposed = false;
  const reconnectDelays = [0, 50, 100, 250, 500, 1_000, 2_000] as const;
  const cancelReconnect = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
  const drop = (disconnect: boolean): void => {
    const current = port;
    if (current && portDisconnectListener) {
      current.onDisconnect.removeListener?.(portDisconnectListener);
    }
    port = null;
    boundTabId = null;
    portDisconnectListener = null;
    if (disconnect) {
      try {
        current?.disconnect?.();
      } catch {
        // Chrome may have already destroyed the side-panel document.
      }
    }
  };
  let establishDesiredBinding: () => boolean = () => false;
  const scheduleReconnect = (): void => {
    if (disposed || desiredTabId === null || reconnectTimer !== null) return;
    const delay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)]!;
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!establishDesiredBinding()) scheduleReconnect();
    }, delay);
    (reconnectTimer as unknown as { unref?: () => void }).unref?.();
  };
  establishDesiredBinding = (): boolean => {
    const tabId = desiredTabId;
    if (
      disposed || tabId === null ||
      typeof runtime.connect !== "function"
    ) {
      return false;
    }
    if (!port) {
      try {
        const connected = runtime.connect({ name: EMULATION_COMPOSITOR_OWNER_PORT_NAME });
        port = connected;
        const onDisconnect = (): void => {
          if (port !== connected) return;
          drop(false);
          scheduleReconnect();
        };
        portDisconnectListener = onDisconnect;
        connected.onDisconnect.addListener(onDisconnect);
      } catch {
        drop(false);
        return false;
      }
    }
    if (boundTabId === tabId) return true;
    try {
      boundTabId = tabId;
      port.postMessage({
        kind: "uf-emulation-compositor-owner/bind/1",
        tabId,
      } satisfies OwnerBinding);
      reconnectAttempt = 0;
      cancelReconnect();
      return true;
    } catch {
      drop(true);
      scheduleReconnect();
      return false;
    }
  };
  const bind = (tabId: number): boolean => {
    if (!Number.isInteger(tabId) || tabId <= 0) return false;
    desiredTabId = tabId;
    const established = establishDesiredBinding();
    if (!established) scheduleReconnect();
    return established;
  };
  return {
    bind,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      desiredTabId = null;
      cancelReconnect();
      drop(true);
    },
  };
}
