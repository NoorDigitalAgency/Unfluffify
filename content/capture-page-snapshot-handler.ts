// @ts-nocheck
export function createCapturePageSnapshotHandler(deps) {
  async function capture({ targetBaseUrl, shouldPersist, pageType }) {
    const pageUrl = deps.getPageUrl();
    let config;
    if (deps.matchesActiveBaseUrl(targetBaseUrl) && deps.getActiveConfig()) {
      // Use the in-memory config to preserve any unsaved changes
      config = deps.getActiveConfig();
    } else {
      // Load from storage if it's a different base URL
      config = await deps.loadConfig(targetBaseUrl);
    }

    const allowCreate = shouldPersist;
    const hasEntry = deps.hasPageMarkingEntry(config, pageUrl);
    if (!allowCreate && !hasEntry) {
      return { ok: false };
    }

    // Ensure page entry is synced first, then capture HTML.
    const immutableExcluded = deps.collectImmutableElements();
    const syncResult = deps.syncPageMarkings(config, pageUrl, immutableExcluded, {
      allowCreate,
      persist: allowCreate || hasEntry
    });

    // Now capture the full HTML (after consent elements are removed).
    const entry = syncResult.entry || deps.getPageMarkingEntry(config, pageUrl);
    const snapshot = deps.createCurrentPageSnapshot();
    const rawHtml = await deps.fetchCurrentPageRawHtml(pageUrl);
    entry.renderedHtml = snapshot.renderedHtml;
    entry.pageType =
      (typeof pageType === "string" && pageType) ||
      deps.getCurrentPageType() ||
      entry.pageType;
    entry.rawHtml = typeof rawHtml === "string"
      ? rawHtml
      : typeof entry.rawHtml === "string"
        ? entry.rawHtml
        : "";
    entry.title = deps.getDocumentTitle() || deps.getPageUrl();
    entry.submissionXpaths = deps.collectAiSubmissionXpathsForCurrentPage(config);
    deps.touchPageEntryTimestamp(entry);
    config.pageMarkings[pageUrl] = entry;

    if (shouldPersist) {
      await deps.saveConfig(targetBaseUrl, config);
    }

    if (deps.matchesActiveBaseUrl(targetBaseUrl)) {
      deps.setConfig(config);
      if (shouldPersist) {
        await deps.refreshSavedPageEntryFromBackendCache(targetBaseUrl, pageUrl);
      }
    }
    if (shouldPersist) {
      deps.sendPropertyLockActivity();
    }
    return { ok: true };
  }

  return {
    capture
  };
}