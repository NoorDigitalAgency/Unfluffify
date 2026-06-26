type AiPreviewCloseDeps = {
  isAiPreviewActive: () => boolean;
  hasAiPopover: () => boolean;
  requestAiPopoverClose: (options?: { closeToken?: number }) => Promise<unknown>;
  exitAiPreviewMode: () => Promise<unknown>;
};

export function createAiPreviewCloseHandler(deps: AiPreviewCloseDeps) {
  async function handleMessage(message: { previewRestoreToken?: unknown } = {}): Promise<{ ok: true; active: false; previewRestoreToken?: number | null } & Record<string, unknown>> {
    const closeToken = Number.isFinite(message.previewRestoreToken)
      ? Math.trunc(Number(message.previewRestoreToken))
      : null;
    const buildCloseResponse = (closeState: unknown = null): { ok: true; active: false; previewRestoreToken: number | null } & Record<string, unknown> => ({
      ...(closeState && typeof closeState === "object" ? closeState : {}),
      ok: true,
      active: false,
      previewRestoreToken: closeToken
    });
    if (!deps.isAiPreviewActive()) {
      return buildCloseResponse();
    }

    if (deps.hasAiPopover()) {
      const closeState = await deps.requestAiPopoverClose({ closeToken: closeToken ?? undefined });
      return buildCloseResponse(closeState);
    }

    const closeState = await deps.exitAiPreviewMode();
    return buildCloseResponse(closeState);
  }

  return {
    handleMessage
  };
}
