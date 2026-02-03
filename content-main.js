import * as patterns from "./common/patterns.js";
import * as core from "./content/core.js";
import * as config from "./common/config.js";
import * as utils from "./common/utilities.js";
import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "./common/constants.js";

const { state } = core;

const SILENT_LINK_HIGHLIGHTING_ATTR = "data-uf-silent-link-highlighting";
const SILENT_CONTENT_HIGHLIGHTING_ATTR = "data-uf-silent-content-highlighting";
const SILENT_HIGHLIGHTINGS_ACTIVE_ATTR = "data-uf-silent-highlightings";
const PAGE_TOAST_ID = "unfluffify-page-toast";
const PAGE_TOAST_STYLE_ID = "unfluffify-page-toast-style";

function ensurePageToastStyle() {
  if (document.getElementById(PAGE_TOAST_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = PAGE_TOAST_STYLE_ID;
  style.textContent = `
      #${PAGE_TOAST_ID} {
        position: fixed;
        left: 14px;
        right: 14px;
        bottom: 14px;
        padding: 10px 12px;
        background: rgba(47, 42, 36, 0.9);
        color: #fdf6ed;
        font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
        font-size: 12px;
        border-radius: 10px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
        z-index: 2147483647;
      }
      #${PAGE_TOAST_ID}.uf-toast-show {
        opacity: 1;
        transform: translateY(0);
      }
    `;
  (document.head || document.documentElement).appendChild(style);
}

function showPageToast(message) {
  ensurePageToastStyle();
  let toast = document.getElementById(PAGE_TOAST_ID);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = PAGE_TOAST_ID;
    (document.body || document.documentElement).appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("uf-toast-show");
  window.clearTimeout(showPageToast._timer);
  showPageToast._timer = window.setTimeout(() => {
    if (toast) {
      toast.classList.remove("uf-toast-show");
    }
  }, 1800);
}

function isEditableTarget(target) {
  if (!target) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

async function toggleEnabledFromPage() {
  const tabState = await utils.sendRuntimeMessage({ type: "getTabState" });
  const currentlyEnabled = Boolean(state.enabled || (tabState && tabState.enabled));
  let baseUrl = state.baseUrl || (tabState && tabState.baseUrl ? tabState.baseUrl : "");
  if (!baseUrl || !location.href.startsWith(baseUrl)) {
    const configs = await config.getConfigs();
    baseUrl = utils.findMatchingBaseUrl(location.href, configs);
  }
  if (!baseUrl || !location.href.startsWith(baseUrl)) {
    showPageToast("Set Base Page URL in the Unfluffify popup first.");
    return;
  }
  if (currentlyEnabled) {
    core.disable();
    await utils.sendRuntimeMessage({
      type: "setTabState",
      enabled: false,
      baseUrl
    });
    refreshSilentHighlightings().then();
    return;
  }
  await utils.sendRuntimeMessage({
    type: "setTabState",
    enabled: true,
    baseUrl
  });
  core.enableForBaseUrl(baseUrl, {}).then();
  refreshSilentHighlightings().then();
}

function ensureSilentHighlightingStyles() {
  if (document.getElementById("unfluffify-silent-highlightings-style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "unfluffify-silent-highlightings-style";
  style.textContent = `
      html[${SILENT_HIGHLIGHTINGS_ACTIVE_ATTR}] a[${SILENT_LINK_HIGHLIGHTING_ATTR}] {
        outline: 2px dashed #56acce !important;
        outline-offset: 2px !important;
      }
      html[${SILENT_HIGHLIGHTINGS_ACTIVE_ATTR}] [${SILENT_CONTENT_HIGHLIGHTING_ATTR}] {
        outline: 2px dashed #44b532 !important;
        outline-offset: 2px !important;
      }
    `;
  (document.head || document.documentElement).appendChild(style);
}

function setSilentHighlightingsActive(active) {
  if (active) {
    document.documentElement.setAttribute(SILENT_HIGHLIGHTINGS_ACTIVE_ATTR, "on");
  } else {
    document.documentElement.removeAttribute(SILENT_HIGHLIGHTINGS_ACTIVE_ATTR);
  }
}

function clearSilentHighlightingMarks() {
  const marked = document.querySelectorAll(`a[${SILENT_LINK_HIGHLIGHTING_ATTR}], [${SILENT_CONTENT_HIGHLIGHTING_ATTR}]`);
  marked.forEach((anchor) => {
    anchor.removeAttribute(SILENT_LINK_HIGHLIGHTING_ATTR);
    anchor.removeAttribute(SILENT_CONTENT_HIGHLIGHTING_ATTR);
  });
}

async function refreshSilentHighlightings() {
  if (state.enabled) {
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    return;
  }
  const pageUrl = location.href;
  const configs = await config.getConfigs();
  const baseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  if (!baseUrl) {
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    return;
  }
  const pageMarkings =
    configs[baseUrl] && configs[baseUrl].pageMarkings
      ? configs[baseUrl].pageMarkings
      : null;
  const latestComputedSelectors =
    configs[baseUrl] && configs[baseUrl].latestComputedSelectors
      ? configs[baseUrl].latestComputedSelectors
      : null;
  if (!pageMarkings && !latestComputedSelectors) {
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    return;
  }
  const savedUrls = new Set(
    Object.keys(pageMarkings).filter((url) => typeof url === "string" && url)
  );
  if (!savedUrls.size && !latestComputedSelectors.size) {
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    return;
  }
  ensureSilentHighlightingStyles();
  clearSilentHighlightingMarks();
  const anchors = [];
  const anchorNodes = document.querySelectorAll("a[href]");
  anchorNodes.forEach((anchor) => {
    if (!anchor || !anchor.getAttribute) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) {
      return;
    }
    let resolved = "";
    try {
      resolved = new URL(href, pageUrl).href;
    } catch (error) {
      return;
    }
    if (savedUrls.has(resolved)) {
      anchors.push(anchor);
    }
  });
  anchors.forEach((anchor) => anchor.setAttribute(SILENT_LINK_HIGHLIGHTING_ATTR, "1"));
  const contentNodes = Array.from(document.querySelectorAll(latestComputedSelectors.join(", ")));
  contentNodes.forEach((node) => node.setAttribute(SILENT_CONTENT_HIGHLIGHTING_ATTR, "1"));
  console.log(latestComputedSelectors, contentNodes);
  setSilentHighlightingsActive(anchors.length > 0);
}

export function main() {
  if (state.initialized) {
    return;
  }
  state.initialized = true;

  core.refreshFromTabState().then(() => {
    refreshSilentHighlightings().then();
  });

  document.addEventListener("keydown", (event) => {
    if (
      (event.key === "e" || event.key === "E") &&
      event.altKey &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.repeat
    ) {
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleEnabledFromPage().then();
    }
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "setEnabled") {
      if (message.enabled) {
        core.enableForBaseUrl(message.baseUrl, { pagePattern: message.pagePattern }).then();
      } else {
        core.disable();
        refreshSilentHighlightings().then();
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "configUpdated") {
      if (state.enabled && message.baseUrl === state.baseUrl) {
        const pageUrl = location.href;
        const draftEntry = core.getDraftPageEntry(pageUrl);
        const savedEntry = core.getSavedPageEntry(pageUrl);
        core.loadConfig(state.baseUrl).then((config) => {
          core.mergeDraftEntry(config, pageUrl, draftEntry, savedEntry);
          state.config = config;
          core.scheduleRender();
        });
      } else {
        refreshSilentHighlightings().then();
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "forceRefresh") {
      core.refreshFromTabState().then(() => {
        refreshSilentHighlightings().then(() => {
          sendResponse({ ok: true });
        });
      });
      return true;
    }

    if (message.type === "getDefaultExclusions") {
      sendResponse({
        immutableSelectors: DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS.slice()
      });
      return;
    }

    if (message.type === "collectPageData") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      core.loadConfig(targetBaseUrl).then((config) => {
        const entry = core.getPageMarkingEntry(config, location.href, {
          create: false,
          persist: false
        });
        sendResponse({
          baseUrl: targetBaseUrl,
          pageUrl: location.href,
          fullHTML: document.documentElement.outerHTML,
          immutableSelectors: DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS.slice(),
          xpaths: entry.xpaths || []
        });
      });
      return true;
    }

    if (message.type === "getHeadingDefaultStatus") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const useStateConfig =
        state.baseUrl === targetBaseUrl && state.config;
      const loadPromise = useStateConfig
        ? Promise.resolve(state.config)
        : core.loadConfig(targetBaseUrl);
      loadPromise.then((config) => {
        const immutableExcluded = core.collectImmutableElements();
        const hasEntry = core.hasPageMarkingEntry(config, location.href);
        const syncResult = core.syncPageMarkings(config, location.href, immutableExcluded, {
          allowCreate: hasEntry,
          persist: useStateConfig && hasEntry
        });
        sendResponse({ items: core.collectHeadingDefaultStatus(config, syncResult.entry) });
      });
      return true;
    }

    if (message.type === "filterXPathsOnPage") {
      const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
      const filtered = xpaths.filter((xpath) => {
        const el = core.getElementFromXPath(xpath);
        return el && core.isVisible(el);
      });
      sendResponse({ xpaths: filtered });
      return;
    }

    if (message.type === "describeXPathsOnPage") {
      const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
      const items = [];
      xpaths.forEach((xpath) => {
        const el = core.getElementFromXPath(xpath);
        if (!el || !core.isVisible(el)) {
          return;
        }
        items.push({ xpath, text: core.getElementLabel(el) });
      });
      sendResponse({ items });
      return;
    }

    if (message.type === "computeCssSelectorsFromXPaths") {
      const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
      const excludedXPaths = Array.isArray(message.excludedXPaths)
        ? message.excludedXPaths
        : [];
      const selectors = [];
      const includedElements = new Set();
      xpaths.forEach((xpath) => {
        if (!xpath) {
          return;
        }
        const el = core.getElementFromXPath(xpath);
        if (el) {
          includedElements.add(el);
        }
      });
      const excludedElements = new Set();
      excludedXPaths.forEach((xpath) => {
        if (!xpath) {
          return;
        }
        const el = core.getElementFromXPath(xpath);
        if (el) {
          excludedElements.add(el);
        }
      });
      xpaths.forEach((xpath) => {
        if (!xpath) {
          return;
        }
        const el = core.getElementFromXPath(xpath);
        if (!el) {
          return;
        }
        let ancestor = el.parentElement;
        while (ancestor) {
          if (excludedElements.has(ancestor) && !includedElements.has(ancestor)) {
            return;
          }
          ancestor = ancestor.parentElement;
        }
        const selector = core.buildCssSelectorPath(el);
        if (selector) {
          selectors.push(selector);
        }
      });
      sendResponse({ ok: true, selectors });
      return;
    }

    if (message.type === "focusElement") {
      const xpath = message.xpath || "";
      const target = xpath ? core.getElementFromXPath(xpath) : null;
      if (!target) {
        sendResponse({ ok: false });
        return;
      }
      state.focusElement = target;
      target.scrollIntoView({ block: "center", inline: "center" });
      core.scheduleRender();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "clearFocus") {
      core.clearFocusHighlight();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "toggleHeadingDefault") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const xpath = message.xpath || "";
      if (!xpath) {
        sendResponse({ ok: false });
        return;
      }
      const useStateConfig =
        state.baseUrl === targetBaseUrl && state.config;
      const loadPromise = useStateConfig
        ? Promise.resolve(state.config)
        : core.loadConfig(targetBaseUrl);
      loadPromise.then((config) => {
        const target = core.getElementFromXPath(xpath);
        if (!target || !core.isMarkableElement(target, config) || !core.isHeadingElement(target)) {
          sendResponse({ ok: false });
          return;
        }
        const entry = core.getPageMarkingEntry(config, location.href);
        const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
        let targetItem = items.find((item) => item && item.xpath === xpath);
        if (!targetItem) {
          targetItem = { xpath, excluded: true };
          items.push(targetItem);
        } else {
          targetItem.excluded = !targetItem.excluded;
        }
        entry.xpaths = items;
        config.pageMarkings[location.href] = entry;
        if (useStateConfig) {
          state.config = config;
          core.scheduleRender();
          core.scheduleSnapshotSave();
          core.notifyDraftStatus(location.href);
        }
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "capturePageSnapshot") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl) {
        sendResponse({ ok: false });
        return;
      }
      const shouldPersist = Boolean(message.persist);

      (async () => {
        let config;
        if (state.baseUrl === targetBaseUrl && state.config) {
          // Use the in-memory config to preserve any unsaved changes
          config = state.config;
        } else {
          // Load from storage if it's a different base URL
          config = await core.loadConfig(targetBaseUrl);
        }

        const allowCreate = shouldPersist;
        const hasEntry = core.hasPageMarkingEntry(config, location.href);
        if (!allowCreate && !hasEntry) {
          sendResponse({ ok: false });
          return;
        }

        // Ensure page entry is synced first, then capture HTML
        const immutableExcluded = core.collectImmutableElements();
        const syncResult = core.syncPageMarkings(config, location.href, immutableExcluded, {
          allowCreate,
          persist: allowCreate || hasEntry
        });

        // Now capture the full HTML (after consent elements are removed)
        const entry = syncResult.entry || core.getPageMarkingEntry(config, location.href);
        entry.fullHTML = document.documentElement.outerHTML;
        entry.title = document.title || location.href;
        config.pageMarkings[location.href] = entry;

        if (shouldPersist) {
          await core.saveConfig(targetBaseUrl, config);
        }

        if (state.baseUrl === targetBaseUrl) {
          state.config = config;
          if (shouldPersist) {
            core.setSavedPageEntry(location.href, entry);
          }
        }
        sendResponse({ ok: true });
      })();

      return true;
    }

    if (message.type === "setPagePatternDraft") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const pagePattern = patterns.normalizePatternValue(message.pagePattern || "");
      const basePattern = patterns.normalizePatternValue(targetBaseUrl);
      if (!targetBaseUrl || !pagePattern) {
        sendResponse({ ok: false });
        return;
      }
      if (!basePattern || !patterns.isPageUrlMatchingPattern(pagePattern, basePattern)) {
        sendResponse({ ok: false });
        return;
      }
      (async () => {
        let config = state.config;
        if (!config || state.baseUrl !== targetBaseUrl) {
          config = await core.loadConfig(targetBaseUrl);
        }
        const pageUrl = location.href;
        const entry = core.getPageMarkingEntry(config, pageUrl);
        entry.pagePattern = pagePattern;
        config.pageMarkings[pageUrl] = entry;
        state.baseUrl = targetBaseUrl;
        state.config = config;
        core.notifyDraftStatus(pageUrl);
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (message.type === "copyPageDataFromStored") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const sourceBaseUrl = message.sourceBaseUrl || "";
      const sourcePageUrl = message.sourcePageUrl || "";
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false, error: "Page data unavailable" });
        return;
      }
      if (!sourceBaseUrl || !sourcePageUrl) {
        sendResponse({ ok: false, error: "Missing source page" });
        return;
      }
      (async () => {
        const sourceConfig = await core.loadConfig(sourceBaseUrl);
        const sourceEntry =
          sourceConfig.pageMarkings && sourceConfig.pageMarkings[sourcePageUrl]
            ? sourceConfig.pageMarkings[sourcePageUrl]
            : null;
        if (!sourceEntry || !Array.isArray(sourceEntry.xpaths)) {
          sendResponse({ ok: false, error: "No stored page data found" });
          return;
        }
        const result = core.copyEntryXpathsToPage(state.config, location.href, sourceEntry);
        core.scheduleRender();
        core.scheduleSnapshotSave();
        core.notifyDraftStatus(location.href);
        sendResponse({ ok: true, copied: result.copied, total: result.total });
      })();
      return true;
    }

    if (message.type === "getPageDraftStatus") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      const pageUrl = location.href;
      const hasEntry = core.hasPageMarkingEntry(state.config, pageUrl);
      const immutableExcluded = core.collectImmutableElements();
      const syncResult = core.syncPageMarkings(state.config, pageUrl, immutableExcluded, {
        allowCreate: hasEntry,
        persist: hasEntry
      });
      const entry = hasEntry ? syncResult.entry : null;
      const savedEntry = core.getSavedPageEntry(pageUrl);
      sendResponse({
        ok: true,
        entry: entry ? core.clonePageEntry(entry) : null,
        savedEntry,
        dirty: !core.areEntriesEquivalent(entry, savedEntry)
      });
      return;
    }

    if (message.type === "setExplicitExclude") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      const xpath = message.xpath || "";
      if (!xpath) {
        sendResponse({ ok: false });
        return;
      }
      const excluded = Boolean(message.excluded);
      const entry = core.getPageMarkingEntry(state.config, location.href);
      const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
      let targetItem = items.find((item) => item && item.xpath === xpath);
      if (!targetItem) {
        targetItem = { xpath, excluded };
        items.push(targetItem);
      } else {
        targetItem.excluded = excluded;
      }
      if (excluded && Array.isArray(entry.includeXpaths)) {
        entry.includeXpaths = entry.includeXpaths.filter((value) => value !== xpath);
      }
      entry.xpaths = items;
      state.config.pageMarkings[location.href] = entry;
      core.scheduleRender();
      core.scheduleSnapshotSave();
      core.notifyDraftStatus(location.href);
      sendResponse({ ok: true, dirty: core.isPageDraftDirty(location.href) });
      return;
    }

    if (message.type === "setExplicitInclude") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      const xpath = message.xpath || "";
      if (!xpath) {
        sendResponse({ ok: false });
        return;
      }
      const included = Boolean(message.included);
      const entry = core.getPageMarkingEntry(state.config, location.href);
      const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
      const existingIndex = includeXpaths.indexOf(xpath);
      if (included) {
        if (existingIndex === -1) {
          includeXpaths.push(xpath);
        }
        const target = core.getElementFromXPath(xpath);
        if (target) {
          const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
          for (let i = items.length - 1; i >= 0; i -= 1) {
            const item = items[i];
            if (!item || !item.xpath || item.xpath === xpath) {
              continue;
            }
            const existingEl = core.getElementFromXPath(item.xpath);
            if (!existingEl) {
              continue;
            }
            if (target.contains(existingEl)) {
              items.splice(i, 1);
            }
          }
          entry.xpaths = items;
          for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
            const childXpath = includeXpaths[i];
            if (!childXpath || childXpath === xpath) {
              continue;
            }
            const existingEl = core.getElementFromXPath(childXpath);
            if (!existingEl) {
              continue;
            }
            if (target.contains(existingEl)) {
              includeXpaths.splice(i, 1);
            }
          }
        }
      } else if (existingIndex >= 0) {
        includeXpaths.splice(existingIndex, 1);
      }
      entry.includeXpaths = includeXpaths;
      state.config.pageMarkings[location.href] = entry;
      core.scheduleRender();
      core.scheduleSnapshotSave();
      core.notifyDraftStatus(location.href);
      sendResponse({ ok: true, dirty: core.isPageDraftDirty(location.href) });
      return;
    }

    if (message.type === "savePageDraft") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      (async () => {
        const pageUrl = location.href;
        if (!core.isPageDraftDirty(pageUrl)) {
          sendResponse({ ok: true, saved: false, dirty: false });
          return;
        }
        const immutableExcluded = core.collectImmutableElements();
        core.syncPageMarkings(state.config, pageUrl, immutableExcluded, {
          allowCreate: true,
          persist: true
        });
        const entry = core.getPageMarkingEntry(state.config, pageUrl);
        entry.fullHTML = document.documentElement.outerHTML;
        entry.title = document.title || pageUrl;
        state.config.pageMarkings[pageUrl] = entry;
        await core.saveConfig(targetBaseUrl, state.config);
        core.setSavedPageEntry(pageUrl, entry);
        core.scheduleRender();
        core.notifyDraftStatus(pageUrl);
        sendResponse({ ok: true, saved: true, dirty: false });
      })();
      return true;
    }

    if (message.type === "revertPageDraft") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      (async () => {
        const pageUrl = location.href;
        const config = await core.loadConfig(targetBaseUrl);
        const storedEntry =
          config.pageMarkings && config.pageMarkings[pageUrl]
            ? config.pageMarkings[pageUrl]
            : null;
        core.setSavedPageEntry(pageUrl, storedEntry);
        if (storedEntry) {
          const immutableExcluded = core.collectImmutableElements();
          core.syncPageMarkings(config, pageUrl, immutableExcluded, {
            allowCreate: true,
            persist: true
          });
        }
        state.baseUrl = targetBaseUrl;
        state.config = config;
        core.scheduleRender();
        core.notifyDraftStatus(pageUrl);
        sendResponse({
          ok: true,
          dirty: core.isPageDraftDirty(pageUrl),
          entry: storedEntry ? core.clonePageEntry(storedEntry) : null
        });
      })();
      return true;
    }

    if (message.type === "deletePageEntry") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      (async () => {
        const pageUrl = location.href;
        core.removePageEntry(state.config, pageUrl);
        const storedConfig = await core.loadConfig(targetBaseUrl);
        core.removePageEntry(storedConfig, pageUrl);
        await core.saveConfig(targetBaseUrl, storedConfig);
        core.setSavedPageEntry(pageUrl, null);
        core.scheduleRender();
        core.notifyDraftStatus(pageUrl);
        sendResponse({ ok: true, dirty: core.isPageDraftDirty(pageUrl) });
      })();
      return true;
    }

    if (message.type === "showAiPreview") {
      const selectors = Array.isArray(message.selectors) ? message.selectors : [];
      const items = core.collectPreviewItems(selectors);
      core.showAiPopover(items);
      sendResponse({ ok: true, count: items.length });
    }

    if (message.type === "setCssHighlight") {
      core.setCssHighlight(message.enabled, message.css || "");
      sendResponse({ ok: true });
    }
  });

  refreshSilentHighlightings().then();
  window.addEventListener("resize", core.scheduleRender);
  window.addEventListener("scroll", core.handleScroll, { passive: true });
  window.addEventListener("beforeunload", core.handleBeforeUnload);
}
