type PageDraftSaveEntry = {
  renderedHtml?: unknown;
  rawHtml?: unknown;
  title?: unknown;
  pageType?: unknown;
  submissionXpaths?: unknown;
  [key: string]: unknown;
};

type PageDraftSaveDeps = {
  getCurrentPageType: () => string;
  getBaseUrl: () => string;
  getConfig: () => { pageMarkings: Record<string, PageDraftSaveEntry> } | null;
  matchesActiveBaseUrl: (baseUrl: string) => boolean;
  showPageToast: (message: string) => void;
  getPageUrl: () => string;
  refreshSavedPageEntryFromBackendCache: (baseUrl: string, pageUrl: string) => Promise<void>;
  getSavedPageEntry: (pageUrl: string) => PageDraftSaveEntry | null;
  getDraftPageEntry: (pageUrl: string) => PageDraftSaveEntry | null;
  areEntriesEquivalent: (a: unknown, b: unknown) => boolean;
  getPageSaveReconciliationState: (pageUrl: string) => unknown;
  hideConsentElements: () => void;
  collectImmutableElements: () => unknown;
  syncPageMarkings: (
    config: { pageMarkings: Record<string, PageDraftSaveEntry> },
    pageUrl: string,
    immutableExcluded: unknown,
    options: { allowCreate: boolean; persist: boolean }
  ) => { changed: boolean };
  getPageMarkingEntry: (config: { pageMarkings: Record<string, PageDraftSaveEntry> }, pageUrl: string) => PageDraftSaveEntry;
  createCurrentPageSnapshot: () => { renderedHtml: unknown };
  collectAiSubmissionXpathsForCurrentPage: () => unknown[];
  fetchCurrentPageRawHtml: (pageUrl: string) => Promise<unknown>;
  submissionXpathsEqual: (a: unknown, b: unknown) => boolean;
  setPageSaveReconciliationPending: (baseUrl: string, pageUrl: string, options: { reason: string }) => Promise<void>;
  touchPageEntryTimestamp: (entry: PageDraftSaveEntry) => void;
  saveConfig: (baseUrl: string, config: { pageMarkings: Record<string, PageDraftSaveEntry> }) => Promise<void>;
  clearPageSaveReconciliation: (baseUrl: string, pageUrl: string) => Promise<void>;
  logContentDiagnostic: (level: string, message: string, error: unknown) => void;
  setSavedPageEntry: (pageUrl: string, entry: PageDraftSaveEntry) => void;
  scheduleRender: () => void;
  notifyDraftStatus: (pageUrl: string) => void;
  getDocumentTitle: () => string;
};

