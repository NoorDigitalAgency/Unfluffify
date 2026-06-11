export function createAiPreviewGetStateHandler(deps) {
  function handleMessage() {
    return deps.buildGetStateResponse();
  }

  return {
    handleMessage
  };
}
