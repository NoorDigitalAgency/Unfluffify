// @ts-nocheck
import { normalizePropertyPageTypes } from "../common/lynx-checklist.js";
import {
  PROPERTY_PAGE_TYPES_QUERY,
  URL_SEARCH_INFO_QUERY,
  buildGraphqlEndpointFromStageBase,
  maybeUpdateStoredTokenFromResponse,
  normalizeSiteIdValue
} from "../common/lynx-live-pages.js";
import { normalizeCanonicalBaseUrl } from "../common/utilities.js";

export function normalizeBaseUrlFromDomainName(domainName, pageUrl = "") {
  if (typeof domainName !== "string") {
    return "";
  }
  const raw = domainName.trim();
  if (!raw) {
    return "";
  }
  let protocol = "https:";
  try {
    const page = new URL(pageUrl);
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

export function buildPropertyPageTypesSignature(pageTypes) {
  return JSON.stringify(
    Array.isArray(pageTypes)
      ? pageTypes.map((pageType) => [
          pageType && typeof pageType.key === "string" ? pageType.key : "",
          Array.isArray(pageType && pageType.candidates)
            ? pageType.candidates.map((candidate) => [
                candidate && typeof candidate.url === "string" ? candidate.url : "",
                Number.isFinite(candidate && candidate.wordsCount) ? candidate.wordsCount : 0,
                Boolean(candidate && candidate.duplicate) ? 1 : 0
              ])
            : []
        ])
      : []
  );
}

export async function resolveLivePageSiteId(options = {}) {
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
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
      const notFound = payload.errors.some((item) => {
        const code =
          item &&
          item.extensions &&
          typeof item.extensions.code === "string"
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
    const urlSearchInfo = payload && payload.data ? payload.data.urlSearchInfo : null;
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

export async function fetchLivePagePropertyPageTypes(options = {}) {
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
      payload = await response.json();
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
    return {
      ok: true,
      pageTypes: normalized.pageTypes || [],
      duplicateUrls: normalized.duplicateUrls || [],
      signature: buildPropertyPageTypesSignature(normalized.pageTypes)
    };
  } catch {
    return {
      ok: false,
      pageTypes: [],
      reason: "Unable to verify Live Page candidates."
    };
  }
}