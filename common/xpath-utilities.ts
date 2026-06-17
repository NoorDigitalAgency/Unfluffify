// xpathRefiner.js

/**
 * Browser friendly HTML parser.
 * In Node, use refineXPathEntriesFromDocuments with prebuilt documents.
 * @private
 * @param {string} html - HTML string to parse
 * @returns {Document} Parsed HTML document
 */
function parseHTML(html: string) {
  if (typeof DOMParser === "undefined") {
    throw new Error(
      "DOMParser is not available in this environment. " +
      "Use refineXPathEntriesFromDocuments(oldDoc, newDoc, items, options) in Node."
    );
  }

  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * Resolve the first node for an XPath.
 * If the XPath points to a text node, return its parent element.
 * @private
 * @param {Document} doc - The document to query
 * @param {string} xpath - The XPath expression
 * @returns {Element|null} The first matching element or null
 */
function evaluateXPathFirst(doc: Document, xpath: string): Element | null {
  try {
    const result = doc.evaluate(
      xpath,
      doc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );

    const node = result.singleNodeValue;
    if (!node) return null;

    if (node.nodeType === Node.TEXT_NODE) {
      return node.parentElement || null;
    }

    return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tokenize(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]) {
  const setA = new Set(a);
  const setB = new Set(b);

  if (setA.size === 0 && setB.size === 0) return 1;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function getClassTokens(el: Element) {
  const className = el.getAttribute("class") || "";
  return className
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function getPreferredAttrs(el: Element) {
  const attrs: Record<string, string> = {};
  const names = [
    "id",
    "name",
    "type",
    "role",
    "title",
    "alt",
    "placeholder",
    "aria-label",
    "href",
    "src",
    "value"
  ];

  for (const name of names) {
    const value = el.getAttribute(name);
    if (value) attrs[name] = value;
  }

  for (const attrName of el.getAttributeNames()) {
    if (attrName.startsWith("data-")) {
      const value = el.getAttribute(attrName);
      if (value) attrs[attrName] = value;
    }
  }

  return attrs;
}

function getAncestorSignature(el: Element, depth = 4) {
  const out: Array<{ tag: string; id: string; classes: string[] }> = [];
  let cur = el.parentElement;
  let count = 0;

  while (cur && count < depth) {
    out.push({
      tag: cur.tagName.toLowerCase(),
      id: cur.id || "",
      classes: getClassTokens(cur)
    });
    cur = cur.parentElement;
    count++;
  }

  return out;
}

function fingerprintNode(el: Element) {
  return {
    tag: el.tagName.toLowerCase(),
    text: normalizeText(el.textContent).slice(0, 300),
    attrs: getPreferredAttrs(el),
    classes: getClassTokens(el),
    ancestors: getAncestorSignature(el, 4)
  };
}

function ancestorSimilarity(
  fpAncestors: Array<{ tag: string; id: string; classes: string[] }>,
  candidateAncestors: Array<{ tag: string; id: string; classes: string[] }>
) {
  let score = 0;
  const maxDepth = Math.min(fpAncestors.length, candidateAncestors.length);

  for (let i = 0; i < maxDepth; i++) {
    const a = fpAncestors[i];
    const b = candidateAncestors[i];

    if (a.tag === b.tag) score += 4;
    if (a.id && b.id && a.id === b.id) score += 10;
    score += 6 * jaccard(a.classes, b.classes);
  }

  return score;
}

function scoreCandidate(fp: any, el: Element) {
  let score = 0;
  const tag = el.tagName.toLowerCase();

  if (tag === fp.tag) {
    score += 15;
  }

  const attrs = getPreferredAttrs(el);
  const attrWeights: Record<string, number> = {
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
    value: 20
  };

  for (const [key, oldValue] of Object.entries(fp.attrs)) {
    const newValue = attrs[key];
    const weight = attrWeights[key] || (key.startsWith("data-") ? 35 : 10);

    if (!oldValue || !newValue) continue;

    if (oldValue === newValue) {
      score += weight;
    } else {
      const a = normalizeText(oldValue).toLowerCase();
      const b = normalizeText(newValue).toLowerCase();

      if (a && b && (a.includes(b) || b.includes(a))) {
        score += weight * 0.35;
      }
    }
  }

  const oldTextTokens = tokenize(fp.text).slice(0, 30);
  const newTextTokens = tokenize(el.textContent).slice(0, 30);
  score += 45 * jaccard(oldTextTokens, newTextTokens);

  score += 20 * jaccard(fp.classes, getClassTokens(el));
  score += ancestorSimilarity(fp.ancestors, getAncestorSignature(el, 4));

  return score;
}

function buildDomIndex(doc: Document) {
  const allElements = Array.from(doc.querySelectorAll("*"));
  const byTag = new Map();

  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    let list = byTag.get(tag);
    if (!list) {
      list = [];
      byTag.set(tag, list);
    }
    list.push(el);
  }

  return { allElements, byTag };
}

function findBestMatch(fp: any, domIndex: any, options: Record<string, unknown> = {}) {
  const minScore = typeof options.minScore === "number" ? options.minScore : 30;
  const tagCandidates = domIndex.byTag.get(fp.tag) || [];
  const primaryCandidates =
    tagCandidates.length > 0 ? tagCandidates : domIndex.allElements;

  let bestNode = null;
  let bestScore = -Infinity;

  for (const el of primaryCandidates) {
    const score = scoreCandidate(fp, el);
    if (score > bestScore) {
      bestScore = score;
      bestNode = el;
    }
  }

  if (bestScore < minScore && primaryCandidates !== domIndex.allElements) {
    for (const el of domIndex.allElements) {
      const score = scoreCandidate(fp, el);
      if (score > bestScore) {
        bestScore = score;
        bestNode = el;
      }
    }
  }

  return {
    node: bestNode,
    score: bestScore
  };
}

function getElementIndexAmongSameTag(el: Element) {
  let index = 1;
  let sib = el.previousElementSibling;

  while (sib) {
    if (sib.tagName === el.tagName) index++;
    sib = sib.previousElementSibling;
  }

  return index;
}

/**
 * Build a plain absolute indexed XPath.
 * Example: /html[1]/body[1]/main[1]/a[1]
 * @private
 * @param {Element} el - The element to build the XPath for
 * @returns {string} The absolute indexed XPath
 */
function buildAbsoluteIndexedXPath(el: Element) {
  const parts = [];
  let cur: Element | null = el;

  while (cur && cur.nodeType === 1) {
    const tag = cur.tagName.toLowerCase();
    const index = getElementIndexAmongSameTag(cur);
    parts.unshift(`${tag}[${index}]`);
    cur = cur.parentElement;
  }

  return "/" + parts.join("/");
}

/**
 * Refine an array of item objects using already parsed documents.
 *
 * Input item shape:
 * { xpath: string, excluded: boolean, explicit: boolean, ...anythingElse }
 *
 * Returns a new array of copied objects.
 * By default:
 *   - all original fields are preserved
 *   - xpath is replaced only when a match is found
 *   - if no good match is found, original xpath stays unchanged
 *
 * Options:
 *   - minScore: number, default 30
 *   - keepOriginalOnNoMatch: boolean, default true
 *   - skipExcluded: boolean, default false
 *   - includeMeta: boolean, default false
 * @private
 */
function refineXPathEntriesFromDocuments(
  oldDoc: Document,
  newDoc: Document,
  items: Array<Record<string, any>>,
  options: Record<string, unknown> = {}
) {
  const minScore = typeof options.minScore === "number" ? options.minScore : 30;
  const keepOriginalOnNoMatch = options.keepOriginalOnNoMatch ?? true;
  const skipExcluded = options.skipExcluded ?? false;
  const includeMeta = options.includeMeta ?? false;

  const domIndex = buildDomIndex(newDoc);

  return items.map((item) => {
    const copy = { ...item };

    if (
      !copy ||
      typeof copy !== "object" ||
      typeof copy.xpath !== "string" ||
      !copy.xpath.trim()
    ) {
      if (includeMeta) {
        copy.refineStatus = "invalid_input_item";
        copy.refineScore = 0;
      }
      return copy;
    }

    if (skipExcluded && copy.excluded === true) {
      if (includeMeta) {
        copy.refineStatus = "skipped_excluded";
        copy.refineScore = 0;
      }
      return copy;
    }

    const oldNode = evaluateXPathFirst(oldDoc, copy.xpath);

    if (!oldNode) {
      if (!keepOriginalOnNoMatch) {
        copy.xpath = null;
      }
      if (includeMeta) {
        copy.refineStatus = "not_found_in_old_html";
        copy.refineScore = 0;
      }
      return copy;
    }

    const fp = fingerprintNode(oldNode);
    const best = findBestMatch(fp, domIndex, { minScore });

    if (!best.node) {
      if (!keepOriginalOnNoMatch) {
        copy.xpath = null;
      }
      if (includeMeta) {
        copy.refineStatus = "no_match_in_new_html";
        copy.refineScore = 0;
      }
      return copy;
    }

    const refinedXPath = buildAbsoluteIndexedXPath(best.node);

    if (best.score >= minScore) {
      copy.xpath = refinedXPath;
      if (includeMeta) {
        copy.refineStatus = "matched";
        copy.refineScore = Math.round(best.score * 100) / 100;
      }
      return copy;
    }

    if (!keepOriginalOnNoMatch) {
      copy.xpath = refinedXPath;
    }

    if (includeMeta) {
      copy.refineStatus = "low_confidence";
      copy.refineScore = Math.round(best.score * 100) / 100;
      copy.refinedXPath = refinedXPath;
    }

    return copy;
  });
}

/**
 * Refine an array of item objects from raw HTML strings.
 */
export function refineXPathEntries(
  oldHtml: string,
  newHtml: string,
  items: Array<Record<string, any>>,
  options: Record<string, unknown> = {}
) {
  const oldDoc = parseHTML(oldHtml);
  const newDoc = parseHTML(newHtml);
  return refineXPathEntriesFromDocuments(oldDoc, newDoc, items, options);
}

export default refineXPathEntries;