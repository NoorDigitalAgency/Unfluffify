import * as utils from "./utilities.js";

type AiSelectorSetLike = {
  exclusionSelectors?: unknown;
  inclusionSelectors?: unknown;
};

export function normalizeSelectorList(selectors: unknown): string[] {
  const values = [];
  const seen = new Set();
  for (const selector of Array.isArray(selectors) ? selectors : []) {
    if (typeof selector !== "string") {
      continue;
    }
    const trimmed = selector.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    values.push(trimmed);
  }
  return values;
}

export function normalizeAiSelectorSet(
  value: AiSelectorSetLike | null | undefined
): { exclusionSelectors: string[]; inclusionSelectors: string[] } {
  if (!value || typeof value !== "object") {
    return { exclusionSelectors: [], inclusionSelectors: [] };
  }
  return {
    exclusionSelectors: normalizeSelectorList(value.exclusionSelectors),
    inclusionSelectors: normalizeSelectorList(value.inclusionSelectors)
  };
}

export function combineAiSelectorSet(
  selectorSet: AiSelectorSetLike | null | undefined
): string[] {
  const normalized = normalizeAiSelectorSet(selectorSet);
  return [...normalized.exclusionSelectors, ...normalized.inclusionSelectors];
}

export function aiSelectorSetsEqual(
  left: AiSelectorSetLike | null | undefined,
  right: AiSelectorSetLike | null | undefined
): boolean {
  const normalizedLeft = normalizeAiSelectorSet(left);
  const normalizedRight = normalizeAiSelectorSet(right);
  return (
    utils.arraysEqual(
      normalizedLeft.exclusionSelectors,
      normalizedRight.exclusionSelectors
    ) &&
    utils.arraysEqual(
      normalizedLeft.inclusionSelectors,
      normalizedRight.inclusionSelectors
    )
  );
}
