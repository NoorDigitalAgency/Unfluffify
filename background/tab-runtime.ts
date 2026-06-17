type TabRuntime = {
  tabId: number;
  contentReady: boolean;
  contentSessionId: string;
  mode: string;
  operation: Record<string, unknown> | null;
  spinnerQueue: Map<string, unknown>;
  lifecycle: Record<string, unknown> | null;
  pageWorld: { ready: boolean; nonce: string };
  lastKnownContentState: Record<string, unknown> | null;
  commandLedger: Array<Record<string, unknown>>;
};

const tabRuntimeById = new Map<number, TabRuntime>();
const MAX_LEDGER_ENTRIES = 50;

function createDefaultRuntime(tabId: number): TabRuntime {
  return {
    tabId,
    contentReady: false,
    contentSessionId: "",
    mode: "idle",
    operation: null,
    spinnerQueue: new Map(),
    lifecycle: null,
    pageWorld: {
      ready: false,
      nonce: ""
    },
    lastKnownContentState: null,
    commandLedger: []
  };
}

function cloneSpinnerQueue(queue: unknown): Map<string, unknown> {
  if (!(queue instanceof Map)) {
    return new Map();
  }
  return new Map(queue);
}

function cloneLedger(ledger: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(ledger)) {
    return [];
  }
  return ledger.map((entry) => ({ ...entry }));
}

export function normalizeTabId(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  const asInt = Math.trunc(normalized);
  return asInt > 0 ? asInt : 0;
}

export function getTabRuntime(tabId: unknown): TabRuntime | null {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return null;
  }
  if (!tabRuntimeById.has(normalizedTabId)) {
    tabRuntimeById.set(normalizedTabId, createDefaultRuntime(normalizedTabId));
  }
  return tabRuntimeById.get(normalizedTabId) || null;
}

export function deleteTabRuntime(tabId: unknown): boolean {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return false;
  }
  return tabRuntimeById.delete(normalizedTabId);
}

export function updateTabRuntime(tabId: unknown, patch: unknown): TabRuntime | null {
  const runtime = getTabRuntime(tabId);
  if (!runtime || !patch || typeof patch !== "object") {
    return runtime;
  }

  const patchRecord = patch as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(patchRecord, "contentReady")) {
    runtime.contentReady = Boolean(patchRecord.contentReady);
  }
  if (Object.prototype.hasOwnProperty.call(patchRecord, "contentSessionId")) {
    runtime.contentSessionId = typeof patchRecord.contentSessionId === "string" ? patchRecord.contentSessionId : "";
  }
  if (Object.prototype.hasOwnProperty.call(patchRecord, "mode")) {
    runtime.mode = typeof patchRecord.mode === "string" && patchRecord.mode ? patchRecord.mode : runtime.mode;
  }

  if (Object.prototype.hasOwnProperty.call(patchRecord, "operation")) {
    runtime.operation = patchRecord.operation && typeof patchRecord.operation === "object"
      ? { ...(patchRecord.operation as Record<string, unknown>) }
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(patchRecord, "spinnerQueue")) {
    runtime.spinnerQueue = cloneSpinnerQueue(patchRecord.spinnerQueue);
  }
  if (Object.prototype.hasOwnProperty.call(patchRecord, "lifecycle")) {
    runtime.lifecycle = patchRecord.lifecycle && typeof patchRecord.lifecycle === "object"
      ? { ...(patchRecord.lifecycle as Record<string, unknown>) }
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(patchRecord, "pageWorld")) {
    const nextPageWorld = patchRecord.pageWorld && typeof patchRecord.pageWorld === "object"
      ? (patchRecord.pageWorld as Record<string, unknown>)
      : {};
    runtime.pageWorld = {
      ready: Object.prototype.hasOwnProperty.call(nextPageWorld, "ready")
        ? Boolean(nextPageWorld.ready)
        : Boolean(runtime.pageWorld && runtime.pageWorld.ready),
      nonce: Object.prototype.hasOwnProperty.call(nextPageWorld, "nonce")
        ? (typeof nextPageWorld.nonce === "string" ? nextPageWorld.nonce : "")
        : (runtime.pageWorld && typeof runtime.pageWorld.nonce === "string" ? runtime.pageWorld.nonce : "")
    };
  }
  if (Object.prototype.hasOwnProperty.call(patchRecord, "lastKnownContentState")) {
    runtime.lastKnownContentState = patchRecord.lastKnownContentState && typeof patchRecord.lastKnownContentState === "object"
      ? { ...(patchRecord.lastKnownContentState as Record<string, unknown>) }
      : null;
  }

  return runtime;
}

export function appendTabCommandLedger(tabId: unknown, entry: unknown): Array<Record<string, unknown>> {
  const runtime = getTabRuntime(tabId);
  if (!runtime) {
    return [];
  }
  const entryRecord = (entry && typeof entry === "object" ? entry : null) as Record<string, unknown> | null;
  const normalizedEntry = entryRecord
    ? {
      id: typeof entryRecord.id === "string" ? entryRecord.id : "",
      type: typeof entryRecord.type === "string" ? entryRecord.type : "",
      startedAt: Number.isFinite(entryRecord.startedAt) ? Number(entryRecord.startedAt) : Date.now(),
      finishedAt: Number.isFinite(entryRecord.finishedAt) ? Number(entryRecord.finishedAt) : Date.now(),
      durationMs: Number.isFinite(entryRecord.durationMs) ? Number(entryRecord.durationMs) : 0,
      status: typeof entryRecord.status === "string" ? entryRecord.status : "unknown",
      errorCode: typeof entryRecord.errorCode === "string" ? entryRecord.errorCode : "",
      payload: entryRecord.payload && typeof entryRecord.payload === "object"
        ? { ...(entryRecord.payload as Record<string, unknown>) }
        : undefined
    }
    : {
      id: "",
      type: "",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      durationMs: 0,
      status: "unknown",
      errorCode: ""
    };

  runtime.commandLedger.push(normalizedEntry);
  if (runtime.commandLedger.length > MAX_LEDGER_ENTRIES) {
    runtime.commandLedger = runtime.commandLedger.slice(-MAX_LEDGER_ENTRIES);
  }
  return cloneLedger(runtime.commandLedger);
}

export function getTabRuntimeSnapshot(tabId: unknown): Record<string, unknown> | null {
  const runtime = getTabRuntime(tabId);
  if (!runtime) {
    return null;
  }
  return {
    tabId: runtime.tabId,
    contentReady: Boolean(runtime.contentReady),
    contentSessionId: runtime.contentSessionId || "",
    mode: runtime.mode || "idle",
    operation: runtime.operation ? { ...runtime.operation } : null,
    spinnerQueue: [...(runtime.spinnerQueue instanceof Map ? runtime.spinnerQueue.entries() : [])].map(([key, value]) => ({
      key,
      value: value && typeof value === "object" ? { ...value } : value
    })),
    lifecycle: runtime.lifecycle ? { ...runtime.lifecycle } : null,
    pageWorld: runtime.pageWorld
      ? {
        ready: Boolean(runtime.pageWorld.ready),
        nonce: typeof runtime.pageWorld.nonce === "string" ? runtime.pageWorld.nonce : ""
      }
      : { ready: false, nonce: "" },
    lastKnownContentState: runtime.lastKnownContentState
      ? { ...runtime.lastKnownContentState }
      : null,
    commandLedger: cloneLedger(runtime.commandLedger)
  };
}

export function __resetTabRuntimeForTests() {
  tabRuntimeById.clear();
}