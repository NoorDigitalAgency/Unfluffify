import test from "node:test";
import assert from "node:assert/strict";

import { handleRemoteSupportSupportPageMessage } from "../content/remote-support-support-page-message-handler.js";

function createSupportPage(overrides = {}) {
  return {
    isSupportPage: () => true,
    sendViewerRequest: async () => ({ ok: true }),
    getTabId: () => 12,
    applyState: () => {},
    handleFrameMessage: () => true,
    ...overrides
  };
}

function createDeps(supportPage) {
  return {
    getRemoteSupportSupportPage: () => supportPage
  };
}

test("non-support-page message returns null", () => {
  const supportPage = createSupportPage();

  const result = handleRemoteSupportSupportPageMessage(
    { type: "setEnabled" },
    () => {},
    createDeps(supportPage)
  );

  assert.equal(result, null);
});

test("transport start returns true and normalizes non-object viewer responses", async () => {
  const supportPage = createSupportPage({
    sendViewerRequest: async () => "invalid-response"
  });
  const responses = [];

  const result = handleRemoteSupportSupportPageMessage(
    { type: "remoteSupportViewerTransportStart", session: { id: "abc" } },
    (response) => {
      responses.push(response);
    },
    createDeps(supportPage)
  );

  assert.equal(result, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(responses, [{ ok: false }]);
});

test("state-changed branch ignores mismatched tab ids", () => {
  const supportPage = createSupportPage({
    getTabId: () => 2,
    applyState: () => {
      throw new Error("state should not be applied when tab id mismatches");
    }
  });
  let responded = false;

  const result = handleRemoteSupportSupportPageMessage(
    { type: "remoteSupportStateChanged", tabId: 9, state: { active: true } },
    () => {
      responded = true;
    },
    createDeps(supportPage)
  );

  assert.equal(result, undefined);
  assert.equal(responded, false);
});

test("frame branch responds only when support-page handler accepts frame", () => {
  const responses = [];
  const rejectingSupportPage = createSupportPage({
    handleFrameMessage: () => false
  });

  const rejectedResult = handleRemoteSupportSupportPageMessage(
    { type: "remoteSupportFrame", frame: "x" },
    (response) => {
      responses.push(response);
    },
    createDeps(rejectingSupportPage)
  );
  assert.equal(rejectedResult, undefined);
  assert.deepEqual(responses, []);

  const acceptingSupportPage = createSupportPage({
    handleFrameMessage: () => true
  });
  const acceptedResult = handleRemoteSupportSupportPageMessage(
    { type: "remoteSupportFrame", frame: "x" },
    (response) => {
      responses.push(response);
    },
    createDeps(acceptingSupportPage)
  );

  assert.equal(acceptedResult, undefined);
  assert.deepEqual(responses, [{ ok: true }]);
});
