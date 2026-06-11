export function createAiSubmissionXpathsHandler(deps) {
  function handleMessage() {
    return {
      xpaths: deps.collectAiSubmissionXpathsForCurrentPage()
    };
  }

  return {
    handleMessage
  };
}
