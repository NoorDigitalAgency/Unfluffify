function normalizeAiAnswer(value) {
  return value === "yes" || value === "no" ? value : "";
}

const ALLOWED_PAGE_TYPE_LABELS = Object.freeze({
  homepage: "Homepage",
  article: "Article",
  listing: "Listing",
  category: "Category",
  product: "Product",
  service_page: "Service Page",
  company: "Company",
  landing_page: "Landing Page",
  utility: "Utility"
});

const ALLOWED_PAGE_TYPE_ORDER = Object.freeze(Object.keys(ALLOWED_PAGE_TYPE_LABELS));

function normalizePageTypeKey(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizeCandidateUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
      parsed.port = "";
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch (error) {
    return "";
  }
}

function formatPageTypeTitleFromKey(value) {
  const key = normalizePageTypeKey(value);
  if (!key) {
    return "";
  }
  if (ALLOWED_PAGE_TYPE_LABELS[key]) {
    return ALLOWED_PAGE_TYPE_LABELS[key];
  }
  return key
    .split("_")
    .filter(Boolean)
    .map((part, index) => {
      if (!index) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      }
      return part;
    })
    .join(" ");
}

function normalizePageTypeTitle(value, fallbackKey) {
  const key = normalizePageTypeKey(fallbackKey);
  if (ALLOWED_PAGE_TYPE_LABELS[key]) {
    return ALLOWED_PAGE_TYPE_LABELS[key];
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return formatPageTypeTitleFromKey(key);
}

function normalizeWordsCount(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeCandidate(rawCandidate) {
  if (!rawCandidate || typeof rawCandidate !== "object") {
    return null;
  }
  const url = normalizeCandidateUrl(rawCandidate.url);
  if (!url) {
    return null;
  }
  return {
    url,
    wordsCount: normalizeWordsCount(rawCandidate.wordsCount)
  };
}

function normalizePageTypeCandidates(rawPageType) {
  const rawCandidates = Array.isArray(rawPageType && rawPageType.candidates)
    ? rawPageType.candidates
    : Array.isArray(rawPageType && rawPageType.pages)
      ? rawPageType.pages
      : [];
  const candidatesByUrl = new Map();
  rawCandidates.forEach((rawCandidate) => {
    const candidate = normalizeCandidate(rawCandidate);
    if (!candidate) {
      return;
    }
    const existing = candidatesByUrl.get(candidate.url);
    if (!existing || candidate.wordsCount > existing.wordsCount) {
      candidatesByUrl.set(candidate.url, candidate);
    }
  });
  return Array.from(candidatesByUrl.values()).sort((left, right) => {
    if (right.wordsCount !== left.wordsCount) {
      return right.wordsCount - left.wordsCount;
    }
    return left.url.localeCompare(right.url);
  });
}

export function normalizePropertyPageTypes(value = []) {
  const rawPageTypes = Array.isArray(value)
    ? value
    : Array.isArray(value && value.pageTypes)
      ? value.pageTypes
      : [];
  const pageTypes = [];
  const seenKeys = new Set();

  rawPageTypes.forEach((rawPageType) => {
    if (!rawPageType || typeof rawPageType !== "object") {
      return;
    }
    const key = normalizePageTypeKey(rawPageType.pageType || rawPageType.key);
    if (!key || !ALLOWED_PAGE_TYPE_LABELS[key] || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    pageTypes.push({
      key,
      title: normalizePageTypeTitle(rawPageType.title, key),
      candidates: normalizePageTypeCandidates(rawPageType)
    });
  });

  pageTypes.sort((left, right) => {
    return ALLOWED_PAGE_TYPE_ORDER.indexOf(left.key) - ALLOWED_PAGE_TYPE_ORDER.indexOf(right.key);
  });

  const duplicateUrlToKeys = new Map();
  pageTypes.forEach((pageType) => {
    pageType.candidates.forEach((candidate) => {
      const keys = duplicateUrlToKeys.get(candidate.url) || [];
      keys.push(pageType.key);
      duplicateUrlToKeys.set(candidate.url, keys);
    });
  });

  const duplicateUrls = Array.from(duplicateUrlToKeys.entries())
    .filter(([, keys]) => keys.length > 1)
    .map(([url]) => url);
  const duplicateUrlSet = new Set(duplicateUrls);
  const pageTypeTitleByKey = new Map(pageTypes.map((pageType) => [pageType.key, pageType.title]));

  return {
    pageTypes: pageTypes.map((pageType) => ({
      key: pageType.key,
      title: pageType.title,
      candidates: pageType.candidates.map((candidate) => {
        const duplicateKeys = duplicateUrlToKeys.get(candidate.url) || [];
        return {
          url: candidate.url,
          wordsCount: candidate.wordsCount,
          duplicate: duplicateUrlSet.has(candidate.url),
          duplicatePageTypes: duplicateKeys
            .filter((key) => key !== pageType.key)
            .map((key) => pageTypeTitleByKey.get(key) || formatPageTypeTitleFromKey(key))
        };
      })
    })),
    duplicateUrls
  };
}

function normalizeMarkedPages(markedPages, normalizedPageTypes) {
  const candidatesByPageType = new Map();
  const duplicateUrlSet = new Set();
  normalizedPageTypes.forEach((pageType) => {
    const urls = new Set();
    pageType.candidates.forEach((candidate) => {
      urls.add(candidate.url);
      if (candidate.duplicate) {
        duplicateUrlSet.add(candidate.url);
      }
    });
    candidatesByPageType.set(pageType.key, urls);
  });

  const activeMarkedPages = [];
  const invalidMarkedPages = [];
  const seenKeys = new Set();
  const rawMarkedPages = Array.isArray(markedPages) ? markedPages : [];

  rawMarkedPages.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const url = normalizeCandidateUrl(item.url);
    const pageType = normalizePageTypeKey(item.pageType);
    if (!url || !pageType) {
      invalidMarkedPages.push(item);
      return;
    }
    const dedupeKey = `${pageType}|${url}`;
    if (seenKeys.has(dedupeKey)) {
      return;
    }
    seenKeys.add(dedupeKey);
    const allowedUrls = candidatesByPageType.get(pageType);
    if (!allowedUrls || !allowedUrls.has(url) || duplicateUrlSet.has(url)) {
      invalidMarkedPages.push({ ...item, url, pageType });
      return;
    }
    activeMarkedPages.push({
      url,
      pageType,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : url
    });
  });

  return { activeMarkedPages, invalidMarkedPages };
}

export function createInitialLynxChecklistState() {
  return {
    aiAnswer: "",
    pageTypes: []
  };
}

export function normalizeLynxChecklistState(value = {}) {
  const normalizedPageTypes = normalizePropertyPageTypes(value.pageTypes);
  return {
    aiAnswer: normalizeAiAnswer(value.aiAnswer),
    pageTypes: normalizedPageTypes.pageTypes
  };
}

export function buildLynxChecklistViewModel(options = {}) {
  const normalized = normalizeLynxChecklistState(options);
  const { activeMarkedPages, invalidMarkedPages } = normalizeMarkedPages(
    options.markedPages,
    normalized.pageTypes
  );
  const markedPagesByType = activeMarkedPages.reduce((result, item) => {
    if (!result[item.pageType]) {
      result[item.pageType] = [];
    }
    result[item.pageType].push(item);
    return result;
  }, {});
  const pageTypes = normalized.pageTypes.map((pageType) => {
    const markedPages = markedPagesByType[pageType.key] || [];
    return {
      ...pageType,
      markedPages,
      markedCount: markedPages.length,
      missing: markedPages.length === 0,
      candidateCount: pageType.candidates.length,
      candidatePreview: pageType.candidates.slice(0, 3)
    };
  });
  const missingPageTypes = pageTypes.filter((pageType) => pageType.missing);

  let blockingReason = { code: "" };
  if (!pageTypes.length) {
    blockingReason = { code: "no_candidates" };
  } else if (normalized.aiAnswer === "no") {
    blockingReason = { code: "ai_no" };
  } else if (normalized.aiAnswer !== "yes") {
    blockingReason = { code: "ai_unanswered" };
  } else if (missingPageTypes.length) {
    blockingReason = {
      code: "missing_page_types",
      pageTypeKeys: missingPageTypes.map((item) => item.key)
    };
  }

  return {
    aiAnswer: normalized.aiAnswer,
    pageTypes,
    missingPageTypes,
    activeMarkedPages,
    invalidMarkedPages,
    duplicateUrls: normalized.pageTypes
      .flatMap((pageType) => pageType.candidates)
      .filter((candidate) => candidate.duplicate)
      .map((candidate) => candidate.url),
    coveredPageTypeCount: pageTypes.length - missingPageTypes.length,
    canSend: blockingReason.code === "",
    blockingReason
  };
}

export function buildLynxChecklistAssignments(value = {}) {
  const normalized = normalizeLynxChecklistState(value);
  const { activeMarkedPages } = normalizeMarkedPages(value.markedPages, normalized.pageTypes);
  const orderByPageType = new Map(normalized.pageTypes.map((item, index) => [item.key, index]));
  return activeMarkedPages
    .slice()
    .sort((left, right) => {
      const leftOrder = orderByPageType.has(left.pageType) ? orderByPageType.get(left.pageType) : Number.MAX_SAFE_INTEGER;
      const rightOrder = orderByPageType.has(right.pageType) ? orderByPageType.get(right.pageType) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.url.localeCompare(right.url);
    })
    .map((item) => ({
      key: item.pageType,
      url: item.url,
      pageType: item.pageType
    }));
}