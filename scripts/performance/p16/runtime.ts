import type { BusFrame } from "../../../src/messaging/contract";
import type {
  RenderInspectionMutationResponse,
  RenderInspectionSession,
  RenderInspectionStartResponse,
} from "../../../src/messaging/render-inspection";
import { createRenderInspectionRuntime } from "../../../src/background/render-inspection-runtime";
import type {
  RenderInspectionRecord,
  RenderInspectionRepo,
} from "../../../src/storage/repositories/render-inspection";

const TAB_ID = 76;
const RECORD_KEY = "p16-render-inspection-record";
const EVENTS_KEY = "p16-render-inspection-events";
const HOLD_ACK_KEY = "p16-hold-paint-ack";
const DEFER_CONTEXT_KEY = "p16-defer-page-context";
const DOCUMENT_ID = `p16-document-${crypto.randomUUID()}`;

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

type GateEvent = Readonly<{
  name: string;
  documentId: string;
  at: number;
  detail?: unknown;
}>;

type PendingAck = Readonly<{
  frame: BusFrame;
  request: Readonly<{
    token: string;
    generation: number;
    pageUrl: string;
    documentNonce: string;
  }>;
  resolve(reply: BusFrame): void;
}>;

type FixtureWindow = Window & typeof globalThis & {
  __p16Fixture?: Readonly<{ snapshot(): Record<string, unknown> }> & Record<string, unknown>;
  __p16Runtime?: P16GateRuntime;
};

type P16GateRuntime = Readonly<{
  documentId: string;
  readyState(): "booting" | "ready" | "failed";
  readyError(): string;
  reset(): Promise<void>;
  setPageContextDeferred(deferred: boolean): void;
  setPaintAcknowledgementHeld(held: boolean): void;
  releasePageContext(): Record<string, unknown>;
  startInspection(javascriptEnabled: boolean): Promise<unknown>;
  closePanelProjection(): Record<string, unknown>;
  restartWorker(): Promise<Record<string, unknown>>;
  sendStaleAcknowledgement(): Promise<unknown>;
  releaseMatchingAcknowledgement(): Promise<Record<string, unknown>>;
  runTerminalMatrix(): Promise<Record<string, unknown>>;
  snapshot(): Record<string, unknown>;
}>;

const fixtureWindow = window as FixtureWindow;
const runtimeListeners = new Set<RuntimeListener>();
const backgroundFrames: BusFrame[] = [];
const pendingAcks: PendingAck[] = [];
const pendingPageContexts: Array<Readonly<{ frame: BusFrame; resolve(reply: BusFrame): void }>> = [];
const driverEvents: Array<Record<string, unknown>> = [];
let background: ReturnType<typeof createRenderInspectionRuntime>;
let gateNow = Date.now();
let reloadMode: "auto" | "manual" = "auto";
let readyState: "booting" | "ready" | "failed" = "booting";
let readyError = "";
let invalidationCallback: (() => void) | null = null;
let workerRestarts = 0;
let pageContextResponses = 0;

function readRecord(): RenderInspectionRecord | null {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    return raw ? JSON.parse(raw) as RenderInspectionRecord : null;
  } catch {
    return null;
  }
}

function readEvents(): GateEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    return raw ? JSON.parse(raw) as GateEvent[] : [];
  } catch {
    return [];
  }
}

