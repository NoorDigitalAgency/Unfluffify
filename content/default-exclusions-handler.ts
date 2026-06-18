type DefaultExclusionsDeps = {
  getImmutableSelectors: () => string[];
};

export function createDefaultExclusionsHandler(deps: DefaultExclusionsDeps) {
  function handleMessage(): { immutableSelectors: string[] } {
    return {
      immutableSelectors: deps.getImmutableSelectors()
    };
  }

  return {
    handleMessage
  };
}
