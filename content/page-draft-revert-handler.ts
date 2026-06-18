type PageDraftRevertDeps = {
  getPageUrl: () => string;
  loadConfig: (targetBaseUrl: unknown) => Promise<{ pageMarkings?: Record<string, unknown> }>;
  setSavedPageEntry: (pageUrl: string, entry: unknown) => void;
  collectImmutableElements: () => unknown;
  syncPageMarkings: (
    config: unknown,
    pageUrl: string,
    immutableExcluded: unknown,
    options: { allowCreate: boolean; persist: boolean }
  ) => void;
  setBaseUrl: (targetBaseUrl: unknown) => void;
  setConfig: (config: unknown) => void;
  scheduleRender: () => void;
  notifyDraftStatus: (pageUrl: string) => void;
  isPageDraftDirty: (pageUrl: string) => boolean;
  getSavedPageEntry: (pageUrl: string) => unknown;
};

type RevertArgs = {
  targetBaseUrl?: unknown;
};

export function createPageDraftRevertHandler(deps: PageDraftRevertDeps) {
  async function revert({ targetBaseUrl }: RevertArgs): Promise<{ ok: true; dirty: boolean; entry: unknown }> {
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
