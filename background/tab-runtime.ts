type TabRuntimeIdInput = number | string | null | undefined;
type RuntimePrimitive = string | number | boolean | null;
type RuntimeValue = RuntimePrimitive | object | Array<RuntimePrimitive | object>;
type RuntimeRecord = Record<string, RuntimeValue>;

type SpinnerRuntimeEntry = {
  message?: string;
  persistent?: boolean;
  owner?: string;
  reason?: string;
  source?: string;
  startedAt?: number;
  progress?: number;
  [key: string]: RuntimeValue | undefined;
};

type PageWorldState = { ready: boolean; nonce: string };

type CommandLedgerEntry = {
  id: string;
  type: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: string;
  errorCode: string;
  payload?: object;
};

type TabRuntime = {
  tabId: number;
  contentReady: boolean;
  contentSessionId: string;
  mode: string;
  operation: RuntimeRecord | null;
  spinnerQueue: Map<string, SpinnerRuntimeEntry>;
  lifecycle: RuntimeRecord | null;
  pageWorld: PageWorldState;
  lastKnownContentState: RuntimeRecord | null;
  commandLedger: CommandLedgerEntry[];
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

type TabRuntimePatch = {
  contentReady?: boolean;
  contentSessionId?: string;
  mode?: string;
  operation?: RuntimeRecord | null;
  spinnerQueue?: Map<string, SpinnerRuntimeEntry>;
  lifecycle?: RuntimeRecord | null;
  pageWorld?: Partial<PageWorldState> | null;
  lastKnownContentState?: RuntimeRecord | null;
};

type LedgerEntryInput = Partial<CommandLedgerEntry> & { payload?: object | null };

type TabRuntimeSnapshot = {
  tabId: number;
  contentReady: boolean;
  contentSessionId: string;
  mode: string;
  operation: RuntimeRecord | null;
  spinnerQueue: Array<{ key: string; value: SpinnerRuntimeEntry }>;
  lifecycle: RuntimeRecord | null;
  pageWorld: PageWorldState;
  lastKnownContentState: RuntimeRecord | null;
  commandLedger: CommandLedgerEntry[];
};

function cloneSpinnerQueue(queue: Map<string, SpinnerRuntimeEntry> | null | undefined): Map<string, SpinnerRuntimeEntry> {
  if (!queue || !(queue instanceof Map)) {
    return new Map();
  }
  return new Map(queue);
}

function cloneLedger(ledger: CommandLedgerEntry[] | null | undefined): CommandLedgerEntry[] {
  if (!ledger) {
    return [];
  }
  return ledger.map((entry) => ({
    ...entry,
    payload: entry.payload && typeof entry.payload === "object" ? { ...entry.payload } : undefined
  }));
}

export function normalizeTabId(value: TabRuntimeIdInput): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  const asInt = Math.trunc(normalized);
  return asInt > 0 ? asInt : 0;
}

export function getTabRuntime(tabId: TabRuntimeIdInput): TabRuntime | null {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return null;
  }
  if (!tabRuntimeById.has(normalizedTabId)) {
    tabRuntimeById.set(normalizedTabId, createDefaultRuntime(normalizedTabId));
  }
  return tabRuntimeById.get(normalizedTabId) || null;
}

export function deleteTabRuntime(tabId: TabRuntimeIdInput): boolean {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return false;
  }
  return tabRuntimeById.delete(normalizedTabId);
}

export function updateTabRuntime(tabId: TabRuntimeIdInput, patch: TabRuntimePatch | null | undefined): TabRuntime | null {
  const runtime = getTabRuntime(tabId);
  if (!runtime || !patch) {
    return runtime;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "contentReady")) {
    runtime.contentReady = Boolean(patch.contentReady);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "contentSessionId")) {
    runtime.contentSessionId = typeof patch.contentSessionId === "string" ? patch.contentSessionId : "";
  }
  if (Object.prototype.hasOwnProperty.call(patch, "mode")) {
    runtime.mode = typeof patch.mode === "string" && patch.mode ? patch.mode : runtime.mode;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "operation")) {
    runtime.operation = patch.operation && typeof patch.operation === "object"
      ? { ...patch.operation }
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "spinnerQueue")) {
    runtime.spinnerQueue = cloneSpinnerQueue(patch.spinnerQueue);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lifecycle")) {
    runtime.lifecycle = patch.lifecycle && typeof patch.lifecycle === "object"
      ? { ...patch.lifecycle }
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "pageWorld")) {
    const nextPageWorld = patch.pageWorld && typeof patch.pageWorld === "object" ? patch.pageWorld : {};
    runtime.pageWorld = {
      ready: Object.prototype.hasOwnProperty.call(nextPageWorld, "ready") ? Boolean(nextPageWorld.ready) : runtime.pageWorld.ready,
      nonce: Object.prototype.hasOwnProperty.call(nextPageWorld, "nonce")
        ? (typeof nextPageWorld.nonce === "string" ? nextPageWorld.nonce : "")
        : runtime.pageWorld.nonce
    };
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lastKnownContentState")) {
    runtime.lastKnownContentState = patch.lastKnownContentState && typeof patch.lastKnownContentState === "object"
      ? { ...patch.lastKnownContentState }
      : null;
  }

  return runtime;
}

export function appendTabCommandLedger(tabId: TabRuntimeIdInput, entry: LedgerEntryInput | null | undefined): CommandLedgerEntry[] {
  const runtime = getTabRuntime(tabId);
  if (!runtime) {
    return [];
  }
  const entryRecord = entry || null;
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
        ? { ...entryRecord.payload }
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

export function getTabRuntimeSnapshot(tabId: TabRuntimeIdInput): TabRuntimeSnapshot | null {
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
    spinnerQueue: [...runtime.spinnerQueue.entries()].map(([key, value]) => ({ key, value: { ...value } })),
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