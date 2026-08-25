export type ReloadTransitionContext = Readonly<{ tabId: number; url: string }>;

export type ReloadPropertyIdentity = Readonly<{
  environmentKey: string;
  siteId: number;
}>;

export type ReloadTransitionResult<T extends ReloadTransitionContext> =
  | Readonly<{ status: "ready"; context: T }>
  | Readonly<{ status: "identity_changed"; context: T | null }>
  | Readonly<{ status: "timed_out"; context: T | null }>;

export function normalizedTransitionUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** A replacement content realm is usable only after it has re-adopted the
 * property's local authority. Runtime reachability alone is too early: the
 * document-start script can answer status while its page-context handshake is
 * still in flight, which makes the first activation fail and roll emulation
 * back even though the same page becomes ready moments later. */
export function replacementContentStatusReady(
  value: unknown,
  currentUrl: string,
  expectedProperty?: ReloadPropertyIdentity,
): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const status = value as { ok?: unknown; pageUrl?: unknown; authority?: unknown };
  if (
    status.ok !== true ||
    typeof status.pageUrl !== "string" ||
    normalizedTransitionUrl(status.pageUrl) !== normalizedTransitionUrl(currentUrl)
  ) {
    return false;
  }
  if (expectedProperty === undefined) {
    return true;
  }
  if (!status.authority || typeof status.authority !== "object") {
    return false;
  }
  const authority = status.authority as {
    environmentKey?: unknown;
    siteId?: unknown;
    lockBlocked?: unknown;
  };
  return authority.environmentKey === expectedProperty.environmentKey &&
    authority.siteId === expectedProperty.siteId &&
    authority.lockBlocked === false;
}

export async function waitForReloadTransition<T extends ReloadTransitionContext>(options: Readonly<{
  original: T;
  resolveContext: () => Promise<T | null>;
  contentReady: (context: T) => Promise<boolean>;
  wait: (delayMs: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  intervalMs?: number;
}>): Promise<ReloadTransitionResult<T>> {
  const expectedUrl = normalizedTransitionUrl(options.original.url);
  if (expectedUrl === null) {
    return { status: "identity_changed", context: null };
  }
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 10_000);
  const intervalMs = options.intervalMs ?? 100;
  let latest: T | null = null;
  while (now() <= deadline) {
    latest = await options.resolveContext();
    if (
      latest &&
      latest.tabId === options.original.tabId &&
      normalizedTransitionUrl(latest.url) === expectedUrl
    ) {
      if (await options.contentReady(latest)) {
        return { status: "ready", context: latest };
      }
    } else if (latest && latest.url) {
      return { status: "identity_changed", context: latest };
    }
    await options.wait(intervalMs);
  }
  return { status: "timed_out", context: latest };
}
