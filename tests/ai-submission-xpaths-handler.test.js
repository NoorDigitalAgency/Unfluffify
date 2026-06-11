import test from "node:test";
import assert from "node:assert/strict";

import { createAiSubmissionXpathsHandler } from "../content/ai-submission-xpaths-handler.js";

test("ai submission xpaths handler returns collected xpaths", () => {
  const xpaths = ["//form", "//button[@type='submit']"];
  const handler = createAiSubmissionXpathsHandler({
    collectAiSubmissionXpathsForCurrentPage: () => xpaths
  });

  const response = handler.handleMessage();

  assert.equal(response.xpaths, xpaths);
});
