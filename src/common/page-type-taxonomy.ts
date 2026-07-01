import { browser } from "./browser";
import { addStorageChangeListener, storageGet, storageSet } from "./storage-core";

export interface PageTypeDefinition {
  label: string;
  subtypes: Record<string, string>;
}

export type PageTypeTaxonomy = Record<string, PageTypeDefinition>;

export const PAGE_TYPE_TAXONOMY_STORAGE_KEY = "pageTypeTaxonomy";

/**
 * Canonical page-type taxonomy. Mirrors the backend `GET /page-types` response and
 * serves as the offline / first-load fallback; a fetched backend taxonomy overrides
 * it via {@link setActivePageTypeTaxonomy}. Only the top level (slug -> label) is
 * consumed today; `subtypes` are carried for a later feature and are not used yet.
 */
export const DEFAULT_PAGE_TYPE_TAXONOMY: PageTypeTaxonomy = Object.freeze({
  homepage: {
    label: "Homepage",
    subtypes: {
      local_business: "Local Business",
      ecommerce: "E-commerce",
      corporate_b2b: "Corporate / B2B",
      campaign: "Campaign"
    }
  },
  article: {
    label: "Article / Blog",
    subtypes: {
      blog_post: "Blog post",
      guide: "Guide",
      news: "News",
      faq: "FAQ",
      case_study: "Case study",
      glossary_wiki: "Glossary / Wiki",
      comparison: "Comparison (X vs Y)",
      review_affiliate: "Review / Affiliate",
      help_center_docs: "Help center / Docs"
    }
  },
  listing: {
    label: "Category / Listing",
    subtypes: {
      job_listing: "Job listing",
      search_results: "Search results",
      tag_archive: "Tag / archive",
      location_listing: "Location listing"
    }
  },
  category: {
    label: "Product Category",
    subtypes: {
      ecommerce_category: "E-commerce Category",
      brand_page: "Brand Page",
      sale_promotional: "Sale / Promotional",
      category_hub: "Category Hub (parent)"
    }
  },
  product: {
    label: "Product",
    subtypes: {
      physical: "Physical",
      digital_saas: "Digital / SaaS",
      subscription: "Subscription",
      bundle_kit: "Bundle / Kit",
      custom_quote: "Custom / Quote-based"
    }
  },
  service_page: {
    label: "Service",
    subtypes: {
      solution_use_case: "Solution / use-case",
      location_service: "Location service",
      pricing_page: "Pricing page",
      core_service: "Core service",
      industry_vertical: "Industry / vertical"
    }
  },
  company: {
    label: "Company",
    subtypes: {
      about_team_profile: "About / Team / Profile",
      careers_culture: "Careers / Culture",
      job_ad: "Job ad",
      contact: "Contact",
      press_release: "Press release"
    }
  },
  landing_page: {
    label: "Landing Page (Lead)",
    subtypes: {
      gated_content: "Gated content",
      event_webinar: "Event / Webinar page",
      app_trial_download: "App / Trial Download"
    }
  },
  utility: {
    label: "Utility / System",
    subtypes: {
      thank_you_confirmation: "Thank you / Confirmation",
      error_404: "404 / Error page",
      legal_policy: "Legal / Policy page",
      login_account: "Login / Account page"
    }
  },
  how_to: {
    label: "How-To / Tutorial",
    subtypes: {
      tutorial: "Tutorial",
      recipe: "Recipe",
      diy_project: "DIY Project"
    }
  }
}) as PageTypeTaxonomy;

let activeTaxonomy: PageTypeTaxonomy = DEFAULT_PAGE_TYPE_TAXONOMY;

/** The taxonomy currently in effect (fetched backend data, else the default). */
export function getPageTypeTaxonomy(): PageTypeTaxonomy {
  return activeTaxonomy;
}

/** Top-level type slugs in canonical presentation order. */
export function getPageTypeSlugs(): string[] {
  return Object.keys(activeTaxonomy);
}

/** Ordinal set of valid top-level type slugs for validation. */
export function getPageTypeSlugSet(): Set<string> {
  return new Set(Object.keys(activeTaxonomy));
}

