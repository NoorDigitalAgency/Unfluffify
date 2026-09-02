import { DEVICE_EMULATION_PRESETS } from "../domain/constants";
import {
  EXTENSION_UI_ATTRIBUTE,
  INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE,
  MAXIMUM_DOCUMENT_Z_INDEX,
} from "./interaction-shield";

export const EMULATION_TRANSITION_GUARD_ATTRIBUTE =
  "data-uf-emulation-transition-guard";
export const EMULATION_TRANSITION_GENERATION_ATTRIBUTE =
  "data-uf-emulation-transition-generation";
export const EMULATION_TRANSITION_MODE_ATTRIBUTE =
  "data-uf-emulation-transition-mode";
export const EMULATION_TRANSITION_STAGE_ATTRIBUTE =
  "data-uf-emulation-transition-stage";
export const EMULATION_TRANSITION_CAUSE_ATTRIBUTE =
  "data-uf-emulation-transition-cause";

export type EmulationTransitionMode = keyof typeof DEVICE_EMULATION_PRESETS;
export type EmulationTransitionCause =
  | "apply"
  | "restore"
  | "refit"
  | "debugger-detach"
  | "lease-recovery"
  | "navigation"
  | "startup"
  | "clear"
  | "viewport-change";
export type EmulationTransitionStage =
  | "released"
  | "idle"
  | "guarding"
  | "paint-proven"
  | "settling"
  | "rejected";
export type EmulationTransitionPaintProof =
  | "none"
  | "frame-two"
  | "guarded-fallback";

export type EmulationTransitionRequest =
  | Readonly<{
      phase: "begin";
      generation: number;
      mode: EmulationTransitionMode;
      cause: EmulationTransitionCause;
      /** A refit worker that missed the content-owned admission may adopt the
       * already-opaque viewport guard instead of superseding its generation. */
      adoptExistingRefitGuard?: true;
    }>
  | Readonly<{
      phase: "settle";
      generation: number;
      mode: EmulationTransitionMode;
      cause: EmulationTransitionCause;
    }>
  | Readonly<{
      phase: "release";
      generation: number;
      cause: EmulationTransitionCause;
    }>
  | Readonly<{
      /** Cancels a begin handshake that never authorized a debugger mutation.
       * Unlike terminal release, this restores any older retained guard. */
      phase: "abort";
      generation: number;
      cause: EmulationTransitionCause;
    }>;

export type EmulationTransitionMeasurement = Readonly<{
  innerWidth: number;
  innerHeight: number;
  documentClientWidth: number;
  documentClientHeight: number;
  screenWidth: number;
  screenHeight: number;
  visualViewportWidth: number;
  visualViewportHeight: number;
  visualViewportScale: number;
}>;

export type EmulationTransitionResult = Readonly<{
  ok: boolean;
  generation: number;
  mode: EmulationTransitionMode | null;
  stage: EmulationTransitionStage;
  guarded: boolean;
  coverage: boolean;
  exactGeometry: boolean;
  paintProof: EmulationTransitionPaintProof;
  reason: string;
  measured: EmulationTransitionMeasurement;
}>;

type MutationObserverLike = Pick<MutationObserver, "disconnect" | "observe">;

export type EmulationTransitionGuardianOptions = Readonly<{
  document: Document;
  window?: Window;
  createMutationObserver?: (callback: MutationCallback) => MutationObserverLike;
  requestFrame?: (callback: FrameRequestCallback) => number | void;
  paintTimeoutMs?: number;
  enterTransitionMs?: number;
  retireTransitionMs?: number;
  beforeSettle?: (request: Extract<EmulationTransitionRequest, { phase: "settle" }>) =>
    Promise<void> | void;
  onGuardingChanged?: (guarding: boolean) => void;
  onStage?: (
    request: EmulationTransitionRequest,
    result: EmulationTransitionResult,
  ) => void;
  onUnexpectedViewportChange?: (
    mode: EmulationTransitionMode,
    generation: number,
  ) => void;
}>;

export type EmulationTransitionGuardian = Readonly<{
  handle: (request: EmulationTransitionRequest) => Promise<EmulationTransitionResult>;
  guardPhysicalViewportChange: (
    mode: EmulationTransitionMode,
  ) => EmulationTransitionResult;
  refresh: () => void;
  suspend: () => void;
  resume: () => void;
  dispose: () => void;
  current: () => EmulationTransitionResult;
  element: () => HTMLElement | null;
  isGuarding: () => boolean;
}>;