function appendEvent(name: string, detail?: unknown): void {
  const events = readEvents();
  events.push({ name, documentId: DOCUMENT_ID, at: Date.now(), ...(detail === undefined ? {} : { detail }) });
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

const repo: RenderInspectionRepo = {
  async load(tabId) {
    const record = readRecord();
    return { ok: true, value: record?.tabId === tabId ? record : null };
  },
  async list() {
    const record = readRecord();
    return { ok: true, value: record ? [record] : [] };
  },
  async listTabIds() {
    const record = readRecord();
    return record ? [record.tabId] : [];
  },
  async save(record) {
    localStorage.setItem(RECORD_KEY, JSON.stringify(structuredClone(record)));
    appendEvent("record-saved", {
      token: record.token,
      generation: record.generation,
      phase: record.phase,
      terminalReason: record.terminalReason,
      documentId: record.documentId,
      documentNonce: record.documentNonce,
    });
  },
  async clear(tabId) {
    if (readRecord()?.tabId === tabId) localStorage.removeItem(RECORD_KEY);
    appendEvent("record-cleared", { tabId });
  },
};

function createBackgroundRuntime() {
  return createRenderInspectionRuntime({
    repo,
    now: () => gateNow,
    timeoutMs: 5_000,
    tokenFactory: () => `p16-token-${crypto.randomUUID()}`,
    driver: {
      async setJavascriptEnabled(tabId, enabled) {
        driverEvents.push({ name: "javascript", tabId, enabled, at: gateNow });
        appendEvent("javascript-posture", { tabId, enabled });
      },
      reload(tabId) {
        driverEvents.push({ name: "reload", tabId, mode: reloadMode, at: gateNow });
        appendEvent("reload-requested", { tabId, mode: reloadMode });
        if (reloadMode === "auto") {
          // Leave enough time for the start reply to cross the simulated
          // popup/background boundary before the source document disappears.
          setTimeout(() => location.reload(), 25);
        }
      },
    },
    createAlarm(name, info) {
      driverEvents.push({ name: "alarm-created", alarm: name, when: info.when });
    },
    clearAlarm(name) {
      driverEvents.push({ name: "alarm-cleared", alarm: name });
    },
  });
}

function replyTo(frame: BusFrame, payload: unknown): BusFrame {
  return {
    kind: "uf-bus/1",
    frameType: "reply",
    id: frame.id,
    seq: frame.seq,
    name: frame.name,
    source: "background",
    sourceInstance: "background:p16-gate",
    target: frame.source,
    payload,
    ok: true,
  };
}

function managedPageContext() {
  pageContextResponses += 1;
  const pageKey = location.pathname || "/";
  return {
    status: "managed_candidate",
    generation: 1,
    observedUrl: location.href,
    draftDisposition: "preserve",
    environmentKey: "p16.test",
    siteId: 16,
    baseUrl: location.origin,
    pageKey,
    pageTypes: [{
      pageType: "detail",
      pages: [{ pageKey, wordsCount: 100 }],
    }],
    membershipFingerprint: "p16-membership",
    assignmentFingerprint: "p16-assignment",
    conflicts: [],
    upstreamCode: null,
    consentSuppressionAllowed: true,
    renderModeSet: true,
    todo: {
      covered: 1,
      actionable: 1,
      pageTypes: [{
        pageType: "detail",
        markedCount: 1,
        current: true,
        candidates: [{ pageKey, wordsCount: 100, marked: true, current: true }],
      }],
    },
    shieldPosture: { status: "inactive", revision: 0 },
  };
}

function releasePageContext(): Record<string, unknown> {
  localStorage.removeItem(DEFER_CONTEXT_KEY);
  const pending = pendingPageContexts.splice(0);
  for (const request of pending) request.resolve(replyTo(request.frame, managedPageContext()));
  return { released: pending.length, responses: pageContextResponses, pending: pendingPageContexts.length };
}

async function sendBackgroundMessage(message: unknown): Promise<unknown> {
  if (!message || typeof message !== "object") return undefined;
  const frame = message as BusFrame;
  if (frame.kind !== "uf-bus/1") return undefined;
  backgroundFrames.push(structuredClone(frame));
  appendEvent("background-frame", { name: frame.name, frameType: frame.frameType });
  if (frame.frameType === "event") return undefined;

  switch (frame.name) {
    case "renderInspection.adopt": {
      const payload = frame.payload as Readonly<{ pageUrl: string; documentNonce: string }>;
      const response = await background.adopt({
        tabId: TAB_ID,
        documentId: DOCUMENT_ID,
        pageUrl: payload.pageUrl,
        documentNonce: payload.documentNonce,
      });
      return replyTo(frame, response);
    }
    case "renderInspection.ackPaint": {
      const request = frame.payload as PendingAck["request"];
      if (localStorage.getItem(HOLD_ACK_KEY) === "true") {
        appendEvent("paint-ack-held", request);
        return new Promise<BusFrame>((resolve) => pendingAcks.push({
          frame: structuredClone(frame),
          request: structuredClone(request),
          resolve,
        }));
      }
      return replyTo(frame, await background.acknowledgePaint({
        ...request,
        tabId: TAB_ID,
        documentId: DOCUMENT_ID,
      }));
    }
    case "renderInspection.fail": {
      const request = frame.payload as PendingAck["request"] & Readonly<{ reason: string }>;
      return replyTo(frame, await background.fail({ ...request, tabId: TAB_ID, documentId: DOCUMENT_ID }));
    }
    case "page.context": {
      if (localStorage.getItem(DEFER_CONTEXT_KEY) === "true") {
        appendEvent("page-context-held");
        return new Promise<BusFrame>((resolve) => pendingPageContexts.push({ frame: structuredClone(frame), resolve }));
      }
      return replyTo(frame, managedPageContext());
    }
    case "shield.posture.adoptRetained":
      return replyTo(frame, { status: "unavailable", reason: "p16-no-retained-shield" });
    case "shield.posture.current":
      return replyTo(frame, { status: "inactive", revision: 0 });
    case "signals.pull":
      return replyTo(frame, []);
    case "signals.consume":
      return replyTo(frame, { ok: true });
    case "consent.suppression.register":
      return replyTo(frame, { status: "ok" });
    default:
      return replyTo(frame, { status: "ok" });
  }
}

const runtimeStub = {
  id: "p16-render-inspection-gate",
  lastError: undefined,
  getURL(relativePath: string): string {
    return new URL(`/extension-assets/${relativePath}`, location.origin).href;
  },
  sendMessage(message: unknown): Promise<unknown> {
    return sendBackgroundMessage(message);
  },
  onMessage: {
    addListener(listener: RuntimeListener): void { runtimeListeners.add(listener); },
    removeListener(listener: RuntimeListener): void { runtimeListeners.delete(listener); },
  },
};

(globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
  runtime: runtimeStub,
} as unknown as typeof chrome;

function inspectionSnapshot(): Record<string, unknown> {
  const record = readRecord();
  const curtain = document.querySelector<HTMLElement>('[data-uf-render-inspection-curtain="true"]');
  const frameNames = backgroundFrames.map((frame) => frame.name);
  return {
    documentId: DOCUMENT_ID,
    record,
    curtain: curtain ? {
      connected: curtain.isConnected,
      token: curtain.getAttribute("data-uf-inspection-token"),
      generation: curtain.getAttribute("data-uf-inspection-generation"),
      documentNonce: curtain.getAttribute("data-uf-document-nonce"),
      mode: curtain.getAttribute("data-uf-inspection-mode"),
      extensionUi: curtain.getAttribute("data-uf-extension-ui"),
      rect: (() => {
        const rect = curtain.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })(),
    } : null,
    frameNames,
    adoptIndex: frameNames.indexOf("renderInspection.adopt"),
    pageContextIndex: frameNames.indexOf("page.context"),
    pendingAcks: pendingAcks.length,
    pendingPageContexts: pendingPageContexts.length,
    pageContextResponses,
    workerRestarts,
    driverEvents: structuredClone(driverEvents),
    durableEvents: readEvents(),
    legacyInspectionFacts: backgroundFrames
      .filter((frame) => frame.name === "fact.reported")
      .filter((frame) => JSON.stringify(frame.payload).includes("inspectionPending"))
      .length,
    fixture: fixtureWindow.__p16Fixture?.snapshot?.() ?? null,
  };
}

async function startInspection(javascriptEnabled: boolean): Promise<RenderInspectionStartResponse> {
  appendEvent("operator-start", { javascriptEnabled, documentId: DOCUMENT_ID });
  const response = await background.start({
    tabId: TAB_ID,
    property: {
      environmentKey: "p16.test",
      siteId: 16,
      baseUrl: location.origin,
    },
    pageUrl: location.href,
    javascriptEnabled,
    sourceDocumentId: DOCUMENT_ID,
  });
  appendEvent("panel-observed-start", response);
  return response;
}

async function restartWorker(): Promise<Record<string, unknown>> {
  workerRestarts += 1;
  appendEvent("worker-restarted", { workerRestarts });
  background = createBackgroundRuntime();
  await background.initialize();
  return inspectionSnapshot();
}

async function releaseMatchingAcknowledgement(): Promise<Record<string, unknown>> {
  localStorage.removeItem(HOLD_ACK_KEY);
  const pending = pendingAcks.splice(0);
  const responses: RenderInspectionMutationResponse[] = [];
  for (const request of pending) {
    const response = await background.acknowledgePaint({
      ...request.request,
      tabId: TAB_ID,
      documentId: DOCUMENT_ID,
    });
    responses.push(response);
    request.resolve(replyTo(request.frame, response));
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { released: pending.length, responses, snapshot: inspectionSnapshot() };
}

async function terminalSession(): Promise<RenderInspectionSession | null> {
  const response = await background.current(TAB_ID);
  return response.status === "inactive" ? null : response.session;
}

async function runTerminalMatrix(): Promise<Record<string, unknown>> {
  reloadMode = "manual";
  localStorage.removeItem(HOLD_ACK_KEY);
  const outcomes: Array<Record<string, unknown>> = [];
  const generations: number[] = [];
  const begin = async (javascriptEnabled = false) => {
    const response = await startInspection(javascriptEnabled);
    if (response.status !== "started") throw new Error(`P16 matrix start failed: ${JSON.stringify(response)}`);
    generations.push(response.session.generation);
    return response.session;
  };

  const cancellation = await begin(false);
  const cancelResponse = await background.cancel({
    tabId: TAB_ID,
    token: cancellation.token,
    generation: cancellation.generation,
  });
  outcomes.push({ path: "cancel", response: cancelResponse, terminal: await terminalSession() });

  const failure = await begin(false);
  const failureDocumentId = `p16-matrix-failure-${failure.generation}`;
  const failureNonce = `p16-matrix-nonce-${failure.generation}`;
  await background.navigationCommitted({ tabId: TAB_ID, documentId: failureDocumentId, pageUrl: location.href });
  await background.adopt({
    tabId: TAB_ID,
    documentId: failureDocumentId,
    pageUrl: location.href,
    documentNonce: failureNonce,
  });
  const failResponse = await background.fail({
    tabId: TAB_ID,
    documentId: failureDocumentId,
    pageUrl: location.href,
    documentNonce: failureNonce,
    token: failure.token,
    generation: failure.generation,
    reason: "p16-browser-matrix",
  });
  outcomes.push({ path: "failure", response: failResponse, terminal: await terminalSession() });

  const navigation = await begin(false);
  await background.navigationCommitted({
    tabId: TAB_ID,
    documentId: `p16-matrix-navigation-${navigation.generation}`,
    pageUrl: `${location.origin}/unexpected`,
  });
  outcomes.push({ path: "navigation", terminal: await terminalSession() });

  const timeout = await begin(false);
  gateNow = timeout.deadlineAt + 1;
  await background.sweepExpired();
  outcomes.push({ path: "timeout", terminal: await terminalSession() });

  await begin(false);
  await background.terminateTab(TAB_ID, "unregistered");
  outcomes.push({ path: "unregister", terminal: await terminalSession() });

  return { outcomes, generations, snapshot: inspectionSnapshot() };
}

async function bootstrap(): Promise<void> {
  background = createBackgroundRuntime();
  const retained = readRecord();
  if (
    retained?.phase === "awaiting_document" &&
    retained.documentId === null &&
    retained.sourceDocumentId !== DOCUMENT_ID
  ) {
    appendEvent("replacement-commit", { token: retained.token, generation: retained.generation });
    await background.navigationCommitted({
      tabId: TAB_ID,
      documentId: DOCUMENT_ID,
      pageUrl: location.href,
    });
  }
  await background.initialize();
  appendEvent("content-bootstrap-started");
  const contentModule = await import("../../../src/entrypoints/content-loader.content");
  const contentContext = {
    onInvalidated(callback: () => void): () => void {
      invalidationCallback = callback;
      return () => {
        if (invalidationCallback === callback) invalidationCallback = null;
      };
    },
  } as unknown as NonNullable<Parameters<typeof contentModule.default.main>[0]>;
  contentModule.default.main(contentContext);
  readyState = "ready";
}

fixtureWindow.__p16Runtime = {
  documentId: DOCUMENT_ID,
  readyState: () => readyState,
  readyError: () => readyError,
  async reset(): Promise<void> {
    invalidationCallback?.();
    localStorage.removeItem(RECORD_KEY);
    localStorage.removeItem(EVENTS_KEY);
    localStorage.removeItem(HOLD_ACK_KEY);
    localStorage.removeItem(DEFER_CONTEXT_KEY);
    backgroundFrames.length = 0;
    pendingAcks.length = 0;
    pendingPageContexts.length = 0;
    driverEvents.length = 0;
    pageContextResponses = 0;
    workerRestarts = 0;
    gateNow = Date.now();
    reloadMode = "auto";
  },
  setPageContextDeferred(deferred): void {
    if (deferred) localStorage.setItem(DEFER_CONTEXT_KEY, "true");
    else localStorage.removeItem(DEFER_CONTEXT_KEY);
  },
  setPaintAcknowledgementHeld(held): void {
    if (held) localStorage.setItem(HOLD_ACK_KEY, "true");
    else localStorage.removeItem(HOLD_ACK_KEY);
  },
  releasePageContext,
  startInspection,
  closePanelProjection(): Record<string, unknown> {
    appendEvent("panel-closed");
    return inspectionSnapshot();
  },
  restartWorker,
  async sendStaleAcknowledgement(): Promise<unknown> {
    const record = readRecord();
    if (!record?.documentNonce || !record.documentId) throw new Error("No adopted P16 session for stale ack");
    const response = await background.acknowledgePaint({
      tabId: TAB_ID,
      documentId: DOCUMENT_ID,
      pageUrl: location.href,
      documentNonce: record.documentNonce,
      token: `${record.token}-stale`,
      generation: record.generation,
    });
    appendEvent("stale-ack-result", response);
    return response;
  },
  releaseMatchingAcknowledgement,
  runTerminalMatrix,
  snapshot: inspectionSnapshot,
};

void bootstrap().catch((error: unknown) => {
  readyState = "failed";
  readyError = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[P16 gate] Unable to start durable inspection fixture", error);
});
