import { PROPERTY_LOCK_NETWORK_CHECK_TIMEOUT_MS } from "./timings";

export const PROPERTY_LOCK_NETWORK_CHECK_URLS = [
  "https://www.gstatic.com/generate_204",
  "https://cloudflare.com/cdn-cgi/trace",
] as const;

type ReachabilityFetch = (
  input: string,
  init: Readonly<{
    cache: "no-store";
    mode: "no-cors";
    signal?: AbortSignal;
  }>,
) => Promise<unknown>;

/** A WebSocket failure is not proof that the browser is offline. Probe stable,
 * independent HTTP endpoints before projecting network unavailability. */
export async function checkNetworkReachability(input: Readonly<{
  fetch?: ReachabilityFetch;
  urls?: readonly string[];
  timeoutMs?: number;
  createAbortController?: () => AbortController;
}> = {}): Promise<boolean> {
  const fetcher = input.fetch ?? (typeof globalThis.fetch === "function"
    ? ((url, init) => globalThis.fetch(url, init as RequestInit))
    : undefined);
  if (!fetcher) {
    return true;
  }
  const controller = input.createAbortController?.() ?? (
    typeof AbortController === "function" ? new AbortController() : null
  );
  const timeout = setTimeout(
    () => controller?.abort(),
    input.timeoutMs ?? PROPERTY_LOCK_NETWORK_CHECK_TIMEOUT_MS,
  );
  try {
    for (const url of input.urls ?? PROPERTY_LOCK_NETWORK_CHECK_URLS) {
      try {
        await fetcher(url, {
          cache: "no-store",
          mode: "no-cors",
          ...(controller ? { signal: controller.signal } : {}),
        });
        return true;
      } catch {
        // Try the next endpoint within the same bounded probe window.
      }
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
