import { getPageTypeLabel, getPageTypeSlugs } from "./page-type-taxonomy";

type AiAnswer = "" | "yes" | "no";

type RawCandidate = {
  url?: unknown;
  wordsCount?: unknown;
};

type NormalizedCandidate = {
  url: string;
  wordsCount: number;
};

type ViewCandidate = NormalizedCandidate & {
  duplicate: boolean;
  duplicatePageTypes: string[];
};

type RawPageType = {
  pageType?: unknown;
  key?: unknown;
  title?: unknown;
  candidates?: unknown[];
  pages?: unknown[];
};

type NormalizedPageType = {
  key: string;
  title: string;
  candidates: NormalizedCandidate[];
};

type ViewPageType = {
  key: string;
  title: string;
  candidates: ViewCandidate[];
};

type MarkedPage = {
  url: string;
  pageType: string;
  title: string;
};

type LynxChecklistState = {
  aiAnswer: AiAnswer;
  pageTypes: ViewPageType[];
};

function normalizeAiAnswer(value: unknown): AiAnswer {
  return value === "yes" || value === "no" ? value : "";
}

export function normalizePageTypeKey(value: unknown): string {
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

export function normalizeCandidatePageUrl(value: unknown): string {
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
  } catch (_error) {
    return "";
  }
}

