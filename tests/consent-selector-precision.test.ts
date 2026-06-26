import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { REMOVABLE_ELEMENT_SELECTORS } from "../src/content/constants.js";

const all = REMOVABLE_ELEMENT_SELECTORS.join("\n");

test("consent selectors include the high-precision overlay/modal additions", () => {
  // Declarative modal intent + well-known consent keywords (near-zero false
  // positives). These are the breadth additions for late-injected widgets.
  const required = [
    "[role='alertdialog' i]",
    "[aria-modal='true' i]",
    "dialog[open]",
    "[id*='gdpr' i]",
    "[class*='gdpr' i]",
    "[aria-label*='gdpr' i]",
    "[id*='interstitial' i]",
    "[class*='interstitial' i]"
  ];
  for (const needle of required) {
    assert.ok(all.includes(needle), `expected consent selectors to include ${needle}`);
  }
});

test("consent selectors avoid generic content words that would hide real content", () => {
  // These substrings appear on legitimate page content (site headers, hero/promo
  // banners, content notices, galleries, paywalled article bodies, AEM `cmp-`
  // components). They must never enter the removable-overlay set.
  const forbidden = [
    "banner",
    "notice",
    "lightbox",
    "paywall",
    "'cmp",     // would match Adobe AEM cmp-* components and "company"/"compare"
    "[class*='cmp",
    "[id*='cmp",
    "role='banner'"
  ];
  for (const needle of forbidden) {
    assert.ok(
      !all.includes(needle),
      `consent selectors must not include the over-broad token ${needle}`
    );
  }
});

test("every non-element consent selector keeps the body/html guard", () => {
  for (const selector of REMOVABLE_ELEMENT_SELECTORS) {
    // Element selectors (e.g. `dialog[open]`) can never match body/html, so they
    // do not need the guard; attribute/class selectors must keep it.
    if (/^[a-z]+\[/.test(selector)) {
      continue;
    }
    assert.ok(
      selector.startsWith(":not(body):not(html)"),
      `selector missing body/html guard: ${selector}`
    );
  }
});
