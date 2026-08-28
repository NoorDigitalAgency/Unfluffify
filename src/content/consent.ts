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
 *  seen anyway. Terminal restoration reinstates the exact three authored CSSOM
 *  values recorded before the extension writes its helper declarations. */

import {
  CONSENT_HIDDEN_ATTR,
  CONSENT_OVERLAY_SELECTORS,
} from "../domain/consent-taxonomy";

export {
  CONSENT_HIDDEN_ATTR,
  CONSENT_OVERLAY_SELECTORS,
} from "../domain/consent-taxonomy";

/** Marks what this module hid, so a restore touches nothing else and a second pass
 *  is a no-op. Also the escape hatch in the bypass style below. */
/** Encoded CSSOM provenance for the three inline properties we temporarily own.
 *  It is deliberately a data-uf attribute so every capture path strips it. */
export const CONSENT_STYLE_STATE_ATTR = "data-uf-consent-style-state";
/** The `unfluffify-` prefix also makes the whole helper node extension UI to the
 *  composed-DOM serializer. */
export const CONSENT_BYPASS_STYLE_ID = "unfluffify-consent-bypass";
/** Removed for live-update compatibility with builds that predate the
 *  extension-owned `unfluffify-` artifact prefix. */
export const LEGACY_CONSENT_BYPASS_STYLE_ID = "uf-consent-bypass";

/** The three properties that hide an element without moving it. */
const HIDDEN_PROPERTIES = ["opacity", "visibility", "pointer-events"] as const;
type HiddenProperty = typeof HIDDEN_PROPERTIES[number];
type ConsentStyleState = ReadonlyArray<readonly [HiddenProperty, string, string]>;

export type ConsentStyle = Readonly<{
  readonly length?: number;
  item?(index: number): string;
  getPropertyValue?(name: string): string;
  getPropertyPriority?(name: string): string;
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): void;
}>;

export type ConsentElement = Readonly<{
  nodeType?: number;
  tagName?: string;
  style?: ConsentStyle;
  open?: boolean;
  parentElement?: ConsentElement | null;
  isConnected?: boolean;
  matches?(selector: string): boolean;
  querySelectorAll?(selector: string): Iterable<ConsentElement> | ArrayLike<ConsentElement>;
  contains?(other: ConsentElement): boolean;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  close?(): void;
}>;

export type ConsentDocument = Readonly<{
  querySelectorAll(selector: string): Iterable<ConsentElement> | ArrayLike<ConsentElement>;
  getElementById(id: string): unknown;
  createElement(tag: string): { id: string; textContent: string; remove?(): void };
  head?: { appendChild(node: unknown): unknown } | null;
}>;

function toArray(result: Iterable<ConsentElement> | ArrayLike<ConsentElement>): ConsentElement[] {
  return Array.from(result as ArrayLike<ConsentElement>);
}

function isDialogLike(element: ConsentElement): boolean {
  return String(element.tagName ?? "").toUpperCase() === "DIALOG";
}

function propertyValue(style: ConsentStyle | undefined, property: HiddenProperty): string {
  return style?.getPropertyValue?.(property) ?? "";
}

function propertyPriority(style: ConsentStyle | undefined, property: HiddenProperty): string {
  return style?.getPropertyPriority?.(property) ?? "";
}

function encodeStyleState(element: ConsentElement): string {
  const state: ConsentStyleState = HIDDEN_PROPERTIES.map((property) => [
    property,
    propertyValue(element.style, property),
    propertyPriority(element.style, property),
  ]);
  return encodeURIComponent(JSON.stringify(state));
}

function decodeStyleState(encoded: string | null | undefined): ConsentStyleState | null {
  if (!encoded) {
    return null;
  }
  try {
    const value = JSON.parse(decodeURIComponent(encoded)) as unknown;
    if (!Array.isArray(value) || value.length !== HIDDEN_PROPERTIES.length) {
      return null;
    }
    const state: Array<readonly [HiddenProperty, string, string]> = [];
    for (const entry of value) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 3 ||
        !HIDDEN_PROPERTIES.includes(entry[0] as HiddenProperty) ||
        typeof entry[1] !== "string" ||
        typeof entry[2] !== "string"
      ) {
        return null;
      }
      state.push([entry[0] as HiddenProperty, entry[1], entry[2]]);
    }
    return state;
  } catch {
    return null;
  }
}

function splitCssDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let parentheses = 0;
  for (let index = 0; index < style.length; index += 1) {
    const character = style[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")" && parentheses > 0) {
      parentheses -= 1;
      continue;
    }
    if (character === ";" && parentheses === 0) {
      declarations.push(style.slice(start, index));
      start = index + 1;
    }
  }
  declarations.push(style.slice(start));
  return declarations;
}

