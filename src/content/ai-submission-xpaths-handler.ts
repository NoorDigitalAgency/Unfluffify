type AiSubmissionXpathsDeps = {
  collectAiSubmissionXpathsForCurrentPage: () => string[];
};

export function createAiSubmissionXpathsHandler(deps: AiSubmissionXpathsDeps) {
  function handleMessage(): { xpaths: string[] } {
    return {
      xpaths: deps.collectAiSubmissionXpathsForCurrentPage()
    };
  }

  return {
    handleMessage
  };
}
