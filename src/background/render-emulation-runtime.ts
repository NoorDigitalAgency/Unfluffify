import { getBrowserRuntimeLastError } from "../common/browser";
import {
  applyEmulationViaCdp,
  clearEmulationViaCdp,
  deriveGooglebotSmartphoneUserAgent,
  fitDeviceScale,
  type EmulationMode,
  type EmulationState,
} from "../content/stabilization";
import { DEVICE_EMULATION_PRESETS } from "../domain/constants";
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
  | "presentation_unavailable";

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
  type RefitCoordinator = {
    pending: EmulationRefitObservation | null;
    processing: Promise<void> | null;
    version: number;
  };
  const refitBursts = new Map<number, RefitBurst>();
  const refitCoordinators = new Map<number, RefitCoordinator>();
  const lastPhysicalSignatures = new Map<number, string>();
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
    try {
      const response = await present(tabId, {
        phase: "begin",
        generation: lease.generation,
        mode,
        cause,
      });
      if (
        !response.ok ||
        response.generation !== lease.generation ||
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
      return lease;
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
      throw new EmulationPresentationUnavailableError(
        response.reason || "exact-presentation-not-settled",
        true,
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
      revision: record.revision,
      epoch: nextPostureEpoch(tabId),
    };
    heldPostures.set(tabId, held);
    scheduleLeaseWatchdog(tabId);
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
  const releasePosture = (tabId: number): void => {
    // Retire the standing lease before any intentional debugger detach. A
    // trailing watchdog must never resurrect a posture the operator released.
    cancelLeaseWatchdog(tabId);
    cancelReassertRetry(tabId);
    clearRefitTimer(tabId);
    nextPostureEpoch(tabId);
    heldPostures.delete(tabId);
    verifiedPostures.delete(tabId);
    safeFittedScales.delete(tabId);
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
      if (held) void reassertPosture(tabId, held, "debugger-detach");
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
    await writeMetricsScale(tabId, held, scale);
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    let state: VerifiedEmulationState = {
      ...prior,
      mode: held.mode,
      width: preset.width,
      height: preset.height,
      scale,
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
  ): ReturnType<typeof writeAndProvePosture> => {
    // The content plane is confirmed opaque before even the first debugger
    // attach. Attaching can add Chrome's debugger infobar and shrink the
    // physical tab rectangle before device metrics are written.
    const presentation = await beginPresentation(tabId, held.mode, cause);
    const realUserAgent = await realUserAgentFor(tabId);
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    const proof = await writeAndProvePosture(tabId, held, realUserAgent, hint);
    if (proof.failureReason === null) {
      await settlePresentation(tabId, presentation);
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
    if (prior) {
      const restored: HeldPosture = {
        mode: prior.mode,
        scale: prior.scale,
        revision: nextPostureRevision(tabId),
        epoch: nextPostureEpoch(tabId),
      };
      heldPostures.set(tabId, restored);
      scheduleLeaseWatchdog(tabId);
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
      await waitForBrowserFrame(tabId).catch(() => undefined);
      await waitForBrowserFrame(tabId).catch(() => undefined);
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
  ): Promise<void> => {
    if (!postureIsCurrent(tabId, held)) {
      return;
    }
    try {
      const proof = await writeProveAndPresentPosture(
        tabId,
        held,
        cause,
        hint,
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
      if (postureIsCurrent(tabId, held)) {
        verifiedPostures.delete(tabId);
        scheduleReassertRetry(tabId, held);
      }
    }
  };
  function scheduleReassertRetry(tabId: number, held: HeldPosture): void {
    if (!postureIsCurrent(tabId, held) || reassertRetryTimers.has(tabId)) {
      return;
    }
    const attempt = reassertRetryAttempts.get(tabId) ?? 0;
    const delay = REASSERT_RETRY_DELAYS_MS[
      Math.min(attempt, REASSERT_RETRY_DELAYS_MS.length - 1)
    ]!;
    reassertRetryAttempts.set(tabId, attempt + 1);
    const timer = setTimeout(() => {
      reassertRetryTimers.delete(tabId);
      if (postureIsCurrent(tabId, held)) {
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
    withEmulationOperation(tabId, () => executeReassertPosture(tabId, held, undefined, cause));
  const coordinatorFor = (tabId: number): RefitCoordinator => {
    const existing = refitCoordinators.get(tabId);
    if (existing) return existing;
    const coordinator: RefitCoordinator = {
      pending: null,
      processing: null,
      version: 0,
    };
    refitCoordinators.set(tabId, coordinator);
    return coordinator;
  };
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
      ? Promise.all([
          current.physicalGuardGeneration.catch(() => null),
          next.physicalGuardGeneration.catch(() => null),
        ]).then((generations) => {
          const valid = generations.filter((generation): generation is number =>
            Number.isSafeInteger(generation) && Number(generation) > 0
          );
          return valid.length > 0 ? Math.max(...valid) : null;
        })
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
  const beginRefitPresentation = async (
    tabId: number,
    held: HeldPosture,
    observation: EmulationRefitObservation,
  ): Promise<PresentationLease> => {
    const preferredGeneration = observation.source === "content"
      ? observation.presentationGeneration
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
    if (
      observation.source !== "content" ||
      observation.presentationGeneration === undefined
    ) {
      return verified;
    }
    try {
      const lease = await beginRefitPresentation(tabId, held, observation);
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
    if (!postureIsCurrent(tabId, held)) return null;
    const physicalGuardGeneration = observation.physicalGuardGeneration
      ? await observation.physicalGuardGeneration.catch(() => null)
      : null;
    if (!postureIsCurrent(tabId, held)) return null;
    const effectiveObservation =
      Number.isSafeInteger(physicalGuardGeneration) &&
        Number(physicalGuardGeneration) > 0
        ? {
            ...observation,
            source: "content" as const,
            presentationGeneration: Number(physicalGuardGeneration),
          }
        : observation;
    const projectedVerified = verifiedPostures.get(tabId);
    const projectionIsCurrent =
      effectiveObservation.projectedPostureEpoch === held.epoch &&
      effectiveObservation.projectedPhysicalViewport !== undefined &&
      projectedVerified?.active === true &&
      projectedVerified.mode === held.mode;
    const shouldPreguard = projectionIsCurrent
      ? !physicalViewportFits(
        projectedVerified,
        effectiveObservation.projectedPhysicalViewport,
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
    const verified = verifiedPostures.get(tabId);
    if (!attachmentCurrent || !verified || verified.mode !== held.mode) {
      invalidateGeometry(tabId);
      await executeReassertPosture(
        tabId,
        held,
        effectiveObservation.physicalViewportHint,
        "refit",
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
    const signature = physicalSignature(physicalViewport);
    const activeBurst = refitBursts.get(tabId);
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
      !postureIsCurrent(tabId, burst.held)
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
    const verified = verifiedPostures.get(tabId);
    if (!physicalViewport || !verified || verified.mode !== burst.held.mode) {
      invalidateGeometry(tabId);
      scheduleReassertRetry(tabId, burst.held);
      return;
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
    if (!held) return;
    await withEmulationOperation(tabId, async () => {
      if (!postureIsCurrent(tabId, held)) return;
      const attachmentCurrent = await debuggerAttachmentIsCurrent(tabId);
      if (!postureIsCurrent(tabId, held)) return;
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
      leaseWatchdogTimers.has(tabId)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      leaseWatchdogTimers.delete(tabId);
      void reconcileLeaseWatchdog(tabId).finally(() => {
        if (heldPostures.has(tabId)) scheduleLeaseWatchdog(tabId);
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
    coordinator.pending = mergeRefitObservation(
      coordinator.pending,
      observation,
    );
    coordinator.version += 1;
    if (coordinator.processing) return coordinator.processing;
    const run = async (): Promise<void> => {
      while (coordinator.pending) {
        const next = coordinator.pending;
        const version = coordinator.version;
        coordinator.pending = null;
        const held = await hydratePosture(tabId);
        if (!held) continue;
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
      if (!held) return;
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
    if (nextBounds) {
      lastWindowBounds.set(windowId, nextBounds);
    } else {
      // Do not pair the next authoritative tab rectangle with an outer baseline
      // that predates an occurrence whose dimensions Chrome omitted.
      lastWindowBounds.delete(windowId);
    }
    for (const [tabId, held] of heldPostures) {
      if (tabWindowIds.get(tabId) !== windowId) {
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
      const shouldFastGuard = physicalBoundsChanged && (
        projectionIsCurrent
          ? !physicalViewportFits(verified, validProjection)
          : true
      );
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
        if (held) await reassertPosture(tabId, held, "startup");
      }));
    }).catch(() => undefined);
  }

  return {
    async hydrate(tabId: number): Promise<EmulationMode | null> {
      const held = await hydratePosture(tabId);
      if (held) scheduleLeaseWatchdog(tabId);
      return held?.mode ?? null;
    },
    heldMode(tabId: number): EmulationMode | null {
      return heldPostures.get(tabId)?.mode ?? null;
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
        if (!held || !verified || held.mode !== mode) {
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
                revision: nextPostureRevision(tabId),
                epoch: nextPostureEpoch(tabId),
              };
              heldPostures.set(tabId, restored);
              if (priorVerified) {
                verifiedPostures.set(tabId, priorVerified);
              }
              scheduleLeaseWatchdog(tabId);
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
    async clear(tabId: number) {
      // A restarted worker may not have adopted its durable lease yet. Hydrate
      // before deciding that there is no held posture to guard or release.
      await hydratePosture(tabId);
      return withEmulationOperation(tabId, async () => {
        const priorHeld = heldPostures.get(tabId);
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
          await waitForBrowserFrame(tabId).catch(() => undefined);
          await waitForBrowserFrame(tabId).catch(() => undefined);
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
