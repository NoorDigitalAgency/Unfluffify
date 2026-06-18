type AiPreviewCloseDeps = {
  isAiPreviewActive: () => boolean;
  hasAiPopover: () => boolean;
  requestAiPopoverClose: () => void;
  exitAiPreviewMode: () => Promise<void>;
};

export function createAiPreviewCloseHandler(deps: AiPreviewCloseDeps) {
  async function handleMessage(): Promise<{ ok: true; active: false }> {
    if (!deps.isAiPreviewActive()) {
      return { ok: true, active: false };
    }

    if (deps.hasAiPopover()) {
      deps.requestAiPopoverClose();
      return { ok: true, active: false };
    }

    await deps.exitAiPreviewMode();
    return { ok: true, active: false };
  }

  return {
    handleMessage
  };
}
