import type { CanonicalMarkSet, MarkRow } from "./schema/marking";

export type SelectorSeedInput = Readonly<{
  excludeXpaths: readonly string[];
  includeXpaths: readonly string[];
}>;

const DOCUMENT_ROOTS = new Set(["/html[1]", "/html[1]/body[1]"]);

function isSeedableXpath(xpath: string): boolean {
  return xpath !== "" && !DOCUMENT_ROOTS.has(xpath.toLowerCase());
}

/** Computes the marks a clean session starts from: the default markings, then
 *  the AI selectors laid on top, which win wherever they contradict a default.
 *
 *  Seeded rows are explicit, so they behave exactly as marks the operator made —
 *  widening will not silently strip them and clicking one toggles it normally.
 *
 *  This runs once. After it, the selectors play no further part: the marks are
 *  ordinary rows and every later change follows the normal marking rules, so a
 *  refresh or a DOM mutation never re-imposes a selector the operator has since
 *  changed.
 *
 *  Inclusions are applied last, so an element a backend named in both sets ends
 *  up kept — the safer direction, since dropping real content is worse than
 *  keeping some fluff. */
export function applySelectorSeed(markSet: CanonicalMarkSet, input: SelectorSeedInput): CanonicalMarkSet {
  const byXpath = new Map<string, MarkRow>(markSet.rows.map((row) => [row.xpath, row]));
  for (const xpath of input.excludeXpaths) {
    if (isSeedableXpath(xpath)) {
      byXpath.set(xpath, { xpath, excluded: true, explicit: true });
    }
  }
  for (const xpath of input.includeXpaths) {
    if (isSeedableXpath(xpath)) {
      byXpath.set(xpath, { xpath, excluded: false, explicit: true });
    }
  }
  return { rows: [...byXpath.values()] };
}
