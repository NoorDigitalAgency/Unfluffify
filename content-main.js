import * as patterns from "./common/patterns.js";
import * as core from "./content/core.js";
import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "./common/constants.js";

const { state } = core;

export function main() {
  if (state.initialized) {
    return;
  }
  state.initialized = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "setEnabled") {
      if (message.enabled) {
        core.enableForBaseUrl(message.baseUrl, { pagePattern: message.pagePattern }).then();
      } else {
        core.disable();
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
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "forceRefresh") {
      core.refreshFromTabState().then(() => {
        sendResponse({ ok: true });
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
      const selectors = [];
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
          if (core.isHeadingElement(ancestor)) {
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
      entry.xpaths = items;
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
  });

  window.addEventListener("resize", core.scheduleRender);
  window.addEventListener("scroll", core.handleScroll, { passive: true });
  window.addEventListener("beforeunload", core.handleBeforeUnload);
}
