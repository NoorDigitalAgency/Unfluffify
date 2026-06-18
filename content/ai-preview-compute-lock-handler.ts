type AiPreviewComputeLockDeps = {
  beginAiPreviewMode: (options: { mode: string }) => void;
  setAiPreviewItems: (items: unknown[]) => void;
  scheduleAiComputeLockRelease: (expiresAt: number) => void;
  refreshSilentHighlightings: () => Promise<unknown>;
  isComputeLockPreviewActive: () => boolean;
  exitAiPreviewMode: () => Promise<void>;
  hasComputeLockReleaseTimer: () => boolean;
  clearComputeLockReleaseTimer: () => void;
};

type ComputeLockMessage = {
  active?: boolean;
  expiresAt?: number | null;
};

export function createAiPreviewComputeLockHandler(deps: AiPreviewComputeLockDeps) {
  async function handleMessage(message: ComputeLockMessage = {}): Promise<{ ok: true; active: boolean }> {
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
