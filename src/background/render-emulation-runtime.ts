import { getBrowserRuntimeLastError } from "../common/browser";
import { applyEmulationViaCdp, clearEmulationViaCdp, inspectRenderMode, reloadWithoutJavascriptViaCdp, restoreJavascriptViaCdp, type EmulationMode } from "../content/stabilization";
import { createRealmBus } from "../messaging/realms";
import { createTabTransport } from "../messaging/transports/tabs";

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
  const captureSubmissionHtml = async (tabId: number, pageUrl: string, baseUrl: string, renderMode: "rendered" | "static"): Promise<string> => {
    if (!input.tabs) {
      return "";
    }
    const bus = createRealmBus({
      realm: "background",
      transport: createTabTransport(input.tabs, tabId),
    });
    try {
      const response = await bus.request("command.dispatch", {
        kind: "uf-command/1",
        name: "captureSubmissionSnapshot",
        tabId,
        payload: { pageUrl, baseUrl, renderMode },
      }, { target: "content" });
      if (!response.ok || !response.data.ok || !response.data.data || typeof response.data.data !== "object") {
        return "";
      }
      const data = response.data.data as { snapshot?: { pages?: Array<{ renderedHtml?: string; rawHtml?: string }> } };
      const page = data.snapshot?.pages?.[0];
      return renderMode === "static" ? page?.rawHtml ?? page?.renderedHtml ?? "" : page?.renderedHtml ?? "";
    } finally {
      bus.dispose();
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
    async inspect(inputRequest: Readonly<{ tabId: number; pageUrl: string; baseUrl: string; deviceSimulationEnabled: boolean }>) {
      const tabs = input.tabs;
      if (!tabs) {
        return { status: "unavailable" as const };
      }
      try {
        const result = await inspectRenderMode({
          captureRenderedHtml: () => captureSubmissionHtml(inputRequest.tabId, inputRequest.pageUrl, inputRequest.baseUrl, "rendered"),
          reloadWithoutJavascript: () => reloadWithoutJavascriptViaCdp(
            { send: (method, params) => send(inputRequest.tabId, method, params) },
            () => callbackToPromise<void>((callback) => tabs.reload(inputRequest.tabId, { bypassCache: true }, callback)),
          ),
          captureStaticHtml: async () => {
            const captured = await captureSubmissionHtml(inputRequest.tabId, inputRequest.pageUrl, inputRequest.baseUrl, "static");
            if (captured) return captured;
            return await fetch(inputRequest.pageUrl).then((response) => response.text());
          },
          restoreJavascript: () => restoreJavascriptViaCdp({ send: (method, params) => send(inputRequest.tabId, method, params) }),
          deviceSimulationEnabled: inputRequest.deviceSimulationEnabled,
        });
        return { status: "ok" as const, ...result };
      } finally {
        await restoreJavascriptViaCdp({ send: (method, params) => send(inputRequest.tabId, method, params) }).catch(() => undefined);
      }
    },
  };
}
