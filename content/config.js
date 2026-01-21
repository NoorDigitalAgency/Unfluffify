import { normalizePatternValue } from "./patterns.js";

export function createDefaultConfig(baseUrl) {
  let domain = "";
  try {
    domain = new URL(baseUrl).hostname;
  } catch (error) {
    domain = "";
  }

  return {
    baseUrl,
    domain,
    pageMarkings: {},
    latestComputedSelectors: [],
    lastSavedSelectors: [],
    domainAiSelectorSet: {
      inclusionSelectors: []
    }
  };
}

export function normalizePageMarkings(pageMarkings) {
  const normalized = {};
  let changed = false;
  if (!pageMarkings || typeof pageMarkings !== "object") {
    return { normalized, changed };
  }
  Object.entries(pageMarkings).forEach(([url, entry]) => {
    if (!url || !entry || typeof entry !== "object") {
      changed = true;
      return;
    }
    const rawXpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
    const xpaths = rawXpaths
      .map((item) => {
        if (typeof item === "string") {
          changed = true;
          return { xpath: item, excluded: true };
        }
        if (item && typeof item.xpath === "string") {
          return {
            xpath: item.xpath,
            excluded: Boolean(item.excluded)
          };
        }
        changed = true;
        return null;
      })
      .filter(Boolean);
    const rawPattern =
      typeof entry.pagePattern === "string"
        ? entry.pagePattern
        : typeof entry.pattern === "string"
          ? entry.pattern
          : "";
    const pagePattern = normalizePatternValue(rawPattern);
    let resolvedPattern = pagePattern;
    if (!resolvedPattern) {
      const fallbackUrl = typeof entry.url === "string" ? entry.url : url;
      const fallbackPattern = normalizePatternValue(fallbackUrl);
      if (fallbackPattern) {
        resolvedPattern = fallbackPattern;
        changed = true;
      }
    }
    if (entry.pattern) {
      changed = true;
    }
    if (rawPattern && rawPattern !== pagePattern) {
      changed = true;
    }
    const fullHTML =
      typeof entry.fullHTML === "string"
        ? entry.fullHTML
        : typeof entry.fullHtml === "string"
          ? entry.fullHtml
          : typeof entry.html === "string"
            ? entry.html
            : "";
    if (entry.fullHtml || entry.html) {
      changed = true;
    }
    normalized[url] = {
      url: entry.url || url,
      title: entry.title || url,
      xpaths,
      pagePattern: resolvedPattern,
      fullHTML
    };
  });
  return { normalized, changed };
}

export function normalizeAiSelectorSet(value) {
  const normalized = { inclusionSelectors: [] };
  let changed = false;
  if (!value || typeof value !== "object") {
    return { normalized, changed };
  }
  if (Array.isArray(value.inclusionSelectors)) {
    normalized.inclusionSelectors = value.inclusionSelectors;
  } else if (Array.isArray(value.exclusionSelectors)) {
    normalized.inclusionSelectors = value.exclusionSelectors;
    changed = true;
  } else {
    changed = true;
  }
  return { normalized, changed };
}
