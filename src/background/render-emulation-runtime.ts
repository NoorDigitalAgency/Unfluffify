import { getBrowserRuntimeLastError } from "../common/browser";
import {
  applyEmulationViaCdp,
  clearEmulationViaCdp,
  deriveGooglebotSmartphoneUserAgent,
  fitDeviceScale,
  type EmulationMode,
  type EmulationState,
} from "../content/stabilization";
import { DEVICE_SCALE_DEFAULTS } from "../domain/constants";

export type EmulationFailureReason =
  | "viewport_mismatch"
  | "device_pixel_ratio_mismatch"
  | "page_scale_mismatch"
  | "touch_mismatch"
  | "pointer_media_mismatch"
  | "identity_unavailable"
  | "identity_mismatch"
  | "proof_unavailable";

export type VerifiedEmulationState = EmulationState & Readonly<{
  identityStale: boolean;
  /** A reload is a transition request, never proof that the current document is
   * exact. The replacement document must pass a second apply/probe round. */
  reloadRequired?: boolean;
  failureReason?: EmulationFailureReason;
}>;

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

type Debuggee = Readonly<{ tabId?: number }>;
type DebuggerApi = Readonly<{
  attach(target: Debuggee, version: string, callback?: () => void): Promise<void> | void;
  detach(target: Debuggee, callback?: () => void): Promise<void> | void;
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
  onBoundsChanged?: Readonly<{
    addListener(listener: (window: Readonly<{ id?: number }>) => void): void;
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
  onDebuggerDetached?: (tabId: number, reason?: string) => void;
  apiTimeoutMs?: number;
  apiMode?: "callback" | "promise";
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
  type HeldPosture = Readonly<{ mode: EmulationMode; scale: number; epoch: number }>;
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
  const tabWindowIds = new Map<number, number>();
  const reassertRetryTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const reassertRetryAttempts = new Map<number, number>();
  const REASSERT_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 5_000] as const;
  const postureEpochs = new Map<number, number>();
  const nextPostureEpoch = (tabId: number): number => {
    const epoch = (postureEpochs.get(tabId) ?? 0) + 1;
    postureEpochs.set(tabId, epoch);
    return epoch;
  };
  const postureIsCurrent = (tabId: number, held: HeldPosture): boolean =>
    heldPostures.get(tabId) === held && postureEpochs.get(tabId) === held.epoch;
  const cancelReassertRetry = (tabId: number): void => {
    const timer = reassertRetryTimers.get(tabId);
    if (timer !== undefined) {
      clearTimeout(timer);
      reassertRetryTimers.delete(tabId);
    }
    reassertRetryAttempts.delete(tabId);
  };
  const releasePosture = (tabId: number): void => {
    cancelReassertRetry(tabId);
    nextPostureEpoch(tabId);
    heldPostures.delete(tabId);
    verifiedPostures.delete(tabId);
    tabWindowIds.delete(tabId);
  };
  const visibleTabViewport = async (
    tabId: number,
  ): Promise<Readonly<{ width: number; height: number }> | null> => {
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
        tabWindowIds.set(tabId, Number(tab?.windowId));
      }
      return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? { width, height }
        : null;
    } catch {
      return null;
    }
  };
  const fittedScaleFor = async (
    tabId: number,
    mode: EmulationMode,
    maximumScale: number,
    fallbackScale?: number,
  ): Promise<number> => {
    const viewport = await visibleTabViewport(tabId);
    return fitDeviceScale(
      mode,
      viewport,
      viewport
        ? maximumScale
        : Math.min(maximumScale, fallbackScale ?? DEVICE_SCALE_DEFAULTS[mode]),
    );
  };
  /** Reasons the operator did not choose. A closing tab has nothing to restore, and
   *  a replaced target means the tab is being taken over by something else. */
  // A DevTools replacement is still an operator attempt to take down the held
  // simulation, not permission to forget the product posture. Reassert it just
  // like Chrome's explicit `canceled_by_user` detach; only a dead target is
  // terminal.
  const TERMINAL_DETACH_REASONS = new Set(["target_closed", "target_crashed"]);
  input.debuggerApi?.onDetach?.addListener((source, reason) => {
    const tabId = source.tabId;
    if (typeof tabId !== "number") {
      return;
    }
    input.onDebuggerDetached?.(tabId, reason);
    attachedTabs.delete(tabId);
    realUserAgents.delete(tabId);
    verifiedPostures.delete(tabId);
    const held = heldPostures.get(tabId);
    if (!held || (reason && TERMINAL_DETACH_REASONS.has(reason))) {
      releasePosture(tabId);
      return;
    }
    // Detaching drops every override at once — viewport, identity, the lot — so a
    // dismissed debugging banner silently returns the tab to a desktop-shaped page
    // the operator is still marking against. Re-establish it rather than waiting
    // for the next thing that happens to re-apply.
    void reassertPosture(tabId, held);
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
  const writePosture = async (
    tabId: number,
    held: HeldPosture,
    realUserAgent: string,
  ): Promise<EmulationState> => {
    if (!postureIsCurrent(tabId, held)) {
      throw new Error("Emulation posture was released");
    }
    const scale = await fittedScaleFor(
      tabId,
      held.mode,
      held.scale,
      verifiedPostures.get(tabId)?.scale,
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
      { realUserAgent },
    );
    return state;
  };
  const writeAndProvePosture = async (
    tabId: number,
    held: HeldPosture,
    realUserAgent: string,
  ): Promise<Readonly<{
    state: EmulationState;
    measured: MeasuredEmulationPosture | null;
    failureReason: EmulationFailureReason | null;
  }>> => {
    let state = await writePosture(tabId, held, realUserAgent);
    let measured = await measurePosture(tabId);
    let failureReason = proveEmulationPosture(
      state,
      measured,
      intendedUserAgentFor(held.mode, realUserAgent),
    );
    if (failureReason !== null && postureIsCurrent(tabId, held)) {
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
        state = await writePosture(tabId, held, realUserAgent);
        for (let frame = 0; frame < 4 && postureIsCurrent(tabId, held); frame += 1) {
          await waitForBrowserFrame(tabId).catch(() => undefined);
          measured = await measurePosture(tabId);
          failureReason = proveEmulationPosture(
            state,
            measured,
            intendedUserAgentFor(held.mode, realUserAgent),
          );
          if (failureReason === null) {
            break;
          }
        }
      }
    }
    return { state, measured, failureReason };
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
        epoch: nextPostureEpoch(tabId),
      };
      heldPostures.set(tabId, restored);
      try {
        const realUserAgent = await realUserAgentFor(tabId);
        const proof = await writeAndProvePosture(tabId, restored, realUserAgent);
        if (proof.failureReason === null) {
          verifiedPostures.set(tabId, {
            ...proof.state,
            active: true,
            identityStale: false,
          });
          return;
        }
      } catch {
        // Fall through to the neutral browser posture.
      }
    }
    releasePosture(tabId);
    try {
      await clearEmulationViaCdp(
        { send: (method, params) => sendEmulationCommand(tabId, method, params) },
        { mode: attempted.mode, width: 412, height: 960, scale: attempted.scale, active: true },
      );
    } finally {
      await detach(tabId).catch(() => undefined);
      realUserAgents.delete(tabId);
    }
  };
  /** Puts a dropped posture back. Deliberately does not reload: the operator is
   *  looking at the page, and the identity for the current document was settled
   *  when it loaded — re-establishing the viewport is what is urgent here. */
  const executeReassertPosture = async (tabId: number, held: HeldPosture): Promise<void> => {
    if (!postureIsCurrent(tabId, held)) {
      return;
    }
    try {
      const realUserAgent = await realUserAgentFor(tabId);
      if (!postureIsCurrent(tabId, held)) {
        return;
      }
      const proof = await writeAndProvePosture(tabId, held, realUserAgent);
      if (proof.failureReason !== null) {
        throw new Error(`Emulation proof failed: ${proof.failureReason}`);
      }
      verifiedPostures.set(tabId, {
        ...proof.state,
        active: true,
        identityStale: false,
      });
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
  const reassertPosture = (tabId: number, held: HeldPosture): Promise<void> =>
    withEmulationOperation(tabId, () => executeReassertPosture(tabId, held));
  input.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "loading") {
      return;
    }
    const held = heldPostures.get(tabId);
    if (held) {
      verifiedPostures.delete(tabId);
      void reassertPosture(tabId, held);
    }
  });
  input.tabs?.onRemoved?.addListener((tabId) => {
    attachedTabs.delete(tabId);
    realUserAgents.delete(tabId);
    releasePosture(tabId);
  });
  input.windows?.onBoundsChanged?.addListener((window) => {
    const windowId = window.id;
    if (typeof windowId !== "number") {
      return;
    }
    for (const [tabId, held] of heldPostures) {
      if (tabWindowIds.get(tabId) !== windowId) {
        continue;
      }
      // The page's layout viewport remains the emulated device size; only the
      // resulting view-image scale changes. Reassert the same held target after
      // Chrome commits the new browser bounds, never an intermediate desktop
      // or neutral posture.
      verifiedPostures.delete(tabId);
      void reassertPosture(tabId, held);
    }
  });

  return {
    heldMode(tabId: number): EmulationMode | null {
      return heldPostures.get(tabId)?.mode ?? null;
    },
    async current(
      tabId: number,
      mode: EmulationMode,
      maximumScale: number,
    ): Promise<VerifiedEmulationState | null> {
      return withEmulationOperation(tabId, async () => {
        const held = heldPostures.get(tabId);
        const verified = verifiedPostures.get(tabId);
        if (!held || !verified || held.mode !== mode) {
          return null;
        }
        const fittedScale = await fittedScaleFor(tabId, mode, maximumScale, verified.scale);
        if (Math.abs(fittedScale - verified.scale) > 0.001) {
          verifiedPostures.delete(tabId);
          return null;
        }
        const realUserAgent = await realUserAgentFor(tabId);
        const failureReason = proveEmulationPosture(
          verified,
          await measurePosture(tabId),
          intendedUserAgentFor(mode, realUserAgent),
        );
        if (failureReason !== null || !postureIsCurrent(tabId, held)) {
          verifiedPostures.delete(tabId);
          return null;
        }
        return verified;
      });
    },
    async apply(
      tabId: number,
      mode: EmulationMode,
      scale: number,
      allowReload = false,
    ): Promise<VerifiedEmulationState> {
      const priorHeld = heldPostures.get(tabId);
      const held: HeldPosture = { mode, scale, epoch: nextPostureEpoch(tabId) };
      cancelReassertRetry(tabId);
      heldPostures.set(tabId, held);
      verifiedPostures.delete(tabId);
      try {
        return await withEmulationOperation(tabId, async () => {
          const realUserAgent = await realUserAgentFor(tabId);
          const proof = await writeAndProvePosture(tabId, held, realUserAgent);
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
            return verified;
          }
          const identityStale = proof.failureReason === "identity_mismatch";
          if (identityStale && allowReload && input.tabs) {
            try {
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
        });
      } catch (error) {
        if (postureIsCurrent(tabId, held)) {
          try {
            await restorePriorPosture(tabId, held, priorHeld);
          } catch {
            // Restoration itself is best-effort, but a failed attempt may not
            // remain the desired posture or keep a half-applied debugger state.
            if (postureIsCurrent(tabId, held)) {
              releasePosture(tabId);
            }
            await detach(tabId).catch(() => undefined);
            realUserAgents.delete(tabId);
          }
        }
        throw error;
      }
    },
    async clear(tabId: number) {
      // Invalidate the desired posture before the first CDP await. An onDetach
      // callback or already-running reassertion may otherwise retain the old
      // object and attach/set overrides after this clear has completed.
      releasePosture(tabId);
      return withEmulationOperation(tabId, async () => {
        try {
          return await clearEmulationViaCdp(
            { send: (method, params) => sendEmulationCommand(tabId, method, params) },
            {
              mode: "mobile",
              width: 412,
              height: 960,
              scale: 1,
              active: true,
            },
          );
        } finally {
          // Detaching drops every override with it, including the user agent, so
          // the next attach must read the browser's own identity again. Cleanup
          // is unconditional: a failed intermediate restore may not retain the
          // debugger or block the next transition.
          await detach(tabId).catch(() => undefined);
          realUserAgents.delete(tabId);
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
