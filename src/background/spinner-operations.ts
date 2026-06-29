import {
  SPINNER_OWNERS,
  WORLD_MESSAGE_TYPES
} from "../common/world-messaging-contract";
import { createSpinnerOperationLease } from "../common/spinner-contract";
import type { PopupSpinnerEntry } from "../common/bus/contracts/popup-state";

type SpinnerEntry = {
  blockSurfaces?: {
    page?: boolean;
    popup?: boolean;
  };
  deadlineAt?: number;
  details?: Record<string, unknown>;
  maxDurationMs?: number;
  message?: string;
  operationId?: string;
  operationKind?: string;
  operationPhase?: string;
  persistent?: boolean;
  owner?: string;
  reason?: string;
  source?: string;
  startedAt?: number;
  progress?: number;
  resetStartedAt?: boolean;
  timerMode?: string;
  updatedAt?: number;
};

type SpinnerQueue = Map<string, SpinnerEntry>;

type SpinnerOperationsOptions = {
  queueByTabId?: Map<number, SpinnerQueue>;
  normalizeTabId?: (value: unknown) => number;
  appendTrace?: (tabId: number, channel: string, event: string, payload: Record<string, unknown>) => void;
  broadcastState?: (tabId: number) => void;
  buildState?: (tabId: number) => Record<string, unknown>;
  updateRuntimeSpinnerQueue?: (tabId: number, queue: SpinnerQueue) => void;
  syncProjectedSpinnerState?: (tabId: number, queue: PopupSpinnerEntry[], reason: string) => void;
};

function defaultNormalizeTabId(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : 0;
}

function randomSpinnerKey(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `spinner:${Date.now()}:${Math.floor(Math.random() * 1e6)}`;
}

function hasSpinnerEntryField(entry: SpinnerEntry, field: keyof SpinnerEntry): boolean {
  return Object.prototype.hasOwnProperty.call(entry, field);
}

function getSpinnerStringField(
  entry: SpinnerEntry | null | undefined,
  field: keyof SpinnerEntry,
  fallback = "",
  requireNonEmpty = false
): string {
  const value = entry?.[field];
  if (typeof value === "string" && (!requireNonEmpty || value)) {
    return value;
  }
  return fallback;
}

