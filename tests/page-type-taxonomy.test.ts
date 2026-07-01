import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  DEFAULT_PAGE_TYPE_TAXONOMY,
  getPageTypeLabel,
  getPageTypeSlugSet,
  getPageTypeSlugs,
  getPageTypeTaxonomy,
  normalizePageTypeTaxonomy,
  resetActivePageTypeTaxonomy,
  setActivePageTypeTaxonomy
} from "../src/common/page-type-taxonomy.js";

import { isSupportedPageTypeValue } from "../src/common/config.js";

test("default taxonomy carries all top-level types incl how_to, in canonical order", () => {
  resetActivePageTypeTaxonomy();
  assert.deepEqual(getPageTypeSlugs(), [
    "homepage",
    "article",
    "listing",
    "category",
    "product",
    "service_page",
    "company",
    "landing_page",
    "utility",
    "how_to"
  ]);
  assert.equal(getPageTypeLabel("article"), "Article / Blog");
  assert.equal(getPageTypeLabel("how_to"), "How-To / Tutorial");
  assert.equal(getPageTypeLabel("unknown"), "");
  assert.equal(DEFAULT_PAGE_TYPE_TAXONOMY.how_to.subtypes.tutorial, "Tutorial");
});

test("how_to is a supported page type once it is in the taxonomy", () => {
  resetActivePageTypeTaxonomy();
  assert.equal(isSupportedPageTypeValue("how_to"), true);
  assert.equal(getPageTypeSlugSet().has("how_to"), true);
  assert.equal(isSupportedPageTypeValue("not_a_type"), false);
});

test("setActivePageTypeTaxonomy overrides labels + slugs from a fetched payload", () => {
  const applied = setActivePageTypeTaxonomy({
    homepage: { label: "Start", subtypes: { local_business: "Local" } },
    brand_new: { label: "Brand New", subtypes: {} }
  });
  assert.equal(applied, true);
  assert.equal(getPageTypeLabel("homepage"), "Start");
  assert.equal(getPageTypeLabel("brand_new"), "Brand New");
  assert.equal(isSupportedPageTypeValue("brand_new"), true);
  // Types dropped by the fetched payload are no longer supported.
  assert.equal(isSupportedPageTypeValue("article"), false);
  resetActivePageTypeTaxonomy();
  assert.equal(getPageTypeLabel("homepage"), "Homepage");
});

test("normalizePageTypeTaxonomy drops malformed entries and rejects empty payloads", () => {
  const normalized = normalizePageTypeTaxonomy({
    homepage: { label: "Homepage", subtypes: { local: "Local", bad: 5 } },
    missing_label: { subtypes: {} },
    bad_shape: "nope",
    array_entry: []
  });
  assert.equal(normalized !== null && "homepage" in normalized, true);
  assert.equal(normalized !== null && "missing_label" in normalized, false);
  assert.equal(normalized !== null && "bad_shape" in normalized, false);
  assert.deepEqual(normalized?.homepage.subtypes, { local: "Local" });
  assert.equal(normalizePageTypeTaxonomy({}), null);
  assert.equal(normalizePageTypeTaxonomy(null), null);
  assert.equal(normalizePageTypeTaxonomy([]), null);
  // A rejected payload does not clobber the active taxonomy.
  assert.equal(setActivePageTypeTaxonomy({}), false);
  assert.equal(getPageTypeTaxonomy() !== null, true);
});