function formatPageTypeTitleFromKey(value: unknown): string {
  const key = normalizePageTypeKey(value);
  if (!key) {
    return "";
  }
  const taxonomyLabel = getPageTypeLabel(key);
  if (taxonomyLabel) {
    return taxonomyLabel;
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

function normalizePageTypeTitle(value: unknown, fallbackKey: unknown): string {
  const key = normalizePageTypeKey(fallbackKey);
  const taxonomyLabel = getPageTypeLabel(key);
  if (taxonomyLabel) {
    return taxonomyLabel;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return formatPageTypeTitleFromKey(key);
}

function normalizeWordsCount(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeCandidate(rawCandidate: unknown): NormalizedCandidate | null {
  if (!rawCandidate || typeof rawCandidate !== "object") {
    return null;
  }
  const candidate = rawCandidate as RawCandidate;
  const url = normalizeCandidatePageUrl(candidate.url);
  if (!url) {
    return null;
  }
  return {
    url,
    wordsCount: normalizeWordsCount(candidate.wordsCount)
  };
}

function normalizePageTypeCandidates(rawPageType: unknown): NormalizedCandidate[] {
  const pageType = (rawPageType && typeof rawPageType === "object")
    ? (rawPageType as RawPageType)
    : {};
  const rawCandidates = Array.isArray(pageType.candidates)
    ? pageType.candidates
    : Array.isArray(pageType.pages)
      ? pageType.pages
      : [];
  const candidatesByUrl = new Map<string, NormalizedCandidate>();
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

export function normalizePropertyPageTypes(value: unknown = []): {
  pageTypes: ViewPageType[];
  duplicateUrls: string[];
} {
  const root = (value && typeof value === "object")
    ? (value as { pageTypes?: unknown[] })
    : {};
  const rawPageTypes = Array.isArray(value)
    ? value
    : Array.isArray(root.pageTypes)
      ? root.pageTypes || []
      : [];
  const pageTypesByKey = new Map<string, NormalizedPageType>();

  rawPageTypes.forEach((rawPageType) => {
    if (!rawPageType || typeof rawPageType !== "object") {
      return;
    }
    const pageType = rawPageType as RawPageType;
    const key = normalizePageTypeKey(pageType.pageType || pageType.key);
    if (!key || !getPageTypeLabel(key)) {
      return;
    }
    const existing = pageTypesByKey.get(key);
    if (!existing) {
      pageTypesByKey.set(key, {
        key,
        title: normalizePageTypeTitle(pageType.title, key),
        candidates: normalizePageTypeCandidates(rawPageType)
      });
      return;
    }
    existing.candidates = normalizePageTypeCandidates({
      candidates: existing.candidates.concat(normalizePageTypeCandidates(rawPageType))
    });
  });

  const pageTypes = Array.from(pageTypesByKey.values());
  const pageTypeOrder = getPageTypeSlugs();
  pageTypes.sort((left, right) => {
    return pageTypeOrder.indexOf(left.key) - pageTypeOrder.indexOf(right.key);
  });

  const duplicateUrlToKeys = new Map<string, string[]>();
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
  const duplicateUrlSet = new Set<string>(duplicateUrls);
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

function normalizeMarkedPages(
  markedPages: unknown,
  normalizedPageTypes: ViewPageType[]
): {
  activeMarkedPages: MarkedPage[];
  invalidMarkedPages: Array<Record<string, unknown>>;
  repairedMarkedPages: Array<{ url: string; pageType: string; previousPageType: string }>;
} {
  const candidatesByPageType = new Map<string, Set<string>>();
  const duplicateUrlSet = new Set<string>();
  const candidatePageTypeByUrl = new Map<string, string>();
  normalizedPageTypes.forEach((pageType) => {
    const urls = new Set<string>();
    pageType.candidates.forEach((candidate) => {
      urls.add(candidate.url);
      if (candidate.duplicate) {
        duplicateUrlSet.add(candidate.url);
        candidatePageTypeByUrl.delete(candidate.url);
        return;
      }
      if (!candidatePageTypeByUrl.has(candidate.url)) {
        candidatePageTypeByUrl.set(candidate.url, pageType.key);
      }
    });
    candidatesByPageType.set(pageType.key, urls);
  });

  const activeMarkedPages: MarkedPage[] = [];
  const invalidMarkedPages: Array<Record<string, unknown>> = [];
  const repairedMarkedPages: Array<{ url: string; pageType: string; previousPageType: string }> = [];
  const seenKeys = new Set<string>();
  const rawMarkedPages = Array.isArray(markedPages) ? markedPages : [];

  rawMarkedPages.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const marked = item as { url?: unknown; pageType?: unknown; title?: unknown };
    const url = normalizeCandidatePageUrl(marked.url);
    const pageType = normalizePageTypeKey(marked.pageType);
    if (!url) {
      invalidMarkedPages.push(item);
      return;
    }
    const allowedUrls = pageType ? candidatesByPageType.get(pageType) : null;
    const candidatePageType = duplicateUrlSet.has(url) ? "" : candidatePageTypeByUrl.get(url) || "";
    const resolvedPageType =
      allowedUrls && allowedUrls.has(url) && !duplicateUrlSet.has(url)
        ? pageType
        : candidatePageType;
    if (!resolvedPageType) {
      invalidMarkedPages.push({ ...(item as Record<string, unknown>), url, pageType: pageType || "" });
      return;
    }
    const dedupeKey = `${resolvedPageType}|${url}`;
    if (seenKeys.has(dedupeKey)) {
      return;
    }
    seenKeys.add(dedupeKey);
    if (resolvedPageType !== pageType) {
      repairedMarkedPages.push({
        url,
        pageType: resolvedPageType,
        previousPageType: pageType
      });
    }
    activeMarkedPages.push({
      url,
      pageType: resolvedPageType,
      title: typeof marked.title === "string" && marked.title.trim() ? marked.title.trim() : url
    });
  });

  return { activeMarkedPages, invalidMarkedPages, repairedMarkedPages };
}

export function createInitialLynxChecklistState() {
  return {
    aiAnswer: "",
    pageTypes: []
  };
}

export function buildLynxChecklistPromptState(_options = {}) {
  return {
    aiAnswer: "",
    aiQuestionDisabled: true,
    aiQuestionHidden: true
  };
}

export function normalizeLynxChecklistState(value: unknown = {}): LynxChecklistState {
  const checklistState = value as { pageTypes?: unknown; aiAnswer?: unknown };
  const normalizedPageTypes = normalizePropertyPageTypes(checklistState.pageTypes);
  return {
    aiAnswer: normalizeAiAnswer(checklistState.aiAnswer),
    pageTypes: normalizedPageTypes.pageTypes
  };
}

export function buildLynxChecklistViewModel(options: {
  aiAnswer?: unknown;
  pageTypes?: unknown;
  markedPages?: unknown;
} = {}) {
  const normalized = normalizeLynxChecklistState(options);
  const { activeMarkedPages, invalidMarkedPages, repairedMarkedPages } = normalizeMarkedPages(
    options.markedPages,
    normalized.pageTypes
  );
  const markedPagesByType = activeMarkedPages.reduce<Record<string, MarkedPage[]>>((result, item) => {
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

  let blockingReason: { code: string; pageTypeKeys?: string[] } = { code: "" };
  if (!pageTypes.length) {
    blockingReason = { code: "no_candidates" };
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
    repairedMarkedPages,
    duplicateUrls: normalized.pageTypes
      .flatMap((pageType) => pageType.candidates)
      .filter((candidate) => candidate.duplicate)
      .map((candidate) => candidate.url),
    coveredPageTypeCount: pageTypes.length - missingPageTypes.length,
    canSend: blockingReason.code === "",
    blockingReason
  };
}

export function buildLynxChecklistAssignments(value: { aiAnswer?: unknown; pageTypes?: unknown; markedPages?: unknown } = {}) {
  const normalized = normalizeLynxChecklistState(value);
  const { activeMarkedPages } = normalizeMarkedPages(value.markedPages, normalized.pageTypes);
  const orderByPageType = new Map(normalized.pageTypes.map((item, index) => [item.key, index]));
  return activeMarkedPages
    .slice()
    .sort((left, right) => {
      const leftOrder = orderByPageType.has(left.pageType) ? orderByPageType.get(left.pageType) : Number.MAX_SAFE_INTEGER;
      const rightOrder = orderByPageType.has(right.pageType) ? orderByPageType.get(right.pageType) : Number.MAX_SAFE_INTEGER;
      const resolvedLeftOrder = typeof leftOrder === "number" ? leftOrder : Number.MAX_SAFE_INTEGER;
      const resolvedRightOrder = typeof rightOrder === "number" ? rightOrder : Number.MAX_SAFE_INTEGER;
      if (resolvedLeftOrder !== resolvedRightOrder) {
        return resolvedLeftOrder - resolvedRightOrder;
      }
      return left.url.localeCompare(right.url);
    })
    .map((item) => ({
      key: item.pageType,
      url: item.url,
      pageType: item.pageType
    }));
}

// --- Send-to-Lynx cssInfo staleness guard (architect design, 2026-07-03) ---
// The backend's cssInfo(url) is the source of truth for "what Lynx already
// has". Both sides are SANITIZED before comparison: split on commas, trim,
// collapse internal whitespace runs, drop empties, order-insensitive set
// equality — no case folding (CSS selectors are case-sensitive where it
// matters). A match on BOTH fields disables the send (resubmitting an
// identical set is the abuse this guard exists to stop); an empty backend
// (or usesUnfluffify false) never blocks.

export type LynxCssInfo = Readonly<{
  domainId?: number;
  domainName?: string;
  exclusionCssSelectors?: string | null;
  inclusionCssSelectors?: string | null;
  isJavascriptRenderingEnabled?: boolean;
  usesUnfluffify?: boolean;
}>;

export function sanitizeCssSelectorList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return [...new Set(
    value
      .split(",")
      .map((selector) => selector.trim().replace(/\s+/g, " "))
      .filter(Boolean)
  )].sort();
}

export function cssSelectorSetsMatch(left: unknown, right: unknown): boolean {
  const a = sanitizeCssSelectorList(left);
  const b = sanitizeCssSelectorList(right);
  return a.length === b.length && a.every((selector, index) => selector === b[index]);
}

export function lynxAlreadyHasSelectorSet(
  cssInfo: LynxCssInfo | null | undefined,
  pending: Readonly<{ includeCss: string; excludeCss: string }> | null | undefined
): boolean {
  if (!cssInfo || !pending || cssInfo.usesUnfluffify !== true) {
    return false;
  }
  const backendInclusion = sanitizeCssSelectorList(cssInfo.inclusionCssSelectors);
  const backendExclusion = sanitizeCssSelectorList(cssInfo.exclusionCssSelectors);
  if (!backendInclusion.length && !backendExclusion.length) {
    return false;
  }
  return (
    cssSelectorSetsMatch(cssInfo.inclusionCssSelectors, pending.includeCss) &&
    cssSelectorSetsMatch(cssInfo.exclusionCssSelectors, pending.excludeCss)
  );
}
