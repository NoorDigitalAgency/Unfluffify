type PageDraftStatusEntry = {
  submissionXpaths?: unknown[];
  [key: string]: unknown;
};

type PageDraftStatusDeps = {
  getPageUrl: () => string;
  refreshSavedPageEntryFromBackendCache: (targetBaseUrl: unknown, pageUrl: string) => Promise<void>;
  getConfig: () => unknown;
  hasPageMarkingEntry: (config: unknown, pageUrl: string) => boolean;
  getSavedPageEntry: (pageUrl: string) => unknown;
  getDraftPageEntry: (pageUrl: string) => unknown;
  areEntriesEquivalent: (draftEntry: unknown, savedEntry: unknown) => boolean;
  collectImmutableElements: () => unknown;
  syncPageMarkings: (
    config: unknown,
    pageUrl: string,
    immutableExcluded: unknown,
    options: { allowCreate: boolean; persist: boolean }
  ) => { entry: PageDraftStatusEntry | null; changed: boolean };
  setSavedPageEntry: (pageUrl: string, entry: PageDraftStatusEntry) => void;
  getPageSaveReconciliationState: (pageUrl: string) => unknown;
  submissionXpathsEqual: (a: unknown[], b: unknown[]) => boolean;
  collectAiSubmissionXpathsForCurrentPage: () => unknown[];
  clonePageEntry: (entry: PageDraftStatusEntry) => PageDraftStatusEntry;
  getPageDraftDirty: (pageUrl: string) => boolean;
  getPageSaveReconciliationPending: (pageUrl: string) => boolean;
};

type PageDraftStatusMessage = {
  targetBaseUrl?: unknown;
};

export function createPageDraftStatusHandler(deps: PageDraftStatusDeps) {
  async function getStatus({ targetBaseUrl }: PageDraftStatusMessage): Promise<{
    ok: true;
    entry: PageDraftStatusEntry | null;
    savedEntry: unknown;
    dirty: boolean;
    reconciliation: unknown;
    reconciliationPending: boolean;
  }> {
    const pageUrl = deps.getPageUrl();
    await deps.refreshSavedPageEntryFromBackendCache(targetBaseUrl, pageUrl);
    const config = deps.getConfig();
    const hasEntry = deps.hasPageMarkingEntry(config, pageUrl);
    const savedEntryBeforeSync = deps.getSavedPageEntry(pageUrl);
    const draftEntryBeforeSync = deps.getDraftPageEntry(pageUrl);
    const wasClean =
      hasEntry && deps.areEntriesEquivalent(draftEntryBeforeSync, savedEntryBeforeSync);
    const immutableExcluded = deps.collectImmutableElements();
    const syncResult = deps.syncPageMarkings(config, pageUrl, immutableExcluded, {
      allowCreate: hasEntry,
      persist: hasEntry
    });
    const entry = hasEntry ? syncResult.entry : null;

    if (hasEntry && wasClean && syncResult.changed && entry) {
      deps.setSavedPageEntry(pageUrl, entry);
    }

    const savedEntry = deps.getSavedPageEntry(pageUrl);
    const reconciliation = deps.getPageSaveReconciliationState(pageUrl);
    // Submission-xpath staleness only signals a discardable change when the
    // entry already carries submission data from a prior AI run/save. On a
    // freshly enabled page the entry has no submissionXpaths yet, while the
    // live page always reports submittable xpaths; comparing the two would
    // otherwise mark the pristine page dirty and wrongly enable Discard.
    const entrySubmissionXpaths =
      entry && Array.isArray(entry.submissionXpaths) ? entry.submissionXpaths : [];
    const submissionXpathsStale = Boolean(
      hasEntry &&
      entry &&
      entrySubmissionXpaths.length > 0 &&
      !deps.submissionXpathsEqual(
        entrySubmissionXpaths,
        deps.collectAiSubmissionXpathsForCurrentPage()
      )
    );

    return {
      ok: true,
      entry: entry ? deps.clonePageEntry(entry) : null,
      savedEntry,
      dirty: deps.getPageDraftDirty(pageUrl) || submissionXpathsStale,
      reconciliation,
      reconciliationPending: deps.getPageSaveReconciliationPending(pageUrl)
    };
  }

  return {
    getStatus
  };
}