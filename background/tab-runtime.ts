// @ts-nocheck
const tabRuntimeById = new Map();
const MAX_LEDGER_ENTRIES = 50;

function createDefaultRuntime(tabId) {
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

function cloneSpinnerQueue(queue) {
  if (!(queue instanceof Map)) {
    return new Map();
  }
  return new Map(queue);
}

function cloneLedger(ledger) {
  if (!Array.isArray(ledger)) {
    return [];
  }
  return ledger.map((entry) => ({ ...entry }));
}

export function normalizeTabId(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  const asInt = Math.trunc(normalized);
  return asInt > 0 ? asInt : 0;
}

export function getTabRuntime(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return null;
  }
  if (!tabRuntimeById.has(normalizedTabId)) {
    tabRuntimeById.set(normalizedTabId, createDefaultRuntime(normalizedTabId));
  }
  return tabRuntimeById.get(normalizedTabId);
}

export function deleteTabRuntime(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return false;
  }
  return tabRuntimeById.delete(normalizedTabId);
}

export function updateTabRuntime(tabId, patch) {
  const runtime = getTabRuntime(tabId);
  if (!runtime || !patch || typeof patch !== "object") {
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
    const nextPageWorld = patch.pageWorld && typeof patch.pageWorld === "object"
      ? patch.pageWorld
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
  if (Object.prototype.hasOwnProperty.call(patch, "lastKnownContentState")) {
    runtime.lastKnownContentState = patch.lastKnownContentState && typeof patch.lastKnownContentState === "object"
      ? { ...patch.lastKnownContentState }
      : null;
  }

  return runtime;
}

export function appendTabCommandLedger(tabId, entry) {
  const runtime = getTabRuntime(tabId);
  if (!runtime) {
    return [];
  }
  const normalizedEntry = entry && typeof entry === "object"
    ? {
      id: typeof entry.id === "string" ? entry.id : "",
      type: typeof entry.type === "string" ? entry.type : "",
      startedAt: Number.isFinite(entry.startedAt) ? Number(entry.startedAt) : Date.now(),
      finishedAt: Number.isFinite(entry.finishedAt) ? Number(entry.finishedAt) : Date.now(),
      durationMs: Number.isFinite(entry.durationMs) ? Number(entry.durationMs) : 0,
      status: typeof entry.status === "string" ? entry.status : "unknown",
      errorCode: typeof entry.errorCode === "string" ? entry.errorCode : "",
      payload: entry.payload && typeof entry.payload === "object" ? { ...entry.payload } : undefined
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

export function getTabRuntimeSnapshot(tabId) {
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