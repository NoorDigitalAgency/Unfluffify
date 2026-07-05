type CapturePageEntry = {
  renderedHtml?: unknown;
  pageType?: unknown;
  rawHtml?: unknown;
  title?: unknown;
  submissionXpaths?: unknown;
  [key: string]: unknown;
};

type CapturePageConfig = {
  pageMarkings: Record<string, CapturePageEntry>;
};

type CapturePageSnapshotDeps = {
  getPageUrl: () => string;
  matchesActiveBaseUrl: (targetBaseUrl: unknown) => boolean;
  getActiveConfig: () => CapturePageConfig | null;
  loadConfig: (targetBaseUrl: unknown) => Promise<CapturePageConfig>;
  hasPageMarkingEntry: (config: CapturePageConfig, pageUrl: string) => boolean;
  collectImmutableElements: () => unknown;
  syncPageMarkings: (
    config: CapturePageConfig,
    pageUrl: string,
    immutableExcluded: unknown,
    options: { allowCreate: boolean; persist: boolean }
  ) => { entry: CapturePageEntry | null };
  getPageMarkingEntry: (config: CapturePageConfig, pageUrl: string) => CapturePageEntry;
  createCurrentPageSnapshot: () => { renderedHtml: unknown };
  fetchCurrentPageRawHtml: (pageUrl: string) => Promise<unknown>;
  getCurrentPageType: () => unknown;
  getDocumentTitle: () => string;
  collectAiSubmissionXpathsForCurrentPage: (config: CapturePageConfig) => unknown;
  touchPageEntryTimestamp: (entry: CapturePageEntry) => void;
  saveConfig: (targetBaseUrl: unknown, config: CapturePageConfig) => Promise<void>;
  setConfig: (config: CapturePageConfig) => void;
  refreshSavedPageEntryFromBackendCache: (targetBaseUrl: unknown, pageUrl: string) => Promise<void>;
  clearUserMarkingEdit: (pageUrl: string) => void;
  sendPropertyLockActivity: () => void;
};

type CaptureArgs = {
  targetBaseUrl?: unknown;
  shouldPersist?: unknown;
  pageType?: unknown;
};

// S6 harden (debug round): the raw-HTML fetch must never consume the whole
// snapshot-capture budget (its content-message deadline upstream) — a slow or
// hanging origin made the AI run fail with a raw "Content message timed out".
// Past this deadline the capture proceeds with the entry's previous rawHtml
// (the null fallback below already tolerates a missing fetch result).
const RAW_HTML_CAPTURE_DEADLINE_MS = 30_000;

export function createCapturePageSnapshotHandler(deps: CapturePageSnapshotDeps) {
  async function capture({ targetBaseUrl, shouldPersist, pageType }: CaptureArgs): Promise<{ ok: boolean }> {
    const pageUrl = deps.getPageUrl();
    let config: CapturePageConfig;
    if (deps.matchesActiveBaseUrl(targetBaseUrl) && deps.getActiveConfig()) {
      // Use the in-memory config to preserve any unsaved changes
      config = deps.getActiveConfig() as CapturePageConfig;
    } else {
      // Load from storage if it's a different base URL
      config = await deps.loadConfig(targetBaseUrl);
    }

    const allowCreate = Boolean(shouldPersist);
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
    const rawHtml = await Promise.race([
      deps.fetchCurrentPageRawHtml(pageUrl),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), RAW_HTML_CAPTURE_DEADLINE_MS);
      })
    ]);
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
      // The AI run captured the current markings as its baseline, so any prior
      // user edit for this page is now "up to date" — clear the deterministic
      // dirty flag so the post-run session is READY_TO_SAVE (not requires_ai_run).
      deps.clearUserMarkingEdit(pageUrl);
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