type ExplicitMarkingEntryItem = {
  xpath?: string;
  excluded?: boolean;
  explicit?: boolean;
};

type ExplicitMarkingEntry = {
  xpaths?: ExplicitMarkingEntryItem[];
  includeXpaths?: string[];
  selectorSuppressedXpaths?: string[];
  [key: string]: unknown;
};

type ExplicitMarkingConfig = {
  pageMarkings: Record<string, ExplicitMarkingEntry>;
};

type ExplicitMarkingDeps = {
  canApplyExplicitInclude: (
    target: Element,
    config: ExplicitMarkingConfig,
    pageUrl: string,
    entry: ExplicitMarkingEntry
  ) => boolean;
  getConfig: () => ExplicitMarkingConfig;
  getElementFromXPath: (xpath: string) => Element | null;
  getPageMarkingEntry: (config: ExplicitMarkingConfig, pageUrl: string) => ExplicitMarkingEntry;
  getPageUrl: () => string;
  isDefaultToggleableExcludedElement: (element: Element | null) => boolean;
  isPageDraftDirty: (pageUrl: string) => boolean;
  isXPathDescendant: (parent: string, child: string) => boolean;
  normalizePageEntryXpaths: (entry: ExplicitMarkingEntry) => void;
  notifyDraftStatus: (pageUrl: string) => void;
  scheduleDraftPersist: (targetBaseUrl: string) => void;
  scheduleRender: () => void;
  scheduleSnapshotSave: () => void;
  touchPageEntryTimestamp: (entry: ExplicitMarkingEntry) => void;
};

type ExplicitExcludeOptions = {
  targetBaseUrl?: string;
  xpath?: string;
  excluded?: boolean;
};

type ExplicitIncludeOptions = {
  targetBaseUrl?: string;
  xpath?: string;
  included?: boolean;
};

// function addSelectorSuppressedXpath(deps, entry, xpath)
function addSelectorSuppressedXpath(deps: ExplicitMarkingDeps, entry: ExplicitMarkingEntry, xpath: string | undefined) {
  if (!entry || typeof entry !== "object") {
    return;
  }
  const currentXpaths = Array.isArray(entry.selectorSuppressedXpaths)
    ? entry.selectorSuppressedXpaths.filter((value) => typeof value === "string" && value)
    : [];
  if (!xpath) {
    entry.selectorSuppressedXpaths = currentXpaths;
    return;
  }
  if (currentXpaths.some((existingXpath) =>
    existingXpath === xpath || deps.isXPathDescendant(existingXpath, xpath)
  )) {
    entry.selectorSuppressedXpaths = currentXpaths;
    return;
  }
  entry.selectorSuppressedXpaths = currentXpaths
    .filter((existingXpath) => !deps.isXPathDescendant(xpath, existingXpath))
    .concat(xpath);
}

// function createXPathElementCache(deps)
function createXPathElementCache(deps: ExplicitMarkingDeps): (xpath: string | undefined) => Element | null {
  const cache = new Map<string, Element | null>();
  return (xpath: string | undefined) => {
    if (!xpath) {
      return null;
    }
    if (!cache.has(xpath)) {
      cache.set(xpath, deps.getElementFromXPath(xpath));
    }
    return cache.get(xpath) || null;
  };
}

// function isSameOrDescendantByElementOrXPath(deps,
function isSameOrDescendantByElementOrXPath(
  deps: ExplicitMarkingDeps,
  parentXpath: string | undefined,
  parentElement: Element | null,
  childXpath: string | undefined,
  childElement: Element | null
): boolean {
  if (!parentXpath || !childXpath) {
    return false;
  }
  if (parentXpath === childXpath) {
    return true;
  }
  if (parentElement && childElement) {
    return parentElement.contains(childElement);
  }
  return deps.isXPathDescendant(parentXpath, childXpath);
}

