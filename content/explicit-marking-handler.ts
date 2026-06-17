// @ts-nocheck
function addSelectorSuppressedXpath(deps, entry, xpath) {
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

function createXPathElementCache(deps) {
  const cache = new Map();
  return (xpath) => {
    if (!xpath) {
      return null;
    }
    if (!cache.has(xpath)) {
      cache.set(xpath, deps.getElementFromXPath(xpath));
    }
    return cache.get(xpath);
  };
}

function isSameOrDescendantByElementOrXPath(deps, parentXpath, parentElement, childXpath, childElement) {
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

function clearSelectorSuppressedXpathsWithin(deps, entry, xpath) {
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

export function createExplicitMarkingHandler(deps) {
  function finishUpdate(targetBaseUrl, pageUrl, config, entry) {
    deps.touchPageEntryTimestamp(entry);
    deps.normalizePageEntryXpaths(entry);
    config.pageMarkings[pageUrl] = entry;
    deps.scheduleRender();
    deps.scheduleSnapshotSave();
    deps.notifyDraftStatus(pageUrl);
    deps.scheduleDraftPersist(targetBaseUrl);
    return { ok: true, dirty: deps.isPageDraftDirty(pageUrl) };
  }

  function setExplicitExclude(options) {
    const { targetBaseUrl, xpath, excluded } = options || {};
    const config = deps.getConfig();
    const pageUrl = deps.getPageUrl();
    const entry = deps.getPageMarkingEntry(config, pageUrl);
    const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
    const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
    let targetItem = items.find((item) => item && item.xpath === xpath);
    if (!targetItem) {
      targetItem = excluded
        ? { xpath, excluded: true, explicit: true }
        : { xpath, excluded: false };
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
    const target = getElement(xpath);
    const cleanupDescendantIncludeOverrides = (currentXPath, currentTarget = null) => {
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
        if (!item || !item.xpath || item.xpath === xpath) {
          continue;
        }
        const existingEl = getElement(item.xpath);
        if (isSameOrDescendantByElementOrXPath(deps, xpath, target, item.xpath, existingEl)) {
          items.splice(index, 1);
          continue;
        }
        if (
          item.excluded &&
          isSameOrDescendantByElementOrXPath(deps, item.xpath, existingEl, xpath, target)
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
          includeXPath === xpath ||
          isSameOrDescendantByElementOrXPath(deps, includeXPath, includeEl, xpath, target) ||
          isSameOrDescendantByElementOrXPath(deps, xpath, target, includeXPath, includeEl)
        ) {
          includeXpaths.splice(index, 1);
        }
      }
    } else if (targetItem && !targetItem.excluded) {
      cleanupDescendantIncludeOverrides(xpath, target);
    }
    if (excluded) {
      clearSelectorSuppressedXpathsWithin(deps, entry, xpath);
    } else {
      addSelectorSuppressedXpath(deps, entry, xpath);
    }
    entry.includeXpaths = includeXpaths;
    entry.xpaths = items;
    return finishUpdate(targetBaseUrl, pageUrl, config, entry);
  }

  function setExplicitInclude(options) {
    const { targetBaseUrl, xpath, included } = options || {};
    const config = deps.getConfig();
    const pageUrl = deps.getPageUrl();
    const entry = deps.getPageMarkingEntry(config, pageUrl);
    const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
    const existingIndex = includeXpaths.indexOf(xpath);
    const getElement = createXPathElementCache(deps);
    if (included) {
      const target = getElement(xpath);
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
        includeXpaths.push(xpath);
      }
      const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (!item || !item.xpath || item.xpath === xpath) {
          continue;
        }
        const existingEl = getElement(item.xpath);
        if (isSameOrDescendantByElementOrXPath(deps, xpath, target, item.xpath, existingEl)) {
          items.splice(index, 1);
        }
      }
      entry.xpaths = items;
      for (let index = includeXpaths.length - 1; index >= 0; index -= 1) {
        const childXpath = includeXpaths[index];
        if (!childXpath || childXpath === xpath) {
          continue;
        }
        const existingEl = getElement(childXpath);
        if (isSameOrDescendantByElementOrXPath(deps, xpath, target, childXpath, existingEl)) {
          includeXpaths.splice(index, 1);
        }
      }
    } else if (existingIndex >= 0) {
      includeXpaths.splice(existingIndex, 1);
    }
    if (included) {
      clearSelectorSuppressedXpathsWithin(deps, entry, xpath);
    } else {
      addSelectorSuppressedXpath(deps, entry, xpath);
    }
    entry.includeXpaths = includeXpaths;
    return finishUpdate(targetBaseUrl, pageUrl, config, entry);
  }

  return {
    setExplicitExclude,
    setExplicitInclude
  };
}