function getSpinnerNumberField(
  entry: SpinnerEntry | null | undefined,
  field: keyof SpinnerEntry,
  fallback = 0
): number {
  const value = entry?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function shouldPreservePreviousLease(
  entry: SpinnerEntry,
  previous: SpinnerEntry | null
): boolean {
  const entryReason = getSpinnerStringField(entry, "reason", "", true);
  const previousReason = getSpinnerStringField(previous, "reason", "", true);
  const entryOperationKind = getSpinnerStringField(entry, "operationKind", "", true);
  const previousOperationKind = getSpinnerStringField(previous, "operationKind", "", true);
  const entryOperationPhase = getSpinnerStringField(entry, "operationPhase", "", true);
  const previousOperationPhase = getSpinnerStringField(previous, "operationPhase", "", true);
  const reasonChanged = Boolean(entryReason && previousReason && entryReason !== previousReason);
  const operationIdentityChanged = Boolean(
    (entryOperationKind && entryOperationKind !== previousOperationKind) ||
      (entryOperationPhase && entryOperationPhase !== previousOperationPhase)
  );
  return !reasonChanged && !operationIdentityChanged;
}

function buildBaseSpinnerEntry(key: unknown, entry: SpinnerEntry, previous: SpinnerEntry | null): SpinnerEntry {
  return {
    message: getSpinnerStringField(entry, "message", getSpinnerStringField(previous, "message")),
    persistent: hasSpinnerEntryField(entry, "persistent")
      ? Boolean(entry.persistent)
      : Boolean(previous && previous.persistent),
    owner: getSpinnerStringField(entry, "owner", getSpinnerStringField(previous, "owner", SPINNER_OWNERS.POPUP)),
    reason: getSpinnerStringField(
      entry,
      "reason",
      getSpinnerStringField(previous, "reason", `spinner:${String(key)}`, true),
      true
    ),
    source: getSpinnerStringField(
      entry,
      "source",
      getSpinnerStringField(previous, "source", "background-spinner-broker", true),
      true
    ),
    startedAt: getSpinnerNumberField(
      entry,
      "startedAt",
      previous && Number.isFinite(previous.startedAt) ? Number(previous.startedAt) : Date.now()
    ),
    progress: getSpinnerNumberField(entry, "progress", getSpinnerNumberField(previous, "progress"))
  };
}

function serializeSpinnerQueueEntry(key: string, entry: SpinnerEntry | null | undefined): PopupSpinnerEntry {
  return {
    key,
    message: getSpinnerStringField(entry, "message"),
    persistent: Boolean(entry && entry.persistent),
    owner: getSpinnerStringField(entry, "owner"),
    reason: getSpinnerStringField(entry, "reason"),
    source: getSpinnerStringField(entry, "source"),
    startedAt: getSpinnerNumberField(entry, "startedAt"),
    progress: getSpinnerNumberField(entry, "progress"),
    operationId: getSpinnerStringField(entry, "operationId"),
    operationKind: getSpinnerStringField(entry, "operationKind"),
    operationPhase: getSpinnerStringField(entry, "operationPhase"),
    timerMode: getSpinnerStringField(entry, "timerMode"),
    deadlineAt: getSpinnerNumberField(entry, "deadlineAt"),
    maxDurationMs: getSpinnerNumberField(entry, "maxDurationMs"),
    updatedAt: getSpinnerNumberField(entry, "updatedAt"),
    ...(entry && entry.blockSurfaces && typeof entry.blockSurfaces === "object"
      ? {
        blockSurfaces: {
          page: Boolean(entry.blockSurfaces.page),
          popup: Boolean(entry.blockSurfaces.popup)
        }
      }
      : {})
  } satisfies PopupSpinnerEntry;
}

function normalizeSpinnerEntry(
  key: unknown,
  entry: SpinnerEntry = {},
  previous: SpinnerEntry | null = null,
  tabId: unknown = null
): SpinnerEntry {
  const preservePreviousLease = shouldPreservePreviousLease(entry, previous);
  const baseEntry = buildBaseSpinnerEntry(key, entry, previous);
  const entryOperationKind = getSpinnerStringField(entry, "operationKind", "", true);
  const previousOperationKind = getSpinnerStringField(previous, "operationKind", "", true);
  const entryOperationPhase = getSpinnerStringField(entry, "operationPhase", "", true);
  const previousOperationPhase = getSpinnerStringField(previous, "operationPhase", "", true);
  const operationLease = createSpinnerOperationLease({
    blockSurfaces: entry.blockSurfaces || (preservePreviousLease ? previous?.blockSurfaces : undefined),
    deadlineAt: hasSpinnerEntryField(entry, "deadlineAt") ? entry.deadlineAt : (preservePreviousLease ? previous?.deadlineAt : undefined),
    details: entry.details || (preservePreviousLease ? previous?.details : undefined),
    kind: entryOperationKind || (preservePreviousLease ? previousOperationKind : undefined),
    maxDurationMs: hasSpinnerEntryField(entry, "maxDurationMs")
      ? entry.maxDurationMs
      : (preservePreviousLease ? previous?.maxDurationMs : undefined),
    message: baseEntry.message,
    operationId: entry.operationId || (preservePreviousLease ? previous?.operationId : undefined),
    operationPhase: entryOperationPhase || (preservePreviousLease ? previousOperationPhase : undefined),
    reason: baseEntry.reason,
    spinnerKey: key,
    startedAt: baseEntry.startedAt,
    tabId,
    timerMode: entry.timerMode || (preservePreviousLease ? previous?.timerMode : undefined),
    updatedAt: Date.now()
  });
  if (!operationLease) {
    return baseEntry;
  }
  return {
    ...baseEntry,
    blockSurfaces: { ...operationLease.blockSurfaces },
    deadlineAt: operationLease.deadlineAt,
    details: { ...operationLease.details },
    maxDurationMs: operationLease.maxDurationMs,
    operationId: operationLease.operationId,
    operationKind: operationLease.kind,
    operationPhase: operationLease.phase,
    timerMode: operationLease.timerMode,
    updatedAt: operationLease.updatedAt
  };
}

export function createSpinnerOperations(options: SpinnerOperationsOptions = {}) {
  const queueByTabId = options.queueByTabId instanceof Map ? options.queueByTabId : new Map<number, SpinnerQueue>();
  const normalizeTabId = typeof options.normalizeTabId === "function"
    ? options.normalizeTabId
    : defaultNormalizeTabId;
  const appendTrace = typeof options.appendTrace === "function"
    ? options.appendTrace
    : () => {};
  const broadcastState = typeof options.broadcastState === "function"
    ? options.broadcastState
    : () => {};
  const buildState = typeof options.buildState === "function"
    ? options.buildState
    : (tabId: number) => ({ ok: Boolean(tabId), tabId, spinnerQueue: [] });
  const updateRuntimeSpinnerQueue = typeof options.updateRuntimeSpinnerQueue === "function"
    ? options.updateRuntimeSpinnerQueue
    : () => {};
  const syncProjectedSpinnerState = typeof options.syncProjectedSpinnerState === "function"
    ? options.syncProjectedSpinnerState
    : () => {};

  function getSpinnerQueueForTab(tabId: unknown): SpinnerQueue | null {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return null;
    }
    if (!queueByTabId.has(normalizedTabId)) {
      queueByTabId.set(normalizedTabId, new Map<string, SpinnerEntry>());
    }
    return queueByTabId.get(normalizedTabId) || null;
  }

  function serializeSpinnerQueue(tabId: unknown): PopupSpinnerEntry[] {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return [];
    }
    const queue = queueByTabId.get(normalizedTabId);
    if (!queue || queue.size === 0) {
      return [];
    }
    return [...queue.entries()].map(([key, entry]) => serializeSpinnerQueueEntry(key, entry));
  }

  function setBackgroundSpinnerEntry(tabId: unknown, key: unknown, entry: SpinnerEntry = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !key) {
      return buildState(normalizedTabId);
    }
    const queue = getSpinnerQueueForTab(normalizedTabId);
    const normalizedEntry = normalizeSpinnerEntry(String(key), entry, queue?.get(String(key)) || null, normalizedTabId);
    queue?.set(String(key), normalizedEntry);
    updateRuntimeSpinnerQueue(normalizedTabId, queue || new Map<string, SpinnerEntry>());
    syncProjectedSpinnerState(normalizedTabId, serializeSpinnerQueue(normalizedTabId), "set");
    appendTrace(normalizedTabId, "spinner", "set", {
      type: WORLD_MESSAGE_TYPES.SPINNER_SET,
      key: String(key),
      message: normalizedEntry.message,
      reason: normalizedEntry.reason,
      source: normalizedEntry.source
    });
    broadcastState(normalizedTabId);
    return buildState(normalizedTabId);
  }

  function updateBackgroundSpinnerEntry(tabId: unknown, key: unknown, patch: SpinnerEntry = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !key) {
      return buildState(normalizedTabId);
    }
    const queue = getSpinnerQueueForTab(normalizedTabId);
    const existing = queue?.get(String(key)) || null;
    const nextPatch: SpinnerEntry = { ...patch };
    if (patch && patch.resetStartedAt) {
      nextPatch.startedAt = Date.now();
    }
    return setBackgroundSpinnerEntry(
      normalizedTabId,
      String(key),
      normalizeSpinnerEntry(String(key), nextPatch, existing, normalizedTabId)
    );
  }

  function removeBackgroundSpinnerEntry(tabId: unknown, key: unknown) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId || !key) {
      return buildState(normalizedTabId);
    }
    const queue = getSpinnerQueueForTab(normalizedTabId);
    queue?.delete(String(key));
    if (!queue || queue.size === 0) {
      queueByTabId.delete(normalizedTabId);
    }
    updateRuntimeSpinnerQueue(normalizedTabId, queue || new Map<string, SpinnerEntry>());
    syncProjectedSpinnerState(normalizedTabId, serializeSpinnerQueue(normalizedTabId), "remove");
    appendTrace(normalizedTabId, "spinner", "remove", {
      type: WORLD_MESSAGE_TYPES.SPINNER_REMOVE,
      key: String(key),
      message: String(key),
      reason: "spinner-removed",
      source: "background-spinner-broker"
    });
    broadcastState(normalizedTabId);
    return buildState(normalizedTabId);
  }

  function clearBackgroundSpinnerQueue(tabId: unknown, options: { transientOnly?: unknown } = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return buildState(normalizedTabId);
    }
    const queue = queueByTabId.get(normalizedTabId);
    if (!queue) {
      return buildState(normalizedTabId);
    }
    const transientOnly = Boolean(options.transientOnly);
    if (transientOnly) {
      for (const [key, entry] of queue.entries()) {
        if (!entry || !entry.persistent) {
          queue.delete(key);
        }
      }
      if (queue.size === 0) {
        queueByTabId.delete(normalizedTabId);
      }
    } else {
      queueByTabId.delete(normalizedTabId);
    }
    updateRuntimeSpinnerQueue(normalizedTabId, queueByTabId.get(normalizedTabId) || new Map<string, SpinnerEntry>());
    syncProjectedSpinnerState(normalizedTabId, serializeSpinnerQueue(normalizedTabId), "clear");
    appendTrace(normalizedTabId, "spinner", "clear", {
      type: WORLD_MESSAGE_TYPES.SPINNER_CLEAR,
      message: transientOnly ? "transient-only" : "all",
      reason: transientOnly ? "clear-transient-spinners" : "clear-all-spinners",
      source: "background-spinner-broker"
    });
    broadcastState(normalizedTabId);
    return buildState(normalizedTabId);
  }

  async function withTabSpinner(
    tabId: unknown,
    descriptor: SpinnerEntry & { key?: unknown } = {},
    work: (context: { key: string; update: (patch?: SpinnerEntry) => Promise<Record<string, unknown>> }) => Promise<unknown>
  ) {
    if (typeof work !== "function") {
      throw new TypeError("withTabSpinner requires an async work function");
    }
    const key = typeof descriptor.key === "string" && descriptor.key
      ? descriptor.key
      : randomSpinnerKey();
    await Promise.resolve(setBackgroundSpinnerEntry(tabId, key, {
      ...descriptor
    }));
    try {
      return await work({
        key,
        update: async (patch = {}) => {
          return updateBackgroundSpinnerEntry(tabId, key, patch);
        }
      });
    } finally {
      await Promise.resolve(removeBackgroundSpinnerEntry(tabId, key));
    }
  }

  return {
    getSpinnerQueueForTab,
    serializeSpinnerQueue,
    setBackgroundSpinnerEntry,
    updateBackgroundSpinnerEntry,
    removeBackgroundSpinnerEntry,
    clearBackgroundSpinnerQueue,
    withTabSpinner
  };
}
