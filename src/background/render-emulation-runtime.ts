import { getBrowserRuntimeLastError } from "../common/browser";
import { applyEmulationViaCdp, clearEmulationViaCdp, deriveGooglebotSmartphoneUserAgent, type EmulationMode } from "../content/stabilization";

type Debuggee = Readonly<{ tabId?: number }>;
type DebuggerApi = Readonly<{
  attach(target: Debuggee, version: string, callback?: () => void): Promise<void> | void;
  detach(target: Debuggee, callback?: () => void): Promise<void> | void;
  sendCommand(target: Debuggee, method: string, params?: Record<string, unknown>, callback?: (result?: unknown) => void): Promise<unknown> | void;
  onDetach?: Readonly<{ addListener(listener: (source: Debuggee, reason?: string) => void): void }>;
}>;
type TabsApi = Readonly<{
  reload(tabId: number, options?: Record<string, unknown>, callback?: () => void): Promise<void> | void;
  sendMessage(tabId: number, message: unknown): Promise<unknown> | unknown;
  onUpdated?: Readonly<{
    addListener(listener: (tabId: number, changeInfo: Readonly<{ status?: string }>) => void): void;
  }>;
  onRemoved?: Readonly<{ addListener(listener: (tabId: number) => void): void }>;
}>;

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return Boolean(value) && typeof (value as PromiseLike<T>).then === "function";
}

function callbackToPromise<T>(invoke: (callback: (value?: T) => void) => Promise<T> | void): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
    };
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

