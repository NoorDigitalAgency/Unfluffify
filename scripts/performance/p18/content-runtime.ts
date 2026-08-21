import type { BrainSignal } from "../../../src/domain/schema/signals";
import type { BusFrame } from "../../../src/messaging/contract";
import { TOAST_DURATION_MS } from "../../../src/ui/toast-controller";

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

type P18Fixture = Readonly<{
  realm: "popup" | "content";
  variant: "production" | "debug";
}>;

type PageState = {
  clicks: number;
  contextMenus: number;
  pageWorldCommands: number;
};

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

declare global {
  interface Window {
    __p18Fixture: P18Fixture;
    __p18PageState: PageState;
    __p18ContentRuntime: ReturnType<typeof createRuntimeApi>;
  }
}

const TAB_ID = 18;
const DOCUMENT_ID = `p18-document-${crypto.randomUUID()}`;
const runtimeListeners = new Set<RuntimeListener>();
const backgroundFrames: BusFrame[] = [];
const queuedSignals: BrainSignal[] = [];
let nextCommandSequence = 0;
let nextSignalSequence = 0;
let readyState: "booting" | "ready" | "error" = "booting";
let readyError = "";
let invalidationCallback: (() => void) | null = null;
let shieldRevision = 0;
let shieldProjection: ShieldProjection = { status: "inactive", revision: 0 };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function replyTo(frame: BusFrame, payload: unknown): BusFrame {
  return {
    kind: "uf-bus/1",
    frameType: "reply",
    id: frame.id,
    seq: frame.seq,
    name: frame.name,
    source: frame.target === "broadcast" ? frame.source : frame.target,
    sourceInstance: "background:p18-gate",
    target: frame.source,
    payload,
    ok: true,
  };
}

function pageContextResponse(): Record<string, unknown> {
  const pageKey = location.pathname || "/";
  return {
    status: "managed_candidate",
    generation: 1,
    observedUrl: location.href,
    draftDisposition: "preserve",
    environmentKey: "p18.test",
    siteId: 18,
    baseUrl: location.origin,
    pageKey,
    pageTypes: [{
      pageType: "detail",
      pages: [{ pageKey, wordsCount: 180 }],
    }],
    membershipFingerprint: "p18-membership",
    assignmentFingerprint: "p18-assignment",
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
        candidates: [{ pageKey, wordsCount: 180, marked: true, current: true }],
      }],
    },
    shieldPosture: shieldProjection,
  };
}

function currentScope(): ShieldScope {
  return {
    environmentKey: "p18.test",
    siteId: 18,
    baseUrl: location.origin,
    contextGeneration: 1,
    pageUrl: location.href,
    documentKey: DOCUMENT_ID,
  };
}

function updateShieldProjection(frame: BusFrame): ShieldProjection {
  shieldRevision += 1;
  const posture = frame.payload && typeof frame.payload === "object"
    ? (frame.payload as { posture?: Record<string, unknown> }).posture ?? {}
    : {};
  const priorSilentSelectors = shieldProjection.status === "active"
    ? shieldProjection.directive.silentSelectors
    : undefined;
  let directive: ShieldDirective;
  if (posture.kind === "silent-selectors") {
    directive = {
      silentSelectors: posture.selectors as SelectorSet,
      organ: { state: "silent" },
    };
  } else if (posture.kind === "preview") {
    directive = {
      ...(priorSilentSelectors ? { silentSelectors: priorSilentSelectors } : {}),
      organ: {
        state: "preview",
        origin: posture.origin === "silent" ? "silent" : "post_ai",
        ...(posture.selectors ? { selectors: posture.selectors as SelectorSet } : {}),
      },
    };
  } else {
    directive = {
      ...(priorSilentSelectors ? { silentSelectors: priorSilentSelectors } : {}),
      organ: {
        state: "blocked-organ",
        organState: typeof posture.organState === "string" ? posture.organState : "running",
        blockedReason: typeof posture.blockedReason === "string" ? posture.blockedReason : "blocked",
        ...(posture.selectors ? { selectors: posture.selectors as SelectorSet } : {}),
      },
    };
  }
  shieldProjection = {
    status: "active",
    revision: shieldRevision,
    scope: currentScope(),
    directive,
  };
  return shieldProjection;
}

