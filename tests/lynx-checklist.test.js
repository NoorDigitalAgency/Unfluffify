import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLynxChecklistViewModel,
  createInitialLynxChecklistState
} from "../popup/lynx-checklist.js";

const markedPages = [
  { url: "https://example.com/", title: "Home" },
  { url: "https://example.com/article", title: "Article" },
  { url: "https://example.com/listing", title: "Listing" }
];

test("requires the AI confirmation before sending", () => {
  const checklist = buildLynxChecklistViewModel({ markedPages });

  assert.equal(checklist.canSend, false);
  assert.deepEqual(checklist.blockingReason, { code: "ai_unanswered" });
});

test("locks the checklist to the first yes answer until a marked page is chosen", () => {
  const initial = createInitialLynxChecklistState();
  initial.aiAnswer = "yes";
  initial.pageTypes.homepage.decision = "yes";

  const checklist = buildLynxChecklistViewModel({
    ...initial,
    markedPages
  });

  assert.equal(checklist.firstPendingSelectionKey, "homepage");
  assert.equal(checklist.aiQuestionDisabled, true);
  assert.equal(checklist.pageTypes.find((item) => item.key === "homepage").inputsDisabled, false);
  assert.equal(checklist.pageTypes.find((item) => item.key === "articlePage").inputsDisabled, true);
  assert.deepEqual(checklist.blockingReason, {
    code: "page_type_selection_required",
    pageTypeKey: "homepage"
  });
});

test("removes already assigned marked pages from other page-type dropdowns", () => {
  const initial = createInitialLynxChecklistState();
  initial.aiAnswer = "yes";
  initial.pageTypes.homepage = {
    decision: "yes",
    selectedPageUrl: "https://example.com/"
  };
  initial.pageTypes.articlePage = {
    decision: "yes",
    selectedPageUrl: ""
  };

  const checklist = buildLynxChecklistViewModel({
    ...initial,
    markedPages
  });
  const articlePage = checklist.pageTypes.find((item) => item.key === "articlePage");

  assert.deepEqual(
    articlePage.availableOptions.map((item) => item.url),
    ["https://example.com/article", "https://example.com/listing"]
  );
});

test("allows sending only when AI is confirmed and every page type is yes-with-page or not applicable", () => {
  const initial = createInitialLynxChecklistState();
  initial.aiAnswer = "yes";
  initial.pageTypes.homepage = {
    decision: "yes",
    selectedPageUrl: "https://example.com/"
  };
  initial.pageTypes.articlePage = {
    decision: "yes",
    selectedPageUrl: "https://example.com/article"
  };
  Object.keys(initial.pageTypes).forEach((key) => {
    if (key !== "homepage" && key !== "articlePage") {
      initial.pageTypes[key] = {
        decision: "not_applicable",
        selectedPageUrl: ""
      };
    }
  });

  const checklist = buildLynxChecklistViewModel({
    ...initial,
    markedPages
  });

  assert.equal(checklist.canSend, true);
  assert.deepEqual(checklist.blockingReason, { code: "" });
});
