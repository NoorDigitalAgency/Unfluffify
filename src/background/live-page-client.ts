import { normalizePropertyPageTypes } from "../common/lynx-checklist";
import {
  PROPERTY_PAGE_TYPES_QUERY,
  URL_SEARCH_INFO_QUERY,
  buildGraphqlEndpointFromStageBase,
  maybeUpdateStoredTokenFromResponse,
  normalizeSiteIdValue
} from "../common/lynx-live-pages";
import { normalizeCanonicalBaseUrl } from "../common/utilities";

type ResolveCredentialsResult = {
  stageBaseValue: string;
  tokenValue: string;
};

type ResolveCredentials = (options: {
  stageBase?: string;
  tokenValue?: string;
  endpointPreference: "ai";
}) => Promise<ResolveCredentialsResult>;

type ResolveLivePageSiteIdOptions = {
  stageBase?: string;
  tokenValue?: string;
  pageUrl?: string;
  resolveBackgroundNetworkCredentials?: ResolveCredentials;
};

type ResolveLivePageSiteIdResult = {
  ok: boolean;
  siteId: number | null;
  baseUrl: string;
  notFound?: boolean;
};

type FetchLivePagePropertyPageTypesOptions = {
  siteId?: number | string | null;
  stageBase?: string;
  tokenValue?: string;
  resolveBackgroundNetworkCredentials?: ResolveCredentials;
};

type NormalizedPropertyPageTypeCandidate = {
  url: string;
  wordsCount: number;
  duplicate: boolean;
  duplicatePageTypes: string[];
};

type NormalizedPropertyPageType = {
  key: string;
  title: string;
  candidates: NormalizedPropertyPageTypeCandidate[];
};

type FetchLivePagePropertyPageTypesResult = {
  ok: boolean;
  pageTypes: NormalizedPropertyPageType[];
  duplicateUrls?: string[];
  signature?: string;
  reason?: string;
};

type PropertyPageTypeCandidate = {
  url?: string;
  wordsCount?: number;
  duplicate?: boolean;
};

type PropertyPageType = {
  key?: string;
  candidates?: PropertyPageTypeCandidate[];
};

type UrlSearchInfoError = {
  extensions?: { code?: string };
};

type UrlSearchInfoResponse = {
  data?: {
    urlSearchInfo?: {
      domainId?: number | string | null;
      domainName?: string | null;
    } | null;
  };
  errors?: UrlSearchInfoError[];
};

type PropertyPageTypesResponse = {
  data?: { propertyPageTypes?: object };
  errors?: object[];
};

// export function normalizeBaseUrlFromDomainName(domainName, pageUrl = "") {
export function normalizeBaseUrlFromDomainName(domainName: unknown, pageUrl: unknown = ""): string {
  const normalizedDomainName = typeof domainName === "string" ? domainName : "";
  if (!normalizedDomainName) {
    return "";
  }
  const raw = normalizedDomainName.trim();
  if (!raw) {
    return "";
  }
  let protocol = "https:";
  const pageUrlValue = typeof pageUrl === "string" ? pageUrl : "";
  try {
    const page = new URL(pageUrlValue);
    if (page.protocol === "http:" || page.protocol === "https:") {
      protocol = page.protocol;
    }
  } catch {
    // Use HTTPS default.
  }
  let parsed = null;
  try {
    parsed = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(`${protocol}//${raw.replace(/^\/+/, "")}`);
  } catch {
    return "";
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return "";
  }
  const hostname = (parsed.hostname || "").trim().toLowerCase();
  if (!hostname) {
    return "";
  }
  let pathname = parsed.pathname || "/";
  pathname = pathname.replace(/\/+$/, "");
  if (!pathname) {
    pathname = "/";
  }
  const normalized = `${parsed.protocol}//${hostname}${pathname === "/" ? "" : pathname}`;
  return normalizeCanonicalBaseUrl(normalized) || normalized;
}

// export function buildPropertyPageTypesSignature(pageTypes) {
export function buildPropertyPageTypesSignature(pageTypes: unknown): string {
  const normalizedPageTypes = Array.isArray(pageTypes) ? (pageTypes as PropertyPageType[]) : [];
  return JSON.stringify(
    Array.isArray(pageTypes)
      ? normalizedPageTypes.map((pageType) => [
          pageType && typeof pageType.key === "string" ? pageType.key : "",
          Array.isArray(pageType && pageType.candidates)
            ? (pageType.candidates as PropertyPageTypeCandidate[]).map((candidate) => [
                candidate && typeof candidate.url === "string" ? candidate.url : "",
                Number.isFinite(candidate && candidate.wordsCount) ? candidate.wordsCount : 0,
                candidate && candidate.duplicate ? 1 : 0
              ])
            : []
        ])
      : []
  );
}

