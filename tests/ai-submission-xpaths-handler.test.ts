import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createAiSubmissionXpathsHandler } from "../src/content/ai-submission-xpaths-handler.js";

test("ai submission xpaths handler returns collected xpaths", () => {
  const xpaths = ["//form", "//button[@type='submit']"];
  const handler = createAiSubmissionXpathsHandler({
    collectAiSubmissionXpathsForCurrentPage: () => xpaths
  });

  const response = handler.handleMessage();

  assert.equal(response.xpaths, xpaths);
});
