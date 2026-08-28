/** Marks consent/modal chrome hidden by the extension. The marker is shared by
 * live content suppression and realm-neutral static-payload sanitization. */
export const CONSENT_HIDDEN_ATTR = "data-uf-consent-hidden";

/** HIGH PRECISION, ported verbatim in spirit from legacy: every entry has to mean
 * "this is overlay/consent chrome", never "this is content". Do NOT add generic
 * words — banner, notice, toast, lightbox, paywall, the `cmp` substring,
 * role=banner — they match real headers, promos and galleries, and hiding those
 * silently drops content from what the AI is asked to judge. New entries keep the
 * `:not(body):not(html)` guard, except element selectors like `dialog` which can
 * never be either. */
export const CONSENT_OVERLAY_SELECTORS: readonly string[] = [
  ":not(body):not(html).backdrop",
  ":not(body):not(html).overlay",
  ":not(body):not(html).wcc-overlay",
  ":not(body):not(html).modal-backdrop",
  ":not(body):not(html)[role='dialog' i]",
  ":not(body):not(html)[role='alertdialog' i]",
  ":not(body):not(html)[role='modal' i]",
  ":not(body):not(html)[role='popup' i]",
  ":not(body):not(html)[aria-modal='true' i]",
  "dialog[open]",
  ":not(body):not(html)[class*='modal' i]",
  ":not(body):not(html)[class*='popup' i]",
  ":not(body):not(html)[id*='cookie' i]",
  ":not(body):not(html)[class*='cookie' i]",
  ":not(body):not(html)[id*='consent' i]",
  ":not(body):not(html)[class*='consent' i]",
  ":not(body):not(html)[id*='gdpr' i]",
  ":not(body):not(html)[class*='gdpr' i]",
  ":not(body):not(html)[id*='interstitial' i]",
  ":not(body):not(html)[class*='interstitial' i]",
  ":not(body):not(html)[aria-label*='cookie' i]",
  ":not(body):not(html)[aria-label*='consent' i]",
  ":not(body):not(html)[aria-label*='gdpr' i]",
  ":not(body):not(html)[aria-label*='modal' i]",
  ":not(body):not(html)[aria-label*='popup' i]",
  ":not(body):not(html)[aria-label*='dialog' i]",
  ":not(body):not(html)[aria-label*='newsletter' i]",
  ":not(body):not(html)[aria-label*='subscribe' i]",
];
