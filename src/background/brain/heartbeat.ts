import { REALMS, type BusTarget } from "../../common/bus/realms";
import {
  SESSION_REQUEST_TYPES,
  type SessionFactsPatch,
  type SessionStateReply,
} from "../../common/bus/contracts/session-state";

export type BrainHeartbeatLayerSource = "popup" | "content";

export type BrainHeartbeatDeps = Readonly<{
  request: <P, R>(type: string, payload: P, opts: { target: BusTarget; tab: number; timeoutMs: number }) => Promise<R>;
  foldFacts: (tabId: number, source: BrainHeartbeatLayerSource, facts: SessionFactsPatch, reason: string) => void;
  intervalMs?: number;
  timeoutMs?: number;
  setInterval?: (handler: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  logger?: Pick<Console, "debug">;
}>;

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 800;

export function createBrainHeartbeat(deps: BrainHeartbeatDeps) {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTimer = deps.setInterval ?? ((handler: () => void, ms: number) => setInterval(handler, ms));
  const stopTimer = deps.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  const activeTabs = new Set<number>();
  let handle: unknown = null;

  async function pullLayer(tabId: number, source: BrainHeartbeatLayerSource, target: BusTarget): Promise<void> {
    try {
      const reply = await deps.request<Record<never, never>, SessionStateReply>(
        SESSION_REQUEST_TYPES.STATE_GET,
        {},
        { target, tab: tabId, timeoutMs },
      );
      if (reply && typeof reply === "object" && reply.facts && typeof reply.facts === "object") {
        deps.foldFacts(tabId, source, reply.facts, `heartbeat:${source}`);
      }
    } catch (error) {
      deps.logger?.debug?.("Brain heartbeat layer pull failed", { tabId, source, error });
    }
  }

  function tick(): void {
    for (const tabId of activeTabs) {
      void pullLayer(tabId, "popup", REALMS.POPUP);
      void pullLayer(tabId, "content", REALMS.CONTENT);
    }
  }

  function start(tabId: number): void {
    activeTabs.add(tabId);
    if (handle === null) {
      handle = startTimer(tick, intervalMs);
    }
  }

  function stop(tabId: number): void {
    activeTabs.delete(tabId);
    if (activeTabs.size === 0 && handle !== null) {
      stopTimer(handle);
      handle = null;
    }
  }

  function isRunning(): boolean {
    return handle !== null;
  }

  return { start, stop, tick, isRunning };
}

export type BrainHeartbeat = ReturnType<typeof createBrainHeartbeat>;
