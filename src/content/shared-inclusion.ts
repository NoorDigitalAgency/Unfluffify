import {
  normalizeSelectorList,
  normalizeAiSelectorSet,
  combineAiSelectorSet
} from "../common/selector-set";

export { normalizeSelectorList, normalizeAiSelectorSet, combineAiSelectorSet };

export function isWithinAncestorSet(node: Element | null | undefined, nodes: Set<Element> | null | undefined): boolean {
  if (!node || !nodes || nodes.size === 0) {
    return false;
  }
  let current: Element | null = node;
  while (current && current.nodeType === 1) {
    if (nodes.has(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

export function buildInclusionContextSet(includedNodes: Iterable<Element> | null | undefined): Set<Element> {
  const context = new Set<Element>();
  for (const node of includedNodes || []) {
    let current: Element | null = node;
    while (current && current.nodeType === 1) {
      context.add(current);
      current = current.parentElement;
    }
  }
  return context;
}

export function getNormalizedTextContent(node: Element | null | undefined): string {
  if (!node || node.nodeType !== 1) {
    return "";
  }
  if (!node.querySelector("script,style,noscript,template")) {
    return (node.textContent || "").replace(/\s+/g, " ").trim();
  }
  const chunks: string[] = [];
  const stack: Node[] = [node];
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
    const element = current as Element;
    const tag = element.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") {
      continue;
    }
    for (let i = element.childNodes.length - 1; i >= 0; i -= 1) {
      stack.push(element.childNodes[i]);
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

export function canUseCollapsedTextFallback(node: Element | null | undefined): boolean {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (!getNormalizedTextContent(node)) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width === 0 || rect.height === 0;
}
