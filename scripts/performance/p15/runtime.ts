import type { BusFrame } from "../../../src/messaging/contract";
import type { BrainSignal, BrainSignalName } from "../../../src/domain/schema/signals";
import type { ShieldPostureClearReason } from "../../../src/messaging/shield-posture";

const DURABLE_KEY = "p15-shield-posture";
const PAGE_CONTEXT_MODE_KEY = "p15-page-context-mode";
const PAGE_CONTEXT_DEFER_KEY = "p15-page-context-deferred";
const TAB_ID = 77;
const DOCUMENT_ID = `p15-document-${crypto.randomUUID()}`;

type RuntimeSender = Readonly<{
  tab?: Readonly<{ id?: number }>;
  frameId?: number;
  documentId?: string;
}>;

type RuntimeListener = (
  message: unknown,
  sender: RuntimeSender,
  sendResponse?: (response: unknown) => void,
) => unknown;

type SelectorSet = Readonly<{
  exclusionSelectors: string[];
  inclusionSelectors: string[];
}>;

type ShieldScope = Readonly<{
  environmentKey: string;
  siteId: number;
  baseUrl: string;
  contextGeneration: number;
  pageUrl: string;
  documentKey: string;
}>;

type ShieldDirective = Readonly<{
  silentSelectors?: SelectorSet;
  organ:
    | Readonly<{ state: "silent" }>
    | Readonly<{ state: "preview"; origin: "silent" | "post_ai"; selectors?: SelectorSet }>
    | Readonly<{ state: "blocked-organ"; organState: string; blockedReason: string; selectors?: SelectorSet }>;
}>;

type ShieldProjection =
  | Readonly<{ status: "active"; revision: number; scope: ShieldScope; directive: ShieldDirective }>
  | Readonly<{ status: "inactive"; revision: number; scope?: ShieldScope }>;

type FixtureWindow = Window & typeof globalThis & {
  __p15Fixture?: {
    state: Record<string, number>;
    snapshot(): Record<string, unknown>;
    xpath(selector: string): string;
  };
  __p15Runtime?: P15Runtime;
};

type P15Runtime = Readonly<{
  documentId: string;
  readyState: () => "booting" | "ready" | "failed";
  readyError: () => string;
  dispatch: (name: string, payload?: Record<string, unknown>) => Promise<unknown>;
  queueSignals: (signals: Array<Readonly<{ name: BrainSignalName; payload?: Record<string, unknown> }>>) => BrainSignal[];
  resetDurablePosture: () => void;
  backgroundSnapshot: () => Record<string, unknown>;
  fixtureSnapshot: () => Record<string, unknown>;
  dispatchPagehide: () => Promise<Record<string, unknown>>;
  dispatchUnload: () => Promise<Record<string, unknown>>;
  invalidate: () => Promise<Record<string, unknown>>;
  setPageContextMode: (mode: "managed" | "transient-retained" | "unmanaged") => void;
  setPageContextDeferred: (deferred: boolean) => void;
  releasePageContext: () => Record<string, unknown>;
  simulateBackgroundTerminal: (reason: "save" | "discard") => Record<string, unknown>;
  dispatchBackgroundCommand: (name: "session.unregister", payload: Record<string, unknown>) => Record<string, unknown>;
}>;

const fixtureWindow = window as FixtureWindow;
const runtimeListeners = new Set<RuntimeListener>();
const backgroundFrames: BusFrame[] = [];
const queuedSignals: BrainSignal[] = [];
const clipboardWrites: string[] = [];
const terminalBoundaries: Array<Record<string, unknown>> = [];
const pageContextResponses: Array<Record<string, unknown>> = [];
const retainedAdoptionResponses: Array<Record<string, unknown>> = [];
const backgroundCommands: Array<Record<string, unknown>> = [];
const pendingPageContextRequests: Array<Readonly<{
  frame: BusFrame;
  resolve: (reply: BusFrame) => void;
}>> = [];
let nextCommandSequence = 0;
let nextSignalSequence = 0;
let readyState: "booting" | "ready" | "failed" = "booting";
let readyError = "";
let invalidationCallback: (() => void) | null = null;
let pageContextMode: "managed" | "transient-retained" | "unmanaged" = (() => {
  try {
    return localStorage.getItem(PAGE_CONTEXT_MODE_KEY) === "transient-retained"
      ? "transient-retained"
      : "managed";
  } catch {
    return "managed";
  }
})();
let pageContextDeferred = (() => {
  try {
    return localStorage.getItem(PAGE_CONTEXT_DEFER_KEY) === "true";
  } catch {
    return false;
  }
})();

