import type { XpathEntry } from "../types/config.ts";

type AiSubmissionXpathsDeps = {
  collectAiSubmissionXpathsForCurrentPage: () => XpathEntry[];
};

export function createAiSubmissionXpathsHandler(deps: AiSubmissionXpathsDeps) {
  function handleMessage(): { xpaths: XpathEntry[] } {
    return {
      xpaths: deps.collectAiSubmissionXpathsForCurrentPage()
    };
  }

  return {
    handleMessage
  };
}
