import type { RenderInspectionSession } from "../messaging/render-inspection";
import { INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE } from "./interaction-shield";

export const RENDER_INSPECTION_CURTAIN_ATTRIBUTE = "data-uf-render-inspection-curtain";
export const RENDER_INSPECTION_TOKEN_ATTRIBUTE = "data-uf-inspection-token";
export const RENDER_INSPECTION_GENERATION_ATTRIBUTE = "data-uf-inspection-generation";
export const RENDER_INSPECTION_DOCUMENT_NONCE_ATTRIBUTE = "data-uf-document-nonce";
export const RENDER_INSPECTION_MODE_ATTRIBUTE = "data-uf-inspection-mode";
export const RENDER_INSPECTION_EXTENSION_UI_ATTRIBUTE = "data-uf-extension-ui";

export type RenderInspectionIdentity = Readonly<{
  token: string;
  generation: number;
  documentNonce: string;
}>;

export type AdoptedRenderInspectionSession = RenderInspectionSession & Readonly<{
  phase: "adopted";
  documentId: string;
  documentNonce: string;
}>;

export type RenderInspectionCurtainStage =
  | "adopted"
  | "mounted"
  | "frame-one"
  | "frame-two"
  | "fallback"
  | "acknowledged"
  | "rejected";

type MutationObserverLike = Pick<MutationObserver, "disconnect" | "observe">;

export type RenderInspectionCurtainOptions = Readonly<{
  document: Document;
  window?: Window;
  createMutationObserver?: (callback: MutationCallback) => MutationObserverLike;
  /** The page realm can starve both requestAnimationFrame and timers while
   * Chrome is inspecting a JavaScript-disabled document. A caller may source
   * the one-second wake-up and guarded acknowledgement from an extension-owned
   * debugger realm. A legacy `ready` result may still invoke this callback so
   * the local guard remains independently testable. */
  schedulePaintFallback?: (
    session: AdoptedRenderInspectionSession,
    callback: VoidFunction,
    delayMs: number,
  ) => VoidFunction;
  onPaintReady: (session: AdoptedRenderInspectionSession) => void;
  onFailure?: (session: AdoptedRenderInspectionSession, reason: string) => void;
  onSurfaceChanged?: () => void;
  onLifecycleStage?: (
    session: AdoptedRenderInspectionSession,
    stage: RenderInspectionCurtainStage,
  ) => void;
  now?: () => number;
}>;

export type RenderInspectionCurtainController = Readonly<{
  adopt: (session: RenderInspectionSession) => boolean;
  clearMatching: (identity: RenderInspectionIdentity) => boolean;
  failOpenMatching: (identity: RenderInspectionIdentity) => boolean;
  terminate: () => void;
  refresh: () => void;
  current: () => AdoptedRenderInspectionSession | null;
  element: () => HTMLElement | null;
}>;

const CURTAIN_COPY = "Inspecting page... it will be ready soon";
const MAXIMUM_DOCUMENT_Z_INDEX = "2147483647";
const PAINT_STARVATION_FALLBACK_MS = 1_000;

function sameIdentity(
  session: AdoptedRenderInspectionSession | null,
  identity: RenderInspectionIdentity,
): boolean {
  return session !== null &&
    session.token === identity.token &&
    session.generation === identity.generation &&
    session.documentNonce === identity.documentNonce;
}

function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function removeAttribute(element: HTMLElement, name: string): void {
  if (element.hasAttribute(name)) {
    element.removeAttribute(name);
  }
}

function setImportantStyle(element: HTMLElement, property: string, value: string): void {
  if (
    element.style.getPropertyValue(property) !== value ||
    element.style.getPropertyPriority(property) !== "important"
  ) {
    element.style.setProperty(property, value, "important");
  }
}

/**
 * Owns the replacement-document inspection curtain independently from the
 * content organ and its replayable fact history. A session can only be removed
 * by its complete token/generation/document-nonce identity (or terminal
 * disposal), so a late acknowledgement can never tear down a newer curtain.
 */