function parseStoredProjection(): ShieldProjection {
  try {
    const raw = localStorage.getItem(DURABLE_KEY);
    if (raw) {
      return JSON.parse(raw) as ShieldProjection;
    }
  } catch {
    // A corrupt test value is equivalent to no retained background posture.
  }
  return { status: "inactive", revision: 0 };
}

function storeProjection(projection: ShieldProjection): void {
  localStorage.setItem(DURABLE_KEY, JSON.stringify(projection));
}

function currentScope(): ShieldScope {
  return {
    environmentKey: "p15.test",
    siteId: 15,
    baseUrl: location.origin,
    contextGeneration: 1,
    pageUrl: location.href,
    documentKey: DOCUMENT_ID,
  };
}

function currentProjection(): ShieldProjection {
  const stored = parseStoredProjection();
  return { ...stored, scope: currentScope() };
}

function adoptRetainedProjection(): ShieldProjection | Readonly<{ status: "unavailable"; reason: string }> {
  const stored = parseStoredProjection();
  if (
    stored.status !== "active" ||
    stored.directive.organ.state !== "silent" ||
    !stored.directive.silentSelectors
  ) {
    return { status: "unavailable", reason: "no-retained-silent-posture" };
  }
  const projection: ShieldProjection = {
    status: "active",
    revision: stored.revision + 1,
    scope: currentScope(),
    directive: {
      silentSelectors: stored.directive.silentSelectors,
      organ: { state: "silent" },
    },
  };
  storeProjection(projection);
  return projection;
}

function updateProjection(payload: unknown): ShieldProjection {
  const request = payload && typeof payload === "object"
    ? payload as { posture?: Record<string, unknown> }
    : {};
  const posture = request.posture ?? {};
  const previous = currentProjection();
  const revision = previous.revision + 1;
  const silentSelectors = previous.status === "active" ? previous.directive.silentSelectors : undefined;
  let directive: ShieldDirective;
  if (posture.kind === "silent-selectors") {
    directive = {
      silentSelectors: posture.selectors as SelectorSet,
      organ: { state: "silent" },
    };
  } else if (posture.kind === "preview") {
    directive = {
      ...(silentSelectors ? { silentSelectors } : {}),
      organ: {
        state: "preview",
        origin: posture.origin === "silent" ? "silent" : "post_ai",
        ...(posture.selectors ? { selectors: posture.selectors as SelectorSet } : {}),
      },
    };
  } else {
    directive = {
      ...(silentSelectors ? { silentSelectors } : {}),
      organ: {
        state: "blocked-organ",
        organState: typeof posture.organState === "string" ? posture.organState : "running",
        blockedReason: typeof posture.blockedReason === "string" ? posture.blockedReason : "blocked",
        ...(posture.selectors ? { selectors: posture.selectors as SelectorSet } : {}),
      },
    };
  }
  const projection: ShieldProjection = {
    status: "active",
    revision,
    scope: currentScope(),
    directive,
  };
  storeProjection(projection);
  return projection;
}

function clearProjection(payload: unknown): ShieldProjection {
  const previous = currentProjection();
  const reason = payload && typeof payload === "object"
    ? (payload as { reason?: unknown }).reason
    : undefined;
  if (previous.status === "active" && reason === "silent-cleared" && previous.directive.organ.state !== "silent") {
    const projection: ShieldProjection = {
      ...previous,
      revision: previous.revision + 1,
      scope: currentScope(),
      directive: { organ: previous.directive.organ },
    };
    storeProjection(projection);
    return projection;
  }
  if (
    previous.status === "active" &&
    previous.directive.silentSelectors &&
    ["navigation", "failure", "cancel"].includes(String(reason))
  ) {
    const projection: ShieldProjection = {
      status: "active",
      revision: previous.revision + 1,
      scope: currentScope(),
      directive: {
        silentSelectors: previous.directive.silentSelectors,
        organ: { state: "silent" },
      },
    };
    storeProjection(projection);
    return projection;
  }
  const projection: ShieldProjection = {
    status: "inactive",
    revision: previous.revision + 1,
    scope: currentScope(),
  };
  storeProjection(projection);
  return projection;
}