function clearSelectorSuppressedXpathsWithin(deps: ExplicitMarkingDeps, entry: ExplicitMarkingEntry, xpath: string | undefined) {
  if (!entry || typeof entry !== "object") {
    return;
  }
  const currentXpaths = Array.isArray(entry.selectorSuppressedXpaths)
    ? entry.selectorSuppressedXpaths.filter((value) => typeof value === "string" && value)
    : [];
  if (!xpath) {
    entry.selectorSuppressedXpaths = currentXpaths;
    return;
  }
  entry.selectorSuppressedXpaths = currentXpaths.filter((existingXpath) =>
    existingXpath !== xpath && !deps.isXPathDescendant(xpath, existingXpath)
  );
}

export function createExplicitMarkingHandler(deps: ExplicitMarkingDeps) {
  function finishUpdate(
    targetBaseUrl: string,
    pageUrl: string,
    config: ExplicitMarkingConfig,
    entry: ExplicitMarkingEntry
  ): { ok: boolean; dirty: boolean } {
    deps.touchPageEntryTimestamp(entry);
    deps.normalizePageEntryXpaths(entry);
    config.pageMarkings[pageUrl] = entry;
    deps.scheduleRender();
    deps.scheduleSnapshotSave();
    deps.notifyDraftStatus(pageUrl);
    deps.scheduleDraftPersist(targetBaseUrl);
    return { ok: true, dirty: deps.isPageDraftDirty(pageUrl) };
  }

  // function setExplicitExclude(options) {
  function setExplicitExclude(options: ExplicitExcludeOptions = {}): { ok: boolean; dirty?: boolean } {
    const { targetBaseUrl, xpath, excluded } = options || {};
    const effectiveXpath = typeof xpath === "string" ? xpath : "";
    const config = deps.getConfig();
    const pageUrl = deps.getPageUrl();
    const entry = deps.getPageMarkingEntry(config, pageUrl);
    const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
    const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
    let targetItem = items.find((item) => item && item.xpath === effectiveXpath);
    if (!targetItem) {
      targetItem = excluded
        ? { xpath: effectiveXpath, excluded: true, explicit: true }
        : { xpath: effectiveXpath, excluded: false };
      items.push(targetItem);
    } else {
      targetItem.excluded = excluded;
      if (excluded) {
        targetItem.explicit = true;
      } else {
        delete targetItem.explicit;
      }
    }
    const getElement = createXPathElementCache(deps);
    const target = getElement(effectiveXpath);
    const cleanupDescendantIncludeOverrides = (currentXPath: string, currentTarget: Element | null = null) => {
      const boundaryTarget = currentTarget && currentTarget.nodeType === 1
        ? currentTarget
        : getElement(currentXPath);
      for (let index = includeXpaths.length - 1; index >= 0; index -= 1) {
        const includeXPath = includeXpaths[index];
        if (!includeXPath || includeXPath === currentXPath) {
          continue;
        }
        const includeEl = getElement(includeXPath);
        if (isSameOrDescendantByElementOrXPath(deps, currentXPath, boundaryTarget, includeXPath, includeEl)) {
          includeXpaths.splice(index, 1);
        }
      }
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (!item || !item.xpath || item.excluded || item.xpath === currentXPath) {
          continue;
        }
        const itemEl = getElement(item.xpath);
        if (isSameOrDescendantByElementOrXPath(deps, currentXPath, boundaryTarget, item.xpath, itemEl)) {
          items.splice(index, 1);
        }
      }
    };
    if (excluded) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (!item || !item.xpath || item.xpath === effectiveXpath) {
          continue;
        }
        const existingEl = getElement(item.xpath);
        if (isSameOrDescendantByElementOrXPath(deps, effectiveXpath, target, item.xpath, existingEl)) {
          items.splice(index, 1);
          continue;
        }
        if (
          item.excluded &&
          isSameOrDescendantByElementOrXPath(deps, item.xpath, existingEl, effectiveXpath, target)
        ) {
          cleanupDescendantIncludeOverrides(item.xpath, existingEl);
          if (existingEl && deps.isDefaultToggleableExcludedElement(existingEl)) {
            item.excluded = false;
            delete item.explicit;
          } else {
            items.splice(index, 1);
          }
        }
      }
      for (let index = includeXpaths.length - 1; index >= 0; index -= 1) {
        const includeXPath = includeXpaths[index];
        if (!includeXPath) {
          continue;
        }
        const includeEl = getElement(includeXPath);
        if (
          includeXPath === effectiveXpath ||
          isSameOrDescendantByElementOrXPath(deps, includeXPath, includeEl, effectiveXpath, target) ||
          isSameOrDescendantByElementOrXPath(deps, effectiveXpath, target, includeXPath, includeEl)
        ) {
          includeXpaths.splice(index, 1);
        }
      }
    } else if (targetItem && !targetItem.excluded) {
      cleanupDescendantIncludeOverrides(effectiveXpath, target);
    }
    // if (excluded) {
    //   clearSelectorSuppressedXpathsWithin(deps, entry, xpath);
    // } else {
    //   addSelectorSuppressedXpath(deps, entry, xpath);
    // }
    if (excluded) {
      clearSelectorSuppressedXpathsWithin(deps, entry, effectiveXpath);
    } else {
      addSelectorSuppressedXpath(deps, entry, effectiveXpath);
    }
    entry.includeXpaths = includeXpaths;
    entry.xpaths = items;
    return finishUpdate(targetBaseUrl || "", pageUrl, config, entry);
  }

  // function setExplicitInclude(options) {
  function setExplicitInclude(options: ExplicitIncludeOptions = {}): { ok: boolean; dirty?: boolean } {
    const { targetBaseUrl, xpath, included } = options || {};
    const effectiveXpath = typeof xpath === "string" ? xpath : "";
    const config = deps.getConfig();
    const pageUrl = deps.getPageUrl();
    const entry = deps.getPageMarkingEntry(config, pageUrl);
    const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
    const existingIndex = includeXpaths.indexOf(effectiveXpath);
    const getElement = createXPathElementCache(deps);
    if (included) {
      const target = getElement(effectiveXpath);
      if (!target) {
        return { ok: false };
      }
      if (
        existingIndex === -1 &&
        !deps.canApplyExplicitInclude(target, config, pageUrl, entry)
      ) {
        return { ok: false };
      }
      if (existingIndex === -1) {
        includeXpaths.push(effectiveXpath);
      }
      const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (!item || !item.xpath || item.xpath === effectiveXpath) {
          continue;
        }
        const existingEl = getElement(item.xpath);
        if (isSameOrDescendantByElementOrXPath(deps, effectiveXpath, target, item.xpath, existingEl)) {
          items.splice(index, 1);
        }
      }
      entry.xpaths = items;
      for (let index = includeXpaths.length - 1; index >= 0; index -= 1) {
        const childXpath = includeXpaths[index];
        if (!childXpath || childXpath === effectiveXpath) {
          continue;
        }
        const existingEl = getElement(childXpath);
        if (isSameOrDescendantByElementOrXPath(deps, effectiveXpath, target, childXpath, existingEl)) {
          includeXpaths.splice(index, 1);
        }
      }
    } else if (existingIndex >= 0) {
      includeXpaths.splice(existingIndex, 1);
    }
    // if (included) {
    //   clearSelectorSuppressedXpathsWithin(deps, entry, xpath);
    // } else {
    //   addSelectorSuppressedXpath(deps, entry, xpath);
    // }
    if (included) {
      clearSelectorSuppressedXpathsWithin(deps, entry, effectiveXpath);
    } else {
      addSelectorSuppressedXpath(deps, entry, effectiveXpath);
    }
    entry.includeXpaths = includeXpaths;
    return finishUpdate(targetBaseUrl || "", pageUrl, config, entry);
  }

  return {
    setExplicitExclude,
    setExplicitInclude
  };
}