export function createRenderInspectionCurtain(
  options: RenderInspectionCurtainOptions,
): RenderInspectionCurtainController {
  const document = options.document;
  const view = options.window ?? document.defaultView ?? undefined;
  const now = options.now ?? Date.now;
  let session: AdoptedRenderInspectionSession | null = null;
  let curtain: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let spinner: HTMLElement | null = null;
  let copy: HTMLElement | null = null;
  let observer: MutationObserverLike | null = null;
  let syncScheduled = false;
  let paintEpoch = 0;
  let paintScheduledFor = "";
  let failureReportedFor = "";
  let deadlineHandle: number | null = null;
  let cancelPaintFallback: VoidFunction | null = null;
  const reportedLifecycleStages = new Set<string>();
  let terminated = false;

  const identityKey = (candidate: AdoptedRenderInspectionSession): string =>
    `${candidate.token}\u0000${candidate.generation}\u0000${candidate.documentNonce}`;

  const nativeObserverFactory = (): RenderInspectionCurtainOptions["createMutationObserver"] => {
    const Observer = (view as (Window & { MutationObserver?: typeof MutationObserver }) | undefined)
      ?.MutationObserver ?? (typeof MutationObserver === "function" ? MutationObserver : undefined);
    return Observer ? (callback) => new Observer(callback) : undefined;
  };

  const requestFrame = (callback: FrameRequestCallback): boolean => {
    if (typeof view?.requestAnimationFrame !== "function") {
      return false;
    }
    view.requestAnimationFrame(callback);
    return true;
  };

  const reportLifecycleStage = (
    candidate: AdoptedRenderInspectionSession,
    stage: RenderInspectionCurtainStage,
  ): void => {
    const key = `${identityKey(candidate)}\u0000${stage}`;
    if (!sameIdentity(session, candidate) || reportedLifecycleStages.has(key)) {
      return;
    }
    reportedLifecycleStages.add(key);
    try {
      options.onLifecycleStage?.(candidate, stage);
    } catch {
      // Debug lifecycle reporting must never influence inspection authority.
    }
  };

  const clearDeadline = (): void => {
    if (deadlineHandle === null) {
      return;
    }
    if (view) {
      view.clearTimeout(deadlineHandle);
    } else {
      clearTimeout(deadlineHandle);
    }
    deadlineHandle = null;
  };

  const clearPaintFallback = (): void => {
    if (cancelPaintFallback === null) {
      return;
    }
    const cancel = cancelPaintFallback;
    cancelPaintFallback = null;
    cancel();
  };

  const reportFailure = (candidate: AdoptedRenderInspectionSession, reason: string): void => {
    const key = identityKey(candidate);
    if (!sameIdentity(session, candidate) || failureReportedFor === key) {
      return;
    }
    failureReportedFor = key;
    reportLifecycleStage(candidate, "rejected");
    try {
      options.onFailure?.(candidate, reason);
    } catch {
      // Failure reporting must not keep the page covered forever.
    }
  };

  const applyRootPresentation = (candidate: AdoptedRenderInspectionSession): void => {
    if (!curtain || !card || !spinner || !copy) {
      return;
    }
    setAttribute(curtain, RENDER_INSPECTION_CURTAIN_ATTRIBUTE, "true");
    setAttribute(curtain, RENDER_INSPECTION_EXTENSION_UI_ATTRIBUTE, "true");
    setAttribute(curtain, RENDER_INSPECTION_TOKEN_ATTRIBUTE, candidate.token);
    setAttribute(curtain, RENDER_INSPECTION_GENERATION_ATTRIBUTE, String(candidate.generation));
    setAttribute(curtain, RENDER_INSPECTION_DOCUMENT_NONCE_ATTRIBUTE, candidate.documentNonce);
    setAttribute(curtain, RENDER_INSPECTION_MODE_ATTRIBUTE, candidate.javascriptEnabled ? "rendered" : "static");
    setAttribute(curtain, INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE, "true");
    setAttribute(curtain, "role", "status");
    setAttribute(curtain, "aria-live", "assertive");
    setAttribute(curtain, "aria-label", CURTAIN_COPY);
    removeAttribute(curtain, "aria-hidden");
    removeAttribute(curtain, "tabindex");

    const rootStyles: Readonly<Record<string, string>> = {
      all: "initial",
      position: "fixed",
      inset: "0",
      display: "grid",
      "place-items": "center",
      width: "100vw",
      height: "100vh",
      margin: "0",
      padding: "0",
      border: "0",
      background: "rgba(16, 20, 28, 0.2)",
      color: "white",
      cursor: "progress",
      "pointer-events": "auto",
      "box-sizing": "border-box",
      isolation: "isolate",
      "z-index": MAXIMUM_DOCUMENT_Z_INDEX,
    };
    for (const [property, value] of Object.entries(rootStyles)) {
      setImportantStyle(curtain, property, value);
    }

    setAttribute(card, "data-uf-render-inspection-card", "true");
    const cardStyles: Readonly<Record<string, string>> = {
      all: "initial",
      display: "flex",
      "align-items": "center",
      gap: "10px",
      "max-width": "min(460px, calc(100vw - 32px))",
      padding: "14px 16px",
      border: "1px solid rgba(255, 255, 255, 0.24)",
      "border-radius": "12px",
      background: "rgba(22, 26, 34, 0.96)",
      color: "white",
      "box-shadow": "0 18px 44px rgba(0, 0, 0, 0.28)",
      "font-family": "Inter, system-ui, sans-serif",
      "font-size": "14px",
      "font-weight": "650",
      "line-height": "1.35",
      "pointer-events": "none",
      "box-sizing": "border-box",
    };
    for (const [property, value] of Object.entries(cardStyles)) {
      setImportantStyle(card, property, value);
    }

    setAttribute(spinner, "data-uf-render-inspection-spinner", "true");
    setAttribute(spinner, "aria-hidden", "true");
    for (const [property, value] of Object.entries({
      all: "initial",
      display: "block",
      width: "20px",
      height: "20px",
      "flex-shrink": "0",
      border: "2px solid rgba(255, 255, 255, 0.38)",
      "border-top-color": "white",
      "border-radius": "999px",
      "box-sizing": "border-box",
    })) {
      setImportantStyle(spinner, property, value);
    }

    setAttribute(copy, "data-uf-render-inspection-copy", "true");
    if (copy.textContent !== CURTAIN_COPY) {
      copy.textContent = CURTAIN_COPY;
    }
    if (spinner.parentElement !== card || copy.parentElement !== card || card.children.length !== 2) {
      card.replaceChildren(spinner, copy);
    }
    if (card.parentElement !== curtain || curtain.children.length !== 1) {
      curtain.replaceChildren(card);
    }
  };

  const createCurtain = (): void => {
    curtain = document.createElement("section");
    card = document.createElement("div");
    spinner = document.createElement("span");
    copy = document.createElement("span");
  };

  const observe = (): void => {
    if (!session) {
      return;
    }
    if (!observer) {
      const createObserver = options.createMutationObserver ?? nativeObserverFactory();
      observer = createObserver?.(() => scheduleSync()) ?? null;
    }
    observer?.disconnect();
    observer?.observe(document, { childList: true, subtree: true });
    if (curtain) {
      observer?.observe(curtain, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: [
          "style",
          RENDER_INSPECTION_CURTAIN_ATTRIBUTE,
          RENDER_INSPECTION_EXTENSION_UI_ATTRIBUTE,
          RENDER_INSPECTION_TOKEN_ATTRIBUTE,
          RENDER_INSPECTION_GENERATION_ATTRIBUTE,
          RENDER_INSPECTION_DOCUMENT_NONCE_ATTRIBUTE,
          RENDER_INSPECTION_MODE_ATTRIBUTE,
          INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE,
          "role",
          "aria-live",
          "aria-label",
          "aria-hidden",
          "tabindex",
        ],
      });
    }
  };

  const schedulePaintAcknowledgement = (): void => {
    if (!session || !curtain?.isConnected) {
      return;
    }
    const candidate = session;
    const key = identityKey(candidate);
    if (paintScheduledFor === key) {
      return;
    }
    paintScheduledFor = key;
    const epoch = ++paintEpoch;
    const stillCurrent = (): boolean =>
      !terminated && epoch === paintEpoch && sameIdentity(session, candidate) && curtain?.isConnected === true;
    const finish = (stage: "frame-two" | "fallback"): void => {
      if (!stillCurrent()) {
        return;
      }
      if (document.visibilityState !== "visible") {
        clearPaintFallback();
        paintEpoch += 1;
        paintScheduledFor = "";
        return;
      }
      if (!curtainHasVisibleViewportCoverage()) {
        clearPaintFallback();
        paintEpoch += 1;
        paintScheduledFor = "";
        scheduleSync();
        return;
      }
      reportLifecycleStage(candidate, stage);
      clearPaintFallback();
      paintEpoch += 1;
      reportLifecycleStage(candidate, "acknowledged");
      try {
        options.onPaintReady(candidate);
      } catch {
        paintScheduledFor = "";
        reportFailure(candidate, "paint-acknowledgement-callback-failed");
      }
    };
    const retryIfStillOwned = (): void => {
      if (!terminated && epoch === paintEpoch && sameIdentity(session, candidate)) {
        clearPaintFallback();
        paintEpoch += 1;
        paintScheduledFor = "";
        scheduleSync();
      }
    };
    const failed = (reason: string): void => {
      if (!sameIdentity(session, candidate)) {
        return;
      }
      clearPaintFallback();
      paintEpoch += 1;
      paintScheduledFor = "";
      reportFailure(candidate, reason);
    };
    const curtainHasVisibleViewportCoverage = (): boolean => {
      if (
        !view ||
        document.visibilityState !== "visible" ||
        !curtain ||
        !curtain.isConnected ||
        curtain.parentElement !== document.documentElement ||
        document.documentElement?.lastElementChild !== curtain
      ) {
        return false;
      }
      const style = view.getComputedStyle(curtain);
      const opacity = Number.parseFloat(style.opacity || "1");
      const rect = curtain.getBoundingClientRect();
      // Device metrics can expose an outer/visual viewport that is smaller
      // than `innerWidth`/`innerHeight` (Chrome reports this while an
      // extension-owned mobile emulation session is active). CSS viewport
      // units and fixed-position elements follow the visual viewport in that
      // posture, so comparing their rect against the larger inner dimensions
      // rejects a curtain that actually covers every visible pixel.
      const visualViewport = view.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportWidth = visualViewport?.width ?? view.innerWidth;
      const viewportHeight = visualViewport?.height ?? view.innerHeight;
      return style.position === "fixed" &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.pointerEvents !== "none" &&
        style.zIndex === MAXIMUM_DOCUMENT_Z_INDEX &&
        Number.isFinite(opacity) && opacity >= 0.999 &&
        rect.left <= viewportLeft && rect.top <= viewportTop &&
        rect.right >= viewportLeft + viewportWidth &&
        rect.bottom >= viewportTop + viewportHeight;
    };
    const onPaintStarvation = (): void => {
      cancelPaintFallback = null;
      if (!stillCurrent()) {
        return;
      }
      reportLifecycleStage(candidate, "fallback");
      if (document.visibilityState !== "visible") {
        paintEpoch += 1;
        paintScheduledFor = "";
        return;
      }
      if (curtainHasVisibleViewportCoverage()) {
        finish("fallback");
        return;
      }
      retryIfStillOwned();
    };
    if (options.schedulePaintFallback) {
      cancelPaintFallback = options.schedulePaintFallback(
        candidate,
        onPaintStarvation,
        PAINT_STARVATION_FALLBACK_MS,
      );
    } else {
      const handle = view
        ? view.setTimeout(onPaintStarvation, PAINT_STARVATION_FALLBACK_MS)
        : setTimeout(onPaintStarvation, PAINT_STARVATION_FALLBACK_MS) as unknown as number;
      cancelPaintFallback = () => {
        if (view) {
          view.clearTimeout(handle);
        } else {
          clearTimeout(handle);
        }
      };
    }
    try {
      if (!requestFrame(() => {
        if (!stillCurrent()) {
          retryIfStillOwned();
          return;
        }
        try {
          if (!requestFrame(() => {
            if (!stillCurrent()) {
              retryIfStillOwned();
              return;
            }
            finish("frame-two");
          })) {
            failed("request-animation-frame-unavailable");
          }
          reportLifecycleStage(candidate, "frame-one");
        } catch {
          failed("request-animation-frame-failed");
        }
      })) {
        failed("request-animation-frame-unavailable");
      }
    } catch {
      failed("request-animation-frame-failed");
    }
  };

  const ensureMounted = (): boolean => {
    if (!session || terminated || !document.documentElement) {
      observe();
      return false;
    }
    try {
      if (!curtain) {
        createCurtain();
      }
      applyRootPresentation(session);
      if (!curtain?.isConnected || curtain.parentElement !== document.documentElement) {
        document.documentElement.appendChild(curtain!);
        options.onSurfaceChanged?.();
      } else if (document.documentElement.lastElementChild !== curtain) {
        document.documentElement.appendChild(curtain);
        options.onSurfaceChanged?.();
      }
      observe();
      reportLifecycleStage(session, "mounted");
      schedulePaintAcknowledgement();
      return true;
    } catch {
      reportFailure(session, "curtain-mount-failed");
      return false;
    }
  };

  function scheduleSync(): void {
    if (syncScheduled || !session || terminated) {
      return;
    }
    syncScheduled = true;
    const enqueue = view?.queueMicrotask?.bind(view) ?? queueMicrotask;
    enqueue(() => {
      syncScheduled = false;
      ensureMounted();
    });
  }

  const removeRootReadyListeners = (): void => {
    document.removeEventListener("DOMContentLoaded", scheduleSync);
    document.removeEventListener("readystatechange", scheduleSync);
    document.removeEventListener("visibilitychange", scheduleSync);
  };

  const clearLocal = (): void => {
    paintEpoch += 1;
    paintScheduledFor = "";
    failureReportedFor = "";
    syncScheduled = false;
    clearDeadline();
    clearPaintFallback();
    reportedLifecycleStages.clear();
    observer?.disconnect();
    observer = null;
    removeRootReadyListeners();
    curtain?.remove();
    curtain = null;
    card = null;
    spinner = null;
    copy = null;
    session = null;
    options.onSurfaceChanged?.();
  };

  const adopt = (candidate: RenderInspectionSession): boolean => {
    if (
      terminated ||
      candidate.phase !== "adopted" ||
      !candidate.documentId ||
      !candidate.documentNonce
    ) {
      return false;
    }
    const adopted = candidate as AdoptedRenderInspectionSession;
    const same = sameIdentity(session, adopted);
    if (!same) {
      clearLocal();
      session = adopted;
      reportLifecycleStage(adopted, "adopted");
      document.addEventListener("DOMContentLoaded", scheduleSync);
      document.addEventListener("readystatechange", scheduleSync);
      document.addEventListener("visibilitychange", scheduleSync);
      const delay = Math.max(0, adopted.deadlineAt - now());
      const onDeadline = (): void => {
        deadlineHandle = null;
        if (!sameIdentity(session, adopted)) {
          return;
        }
        reportFailure(adopted, "paint-deadline-expired");
        clearLocal();
      };
      deadlineHandle = view
        ? view.setTimeout(onDeadline, delay)
        : setTimeout(onDeadline, delay) as unknown as number;
    }
    ensureMounted();
    return true;
  };

  const clearMatching = (identity: RenderInspectionIdentity): boolean => {
    if (!sameIdentity(session, identity)) {
      return false;
    }
    clearLocal();
    return true;
  };

  return {
    adopt,
    clearMatching,
    failOpenMatching: clearMatching,
    terminate(): void {
      if (terminated) {
        return;
      }
      clearLocal();
      terminated = true;
    },
    refresh(): void {
      ensureMounted();
    },
    current(): AdoptedRenderInspectionSession | null {
      return session;
    },
    element(): HTMLElement | null {
      return curtain;
    },
  };
}
