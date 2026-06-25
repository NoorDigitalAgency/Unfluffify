import { browser as wxtBrowser, type Browser } from "wxt/browser";

type BrowserApi = typeof wxtBrowser;
type BrowserHost = typeof globalThis & {
  browser?: BrowserApi;
  chrome?: BrowserApi;
};

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

// Read the extension API surface lazily so tests can install browser/chrome mocks
// after module import while production code still resolves to WXT's runtime seam.
export const browser = new Proxy({} as BrowserApi, {
  get(_target, property, receiver) {
    return Reflect.get(resolveBrowserApi() as object, property, receiver);
  },
}) as BrowserApi;

export type { Browser };
