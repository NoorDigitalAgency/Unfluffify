export function createAiPreviewExpandedModeHandler(deps) {
  function handleMessage(message = {}) {
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
