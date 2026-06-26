type PageSaveReconciliationClearDeps = {
  getPageUrl: () => string;
  clearPageSaveReconciliation: (targetBaseUrl: unknown, pageUrl: unknown) => Promise<void>;
  refreshPageSaveReconciliation: (targetBaseUrl: unknown, pageUrl: string) => Promise<void>;
  loadConfig: (targetBaseUrl: unknown) => Promise<unknown>;
  getBackendSavedPageMarkings: (targetBaseUrl: unknown) => Promise<unknown>;
  findPageMarkingEntry: (data: { pageMarkings: unknown }, pageUrl: string, targetBaseUrl: unknown) => unknown;
  setConfig: (config: unknown) => void;
  setSavedPageEntry: (pageUrl: string, entry: unknown) => void;
  scheduleRender: () => void;
  notifyDraftStatus: (pageUrl: string) => void;
  clonePageEntry: (entry: unknown) => unknown;
};

type ClearArgs = {
  targetBaseUrl?: unknown;
  pageUrl?: unknown;
};

export function createPageSaveReconciliationClearHandler(deps: PageSaveReconciliationClearDeps) {
  async function clear({ targetBaseUrl, pageUrl }: ClearArgs): Promise<{ ok: true; entry: unknown | null }> {
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