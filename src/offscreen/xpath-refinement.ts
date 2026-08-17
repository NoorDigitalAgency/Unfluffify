import { MarkRowSchema, type MarkRow } from "../domain/schema/marking";

type AncestorSignature = Readonly<{
  tag: string;
  id: string;
  classes: readonly string[];
}>;

type ElementFingerprint = Readonly<{
  tag: string;
  text: string;
  attrs: Readonly<Record<string, string>>;
  classes: readonly string[];
  ancestors: readonly AncestorSignature[];
}>;

function parseHtml(html: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is required for offscreen XPath refinement");
  }
  return new DOMParser().parseFromString(html, "text/html");
}

function evaluateXPathFirst(doc: Document, xpath: string): Element | null {
  try {
    // 9 is XPathResult.FIRST_ORDERED_NODE_TYPE. Keeping the numeric DOM value
    // avoids depending on XPathResult being copied onto every offscreen global.
    const node = doc.evaluate(xpath, doc, null, 9, null).singleNodeValue;
    if (!node) return null;
    if (node.nodeType === 3) return node.parentElement;
    return node.nodeType === 1 ? node as Element : null;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function tokens(value: unknown): string[] {
  return normalizeText(value).toLowerCase().split(/[^a-z0-9_]+/i).filter(Boolean);
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 && rightSet.size === 0) return 1;
  let intersection = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function classTokens(element: Element): string[] {
  return (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function preferredAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const name of [
    "id", "name", "type", "role", "title", "alt", "placeholder",
    "aria-label", "href", "src", "value",
  ]) {
    const value = element.getAttribute(name);
    if (value) attributes[name] = value;
  }
  for (const name of element.getAttributeNames()) {
    if (!name.startsWith("data-")) continue;
    const value = element.getAttribute(name);
    if (value) attributes[name] = value;
  }
  return attributes;
}

function ancestorSignature(element: Element, depth = 4): AncestorSignature[] {
  const signature: AncestorSignature[] = [];
  let current = element.parentElement;
  while (current && signature.length < depth) {
    signature.push({
      tag: current.tagName.toLowerCase(),
      id: current.id || "",
      classes: classTokens(current),
    });
    current = current.parentElement;
  }
  return signature;
}

function fingerprint(element: Element): ElementFingerprint {
  return {
    tag: element.tagName.toLowerCase(),
    text: normalizeText(element.textContent).slice(0, 300),
    attrs: preferredAttributes(element),
    classes: classTokens(element),
    ancestors: ancestorSignature(element),
  };
}

function ancestorSimilarity(
  left: readonly AncestorSignature[],
  right: readonly AncestorSignature[],
): number {
  let score = 0;
  const depth = Math.min(left.length, right.length);
  for (let index = 0; index < depth; index += 1) {
    const before = left[index];
    const after = right[index];
    if (!before || !after) continue;
    if (before.tag === after.tag) score += 4;
    if (before.id && after.id && before.id === after.id) score += 10;
    score += 6 * jaccard(before.classes, after.classes);
  }
  return score;
}

function scoreCandidate(source: ElementFingerprint, candidate: Element): number {
  let score = candidate.tagName.toLowerCase() === source.tag ? 15 : 0;
  const attributes = preferredAttributes(candidate);
  const weights: Readonly<Record<string, number>> = {
    id: 100,
    name: 40,
    type: 20,
    role: 25,
    title: 20,
    alt: 20,
    placeholder: 20,
    "aria-label": 30,
    href: 45,
    src: 45,
    value: 20,
  };
  for (const [name, oldValue] of Object.entries(source.attrs)) {
    const newValue = attributes[name];
    const weight = weights[name] ?? (name.startsWith("data-") ? 35 : 10);
    if (!oldValue || !newValue) continue;
    if (oldValue === newValue) {
      score += weight;
      continue;
    }
    const before = normalizeText(oldValue).toLowerCase();
    const after = normalizeText(newValue).toLowerCase();
    if (before && after && (before.includes(after) || after.includes(before))) {
      score += weight * 0.35;
    }
  }
  score += 45 * jaccard(tokens(source.text).slice(0, 30), tokens(candidate.textContent).slice(0, 30));
  score += 20 * jaccard(source.classes, classTokens(candidate));
  score += ancestorSimilarity(source.ancestors, ancestorSignature(candidate));
  return score;
}

function absoluteIndexedXPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === 1) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }
  return `/${parts.join("/")}`;
}

/** Matches rows from the browser-rendered document into the server-delivered
 *  static document. A low-confidence or absent match keeps the original path;
 *  include/exclude/explicit fields are never inferred or changed here. */
export function refineXPathEntriesFromDocuments(
  renderedDocument: Document,
  rawDocument: Document,
  rows: readonly MarkRow[],
  minScore = 30,
): readonly MarkRow[] {
  const allElements = Array.from(rawDocument.querySelectorAll("*"));
  const byTag = new Map<string, Element[]>();
  for (const element of allElements) {
    const tag = element.tagName.toLowerCase();
    const tagged = byTag.get(tag);
    if (tagged) {
      tagged.push(element);
    } else {
      byTag.set(tag, [element]);
    }
  }

  return rows.map((inputRow) => {
    const row = MarkRowSchema.parse(inputRow);
    const oldNode = evaluateXPathFirst(renderedDocument, row.xpath);
    if (!oldNode) return row;
    const source = fingerprint(oldNode);
    const tagged = byTag.get(source.tag) ?? [];
    const primary = tagged.length > 0 ? tagged : allElements;
    let bestNode: Element | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of primary) {
      const score = scoreCandidate(source, candidate);
      if (score > bestScore) {
        bestNode = candidate;
        bestScore = score;
      }
    }
    if (bestScore < minScore && primary !== allElements) {
      for (const candidate of allElements) {
        const score = scoreCandidate(source, candidate);
        if (score > bestScore) {
          bestNode = candidate;
          bestScore = score;
        }
      }
    }
    return bestNode && bestScore >= minScore
      ? { ...row, xpath: absoluteIndexedXPath(bestNode) }
      : row;
  });
}

export function refineXPathEntries(
  renderedHtml: string,
  rawHtml: string,
  rows: readonly MarkRow[],
): readonly MarkRow[] {
  return refineXPathEntriesFromDocuments(
    parseHtml(renderedHtml),
    parseHtml(rawHtml),
    rows,
  );
}
