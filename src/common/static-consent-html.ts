import { CONSENT_HIDDEN_ATTR, CONSENT_OVERLAY_SELECTORS } from "../domain/consent-taxonomy";

type StaticConsentQueryRoot = Readonly<{
  querySelectorAll(selector: string): Iterable<StaticConsentElement> | ArrayLike<StaticConsentElement>;
}>;

type StaticConsentElement = Readonly<{
  remove(): void;
  content?: StaticConsentQueryRoot | null;
  querySelectorAll?(selector: string): Iterable<StaticConsentElement> | ArrayLike<StaticConsentElement>;
}>;

type StaticConsentDocument = StaticConsentQueryRoot & Readonly<{
  documentElement: Readonly<{ outerHTML: string }> | null;
  doctype?: Readonly<{ name: string; publicId?: string; systemId?: string }> | null;
}>;

export type StaticConsentHtmlParser = (
  html: string,
) => StaticConsentDocument;

function defaultParser(html: string): StaticConsentDocument {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is required to sanitize static consent HTML");
  }
  return new DOMParser().parseFromString(html, "text/html");
}

function quotedDoctypeValue(value: string): string {
  return value.replaceAll('"', "&quot;");
}

function serializeDoctype(
  doctype: StaticConsentDocument["doctype"],
): string {
  if (!doctype?.name) return "";
  if (doctype.publicId) {
    const system = doctype.systemId
      ? ` "${quotedDoctypeValue(doctype.systemId)}"`
      : "";
    return `<!DOCTYPE ${doctype.name} PUBLIC "${quotedDoctypeValue(doctype.publicId)}"${system}>`;
  }
  if (doctype.systemId) {
    return `<!DOCTYPE ${doctype.name} SYSTEM "${quotedDoctypeValue(doctype.systemId)}">`;
  }
  return `<!DOCTYPE ${doctype.name}>`;
}

/** Removes the same high-precision consent/modal taxonomy from server-source
 * HTML that the live consent lifecycle suppresses in rendered mode.
 *
 * Call this only after raw/rendered XPath refinement: removing a server-source
 * subtree can shift absolute raw XPaths, while the sanitized source is the only
 * version permitted to leave the extension in an AI or persisted payload. */
export function sanitizeStaticConsentHtml(
  html: string,
  parse: StaticConsentHtmlParser = defaultParser,
): string {
  if (!html) return html;
  const document = parse(html);
  const selectors = [
    ...CONSENT_OVERLAY_SELECTORS,
    `[${CONSENT_HIDDEN_ATTR}]`,
  ] as const;
  const pendingRoots: StaticConsentQueryRoot[] = [document];
  const visitedRoots = new Set<StaticConsentQueryRoot>();
  while (pendingRoots.length > 0) {
    const root = pendingRoots.shift();
    if (!root || visitedRoots.has(root)) continue;
    visitedRoots.add(root);

    // Query selectors do not cross HTMLTemplateElement.content boundaries.
    // Remove matches in this root first so templates inside a suppressed
    // subtree never need to be inspected or serialized independently.
    const suppressed = new Set<StaticConsentElement>();
    for (const selector of selectors) {
      for (const element of Array.from(root.querySelectorAll(selector))) {
        suppressed.add(element);
      }
    }
    for (const element of suppressed) element.remove();

    // Both ordinary templates and declarative-shadow templates expose their
    // inert descendants through `content`. Walking each reachable fragment is
    // required to apply the same consent taxonomy to the complete raw source.
    // The template root is visited too: browser DOMs make `content` canonical,
    // while some standards-oriented DOMParser implementations expose the
    // serializing children through the template query root as well.
    for (const template of Array.from(root.querySelectorAll("template"))) {
      if (template.querySelectorAll) {
        pendingRoots.push(template as StaticConsentQueryRoot);
      }
      if (template.content) {
        pendingRoots.push(template.content);
      }
    }
  }
  if (!document.documentElement) {
    throw new Error("Static consent sanitization produced no document element");
  }
  return `${serializeDoctype(document.doctype)}${document.documentElement.outerHTML}`;
}
