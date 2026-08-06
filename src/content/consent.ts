/** Hiding the site's own consent / cookie / interstitial chrome.
 *
 *  This is deliberately decoupled from everything else the content script does.
 *  A consent dialog sits on top of the page, so it ruins a render-mode comparison,
 *  it covers the content an operator is trying to mark, and — worst — it is
 *  dismissable: one stray click and the page has recorded a consent decision that
 *  changes what later loads look like. Legacy made this a durable contract: it runs
 *  on every property page regardless of candidacy, marking mode, stored selectors
 *  or the reveal/freeze directives, and it runs BEFORE any of those can bail out.
 *
 *  Hidden, not removed. The elements keep their place in the DOM with attributes,
 *  children and XPaths intact, so marking and capture see the page they would have
 *  seen anyway and a restore is a matter of dropping three properties. */

/** Marks what this module hid, so a restore touches nothing else and a second pass
 *  is a no-op. Also the escape hatch in the bypass style below. */
export const CONSENT_HIDDEN_ATTR = "data-uf-consent-hidden";
export const CONSENT_BYPASS_STYLE_ID = "uf-consent-bypass";

/** HIGH PRECISION, ported verbatim in spirit from legacy: every entry has to mean
 *  "this is overlay/consent chrome", never "this is content". Do NOT add generic
 *  words — banner, notice, toast, lightbox, paywall, the `cmp` substring,
 *  role=banner — they match real headers, promos and galleries, and hiding those
 *  silently drops content from what the AI is asked to judge. New entries keep the
 *  `:not(body):not(html)` guard, except element selectors like `dialog` which can
 *  never be either. */
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

/** The three properties that hide an element without moving it. */
const HIDDEN_PROPERTIES: readonly string[] = ["opacity", "visibility", "pointer-events"];

export type ConsentStyle = Readonly<{
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): void;
}>;

export type ConsentElement = Readonly<{
  tagName?: string;
  style?: ConsentStyle;
  open?: boolean;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  close?(): void;
}>;

export type ConsentDocument = Readonly<{
  querySelectorAll(selector: string): Iterable<ConsentElement> | ArrayLike<ConsentElement>;
  getElementById(id: string): unknown;
  createElement(tag: string): { id: string; textContent: string };
  head?: { appendChild(node: unknown): unknown } | null;
}>;

function toArray(result: Iterable<ConsentElement> | ArrayLike<ConsentElement>): ConsentElement[] {
  return Array.from(result as ArrayLike<ConsentElement>);
}

function isDialogLike(element: ConsentElement): boolean {
  return String(element.tagName ?? "").toUpperCase() === "DIALOG";
}

/** Consent frameworks routinely disable the page underneath by pairing
 *  `aria-hidden="true"` with `pointer-events: none`. Once their dialog is hidden
 *  that rule would leave the whole page unclickable, so it is countered — except on
 *  what this module hid, whose inline `!important` keeps winning. */
function injectBypassStyle(document: ConsentDocument): boolean {
  if (document.getElementById(CONSENT_BYPASS_STYLE_ID) || !document.head) {
    return false;
  }
  const style = document.createElement("style");
  style.id = CONSENT_BYPASS_STYLE_ID;
  style.textContent =
    `[aria-hidden='true']:not([${CONSENT_HIDDEN_ATTR}]):not([${CONSENT_HIDDEN_ATTR}] *) `
    + "{ pointer-events: auto !important; }";
  document.head.appendChild(style);
  return true;
}

function hideElement(element: ConsentElement): boolean {
  if (element.hasAttribute(CONSENT_HIDDEN_ATTR)) {
    return false;
  }
  element.setAttribute(CONSENT_HIDDEN_ATTR, "true");
  element.style?.setProperty("opacity", "0", "important");
  element.style?.setProperty("visibility", "hidden", "important");
  element.style?.setProperty("pointer-events", "none", "important");
  // A native <dialog open> lives in the browser's top layer and intercepts every
  // pointer event before CSS hit-testing runs — no property can take it out of
  // that layer. close() does, while leaving the element and its subtree in the
  // DOM untouched, so detection and XPaths are unaffected.
  if (isDialogLike(element) && element.open === true) {
    try {
      element.close?.();
    } catch {
      // A dialog that refuses to close is still hidden by the properties above.
    }
  }
  return true;
}

export type ConsentSweepResult = Readonly<{
  /** Elements hidden by this pass. Zero on a page with no consent chrome, and on
   *  every pass after the first — which is what makes re-running cheap. */
  hidden: number;
  /** Whether this pass installed the bypass style. */
  bypassInstalled: boolean;
}>;

/** Hides every consent overlay currently in the document. Safe to call repeatedly:
 *  already-hidden elements are skipped, so a MutationObserver can drive it. */
export function hideConsentOverlays(document: ConsentDocument): ConsentSweepResult {
  let hidden = 0;
  for (const selector of CONSENT_OVERLAY_SELECTORS) {
    let matches: ConsentElement[];
    try {
      matches = toArray(document.querySelectorAll(selector));
    } catch {
      // A browser that rejects one selector must not cost us the other 27.
      continue;
    }
    for (const element of matches) {
      if (hideElement(element)) {
        hidden += 1;
      }
    }
  }
  const bypassInstalled = hidden > 0 ? injectBypassStyle(document) : false;
  return { hidden, bypassInstalled };
}

/** Puts back exactly what was hidden. Only elements carrying the attribute are
 *  touched, so a site's own inline styles are never guessed at. */
export function restoreConsentOverlays(document: ConsentDocument): number {
  let restored = 0;
  let matches: ConsentElement[];
  try {
    matches = toArray(document.querySelectorAll(`[${CONSENT_HIDDEN_ATTR}]`));
  } catch {
    return 0;
  }
  for (const element of matches) {
    for (const property of HIDDEN_PROPERTIES) {
      element.style?.removeProperty(property);
    }
    element.removeAttribute(CONSENT_HIDDEN_ATTR);
    restored += 1;
  }
  return restored;
}
