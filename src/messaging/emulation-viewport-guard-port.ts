export const EMULATION_VIEWPORT_GUARD_PORT_NAME = "uf-emulation-viewport-guard/v1";
export const EMULATION_VIEWPORT_GUARD_PORT_TIMEOUT_MS = 250;

export type EmulationViewportGuardMode = "mobile" | "desktop";

type GuardRequest = Readonly<{
  kind: "uf-emulation-viewport-guard/request/1";
  id: string;
  mode: EmulationViewportGuardMode;
}>;

type GuardReply = Readonly<{
  kind: "uf-emulation-viewport-guard/reply/1";
  id: string;
  mode: EmulationViewportGuardMode;
  generation: number | null;
}>;

type PortEvent<T extends (...args: never[]) => void> = Readonly<{
  addListener(listener: T): void;
  removeListener?(listener: T): void;
}>;

export type EmulationViewportGuardPort = Readonly<{
  name: string;
  postMessage(message: unknown): void;
  disconnect?(): void;
  onMessage: PortEvent<(message: unknown) => void>;
  onDisconnect: PortEvent<() => void>;
}>;

export type EmulationViewportGuardTabs = Readonly<{
  connect?(
    tabId: number,
    connectInfo: Readonly<{ name: string; frameId: number }>,
  ): EmulationViewportGuardPort;
}>;

export type EmulationViewportGuardRuntime = Readonly<{
  onConnect?: PortEvent<(port: EmulationViewportGuardPort) => void>;
}>;

function positiveGeneration(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function parseRequest(value: unknown): GuardRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (
    request.kind !== "uf-emulation-viewport-guard/request/1" ||
    typeof request.id !== "string" ||
    request.id.length === 0 ||
    request.id.length > 160 ||
    (request.mode !== "mobile" && request.mode !== "desktop")
  ) {
    return null;
  }
  return {
    kind: request.kind,
    id: request.id,
    mode: request.mode,
  };
}

function parseReply(value: unknown): GuardReply | null {
  if (!value || typeof value !== "object") return null;
  const reply = value as Record<string, unknown>;
  if (
    reply.kind !== "uf-emulation-viewport-guard/reply/1" ||
    typeof reply.id !== "string" ||
    (reply.mode !== "mobile" && reply.mode !== "desktop") ||
    (reply.generation !== null && positiveGeneration(reply.generation) === null)
  ) {
    return null;
  }
  return {
    kind: reply.kind,
    id: reply.id,
    mode: reply.mode,
    generation: positiveGeneration(reply.generation),
  };
}

export function admittedEmulationViewportGuardGeneration(
  value: unknown,
  mode: EmulationViewportGuardMode,
): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const generation = positiveGeneration(candidate.generation);
  return candidate.ok === true &&
    candidate.mode === mode &&
    (candidate.stage === "guarding" || candidate.stage === "paint-proven") &&
    candidate.guarded === true &&
    candidate.coverage === true
    ? generation
    : null;
}

/** Installs the document-start receiver for the already-connected side-panel
 * safety lane. The handler is synchronous: the canonical guard mutates before
 * its acknowledgement is posted back to the panel. */