function declarationParts(declaration: string): Readonly<{
  property: string;
  value: string;
  priority: string;
}> | null {
  const colon = declaration.indexOf(":");
  if (colon < 0) {
    return null;
  }
  const property = declaration.slice(0, colon).trim().toLowerCase();
  const rawValue = declaration.slice(colon + 1).trim();
  const priorityMatch = /\s*!\s*(important)\s*$/i.exec(rawValue);
  return {
    property,
    value: priorityMatch ? rawValue.slice(0, priorityMatch.index).trim() : rawValue,
    priority: priorityMatch?.[1]?.toLowerCase() ?? "",
  };
}

function isLegacyInjectedDeclaration(parts: NonNullable<ReturnType<typeof declarationParts>>): boolean {
  if (parts.priority !== "important") {
    return false;
  }
  return (parts.property === "opacity" && parts.value === "0") ||
    (parts.property === "visibility" && parts.value.toLowerCase() === "hidden") ||
    (parts.property === "pointer-events" && parts.value.toLowerCase() === "none");
}

/** Produces the style attribute capture would have seen without our helper writes.
 *  This is pure: it never restores or otherwise mutates the live page. */
export function sanitizeConsentStyleText(
  style: string,
  encodedState?: string | null,
): string | null {
  const state = decodeStyleState(encodedState);
  const retained: string[] = [];
  for (const rawDeclaration of splitCssDeclarations(style)) {
    const declaration = rawDeclaration.trim();
    if (!declaration) {
      continue;
    }
    const parts = declarationParts(declaration);
    if (!parts) {
      retained.push(declaration);
      continue;
    }
    const helperProperty = HIDDEN_PROPERTIES.includes(parts.property as HiddenProperty);
    if (state ? helperProperty : isLegacyInjectedDeclaration(parts)) {
      continue;
    }
    retained.push(declaration);
  }
  if (state) {
    for (const [property, value, priority] of state) {
      if (!value) {
        continue;
      }
      retained.push(`${property}: ${value}${priority ? ` !${priority}` : ""}`);
    }
  }
  return retained.length > 0 ? retained.join("; ") : null;
}

/** Element-shaped companion used by the live composed-DOM serializer while the
 *  marker and its provenance still exist. */
export function consentStyleForCapture(element: Pick<ConsentElement, "getAttribute" | "hasAttribute">): string | null {
  const style = element.getAttribute("style");
  if (!element.hasAttribute(CONSENT_HIDDEN_ATTR)) {
    return style;
  }
  return sanitizeConsentStyleText(style ?? "", element.getAttribute(CONSENT_STYLE_STATE_ATTR));
}

/** Consent frameworks routinely disable the page underneath by pairing
 *  `aria-hidden="true"` with `pointer-events: none`. Once their dialog is hidden
 *  that rule would leave the whole page unclickable, so it is countered — except on
 *  what this module hid, whose inline `!important` keeps winning. */
function injectBypassStyle(document: ConsentDocument): boolean {
  if (document.getElementById(CONSENT_BYPASS_STYLE_ID)) {
    return false;
  }
  const legacy = document.getElementById(LEGACY_CONSENT_BYPASS_STYLE_ID) as { remove?(): void } | null;
  legacy?.remove?.();
  if (!document.head) {
    return false;
  }
  const style = document.createElement("style");
  style.id = CONSENT_BYPASS_STYLE_ID;
  style.textContent =
    `[${CONSENT_HIDDEN_ATTR}], [${CONSENT_HIDDEN_ATTR}] * `
    + "{ opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }\n"
    + `[aria-hidden='true']:not([${CONSENT_HIDDEN_ATTR}]):not([${CONSENT_HIDDEN_ATTR}] *) `
    + "{ pointer-events: auto !important; }\n"
    + "html.noScroll, html.no-scroll, html.modal-open, "
    + "body.noScroll, body.no-scroll, body.modal-open "
    + "{ overflow: auto !important; }\n"
    + "html.noScroll body, html.no-scroll body, html.modal-open body "
    + "{ overflow: visible !important; }";
  document.head.appendChild(style);
  return true;
}

function hideElement(element: ConsentElement): boolean {
  const newlyHidden = !element.hasAttribute(CONSENT_HIDDEN_ATTR);
  if (newlyHidden) {
    element.setAttribute(CONSENT_STYLE_STATE_ATTR, encodeStyleState(element));
    element.setAttribute(CONSENT_HIDDEN_ATTR, "true");
  }
  // Re-enforce on every matching pass. Consent managers commonly re-open a
  // marked native dialog or rewrite its style after their own delayed checks.
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
  return newlyHidden;
}

export type ConsentSweepResult = Readonly<{
  /** Elements hidden by this pass. Zero on a page with no consent chrome, and on
   *  every pass after the first — which is what makes re-running cheap. */
  hidden: number;
  /** Whether this pass installed the bypass style. */
  bypassInstalled: boolean;
}>;

