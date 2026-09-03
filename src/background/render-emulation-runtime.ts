import { getBrowserRuntimeLastError } from "../common/browser";
import {
  applyEmulationViaCdp,
  clearEmulationViaCdp,
  deriveGooglebotSmartphoneUserAgent,
  type EmulationState,
} from "../content/stabilization";
import { DEVICE_EMULATION_PRESETS } from "../domain/constants";
import { fitDeviceScale, type EmulationMode } from "../domain/emulation";
import type {
  EmulationPostureRecord,
  EmulationPostureRepo,
} from "../storage/repositories/emulation-posture";
import type {
  EmulationTransitionCause,
  EmulationTransitionRequest,
  EmulationTransitionResult,
} from "../content/emulation-transition-guardian";

export type EmulationFailureReason =
  | "viewport_mismatch"
  | "physical_fit_mismatch"
  | "device_pixel_ratio_mismatch"
  | "page_scale_mismatch"
  | "touch_mismatch"
  | "pointer_media_mismatch"
  | "identity_unavailable"
  | "identity_mismatch"
  | "proof_unavailable"
  | "presentation_unavailable"
  | "owner_unavailable";

export type EmulationTransitionDelivery =
  | Readonly<{ status: "ready"; result: EmulationTransitionResult }>
  | Readonly<{ status: "no_receiver"; reason?: string }>
  | Readonly<{ status: "failed"; reason: string }>;

export type VerifiedEmulationState = EmulationState & Readonly<{
  identityStale: boolean;
  /** A reload is a transition request, never proof that the current document is
   * exact. The replacement document must pass a second apply/probe round. */
  reloadRequired?: boolean;
  failureReason?: EmulationFailureReason;
}>;

export type EmulationPhysicalViewportHint = Readonly<{
  /** Independent visible height measured by the non-emulated side panel. */
  height: number;
}>;

export type EmulationRefitSource =
  | "content"
  | "popup"
  | "window-bounds"
  | "side-panel"
  | "watchdog"
  | "verification";

/** Internal observation of one physical-geometry occurrence. Multiple browser
 * surfaces can report the same occurrence; the runtime owns their coalescing. */
export type EmulationRefitObservation = Readonly<{
  source: EmulationRefitSource;
  presentationGeneration?: number;
  physicalViewportHint?: EmulationPhysicalViewportHint;
  /** Bounds-listener-only safety projection. It may raise the paint/input
   * guard before delayed browser reads, but it never authorizes a metrics
   * write or terminal fit proof. */
  projectedPhysicalViewport?: PhysicalViewport;
  projectedPostureEpoch?: number;
  /** A real outer-bounds occurrence. When its projection cannot be fenced to
   * the held posture, protection begins fail-closed before browser reads. */
  physicalBoundsChanged?: boolean;
  /** Browser-bounds-only admission launched before the serialized emulation
   * queue. Its generation is still posture-fenced before adoption. */
  physicalGuardGeneration?: Promise<number | null>;
}>;

type PhysicalViewport = Readonly<{ width: number; height: number }>;

/** Browser-owned ownership/fit backstop for a held debugger posture. Delivered
 * detach and geometry events remain immediate; this closes Chromium's silent
 * detach gap without polling or evaluating the inspected page. */
export const EMULATION_LEASE_WATCHDOG_MS = 50;
/** Bounds-to-content admission is only an early safety lane. If its reply is
 * lost, the serialized refit must resume through the ordinary fail-closed
 * presenter instead of retaining a long-lived per-event transport. */
export const PHYSICAL_VIEWPORT_GUARD_ADMISSION_TIMEOUT_MS = 150;

class PhysicalViewportUnavailableError extends Error {
  constructor() {
    super("Physical viewport is unavailable");
    this.name = "PhysicalViewportUnavailableError";
  }
}

class EmulationPresentationUnavailableError extends Error {
  constructor(
    readonly detail: string,
    readonly mutationPossible = false,
    readonly guardedHandoffGeneration: number | null = null,
  ) {
    super(`Emulation transition presentation unavailable: ${detail}`);
    this.name = "EmulationPresentationUnavailableError";
  }
}

type MeasuredEmulationPosture = Readonly<{
  innerWidth: number;
  innerHeight: number;
  documentClientWidth: number;
  documentClientHeight: number;
  visualViewportWidth: number;
  visualViewportHeight: number;
  devicePixelRatio: number;
  visualViewportScale: number;
  maxTouchPoints: number;
  userAgent: string;
  pointerCoarse: boolean;
  pointerFine: boolean;
  hoverNone: boolean;
  hoverHover: boolean;
  anyPointerCoarse: boolean;
  anyPointerFine: boolean;
  anyHoverNone: boolean;
  anyHoverHover: boolean;
}>;

const EMULATION_PROOF_EXPRESSION = `(() => ({
  __unfluffifyEmulationProof: true,
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  documentClientWidth: document.documentElement?.clientWidth ?? window.innerWidth,
  documentClientHeight: document.documentElement?.clientHeight ?? window.innerHeight,
  visualViewportWidth: window.visualViewport?.width ?? window.innerWidth,
  visualViewportHeight: window.visualViewport?.height ?? window.innerHeight,
  devicePixelRatio: window.devicePixelRatio,
  visualViewportScale: window.visualViewport?.scale ?? 1,
  maxTouchPoints: navigator.maxTouchPoints,
  userAgent: navigator.userAgent,
  pointerCoarse: matchMedia("(pointer: coarse)").matches,
  pointerFine: matchMedia("(pointer: fine)").matches,
  hoverNone: matchMedia("(hover: none)").matches,
  hoverHover: matchMedia("(hover: hover)").matches,
  anyPointerCoarse: matchMedia("(any-pointer: coarse)").matches,
  anyPointerFine: matchMedia("(any-pointer: fine)").matches,
  anyHoverNone: matchMedia("(any-hover: none)").matches,
  anyHoverHover: matchMedia("(any-hover: hover)").matches,
}))()`;

const AFTER_BROWSER_FRAME_EXPRESSION =
  "new Promise((resolve) => requestAnimationFrame(() => resolve(true)))";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function measuredEmulationPosture(value: unknown): MeasuredEmulationPosture | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const innerWidth = finiteNumber(candidate.innerWidth);
  const innerHeight = finiteNumber(candidate.innerHeight);
  const documentClientWidth = finiteNumber(candidate.documentClientWidth);
  const documentClientHeight = finiteNumber(candidate.documentClientHeight);
  const visualViewportWidth = finiteNumber(candidate.visualViewportWidth);
  const visualViewportHeight = finiteNumber(candidate.visualViewportHeight);
  const devicePixelRatio = finiteNumber(candidate.devicePixelRatio);
  const visualViewportScale = finiteNumber(candidate.visualViewportScale);
  const maxTouchPoints = finiteNumber(candidate.maxTouchPoints);
  if (
    innerWidth === null ||
    innerHeight === null ||
    documentClientWidth === null ||
    documentClientHeight === null ||
    visualViewportWidth === null ||
    visualViewportHeight === null ||
    devicePixelRatio === null ||
    visualViewportScale === null ||
    maxTouchPoints === null ||
    typeof candidate.userAgent !== "string"
  ) {
    return null;
  }
  const booleanKeys = [
    "pointerCoarse",
    "pointerFine",
    "hoverNone",
    "hoverHover",
    "anyPointerCoarse",
    "anyPointerFine",
    "anyHoverNone",
    "anyHoverHover",
  ] as const;
  if (booleanKeys.some((key) => typeof candidate[key] !== "boolean")) {
    return null;
  }
  return {
    innerWidth,
    innerHeight,
    documentClientWidth,
    documentClientHeight,
    visualViewportWidth,
    visualViewportHeight,
    devicePixelRatio,
    visualViewportScale,
    maxTouchPoints,
    userAgent: candidate.userAgent,
    pointerCoarse: candidate.pointerCoarse as boolean,
    pointerFine: candidate.pointerFine as boolean,
    hoverNone: candidate.hoverNone as boolean,
    hoverHover: candidate.hoverHover as boolean,
    anyPointerCoarse: candidate.anyPointerCoarse as boolean,
    anyPointerFine: candidate.anyPointerFine as boolean,
    anyHoverNone: candidate.anyHoverNone as boolean,
    anyHoverHover: candidate.anyHoverHover as boolean,
  };
}

function proveEmulationPosture(
  state: EmulationState,
  measured: MeasuredEmulationPosture | null,
  intendedUserAgent: string,
): EmulationFailureReason | null {
  if (!measured) {
    return "proof_unavailable";
  }
  const viewportMatches = state.mode === "mobile"
    ? measured.visualViewportWidth === state.width &&
      measured.visualViewportHeight === state.height &&
      measured.documentClientWidth === state.width &&
      measured.documentClientHeight === state.height
    : measured.innerWidth === state.width && measured.innerHeight === state.height;
  if (!viewportMatches) return "viewport_mismatch";
  if (Math.abs(measured.devicePixelRatio - 1) > 0.001) {
    return "device_pixel_ratio_mismatch";
  }
  if (Math.abs(measured.visualViewportScale - 1) > 0.001) {
    return "page_scale_mismatch";
  }
  if (state.mode === "mobile") {
    if (measured.maxTouchPoints < 1) {
      return "touch_mismatch";
    }
    if (
      !measured.pointerCoarse || measured.pointerFine ||
      !measured.hoverNone || measured.hoverHover ||
      !measured.anyPointerCoarse || measured.anyPointerFine ||
      !measured.anyHoverNone || measured.anyHoverHover
    ) {
      return "pointer_media_mismatch";
    }
  } else {
    if (measured.maxTouchPoints !== 0) {
      return "touch_mismatch";
    }
    if (
      measured.pointerCoarse || !measured.pointerFine ||
      measured.hoverNone || !measured.hoverHover ||
      measured.anyPointerCoarse || !measured.anyPointerFine ||
      measured.anyHoverNone || !measured.anyHoverHover
    ) {
      return "pointer_media_mismatch";
    }
  }
  if (!intendedUserAgent) {
    return "identity_unavailable";
  }
  return measured.userAgent === intendedUserAgent ? null : "identity_mismatch";
}

function physicalViewportFits(
  state: Pick<EmulationState, "width" | "height" | "scale">,
  viewport: Readonly<{ width: number; height: number }> | null,
): boolean {
  // Unknown physical geometry cannot prove that the bottom/right edges are
  // visible. The real background always has tabs.get; tests or degraded hosts
  // without it must fail closed instead of acknowledging an assumed fit.
  if (!viewport) return false;
  return state.width * state.scale <= viewport.width + 0.5 &&
    state.height * state.scale <= viewport.height + 0.5;
}

type Debuggee = Readonly<{ tabId?: number }>;
type DebugTargetInfo = Readonly<{ tabId?: number; attached?: boolean }>;
type DebuggerApi = Readonly<{
  attach(target: Debuggee, version: string, callback?: () => void): Promise<void> | void;
  detach(target: Debuggee, callback?: () => void): Promise<void> | void;
  getTargets?(callback?: (targets?: readonly DebugTargetInfo[]) => void): Promise<readonly DebugTargetInfo[]> | void;
  sendCommand(target: Debuggee, method: string, params?: Record<string, unknown>, callback?: (result?: unknown) => void): Promise<unknown> | void;
  onDetach?: Readonly<{ addListener(listener: (source: Debuggee, reason?: string) => void): void }>;
}>;
type TabsApi = Readonly<{
  get?(tabId: number, callback?: (tab?: Readonly<{
    width?: number;
    height?: number;
    windowId?: number;
  }>) => void): Promise<Readonly<{
    width?: number;
    height?: number;
    windowId?: number;
  }>> | void;
  reload(tabId: number, options?: Record<string, unknown>, callback?: () => void): Promise<void> | void;
  sendMessage(tabId: number, message: unknown): Promise<unknown> | unknown;
  onUpdated?: Readonly<{
    addListener(listener: (tabId: number, changeInfo: Readonly<{ status?: string }>) => void): void;
  }>;
  onRemoved?: Readonly<{ addListener(listener: (tabId: number) => void): void }>;
}>;
type WindowsApi = Readonly<{
  get?(windowId: number, getInfo?: Record<string, unknown>, callback?: (window?: Readonly<{
    id?: number;
    width?: number;
    height?: number;
  }>) => void): Promise<Readonly<{
    id?: number;
    width?: number;
    height?: number;
  }>> | void;
  onBoundsChanged?: Readonly<{
    addListener(listener: (window: Readonly<{
      id?: number;
      width?: number;
      height?: number;
    }>) => void): void;
  }>;
}>;

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return Boolean(value) && typeof (value as PromiseLike<T>).then === "function";
}

