export function createDefaultExclusionsHandler(deps) {
  function handleMessage() {
    return {
      immutableSelectors: deps.getImmutableSelectors()
    };
  }

  return {
    handleMessage
  };
}
