export const DEFAULT_AI_SELECTOR_MODIFIERS = Object.freeze({
  removeIdSegments: true,
  maxDescendantSelectors: Number.MAX_SAFE_INTEGER
});

function splitSelectorSegments(selector) {
  return selector
    .split(">")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function removeIdSelectorsFromSegment(segment) {
  if (!segment || !segment.includes("#")) {
    return segment;
  }
  let output = "";
  let quote = "";
  let bracketDepth = 0;
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    if (quote) {
      output += char;
      if (char === "\\") {
        i += 1;
        if (i < segment.length) {
          output += segment[i];
        }
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      output += char;
      continue;
    }
    if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
      output += char;
      continue;
    }
    if (char === "#" && bracketDepth === 0) {
      i += 1;
      while (i < segment.length) {
        const next = segment[i];
        if (next === "\\") {
          i += 2;
          continue;
        }
        if (/[a-zA-Z0-9_-]/.test(next)) {
          i += 1;
          continue;
        }
        break;
      }
      i -= 1;
      continue;
    }
    output += char;
  }
  return output;
}

export function countDescendantSelectors(selector) {
  if (typeof selector !== "string") {
    return 0;
  }
  const trimmed = selector.trim();
  if (!trimmed) {
    return 0;
  }
  return splitSelectorSegments(trimmed).length;
}

export function getMaximumDescendantSelectorCount(selectors) {
  let max = 0;
  for (const selector of Array.isArray(selectors) ? selectors : []) {
    max = Math.max(max, countDescendantSelectors(selector));
  }
  return max > 0 ? max : 1;
}

export function normalizeAiSelectorModifiers(modifiers, maxDescendantSelectors = 1) {
  const resolvedMax = Number.isFinite(maxDescendantSelectors)
    ? Math.max(1, Math.floor(maxDescendantSelectors))
    : 1;
  const normalized = {
    removeIdSegments: DEFAULT_AI_SELECTOR_MODIFIERS.removeIdSegments,
    maxDescendantSelectors: resolvedMax
  };
  if (modifiers && typeof modifiers === "object") {
    if ("removeIdSegments" in modifiers) {
      normalized.removeIdSegments = Boolean(modifiers.removeIdSegments);
    }
    const requestedMax = Number.parseInt(modifiers.maxDescendantSelectors, 10);
    if (Number.isFinite(requestedMax)) {
      normalized.maxDescendantSelectors = requestedMax;
    }
  }
  if (normalized.maxDescendantSelectors < 1) {
    normalized.maxDescendantSelectors = 1;
  }
  if (normalized.maxDescendantSelectors > resolvedMax) {
    normalized.maxDescendantSelectors = resolvedMax;
  }
  return normalized;
}

export function areAiSelectorModifiersEqual(left, right) {
  if (!left || !right) {
    return false;
  }
  return (
    Boolean(left.removeIdSegments) === Boolean(right.removeIdSegments) &&
    Number(left.maxDescendantSelectors) === Number(right.maxDescendantSelectors)
  );
}

export function applyAiSelectorModifiers(selectors, modifiers) {
  const list = Array.isArray(selectors) ? selectors : [];
  const maxDescendantSelectors = getMaximumDescendantSelectorCount(list);
  const normalized = normalizeAiSelectorModifiers(modifiers, maxDescendantSelectors);
  const unique = new Set();
  const output = [];

  list.forEach((selector) => {
    if (typeof selector !== "string") {
      return;
    }
    const raw = selector.trim();
    if (!raw) {
      return;
    }
    let segments = splitSelectorSegments(raw);
    if (!segments.length) {
      return;
    }
    if (normalized.removeIdSegments) {
      segments = segments
        .map((segment) => removeIdSelectorsFromSegment(segment).trim())
        .filter(Boolean);
    }
    if (!segments.length) {
      return;
    }
    if (segments.length > normalized.maxDescendantSelectors) {
      segments = segments.slice(
        segments.length - normalized.maxDescendantSelectors
      );
    }
    const transformed = segments.join(" > ").trim();
    if (!transformed || unique.has(transformed)) {
      return;
    }
    unique.add(transformed);
    output.push(transformed);
  });

  return output;
}
