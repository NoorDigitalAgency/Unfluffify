export function createPageDraftRevertHandler(deps) {
  async function revert({ targetBaseUrl }) {
    const pageUrl = deps.getPageUrl();
    const config = await deps.loadConfig(targetBaseUrl);
    const storedEntry =
      config.pageMarkings && config.pageMarkings[pageUrl]
        ? config.pageMarkings[pageUrl]
        : null;
    deps.setSavedPageEntry(pageUrl, storedEntry);
    if (storedEntry) {
      const immutableExcluded = deps.collectImmutableElements();
      deps.syncPageMarkings(config, pageUrl, immutableExcluded, {
        allowCreate: true,
        persist: true
      });
    }
    deps.setBaseUrl(targetBaseUrl);
    deps.setConfig(config);
    deps.scheduleRender();
    deps.notifyDraftStatus(pageUrl);
    return {
      ok: true,
      dirty: deps.isPageDraftDirty(pageUrl),
      entry: deps.getSavedPageEntry(pageUrl)
    };
  }

  return {
    revert
  };
}