async function sendBackgroundMessage(message: unknown): Promise<unknown> {
  if (!message || typeof message !== "object") return undefined;
  const frame = message as BusFrame;
  if (frame.kind !== "uf-bus/1") return undefined;
  backgroundFrames.push(clone(frame));
  if (frame.frameType === "event") return undefined;
  switch (frame.name) {
    case "page.context":
      return replyTo(frame, pageContextResponse());
    case "signals.pull": {
      const afterSeq = frame.payload && typeof frame.payload === "object"
        ? Number((frame.payload as { afterSeq?: unknown }).afterSeq ?? 0)
        : 0;
      return replyTo(frame, queuedSignals.filter((signal) => signal.seq > afterSeq));
    }
    case "signals.consume":
      return replyTo(frame, { ok: true });
    case "shield.posture.current":
      return replyTo(frame, { ...shieldProjection, scope: currentScope() });
    case "shield.posture.adoptRetained":
      return replyTo(frame, { status: "unavailable", reason: "no-retained-silent-posture" });
    case "shield.posture.set":
      return replyTo(frame, { status: "ok", posture: updateShieldProjection(frame) });
    case "shield.posture.clear":
      shieldRevision += 1;
      shieldProjection = { status: "inactive", revision: shieldRevision, scope: currentScope() };
      return replyTo(frame, { status: "ok", posture: shieldProjection });
    case "renderInspection.adopt":
      return replyTo(frame, { status: "inactive" });
    case "consent.suppression.register":
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

(globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
  runtime: runtimeStub,
} as unknown as typeof chrome;

async function dispatch(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  nextCommandSequence += 1;
  const pageBound = [
    "activateContentMain",
    "captureSubmissionSnapshot",
    "resetContentMain",
  ].includes(name);
  const routedPayload = pageBound && typeof payload.pageUrl !== "string"
    ? { ...payload, pageUrl: location.href }
    : payload;
  const frame: BusFrame = {
    kind: "uf-bus/1",
    frameType: "request",
    id: `p18-command-${nextCommandSequence}`,
    seq: nextCommandSequence,
    name: "command.dispatch",
    source: "popup",
    sourceInstance: "popup:p18-gate",
    target: "content",
    payload: {
      kind: "uf-command/1",
      name,
      tabId: TAB_ID,
      payload: routedPayload,
    },
  };
  for (const listener of runtimeListeners) {
    const response = await new Promise<unknown>((resolvePromise, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) reject(new Error(`Timed out dispatching P18 content command ${name}`));
      }, 5_000);
      const sendResponse = (value: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise(value);
      };
      const handled = listener(frame, {
        tab: { id: TAB_ID },
        frameId: 0,
        documentId: DOCUMENT_ID,
      }, sendResponse);
      if (handled !== true && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise(undefined);
      }
    });
    if (response && typeof response === "object" && (response as BusFrame).frameType === "reply") {
      const reply = response as BusFrame;
      if (reply.ok !== true) {
        throw new Error(`P18 content bus rejected ${name}: ${JSON.stringify(reply.failure)}`);
      }
      return reply.payload;
    }
  }
  throw new Error(`No content listener handled ${name}`);
}

function queueSignal(name: BrainSignal["name"], payload: Record<string, unknown> = {}): BrainSignal {
  nextSignalSequence += 1;
  const signal = {
    kind: "uf-signal/1" as const,
    tabId: TAB_ID,
    seq: nextSignalSequence,
    name,
    source: "brain" as const,
    cause: "p18-browser-gate",
    at: Date.now(),
    payload,
  } as BrainSignal;
  queuedSignals.push(signal);
  return signal;
}

