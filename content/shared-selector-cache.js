const selectorQueryCache = new Map()
const selectorQueryRootIds = new WeakMap()

let selectorQueryRootIdCounter = 1

let domStructureGeneration = 0
let geometryGeneration = 0
let configGeneration = 0
let pageMarkingGeneration = 0

function normalizeSelectorList(selectors) {
  if (!Array.isArray(selectors)) {
    return []
  }
  const normalized = []
  const seen = new Set()
  selectors.forEach((rawSelector) => {
    if (typeof rawSelector !== "string") {
      return
    }
    const selector = rawSelector.trim()
    if (!selector || seen.has(selector)) {
      return
    }
    seen.add(selector)
    normalized.push(selector)
  })
  return normalized
}

function getSelectorQueryRootId(root) {
  if (!root || (typeof root !== "object" && typeof root !== "function")) {
    return ""
  }
  if (selectorQueryRootIds.has(root)) {
    return selectorQueryRootIds.get(root)
  }
  const nextId = `selector-root-${selectorQueryRootIdCounter++}`
  selectorQueryRootIds.set(root, nextId)
  return nextId
}

export function getSelectorFingerprint(selectors) {
  return normalizeSelectorList(selectors).join("\u001f")
}

export function invalidateSharedSelectorCache({
  domStructure = false,
  geometry = false,
  config = false,
  pageMarkings = false,
  reset = false
} = {}) {
  if (reset) {
    domStructureGeneration = 0
    geometryGeneration = 0
    configGeneration = 0
    pageMarkingGeneration = 0
    selectorQueryCache.clear()
    return
  }
  if (domStructure) {
    domStructureGeneration += 1
  }
  if (geometry) {
    geometryGeneration += 1
  }
  if (config) {
    configGeneration += 1
  }
  if (pageMarkings) {
    pageMarkingGeneration += 1
  }
  if (domStructure || config || pageMarkings) {
    selectorQueryCache.clear()
  }
}

export function collectCachedSelectorMatches({
  root = null,
  selectors = [],
  pageUrl = "",
  scope = "",
  suppressionFingerprint = "",
  includeSelectorByNode = false,
  shouldIncludeNode = null
} = {}) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return { nodes: new Set(), selectorByNode: new Map(), fingerprint: "" }
  }

  const normalizedSelectors = normalizeSelectorList(selectors)
  if (!normalizedSelectors.length) {
    return { nodes: new Set(), selectorByNode: new Map(), fingerprint: "" }
  }

  const fingerprint = getSelectorFingerprint(normalizedSelectors)
  const cacheKey = JSON.stringify({
    pageUrl: typeof pageUrl === "string" ? pageUrl : "",
    scope: typeof scope === "string" ? scope : "",
    rootId: getSelectorQueryRootId(root),
    selectors: fingerprint,
    suppressionFingerprint:
      typeof suppressionFingerprint === "string" ? suppressionFingerprint : "",
    domStructureGeneration,
    configGeneration,
    pageMarkingGeneration
  })

  const cachedEntry = selectorQueryCache.get(cacheKey)
  if (cachedEntry) {
    return {
      nodes: new Set(cachedEntry.nodes),
      selectorByNode: includeSelectorByNode
        ? new Map(cachedEntry.selectorByNode)
        : new Map(),
      fingerprint
    }
  }

  const nodes = new Set()
  const selectorByNode = new Map()
  normalizedSelectors.forEach((selector) => {
    try {
      for (const node of root.querySelectorAll(selector)) {
        if (!node || node.nodeType !== 1) {
          continue
        }
        if (
          typeof shouldIncludeNode === "function" &&
          !shouldIncludeNode(node, selector)
        ) {
          continue
        }
        nodes.add(node)
        if (includeSelectorByNode && !selectorByNode.has(node)) {
          selectorByNode.set(node, selector)
        }
      }
    } catch {
      // Ignore invalid selectors.
    }
  })

  selectorQueryCache.set(cacheKey, {
    nodes: Array.from(nodes),
    selectorByNode: includeSelectorByNode
      ? Array.from(selectorByNode.entries())
      : []
  })

  return {
    nodes,
    selectorByNode,
    fingerprint
  }
}

export function getSharedSelectorCacheState() {
  return {
    domStructureGeneration,
    geometryGeneration,
    configGeneration,
    pageMarkingGeneration,
    size: selectorQueryCache.size
  }
}
