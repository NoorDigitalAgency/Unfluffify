export function normalizeSelectorList(selectors) {
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

export function normalizeAiSelectorSet(value) {
  if (!value || typeof value !== "object") {
    return { exclusionSelectors: [], inclusionSelectors: [] };
  }
  return {
    exclusionSelectors: normalizeSelectorList(value.exclusionSelectors),
    inclusionSelectors: normalizeSelectorList(value.inclusionSelectors)
  };
}

export function combineAiSelectorSet(selectorSet) {
  if (!selectorSet || typeof selectorSet !== "object") {
    return [];
  }
  const normalized = normalizeAiSelectorSet(selectorSet);
  return [...normalized.exclusionSelectors, ...normalized.inclusionSelectors];
}

export function isWithinAncestorSet(node, nodes) {
  if (!node || !nodes || nodes.size === 0) {
    return false;
  }
  let current = node;
  while (current && current.nodeType === 1) {
    if (nodes.has(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

export function buildInclusionContextSet(includedNodes) {
  const context = new Set();
  for (const node of includedNodes || []) {
    let current = node;
    while (current && current.nodeType === 1) {
      context.add(current);
      current = current.parentElement;
    }
  }
  return context;
}

export function getNormalizedTextContent(node) {
  if (!node || node.nodeType !== 1) {
    return "";
  }
  if (!node.querySelector("script,style,noscript,template")) {
    return (node.textContent || "").replace(/\s+/g, " ").trim();
  }
  const chunks = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      const text = (current.textContent || "").replace(/\s+/g, " ").trim();
      if (text) {
        chunks.push(text);
      }
      continue;
    }
    if (current.nodeType !== 1) {
      continue;
    }
    const tag = current.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") {
      continue;
    }
    for (let i = current.childNodes.length - 1; i >= 0; i -= 1) {
      stack.push(current.childNodes[i]);
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

export function canUseCollapsedTextFallback(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (!getNormalizedTextContent(node)) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width === 0 || rect.height === 0;
}