export function createRenderEmulationRuntime(input: Readonly<{
  debuggerApi?: DebuggerApi;
  tabs?: TabsApi;
  onDebuggerDetached?: (tabId: number, reason?: string) => void;
}>) {
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
  const postureEpochs = new Map<number, number>();
  const nextPostureEpoch = (tabId: number): number => {
    const epoch = (postureEpochs.get(tabId) ?? 0) + 1;
    postureEpochs.set(tabId, epoch);
    return epoch;
  };
  const postureIsCurrent = (tabId: number, held: HeldPosture): boolean =>
    heldPostures.get(tabId) === held && postureEpochs.get(tabId) === held.epoch;
  const releasePosture = (tabId: number): void => {
    nextPostureEpoch(tabId);
    heldPostures.delete(tabId);
  };
  /** Reasons the operator did not choose. A closing tab has nothing to restore, and
   *  a replaced target means the tab is being taken over by something else. */
  const TERMINAL_DETACH_REASONS = new Set(["target_closed", "target_crashed", "replaced_with_devtools"]);
  input.debuggerApi?.onDetach?.addListener((source, reason) => {
    const tabId = source.tabId;
    if (typeof tabId !== "number") {
      return;
    }
    input.onDebuggerDetached?.(tabId, reason);
    attachedTabs.delete(tabId);
    realUserAgents.delete(tabId);
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
      await callbackToPromise<void>((callback) => debuggerApi.attach(target, "1.3", callback));
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
      return await callbackToPromise<unknown>((callback) => debuggerApi.sendCommand(target, method, params, callback));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/attach|debugger|detached/i.test(message)) {
        throw error;
      }
      attachedTabs.delete(tabId);
      await attach(tabId);
      return await callbackToPromise<unknown>((callback) => debuggerApi.sendCommand(target, method, params, callback));
    }
  };
  const detach = async (tabId: number): Promise<void> => {
    if (!input.debuggerApi || !attachedTabs.has(tabId)) return;
    try {
      await callbackToPromise<void>((callback) => input.debuggerApi?.detach(targetFor(tabId), callback));
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
      return "";
    }
  };
  /** What the CURRENT document believes its user agent is. Chrome fixes
   *  `navigator.userAgent` when a document is created, so an override applied
   *  afterwards changes what the next load sees and nothing about this one. */
  const documentUserAgent = async (tabId: number): Promise<string> => {
    try {
      const result = await send(tabId, "Runtime.evaluate", {
        expression: "navigator.userAgent",
        returnByValue: true,
      });
      const value = (result as { result?: { value?: unknown } } | undefined)?.result?.value;
      return typeof value === "string" ? value : "";
    } catch {
      return "";
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
      await applyEmulationViaCdp(
        {
          async send(method, params) {
            if (!postureIsCurrent(tabId, held)) {
              throw new Error("Emulation posture was released");
            }
            const result = await send(tabId, method, params);
            if (!postureIsCurrent(tabId, held)) {
              throw new Error("Emulation posture was released");
            }
            return result;
          },
        },
        held.mode,
        held.scale,
        { realUserAgent },
      );
    } catch {
      // The tab may be gone, or attaching may be refused. Nothing else to try, and
      // the next apply from the popup will re-establish it.
      if (postureIsCurrent(tabId, held)) {
        releasePosture(tabId);
      }
    }
  };
  const reassertPosture = (tabId: number, held: HeldPosture): Promise<void> =>
    withEmulationOperation(tabId, () => executeReassertPosture(tabId, held));
  input.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "loading") {
      return;
    }
    const held = heldPostures.get(tabId);
    if (held) {
      void reassertPosture(tabId, held);
    }
  });
  input.tabs?.onRemoved?.addListener((tabId) => {
    attachedTabs.delete(tabId);
    realUserAgents.delete(tabId);
    releasePosture(tabId);
  });

  return {
    heldMode(tabId: number): EmulationMode | null {
      return heldPostures.get(tabId)?.mode ?? null;
    },
    async apply(tabId: number, mode: EmulationMode, scale: number, allowReload = false) {
      const held: HeldPosture = { mode, scale, epoch: nextPostureEpoch(tabId) };
      heldPostures.set(tabId, held);
      return withEmulationOperation(tabId, async () => {
        const realUserAgent = await realUserAgentFor(tabId);
        const state = await applyEmulationViaCdp(
          { send: (method, params) => send(tabId, method, params) },
          mode,
          scale,
          { realUserAgent },
        );
        // The override is in place for the NEXT load, so the document the operator
        // is looking at was still fetched under the old identity — and a site that
        // serves by user agent gave it the desktop page. Forcing the posture means
        // reloading once so the document itself is the mobile one. Self-terminating:
        // after the reload the document's own UA matches, so nothing asks again.
        const intended = mode === "mobile" ? deriveGooglebotSmartphoneUserAgent(realUserAgent) : realUserAgent;
        const identityStale = Boolean(intended) && await documentUserAgent(tabId) !== intended;
        if (identityStale && allowReload && input.tabs) {
          await callbackToPromise<void>((callback) => input.tabs?.reload(tabId, {}, callback)).catch(() => undefined);
        }
        return { ...state, identityStale };
      });
    },
    async clear(tabId: number) {
      // Invalidate the desired posture before the first CDP await. An onDetach
      // callback or already-running reassertion may otherwise retain the old
      // object and attach/set overrides after this clear has completed.
      releasePosture(tabId);
      return withEmulationOperation(tabId, async () => {
        const cleared = await clearEmulationViaCdp({ send: (method, params) => send(tabId, method, params) }, {
          mode: "mobile",
          width: 412,
          height: 960,
          scale: 1,
          active: true,
        });
        // Detaching drops every override with it, including the user agent, so the
        // next attach must read the browser's own identity again.
        await detach(tabId);
        realUserAgents.delete(tabId);
        return cleared;
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
    /** Initiates the load. Its callback acknowledges only that Chrome accepted
     * the reload request; render inspection success belongs to the replacement
     * document's matching post-paint acknowledgement. */
    async reload(tabId: number): Promise<void> {
      if (!input.tabs) {
        throw new Error("Tabs API unavailable");
      }
      await callbackToPromise<void>((callback) => input.tabs?.reload(tabId, { bypassCache: true }, callback));
    },
  };
}