const CONSENT_OVERLAY_SELECTOR_QUERY = CONSENT_OVERLAY_SELECTORS.join(",");

/** Native selector lists let the browser traverse a changed subtree once even
 * when an element can match any of the consent taxonomy's selectors. Retain the
 * individual-query fallback for engines that reject one selector in the list;
 * correctness must not depend on every selector being supported. */
function queryConsentOverlayDescendants(
  root: Pick<ConsentDocument, "querySelectorAll"> | Pick<ConsentElement, "querySelectorAll">,
): ConsentElement[] {
  const querySelectorAll = root.querySelectorAll;
  if (!querySelectorAll) {
    return [];
  }
  try {
    return toArray(querySelectorAll.call(root, CONSENT_OVERLAY_SELECTOR_QUERY));
  } catch {
    const matches: ConsentElement[] = [];
    for (const selector of CONSENT_OVERLAY_SELECTORS) {
      try {
        matches.push(...toArray(querySelectorAll.call(root, selector)));
      } catch {
        // Keep the remaining high-confidence selectors active.
      }
    }
    return matches;
  }
}

function rootMatchesConsentOverlay(root: ConsentElement): boolean {
  try {
    return root.matches?.(CONSENT_OVERLAY_SELECTOR_QUERY) === true;
  } catch {
    for (const selector of CONSENT_OVERLAY_SELECTORS) {
      try {
        if (root.matches?.(selector)) {
          return true;
        }
      } catch {
        // Keep testing the remaining high-confidence selectors.
      }
    }
    return false;
  }
}

function consentRootContains(ancestor: ConsentElement, descendant: ConsentElement): boolean {
  if (ancestor === descendant) {
    return true;
  }
  if (ancestor.contains) {
    return ancestor.contains(descendant);
  }
  let current = descendant.parentElement;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

export function collapseConsentSweepRoots(roots: readonly ConsentElement[]): ConsentElement[] {
  const connected = roots.filter((root, index) =>
    root.isConnected !== false && roots.indexOf(root) === index);
  return connected.filter((root) =>
    !connected.some((candidate) => candidate !== root && consentRootContains(candidate, root)));
}

/** Subtree companion for mutation-driven passes. Selector taxonomy and hiding
 * behavior are identical to the initial full-document sweep; only the query
 * roots are narrowed to the nodes that actually changed. */
export function hideConsentOverlaysInRoots(
  document: ConsentDocument,
  roots: readonly ConsentElement[],
): ConsentSweepResult {
  let hidden = 0;
  let matched = false;
  const visited = new Set<ConsentElement>();
  for (const root of collapseConsentSweepRoots(roots)) {
    const matches = [
      ...(rootMatchesConsentOverlay(root) ? [root] : []),
      ...(root.querySelectorAll ? queryConsentOverlayDescendants(root) : []),
    ];
    for (const element of matches) {
      if (visited.has(element)) {
        continue;
      }
      visited.add(element);
      matched = true;
      if (hideElement(element)) {
        hidden += 1;
      }
    }
  }
  const bypassInstalled = matched ? injectBypassStyle(document) : false;
  return { hidden, bypassInstalled };
}

/** Hides every consent overlay currently in the document. Safe to call repeatedly:
 *  already-hidden elements are skipped, so a MutationObserver can drive it. */
export function hideConsentOverlays(document: ConsentDocument): ConsentSweepResult {
  let hidden = 0;
  let matched = false;
  const visited = new Set<ConsentElement>();
  for (const element of queryConsentOverlayDescendants(document)) {
    if (visited.has(element)) {
      continue;
    }
    visited.add(element);
    matched = true;
    if (hideElement(element)) {
      hidden += 1;
    }
  }
  const bypassInstalled = matched ? injectBypassStyle(document) : false;
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
    const state = decodeStyleState(element.getAttribute(CONSENT_STYLE_STATE_ATTR));
    for (const property of HIDDEN_PROPERTIES) {
      const original = state?.find(([candidate]) => candidate === property);
      if (original?.[1]) {
        element.style?.setProperty(property, original[1], original[2]);
      } else if (state || isLegacyInjectedDeclaration({
        property,
        value: propertyValue(element.style, property),
        priority: propertyPriority(element.style, property),
      })) {
        element.style?.removeProperty(property);
      }
    }
    element.removeAttribute(CONSENT_STYLE_STATE_ATTR);
    element.removeAttribute(CONSENT_HIDDEN_ATTR);
    restored += 1;
  }
  for (const id of [CONSENT_BYPASS_STYLE_ID, LEGACY_CONSENT_BYPASS_STYLE_ID]) {
    const bypass = document.getElementById(id) as { remove?(): void } | null;
    bypass?.remove?.();
  }
  return restored;
}