// export async function resolveLivePageSiteId(options = {}) {
export async function resolveLivePageSiteId(
  options = {} as ResolveLivePageSiteIdOptions
): Promise<ResolveLivePageSiteIdResult> {
  const resolveCredentials = typeof options.resolveBackgroundNetworkCredentials === "function"
    ? options.resolveBackgroundNetworkCredentials
    : null;
  if (!resolveCredentials) {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }

  const credentials = await resolveCredentials({
    stageBase: options.stageBase,
    tokenValue: options.tokenValue,
    endpointPreference: "ai"
  });
  const stageBase = credentials.stageBaseValue;
  const pageUrl = typeof options.pageUrl === "string" ? options.pageUrl.trim() : "";
  const tokenValue = credentials.tokenValue;
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!graphqlEndpoint || !pageUrl) {
    return { ok: false, siteId: null, baseUrl: "" };
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {})
      },
      body: JSON.stringify({
        query: URL_SEARCH_INFO_QUERY,
        variables: {
          url: pageUrl,
          includePageInfo: false
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    let payload = null;
    try {
      payload = await response.json() as UrlSearchInfoResponse;
    } catch {
      payload = null;
    }
    if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
      const notFound = payload.errors.some((item) => {
        const code = item && item.extensions && typeof item.extensions.code === "string"
          ? item.extensions.code
          : "";
        return code === "NotFound";
      });
      if (notFound) {
        return { ok: true, siteId: null, baseUrl: "", notFound: true };
      }
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    if (!response.ok || !payload) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    const urlSearchInfo = payload && payload.data && typeof payload.data === "object"
      ? payload.data.urlSearchInfo || null
      : null;
    const siteId = normalizeSiteIdValue(urlSearchInfo && urlSearchInfo.domainId);
    const baseUrl = normalizeBaseUrlFromDomainName(
      urlSearchInfo && urlSearchInfo.domainName,
      pageUrl
    );
    if (!siteId) {
      return { ok: true, siteId: null, baseUrl, notFound: true };
    }
    if (!baseUrl) {
      return { ok: false, siteId: null, baseUrl: "", notFound: false };
    }
    return {
      ok: true,
      siteId,
      baseUrl,
      notFound: false
    };
  } catch {
    return { ok: false, siteId: null, baseUrl: "", notFound: false };
  }
}

// export async function fetchLivePagePropertyPageTypes(options = {}) {
export async function fetchLivePagePropertyPageTypes(
  options = {} as FetchLivePagePropertyPageTypesOptions
): Promise<FetchLivePagePropertyPageTypesResult> {
  const normalizedSiteId = normalizeSiteIdValue(options.siteId);
  const resolveCredentials = typeof options.resolveBackgroundNetworkCredentials === "function"
    ? options.resolveBackgroundNetworkCredentials
    : null;
  if (!resolveCredentials) {
    return {
      ok: false,
      pageTypes: [],
      reason: "Unable to verify Live Page candidates."
    };
  }

  const credentials = await resolveCredentials({
    stageBase: options.stageBase,
    tokenValue: options.tokenValue,
    endpointPreference: "ai"
  });
  const stageBase = credentials.stageBaseValue;
  const tokenValue = credentials.tokenValue;
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!normalizedSiteId || !graphqlEndpoint) {
    return {
      ok: false,
      pageTypes: [],
      reason: "Unable to verify Live Page candidates."
    };
  }
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {})
      },
      body: JSON.stringify({
        query: PROPERTY_PAGE_TYPES_QUERY,
        variables: {
          domainId: normalizedSiteId
        }
      })
    });
    await maybeUpdateStoredTokenFromResponse(response, tokenValue);
    let payload = null;
    try {
      payload = await response.json() as PropertyPageTypesResponse;
    } catch {
      payload = null;
    }
    if (!response.ok || !payload || Array.isArray(payload.errors)) {
      return {
        ok: false,
        pageTypes: [],
        reason: "Unable to verify Live Page candidates."
      };
    }
    const normalized = normalizePropertyPageTypes(
      payload && payload.data
        ? payload.data.propertyPageTypes
        : null
    );
    const normalizedPageTypes = Array.isArray(normalized.pageTypes)
      ? (normalized.pageTypes as NormalizedPropertyPageType[])
      : [];
    const duplicateUrls = Array.isArray(normalized.duplicateUrls)
      ? normalized.duplicateUrls.filter((item): item is string => typeof item === "string")
      : [];
    return {
      ok: true,
      pageTypes: normalizedPageTypes,
      // duplicateUrls: normalized.duplicateUrls || [],
      duplicateUrls,
      // signature: buildPropertyPageTypesSignature(normalized.pageTypes)
      signature: buildPropertyPageTypesSignature(normalizedPageTypes)
    };
  } catch {
    return {
      ok: false,
      pageTypes: [],
      reason: "Unable to verify Live Page candidates."
    };
  }
}