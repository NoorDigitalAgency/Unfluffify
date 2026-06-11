export function createForceRefreshHandler(deps) {
  async function handleMessage() {
    await deps.refreshFromTabState();
    deps.refreshEnabledAiHighlights();
    deps.runPropertyLockSync({ forceSiteIdRefresh: true });
    await deps.refreshSilentHighlightings();
    return { ok: true };
  }

  return {
    handleMessage
  };
}