/** Visual label for a slug, or "" when the slug is not in the taxonomy. */
export function getPageTypeLabel(slug: unknown): string {
  const key = typeof slug === "string" ? slug.trim() : "";
  return (key && activeTaxonomy[key]?.label) || "";
}

/**
 * Normalize a raw `/page-types` payload into a taxonomy, dropping malformed
 * entries. Returns null when nothing usable remains so callers keep the current
 * (default or previously applied) taxonomy instead of clobbering it with garbage.
 */
export function normalizePageTypeTaxonomy(raw: unknown): PageTypeTaxonomy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const normalized: PageTypeTaxonomy = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const slug = typeof key === "string" ? key.trim() : "";
    if (!slug || !value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const entry = value as { label?: unknown; subtypes?: unknown };
    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    if (!label) {
      continue;
    }
    const subtypes: Record<string, string> = {};
    if (entry.subtypes && typeof entry.subtypes === "object" && !Array.isArray(entry.subtypes)) {
      for (const [subKey, subVal] of Object.entries(entry.subtypes as Record<string, unknown>)) {
        const subSlug = typeof subKey === "string" ? subKey.trim() : "";
        if (subSlug && typeof subVal === "string") {
          subtypes[subSlug] = subVal;
        }
      }
    }
    normalized[slug] = { label, subtypes };
  }
  return Object.keys(normalized).length ? normalized : null;
}

/** Replace the active taxonomy from a raw payload. No-op (returns false) if unusable. */
export function setActivePageTypeTaxonomy(raw: unknown): boolean {
  const normalized = normalizePageTypeTaxonomy(raw);
  if (!normalized) {
    return false;
  }
  activeTaxonomy = normalized;
  return true;
}

/** Reset the active taxonomy back to the built-in default (used by tests). */
export function resetActivePageTypeTaxonomy(): void {
  activeTaxonomy = DEFAULT_PAGE_TYPE_TAXONOMY;
}

function getLocalStorageArea(): unknown {
  const host = globalThis as {
    browser?: { storage?: { local?: unknown } };
    chrome?: { storage?: { local?: unknown } };
  };
  return host.browser?.storage?.local || host.chrome?.storage?.local || browser.storage.local;
}

/** Read the cached taxonomy from local storage, or null when absent/unusable. */
export async function readStoredPageTypeTaxonomy(): Promise<PageTypeTaxonomy | null> {
  try {
    const result = await storageGet(getLocalStorageArea(), { [PAGE_TYPE_TAXONOMY_STORAGE_KEY]: null });
    return normalizePageTypeTaxonomy(result?.[PAGE_TYPE_TAXONOMY_STORAGE_KEY]);
  } catch {
    return null;
  }
}

/** Persist a fetched taxonomy to local storage and apply it as active. */
export async function writeStoredPageTypeTaxonomy(raw: unknown): Promise<boolean> {
  const normalized = normalizePageTypeTaxonomy(raw);
  if (!normalized) {
    return false;
  }
  try {
    await storageSet(getLocalStorageArea(), { [PAGE_TYPE_TAXONOMY_STORAGE_KEY]: normalized });
  } catch {
    return false;
  }
  activeTaxonomy = normalized;
  return true;
}

let taxonomyChangeSubscribed = false;

/**
 * Load the cached taxonomy into the active slot and subscribe to local-storage
 * changes so every realm (background, popup, content) stays aligned after the
 * background refreshes it. Safe to call multiple times.
 */
export async function initPageTypeTaxonomy(): Promise<void> {
  const stored = await readStoredPageTypeTaxonomy();
  if (stored) {
    activeTaxonomy = stored;
  }
  if (!taxonomyChangeSubscribed) {
    taxonomyChangeSubscribed = true;
    addStorageChangeListener((changes, areaName) => {
      if (areaName !== "local" || !changes || typeof changes !== "object") {
        return;
      }
      const change = (changes as Record<string, { newValue?: unknown }>)[PAGE_TYPE_TAXONOMY_STORAGE_KEY];
      if (change && "newValue" in change) {
        setActivePageTypeTaxonomy(change.newValue);
      }
    });
  }
}