export function installEmulationViewportGuardPortServer(
  runtime: EmulationViewportGuardRuntime,
  guard: (mode: EmulationViewportGuardMode) => unknown,
): () => void {
  const connected = new Set<EmulationViewportGuardPort>();
  const messageListeners = new Map<EmulationViewportGuardPort, (message: unknown) => void>();
  const disconnectListeners = new Map<EmulationViewportGuardPort, () => void>();
  const detach = (port: EmulationViewportGuardPort): void => {
    const onMessage = messageListeners.get(port);
    const onDisconnect = disconnectListeners.get(port);
    if (onMessage) port.onMessage.removeListener?.(onMessage);
    if (onDisconnect) port.onDisconnect.removeListener?.(onDisconnect);
    messageListeners.delete(port);
    disconnectListeners.delete(port);
    connected.delete(port);
  };
  const onConnect = (port: EmulationViewportGuardPort): void => {
    if (port.name !== EMULATION_VIEWPORT_GUARD_PORT_NAME) return;
    const onMessage = (message: unknown): void => {
      const request = parseRequest(message);
      if (!request) return;
      const generation = admittedEmulationViewportGuardGeneration(
        guard(request.mode),
        request.mode,
      );
      try {
        port.postMessage({
          kind: "uf-emulation-viewport-guard/reply/1",
          id: request.id,
          mode: request.mode,
          generation,
        } satisfies GuardReply);
      } catch {
        detach(port);
      }
    };
    const onDisconnect = (): void => detach(port);
    connected.add(port);
    messageListeners.set(port, onMessage);
    disconnectListeners.set(port, onDisconnect);
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  };
  runtime.onConnect?.addListener(onConnect);
  return () => {
    runtime.onConnect?.removeListener?.(onConnect);
    for (const port of [...connected]) {
      detach(port);
    }
  };
}

type PendingAdmission = Readonly<{
  mode: EmulationViewportGuardMode;
  resolve(generation: number | null): void;
  timer: ReturnType<typeof setTimeout>;
}>;

/** One side panel binds to one inspected tab. Prime establishes the port during
 * normal popup setup so a later native resize only pays one `postMessage`. */
export function createEmulationViewportGuardPortClient(
  tabs: EmulationViewportGuardTabs,
  timeoutMs = EMULATION_VIEWPORT_GUARD_PORT_TIMEOUT_MS,
) {
  let sequence = 0;
  let state: Readonly<{
    tabId: number;
    port: EmulationViewportGuardPort;
    onMessage: (message: unknown) => void;
    onDisconnect: () => void;
  }> | null = null;
  const pending = new Map<string, PendingAdmission>();
  const settleAll = (): void => {
    for (const admission of pending.values()) {
      clearTimeout(admission.timer);
      admission.resolve(null);
    }
    pending.clear();
  };
  const drop = (disconnect: boolean): void => {
    const current = state;
    state = null;
    if (current) {
      current.port.onMessage.removeListener?.(current.onMessage);
      current.port.onDisconnect.removeListener?.(current.onDisconnect);
      if (disconnect) {
        try {
          current.port.disconnect?.();
        } catch {
          // A document navigation can close the channel first.
        }
      }
    }
    settleAll();
  };
  const prime = (tabId: number): boolean => {
    if (!Number.isInteger(tabId) || tabId <= 0 || typeof tabs.connect !== "function") {
      return false;
    }
    if (state?.tabId === tabId) return true;
    drop(true);
    try {
      const port = tabs.connect(tabId, {
        name: EMULATION_VIEWPORT_GUARD_PORT_NAME,
        frameId: 0,
      });
      const onMessage = (message: unknown): void => {
        const reply = parseReply(message);
        if (!reply) return;
        const admission = pending.get(reply.id);
        if (!admission || admission.mode !== reply.mode) return;
        pending.delete(reply.id);
        clearTimeout(admission.timer);
        admission.resolve(reply.generation);
      };
      const onDisconnect = (): void => drop(false);
      state = { tabId, port, onMessage, onDisconnect };
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
      return true;
    } catch {
      drop(false);
      return false;
    }
  };
  const guard = (
    tabId: number,
    mode: EmulationViewportGuardMode,
  ): Promise<number | null> => {
    if (!prime(tabId) || !state) return Promise.resolve(null);
    sequence += 1;
    const id = `popup-viewport-${Date.now()}-${sequence}`;
    return new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, Math.max(1, timeoutMs));
      pending.set(id, { mode, resolve, timer });
      try {
        state!.port.postMessage({
          kind: "uf-emulation-viewport-guard/request/1",
          id,
          mode,
        } satisfies GuardRequest);
      } catch {
        const admission = pending.get(id);
        pending.delete(id);
        if (admission) {
          clearTimeout(admission.timer);
          admission.resolve(null);
        }
        drop(false);
      }
    });
  };
  return {
    prime,
    guard,
    dispose: () => drop(true),
  };
}