function callbackToPromise<T>(
  invoke: (callback: (value?: T) => void) => Promise<T> | void,
  timeoutMs: number,
  operation: string,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`${operation} timed out after ${timeoutMs} ms`)));
    }, timeoutMs);
    try {
      const maybePromise = invoke((value) => {
        const lastError = getBrowserRuntimeLastError();
        if (lastError) {
          finish(() => reject(new Error(lastError.message || "Browser API failed")));
          return;
        }
        finish(() => resolve(value));
      });
      if (isPromiseLike<T>(maybePromise)) {
        void maybePromise.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
      }
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createRenderEmulationRuntime(input: Readonly<{
  debuggerApi?: DebuggerApi;
  tabs?: TabsApi;
  windows?: WindowsApi;
  postureRepo?: EmulationPostureRepo;
  presentTransition: (
    tabId: number,
    request: EmulationTransitionRequest,
  ) => Promise<EmulationTransitionDelivery>;
  guardPhysicalViewport?: (
    tabId: number,
    mode: EmulationMode,
  ) => Promise<number | null>;
  /** The live side panel owns the earlier native resize boundary. Background
   * uses its own direct compositor prefit only when that popup boundary is not
   * present for the target tab/window. */
  popupCompositorPrefitActive?: (tabId: number, windowId: number) => boolean;
  /** Actual browser emulation is owned by a live side-panel document. Tests
   * and embedders that omit this seam retain the legacy always-owned posture. */
  ownerActive?: (tabId: number) => boolean;
  /** Reason-scoped content projection used to hide retained annotation paint
   * and pause marking listeners while browser geometry is native. */
  setContentLifecycleSuspended?: (
    tabId: number,
    suspended: boolean,
  ) => Promise<boolean>;
  onDebuggerDetached?: (tabId: number, reason?: string) => void;
  apiTimeoutMs?: number;
  apiMode?: "callback" | "promise";
  /** Test seam. Zero disables the standing lease; production uses the bounded
   * browser-owned default above. */
  leaseWatchdogMs?: number;
}>) {
  const apiTimeoutMs = input.apiTimeoutMs ?? 5_000;
  const apiMode = input.apiMode ?? (
    input.debuggerApi?.sendCommand.length === 0 ? "promise" : "callback"
  );
  const invokeBrowserApi = <T>(
    invokePromise: () => Promise<T> | void,
    invokeCallback: (callback: (value?: T) => void) => Promise<T> | void,
    operation: string,
  ): Promise<T | undefined> => apiMode === "promise"
    ? promiseWithTimeout(
        Promise.resolve(invokePromise()).then((value) => value as T),
        apiTimeoutMs,
        operation,
      )
    : callbackToPromise(invokeCallback, apiTimeoutMs, operation);
  type HeldPosture = Readonly<{
    mode: EmulationMode;
    scale: number;
    suspended: boolean;
    revision: number;
    epoch: number;
  }>;
  const attachedTabs = new Set<number>();
  const emulationOperations = new Map<number, Promise<void>>();
  const withEmulationOperation = <T>(tabId: number, operation: () => Promise<T>): Promise<T> => {
    const previous = emulationOperations.get(tabId) ?? Promise.resolve();
    const queued = previous.then(operation, operation);
    const tail = queued.then(() => undefined, () => undefined);
    emulationOperations.set(tabId, tail);
    void tail.finally(() => {
      if (emulationOperations.get(tabId) === tail) {
        emulationOperations.delete(tabId);
      }
    });
    return queued;
  };
  /** The browser's own user agent, per tab, read BEFORE anything overrides it —
   *  read afterwards it would return our own spoof and the mobile UA would be
   *  derived from itself, compounding on every re-apply. */
  const realUserAgents = new Map<number, string>();
  /** The posture each tab is meant to hold, so it can be re-established without
   *  the popup being asked. Emulation is not a request that was granted once; it is
   *  a state the tab is supposed to be in. */
  const heldPostures = new Map<number, HeldPosture>();
  const verifiedPostures = new Map<number, VerifiedEmulationState>();
  /** Survives verified-cache invalidation and debugger detach. A same-mode full
   * reassert may shrink this value, but only the stable refit path may grow it. */
  const safeFittedScales = new Map<number, Readonly<{
    mode: EmulationMode;
    scale: number;
  }>>();
  const tabWindowIds = new Map<number, number>();
  const lastPhysicalViewports = new Map<number, PhysicalViewport>();
  const projectedPhysicalViewports = new Map<number, PhysicalViewport>();
  const lastWindowBounds = new Map<number, Readonly<{
    width: number;
    height: number;
  }>>();
  const reassertRetryTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const reassertRetryAttempts = new Map<number, number>();
  const leaseWatchdogTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const leaseWatchdogMs = input.leaseWatchdogMs ?? EMULATION_LEASE_WATCHDOG_MS;
  let scheduleLeaseWatchdog: (tabId: number) => void = () => undefined;
  const geometryGenerations = new Map<number, number>();
  const presentationGenerations = new Map<number, number>();
  const REASSERT_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 5_000] as const;
  const REFIT_SETTLE_MS = 240;
  const postureEpochs = new Map<number, number>();
  const postureRevisions = new Map<number, number>();
  const hydratedTabs = new Set<number>();
  const hydrationOperations = new Map<number, Promise<HeldPosture | undefined>>();
  const nextPostureEpoch = (tabId: number): number => {
    const epoch = (postureEpochs.get(tabId) ?? 0) + 1;
    postureEpochs.set(tabId, epoch);
    return epoch;
  };
  const postureIsCurrent = (tabId: number, held: HeldPosture): boolean =>
    heldPostures.get(tabId) === held && postureEpochs.get(tabId) === held.epoch;
  const postureIsActive = (tabId: number, held: HeldPosture): boolean =>
    postureIsCurrent(tabId, held) && !held.suspended &&
    (input.ownerActive?.(tabId) ?? true);
  const nextPostureRevision = (tabId: number): number => {
    const revision = (postureRevisions.get(tabId) ?? 0) + 1;
    postureRevisions.set(tabId, revision);
    return revision;
  };
  const nextGeometryGeneration = (tabId: number): number => {
    const generation = (geometryGenerations.get(tabId) ?? 0) + 1;
    geometryGenerations.set(tabId, generation);
    return generation;
  };
  type PresentationLease = Readonly<{
    generation: number;
    mode: EmulationMode;
    cause: EmulationTransitionCause;
  }>;
  type RefitBurst = {
    held: HeldPosture;
    lease: PresentationLease;
    geometryGeneration: number;
    physicalSignature: string;
    hint?: EmulationPhysicalViewportHint;
    coordinatorVersion: number;
    quietTimer?: ReturnType<typeof setTimeout>;
  };
  type PhysicalGuardAdmission = Readonly<{
    held: HeldPosture;
    generation: Promise<number | null>;
    add(candidate: Promise<number | null>): void;
  }>;
  type RefitCoordinator = {
    pending: EmulationRefitObservation | null;
    processing: Promise<void> | null;
    version: number;
    physicalGuardAdmission: PhysicalGuardAdmission | null;
  };
  const refitBursts = new Map<number, RefitBurst>();
  const refitCoordinators = new Map<number, RefitCoordinator>();
  const lastPhysicalSignatures = new Map<number, string>();
  type PendingCompositorPrefit = Readonly<{
    held: HeldPosture;
    mode: EmulationMode;
    scale: number;
    completion: Promise<boolean>;
  }>;
  const pendingCompositorPrefits = new Map<number, PendingCompositorPrefit>();
  /** A successful debugger detach can precede a transient content release
   * failure. Retain that exact lease so an ownerless retry removes the opaque
   * guard instead of treating durable suspension as fully settled. */
  const pendingSuspensionReleases = new Map<number, PresentationLease>();
  const nextPresentationGeneration = (tabId: number): number => {
    // A service-worker restart forgets its in-memory counter while the current
    // document can retain the last accepted generation. A time-derived floor
    // keeps the new worker strictly ahead without persisting presentation-only
    // state or weakening the content-side stale fence.
    const workerFloor = Date.now() * 1_000;
    const generation = Math.max(presentationGenerations.get(tabId) ?? 0, workerFloor) + 1;
    presentationGenerations.set(tabId, generation);
    return generation;
  };
  const physicalSignature = (viewport: PhysicalViewport): string =>
    `${viewport.width}x${viewport.height}`;
  const present = async (
    tabId: number,
    request: EmulationTransitionRequest,
  ): Promise<EmulationTransitionResult> => {
    let delivery: EmulationTransitionDelivery;
    try {
      delivery = await input.presentTransition(tabId, request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new EmulationPresentationUnavailableError(detail || "delivery-failed");
    }
    if (delivery.status !== "ready") {
      throw new EmulationPresentationUnavailableError(
        delivery.reason || delivery.status,
      );
    }
    return delivery.result;
  };
  const projectContentLifecycleSuspended = async (
    tabId: number,
    suspended: boolean,
  ): Promise<void> => {
    if (!input.setContentLifecycleSuspended) return;
    let accepted: boolean;
    try {
      accepted = await input.setContentLifecycleSuspended(tabId, suspended);
    } catch {
      accepted = false;
    }
    if (!accepted) {
      throw new EmulationPresentationUnavailableError(
        suspended
          ? "content-suspension-unavailable"
          : "content-resume-unavailable",
      );
    }
  };
  const releasePresentation = async (
    tabId: number,
    lease: PresentationLease,
  ): Promise<void> => {
    const response = await present(tabId, {
      phase: "release",
      generation: lease.generation,
      cause: lease.cause,
    });
    if (
      !response.ok ||
      response.generation !== lease.generation ||
      response.mode !== null ||
      response.stage !== "released" ||
      response.guarded ||
      response.coverage
    ) {
      throw new EmulationPresentationUnavailableError(
        response.reason || "presentation-not-released",
        true,
      );
    }
  };
  const releaseSuspendedPresentation = async (
    tabId: number,
    mode: EmulationMode,
    lease = pendingSuspensionReleases.get(tabId) ?? {
      generation: nextPresentationGeneration(tabId),
      mode,
      cause: "panel-suspend" as const,
    },
  ): Promise<void> => {
    pendingSuspensionReleases.set(tabId, lease);
    await releasePresentation(tabId, lease);
    if (pendingSuspensionReleases.get(tabId) === lease) {
      pendingSuspensionReleases.delete(tabId);
    }
  };
  const abortPresentation = async (
    tabId: number,
    lease: PresentationLease,
  ): Promise<void> => {
    // Abort is deliberately distinct from terminal release: the content owner
    // can restore an older opaque/idle retained guard when this generation never
    // reached debugger mutation authority.
    await present(tabId, {
      phase: "abort",
      generation: lease.generation,
      cause: lease.cause,
    });
  };
  const beginPresentation = async (
    tabId: number,
    mode: EmulationMode,
    cause: EmulationTransitionCause,
    preferredGeneration?: number,
  ): Promise<PresentationLease> => {
    const lease: PresentationLease = {
      generation:
        typeof preferredGeneration === "number" &&
        Number.isSafeInteger(preferredGeneration) &&
        preferredGeneration > 0
          ? preferredGeneration
          : nextPresentationGeneration(tabId),
      mode,
      cause,
    };
    presentationGenerations.set(
      tabId,
      Math.max(presentationGenerations.get(tabId) ?? 0, lease.generation),
    );
    const request: Extract<EmulationTransitionRequest, { phase: "begin" }> = {
      phase: "begin",
      generation: lease.generation,
      mode,
      cause,
      ...(cause === "refit" && preferredGeneration === undefined
        ? { adoptExistingRefitGuard: true }
        : {}),
    };
    try {
      const response = await present(tabId, request);
      const adoptedExistingRefitGuard =
        request.adoptExistingRefitGuard === true &&
        response.reason === "adopted-active-refit-guard" &&
        Number.isSafeInteger(response.generation) &&
        response.generation > 0;
      if (
        !response.ok ||
        (response.generation !== lease.generation && !adoptedExistingRefitGuard) ||
        response.mode !== mode ||
        response.stage !== "paint-proven" ||
        (response.paintProof !== "frame-two" &&
          response.paintProof !== "guarded-fallback") ||
        !response.guarded ||
        !response.coverage
      ) {
        throw new EmulationPresentationUnavailableError(
          response.reason || "guard-not-paint-proven",
        );
      }
      return response.generation === lease.generation
        ? lease
        : { ...lease, generation: response.generation };
    } catch (error) {
      await abortPresentation(tabId, lease).catch(() => undefined);
      throw error;
    }
  };
  const settlePresentation = async (
    tabId: number,
    lease: PresentationLease,
  ): Promise<void> => {
    let response: EmulationTransitionResult;
    try {
      response = await present(tabId, {
        phase: "settle",
        generation: lease.generation,
        mode: lease.mode,
        cause: lease.cause,
      });
    } catch (error) {
      const detail = error instanceof EmulationPresentationUnavailableError
        ? error.detail
        : error instanceof Error ? error.message : String(error);
      throw new EmulationPresentationUnavailableError(detail, true);
    }
    if (
      !response.ok ||
      response.generation !== lease.generation ||
      response.mode !== lease.mode ||
      response.stage !== "idle" ||
      (response.paintProof !== "frame-two" &&
        response.paintProof !== "guarded-fallback") ||
      response.guarded ||
      !response.exactGeometry
    ) {
      const guardedHandoffGeneration =
        !response.ok &&
        response.reason === "stale-generation" &&
        response.mode === lease.mode &&
        Number.isSafeInteger(response.generation) &&
        response.generation > 0 &&
        response.generation > lease.generation &&
        (response.stage === "guarding" || response.stage === "paint-proven") &&
        response.guarded &&
        response.coverage
          ? response.generation
          : null;
      throw new EmulationPresentationUnavailableError(
        response.reason || "exact-presentation-not-settled",
        true,
        guardedHandoffGeneration,
      );
    }
  };
  const recordFor = (tabId: number, held: HeldPosture): EmulationPostureRecord => {
    const safe = safeFittedScales.get(tabId);
    return {
      tabId,
      mode: held.mode,
      maximumScale: held.scale,
      ...(safe?.mode === held.mode ? { fittedScale: safe.scale } : {}),
      ...(held.suspended ? { suspended: true } : {}),
      revision: held.revision,
    };
  };
  const adoptDurableRecord = (
    record: EmulationPostureRecord,
    expectedEpoch: number,
  ): HeldPosture | undefined => {
    const tabId = record.tabId;
    postureRevisions.set(tabId, Math.max(postureRevisions.get(tabId) ?? 0, record.revision));
    if (heldPostures.has(tabId) || (postureEpochs.get(tabId) ?? 0) !== expectedEpoch) {
      return heldPostures.get(tabId);
    }
    const held: HeldPosture = {
      mode: record.mode,
      scale: record.maximumScale,
      suspended: record.suspended === true,
      revision: record.revision,
      epoch: nextPostureEpoch(tabId),
    };
    heldPostures.set(tabId, held);
    if (!held.suspended && (input.ownerActive?.(tabId) ?? true)) {
      scheduleLeaseWatchdog(tabId);
    }
    if (record.fittedScale !== undefined) {
      safeFittedScales.set(tabId, {
        mode: record.mode,
        scale: Math.min(record.maximumScale, record.fittedScale),
      });
    } else {
      safeFittedScales.delete(tabId);
    }
    return held;
  };
  const hydratePosture = (tabId: number): Promise<HeldPosture | undefined> => {
    const held = heldPostures.get(tabId);
    if (held || hydratedTabs.has(tabId) || !input.postureRepo) {
      hydratedTabs.add(tabId);
      return Promise.resolve(held);
    }
    const existing = hydrationOperations.get(tabId);
    if (existing) return existing;
    const expectedEpoch = postureEpochs.get(tabId) ?? 0;
    const hydration = input.postureRepo.load(tabId).then((stored) => {
      hydratedTabs.add(tabId);
      if (!stored.ok || !stored.value) return heldPostures.get(tabId);
      return adoptDurableRecord(stored.value, expectedEpoch);
    }).catch(() => {
      hydratedTabs.add(tabId);
      return heldPostures.get(tabId);
    }).finally(() => {
      hydrationOperations.delete(tabId);
    });
    hydrationOperations.set(tabId, hydration);
    return hydration;
  };
  const persistPosture = async (tabId: number, held: HeldPosture): Promise<void> => {
    if (!input.postureRepo || !postureIsCurrent(tabId, held)) return;
    await input.postureRepo.save(recordFor(tabId, held));
    if (!postureIsCurrent(tabId, held)) {
      const current = heldPostures.get(tabId);
      if (current) await input.postureRepo.save(recordFor(tabId, current));
    }
  };
  const rememberSafeFittedScale = async (
    tabId: number,
    held: HeldPosture,
    scale: number,
  ): Promise<void> => {
    if (!postureIsCurrent(tabId, held)) return;
    safeFittedScales.set(tabId, { mode: held.mode, scale });
    // Desired posture was persisted before the first CDP mutation. Enriching
    // that record with the proven compositor fit is best-effort here: losing a
    // worker before this small write merely forces conservative remeasurement,
    // while rolling back an already exact visible posture would create churn.
    await persistPosture(tabId, held).catch(() => undefined);
  };
  const safeScaleCeiling = (tabId: number, held: HeldPosture): number => {
    const safe = safeFittedScales.get(tabId);
    return safe?.mode === held.mode
      ? Math.min(held.scale, safe.scale)
      : held.scale;
  };
  const invalidateGeometry = (tabId: number): number => {
    const burst = refitBursts.get(tabId);
    if (burst?.quietTimer !== undefined) clearTimeout(burst.quietTimer);
    refitBursts.delete(tabId);
    const coordinator = refitCoordinators.get(tabId);
    if (coordinator && !coordinator.pending && !coordinator.processing) {
      refitCoordinators.delete(tabId);
    }
    return nextGeometryGeneration(tabId);
  };
  const clearRefitTimer = (tabId: number): void => {
    invalidateGeometry(tabId);
    const coordinator = refitCoordinators.get(tabId);
    if (coordinator) {
      coordinator.pending = null;
      if (!coordinator.processing) {
        refitCoordinators.delete(tabId);
      }
    }
    lastPhysicalSignatures.delete(tabId);
  };
  const cancelReassertRetry = (tabId: number): void => {
    const timer = reassertRetryTimers.get(tabId);
    if (timer !== undefined) {
      clearTimeout(timer);
      reassertRetryTimers.delete(tabId);
    }
    reassertRetryAttempts.delete(tabId);
  };
  const cancelLeaseWatchdog = (tabId: number): void => {
    const timer = leaseWatchdogTimers.get(tabId);
    if (timer !== undefined) {
      clearTimeout(timer);
      leaseWatchdogTimers.delete(tabId);
    }
  };
  const retireActiveRuntimeState = (
    tabId: number,
    options: Readonly<{ preserveSafeScale?: boolean }> = {},
  ): void => {
    cancelLeaseWatchdog(tabId);
    cancelReassertRetry(tabId);
    clearRefitTimer(tabId);
    verifiedPostures.delete(tabId);
    pendingCompositorPrefits.delete(tabId);
    if (options.preserveSafeScale !== true) {
      safeFittedScales.delete(tabId);
    }
    lastPhysicalViewports.delete(tabId);
    projectedPhysicalViewports.delete(tabId);
    const windowId = tabWindowIds.get(tabId);
    tabWindowIds.delete(tabId);
    if (
      windowId !== undefined &&
      ![...tabWindowIds.values()].includes(windowId)
    ) {
      lastWindowBounds.delete(windowId);
    }
  };
  const releasePosture = (tabId: number): void => {
    // Retire the standing lease before any intentional debugger detach. A
    // trailing watchdog must never resurrect a posture the operator released.
    retireActiveRuntimeState(tabId);
    pendingSuspensionReleases.delete(tabId);
    nextPostureEpoch(tabId);
    heldPostures.delete(tabId);
  };
  const normalizedWindowBounds = (
    window: Readonly<{ width?: number; height?: number }> | null | undefined,
  ): Readonly<{ width: number; height: number }> | null => {
    const width = Number(window?.width);
    const height = Number(window?.height);
    return Number.isFinite(width) && width > 0 &&
      Number.isFinite(height) && height > 0
      ? { width, height }
      : null;
  };
  const readWindowBounds = async (
    windowId: number,
  ): Promise<Readonly<{ width: number; height: number }> | null> => {
    if (!input.windows?.get) return null;
    try {
      const window = await invokeBrowserApi<Readonly<{
        id?: number;
        width?: number;
        height?: number;
      }>>(
        () => input.windows!.get!(windowId) as Promise<Readonly<{
          id?: number;
          width?: number;
          height?: number;
        }>> | void,
        (callback) => input.windows!.get!(windowId, {}, callback),
        "Window bounds read",
      );
      if (window?.id !== undefined && window.id !== windowId) return null;
      const bounds = normalizedWindowBounds(window);
      if (bounds) lastWindowBounds.set(windowId, bounds);
      return bounds;
    } catch {
      return null;
    }
  };
  const visibleTabViewport = async (
    tabId: number,
    hint?: EmulationPhysicalViewportHint,
  ): Promise<PhysicalViewport | null> => {
    if (!input.tabs?.get) {
      return null;
    }
    try {
      const tab = await invokeBrowserApi<Readonly<{
        width?: number;
        height?: number;
        windowId?: number;
      }>>(
        () => input.tabs!.get!(tabId) as Promise<Readonly<{
          width?: number;
          height?: number;
          windowId?: number;
        }>> | void,
        (callback) => input.tabs!.get!(tabId, callback),
        "Tab viewport read",
      );
      const width = Number(tab?.width);
      const height = Number(tab?.height);
      if (Number.isInteger(tab?.windowId)) {
        const windowId = Number(tab?.windowId);
        const priorWindowId = tabWindowIds.get(tabId);
        if (priorWindowId !== undefined && priorWindowId !== windowId) {
          lastPhysicalViewports.delete(tabId);
          projectedPhysicalViewports.delete(tabId);
        }
        tabWindowIds.set(tabId, windowId);
        if (priorWindowId !== windowId || !lastWindowBounds.has(windowId)) {
          await readWindowBounds(windowId);
        }
      }
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      const hintedHeight = Number(hint?.height);
      const viewport = {
        width,
        height: Number.isFinite(hintedHeight) && hintedHeight > 0
          ? Math.min(height, hintedHeight)
          : height,
      };
      lastPhysicalViewports.set(tabId, viewport);
      projectedPhysicalViewports.delete(tabId);
      return viewport;
    } catch {
      return null;
    }
  };
  const intersectPhysicalViewports = (
    first: PhysicalViewport | null,
    second: PhysicalViewport | null,
  ): PhysicalViewport | null => {
    if (!first || !second) return null;
    return {
      width: Math.min(first.width, second.width),
      height: Math.min(first.height, second.height),
    };
  };
  /** A full posture write is a visible transition, so it gets two independent
   * browser samples and uses only their safe intersection. Same-mode refits stay
   * single-sample and are protected by their generation-fenced trailing proof. */
  const transitionPhysicalViewport = async (
    tabId: number,
    hint?: EmulationPhysicalViewportHint,
  ): Promise<PhysicalViewport | null> => {
    const first = await visibleTabViewport(tabId, hint);
    await Promise.resolve();
    const second = await visibleTabViewport(tabId, hint);
    return intersectPhysicalViewports(first, second);
  };
  /** Reasons the operator did not choose. A closing tab has nothing to restore, and
   *  a replaced target means the tab is being taken over by something else. */
  // A DevTools replacement is still an operator attempt to take down the held
  // simulation, not permission to forget the product posture. Reassert it just
  // like Chrome's explicit `canceled_by_user` detach; only a dead target is
  // terminal.
  const TERMINAL_DETACH_REASONS = new Set(["target_closed"]);
  input.debuggerApi?.onDetach?.addListener((source, reason) => {
    const tabId = source.tabId;
    if (typeof tabId !== "number") {
      return;
    }
    input.onDebuggerDetached?.(tabId, reason);
    attachedTabs.delete(tabId);
    realUserAgents.delete(tabId);
    verifiedPostures.delete(tabId);
    pendingCompositorPrefits.delete(tabId);
    invalidateGeometry(tabId);
    if (reason && TERMINAL_DETACH_REASONS.has(reason)) {
      releasePosture(tabId);
      hydratedTabs.add(tabId);
      void input.postureRepo?.clear(tabId).catch(() => undefined);
      return;
    }
    // Detaching drops every override at once — viewport, identity, the lot — so a
    // dismissed debugging banner silently returns the tab to a desktop-shaped page
    // the operator is still marking against. Re-establish it rather than waiting
    // for the next thing that happens to re-apply.
    void hydratePosture(tabId).then((held) => {
      if (held && postureIsActive(tabId, held)) {
        void reassertPosture(tabId, held, "debugger-detach");
      }
    });
  });
  const targetFor = (tabId: number): Debuggee => ({ tabId });
  const attach = async (tabId: number): Promise<void> => {
    const debuggerApi = input.debuggerApi;
    if (!debuggerApi) {
      throw new Error("Debugger API unavailable");
    }
    const target = targetFor(tabId);
    if (!attachedTabs.has(tabId)) {
      await invokeBrowserApi<void>(
        () => debuggerApi.attach(target, "1.3"),
        (callback) => debuggerApi.attach(target, "1.3", callback),
        "Debugger attach",
      );
      attachedTabs.add(tabId);
    }
  };
  const send = async (tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const debuggerApi = input.debuggerApi;
    if (!debuggerApi) {
      throw new Error("Debugger API unavailable");
    }
    const target = targetFor(tabId);
    await attach(tabId);
    try {
      return await invokeBrowserApi<unknown>(
        () => debuggerApi.sendCommand(target, method, params) as Promise<unknown> | void,
        (callback) => debuggerApi.sendCommand(target, method, params, callback),
        `Debugger command ${method}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/not attached|detached|target closed|debugger is not attached|cannot access.*debugger/i.test(message)) {
        throw error;
      }
      attachedTabs.delete(tabId);
      await attach(tabId);
      return await invokeBrowserApi<unknown>(
        () => debuggerApi.sendCommand(target, method, params) as Promise<unknown> | void,
        (callback) => debuggerApi.sendCommand(target, method, params, callback),
        `Debugger command ${method}`,
      );
    }
  };
  /**
   * `onDetach` is the immediate authority when Chrome/user/DevTools terminates
   * our session. Chromium intentionally does not emit it when the extension
   * itself calls debugger.detach(), though, and a missed host event must not let
   * a cached scale-only proof preserve dimensions while touch/media/UA have
   * already fallen back. getTargets is browser-owned and does not schedule work
   * in the inspected document, so it is safe on the hot pre-capture path.
   */
  const debuggerAttachmentIsCurrent = async (tabId: number): Promise<boolean> => {
    const getTargets = input.debuggerApi?.getTargets;
    if (!getTargets) {
      return attachedTabs.has(tabId);
    }
    try {
      const targets = await invokeBrowserApi<readonly DebugTargetInfo[]>(
        () => getTargets.call(input.debuggerApi),
        (callback) => getTargets.call(input.debuggerApi, callback),
        "Debugger target read",
      );
      const attached = targets?.some((target) =>
        target.tabId === tabId && target.attached === true) === true;
      if (attached) {
        attachedTabs.add(tabId);
      } else {
        attachedTabs.delete(tabId);
        realUserAgents.delete(tabId);
        verifiedPostures.delete(tabId);
      }
      return attached;
    } catch {
      // A transient enumeration failure is not evidence that Chrome discarded
      // the posture. The next refit/current check retries, while a real browser
      // detach still has the synchronous onDetach fence above.
      return attachedTabs.has(tabId);
    }
  };
  const sendEmulationCommand = async (
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> => {
    try {
      return await send(tabId, method, params);
    } catch (error) {
      // Some Chromium builds apply touch emulation but never acknowledge this
      // particular command. Device metrics and the coarse-pointer media posture
      // are independently authoritative, so a bounded missing acknowledgement
      // must not wedge or abort the whole transition. Every other CDP command
      // remains terminal on timeout.
      if (
        method === "Emulation.setTouchEmulationEnabled" &&
        error instanceof Error &&
        /timed out/i.test(error.message)
      ) {
        return undefined;
      }
      throw error;
    }
  };
  const validCompositorPrefit = (
    tabId: number,
    held: HeldPosture,
    mode: EmulationMode,
    scale: number,
  ): boolean => {
    const verified = verifiedPostures.get(tabId);
    return postureIsActive(tabId, held) &&
      attachedTabs.has(tabId) &&
      verified?.active === true &&
      verified.mode === held.mode &&
      mode === held.mode &&
      Number.isFinite(scale) &&
      scale >= 0.01 &&
      scale <= Math.min(held.scale, verified.scale) + 0.001;
  };
  const rememberCompositorPrefit = (
    tabId: number,
    held: HeldPosture,
    mode: EmulationMode,
    scale: number,
    completion: Promise<boolean>,
  ): boolean => {
    if (!validCompositorPrefit(tabId, held, mode, scale)) return false;
    const pending: PendingCompositorPrefit = {
      held,
      mode,
      scale,
      completion,
    };
    pendingCompositorPrefits.set(tabId, pending);
    void completion.then((completed) => {
      if (!completed && pendingCompositorPrefits.get(tabId) === pending) {
        pendingCompositorPrefits.delete(tabId);
      }
    });
    return true;
  };
  const startCompositorPrefit = (
    tabId: number,
    held: HeldPosture,
    scale: number,
  ): boolean => {
    const debuggerApi = input.debuggerApi;
    if (!debuggerApi || !validCompositorPrefit(tabId, held, held.mode, scale)) {
      return false;
    }
    const preset = DEVICE_EMULATION_PRESETS[held.mode];
    const params = {
      width: preset.width,
      height: preset.height,
      deviceScaleFactor: 1,
      mobile: held.mode === "mobile",
      scale,
    };
    let completion: Promise<boolean>;
    try {
      completion = (apiMode === "promise"
        ? Promise.resolve(debuggerApi.sendCommand(
            targetFor(tabId),
            "Emulation.setDeviceMetricsOverride",
            params,
          ))
        : callbackToPromise(
            (callback) => debuggerApi.sendCommand(
              targetFor(tabId),
              "Emulation.setDeviceMetricsOverride",
              params,
              callback,
            ),
            apiTimeoutMs,
            "Debugger compositor prefit",
          )
      ).then(() => true, () => false);
    } catch {
      return false;
    }
    return rememberCompositorPrefit(
      tabId,
      held,
      held.mode,
      scale,
      completion,
    );
  };
  const adoptPendingCompositorPrefit = async (
    tabId: number,
    held: HeldPosture,
    verified: VerifiedEmulationState,
  ): Promise<VerifiedEmulationState> => {
    const pending = pendingCompositorPrefits.get(tabId);
    if (!pending || pending.held !== held || pending.mode !== held.mode) {
      return verified;
    }
    if (pendingCompositorPrefits.get(tabId) === pending) {
      pendingCompositorPrefits.delete(tabId);
    }
    const completed = await pending.completion;
    if (!completed || !postureIsCurrent(tabId, held)) return verified;
    const preset = DEVICE_EMULATION_PRESETS[held.mode];
    return {
      ...verified,
      mode: held.mode,
      width: preset.width,
      height: preset.height,
      scale: pending.scale,
      active: true,
      identityStale: false,
    };
  };
  const detach = async (tabId: number): Promise<void> => {
    if (!input.debuggerApi) return;
    try {
      await invokeBrowserApi<void>(
        () => input.debuggerApi?.detach(targetFor(tabId)),
        (callback) => input.debuggerApi?.detach(targetFor(tabId), callback),
        "Debugger detach",
      );
    } finally {
      attachedTabs.delete(tabId);
    }
  };
  const realUserAgentFor = async (tabId: number): Promise<string> => {
    const known = realUserAgents.get(tabId);
    if (known !== undefined) {
      return known;
    }
    try {
      const result = await send(tabId, "Runtime.evaluate", {
        expression: "navigator.userAgent",
        returnByValue: true,
      });
      const value = (result as { result?: { value?: unknown } } | undefined)?.result?.value;
      const userAgent = typeof value === "string" ? value : "";
      // Only a real answer is cached. Caching the empty one looked like a way to
      // avoid re-probing a page that cannot be evaluated, but the probe can fail
      // transiently — a debugger that has only just attached, a document still
      // loading — and a cached failure then disables the spoof for the life of the
      // tab. One extra evaluate per apply is the cheaper mistake.
      if (userAgent) {
        realUserAgents.set(tabId, userAgent);
      }
      return userAgent;
    } catch {
      // Runtime.evaluate depends on the renderer's main thread. A page can
      // starve it while the browser-level CDP target remains healthy, so use
      // Chrome's own version response before giving up on identity emulation.
      try {
        const version = await send(tabId, "Browser.getVersion") as { userAgent?: unknown } | undefined;
        const userAgent = typeof version?.userAgent === "string" ? version.userAgent : "";
        if (userAgent) {
          realUserAgents.set(tabId, userAgent);
        }
        return userAgent;
      } catch {
        return "";
      }
    }
  };
  const intendedUserAgentFor = (mode: EmulationMode, realUserAgent: string): string =>
    mode === "mobile" ? deriveGooglebotSmartphoneUserAgent(realUserAgent) : realUserAgent;
  const measurePosture = async (tabId: number): Promise<MeasuredEmulationPosture | null> => {
    try {
      const result = await send(tabId, "Runtime.evaluate", {
        expression: EMULATION_PROOF_EXPRESSION,
        returnByValue: true,
      });
      return measuredEmulationPosture(
        (result as { result?: { value?: unknown } } | undefined)?.result?.value,
      );
    } catch {
      return null;
    }
  };
  const waitForBrowserFrame = async (tabId: number): Promise<void> => {
    await send(tabId, "Runtime.evaluate", {
      expression: AFTER_BROWSER_FRAME_EXPRESSION,
      awaitPromise: true,
      returnByValue: true,
    });
  };
  /** Native posture release cannot depend on a page rAF: Chromium can throttle
   * the inspected renderer as soon as its side panel disappears. A surface
   * screenshot is a browser/compositor acknowledgement and therefore proves a
   * completed presentation turn without waiting on page-main-thread work. The
   * response is deliberately a low-quality one-pixel clip and is discarded, so
   * this scheduling proof never retains meaningful page imagery. */
  const waitForBrowserCompositorFrame = async (tabId: number): Promise<void> => {
    const result = await send(tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 1,
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
    }) as { data?: unknown } | undefined;
    if (typeof result?.data !== "string" || result.data.length === 0) {
      throw new Error("Browser compositor frame acknowledgement was empty");
    }
  };
  const waitForClearedBrowserCompositorTurns = async (tabId: number): Promise<void> => {
    await waitForBrowserCompositorFrame(tabId);
    await waitForBrowserCompositorFrame(tabId);
  };
  const proveCurrentPosture = async (
    tabId: number,
    state: EmulationState,
    intendedUserAgent: string,
    hint?: EmulationPhysicalViewportHint,
  ): Promise<Readonly<{
    measured: MeasuredEmulationPosture | null;
    failureReason: EmulationFailureReason | null;
  }>> => {
    const measured = await measurePosture(tabId);
    const documentFailure = proveEmulationPosture(state, measured, intendedUserAgent);
    // Physical clipping outranks every document-level mismatch. In particular,
    // an identity-stale document may need a reload, but its replacement must
    // inherit a scale already proven safe for the visible browser rectangle.
    if (!physicalViewportFits(state, await visibleTabViewport(tabId, hint))) {
      return { measured, failureReason: "physical_fit_mismatch" };
    }
    return {
      measured,
      failureReason: documentFailure,
    };
  };
  const writeMetricsScale = async (
    tabId: number,
    held: HeldPosture,
    scale: number,
  ): Promise<void> => {
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    const preset = DEVICE_EMULATION_PRESETS[held.mode];
    await sendEmulationCommand(tabId, "Emulation.setDeviceMetricsOverride", {
      width: preset.width,
      height: preset.height,
      deviceScaleFactor: 1,
      mobile: held.mode === "mobile",
      scale,
    });
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
  };
  const correctLatePhysicalShrink = async <State extends EmulationState>(
    tabId: number,
    held: HeldPosture,
    state: State,
    hint?: EmulationPhysicalViewportHint,
  ): Promise<State> => {
    const viewport = await visibleTabViewport(tabId, hint);
    if (!viewport) return state;
    const fitted = fitDeviceScale(
      held.mode,
      viewport,
      Math.min(held.scale, state.scale),
    );
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    if (fitted >= state.scale - 0.001) return state;
    await writeMetricsScale(tabId, held, fitted);
    return { ...state, scale: fitted };
  };
  const writePosture = async (
    tabId: number,
    held: HeldPosture,
    realUserAgent: string,
    hint?: EmulationPhysicalViewportHint,
  ): Promise<EmulationState> => {
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    const ceiling = safeScaleCeiling(tabId, held);
    const transitionViewport = await transitionPhysicalViewport(tabId, hint);
    if (!transitionViewport) throw new PhysicalViewportUnavailableError();
    const sampledScale = fitDeviceScale(held.mode, transitionViewport, ceiling);
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    // One final browser-owned sample sits immediately before the first visible
    // metrics mutation and may only reduce the already conservative transition
    // fit. It cannot introduce the scale-1/oversize frame this fence prevents.
    const finalViewport = await visibleTabViewport(tabId, hint);
    if (!finalViewport) throw new PhysicalViewportUnavailableError();
    const scale = fitDeviceScale(
      held.mode,
      finalViewport,
      Math.min(ceiling, sampledScale),
    );
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    const state = await applyEmulationViaCdp(
      {
        async send(method, params) {
          if (!postureIsCurrent(tabId, held)) {
            throw new Error("Emulation posture was released");
          }
          const result = await sendEmulationCommand(tabId, method, params);
          if (!postureIsCurrent(tabId, held)) {
            throw new Error("Emulation posture was released");
          }
          return result;
        },
      },
      held.mode,
      scale,
      { realUserAgent, physicalSafetyScale: true },
    );
    return await correctLatePhysicalShrink(tabId, held, state, hint);
  };
  const writeScaleOnlyRefit = async (
    tabId: number,
    held: HeldPosture,
    prior: VerifiedEmulationState,
    scale: number,
    hint?: EmulationPhysicalViewportHint,
  ): Promise<VerifiedEmulationState> => {
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    const preset = DEVICE_EMULATION_PRESETS[held.mode];
    const prefit = pendingCompositorPrefits.get(tabId);
    const matchingPrefit = prefit?.held === held &&
      prefit.mode === held.mode
      ? prefit
      : null;
    let appliedScale = scale;
    if (matchingPrefit) {
      if (pendingCompositorPrefits.get(tabId) === matchingPrefit) {
        pendingCompositorPrefits.delete(tabId);
      }
      const completed = await matchingPrefit.completion;
      if (completed && matchingPrefit.scale <= scale + 0.001) {
        // A conservative speculative scale remains safe even when a stale
        // projection undershot the fresh fit. Retain it until the ordinary
        // trailing-growth fence converges instead of immediately oscillating.
        appliedScale = Math.min(scale, matchingPrefit.scale);
      } else {
        await writeMetricsScale(tabId, held, scale);
      }
    } else {
      if (prefit?.held === held && pendingCompositorPrefits.get(tabId) === prefit) {
        pendingCompositorPrefits.delete(tabId);
      }
      await writeMetricsScale(tabId, held, scale);
    }
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    let state: VerifiedEmulationState = {
      ...prior,
      mode: held.mode,
      width: preset.width,
      height: preset.height,
      scale: appliedScale,
      active: true,
      identityStale: false,
    };
    state = await correctLatePhysicalShrink(tabId, held, state, hint);
    const realUserAgent = await realUserAgentFor(tabId);
    let failureReason: EmulationFailureReason | null = null;
    for (let frame = 0; frame < 3 && postureIsCurrent(tabId, held); frame += 1) {
      const proof = await proveCurrentPosture(
        tabId,
        state,
        intendedUserAgentFor(held.mode, realUserAgent),
        hint,
      );
      failureReason = proof.failureReason;
      if (failureReason === null) return state;
      if (failureReason === "physical_fit_mismatch") {
        state = await correctLatePhysicalShrink(tabId, held, state, hint);
      }
      await waitForBrowserFrame(tabId).catch(() => undefined);
    }
    throw new Error(`Emulation refit proof failed: ${failureReason ?? "proof_unavailable"}`);
  };
  const writeAndProvePosture = async (
    tabId: number,
    held: HeldPosture,
    realUserAgent: string,
    hint?: EmulationPhysicalViewportHint,
  ): Promise<Readonly<{
    state: EmulationState;
    measured: MeasuredEmulationPosture | null;
    failureReason: EmulationFailureReason | null;
  }>> => {
    let state = await writePosture(tabId, held, realUserAgent, hint);
    let exact = await proveCurrentPosture(
      tabId,
      state,
      intendedUserAgentFor(held.mode, realUserAgent),
      hint,
    );
    let measured = exact.measured;
    let failureReason = exact.failureReason;
    if (failureReason === "physical_fit_mismatch" && postureIsCurrent(tabId, held)) {
      // Geometry movement is not loss of the complete emulation identity. Keep
      // correction on the metrics-only path and never churn UA/touch/media.
      for (let sample = 0; sample < 3 && failureReason === "physical_fit_mismatch"; sample += 1) {
        state = await correctLatePhysicalShrink(tabId, held, state, hint);
        exact = await proveCurrentPosture(
          tabId,
          state,
          intendedUserAgentFor(held.mode, realUserAgent),
          hint,
        );
        measured = exact.measured;
        failureReason = exact.failureReason;
      }
    }
    if (
      failureReason !== null &&
      failureReason !== "physical_fit_mismatch" &&
      postureIsCurrent(tabId, held)
    ) {
      // The renderer/compositor boundary can trail the CDP acknowledgement by a
      // frame. Re-write the complete serialized posture once, then give that
      // replacement write a bounded sequence of presentation opportunities
      // before proving it.
      // Measuring immediately after the rewrite can observe Chrome's transient
      // desktop-scrollbar layout viewport even though the mobile viewport is
      // already physically exact. Some documents need several compositor turns
      // before window.innerWidth catches up. We never rewrite again, stop at the
      // first exact proof, and treat a mismatch after four frames as evidence.
      await waitForBrowserFrame(tabId).catch(() => undefined);
      if (postureIsCurrent(tabId, held)) {
        state = await writePosture(tabId, held, realUserAgent, hint);
        for (let frame = 0; frame < 4 && postureIsCurrent(tabId, held); frame += 1) {
          await waitForBrowserFrame(tabId).catch(() => undefined);
          exact = await proveCurrentPosture(
            tabId,
            state,
            intendedUserAgentFor(held.mode, realUserAgent),
            hint,
          );
          measured = exact.measured;
          failureReason = exact.failureReason;
          if (failureReason === null) {
            break;
          }
        }
      }
    }
    return { state, measured, failureReason };
  };
  const writeProveAndPresentPosture = async (
    tabId: number,
    held: HeldPosture,
    cause: EmulationTransitionCause,
    hint?: EmulationPhysicalViewportHint,
    preferredPresentationGeneration?: number,
  ): ReturnType<typeof writeAndProvePosture> => {
    // The content plane is confirmed opaque before even the first debugger
    // attach. Attaching can add Chrome's debugger infobar and shrink the
    // physical tab rectangle before device metrics are written.
    const presentation = await beginPresentation(
      tabId,
      held.mode,
      cause,
      preferredPresentationGeneration,
    );
    // A successfully admitted newer guard supersedes any terminal suspension
    // release whose acknowledgement was lost in an earlier worker turn.
    pendingSuspensionReleases.delete(tabId);
    const realUserAgent = await realUserAgentFor(tabId);
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    const proof = await writeAndProvePosture(tabId, held, realUserAgent, hint);
    if (proof.failureReason === null) {
      if (!postureIsActive(tabId, held)) {
        throw new Error("Emulation owner was released during transition");
      }
      try {
        await settlePresentation(tabId, presentation);
      } catch (error) {
        const physicalGuardSupersededApply =
          cause === "apply" &&
          error instanceof EmulationPresentationUnavailableError &&
          error.mutationPossible &&
          error.guardedHandoffGeneration !== null &&
          error.detail === "stale-generation" &&
          postureIsActive(tabId, held);
        if (!physicalGuardSupersededApply) throw error;

        // A physical viewport occurrence can synchronously replace the final
        // apply-retirement epoch with a newer opaque content generation. The
        // browser posture is already exact at this point, so restoring the
        // pre-resume suspended posture would clear CDP and expose native
        // geometry. Keep the exact proof and let the ordinary serialized refit
        // adopt and settle the newer generation after this operation exits.
        void Promise.resolve()
          .then(() => requestRefit(tabId, {
            source: "content",
            presentationGeneration: error.guardedHandoffGeneration ?? undefined,
            physicalBoundsChanged: true,
          }))
          .catch(() => {
            if (postureIsActive(tabId, held)) {
              scheduleReassertRetry(tabId, held);
            }
          });
      }
    }
    return proof;
  };
  const restorePriorPosture = async (
    tabId: number,
    attempted: HeldPosture,
    prior: HeldPosture | undefined,
  ): Promise<void> => {
    if (!postureIsCurrent(tabId, attempted)) {
      return;
    }
    if (prior?.suspended) {
      const presentation = await beginPresentation(
        tabId,
        prior.mode,
        "panel-suspend",
      );
      await projectContentLifecycleSuspended(tabId, true);
      const restored: HeldPosture = {
        mode: prior.mode,
        scale: prior.scale,
        suspended: true,
        revision: nextPostureRevision(tabId),
        epoch: nextPostureEpoch(tabId),
      };
      heldPostures.set(tabId, restored);
      try {
        await persistPosture(tabId, restored);
      } catch (error) {
        const retainedAttempt: HeldPosture = {
          ...attempted,
          epoch: nextPostureEpoch(tabId),
        };
        heldPostures.set(tabId, retainedAttempt);
        await projectContentLifecycleSuspended(tabId, false).catch(() => undefined);
        await abortPresentation(tabId, presentation).catch(() => undefined);
        scheduleLeaseWatchdog(tabId);
        throw error;
      }
      retireActiveRuntimeState(tabId, { preserveSafeScale: true });
      await clearEmulationViaCdp(
        { send: (method, params) => sendEmulationCommand(tabId, method, params) },
        {
          mode: attempted.mode,
          width: DEVICE_EMULATION_PRESETS[attempted.mode].width,
          height: DEVICE_EMULATION_PRESETS[attempted.mode].height,
          scale: attempted.scale,
          active: true,
        },
      ).catch(() => undefined);
      await waitForClearedBrowserCompositorTurns(tabId);
      // A failed detach is not proof of native browser posture. Keep the guard
      // opaque and the suspended durable intent for a later lifecycle retry.
      await detach(tabId);
      realUserAgents.delete(tabId);
      await releaseSuspendedPresentation(tabId, prior.mode, presentation);
      return;
    }
    if (prior) {
      const restored: HeldPosture = {
        mode: prior.mode,
        scale: prior.scale,
        suspended: prior.suspended,
        revision: nextPostureRevision(tabId),
        epoch: nextPostureEpoch(tabId),
      };
      heldPostures.set(tabId, restored);
      if (postureIsActive(tabId, restored)) scheduleLeaseWatchdog(tabId);
      try {
        await persistPosture(tabId, restored);
        const proof = await writeProveAndPresentPosture(
          tabId,
          restored,
          "restore",
        );
        if (proof.failureReason === null) {
          const verified: VerifiedEmulationState = {
            ...proof.state,
            active: true,
            identityStale: false,
          };
          verifiedPostures.set(tabId, verified);
          await rememberSafeFittedScale(tabId, restored, verified.scale);
          return;
        }
      } catch (error) {
        if (
          error instanceof PhysicalViewportUnavailableError &&
          postureIsCurrent(tabId, restored)
        ) {
          // A transient missing rectangle is not permission to clear the prior
          // held posture into a desktop flash. Retain and reinforce it once
          // browser geometry becomes readable again.
          scheduleReassertRetry(tabId, restored);
          return;
        }
        // Fall through to the neutral browser posture.
      }
    }
    // The failed attempted/prior write should already have retained an opaque
    // plane, but do not make that an assumption at the terminal neutralization
    // boundary. Re-adopt a fresh, paint-proven generation before any clear or
    // detach can expose browser-default geometry.
    const neutralPresentation = await beginPresentation(
      tabId,
      prior?.mode ?? attempted.mode,
      "restore",
    );
    // Do not neutralize the live debugger while a stale durable lease can still
    // resurrect on the next worker. Persistence must accept the terminal clear
    // before the browser posture is released.
    await input.postureRepo?.clear(tabId);
    releasePosture(tabId);
    try {
      await clearEmulationViaCdp(
        { send: (method, params) => sendEmulationCommand(tabId, method, params) },
        { mode: attempted.mode, width: 412, height: 960, scale: attempted.scale, active: true },
      );
      await waitForClearedBrowserCompositorTurns(tabId);
    } finally {
      await detach(tabId).catch(() => undefined);
      realUserAgents.delete(tabId);
      await releasePresentation(tabId, neutralPresentation);
    }
  };
  /** Puts a dropped posture back. Deliberately does not reload: the operator is
   *  looking at the page, and the identity for the current document was settled
   *  when it loaded — re-establishing the viewport is what is urgent here. */
  const executeReassertPosture = async (
    tabId: number,
    held: HeldPosture,
    hint?: EmulationPhysicalViewportHint,
    cause: EmulationTransitionCause = "lease-recovery",
    preferredPresentationGeneration?: number,
  ): Promise<void> => {
    if (!postureIsActive(tabId, held)) {
      return;
    }
    try {
      const proof = await writeProveAndPresentPosture(
        tabId,
        held,
        cause,
        hint,
        preferredPresentationGeneration,
      );
      if (proof.failureReason !== null) {
        throw new Error(`Emulation proof failed: ${proof.failureReason}`);
      }
      const verified: VerifiedEmulationState = {
        ...proof.state,
        active: true,
        identityStale: false,
      };
      verifiedPostures.set(tabId, verified);
      await rememberSafeFittedScale(tabId, held, verified.scale);
      cancelReassertRetry(tabId);
    } catch {
      // A live target can temporarily refuse attachment while Chrome is
      // replacing DevTools/debugger ownership. Retain the exact desired target
      // and keep reinforcing it; forgetting it here lets the next generic page
      // reconciliation establish the default mode and creates a visible flash.
      if (postureIsActive(tabId, held)) {
        verifiedPostures.delete(tabId);
        scheduleReassertRetry(tabId, held);
      }
    }
  };
  function scheduleReassertRetry(tabId: number, held: HeldPosture): void {
    if (!postureIsActive(tabId, held) || reassertRetryTimers.has(tabId)) {
      return;
    }
    const attempt = reassertRetryAttempts.get(tabId) ?? 0;
    const delay = REASSERT_RETRY_DELAYS_MS[
      Math.min(attempt, REASSERT_RETRY_DELAYS_MS.length - 1)
    ]!;
    reassertRetryAttempts.set(tabId, attempt + 1);
    const timer = setTimeout(() => {
      reassertRetryTimers.delete(tabId);
      if (postureIsActive(tabId, held)) {
        void reassertPosture(tabId, held);
      }
    }, delay);
    reassertRetryTimers.set(tabId, timer);
  }
  const reassertPosture = (
    tabId: number,
    held: HeldPosture,
    cause: EmulationTransitionCause = "lease-recovery",
  ): Promise<void> =>
    postureIsActive(tabId, held)
      ? withEmulationOperation(tabId, () => executeReassertPosture(tabId, held, undefined, cause))
      : Promise.resolve();
  const coordinatorFor = (tabId: number): RefitCoordinator => {
    const existing = refitCoordinators.get(tabId);
    if (existing) return existing;
    const coordinator: RefitCoordinator = {
      pending: null,
      processing: null,
      version: 0,
      physicalGuardAdmission: null,
    };
    refitCoordinators.set(tabId, coordinator);
    return coordinator;
  };
  const createPhysicalGuardAdmission = (
    held: HeldPosture,
    firstCandidate: Promise<number | null>,
  ): PhysicalGuardAdmission => {
    let settled = false;
    let pendingCandidates = 0;
    let resolveGeneration: (generation: number | null) => void = () => undefined;
    const generation = new Promise<number | null>((resolve) => {
      resolveGeneration = resolve;
    });
    const settle = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveGeneration(value);
    };
    const timer = setTimeout(() => {
      settle(null);
    }, PHYSICAL_VIEWPORT_GUARD_ADMISSION_TIMEOUT_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    const admission: PhysicalGuardAdmission = {
      held,
      generation,
      add(candidate) {
        if (settled) return;
        pendingCandidates += 1;
        const rejectCandidate = (): void => {
          if (settled) return;
          pendingCandidates -= 1;
          if (pendingCandidates === 0) {
            // Let same-turn bounds observations join before concluding that
            // every available admission lane failed.
            queueMicrotask(() => {
              if (!settled && pendingCandidates === 0) settle(null);
            });
          }
        };
        void candidate.then(
          (value) => {
            if (settled) return;
            if (Number.isSafeInteger(value) && Number(value) > 0) {
              settle(Number(value));
              return;
            }
            rejectCandidate();
          },
          rejectCandidate,
        );
      },
    };
    admission.add(firstCandidate);
    return admission;
  };
  const publishPhysicalGuardAdmission = (
    tabId: number,
    held: HeldPosture,
    candidate: Promise<number | null>,
  ): PhysicalGuardAdmission => {
    const coordinator = coordinatorFor(tabId);
    const current = coordinator.physicalGuardAdmission;
    if (current?.held === held) {
      if (current.generation !== candidate) current.add(candidate);
      return current;
    }
    const admission = createPhysicalGuardAdmission(held, candidate);
    coordinator.physicalGuardAdmission = admission;
    return admission;
  };
  const firstValidPhysicalGuardGeneration = (
    first: Promise<number | null>,
    second: Promise<number | null>,
  ): Promise<number | null> => new Promise((resolve) => {
    let settled = false;
    let remaining = 2;
    const accept = (generation: number | null): void => {
      if (settled) return;
      if (Number.isSafeInteger(generation) && Number(generation) > 0) {
        settled = true;
        resolve(Number(generation));
        return;
      }
      remaining -= 1;
      if (remaining === 0) resolve(null);
    };
    void first.then(accept, () => accept(null));
    void second.then(accept, () => accept(null));
  });
  const mergeRefitObservation = (
    current: EmulationRefitObservation | null,
    next: EmulationRefitObservation,
  ): EmulationRefitObservation => {
    if (!current) return next;
    const currentGeneration = current.presentationGeneration ?? 0;
    const nextGeneration = next.presentationGeneration ?? 0;
    const presentationGeneration = Math.max(currentGeneration, nextGeneration);
    const hasContentAuthority =
      current.source === "content" ||
      next.source === "content";
    const currentProjection = current.projectedPhysicalViewport &&
        current.projectedPostureEpoch !== undefined
      ? {
          viewport: current.projectedPhysicalViewport,
          epoch: current.projectedPostureEpoch,
        }
      : null;
    const nextProjection = next.projectedPhysicalViewport &&
        next.projectedPostureEpoch !== undefined
      ? {
          viewport: next.projectedPhysicalViewport,
          epoch: next.projectedPostureEpoch,
        }
      : null;
    const mergedProjection = currentProjection && nextProjection
      ? currentProjection.epoch === nextProjection.epoch
        ? {
            viewport: {
              width: Math.min(
                currentProjection.viewport.width,
                nextProjection.viewport.width,
              ),
              height: Math.min(
                currentProjection.viewport.height,
                nextProjection.viewport.height,
              ),
            },
            epoch: currentProjection.epoch,
          }
        : null
      : nextProjection ?? currentProjection;
    const physicalBoundsChanged =
      current.physicalBoundsChanged === true ||
      next.physicalBoundsChanged === true;
    const physicalGuardGeneration = current.physicalGuardGeneration &&
        next.physicalGuardGeneration
      ? firstValidPhysicalGuardGeneration(
          current.physicalGuardGeneration,
          next.physicalGuardGeneration,
        )
      : next.physicalGuardGeneration ?? current.physicalGuardGeneration;
    return {
      source: hasContentAuthority ? "content" : next.source,
      ...(presentationGeneration > 0 ? { presentationGeneration } : {}),
      ...(next.physicalViewportHint ?? current.physicalViewportHint
        ? {
            physicalViewportHint:
              next.physicalViewportHint ?? current.physicalViewportHint,
          }
        : {}),
      ...(mergedProjection
        ? {
            projectedPhysicalViewport: mergedProjection.viewport,
            projectedPostureEpoch: mergedProjection.epoch,
          }
        : {}),
      ...(physicalBoundsChanged ? { physicalBoundsChanged: true } : {}),
      ...(physicalGuardGeneration ? { physicalGuardGeneration } : {}),
    };
  };
  const adoptPhysicalGuardAdmission = async (
    tabId: number,
    held: HeldPosture,
    observation: EmulationRefitObservation,
  ): Promise<EmulationRefitObservation> => {
    const coordinator = coordinatorFor(tabId);
    let sharedAdmission = coordinator.physicalGuardAdmission;
    if (
      observation.physicalGuardGeneration &&
      sharedAdmission?.generation !== observation.physicalGuardGeneration
    ) {
      sharedAdmission = publishPhysicalGuardAdmission(
        tabId,
        held,
        observation.physicalGuardGeneration,
      );
    }
    const sharedGeneration = sharedAdmission?.held === held
      ? sharedAdmission.generation
      : undefined;
    const generationPromise = sharedGeneration ??
      observation.physicalGuardGeneration;
    if (!generationPromise) return observation;
    const physicalGeneration = await generationPromise.catch(() => null);
    if (
      !postureIsCurrent(tabId, held) ||
      !Number.isSafeInteger(physicalGeneration) ||
      Number(physicalGeneration) <= 0
    ) {
      return observation;
    }
    return {
      ...observation,
      source: "content",
      // An executor that started from an earlier side-panel/popup observation
      // must retain this physical occurrence as a burst. Otherwise it can
      // settle the newly adopted guard before the queued bounds observation
      // joins it, producing two fades for one resize. An observation already
      // carrying this retained generation keeps its own no-op semantics.
      ...(observation.source === "content" &&
          observation.presentationGeneration !== undefined
        ? {}
        : { physicalBoundsChanged: true }),
      presentationGeneration: Math.max(
        observation.presentationGeneration ?? 0,
        Number(physicalGeneration),
      ),
    };
  };
  const beginRefitPresentation = async (
    tabId: number,
    held: HeldPosture,
    observation: EmulationRefitObservation,
  ): Promise<PresentationLease> => {
    const admittedObservation = await adoptPhysicalGuardAdmission(
      tabId,
      held,
      observation,
    );
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    const preferredGeneration = admittedObservation.source === "content"
      ? admittedObservation.presentationGeneration
      : undefined;
    if (preferredGeneration !== undefined) {
      try {
        // The document_start guardian has already made this retained generation
        // opaque. Re-adopt it and prove paint instead of manufacturing a second
        // visual entry for the same physical occurrence.
        return await beginPresentation(
          tabId,
          held.mode,
          "refit",
          preferredGeneration,
        );
      } catch {
        // A worker restart can make the content generation older than the
        // background floor. Supersede it behind the already-opaque plane.
      }
    }
    return await beginPresentation(tabId, held.mode, "refit");
  };
  const commitScaleOnlyRefit = async (
    tabId: number,
    held: HeldPosture,
    scale: number,
    hint?: EmulationPhysicalViewportHint,
  ): Promise<VerifiedEmulationState | null> => {
    const verified = verifiedPostures.get(tabId);
    if (!verified || !postureIsCurrent(tabId, held)) return null;
    const refitted = await writeScaleOnlyRefit(
      tabId,
      held,
      verified,
      scale,
      hint,
    );
    if (!postureIsCurrent(tabId, held)) return null;
    verifiedPostures.set(tabId, refitted);
    await rememberSafeFittedScale(tabId, held, refitted.scale);
    cancelReassertRetry(tabId);
    return refitted;
  };
  const scheduleRefitBurstSettlement = (
    tabId: number,
    burst: RefitBurst,
  ): void => {
    if (burst.quietTimer !== undefined) clearTimeout(burst.quietTimer);
    const expectedVersion = burst.coordinatorVersion;
    const timer = setTimeout(() => {
      if (refitBursts.get(tabId) !== burst) return;
      burst.quietTimer = undefined;
      const coordinator = coordinatorFor(tabId);
      if (coordinator.version !== expectedVersion) {
        return;
      }
      void withEmulationOperation(tabId, () =>
        finalizeRefitBurst(tabId, burst)
      ).catch(() => {
        if (postureIsCurrent(tabId, burst.held)) {
          invalidateGeometry(tabId);
          scheduleReassertRetry(tabId, burst.held);
        }
      });
    }, REFIT_SETTLE_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    burst.quietTimer = timer;
  };
  const settleUnexpectedNoopGuard = async (
    tabId: number,
    held: HeldPosture,
    verified: VerifiedEmulationState,
    observation: EmulationRefitObservation,
  ): Promise<VerifiedEmulationState> => {
    const admittedObservation = await adoptPhysicalGuardAdmission(
      tabId,
      held,
      observation,
    );
    if (!postureIsCurrent(tabId, held)) return verified;
    if (
      admittedObservation.source !== "content" ||
      admittedObservation.presentationGeneration === undefined
    ) {
      return verified;
    }
    try {
      const lease = await beginRefitPresentation(tabId, held, admittedObservation);
      await settlePresentation(tabId, lease);
      cancelReassertRetry(tabId);
      return verified;
    } catch {
      scheduleReassertRetry(tabId, held);
      return {
        ...verified,
        active: false,
        failureReason: "presentation_unavailable",
      };
    }
  };
  const executeRefitObservation = async (
    tabId: number,
    held: HeldPosture,
    observation: EmulationRefitObservation,
    coordinatorVersion: number,
  ): Promise<VerifiedEmulationState | null> => {
    if (!postureIsActive(tabId, held)) return null;
    let effectiveObservation = await adoptPhysicalGuardAdmission(
      tabId,
      held,
      observation,
    );
    if (!postureIsCurrent(tabId, held)) return null;
    const projectedVerified = verifiedPostures.get(tabId);
    const projectedPhysicalViewport = effectiveObservation.projectedPhysicalViewport;
    const projectionIsCurrent =
      effectiveObservation.projectedPostureEpoch === held.epoch &&
      projectedPhysicalViewport !== undefined &&
      projectedVerified?.active === true &&
      projectedVerified.mode === held.mode;
    const shouldPreguard = projectionIsCurrent
      ? !physicalViewportFits(
        projectedVerified,
        projectedPhysicalViewport,
      )
      : effectiveObservation.physicalBoundsChanged === true;
    let preguardedBurst: RefitBurst | null = null;
    if (shouldPreguard) {
      const projectedSignature = effectiveObservation.projectedPhysicalViewport
        ? physicalSignature(effectiveObservation.projectedPhysicalViewport)
        : lastPhysicalSignatures.get(tabId) ?? `bounds:unknown:${coordinatorVersion}`;
      const existingBurst = refitBursts.get(tabId);
      if (existingBurst?.held === held) {
        existingBurst.coordinatorVersion = coordinatorVersion;
        existingBurst.physicalSignature = projectedSignature;
        if (effectiveObservation.physicalViewportHint) {
          existingBurst.hint = effectiveObservation.physicalViewportHint;
        }
        preguardedBurst = existingBurst;
      } else {
        try {
          preguardedBurst = {
            held,
            lease: await beginRefitPresentation(tabId, held, effectiveObservation),
            geometryGeneration: nextGeometryGeneration(tabId),
            physicalSignature: projectedSignature,
            hint: effectiveObservation.physicalViewportHint,
            coordinatorVersion,
          };
          refitBursts.set(tabId, preguardedBurst);
        } catch {
          scheduleReassertRetry(tabId, held);
          return projectedVerified
            ? {
                ...projectedVerified,
                active: false,
                failureReason: "presentation_unavailable",
              }
            : null;
        }
      }
    }
    const attachmentCurrent = await debuggerAttachmentIsCurrent(tabId);
    if (!postureIsCurrent(tabId, held)) return null;
    effectiveObservation = await adoptPhysicalGuardAdmission(
      tabId,
      held,
      effectiveObservation,
    );
    if (!postureIsCurrent(tabId, held)) return null;
    let verified = verifiedPostures.get(tabId);
    if (!attachmentCurrent || !verified || verified.mode !== held.mode) {
      invalidateGeometry(tabId);
      await executeReassertPosture(
        tabId,
        held,
        effectiveObservation.physicalViewportHint,
        "refit",
        effectiveObservation.source === "content"
          ? effectiveObservation.presentationGeneration
          : undefined,
      );
      return verifiedPostures.get(tabId) ?? null;
    }
    // Measurement precedes presentation. Duplicate and no-op observations from
    // popup/window/watchdog sources are therefore read-only and never flicker.
    const physicalViewport = await visibleTabViewport(
      tabId,
      effectiveObservation.physicalViewportHint,
    );
    if (!physicalViewport) {
      scheduleReassertRetry(tabId, held);
      return {
        ...verified,
        active: false,
        failureReason: "physical_fit_mismatch",
      };
    }
    const adoptedPrefit = await adoptPendingCompositorPrefit(
      tabId,
      held,
      verified,
    );
    if (!postureIsCurrent(tabId, held)) return null;
    if (adoptedPrefit !== verified) {
      verified = adoptedPrefit;
      verifiedPostures.set(tabId, verified);
      if (physicalViewportFits(verified, physicalViewport)) {
        await rememberSafeFittedScale(tabId, held, verified.scale);
      }
    }
    // A bounds event can publish its guard while an earlier popup/side-panel
    // executor is already awaiting browser geometry. Re-read the shared lane at
    // this last pre-presentation boundary so that executor adopts, rather than
    // supersedes, the exact document's opaque generation.
    effectiveObservation = await adoptPhysicalGuardAdmission(
      tabId,
      held,
      effectiveObservation,
    );
    if (!postureIsCurrent(tabId, held)) return null;
    const signature = physicalSignature(physicalViewport);
    let activeBurst = refitBursts.get(tabId);
    if (
      !activeBurst &&
      effectiveObservation.source === "content" &&
      effectiveObservation.presentationGeneration !== undefined &&
      effectiveObservation.physicalBoundsChanged === true
    ) {
      try {
        activeBurst = {
          held,
          lease: await beginRefitPresentation(tabId, held, effectiveObservation),
          geometryGeneration: nextGeometryGeneration(tabId),
          physicalSignature: signature,
          hint: effectiveObservation.physicalViewportHint,
          coordinatorVersion,
        };
        refitBursts.set(tabId, activeBurst);
        preguardedBurst = activeBurst;
      } catch {
        scheduleReassertRetry(tabId, held);
        return {
          ...verified,
          active: false,
          failureReason: "presentation_unavailable",
        };
      }
    }
    const fittedScale = fitDeviceScale(
      held.mode,
      physicalViewport,
      held.scale,
    );
    if (!postureIsCurrent(tabId, held)) return null;
    const needsScaleChange =
      Math.abs(fittedScale - verified.scale) > 0.001 ||
      !physicalViewportFits(verified, physicalViewport);
    if (lastPhysicalSignatures.get(tabId) === signature) {
      if (activeBurst && activeBurst.held === held) {
        activeBurst.coordinatorVersion = coordinatorVersion;
        activeBurst.physicalSignature = signature;
        if (effectiveObservation.physicalViewportHint) {
          activeBurst.hint = effectiveObservation.physicalViewportHint;
        }
        if (
          needsScaleChange &&
          (
            fittedScale < verified.scale - 0.001 ||
            !physicalViewportFits(verified, physicalViewport)
          )
        ) {
          try {
            await commitScaleOnlyRefit(
              tabId,
              held,
              fittedScale,
              effectiveObservation.physicalViewportHint,
            );
          } catch {
            scheduleRefitBurstSettlement(tabId, activeBurst);
            return {
              ...verified,
              active: false,
              failureReason: "physical_fit_mismatch",
            };
          }
        }
        scheduleRefitBurstSettlement(tabId, activeBurst);
        return verifiedPostures.get(tabId) ?? verified;
      }
      if (needsScaleChange) {
        // A prior attempt may have written conservatively and then lost its
        // physical proof. Re-enter correction even though the dimensions did
        // not change again; cached active state is not proof of browser state.
      } else {
        return await settleUnexpectedNoopGuard(
          tabId,
          held,
          verified,
          effectiveObservation,
        );
      }
    }
    lastPhysicalSignatures.set(tabId, signature);
    const geometryGeneration = preguardedBurst === activeBurst
      ? preguardedBurst.geometryGeneration
      : nextGeometryGeneration(tabId);
    if (!needsScaleChange) {
      if (activeBurst && activeBurst.held === held) {
        activeBurst.geometryGeneration = geometryGeneration;
        activeBurst.physicalSignature = signature;
        activeBurst.hint = effectiveObservation.physicalViewportHint;
        activeBurst.coordinatorVersion = coordinatorVersion;
        scheduleRefitBurstSettlement(tabId, activeBurst);
        return verified;
      }
      cancelReassertRetry(tabId);
      return await settleUnexpectedNoopGuard(
        tabId,
        held,
        verified,
        effectiveObservation,
      );
    }
    let burst = activeBurst?.held === held ? activeBurst : null;
    if (!burst) {
      try {
        burst = {
          held,
          lease: await beginRefitPresentation(tabId, held, effectiveObservation),
          geometryGeneration,
          physicalSignature: signature,
          hint: effectiveObservation.physicalViewportHint,
          coordinatorVersion,
        };
        refitBursts.set(tabId, burst);
      } catch {
        scheduleReassertRetry(tabId, held);
        return {
          ...verified,
          active: false,
          failureReason: "presentation_unavailable",
        };
      }
    } else {
      burst.geometryGeneration = geometryGeneration;
      burst.physicalSignature = signature;
      burst.hint = effectiveObservation.physicalViewportHint;
      burst.coordinatorVersion = coordinatorVersion;
    }
    // Every newly smaller fit is safety-critical and is written immediately
    // behind the one retained lease. Growth waits for the quiet finalizer.
    if (
      fittedScale < verified.scale - 0.001 ||
      !physicalViewportFits(verified, physicalViewport)
    ) {
      try {
        await commitScaleOnlyRefit(
          tabId,
          held,
          fittedScale,
          effectiveObservation.physicalViewportHint,
        );
      } catch {
        if (postureIsCurrent(tabId, held)) {
          scheduleRefitBurstSettlement(tabId, burst);
        }
        return {
          ...verified,
          active: false,
          failureReason: "physical_fit_mismatch",
        };
      }
    }
    scheduleRefitBurstSettlement(tabId, burst);
    return verifiedPostures.get(tabId) ?? verified;
  };
  async function finalizeRefitBurst(
    tabId: number,
    burst: RefitBurst,
  ): Promise<void> {
    if (
      refitBursts.get(tabId) !== burst ||
      !postureIsActive(tabId, burst.held)
    ) {
      return;
    }
    const coordinator = coordinatorFor(tabId);
    if (
      coordinator.pending ||
      coordinator.version !== burst.coordinatorVersion
    ) {
      return;
    }
    const attachmentCurrent = await debuggerAttachmentIsCurrent(tabId);
    if (!postureIsCurrent(tabId, burst.held)) return;
    if (!attachmentCurrent) {
      invalidateGeometry(tabId);
      await executeReassertPosture(tabId, burst.held, burst.hint, "refit");
      return;
    }
    const physicalViewport = await visibleTabViewport(tabId, burst.hint);
    let verified = verifiedPostures.get(tabId);
    if (!physicalViewport || !verified || verified.mode !== burst.held.mode) {
      invalidateGeometry(tabId);
      scheduleReassertRetry(tabId, burst.held);
      return;
    }
    const adoptedPrefit = await adoptPendingCompositorPrefit(
      tabId,
      burst.held,
      verified,
    );
    if (!postureIsCurrent(tabId, burst.held)) return;
    if (adoptedPrefit !== verified) {
      verified = adoptedPrefit;
      verifiedPostures.set(tabId, verified);
      if (physicalViewportFits(verified, physicalViewport)) {
        await rememberSafeFittedScale(tabId, burst.held, verified.scale);
      }
    }
    const signature = physicalSignature(physicalViewport);
    if (signature !== burst.physicalSignature) {
      lastPhysicalSignatures.set(tabId, signature);
      burst.geometryGeneration = nextGeometryGeneration(tabId);
      burst.physicalSignature = signature;
      const fittedScale = fitDeviceScale(
        burst.held.mode,
        physicalViewport,
        burst.held.scale,
      );
      if (
        fittedScale < verified.scale - 0.001 ||
        !physicalViewportFits(verified, physicalViewport)
      ) {
        await commitScaleOnlyRefit(
          tabId,
          burst.held,
          fittedScale,
          burst.hint,
        );
      }
      scheduleRefitBurstSettlement(tabId, burst);
      return;
    }
    const fittedScale = fitDeviceScale(
      burst.held.mode,
      physicalViewport,
      burst.held.scale,
    );
    if (
      Math.abs(fittedScale - verified.scale) > 0.001 ||
      !physicalViewportFits(verified, physicalViewport)
    ) {
      await commitScaleOnlyRefit(
        tabId,
        burst.held,
        fittedScale,
        burst.hint,
      );
    }
    // A physical event arriving after the quiet proof belongs to the next
    // burst; never release this lease and then reuse it for newer geometry.
    if (coordinator.version !== burst.coordinatorVersion) {
      return;
    }
    await settlePresentation(tabId, burst.lease);
    if (refitBursts.get(tabId) === burst) {
      refitBursts.delete(tabId);
    }
    if (!coordinator.pending && !coordinator.processing) {
      refitCoordinators.delete(tabId);
    }
    cancelReassertRetry(tabId);
  }
  /**
   * `onDetach` is the fastest path, but Chromium intentionally omits it for an
   * extension-originated or otherwise silent detach. A held posture is
   * therefore a lease: verify browser ownership at a bounded cadence and
   * repair it without waiting for a popup action. The exact attached path reads
   * only browser target/tab metadata and emits no CDP writes or page-main-thread
   * work.
   */
  const reconcileLeaseWatchdog = async (tabId: number): Promise<void> => {
    const held = heldPostures.get(tabId);
    if (!held || !postureIsActive(tabId, held)) return;
    await withEmulationOperation(tabId, async () => {
      if (!postureIsActive(tabId, held)) return;
      const attachmentCurrent = await debuggerAttachmentIsCurrent(tabId);
      if (!postureIsActive(tabId, held)) return;
      if (!attachmentCurrent) {
        invalidateGeometry(tabId);
        await executeReassertPosture(tabId, held);
        return;
      }
      const verified = verifiedPostures.get(tabId);
      if (!verified || verified.mode !== held.mode) {
        await executeReassertPosture(tabId, held);
        return;
      }
      const physicalViewport = await visibleTabViewport(tabId);
      if (
        postureIsCurrent(tabId, held) &&
        physicalViewport &&
        !physicalViewportFits(verified, physicalViewport)
      ) {
        // A watchdog may make the already-held screen smaller for safety.
        // Expansion remains owned by generation-fenced resize/refit events so
        // an idle tick can never cause zoom oscillation.
        const coordinator = coordinatorFor(tabId);
        coordinator.version += 1;
        await executeRefitObservation(
          tabId,
          held,
          { source: "watchdog" },
          coordinator.version,
        );
      }
    });
  };
  scheduleLeaseWatchdog = (tabId: number): void => {
    if (
      leaseWatchdogMs <= 0 ||
      !input.postureRepo ||
      !input.debuggerApi?.getTargets ||
      !input.tabs?.get ||
      !heldPostures.has(tabId) ||
      heldPostures.get(tabId)?.suspended === true ||
      input.ownerActive?.(tabId) === false ||
      leaseWatchdogTimers.has(tabId)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      leaseWatchdogTimers.delete(tabId);
      void reconcileLeaseWatchdog(tabId).finally(() => {
        const held = heldPostures.get(tabId);
        if (held && postureIsActive(tabId, held)) scheduleLeaseWatchdog(tabId);
      });
    }, Math.max(25, leaseWatchdogMs));
    // Node test timers should not keep a completed Vitest worker alive. Browser
    // timer ids are numbers and simply skip this optional method.
    (timer as unknown as { unref?: () => void }).unref?.();
    leaseWatchdogTimers.set(tabId, timer);
  };
  const requestRefit = (
    tabId: number,
    observation: EmulationRefitObservation,
  ): Promise<void> => {
    const coordinator = coordinatorFor(tabId);
    const held = heldPostures.get(tabId);
    if (held && !postureIsActive(tabId, held)) {
      return Promise.resolve();
    }
    let effectiveObservation = observation;
    if (
      held &&
      observation.source === "content" &&
      Number.isSafeInteger(observation.presentationGeneration) &&
      Number(observation.presentationGeneration) > 0
    ) {
      const generation = Promise.resolve(Number(observation.presentationGeneration));
      const admission = publishPhysicalGuardAdmission(tabId, held, generation);
      effectiveObservation = {
        ...observation,
        physicalGuardGeneration: admission.generation,
      };
    } else if (held && observation.physicalGuardGeneration) {
      const admission = publishPhysicalGuardAdmission(
        tabId,
        held,
        observation.physicalGuardGeneration,
      );
      effectiveObservation = {
        ...observation,
        physicalGuardGeneration: admission.generation,
      };
    }
    coordinator.pending = mergeRefitObservation(
      coordinator.pending,
      effectiveObservation,
    );
    coordinator.version += 1;
    if (coordinator.processing) return coordinator.processing;
    const run = async (): Promise<void> => {
      while (coordinator.pending) {
        const next = coordinator.pending;
        const version = coordinator.version;
        coordinator.pending = null;
        const held = await hydratePosture(tabId);
        if (!held || !postureIsActive(tabId, held)) continue;
        await withEmulationOperation(tabId, () =>
          executeRefitObservation(tabId, held, next, version)
        );
      }
    };
    const processing = run().finally(() => {
      if (coordinator.processing === processing) {
        coordinator.processing = null;
      }
      if (!coordinator.pending && !refitBursts.has(tabId)) {
        refitCoordinators.delete(tabId);
      }
    });
    coordinator.processing = processing;
    return processing;
  };
  input.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "loading") {
      return;
    }
    void hydratePosture(tabId).then((held) => {
      if (!held || !postureIsActive(tabId, held)) return;
      invalidateGeometry(tabId);
      verifiedPostures.delete(tabId);
      void reassertPosture(tabId, held, "navigation");
    });
  });
  input.tabs?.onRemoved?.addListener((tabId) => {
    attachedTabs.delete(tabId);
    realUserAgents.delete(tabId);
    releasePosture(tabId);
    hydratedTabs.add(tabId);
    void input.postureRepo?.clear(tabId).catch(() => undefined);
  });
  input.windows?.onBoundsChanged?.addListener((window) => {
    const windowId = window.id;
    if (typeof windowId !== "number") {
      return;
    }
    const priorBounds = lastWindowBounds.get(windowId) ?? null;
    const nextBounds = normalizedWindowBounds(window);
    const physicalBoundsChanged = priorBounds && nextBounds
      ? priorBounds.width !== nextBounds.width ||
        priorBounds.height !== nextBounds.height
      : true;
    const physicalBoundsContracted = priorBounds && nextBounds
      ? nextBounds.width < priorBounds.width ||
        nextBounds.height < priorBounds.height
      : false;
    if (nextBounds) {
      lastWindowBounds.set(windowId, nextBounds);
    } else {
      // Do not pair the next authoritative tab rectangle with an outer baseline
      // that predates an occurrence whose dimensions Chrome omitted.
      lastWindowBounds.delete(windowId);
    }
    for (const [tabId, held] of heldPostures) {
      if (!postureIsActive(tabId, held) || tabWindowIds.get(tabId) !== windowId) {
        continue;
      }
      // The page layout remains the same simulated device. Refit only the
      // compositor view scale; a resize must not churn identity/input posture.
      const priorViewport = projectedPhysicalViewports.get(tabId) ??
        lastPhysicalViewports.get(tabId) ?? null;
      const projectedPhysicalViewport = priorBounds && nextBounds && priorViewport
        ? {
            width: priorViewport.width + nextBounds.width - priorBounds.width,
            height: priorViewport.height + nextBounds.height - priorBounds.height,
          }
        : null;
      const validProjection = projectedPhysicalViewport &&
        Number.isFinite(projectedPhysicalViewport.width) &&
        projectedPhysicalViewport.width > 0 &&
        Number.isFinite(projectedPhysicalViewport.height) &&
        projectedPhysicalViewport.height > 0
        ? projectedPhysicalViewport
        : null;
      if (validProjection) {
        // Carry successive drag deltas forward immediately. Fresh tabs.get
        // samples replace this estimate before any debugger write or release.
        projectedPhysicalViewports.set(tabId, validProjection);
      } else {
        projectedPhysicalViewports.delete(tabId);
      }
      const observation: EmulationRefitObservation = {
        source: "window-bounds",
        physicalBoundsChanged,
        ...(validProjection
          ? {
              projectedPhysicalViewport: validProjection,
              projectedPostureEpoch: held.epoch,
            }
          : {}),
      };
      const verified = verifiedPostures.get(tabId);
      const projectionIsCurrent = validProjection !== null &&
        verified?.active === true &&
        verified.mode === held.mode;
      const projectedScale = projectionIsCurrent && validProjection
        ? fitDeviceScale(held.mode, validProjection, held.scale)
        : null;
      const projectionNeedsRefit = projectionIsCurrent && validProjection
        ? Math.abs(Number(projectedScale) - verified.scale) > 0.001 ||
          !physicalViewportFits(verified, validProjection)
        : false;
      const projectionNeedsSafetyPrefit = projectionNeedsRefit &&
        projectedScale !== null && verified !== undefined &&
        (
          projectedScale < verified.scale - 0.001 ||
          !physicalViewportFits(verified, validProjection)
        );
      const shouldFastGuard = physicalBoundsChanged && (
        projectionIsCurrent
          ? projectionNeedsRefit
          : true
      );
      if (
        physicalBoundsContracted &&
        projectionNeedsSafetyPrefit &&
        projectedScale !== null &&
        input.popupCompositorPrefitActive?.(tabId, windowId) !== true
      ) {
        // Once a worker bounds task arrives, enter Chrome's compositor queue
        // before allocating the independent content-guard fallback. The popup
        // path has an earlier native resize boundary and remains guard-first;
        // this worker-only lane has only a few milliseconds before the already
        // queued resized surface can be presented.
        startCompositorPrefit(tabId, held, projectedScale);
      }
      let physicalGuardGeneration: Promise<number | null> | undefined;
      if (shouldFastGuard && input.guardPhysicalViewport) {
        try {
          const admission = input.guardPhysicalViewport(tabId, held.mode);
          physicalGuardGeneration = promiseWithTimeout(
            admission,
            PHYSICAL_VIEWPORT_GUARD_ADMISSION_TIMEOUT_MS,
            "Physical viewport guard admission",
          ).then((generation) =>
            postureIsCurrent(tabId, held) &&
              Number.isSafeInteger(generation) && Number(generation) > 0
              ? Number(generation)
              : null
          ).catch(() => null);
        } catch {
          physicalGuardGeneration = Promise.resolve(null);
        }
      }
      if (physicalGuardGeneration) {
        physicalGuardGeneration = publishPhysicalGuardAdmission(
          tabId,
          held,
          physicalGuardGeneration,
        ).generation;
      }
      void requestRefit(tabId, {
        ...observation,
        ...(physicalGuardGeneration ? { physicalGuardGeneration } : {}),
      });
    }
  });
  if (input.postureRepo) {
    void input.postureRepo.list().then(async (stored) => {
      if (!stored.ok || !stored.value) return;
      await Promise.all(stored.value.map(async (record) => {
        const tabId = record.tabId;
        const expectedEpoch = postureEpochs.get(tabId) ?? 0;
        if (!await visibleTabViewport(tabId)) return;
        hydratedTabs.add(tabId);
        const held = adoptDurableRecord(record, expectedEpoch);
        if (held && postureIsActive(tabId, held)) {
          await reassertPosture(tabId, held, "startup");
        }
      }));
    }).catch(() => undefined);
  }

  return {
    async hydrate(tabId: number): Promise<EmulationMode | null> {
      const held = await hydratePosture(tabId);
      if (held && postureIsActive(tabId, held)) scheduleLeaseWatchdog(tabId);
      return held?.mode ?? null;
    },
    heldMode(tabId: number): EmulationMode | null {
      return heldPostures.get(tabId)?.mode ?? null;
    },
    desired(tabId: number): Readonly<{
      mode: EmulationMode;
      scale: number;
      suspended: boolean;
    }> | null {
      const held = heldPostures.get(tabId);
      return held
        ? { mode: held.mode, scale: held.scale, suspended: held.suspended }
        : null;
    },
    adoptCompositorPrefit(
      tabId: number,
      mode: EmulationMode,
      scale: number,
    ): boolean {
      const held = heldPostures.get(tabId);
      return held && postureIsActive(tabId, held)
        ? rememberCompositorPrefit(
            tabId,
            held,
            mode,
            scale,
            Promise.resolve(true),
          )
        : false;
    },
    async refit(
      tabId: number,
      observation: EmulationRefitObservation = { source: "verification" },
    ): Promise<void> {
      await requestRefit(tabId, observation);
    },
    async current(
      tabId: number,
      mode: EmulationMode,
      maximumScale: number,
      hint?: EmulationPhysicalViewportHint,
    ): Promise<VerifiedEmulationState | null> {
      await hydratePosture(tabId);
      return withEmulationOperation(tabId, async () => {
        const held = heldPostures.get(tabId);
        const verified = verifiedPostures.get(tabId);
        if (!held || !postureIsActive(tabId, held) || !verified || held.mode !== mode) {
          return null;
        }
        if (!await debuggerAttachmentIsCurrent(tabId)) {
          return executeReassertPosture(tabId, held, hint).then(() =>
            verifiedPostures.get(tabId) ?? null);
        }
        const physicalViewport = await visibleTabViewport(tabId, hint);
        if (!physicalViewport) {
          scheduleReassertRetry(tabId, held);
          return {
            ...verified,
            active: false,
            failureReason: "physical_fit_mismatch",
          };
        }
        const fittedScale = fitDeviceScale(mode, physicalViewport, maximumScale);
        if (
          Math.abs(fittedScale - verified.scale) > 0.001 ||
          !physicalViewportFits(verified, physicalViewport)
        ) {
          // Verification may discover that physical geometry changed, but it
          // must not bypass the resize contract. Safety shrink remains
          // immediate; growth is scheduled after the stable trailing edge.
          const coordinator = coordinatorFor(tabId);
          coordinator.version += 1;
          return executeRefitObservation(
            tabId,
            held,
            {
              source: "verification",
              ...(hint ? { physicalViewportHint: hint } : {}),
            },
            coordinator.version,
          );
        }
        // `verifiedPostures` is populated only after a complete proof and is
        // invalidated synchronously on navigation, browser-owned detach,
        // transition, refit failure, and cold-worker recreation. The getTargets
        // check above also catches a silent attachment loss without touching the
        // page's main thread; tabs.get catches physical clipping. This remains
        // the responsive path used immediately before AI capture.
        if (!postureIsCurrent(tabId, held)) {
          verifiedPostures.delete(tabId);
          return null;
        }
        cancelReassertRetry(tabId);
        return verified;
      });
    },
    async apply(
      tabId: number,
      mode: EmulationMode,
      scale: number,
      allowReload = false,
      hint?: EmulationPhysicalViewportHint,
    ): Promise<VerifiedEmulationState> {
      await hydratePosture(tabId);
      return withEmulationOperation(tabId, async () => {
        const priorHeld = heldPostures.get(tabId);
        const priorVerified = verifiedPostures.get(tabId);
        const held: HeldPosture = {
          mode,
          scale,
          suspended: false,
          revision: nextPostureRevision(tabId),
          epoch: nextPostureEpoch(tabId),
        };
        cancelReassertRetry(tabId);
        clearRefitTimer(tabId);
        heldPostures.set(tabId, held);
        scheduleLeaseWatchdog(tabId);
        verifiedPostures.delete(tabId);
        try {
          // Durable intent precedes the first CDP write. A worker suspended
          // anywhere after this point can recover the same target, never infer a
          // generic mobile fallback.
          await persistPosture(tabId, held);
          const proof = await writeProveAndPresentPosture(
            tabId,
            held,
            "apply",
            hint,
          );
          if (!postureIsCurrent(tabId, held)) {
            throw new Error("Emulation posture was released");
          }
          if (proof.failureReason === null) {
            const verified: VerifiedEmulationState = {
              ...proof.state,
              active: true,
              identityStale: false,
            };
            verifiedPostures.set(tabId, verified);
            await rememberSafeFittedScale(tabId, held, verified.scale);
            return verified;
          }
          if (proof.failureReason === "physical_fit_mismatch") {
            // A moving browser rectangle does not authorize restoring the prior
            // mode (which would create the very flash this runtime prevents).
            // Retain the desired posture and retry it at the last conservative
            // scale; active remains false until a later exact physical proof.
            scheduleReassertRetry(tabId, held);
            return {
              ...proof.state,
              active: false,
              identityStale: false,
              failureReason: proof.failureReason,
            };
          }
          const identityStale = proof.failureReason === "identity_mismatch";
          if (identityStale && allowReload && input.tabs) {
            try {
              // Every non-identity posture field, including physical fit, was
              // exact. Persist that safe compositor scale before navigation so
              // the replacement document cannot reappear larger while its
              // identity proof is being established.
              await rememberSafeFittedScale(tabId, held, proof.state.scale);
              await invokeBrowserApi<void>(
                () => input.tabs?.reload(tabId, {}),
                (callback) => input.tabs?.reload(tabId, {}, callback),
                "Tab reload",
              );
              // This response deliberately remains inactive. Chrome accepted a
              // transition, but only the replacement document's exact proof may
              // turn it into an active posture.
              return {
                ...proof.state,
                active: false,
                identityStale: true,
                reloadRequired: true,
                failureReason: proof.failureReason,
              };
            } catch {
              // A refused reload is a normal failed proof and rolls back below.
            }
          }
          await restorePriorPosture(tabId, held, priorHeld);
          return {
            ...proof.state,
            active: false,
            identityStale,
            failureReason: proof.failureReason,
          };
        } catch (error) {
          if (
            error instanceof EmulationPresentationUnavailableError &&
            !error.mutationPossible &&
            postureIsCurrent(tabId, held)
          ) {
            // The guard was never acknowledged, so the debugger posture was not
            // touched. Roll durable intent back without performing a redundant
            // CDP restore that would itself require a presentation boundary.
            if (priorHeld) {
              const restored: HeldPosture = {
                mode: priorHeld.mode,
                scale: priorHeld.scale,
                suspended: priorHeld.suspended,
                revision: nextPostureRevision(tabId),
                epoch: nextPostureEpoch(tabId),
              };
              heldPostures.set(tabId, restored);
              if (priorVerified) {
                verifiedPostures.set(tabId, priorVerified);
              }
              if (postureIsActive(tabId, restored)) scheduleLeaseWatchdog(tabId);
              await persistPosture(tabId, restored).catch(() => undefined);
            } else {
              releasePosture(tabId);
              await input.postureRepo?.clear(tabId).catch(() => undefined);
            }
            const preset = DEVICE_EMULATION_PRESETS[mode];
            return {
              mode,
              width: preset.width,
              height: preset.height,
              scale: fitDeviceScale(mode, await visibleTabViewport(tabId, hint), scale),
              active: false,
              identityStale: false,
              failureReason: "presentation_unavailable",
            };
          }
          if (
            error instanceof PhysicalViewportUnavailableError &&
            postureIsCurrent(tabId, held)
          ) {
            if (priorHeld?.suspended) {
              await restorePriorPosture(tabId, held, priorHeld);
              const preset = DEVICE_EMULATION_PRESETS[held.mode];
              return {
                mode: held.mode,
                width: preset.width,
                height: preset.height,
                scale: fitDeviceScale(held.mode, null, safeScaleCeiling(tabId, held)),
                active: false,
                identityStale: false,
                failureReason: "physical_fit_mismatch",
              };
            }
            // No metrics write was allowed without two transition samples plus
            // the final pre-write sample. Keep the desired posture durable and
            // retry; never clear or acknowledge a geometry assumption.
            scheduleReassertRetry(tabId, held);
            const preset = DEVICE_EMULATION_PRESETS[held.mode];
            return {
              mode: held.mode,
              width: preset.width,
              height: preset.height,
              scale: fitDeviceScale(held.mode, null, safeScaleCeiling(tabId, held)),
              active: false,
              identityStale: false,
              failureReason: "physical_fit_mismatch",
            };
          }
          if (postureIsCurrent(tabId, held)) {
            try {
              await restorePriorPosture(tabId, held, priorHeld);
            } catch {
              // A failed restoration is not authority to expose browser-default
              // geometry. Keep whichever lease the restoration made current and
              // repair it behind the still-opaque presentation. In particular,
              // never detach here: dropping overrides would manufacture the exact
              // desktop/mobile flash this rollback boundary exists to prevent.
              const retained = heldPostures.get(tabId);
              if (retained) {
                verifiedPostures.delete(tabId);
                scheduleReassertRetry(tabId, retained);
              }
            }
          }
          throw error;
        }
      });
    },
    async suspend(
      tabId: number,
      desired?: Readonly<{ mode: EmulationMode; scale: number }>,
    ): Promise<boolean> {
      await hydratePosture(tabId);
      return withEmulationOperation(tabId, async () => {
        const ownerReturned = (): boolean => input.ownerActive?.(tabId) === true;
        if (ownerReturned()) return false;
        const prior = heldPostures.get(tabId);
        if (prior?.suspended) {
          retireActiveRuntimeState(tabId, { preserveSafeScale: true });
          if (await debuggerAttachmentIsCurrent(tabId)) {
            // A worker can stop after persisting suspension but before clearing
            // the already-attached browser target. Re-admit an opaque guard and
            // finish that transaction; a suspended record never authorizes us
            // to assume the debugger already became native.
            const presentation = await beginPresentation(
              tabId,
              prior.mode,
              "panel-suspend",
            );
            if (ownerReturned()) {
              // A normal owner apply will supersede this opaque generation.
              // Releasing it here would expose the retained debugger posture
              // between the close and reopen transactions.
              throw new Error("Emulation owner returned during suspension");
            }
            try {
              await projectContentLifecycleSuspended(tabId, true);
            } catch (error) {
              await abortPresentation(tabId, presentation).catch(() => undefined);
              throw error;
            }
            if (ownerReturned()) {
              throw new Error("Emulation owner returned during suspension");
            }
            await clearEmulationViaCdp(
              { send: (method, params) => sendEmulationCommand(tabId, method, params) },
              {
                mode: prior.mode,
                width: DEVICE_EMULATION_PRESETS[prior.mode].width,
                height: DEVICE_EMULATION_PRESETS[prior.mode].height,
                scale: prior.scale,
                active: true,
              },
            ).catch(() => undefined);
            if (ownerReturned()) {
              throw new Error("Emulation owner returned during suspension");
            }
            await waitForClearedBrowserCompositorTurns(tabId);
            if (ownerReturned()) {
              throw new Error("Emulation owner returned during suspension");
            }
            const detached = await detach(tabId).then(() => true, () => false);
            if (!detached) {
              throw new Error("Suspended emulation recovery could not detach debugger ownership");
            }
            realUserAgents.delete(tabId);
            if (ownerReturned()) {
              throw new Error("Emulation owner returned during suspension");
            }
            await releaseSuspendedPresentation(tabId, prior.mode, presentation);
            return true;
          }
          // `release` is valid without a preceding `begin`; the time-derived
          // generation is monotonic across worker recreation. This repairs a
          // guard whose first terminal acknowledgement was lost without
          // briefly presenting another overlay on the native page.
          if (ownerReturned()) return false;
          await releaseSuspendedPresentation(tabId, prior.mode);
          return true;
        }
        if (!prior) {
          if (!desired) return false;
          const suspended: HeldPosture = {
            mode: desired.mode,
            scale: desired.scale,
            suspended: true,
            revision: nextPostureRevision(tabId),
            epoch: nextPostureEpoch(tabId),
          };
          heldPostures.set(tabId, suspended);
          try {
            await persistPosture(tabId, suspended);
          } catch (error) {
            if (postureIsCurrent(tabId, suspended)) {
              releasePosture(tabId);
              hydratedTabs.add(tabId);
            }
            throw error;
          }
          retireActiveRuntimeState(tabId, { preserveSafeScale: true });
          return !ownerReturned();
        }

        const presentation = await beginPresentation(
          tabId,
          prior.mode,
          "panel-suspend",
        );
        if (ownerReturned()) {
          verifiedPostures.delete(tabId);
          throw new Error("Emulation owner returned during suspension");
        }
        try {
          await projectContentLifecycleSuspended(tabId, true);
        } catch (error) {
          await abortPresentation(tabId, presentation).catch(() => undefined);
          throw error;
        }
        if (ownerReturned()) {
          verifiedPostures.delete(tabId);
          throw new Error("Emulation owner returned during suspension");
        }
        const suspended: HeldPosture = {
          mode: prior.mode,
          scale: prior.scale,
          suspended: true,
          revision: nextPostureRevision(tabId),
          epoch: nextPostureEpoch(tabId),
        };
        heldPostures.set(tabId, suspended);
        try {
          // Suspension intent is durable before the first CDP mutation. A cold
          // worker may retain this desired mode, but may never reattach it.
          await persistPosture(tabId, suspended);
        } catch (error) {
          const restored: HeldPosture = {
            ...prior,
            epoch: nextPostureEpoch(tabId),
          };
          heldPostures.set(tabId, restored);
          await projectContentLifecycleSuspended(tabId, false).catch(() => undefined);
          await abortPresentation(tabId, presentation).catch(() => undefined);
          if (postureIsActive(tabId, restored)) scheduleLeaseWatchdog(tabId);
          throw error;
        }
        retireActiveRuntimeState(tabId, { preserveSafeScale: true });
        if (ownerReturned()) {
          // Durable suspension plus the still-opaque guard is a safe handoff to
          // the reopening popup. Its normal apply writes the retained mode and
          // settles a newer generation; do not expose the old active posture.
          throw new Error("Emulation owner returned during suspension");
        }

        await clearEmulationViaCdp(
          { send: (method, params) => sendEmulationCommand(tabId, method, params) },
          {
            mode: prior.mode,
            width: DEVICE_EMULATION_PRESETS[prior.mode].width,
            height: DEVICE_EMULATION_PRESETS[prior.mode].height,
            scale: prior.scale,
            active: true,
          },
        ).catch(() => undefined);
        if (ownerReturned()) {
          throw new Error("Emulation owner returned during suspension");
        }
        await waitForClearedBrowserCompositorTurns(tabId);
        if (ownerReturned()) {
          throw new Error("Emulation owner returned during suspension");
        }
        const detached = await detach(tabId).then(() => true, () => false);
        if (detached) {
          realUserAgents.delete(tabId);
          if (ownerReturned()) {
            throw new Error("Emulation owner returned during suspension");
          }
          await releaseSuspendedPresentation(tabId, prior.mode, presentation);
          return true;
        }

        // Detach is the final proof that identity/script overrides cannot
        // survive a partially failed clear. Restore the prior active posture
        // behind the still-opaque generation when that proof is unavailable.
        const restored: HeldPosture = {
          mode: prior.mode,
          scale: prior.scale,
          suspended: false,
          revision: nextPostureRevision(tabId),
          epoch: nextPostureEpoch(tabId),
        };
        heldPostures.set(tabId, restored);
        await persistPosture(tabId, restored);
        const realUserAgent = await realUserAgentFor(tabId);
        const proof = await writeAndProvePosture(tabId, restored, realUserAgent);
        if (proof.failureReason !== null) {
          verifiedPostures.delete(tabId);
          if (postureIsActive(tabId, restored)) scheduleReassertRetry(tabId, restored);
          throw new Error(`Emulation suspension rollback failed: ${proof.failureReason}`);
        }
        const verified: VerifiedEmulationState = {
          ...proof.state,
          active: true,
          identityStale: false,
        };
        verifiedPostures.set(tabId, verified);
        await rememberSafeFittedScale(tabId, restored, verified.scale);
        await projectContentLifecycleSuspended(tabId, false);
        await settlePresentation(tabId, presentation);
        if (postureIsActive(tabId, restored)) scheduleLeaseWatchdog(tabId);
        throw new Error("Emulation suspension could not detach debugger ownership");
      });
    },
    isSuspended(tabId: number): boolean {
      return heldPostures.get(tabId)?.suspended === true;
    },
    async clear(tabId: number) {
      // A restarted worker may not have adopted its durable lease yet. Hydrate
      // before deciding that there is no held posture to guard or release.
      await hydratePosture(tabId);
      return withEmulationOperation(tabId, async () => {
        const priorHeld = heldPostures.get(tabId);
        if (priorHeld?.suspended) {
          await input.postureRepo?.clear(tabId);
          releasePosture(tabId);
          hydratedTabs.add(tabId);
          return {
            mode: priorHeld.mode,
            width: DEVICE_EMULATION_PRESETS[priorHeld.mode].width,
            height: DEVICE_EMULATION_PRESETS[priorHeld.mode].height,
            scale: priorHeld.scale,
            active: false,
          };
        }
        // Clearing changes visible geometry even when the in-memory lease is
        // absent (for example after a worker restart). It is therefore never
        // allowed to fall through when the content plane cannot be paint-proven.
        const presentation = await beginPresentation(
          tabId,
          priorHeld?.mode ?? "mobile",
          "clear",
        );
        // Invalidate the desired posture after the non-CDP guard handshake but
        // before the first debugger mutation. Any already-queued reassertion now
        // observes a stale object and cannot become the final writer.
        try {
          await input.postureRepo?.clear(tabId);
        } catch (error) {
          // Nothing browser-visible changed. Restore the existing proven page
          // presentation when possible; if exactness cannot be re-proved, keep
          // the safety plane and let the still-held lease repair it.
          if (priorHeld) {
            await settlePresentation(tabId, presentation).catch(() => undefined);
          } else {
            await releasePresentation(tabId, presentation).catch(() => undefined);
          }
          throw error;
        }
        releasePosture(tabId);
        hydratedTabs.add(tabId);
        try {
          const cleared = await clearEmulationViaCdp(
            { send: (method, params) => sendEmulationCommand(tabId, method, params) },
            {
              mode: "mobile",
              width: 412,
              height: 960,
              scale: 1,
              active: true,
            },
          );
          // Give the natural browser viewport two compositor opportunities
          // behind the opaque plane before the debugger is detached.
          await waitForClearedBrowserCompositorTurns(tabId);
          return cleared;
        } finally {
          // Detaching drops every override with it, including the user agent, so
          // the next attach must read the browser's own identity again. Cleanup
          // is unconditional: a failed intermediate restore may not retain the
          // debugger or block the next transition.
          await detach(tabId).catch(() => undefined);
          realUserAgents.delete(tabId);
          await releasePresentation(tabId, presentation);
        }
      });
    },
    /** Render inspection owns the durable session; this runtime only performs
     * the serialized CDP side effect. Keeping it in the same queue as viewport
     * posture prevents a detach/reassert race from becoming the final writer. */
    async setJavascriptEnabled(tabId: number, enabled: boolean): Promise<void> {
      await withEmulationOperation(tabId, async () => {
        await send(tabId, "Emulation.setScriptExecutionDisabled", { value: !enabled });
      });
    },
    /** Executes an extension-owned debugger probe in the inspected document.
     * This remains available when ordinary page/content scheduling is starved
     * by Emulation.setScriptExecutionDisabled, and shares the posture queue so
     * a restore cannot race the probe. */
    async evaluate(tabId: number, expression: string): Promise<unknown> {
      return withEmulationOperation(tabId, async () => {
        const response = await send(tabId, "Runtime.evaluate", {
          expression,
          returnByValue: true,
        }) as {
          result?: { value?: unknown };
          exceptionDetails?: unknown;
        } | undefined;
        if (response?.exceptionDetails) {
          throw new Error("Debugger evaluation failed");
        }
        return response?.result?.value;
      });
    },
    /** Initiates the load. Its callback acknowledges only that Chrome accepted
     * the reload request; render inspection success belongs to the replacement
     * document's matching post-paint acknowledgement. */
    async reload(tabId: number): Promise<void> {
      if (!input.tabs) {
        throw new Error("Tabs API unavailable");
      }
      await invokeBrowserApi<void>(
        () => input.tabs?.reload(tabId, { bypassCache: true }),
        (callback) => input.tabs?.reload(tabId, { bypassCache: true }, callback),
        "Tab reload",
      );
    },
  };
}
