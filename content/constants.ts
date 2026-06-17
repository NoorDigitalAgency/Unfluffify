// Selectors for late-injected overlay/consent chrome that the marking and
// silent-highlight passes hide before measuring content. Entries are chosen for
// HIGH PRECISION: each one signals "this is overlay/modal/consent chrome", not
// page content. Do NOT add generic content words (banner, notice, toast,
// lightbox, paywall, the `cmp` substring, role=banner, etc.) — they match real
// headers/promos/galleries and would hide actual content. New entries must keep
// the `:not(body):not(html)` guard (except element selectors like `dialog`,
// which can never be body/html) and should be validated against the live
// AI-submission smoke so included-content verdicts do not drop.
export const REMOVABLE_ELEMENT_SELECTORS = [
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
  ":not(body):not(html)[aria-label*='subscribe' i]"
];