function recordTerminalBoundary(
  reason: ShieldPostureClearReason,
  source: "content-request" | "background-boundary-simulation" | "page-context",
): ShieldProjection {
  const before = currentProjection();
  const after = clearProjection({ reason });
  terminalBoundaries.push({ reason, source, before, after });
  return after;
}

function replyTo(frame: BusFrame, payload: unknown): BusFrame {
  return {
    kind: "uf-bus/1",
    frameType: "reply",
    id: frame.id,
    seq: frame.seq,
    name: frame.name,
    source: frame.target === "broadcast" ? frame.source : frame.target,
    sourceInstance: "background:p15-gate",
    target: frame.source,
    payload,
    ok: true,
  };
}

function pageContextResponse() {
  if (pageContextMode === "unmanaged") {
    const shieldPosture = recordTerminalBoundary("property-exit", "page-context");
    return {
      status: "unmanaged",
      generation: 2,
      observedUrl: location.href,
      draftDisposition: "terminate",
      environmentKey: null,
      siteId: null,
      baseUrl: null,
      pageKey: null,
      pageTypes: [],
      membershipFingerprint: null,
      assignmentFingerprint: null,
      conflicts: [],
      upstreamCode: null,
      consentSuppressionAllowed: true,
      renderModeSet: false,
      todo: { covered: 0, actionable: 0, pageTypes: [] },
      shieldPosture,
    };
  }
  if (pageContextMode === "transient-retained") {
    return {
      status: "unavailable",
      generation: 1,
      observedUrl: location.href,
      draftDisposition: "preserve",
      environmentKey: null,
      siteId: null,
      baseUrl: null,
      pageKey: null,
      pageTypes: [],
      membershipFingerprint: null,
      assignmentFingerprint: null,
      conflicts: [],
      upstreamCode: "P15_TRANSIENT_COLD_WORKER",
      consentSuppressionAllowed: true,
      renderModeSet: false,
      todo: { covered: 0, actionable: 0, pageTypes: [] },
      shieldPosture: currentProjection(),
    };
  }
  const pageKey = location.pathname || "/";
  return {
    status: "managed_candidate",
    generation: 1,
    observedUrl: location.href,
    draftDisposition: "preserve",
    environmentKey: "p15.test",
    siteId: 15,
    baseUrl: location.origin,
    pageKey,
    pageTypes: [{
      pageType: "detail",
      pages: [{ pageKey, wordsCount: 120 }],
    }],
    membershipFingerprint: "p15-membership",
    assignmentFingerprint: "p15-assignment",
    conflicts: [],
    upstreamCode: null,
    consentSuppressionAllowed: true,
    renderModeSet: false,
    todo: {
      covered: 1,
      actionable: 1,
      pageTypes: [{
        pageType: "detail",
        markedCount: 1,
        current: true,
        candidates: [{ pageKey, wordsCount: 120, marked: true, current: true }],
      }],
    },
    shieldPosture: currentProjection(),
  };
}

function completePageContext(frame: BusFrame): BusFrame {
  const response = pageContextResponse();
  pageContextResponses.push(structuredClone(response));
  return replyTo(frame, response);
}

function releasePageContext(): Record<string, unknown> {
  pageContextDeferred = false;
  localStorage.removeItem(PAGE_CONTEXT_DEFER_KEY);
  const pending = pendingPageContextRequests.splice(0);
  for (const request of pending) {
    request.resolve(completePageContext(request.frame));
  }
  return {
    released: pending.length,
    pending: pendingPageContextRequests.length,
    responses: pageContextResponses.length,
  };
}

