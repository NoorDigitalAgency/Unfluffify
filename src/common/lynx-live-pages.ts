import { setGlobalToken } from "./settings-store.js";

import { normalizeCandidatePageUrl } from "./lynx-checklist.js";

type CandidatePage = {
  url?: string;
  duplicate?: boolean;
};

type PropertyPageType = {
  key?: string;
  title?: string;
  candidates?: CandidatePage[];
};

type CurrentPageCandidateState = {
  status: "empty" | "missing" | "duplicate" | "candidate";
  pageTypeKey: string;
  pageTypeTitle: string;
  url: string;
};

export const URL_SEARCH_INFO_QUERY = `
query getUrlSearchInfo($url: String!, $includePageInfo: Boolean!) {
  urlSearchInfo(url: $url, includePageInfo: $includePageInfo) {
    domainId
    domainName
  }
}
`;

export const PROPERTY_PAGE_TYPES_QUERY = `
query getPropertyPageTypes($domainId: Int!) {
  propertyPageTypes(domainId: $domainId) {
    pageTypes {
      pageType
      pages {
        url
        wordsCount
      }
    }
  }
}
`;

export function normalizeStageBase(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  let hostname = "";
  try {
    const url = trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    hostname = (url.hostname || "").trim().toLowerCase();
  } catch (error) {
    return "";
  }
  const normalized = hostname.replace(/^\.+/, "").replace(/\.+$/, "");
  if (!normalized) {
    return "";
  }
  const domainPattern =
    /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  return domainPattern.test(normalized) ? normalized : "";
}

export function buildGraphqlEndpointFromStageBase(stageBase: unknown): string {
  const normalized = normalizeStageBase(stageBase);
  if (!normalized) {
    return "";
  }
  return `https://api.${normalized}/graphql`;
}

export function normalizeSiteIdValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getCurrentPageCandidateState(
  pageUrl: string,
  pageTypes: PropertyPageType[] | null | undefined
): CurrentPageCandidateState {
  const normalizedUrl = normalizeCandidatePageUrl(pageUrl);
  if (!normalizedUrl || !Array.isArray(pageTypes) || !pageTypes.length) {
    return {
      status: Array.isArray(pageTypes) && pageTypes.length ? "missing" : "empty",
      pageTypeKey: "",
      pageTypeTitle: "",
      url: normalizedUrl
    };
  }
  const matches: Array<{ pageType: PropertyPageType; candidate: CandidatePage }> = [];
  pageTypes.forEach((pageType) => {
    const candidates = Array.isArray(pageType.candidates) ? pageType.candidates : [];
    candidates.forEach((candidate) => {
      if (candidate && candidate.url === normalizedUrl) {
        matches.push({ pageType, candidate });
      }
    });
  });
  if (!matches.length) {
    return { status: "missing", pageTypeKey: "", pageTypeTitle: "", url: normalizedUrl };
  }
  if (matches.length > 1 || matches.some((item) => item.candidate && item.candidate.duplicate)) {
    return { status: "duplicate", pageTypeKey: "", pageTypeTitle: "", url: normalizedUrl };
  }
  const firstMatch = matches[0];
  return {
    status: "candidate",
    pageTypeKey: typeof firstMatch?.pageType.key === "string" ? firstMatch.pageType.key : "",
    pageTypeTitle: typeof firstMatch?.pageType.title === "string" ? firstMatch.pageType.title : "",
    url: normalizedUrl
  };
}

export async function maybeUpdateStoredTokenFromResponse(
  response: Response | { headers?: { get?: (name: string) => string | null } } | null | undefined,
  currentToken = ""
): Promise<string> {
  if (!response || !response.headers || typeof response.headers.get !== "function") {
    return currentToken || "";
  }
  const updatedToken = (response.headers.get("x-update-token") || "").trim();
  if (!updatedToken) {
    return currentToken || "";
  }
  if (updatedToken === (currentToken || "")) {
    return updatedToken;
  }
  try {
    await setGlobalToken(updatedToken);
  } catch {
    // Ignore storage update errors so the calling request flow continues.
  }
  return updatedToken;
}
