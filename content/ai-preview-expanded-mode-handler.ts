type AiPreviewExpandedModeDeps = {
  isPreviewExpandedStatesEnabled: () => boolean;
  setAiPreviewExpandedMode: (active: boolean) => unknown;
  buildExpandedModeDisabledResponse: () => unknown;
  buildExpandedModeResponse: (updated: unknown) => unknown;
};

type ExpandedModeMessage = {
  active?: unknown;
};

export function createAiPreviewExpandedModeHandler(deps: AiPreviewExpandedModeDeps) {
  function handleMessage(message: ExpandedModeMessage = {}): unknown {
    if (!deps.isPreviewExpandedStatesEnabled()) {
      deps.setAiPreviewExpandedMode(false);
      return deps.buildExpandedModeDisabledResponse();
    }

    const updated = deps.setAiPreviewExpandedMode(Boolean(message.active));
    return deps.buildExpandedModeResponse(updated);
  }

  return {
    handleMessage
  };
}