function menuSnapshot(): Record<string, unknown> | null {
  const menu = document.querySelector<HTMLElement>('[data-uf-marking-menu="true"]');
  if (!menu) return null;
  const rect = menu.getBoundingClientRect();
  return {
    role: menu.getAttribute("role"),
    text: menu.innerText.replace(/\s+/g, " ").trim(),
    connected: menu.isConnected,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    actions: [...menu.querySelectorAll<HTMLButtonElement>("[data-uf-marking-menu-action]")].map((button) => ({
      id: button.getAttribute("data-uf-marking-menu-action"),
      label: button.innerText,
      disabled: button.disabled,
    })),
  };
}

function toastSnapshot(): Record<string, unknown> | null {
  const toast = document.querySelector<HTMLElement>('[data-uf-content-toast="true"]');
  if (!toast) return null;
  const copy = toast.querySelector<HTMLElement>('[data-uf-content-toast-copy="true"]');
  const close = toast.querySelector<HTMLButtonElement>('[data-uf-content-toast-close="true"]');
  return {
    count: document.querySelectorAll('[data-uf-content-toast="true"]').length,
    id: toast.getAttribute("data-uf-content-toast-id"),
    tone: toast.getAttribute("data-uf-content-toast-tone"),
    message: copy?.innerText.replace(/\s+/g, " ").trim() ?? "",
    role: toast.getAttribute("role"),
    live: toast.getAttribute("aria-live"),
    closeLabel: close?.getAttribute("aria-label") ?? null,
    closeTitle: close?.title ?? null,
  };
}

function createRuntimeApi() {
  return {
    readyState: () => readyState,
    readyError: () => readyError,
    dispatch,
    queueSignal,
    menuSnapshot,
    async snapshot(): Promise<Record<string, unknown>> {
      let status: unknown = null;
      try {
        status = await dispatch("getContentMainStatus");
      } catch {
        // A boot snapshot may precede command-router registration.
      }
      return {
        status,
        menu: menuSnapshot(),
        toast: toastSnapshot(),
        pageState: clone(window.__p18PageState),
        backgroundFrameNames: backgroundFrames.map((frame) => frame.name),
        reportedFacts: clone(backgroundFrames.filter((frame) => frame.name === "fact.reported")),
        markingMenuCount: document.querySelectorAll('[data-uf-marking-menu="true"]').length,
        rootClassName: document.documentElement.className,
      };
    },
    async activateMarking(): Promise<Record<string, unknown>> {
      const lockPayload = {
        baseUrl: location.origin,
        configPresent: true,
        lockRole: "editor",
        canEdit: true,
        blockedReason: "editor",
        banner: { visible: false, reason: "editor" },
      };
      const lock = await dispatch("lock.state.changed", lockPayload);
      const activation = await dispatch("activateContentMain", {
        baseUrl: location.origin,
        pageUrl: location.href,
        realEditorActivation: true,
        selectors: { inclusionSelectors: [], exclusionSelectors: [] },
      });
      const signal = queueSignal("marking.enabled", { pageUrl: location.href });
      // The real lock command reports a fact and immediately pulls background
      // decisions, so this second authority edge consumes the real brain signal
      // through the shipping content organ instead of mutating its state here.
      const settledLock = await dispatch("lock.state.changed", lockPayload);
      return { lock, activation, signal, settledLock };
    },
    invalidate(): void {
      invalidationCallback?.();
    },
    toastDurations: () => ({ ...TOAST_DURATION_MS }),
  };
}

window.__p18ContentRuntime = createRuntimeApi();

void import("../../../src/entrypoints/content-loader.content").then((module) => {
  module.default.main({
    onInvalidated(callback: () => void): void {
      invalidationCallback = callback;
    },
  });
  readyState = "ready";
}).catch((error: unknown) => {
  readyState = "error";
  readyError = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[P18 content gate] Unable to initialize", error);
});
