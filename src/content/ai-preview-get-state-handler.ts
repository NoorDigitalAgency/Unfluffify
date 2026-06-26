type AiPreviewGetStateDeps = {
  buildGetStateResponse: () => unknown;
};

export function createAiPreviewGetStateHandler(deps: AiPreviewGetStateDeps) {
  function handleMessage(): unknown {
    return deps.buildGetStateResponse();
  }

  return {
    handleMessage
  };
}