async function sendBackgroundMessage(message: unknown): Promise<unknown> {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const frame = message as BusFrame;
  if (frame.kind !== "uf-bus/1") {
    return undefined;
  }
  backgroundFrames.push(structuredClone(frame));
  if (frame.frameType === "event") {
    return undefined;
  }
  switch (frame.name) {
    case "page.context": {
      if (pageContextDeferred) {
        return new Promise<BusFrame>((resolve) => {
          pendingPageContextRequests.push({ frame: structuredClone(frame), resolve });
        });
      }
      return completePageContext(frame);
    }
    case "signals.pull": {
      const afterSeq = frame.payload && typeof frame.payload === "object"
        ? Number((frame.payload as { afterSeq?: unknown }).afterSeq ?? 0)
        : 0;
      return replyTo(frame, queuedSignals.filter((signal) => signal.seq > afterSeq));
    }
    case "signals.consume":
      return replyTo(frame, { ok: true });
    case "shield.posture.current":
      return replyTo(frame, currentProjection());
    case "shield.posture.adoptRetained": {
      const response = adoptRetainedProjection();
      retainedAdoptionResponses.push(structuredClone(response));
      return replyTo(frame, response);
    }
    case "shield.posture.set": {
      const posture = updateProjection(frame.payload);
      return replyTo(frame, { status: "ok", posture });
    }
    case "shield.posture.clear": {
      const reason = frame.payload && typeof frame.payload === "object"
        ? (frame.payload as { reason?: ShieldPostureClearReason }).reason
        : undefined;
      const posture = reason
        ? recordTerminalBoundary(reason, "content-request")
        : clearProjection(frame.payload);
      return replyTo(frame, { status: "ok", posture });
    }
    case "consent.suppression.register":
      return replyTo(frame, { status: "ok" });
    case "lock.action":
      return replyTo(frame, { status: "ok" });
    default:
      return replyTo(frame, { status: "ok" });
  }
}

const runtimeStub = {
  getURL(relativePath: string): string {
    return new URL(`/extension-assets/${relativePath}`, location.origin).href;
  },
  sendMessage(message: unknown): Promise<unknown> {
    return sendBackgroundMessage(message);
  },
  onMessage: {
    addListener(listener: RuntimeListener): void {
      runtimeListeners.add(listener);
    },
    removeListener(listener: RuntimeListener): void {
      runtimeListeners.delete(listener);
    },
  },
};

const chromeStub = {
  runtime: runtimeStub,
};
(globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = chromeStub as unknown as typeof chrome;

try {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(value: string): Promise<void> {
        clipboardWrites.push(value);
      },
    },
  });
} catch {
  // Chromium may expose a non-configurable clipboard. The gate also observes the
  // extension toast, so a denied write cannot hide a routing failure.
}

async function dispatch(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  nextCommandSequence += 1;
  const pageBound = name === "activateContentMain" ||
    name === "captureSubmissionSnapshot" ||
    name === "resetContentMain" ||
    name === "enterSilentContentMain" ||
    name === "applySilentSelectors";
  const routedPayload = pageBound && typeof payload.pageUrl !== "string"
    ? { ...payload, pageUrl: location.href }
    : payload;
  const frame: BusFrame = {
    kind: "uf-bus/1",
    frameType: "request",
    id: `p15-command-${nextCommandSequence}`,
    seq: nextCommandSequence,
    name: "command.dispatch",
    source: "popup",
    sourceInstance: "popup:p15-gate",
    target: "content",
    payload: {
      kind: "uf-command/1",
      name,
      tabId: TAB_ID,
      payload: routedPayload,
    },
  };
  for (const listener of runtimeListeners) {
    const response = await new Promise<unknown>((resolve, reject) => {
      let settled = false;
      // Marking activation joins the complete reveal/freeze ritual. P15 has
      // separate behavioral assertions for that ritual and no latency budget;
      // its transport must not abort the real command at the generic 5 s IPC
      // backstop before the fixture can observe the page-world lifecycle.
      const commandTimeoutMs = name === "activateContentMain" ? 30_000 : 5_000;
      const timer = setTimeout(() => {
        if (!settled) reject(new Error(`Timed out dispatching content command ${name}`));
      }, commandTimeoutMs);
      const sendResponse = (value: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const handled = listener(frame, {
        tab: { id: TAB_ID },
        frameId: 0,
        documentId: DOCUMENT_ID,
      }, sendResponse);
      if (handled !== true && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(undefined);
      }
    });
    if (response && typeof response === "object" && (response as BusFrame).frameType === "reply") {
      const reply = response as BusFrame;
      if (reply.ok !== true) {
        throw new Error(`Content bus rejected ${name}: ${JSON.stringify(reply.failure)}`);
      }
      return reply.payload;
    }
  }
  throw new Error(`No content listener handled ${name}`);
}

function queueSignals(
  inputs: Array<Readonly<{ name: BrainSignalName; payload?: Record<string, unknown> }>>,
): BrainSignal[] {
  const created = inputs.map((input) => {
    nextSignalSequence += 1;
    return {
      kind: "uf-signal/1" as const,
      tabId: TAB_ID,
      seq: nextSignalSequence,
      name: input.name,
      source: "brain" as const,
      cause: "p15-browser-gate",
      at: Date.now(),
      payload: input.payload ?? {},
    };
  });
  queuedSignals.push(...created);
  return created;
}

function backgroundSnapshot(): Record<string, unknown> {
  return {
    durable: currentProjection(),
    frameNames: backgroundFrames.map((frame) => frame.name),
    postureSets: backgroundFrames.filter((frame) => frame.name === "shield.posture.set").map((frame) => frame.payload),
    postureClears: backgroundFrames.filter((frame) => frame.name === "shield.posture.clear").map((frame) => frame.payload),
    retainedAdoptionRequests: backgroundFrames.filter((frame) => frame.name === "shield.posture.adoptRetained").length,
    retainedAdoptionResponses: structuredClone(retainedAdoptionResponses),
    pageContextRequests: backgroundFrames.filter((frame) => frame.name === "page.context").length,
    lockActions: backgroundFrames.filter((frame) => frame.name === "lock.action").map((frame) => frame.payload),
    terminalBoundaries: structuredClone(terminalBoundaries),
    pageContextMode,
    pageContextDeferred,
    pendingPageContextRequests: pendingPageContextRequests.length,
    pageContextResponses: structuredClone(pageContextResponses),
    backgroundCommands: structuredClone(backgroundCommands),
    clipboardWrites: [...clipboardWrites],
  };
}

function fixtureSnapshot(): Record<string, unknown> {
  return {
    ...(fixtureWindow.__p15Fixture?.snapshot() ?? {}),
    clipboardWrites: [...clipboardWrites],
  };
}

async function dispatchPagehide(): Promise<Record<string, unknown>> {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    shieldPresent: Boolean(document.querySelector('[data-uf-interaction-shield="true"]')),
    durable: currentProjection(),
  };
}

