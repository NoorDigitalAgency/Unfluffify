export function createAiPreviewCloseHandler(deps) {
  async function handleMessage() {
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
