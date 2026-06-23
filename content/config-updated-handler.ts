type ConfigUpdatedEntry = {
  pageType?: unknown;
  [key: string]: unknown;
};

type ConfigUpdatedHandlerDeps = {
  loadConfig: (baseUrl: string) => Promise<unknown>;
  setConfig: (config: unknown) => void;
  getPageUrl: () => string;
  getBaseUrl: () => string;
  getDraftPageEntry: (pageUrl: string) => unknown;
  getSavedPageEntry: (pageUrl: string) => unknown;
  getBackendSavedPageMarkings: (baseUrl: string) => Promise<unknown>;
  findPageMarkingEntry: (config: unknown, pageUrl: string, baseUrl: string) => ConfigUpdatedEntry | null;
  mergeDraftEntry: (loadedConfig: unknown, pageUrl: string, draftEntry: unknown, savedEntry: unknown) => void;
  setSavedPageEntry: (pageUrl: string, entry: ConfigUpdatedEntry | null) => void;
  setCurrentPageType: (pageType: string) => void;
  getCurrentPageType: () => string;
  clearPageSaveReconciliation: (baseUrl: string, pageUrl: string) => Promise<void>;
  clearPageDraftBaseline: (pageUrl: string) => void;
  refreshPageSaveReconciliation: (baseUrl: string, pageUrl: string) => Promise<unknown>;
  refreshEnabledAiHighlights: () => void;
  runPropertyLockSync: (options: { forceSiteIdRefresh: boolean }) => void;
  scheduleRender: () => void;
  notifyDraftStatus: (pageUrl: string) => void;
  clearAiPreviewState: () => void;
  disable: () => void;
  refreshSilentHighlightings: () => Promise<unknown>;
  isAiPreviewActive: () => boolean;
  isEnabled: () => boolean;
  sameBaseUrl: (a: unknown, b: unknown) => boolean;
};

type ConfigUpdatedMessage = {
  baseUrl?: string;
  forceReloadPageEntry?: unknown;
};

export function createConfigUpdatedHandler(deps: ConfigUpdatedHandlerDeps) {
  function handleAiPreviewUpdate(message: ConfigUpdatedMessage) {
    if (!message.baseUrl) {
      return { ok: true };
    }
    return deps.loadConfig(message.baseUrl)
      .then((loadedConfig) => {
        deps.setConfig(loadedConfig);
        return { ok: true };
      })
      .catch(() => ({ ok: false }));
  }

  function handleEnabledSameBaseUpdate(message: ConfigUpdatedMessage): Promise<{ ok: boolean }> {
    const pageUrl = deps.getPageUrl();
    const baseUrl = deps.getBaseUrl();
    const draftEntry = deps.getDraftPageEntry(pageUrl);
    const savedEntry = deps.getSavedPageEntry(pageUrl);
    const forceReloadPageEntry = Boolean(message.forceReloadPageEntry);

    // Respond only AFTER the draft merge/reseed has fully settled so the
    // popup's follow-up getPageDraftStatus reads the final markings entry.
    // Responding early made post-AI-run fingerprint capture race the reshaped
    // entry, which broke State C (Run AI wrongly re-enabled, Save disabled).
    return deps.loadConfig(baseUrl)
      .then(async (loadedConfig) => {
        const backendSavedPageMarkings = await deps.getBackendSavedPageMarkings(baseUrl);
        const backendEntry = deps.findPageMarkingEntry(
          { pageMarkings: backendSavedPageMarkings },
          pageUrl,
          baseUrl
        );
        const loadedEntry = deps.findPageMarkingEntry(loadedConfig, pageUrl, baseUrl);
        if (!forceReloadPageEntry) {
          deps.mergeDraftEntry(loadedConfig, pageUrl, draftEntry, savedEntry);
        } else {
          const reloadedEntry = backendEntry || loadedEntry || null;
          if (reloadedEntry) {
            await deps.refreshPageSaveReconciliation(baseUrl, pageUrl);
          } else {
            await deps.clearPageSaveReconciliation(baseUrl, pageUrl);
            deps.clearPageDraftBaseline(pageUrl);
          }
          deps.setSavedPageEntry(pageUrl, reloadedEntry);
          const nextPageType =
            (reloadedEntry && typeof reloadedEntry.pageType === "string" && reloadedEntry.pageType) ||
            deps.getCurrentPageType() ||
            "";
          deps.setCurrentPageType(nextPageType);
        }
        if (!forceReloadPageEntry) {
          deps.setSavedPageEntry(pageUrl, backendEntry || null);
        }
        deps.setConfig(loadedConfig);
        deps.refreshEnabledAiHighlights();
        if (forceReloadPageEntry) {
          deps.scheduleRender();
          deps.notifyDraftStatus(pageUrl);
        }
      })
      .then(() => {
        deps.runPropertyLockSync({ forceSiteIdRefresh: true });
        return { ok: true };
      })
      .catch(() => {
        deps.runPropertyLockSync({ forceSiteIdRefresh: true });
        return { ok: true };
      });
  }

  function handleOutOfScopeUpdate(): { ok: true } {
    deps.clearAiPreviewState();
    if (deps.isEnabled()) {
      deps.disable();
    }
    deps.refreshSilentHighlightings().then();
    deps.runPropertyLockSync({ forceSiteIdRefresh: true });
    return { ok: true };
  }

  function handleMessage(message: ConfigUpdatedMessage = {}) {
    if (deps.isAiPreviewActive()) {
      return handleAiPreviewUpdate(message);
    }
    if (deps.isEnabled() && deps.sameBaseUrl(message.baseUrl, deps.getBaseUrl())) {
      return handleEnabledSameBaseUpdate(message);
    }
    return handleOutOfScopeUpdate();
  }

  return {
    handleMessage
  };
}