async function dispatchUnload(): Promise<Record<string, unknown>> {
  window.dispatchEvent(new Event("unload"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    shieldPresent: Boolean(document.querySelector('[data-uf-interaction-shield="true"]')),
    durable: currentProjection(),
  };
}

async function invalidate(): Promise<Record<string, unknown>> {
  invalidationCallback?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    shieldPresent: Boolean(document.querySelector('[data-uf-interaction-shield="true"]')),
    durable: currentProjection(),
  };
}

fixtureWindow.__p15Runtime = {
  documentId: DOCUMENT_ID,
  readyState: () => readyState,
  readyError: () => readyError,
  dispatch,
  queueSignals,
  resetDurablePosture(): void {
    localStorage.removeItem(DURABLE_KEY);
    localStorage.removeItem(PAGE_CONTEXT_MODE_KEY);
    localStorage.removeItem(PAGE_CONTEXT_DEFER_KEY);
    pageContextMode = "managed";
    pageContextDeferred = false;
  },
  backgroundSnapshot,
  fixtureSnapshot,
  dispatchPagehide,
  dispatchUnload,
  invalidate,
  setPageContextMode(mode): void {
    pageContextMode = mode;
    if (mode === "transient-retained") {
      localStorage.setItem(PAGE_CONTEXT_MODE_KEY, mode);
    } else {
      localStorage.removeItem(PAGE_CONTEXT_MODE_KEY);
    }
  },
  setPageContextDeferred(deferred): void {
    pageContextDeferred = deferred;
    if (deferred) {
      localStorage.setItem(PAGE_CONTEXT_DEFER_KEY, "true");
    } else {
      localStorage.removeItem(PAGE_CONTEXT_DEFER_KEY);
    }
  },
  releasePageContext,
  simulateBackgroundTerminal(reason): Record<string, unknown> {
    return {
      reason,
      posture: recordTerminalBoundary(reason, "background-boundary-simulation"),
    };
  },
  dispatchBackgroundCommand(name, payload): Record<string, unknown> {
    const command = { name, payload: structuredClone(payload) };
    backgroundCommands.push(command);
    if (name === "session.unregister") {
      return {
        status: "ok",
        command,
        posture: recordTerminalBoundary("unregister", "background-boundary-simulation"),
      };
    }
    return { status: "unavailable", command };
  },
};

void import("../../../src/entrypoints/content-loader.content").then((module) => {
  module.default.main({
    onInvalidated(callback: () => void): void {
      invalidationCallback = callback;
    },
  });
  readyState = "ready";
}).catch((error: unknown) => {
  readyState = "failed";
  readyError = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[P15 gate] Unable to start content entrypoint", error);
});
