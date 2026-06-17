// @ts-nocheck
export function createConfigUpdatedHandler(deps) {
  function handleAiPreviewUpdate(message) {
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

  function handleEnabledSameBaseUpdate(message) {
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
          deps.setSavedPageEntry(pageUrl, reloadedEntry);
          deps.setCurrentPageType(
            (reloadedEntry && reloadedEntry.pageType) || deps.getCurrentPageType() || ""
          );
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

  function handleOutOfScopeUpdate() {
    deps.clearAiPreviewState();
    deps.disable();
    deps.refreshSilentHighlightings().then();
    deps.runPropertyLockSync({ forceSiteIdRefresh: true });
    return { ok: true };
  }

  function handleMessage(message = {}) {
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
