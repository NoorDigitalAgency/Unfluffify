export const STATIC_HTML_FETCH_TIMEOUT_MS = 30_000;

export type StaticHtmlFetchResult =
  | Readonly<{ ok: true; status: number; url: string; html: string }>
  | Readonly<{ ok: false; status?: number; error: string }>;

/** Fetches the server-delivered document for static render mode. This belongs
 *  in the background realm: content-page fetches are constrained by the page's
 *  CORS policy and popup lifetime, while the extension host permission and
 *  service worker give this request the same durable boundary as AI capture. */
export async function fetchStaticPageHtml(
  url: unknown,
  input: Readonly<{
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
  }> = {},
): Promise<StaticHtmlFetchResult> {
  const targetUrl = typeof url === "string" ? url.trim() : "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { ok: false, error: "Unsupported URL" };
  }

  try {
    const timeout = input.timeoutMs ?? STATIC_HTML_FETCH_TIMEOUT_MS;
    const signal = typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeout)
      : undefined;
    const response = await (input.fetch ?? globalThis.fetch)(parsedUrl.toString(), {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status || 0,
        error: "Static HTML request failed",
      };
    }
    return {
      ok: true,
      status: response.status || 200,
      url: response.url || parsedUrl.toString(),
      html: await response.text(),
    };
  } catch {
    return { ok: false, error: "Static HTML request failed" };
  }
}