type ActiveTransition = Readonly<{
  generation: number;
  mode: EmulationTransitionMode;
  cause: EmulationTransitionCause;
}>;

type GuardianSnapshot = Readonly<{
  active: ActiveTransition | null;
  stage: EmulationTransitionStage;
  guarding: boolean;
  entering: boolean;
  entryOpacity: string;
  retiring: boolean;
  retireOpacity: string;
  paintProof: EmulationTransitionPaintProof;
}>;

const DEFAULT_PAINT_TIMEOUT_MS = 1_000;
const PRESENTATION_TURN_FALLBACK_MS = 20;
const DEFAULT_ENTER_TRANSITION_MS = 72;
const DEFAULT_RETIRE_TRANSITION_MS = 96;
const GUARD_BACKGROUND = "rgb(248, 250, 252)";
const DESKTOP_SCROLLBAR_TOLERANCE_PX = 32;
const VALID_CAUSES = new Set<EmulationTransitionCause>([
  "apply",
  "restore",
  "refit",
  "debugger-detach",
  "lease-recovery",
  "navigation",
  "startup",
  "clear",
  "viewport-change",
]);

function finitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function parseEmulationTransitionRequest(
  value: unknown,
): EmulationTransitionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (!finitePositiveInteger(candidate.generation)) {
    return null;
  }
  const cause = candidate.cause;
  if (typeof cause !== "string" || !VALID_CAUSES.has(cause as EmulationTransitionCause)) {
    return null;
  }
  if (candidate.phase === "release" || candidate.phase === "abort") {
    return {
      phase: candidate.phase,
      generation: candidate.generation,
      cause: cause as EmulationTransitionCause,
    };
  }
  if (
    (candidate.phase === "begin" || candidate.phase === "settle") &&
    (candidate.mode === "mobile" || candidate.mode === "desktop")
  ) {
    return {
      phase: candidate.phase,
      generation: candidate.generation,
      mode: candidate.mode,
      cause: cause as EmulationTransitionCause,
      ...(candidate.phase === "begin" &&
          cause === "refit" &&
          candidate.adoptExistingRefitGuard === true
        ? { adoptExistingRefitGuard: true as const }
        : {}),
    };
  }
  return null;
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

function setImportantStyle(
  style: CSSStyleDeclaration,
  property: string,
  value: string,
): void {
  if (
    style.getPropertyValue(property) !== value ||
    style.getPropertyPriority(property) !== "important"
  ) {
    style.setProperty(property, value, "important");
  }
}

/**
 * Retains an already-composited, hostile-page-resistant safety plane while a
 * debugger-owned viewport posture is held. Requested changes paint-prove this
 * plane before CDP mutates visible geometry; unexpected viewport changes turn
 * it opaque synchronously from the earliest document-start listener.
 */