export function createPageDraftSaveHandler(deps: PageDraftSaveDeps) {
  async function saveCurrentPageDraft(options: {
    baseUrl?: string;
    pageType?: string;
    showToast?: boolean;
  } | null | undefined) {
    const { baseUrl, pageType = "", showToast = false } = options || {};
    const resolvedPageType = typeof pageType === "string" && pageType
      ? pageType
      : deps.getCurrentPageType() || "";
    const targetBaseUrl = baseUrl || deps.getBaseUrl() || "";
    const config = deps.getConfig();
    if (!targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !config) {
      if (showToast) {
        deps.showPageToast("Enable marking to save this page.");
      }
      return { ok: false };
    }
    const pageUrl = deps.getPageUrl();
    await deps.refreshSavedPageEntryFromBackendCache(targetBaseUrl, pageUrl);
    const savedEntry = deps.getSavedPageEntry(pageUrl);
    const draftEntry = deps.getDraftPageEntry(pageUrl);
    const draftEntryChanged = !deps.areEntriesEquivalent(draftEntry, savedEntry);
    const reconciliation = deps.getPageSaveReconciliationState(pageUrl);
    const reconciliationPending = Boolean(reconciliation);
    const hasSavedEntry = Boolean(savedEntry);
    const savedEntryHasAiSubmissionData = Boolean(
      savedEntry &&
      typeof savedEntry.renderedHtml === "string" &&
      savedEntry.renderedHtml &&
      Array.isArray(savedEntry.submissionXpaths) &&
      savedEntry.submissionXpaths.length > 0
    );
    deps.hideConsentElements();
    const immutableExcluded = deps.collectImmutableElements();
    const syncResult = deps.syncPageMarkings(config, pageUrl, immutableExcluded, {
      allowCreate: true,
      persist: true
    });
    const entry = deps.getPageMarkingEntry(config, pageUrl);
    const currentSnapshot = deps.createCurrentPageSnapshot();
    const currentRenderedHtml = currentSnapshot.renderedHtml;
    const currentSubmissionXpaths = deps.collectAiSubmissionXpathsForCurrentPage();
    const currentRawHtml = await deps.fetchCurrentPageRawHtml(pageUrl);
    const savedEntryMatchesCurrentSnapshot = Boolean(
      savedEntry &&
      savedEntry.renderedHtml === currentRenderedHtml &&
      (
        currentRawHtml === null ||
        (typeof savedEntry.rawHtml === "string" ? savedEntry.rawHtml : "") === currentRawHtml
      ) &&
      deps.submissionXpathsEqual(savedEntry.submissionXpaths, currentSubmissionXpaths)
    );
    if (
      !syncResult.changed &&
      !draftEntryChanged &&
      !reconciliationPending &&
      hasSavedEntry &&
      savedEntryHasAiSubmissionData &&
      savedEntryMatchesCurrentSnapshot
    ) {
      if (showToast) {
        deps.showPageToast("No changes to save");
      }
      return { ok: true, saved: false, dirty: false };
    }
    if (
      !syncResult.changed &&
      reconciliationPending &&
      !draftEntryChanged &&
      hasSavedEntry &&
      savedEntryHasAiSubmissionData &&
      savedEntryMatchesCurrentSnapshot
    ) {
      if (showToast) {
        deps.showPageToast("Server sync pending");
      }
      return { ok: true, saved: true, dirty: true, reconciliationPending: true };
    }
    const hadReconciliationPending = reconciliationPending;
    try {
      if (!hadReconciliationPending) {
        await deps.setPageSaveReconciliationPending(targetBaseUrl, pageUrl, { reason: "saving" });
      }
      entry.renderedHtml = currentRenderedHtml;
      entry.rawHtml = typeof currentRawHtml === "string"
        ? currentRawHtml
        : typeof entry.rawHtml === "string"
          ? entry.rawHtml
          : "";
      const documentTitle = deps.getDocumentTitle();
      entry.title =
        typeof documentTitle === "string" &&
        documentTitle.trim() &&
        documentTitle.trim() !== pageUrl
          ? documentTitle.trim()
          : "";
      entry.pageType = resolvedPageType || entry.pageType;
      entry.submissionXpaths = currentSubmissionXpaths;
      deps.touchPageEntryTimestamp(entry);
      config.pageMarkings[pageUrl] = entry;
      await deps.saveConfig(targetBaseUrl, config);
    } catch (_error) {
      if (!hadReconciliationPending) {
        try {
          await deps.clearPageSaveReconciliation(targetBaseUrl, pageUrl);
        } catch (clearError) {
          deps.logContentDiagnostic(
            "warn",
            "Failed to clear page-save reconciliation after save failure",
            clearError
          );
        }
      }
      if (showToast) {
        deps.showPageToast("Unable to save page");
      }
      return { ok: false };
    }
    deps.setSavedPageEntry(pageUrl, entry);
    try {
      await deps.setPageSaveReconciliationPending(targetBaseUrl, pageUrl, { reason: "pending" });
    } catch (_error) {
      if (showToast) {
        deps.showPageToast("Unable to track server sync for saved page");
      }
      return { ok: false };
    }
    deps.scheduleRender();
    deps.notifyDraftStatus(pageUrl);
    if (showToast) {
      deps.showPageToast("Page saved locally; server sync pending");
    }
    return {
      ok: true,
      saved: true,
      dirty: true,
      reconciliationPending: true
    };
  }

  return {
    saveCurrentPageDraft
  };
}
