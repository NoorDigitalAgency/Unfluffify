export const DOMAIN_CACHE_DATA = Object.freeze({
  appcache: true,
  cache: true,
  cacheStorage: true,
  cookies: true,
  fileSystems: true,
  indexedDB: true,
  localStorage: true,
  serviceWorkers: true,
  webSQL: true,
});

type BrowsingDataApi = Readonly<{
  remove: (
    options: Readonly<{ origins: [string, ...string[]] }>,
    dataToRemove: typeof DOMAIN_CACHE_DATA,
  ) => Promise<void> | void;
}>;

export function normalizeCacheOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export async function clearDomainCache(api: BrowsingDataApi | null | undefined, value: string): Promise<
  Readonly<{ status: "ok"; origin: string }> | Readonly<{ status: "error"; message: string }>
> {
  const origin = normalizeCacheOrigin(value);
  if (!origin) {
    return { status: "error", message: "This page does not have a clearable website domain." };
  }
  if (!api?.remove) {
    return { status: "error", message: "Chrome cache controls are unavailable." };
  }
  try {
    await Promise.resolve(api.remove({ origins: [origin] }, DOMAIN_CACHE_DATA));
    return { status: "ok", origin };
  } catch {
    return { status: "error", message: "Chrome could not clear this domain's cache." };
  }
}