export function createEmulationTransitionGuardian(
  options: EmulationTransitionGuardianOptions,
): EmulationTransitionGuardian {
  const document = options.document;
  const view = options.window ?? document.defaultView ?? undefined;
  const paintTimeoutMs = Math.max(100, options.paintTimeoutMs ?? DEFAULT_PAINT_TIMEOUT_MS);
  const enterTransitionMs = Math.max(0, options.enterTransitionMs ?? DEFAULT_ENTER_TRANSITION_MS);
  const retireTransitionMs = Math.max(0, options.retireTransitionMs ?? DEFAULT_RETIRE_TRANSITION_MS);
  let active: ActiveTransition | null = null;
  let lastGeneration = 0;
  let stage: EmulationTransitionStage = "released";
  let guard: HTMLElement | null = null;
  let observer: MutationObserverLike | null = null;
  let appliedStyleState = "";
  let appliedInlineStyle: string | null = null;
  let operationEpoch = 0;
  let syncScheduled = false;
  let suspended = false;
  let disposed = false;
  let guarding = false;
  let entering = false;
  let entryOpacity = "1";
  let retiring = false;
  let retireOpacity = "1";
  let paintProof: EmulationTransitionPaintProof = "none";
  let unexpectedChangeQueued = false;
  let abortSnapshot: Readonly<{
    generation: number;
    prior: GuardianSnapshot;
  }> | null = null;

  const measure = (): EmulationTransitionMeasurement => ({
    innerWidth: view?.innerWidth ?? 0,
    innerHeight: view?.innerHeight ?? 0,
    documentClientWidth: document.documentElement?.clientWidth ?? view?.innerWidth ?? 0,
    documentClientHeight: document.documentElement?.clientHeight ?? view?.innerHeight ?? 0,
    screenWidth: view?.screen?.width ?? 0,
    screenHeight: view?.screen?.height ?? 0,
    visualViewportWidth: view?.visualViewport?.width ?? view?.innerWidth ?? 0,
    visualViewportHeight: view?.visualViewport?.height ?? view?.innerHeight ?? 0,
    visualViewportScale: view?.visualViewport?.scale ?? 1,
  });

  const exactGeometry = (
    mode: EmulationTransitionMode | null,
    measured = measure(),
  ): boolean => {
    if (!mode) return false;
    const preset = DEVICE_EMULATION_PRESETS[mode];
    if (
      measured.screenWidth !== preset.width ||
      measured.screenHeight !== preset.height ||
      Math.abs(measured.visualViewportScale - 1) > 0.001
    ) {
      return false;
    }
    if (mode === "mobile") {
      // Classic scrollbars are included by window.innerWidth/innerHeight on
      // some documents even though the emulated screen and the interactive
      // viewport are exact. The background posture proof already uses these
      // two independent authorities; mirror it here so a correct mobile device
      // cannot enter an apply/reject/detach loop merely because gutters exist.
      return measured.documentClientWidth === preset.width &&
        measured.documentClientHeight === preset.height &&
        measured.visualViewportWidth === preset.width &&
        measured.visualViewportHeight === preset.height;
    }
    // Desktop scrollbars can subtract a platform-dependent strip from the
    // visual viewport while the emulated screen/layout remains exactly
    // 1920x1080. Bound that allowance so a collapsed or clipped visual viewport
    // can never be mistaken for an exact settled device.
    return measured.innerWidth === preset.width &&
      measured.innerHeight === preset.height &&
      measured.visualViewportWidth <= preset.width &&
      measured.visualViewportHeight <= preset.height &&
      measured.visualViewportWidth >= preset.width - DESKTOP_SCROLLBAR_TOLERANCE_PX &&
      measured.visualViewportHeight >= preset.height - DESKTOP_SCROLLBAR_TOLERANCE_PX;
  };

  const coverage = (): boolean => {
    if (
      !view ||
      document.visibilityState !== "visible" ||
      !guard ||
      !guard.isConnected ||
      guard.parentElement !== document.documentElement ||
      document.documentElement?.lastElementChild !== guard
    ) {
      return false;
    }
    const style = view.getComputedStyle(guard);
    const opacity = Number.parseFloat(style.opacity || "0");
    const rect = guard.getBoundingClientRect();
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? view.innerWidth;
    const height = viewport?.height ?? view.innerHeight;
    return style.position === "fixed" &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.pointerEvents !== "none" &&
      style.zIndex === MAXIMUM_DOCUMENT_Z_INDEX &&
      Number.isFinite(opacity) && opacity >= 0.999 &&
      rect.left <= left && rect.top <= top &&
      rect.right >= left + width && rect.bottom >= top + height;
  };

  const exactTransitionIdentity = (epoch: number): boolean =>
    epoch === operationEpoch &&
    !disposed &&
    !suspended &&
    guarding &&
    active !== null &&
    guard !== null &&
    guard.getAttribute(EMULATION_TRANSITION_GUARD_ATTRIBUTE) === "true" &&
    guard.getAttribute(EXTENSION_UI_ATTRIBUTE) === "true" &&
    guard.getAttribute(INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE) === "true" &&
    guard.getAttribute(EMULATION_TRANSITION_GENERATION_ATTRIBUTE) ===
      String(active.generation) &&
    guard.getAttribute(EMULATION_TRANSITION_MODE_ATTRIBUTE) === active.mode &&
    guard.getAttribute(EMULATION_TRANSITION_STAGE_ATTRIBUTE) === stage &&
    guard.getAttribute(EMULATION_TRANSITION_CAUSE_ATTRIBUTE) === active.cause &&
    appliedInlineStyle !== null &&
    guard.getAttribute("style") === appliedInlineStyle;

  const result = (
    ok: boolean,
    reason: string,
    request: EmulationTransitionRequest | null = null,
  ): EmulationTransitionResult => {
    const measured = measure();
    const current: EmulationTransitionResult = {
      ok,
      generation: active?.generation ?? Math.max(lastGeneration, request?.generation ?? 0),
      mode: active?.mode ?? null,
      stage,
      guarded: guarding,
      coverage: guarding && coverage(),
      exactGeometry: exactGeometry(active?.mode ?? null, measured),
      paintProof,
      reason,
      measured,
    };
    if (request) {
      try {
        options.onStage?.(request, current);
      } catch {
        // Debug evidence may not influence presentation authority.
      }
    }
    return current;
  };

  const applyPresentation = (immediate: boolean): void => {
    if (!guard || !active) return;
    setAttribute(guard, EMULATION_TRANSITION_GUARD_ATTRIBUTE, "true");
    setAttribute(guard, EXTENSION_UI_ATTRIBUTE, "true");
    setAttribute(guard, INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE, "true");
    setAttribute(guard, EMULATION_TRANSITION_GENERATION_ATTRIBUTE, String(active.generation));
    setAttribute(guard, EMULATION_TRANSITION_MODE_ATTRIBUTE, active.mode);
    setAttribute(guard, EMULATION_TRANSITION_STAGE_ATTRIBUTE, stage);
    setAttribute(guard, EMULATION_TRANSITION_CAUSE_ATTRIBUTE, active.cause);
    setAttribute(guard, "aria-hidden", "true");
    removeAttribute(guard, "role");
    removeAttribute(guard, "aria-live");
    removeAttribute(guard, "aria-label");
    removeAttribute(guard, "tabindex");
    const paintedOpacity = entering
      ? entryOpacity
      : retiring
        ? retireOpacity
        : guarding ? "1" : "0";
    const transition = entering && enterTransitionMs > 0
      ? `opacity ${enterTransitionMs}ms ease-out`
      : retiring && retireTransitionMs > 0
        ? `opacity ${retireTransitionMs}ms ease-out`
        : immediate || enterTransitionMs === 0
          ? "none"
          : `opacity ${enterTransitionMs}ms ease-out`;
    const inputBoundaryActive = guarding || entering || retiring;
    const styles: Readonly<Record<string, string>> = {
      all: "initial",
      position: "fixed",
      inset: "0",
      display: "block",
      visibility: "visible",
      width: "100vw",
      height: "100vh",
      "min-width": "100vw",
      "min-height": "100vh",
      "max-width": "none",
      "max-height": "none",
      margin: "0",
      padding: "0",
      border: "0",
      transform: "none",
      translate: "none",
      rotate: "none",
      scale: "none",
      zoom: "1",
      clip: "auto",
      "clip-path": "none",
      filter: "none",
      mask: "none",
      "-webkit-mask": "none",
      background: GUARD_BACKGROUND,
      opacity: paintedOpacity,
      animation: "none",
      transition,
      "pointer-events": inputBoundaryActive ? "auto" : "none",
      "touch-action": "none",
      "user-select": "none",
      "-webkit-user-select": "none",
      "overscroll-behavior": "none",
      isolation: "isolate",
      contain: "strict",
      "content-visibility": "visible",
      "mix-blend-mode": "normal",
      "box-sizing": "border-box",
      cursor: inputBoundaryActive ? "wait" : "default",
      "z-index": MAXIMUM_DOCUMENT_Z_INDEX,
    };
    const styleState = JSON.stringify([
      paintedOpacity,
      transition,
      inputBoundaryActive,
    ]);
    const currentInlineStyle = guard.getAttribute("style");
    if (
      styleState !== appliedStyleState ||
      currentInlineStyle !== appliedInlineStyle
    ) {
      // CSSOM canonicalizes lexical inputs (`0` commonly becomes `0px`). Raw
      // value comparison would therefore rewrite the same declaration forever
      // when the observer sees the guard's own style mutation. Rebuild once,
      // retain the browser-serialized identity, and use that identity to detect
      // either a real presentation change or hostile inline tampering.
      guard.removeAttribute("style");
      for (const [property, value] of Object.entries(styles)) {
        setImportantStyle(guard.style, property, value);
      }
      appliedStyleState = styleState;
      appliedInlineStyle = guard.getAttribute("style");
    }
  };

  const ensureMounted = (immediate: boolean): boolean => {
    if (disposed || suspended || !active || !document.documentElement) {
      return false;
    }
    if (!guard) {
      guard = document.createElement("div");
      appliedStyleState = "";
      appliedInlineStyle = null;
    }
    applyPresentation(immediate);
    if (
      !guard.isConnected ||
      guard.parentElement !== document.documentElement ||
      document.documentElement.lastElementChild !== guard
    ) {
      document.documentElement.appendChild(guard);
    }
    return true;
  };

  const scheduleSync = (): void => {
    if (syncScheduled || disposed || !active) return;
    syncScheduled = true;
    queueMicrotask(() => {
      syncScheduled = false;
      if (!active || disposed) return;
      // An observer-triggered repair must not subscribe to its own canonical
      // style/attribute/last-child writes. Disconnect for the atomic repair and
      // re-arm only while a non-idle transition still requires hostile-page
      // monitoring.
      observer?.disconnect();
      ensureMounted(true);
      if (guarding || entering || retiring || stage !== "idle") {
        observe();
      }
    });
  };

  const nativeObserverFactory = (): EmulationTransitionGuardianOptions["createMutationObserver"] => {
    const Observer = (view as (Window & { MutationObserver?: typeof MutationObserver }) | undefined)
      ?.MutationObserver ?? (typeof MutationObserver === "function" ? MutationObserver : undefined);
    return Observer ? (callback) => new Observer(callback) : undefined;
  };

  const observe = (): void => {
    if (!active || disposed) return;
    if (!observer) {
      const createObserver = options.createMutationObserver ?? nativeObserverFactory();
      observer = createObserver?.(() => scheduleSync()) ?? null;
    }
    observer?.disconnect();
    // Root replacement, a sibling appended after the guard, and direct guard
    // tampering are the only mutations that can invalidate coverage. Observing
    // the whole page subtree here would wake this retained safety primitive for
    // every framework render even while it is transparently idle.
    observer?.observe(document, { childList: true });
    if (document.documentElement) {
      observer?.observe(document.documentElement, { childList: true });
    }
    if (guard) {
      observer?.observe(guard, {
        attributes: true,
        childList: true,
        attributeFilter: [
          "style",
          EMULATION_TRANSITION_GUARD_ATTRIBUTE,
          EXTENSION_UI_ATTRIBUTE,
          INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE,
          EMULATION_TRANSITION_GENERATION_ATTRIBUTE,
          EMULATION_TRANSITION_MODE_ATTRIBUTE,
          EMULATION_TRANSITION_STAGE_ATTRIBUTE,
          EMULATION_TRANSITION_CAUSE_ATTRIBUTE,
          "aria-hidden",
        ],
      });
    }
  };

  const frame = (timeoutMs = paintTimeoutMs): Promise<boolean> => new Promise((resolve) => {
    let settled = false;
    const finish = (painted: boolean): void => {
      if (settled) return;
      settled = true;
      (view?.clearTimeout ?? clearTimeout)(timeout);
      resolve(painted);
    };
    // A visible renderer can still suppress rAF while its compositor or main
    // thread is wedged. The lifecycle must fail closed in bounded time instead
    // of leaving a background debugger operation waiting forever.
    const timeout = (view?.setTimeout ?? setTimeout)(
      () => finish(false),
      Math.max(0, timeoutMs),
    );
    const callback: FrameRequestCallback = () => finish(true);
    if (options.requestFrame) {
      options.requestFrame(callback);
      return;
    }
    if (typeof view?.requestAnimationFrame === "function") {
      view.requestAnimationFrame(callback);
    }
  });

  /** Allows a cosmetic opacity transition to advance even when Chromium
   * throttles the visible website's rAF queue while the side panel owns focus.
   * The timer branch is scheduling only: callers must never treat it as paint
   * authority. */
  const waitForPresentationTurn = async (): Promise<void> => {
    await frame(PRESENTATION_TURN_FALLBACK_MS);
  };

  const waitUntilVisible = async (epoch: number): Promise<boolean> => {
    if (document.visibilityState === "visible") return true;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (visible: boolean): void => {
        if (settled) return;
        settled = true;
        document.removeEventListener("visibilitychange", onVisibility, true);
        (view?.clearTimeout ?? clearTimeout)(timer);
        resolve(visible);
      };
      const onVisibility = (): void => {
        if (document.visibilityState === "visible") {
          finish(epoch === operationEpoch && !disposed);
        }
      };
      const timer = (view?.setTimeout ?? setTimeout)(() => finish(false), paintTimeoutMs);
      document.addEventListener("visibilitychange", onVisibility, true);
    });
  };

  const strictPaintFallbackSample = (
    epoch: number,
    requireExactGeometry: boolean,
  ): boolean => {
    if (epoch !== operationEpoch || disposed || suspended || !ensureMounted(true)) return false;
    return exactTransitionIdentity(epoch) &&
      coverage() &&
      (!requireExactGeometry || exactGeometry(active?.mode ?? null));
  };

  const guardedPaintFallback = async (
    epoch: number,
    requireExactGeometry: boolean,
  ): Promise<EmulationTransitionPaintProof | null> => {
    if (!strictPaintFallbackSample(epoch, requireExactGeometry)) return null;
    await waitForPresentationTurn();
    return strictPaintFallbackSample(epoch, requireExactGeometry)
      ? "guarded-fallback"
      : null;
  };

  const waitForPaintProof = async (
    epoch: number,
    requireExactGeometry: boolean,
  ): Promise<EmulationTransitionPaintProof | null> => {
    const startedAt = Date.now();
    let consecutive = 0;
    while (
      epoch === operationEpoch &&
      !disposed &&
      Date.now() - startedAt <= paintTimeoutMs
    ) {
      if (!await waitUntilVisible(epoch)) return null;
      ensureMounted(true);
      const remainingMs = paintTimeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0 || !await frame(remainingMs)) {
        return await guardedPaintFallback(epoch, requireExactGeometry);
      }
      if (epoch !== operationEpoch || disposed) return null;
      const valid = exactTransitionIdentity(epoch) &&
        coverage() &&
        (!requireExactGeometry || exactGeometry(active?.mode ?? null));
      consecutive = valid ? consecutive + 1 : 0;
      if (consecutive >= 2) return "frame-two";
    }
    return await guardedPaintFallback(epoch, requireExactGeometry);
  };

  const setGuarding = (next: boolean): void => {
    if (guarding === next) return;
    guarding = next;
    try {
      options.onGuardingChanged?.(next);
    } catch {
      // The guardian remains the input/paint boundary even if an annotation
      // presentation callback fails.
    }
  };

  const activateUnexpectedViewportGuard = (): void => {
    if (!active || disposed || suspended) return;
    // Viewport events emitted by a metrics write belong to the transition that
    // already owns this opaque plane. Re-arming during settle/fade invalidates
    // its proof and creates a second refit cycle. A genuinely new physical
    // change is also observed by the browser/window/popup lanes while this
    // guard remains safely opaque.
    if (guarding || entering || retiring || stage !== "idle") return;
    operationEpoch += 1;
    active = { ...active, cause: "viewport-change" };
    entering = false;
    retiring = false;
    paintProof = "none";
    stage = "guarding";
    setGuarding(true);
    ensureMounted(true);
    observe();
    if (!unexpectedChangeQueued) {
      unexpectedChangeQueued = true;
      queueMicrotask(() => {
        unexpectedChangeQueued = false;
        if (!active || !guarding || disposed) return;
        try {
          options.onUnexpectedViewportChange?.(active.mode, active.generation);
        } catch {
          // Background's standing lease remains the correctness backstop.
        }
      });
    }
  };

  const onViewportChange = (): void => {
    activateUnexpectedViewportGuard();
  };
  view?.addEventListener?.("resize", onViewportChange, { capture: true });
  view?.visualViewport?.addEventListener?.("resize", onViewportChange, { capture: true });

  const begin = async (
    request: Extract<EmulationTransitionRequest, { phase: "begin" }>,
  ): Promise<EmulationTransitionResult> => {
    const adoptableGeneration =
      !disposed &&
        !suspended &&
        request.adoptExistingRefitGuard === true &&
        request.cause === "refit" &&
        active?.mode === request.mode &&
        guarding &&
        coverage() &&
        (active.cause === "refit" || active.cause === "viewport-change") &&
        (stage === "guarding" || stage === "paint-proven")
        ? active.generation
        : null;
    if (adoptableGeneration !== null) {
      // The opaque document is the only surface that can authoritatively name
      // a guard the worker never heard back from. Retain that generation while
      // advancing the replay floor past the worker's speculative replacement.
      lastGeneration = Math.max(lastGeneration, request.generation);
      abortSnapshot = null;
      active = {
        generation: adoptableGeneration,
        mode: request.mode,
        cause: "refit",
      };
      operationEpoch += 1;
      const epoch = operationEpoch;
      entering = false;
      entryOpacity = "1";
      retiring = false;
      retireOpacity = "1";
      paintProof = "none";
      stage = "guarding";
      setGuarding(true);
      if (!ensureMounted(true)) {
        stage = "rejected";
        return result(false, "document-root-unavailable", request);
      }
      observe();
      const beginProof = await waitForPaintProof(epoch, false);
      if (
        !beginProof ||
        epoch !== operationEpoch ||
        !active ||
        active.generation !== adoptableGeneration
      ) {
        if (epoch === operationEpoch) stage = "rejected";
        return result(
          false,
          beginProof ? "stale-generation" : "guard-paint-proof-failed",
          request,
        );
      }
      paintProof = beginProof;
      stage = "paint-proven";
      applyPresentation(true);
      return result(true, "adopted-active-refit-guard", request);
    }
    if (disposed || request.generation < lastGeneration) {
      return result(false, disposed ? "disposed" : "stale-generation", request);
    }
    if (
      active &&
      request.generation === active.generation &&
      request.mode !== active.mode
    ) {
      return result(false, "generation-mode-mismatch", request);
    }
    const alreadyOpaque = guarding && coverage();
    abortSnapshot = {
      generation: request.generation,
      prior: {
        active,
        stage,
        guarding,
        entering,
        entryOpacity,
        retiring,
        retireOpacity,
        paintProof,
      },
    };
    lastGeneration = request.generation;
    active = {
      generation: request.generation,
      mode: request.mode,
      cause: request.cause,
    };
    stage = "guarding";
    paintProof = "none";
    operationEpoch += 1;
    const epoch = operationEpoch;
    entering =
      enterTransitionMs > 0 &&
      (request.cause === "apply" || request.cause === "restore") &&
      !alreadyOpaque;
    entryOpacity = entering ? "0" : "1";
    retiring = false;
    setGuarding(true);
    if (!ensureMounted(request.cause !== "apply" && request.cause !== "restore")) {
      stage = "rejected";
      return result(false, "document-root-unavailable", request);
    }
    observe();
    if (entering) {
      await waitForPresentationTurn();
      if (epoch !== operationEpoch || !active || active.generation !== request.generation) {
        return result(false, "stale-generation", request);
      }
      entryOpacity = "1";
      applyPresentation(false);
    }
    const beginProof = await waitForPaintProof(epoch, false);
    if (!beginProof) {
      if (epoch !== operationEpoch || !active || active.generation !== request.generation) {
        return result(false, "stale-generation", request);
      }
      stage = "rejected";
      return result(false, "guard-paint-proof-failed", request);
    }
    paintProof = beginProof;
    entering = false;
    stage = "paint-proven";
    applyPresentation(true);
    return result(true, "", request);
  };

  const settle = async (
    request: Extract<EmulationTransitionRequest, { phase: "settle" }>,
  ): Promise<EmulationTransitionResult> => {
    if (
      disposed ||
      !active ||
      request.generation !== active.generation ||
      request.mode !== active.mode
    ) {
      return result(false, disposed ? "disposed" : "stale-generation", request);
    }
    operationEpoch += 1;
    const epoch = operationEpoch;
    entering = false;
    retiring = false;
    paintProof = "none";
    stage = "settling";
    setGuarding(true);
    ensureMounted(true);
    observe();
    try {
      await options.beforeSettle?.(request);
    } catch {
      stage = "rejected";
      return result(false, "settle-refresh-failed", request);
    }
    const settleProof = await waitForPaintProof(epoch, true);
    if (!settleProof) {
      if (epoch !== operationEpoch || !active || active.generation !== request.generation) {
        return result(false, "stale-generation", request);
      }
      stage = "rejected";
      return result(false, "settle-proof-failed", request);
    }
    paintProof = settleProof;
    if (epoch !== operationEpoch || !active || active.generation !== request.generation) {
      return result(false, "stale-generation", request);
    }
    stage = "idle";
    abortSnapshot = null;
    retiring = retireTransitionMs > 0;
    retireOpacity = "1";
    // Restore the already-repositioned Marking/Silent presentation while the
    // safety plane is still fully opaque. `retiring` keeps this root interactive
    // through the fade, so page input remains fenced while annotations become
    // ready behind it rather than popping in after the page is exposed.
    setGuarding(false);
    applyPresentation(false);
    if (retiring) {
      await waitForPresentationTurn();
      if (epoch !== operationEpoch || !active || active.generation !== request.generation) {
        return result(false, "stale-generation", request);
      }
      retireOpacity = "0";
      applyPresentation(false);
      await new Promise<void>((resolve) => {
        (view?.setTimeout ?? setTimeout)(resolve, retireTransitionMs);
      });
    }
    if (epoch !== operationEpoch || !active || active.generation !== request.generation) {
      return result(false, "stale-generation", request);
    }
    retiring = false;
    applyPresentation(true);
    // The retained transparent root repairs and re-arms synchronously on the
    // next explicit begin or viewport event. It does not need a live observer
    // while exact and idle; leaving one attached would tax ordinary top-level
    // framework mounts for the entire marking/silent session.
    observer?.disconnect();
    return result(true, "", request);
  };

  const release = async (
    request: Extract<EmulationTransitionRequest, { phase: "release" }>,
  ): Promise<EmulationTransitionResult> => {
    if (
      disposed ||
      (active === null
        ? request.generation < lastGeneration
        : request.generation !== active.generation)
    ) {
      return result(
        false,
        disposed
          ? "disposed"
          : request.generation < lastGeneration
            ? "stale-generation"
            : "generation-mismatch",
        request,
      );
    }
    operationEpoch += 1;
    lastGeneration = Math.max(lastGeneration, request.generation);
    active = null;
    abortSnapshot = null;
    entering = false;
    retiring = false;
    paintProof = "none";
    stage = "released";
    setGuarding(false);
    observer?.disconnect();
    observer = null;
    guard?.remove();
    guard = null;
    return result(true, "", request);
  };

  const abort = async (
    request: Extract<EmulationTransitionRequest, { phase: "abort" }>,
  ): Promise<EmulationTransitionResult> => {
    if (
      disposed ||
      !active ||
      request.generation !== active.generation ||
      abortSnapshot?.generation !== request.generation
    ) {
      return result(false, disposed ? "disposed" : "generation-mismatch", request);
    }
    operationEpoch += 1;
    const prior = abortSnapshot.prior;
    abortSnapshot = null;
    active = prior.active;
    stage = prior.stage;
    entering = prior.entering;
    entryOpacity = prior.entryOpacity;
    retiring = prior.retiring;
    retireOpacity = prior.retireOpacity;
    paintProof = prior.paintProof;
    setGuarding(prior.guarding);
    observer?.disconnect();
    if (!active) {
      stage = "released";
      guard?.remove();
      guard = null;
      return result(true, "aborted", request);
    }
    ensureMounted(true);
    if (guarding || entering || retiring || stage !== "idle") {
      observe();
    }
    return result(true, "restored-prior", request);
  };

  return {
    async handle(request) {
      if (request.phase === "begin") return await begin(request);
      if (request.phase === "settle") return await settle(request);
      if (request.phase === "abort") return await abort(request);
      return await release(request);
    },
    guardPhysicalViewportChange(mode) {
      if (disposed || suspended || !active) {
        return result(false, disposed
          ? "disposed"
          : suspended ? "suspended" : "no-active-posture");
      }
      if (active.mode !== mode) {
        return result(false, "mode-mismatch");
      }
      if (
        guarding &&
        coverage() &&
        (active.cause === "refit" || active.cause === "viewport-change") &&
        (stage === "guarding" || stage === "paint-proven")
      ) {
        return result(true, "already-guarded");
      }
      const reuseGeneration = guarding && coverage() &&
        (active.cause === "refit" || active.cause === "viewport-change");
      const generation = reuseGeneration
        ? active.generation
        : Math.max(lastGeneration, active.generation) + 1;
      if (!Number.isSafeInteger(generation) || generation <= 0) {
        return result(false, "generation-exhausted");
      }
      // This browser-owned occurrence outranks an older enter/settle/abort
      // epoch. Keep the canonical root fully opaque while the normal refit
      // coordinator catches up; it alone may later prove and fade this lease.
      operationEpoch += 1;
      lastGeneration = Math.max(lastGeneration, generation);
      active = { generation, mode, cause: "viewport-change" };
      abortSnapshot = null;
      entering = false;
      entryOpacity = "1";
      retiring = false;
      retireOpacity = "1";
      paintProof = "none";
      stage = "guarding";
      setGuarding(true);
      if (!ensureMounted(true)) {
        stage = "rejected";
        return result(false, "document-root-unavailable");
      }
      observe();
      return coverage()
        ? result(true, "physical-viewport-guarded")
        : result(false, "guard-coverage-failed");
    },
    refresh() {
      if (active && !disposed && !suspended) {
        ensureMounted(true);
        if (guarding || entering || retiring || stage !== "idle") {
          observe();
        }
      }
    },
    suspend() {
      suspended = true;
      observer?.disconnect();
      guard?.remove();
    },
    resume() {
      if (disposed) return;
      suspended = false;
      if (active) {
        ensureMounted(true);
        if (guarding || entering || retiring || stage !== "idle") {
          observe();
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      operationEpoch += 1;
      active = null;
      abortSnapshot = null;
      entering = false;
      retiring = false;
      paintProof = "none";
      stage = "released";
      setGuarding(false);
      observer?.disconnect();
      observer = null;
      guard?.remove();
      guard = null;
      view?.removeEventListener?.("resize", onViewportChange, { capture: true });
      view?.visualViewport?.removeEventListener?.("resize", onViewportChange, { capture: true });
    },
    current: () => result(!disposed, disposed ? "disposed" : ""),
    element: () => guard,
    isGuarding: () => guarding,
  };
}
