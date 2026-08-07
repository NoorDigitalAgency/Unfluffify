import { getBrowserRuntimeLastError } from "../common/browser";
import { applyEmulationViaCdp, clearEmulationViaCdp, deriveMobileUserAgent, loadPageWithJavascript, restoreJavascriptViaCdp, type EmulationMode } from "../content/stabilization";

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
}>) {
  const attachedTabs = new Set<number>();
  /** The browser's own user agent, per tab, read BEFORE anything overrides it —
   *  read afterwards it would return our own spoof and the mobile UA would be
   *  derived from itself, compounding on every re-apply. */
  const realUserAgents = new Map<number, string>();
  /** The posture each tab is meant to hold, so it can be re-established without
   *  the popup being asked. Emulation is not a request that was granted once; it is
   *  a state the tab is supposed to be in. */
  const heldPostures = new Map<number, Readonly<{ mode: EmulationMode; scale: number }>>();
  /** Reasons the operator did not choose. A closing tab has nothing to restore, and
   *  a replaced target means the tab is being taken over by something else. */
  const TERMINAL_DETACH_REASONS = new Set(["target_closed", "target_crashed", "replaced_with_devtools"]);
  input.debuggerApi?.onDetach?.addListener((source, reason) => {
    const tabId = source.tabId;
    if (typeof tabId !== "number") {
      return;
    }
    attachedTabs.delete(tabId);
    realUserAgents.delete(tabId);
    const held = heldPostures.get(tabId);
    if (!held || (reason && TERMINAL_DETACH_REASONS.has(reason))) {
      heldPostures.delete(tabId);
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
  const reassertPosture = async (tabId: number, held: Readonly<{ mode: EmulationMode; scale: number }>): Promise<void> => {
    try {
      const realUserAgent = await realUserAgentFor(tabId);
      await applyEmulationViaCdp(
        { send: (method, params) => send(tabId, method, params) },
        held.mode,
        held.scale,
        { realUserAgent },
      );
    } catch {
      // The tab may be gone, or attaching may be refused. Nothing else to try, and
      // the next apply from the popup will re-establish it.
      heldPostures.delete(tabId);
    }
  };

  return {
    async apply(tabId: number, mode: EmulationMode, scale: number, allowReload = false) {
      heldPostures.set(tabId, { mode, scale });
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
      const intended = mode === "mobile" ? deriveMobileUserAgent(realUserAgent) : realUserAgent;
      const identityStale = Boolean(intended) && await documentUserAgent(tabId) !== intended;
      if (identityStale && allowReload && input.tabs) {
        await callbackToPromise<void>((callback) => input.tabs?.reload(tabId, {}, callback)).catch(() => undefined);
      }
      return { ...state, identityStale };
    },
    async clear(tabId: number) {
      const cleared = await clearEmulationViaCdp({ send: (method, params) => send(tabId, method, params) }, {
        mode: "mobile",
        width: 412,
        height: 960,
        scale: 1,
        active: true,
      });
      // Detaching drops every override with it, including the user agent, so the
      // next attach must read the browser's own identity again.
      heldPostures.delete(tabId);
      await detach(tabId);
      realUserAgents.delete(tabId);
      return cleared;
    },
    /** Loads the tab with JavaScript on or off so the operator can compare the
     *  two views themselves. The reload drops the property lock and the content
     *  script, so the caller has to re-establish both. */
    async inspect(inputRequest: Readonly<{ tabId: number; javascriptEnabled: boolean }>) {
      const tabs = input.tabs;
      if (!tabs) {
        return { status: "unavailable" as const, reclaimLockAfterReload: false };
      }
      try {
        await loadPageWithJavascript(
          { send: (method, params) => send(inputRequest.tabId, method, params) },
          () => callbackToPromise<void>((callback) => tabs.reload(inputRequest.tabId, { bypassCache: true }, callback)),
          inputRequest.javascriptEnabled,
        );
        return { status: "ok" as const, reclaimLockAfterReload: true };
      } catch {
        // Leave the tab usable rather than stuck with scripts disabled.
        await restoreJavascriptViaCdp({ send: (method, params) => send(inputRequest.tabId, method, params) }).catch(() => undefined);
        return { status: "error" as const, reclaimLockAfterReload: true };
      }
    },
  };
}
