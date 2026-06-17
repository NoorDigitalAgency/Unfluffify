// @ts-nocheck
export function createAiPreviewComputeLockHandler(deps) {
  async function handleMessage(message = {}) {
    if (message.active) {
      deps.beginAiPreviewMode({ mode: "compute_lock" });
      deps.setAiPreviewItems([]);
      deps.scheduleAiComputeLockRelease(Number(message.expiresAt) || 0);
      deps.refreshSilentHighlightings().then();
      return { ok: true, active: true };
    }

    if (deps.isComputeLockPreviewActive()) {
      await deps.exitAiPreviewMode();
    } else if (deps.hasComputeLockReleaseTimer()) {
      deps.clearComputeLockReleaseTimer();
    }

    return { ok: true, active: false };
  }

  return {
    handleMessage
  };
}
