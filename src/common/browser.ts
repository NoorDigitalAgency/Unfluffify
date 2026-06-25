import { browser as wxtBrowser, type Browser } from "wxt/browser";

type BrowserApi = typeof wxtBrowser;
type BrowserHost = typeof globalThis & {
  browser?: BrowserApi;
  chrome?: BrowserApi;
};
type RuntimeLastError = { message?: string } | null;
type InstalledBrowserApi =
  | { api: BrowserApi; mode: "callback" }
  | { api: BrowserApi; mode: "promise" };

function resolveBrowserApi(): BrowserApi {
  const host = globalThis as BrowserHost;
  const runtimeBrowser = host.browser?.runtime?.id ? host.browser : null;
  if (runtimeBrowser) {
    return runtimeBrowser;
  }
  if (wxtBrowser) {
    return wxtBrowser;
  }
  if (host.chrome) {
    return host.chrome;
  }
  throw new Error("Browser APIs are unavailable in this environment");
}

function resolveInstalledBrowserApi(): InstalledBrowserApi | null {
  const host = globalThis as BrowserHost;
  if (host.chrome) {
    return { api: host.chrome, mode: "callback" };
  }
  if (host.browser) {
    return { api: host.browser, mode: "promise" };
  }
  return null;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return Boolean(value) && typeof (value as PromiseLike<T>).then === "function";
}

// Read the extension API surface lazily so tests can install browser/chrome mocks
// after module import while production code still resolves to WXT's runtime seam.
export const browser = new Proxy({} as BrowserApi, {
  get(_target, property, receiver) {
    return Reflect.get(resolveBrowserApi() as object, property, receiver);
  },
}) as BrowserApi;

export function getInstalledBrowserApi(): BrowserApi | null {
  return resolveInstalledBrowserApi()?.api || null;
}

export function getBrowserRuntimeLastError(): RuntimeLastError {
  return resolveInstalledBrowserApi()?.api.runtime?.lastError || null;
}

export function callBrowserApi<T>(
  invokeInstalled: (api: BrowserApi, callback: (result: T | undefined) => void) => unknown,
  invokeResolved: (api: BrowserApi) => Promise<T>,
): Promise<T> {
  const installedApi = resolveInstalledBrowserApi();
  if (!installedApi) {
    return invokeResolved(resolveBrowserApi());
  }
  if (installedApi.mode === "promise") {
    return invokeResolved(installedApi.api);
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };
    try {
      const maybePromise = invokeInstalled(installedApi.api, (result) => {
        const lastError = getBrowserRuntimeLastError();
        if (lastError) {
          finish(() => reject(new Error(lastError.message || "Browser API failed")));
          return;
        }
        finish(() => resolve(result as T));
      });
      if (isPromiseLike<T>(maybePromise)) {
        void maybePromise.then(
          (result) => finish(() => resolve(result)),
          (error) => finish(() => reject(error)),
        );
      }
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export function callBrowserApiVoid(
  invokeInstalled: (api: BrowserApi, callback: () => void) => unknown,
  invokeResolved: (api: BrowserApi) => Promise<unknown>,
): Promise<void> {
  return callBrowserApi<void>(
    (api, callback) => invokeInstalled(api, callback),
    (api) => invokeResolved(api).then(() => undefined),
  );
}

export type { Browser };
