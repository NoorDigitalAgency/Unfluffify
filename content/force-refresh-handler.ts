type ForceRefreshDeps = {
  refreshFromTabState: () => Promise<void>;
  refreshEnabledAiHighlights: () => void;
  runPropertyLockSync: (options: { forceSiteIdRefresh: boolean }) => void;
  refreshSilentHighlightings: () => Promise<void>;
};

export function createForceRefreshHandler(deps: ForceRefreshDeps) {
  async function handleMessage(): Promise<{ ok: true }> {
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