// REFLEX-ARC per-tab signal log (MAIN PLAN Phase 1). The brain owns admission:
// it assigns the per-tab monotonic seq, applies the double-fire dedupe rules,
// keeps a bounded ring of recent frames for cursor pulls, and persists the
// rings in session storage (signal-log-persistence) so a restarted service
// worker keeps serving consumer catch-up pulls within the browser session.
import type {
  SignalEmitPayload,
  SignalFrame,
  SignalPayload,
} from "../../common/bus/contracts/signals";

const SIGNAL_LOG_CAPACITY = 128;
const SIGNAL_DEDUPE_WINDOW_MS = 250;

export type SignalAdmission = Readonly<{
  frame: SignalFrame | null;
  deduped: boolean;
}>;

type TabSignalLog = {
  headSeq: number;
  frames: SignalFrame[];
  // Most recent admitted frame per signal name (for dedupeKey comparisons
  // regardless of ring truncation).
  lastByName: Map<string, { at: number; cause: string; payloadKey: string; dedupeKey: string }>;
};

export type SignalLog = Readonly<{
  admit(tabId: number, emit: SignalEmitPayload, source?: SignalFrame["source"]): SignalAdmission;
  listAfter(tabId: number, afterSeq: number): readonly SignalFrame[];
  headSeq(tabId: number): number;
  resetTab(tabId: number): void;
  serialize(): Record<string, { headSeq: number; frames: SignalFrame[] }>;
  hydrate(persisted: unknown): void;
}>;

function normalizePayload(payload: SignalPayload | undefined): SignalPayload {
  if (!payload || typeof payload !== "object") {
    return Object.freeze({});
  }
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return Object.freeze(out);
}

function payloadKeyOf(payload: SignalPayload): string {
  return JSON.stringify(
    Object.keys(payload)
      .sort()
      .map((key) => [key, payload[key]])
  );
}

export function createSignalLog(options: { now?: () => number } = {}): SignalLog {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const tabs = new Map<number, TabSignalLog>();

  function tabLog(tabId: number): TabSignalLog {
    let log = tabs.get(tabId);
    if (!log) {
      log = { headSeq: 0, frames: [], lastByName: new Map() };
      tabs.set(tabId, log);
    }
    return log;
  }

  return {
    admit(tabId, emit, sourceOverride) {
      if (!Number.isFinite(tabId) || tabId <= 0 || !emit || typeof emit.name !== "string") {
        return { frame: null, deduped: false };
      }
      const log = tabLog(Math.trunc(tabId));
      const at = now();
      const payload = normalizePayload(emit.payload);
      const payloadKey = payloadKeyOf(payload);
      const cause = typeof emit.cause === "string" ? emit.cause : "";
      const dedupeKey = typeof emit.dedupeKey === "string" ? emit.dedupeKey : "";
      const last = log.lastByName.get(emit.name);
      if (last) {
        // Rule 1: identical consecutive (name, cause, payload) within the
        // double-fire window is dropped (double-wired call sites).
        if (
          at - last.at <= SIGNAL_DEDUPE_WINDOW_MS &&
          last.cause === cause &&
          last.payloadKey === payloadKey
        ) {
          return { frame: null, deduped: true };
        }
        // Rule 2: an explicit dedupeKey drops regardless of the window when
        // the most recent frame of this name carried the same key.
        if (dedupeKey && last.dedupeKey === dedupeKey) {
          return { frame: null, deduped: true };
        }
      }
      log.headSeq += 1;
      const frame: SignalFrame = Object.freeze({
        kind: "uf-signal/1",
        tabId: Math.trunc(tabId),
        seq: log.headSeq,
        name: emit.name,
        source: sourceOverride ?? emit.source,
        cause,
        at,
        payload,
      });
      log.frames.push(frame);
      if (log.frames.length > SIGNAL_LOG_CAPACITY) {
        log.frames.splice(0, log.frames.length - SIGNAL_LOG_CAPACITY);
      }
      log.lastByName.set(emit.name, { at, cause, payloadKey, dedupeKey });
      return { frame, deduped: false };
    },

    listAfter(tabId, afterSeq) {
      const log = tabs.get(Math.trunc(tabId));
      if (!log) {
        return [];
      }
      const after = Number.isFinite(afterSeq) ? Math.trunc(afterSeq) : 0;
      return log.frames.filter((frame) => frame.seq > after);
    },

    headSeq(tabId) {
      return tabs.get(Math.trunc(tabId))?.headSeq ?? 0;
    },

    resetTab(tabId) {
      tabs.delete(Math.trunc(tabId));
    },

    serialize() {
      const out: Record<string, { headSeq: number; frames: SignalFrame[] }> = {};
      for (const [tabId, log] of tabs) {
        out[String(tabId)] = { headSeq: log.headSeq, frames: [...log.frames] };
      }
      return out;
    },

    hydrate(persisted) {
      if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
        return;
      }
      for (const [key, value] of Object.entries(persisted as Record<string, unknown>)) {
        const tabId = Number(key);
        if (!Number.isFinite(tabId) || tabId <= 0 || !value || typeof value !== "object") {
          continue;
        }
        const record = value as { headSeq?: unknown; frames?: unknown };
        const frames = Array.isArray(record.frames)
          ? (record.frames.filter(
              (frame) => frame && typeof frame === "object" && Number.isFinite((frame as SignalFrame).seq)
            ) as SignalFrame[])
          : [];
        const headSeq = Number.isFinite(record.headSeq)
          ? Math.trunc(Number(record.headSeq))
          : frames.reduce((max, frame) => Math.max(max, frame.seq), 0);
        tabs.set(Math.trunc(tabId), {
          headSeq,
          frames: frames.slice(-SIGNAL_LOG_CAPACITY),
          lastByName: new Map(),
        });
      }
    },
  };
}
