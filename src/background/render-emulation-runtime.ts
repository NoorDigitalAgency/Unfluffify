import { getBrowserRuntimeLastError } from "../common/browser";
import { applyEmulationViaCdp, clearEmulationViaCdp, loadPageWithJavascript, restoreJavascriptViaCdp, type EmulationMode } from "../content/stabilization";

type Debuggee = Readonly<{ tabId?: number }>;
type DebuggerApi = Readonly<{
  attach(target: Debuggee, version: string, callback?: () => void): Promise<void> | void;
  detach(target: Debuggee, callback?: () => void): Promise<void> | void;
  sendCommand(target: Debuggee, method: string, params?: Record<string, unknown>, callback?: (result?: unknown) => void): Promise<unknown> | void;
  onDetach?: Readonly<{ addListener(listener: (source: Debuggee) => void): void }>;
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
  input.debuggerApi?.onDetach?.addListener((source) => {
    if (typeof source.tabId === "number") {
      attachedTabs.delete(source.tabId);
    }
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
  return {
    apply(tabId: number, mode: EmulationMode, scale: number) {
      return applyEmulationViaCdp({ send: (method, params) => send(tabId, method, params) }, mode, scale);
    },
    async clear(tabId: number) {
      const cleared = await clearEmulationViaCdp({ send: (method, params) => send(tabId, method, params) }, {
        mode: "mobile",
        width: 412,
        height: 960,
        scale: 1,
        active: true,
      });
      await detach(tabId);
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
