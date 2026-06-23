type AiPreviewCloseDeps = {
  isAiPreviewActive: () => boolean;
  hasAiPopover: () => boolean;
  requestAiPopoverClose: (options?: { closeToken?: number }) => void;
  exitAiPreviewMode: () => Promise<unknown>;
};

export function createAiPreviewCloseHandler(deps: AiPreviewCloseDeps) {
  async function handleMessage(message: { previewRestoreToken?: unknown } = {}): Promise<{ ok: true; active: false; previewRestoreToken?: number | null }> {
    const closeToken = Number.isFinite(message.previewRestoreToken)
      ? Math.trunc(Number(message.previewRestoreToken))
      : null;
    if (!deps.isAiPreviewActive()) {
      return { ok: true, active: false, previewRestoreToken: closeToken };
    }

    if (deps.hasAiPopover()) {
      deps.requestAiPopoverClose({ closeToken: closeToken ?? undefined });
      return { ok: true, active: false, previewRestoreToken: closeToken };
    }

    const closeState = await deps.exitAiPreviewMode();
    return {
      ok: true,
      active: false,
      previewRestoreToken: closeToken,
      ...(closeState && typeof closeState === "object" ? closeState : {})
    };
  }

  return {
    handleMessage
  };
}
