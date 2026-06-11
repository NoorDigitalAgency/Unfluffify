export function createPageSaveReconciliationClearHandler(deps) {
  async function clear({ targetBaseUrl, pageUrl }) {
    const currentPageUrl = deps.getPageUrl();
    await deps.clearPageSaveReconciliation(targetBaseUrl, pageUrl);
    await deps.refreshPageSaveReconciliation(targetBaseUrl, currentPageUrl);
    const refreshedConfig = await deps.loadConfig(targetBaseUrl);
    const backendSavedPageMarkings = await deps.getBackendSavedPageMarkings(targetBaseUrl);
    const storedEntry = deps.findPageMarkingEntry(
      { pageMarkings: backendSavedPageMarkings },
      currentPageUrl,
      targetBaseUrl
    );

    deps.setConfig(refreshedConfig);
    deps.setSavedPageEntry(currentPageUrl, storedEntry || null);
    deps.scheduleRender();
    deps.notifyDraftStatus(currentPageUrl);

    return {
      ok: true,
      entry: storedEntry ? deps.clonePageEntry(storedEntry) : null
    };
  }

  return {
    clear
  };
}