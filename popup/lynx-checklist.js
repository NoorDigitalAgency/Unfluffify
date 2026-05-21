export const LYNX_CHECKLIST_PAGE_TYPES = Object.freeze([
  Object.freeze({ key: "homepage", title: "Homepage" }),
  Object.freeze({ key: "articlePage", title: "Article page" }),
  Object.freeze({ key: "listingPage", title: "Listing page" }),
  Object.freeze({ key: "categoryPage", title: "Category page" }),
  Object.freeze({ key: "productPage", title: "Product page" }),
  Object.freeze({ key: "servicePage", title: "Service page" }),
  Object.freeze({ key: "companyPage", title: "Company page" }),
  Object.freeze({ key: "landingPage", title: "Landing page" }),
  Object.freeze({ key: "utilityPage", title: "Utility page" })
]);

export const LYNX_CHECKLIST_PAGE_TYPE_TO_API_VALUE = Object.freeze({
  homepage: "homepage",
  articlePage: "article",
  listingPage: "listing",
  categoryPage: "category",
  productPage: "product",
  servicePage: "service_page",
  companyPage: "company",
  landingPage: "landing_page",
  utilityPage: "utility"
});

function normalizeDecision(value) {
  return value === "yes" || value === "no" || value === "not_applicable" ? value : "";
}

function normalizeSelectedPageUrl(value) {
  return typeof value === "string" ? value : "";
}

function buildInitialPageTypes() {
  return LYNX_CHECKLIST_PAGE_TYPES.reduce((result, item) => {
    result[item.key] = {
      decision: "",
      selectedPageUrl: ""
    };
    return result;
  }, {});
}

export function createInitialLynxChecklistState() {
  return {
    aiAnswer: "",
    pageTypes: buildInitialPageTypes()
  };
}

export function normalizeLynxChecklistState(value = {}) {
  const initial = createInitialLynxChecklistState();
  const normalizedPageTypes = buildInitialPageTypes();
  const rawPageTypes =
    value && typeof value.pageTypes === "object" && value.pageTypes !== null
      ? value.pageTypes
      : {};

  LYNX_CHECKLIST_PAGE_TYPES.forEach(({ key }) => {
    const rawEntry =
      rawPageTypes && typeof rawPageTypes[key] === "object" && rawPageTypes[key] !== null
        ? rawPageTypes[key]
        : {};
    normalizedPageTypes[key] = {
      decision: normalizeDecision(rawEntry.decision),
      selectedPageUrl: normalizeSelectedPageUrl(rawEntry.selectedPageUrl)
    };
  });

  return {
    aiAnswer: value && (value.aiAnswer === "yes" || value.aiAnswer === "no") ? value.aiAnswer : initial.aiAnswer,
    pageTypes: normalizedPageTypes
  };
}

export function buildLynxChecklistViewModel(options = {}) {
  const normalized = normalizeLynxChecklistState(options);
  const markedPages = Array.isArray(options.markedPages)
    ? options.markedPages
        .filter((item) => item && typeof item.url === "string" && item.url)
        .map((item) => ({
          url: item.url,
          title: typeof item.title === "string" && item.title ? item.title : item.url
        }))
    : [];

  const assignedUrls = new Set();
  LYNX_CHECKLIST_PAGE_TYPES.forEach(({ key }) => {
    const entry = normalized.pageTypes[key];
    if (entry.decision === "yes" && entry.selectedPageUrl) {
      assignedUrls.add(entry.selectedPageUrl);
    }
  });

  const firstPendingSelectionKey =
    LYNX_CHECKLIST_PAGE_TYPES.find(({ key }) => {
      const entry = normalized.pageTypes[key];
      return entry.decision === "yes" && !entry.selectedPageUrl;
    })?.key || "";

  const pageTypes = LYNX_CHECKLIST_PAGE_TYPES.map(({ key, title }) => {
    const entry = normalized.pageTypes[key];
    const availableOptions = markedPages.filter((item) => {
      if (item.url === entry.selectedPageUrl) {
        return true;
      }
      return !assignedUrls.has(item.url);
    });
    const inputsDisabled =
      normalized.aiAnswer === "no" ||
      (Boolean(firstPendingSelectionKey) && firstPendingSelectionKey !== key);
    return {
      key,
      title,
      decision: entry.decision,
      selectedPageUrl: entry.selectedPageUrl,
      showSelect: entry.decision === "yes",
      inputsDisabled,
      availableOptions
    };
  });

  const hasNoDecision = pageTypes.some((item) => item.decision === "no");
  const hasUnansweredPageType = pageTypes.some((item) => !item.decision);
  const firstPendingSelection = pageTypes.find((item) => item.key === firstPendingSelectionKey) || null;
  const yesAssignedCount = pageTypes.filter(
    (item) => item.decision === "yes" && item.selectedPageUrl
  ).length;

  let blockingReason = { code: "" };
  if (normalized.aiAnswer === "no") {
    blockingReason = { code: "ai_no" };
  } else if (normalized.aiAnswer !== "yes") {
    blockingReason = { code: "ai_unanswered" };
  } else if (firstPendingSelection) {
    blockingReason = {
      code: firstPendingSelection.availableOptions.length ? "page_type_selection_required" : "page_type_no_options",
      pageTypeKey: firstPendingSelection.key
    };
  } else if (hasNoDecision) {
    blockingReason = { code: "page_type_no" };
  } else if (hasUnansweredPageType) {
    blockingReason = { code: "page_type_unanswered" };
  } else if (yesAssignedCount === 0) {
    blockingReason = { code: "no_page_types_selected" };
  }

  return {
    aiAnswer: normalized.aiAnswer,
    pageTypes,
    firstPendingSelectionKey,
    aiQuestionDisabled:
      normalized.aiAnswer !== "no" && Boolean(firstPendingSelectionKey),
    canSend: blockingReason.code === "",
    blockingReason
  };
}

export function buildLynxChecklistAssignments(value = {}) {
  const normalized = normalizeLynxChecklistState(value);
  return LYNX_CHECKLIST_PAGE_TYPES.reduce((result, { key }) => {
    const entry = normalized.pageTypes[key];
    if (entry.decision !== "yes" || !entry.selectedPageUrl) {
      return result;
    }
    result.push({
      key,
      url: entry.selectedPageUrl,
      pageType: LYNX_CHECKLIST_PAGE_TYPE_TO_API_VALUE[key] || ""
    });
    return result;
  }, []);
}
