import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createPageSaveReconciliationPendingHandler } from "../src/content/page-save-reconciliation-pending-handler.js";

function createDeps() {
  const calls = [];
  const deps = {
    setPageSaveReconciliationPending: async (baseUrl, pageUrl, options) => {
      calls.push({ baseUrl, pageUrl, options });
      return {
        baseUrl,
        pageUrl,
        reason: options.reason
      };
    }
  };

  return {
    calls,
    deps
  };
}

test("reconciliation pending handler passes through a string reason", async () => {
  const { calls, deps } = createDeps();
  const handler = createPageSaveReconciliationPendingHandler(deps);

  const response = await handler.setPending({
    targetBaseUrl: "https://example.com",
    pageUrl: "https://example.com/page",
    reason: "saving"
  });

  assert.deepEqual(calls, [{
    baseUrl: "https://example.com",
    pageUrl: "https://example.com/page",
    options: { reason: "saving" }
  }]);
  assert.deepEqual(response, {
    ok: true,
    reconciliation: {
      baseUrl: "https://example.com",
      pageUrl: "https://example.com/page",
      reason: "saving"
    }
  });
});

test("reconciliation pending handler defaults missing or non-string reasons to pending", async () => {
  const { calls, deps } = createDeps();
  const handler = createPageSaveReconciliationPendingHandler(deps);

  await handler.setPending({
    targetBaseUrl: "https://example.com",
    pageUrl: "https://example.com/page"
  });
  await handler.setPending({
    targetBaseUrl: "https://example.com",
    pageUrl: "https://example.com/page-two",
    reason: 42
  });

  assert.deepEqual(calls, [{
    baseUrl: "https://example.com",
    pageUrl: "https://example.com/page",
    options: { reason: "pending" }
  }, {
    baseUrl: "https://example.com",
    pageUrl: "https://example.com/page-two",
    options: { reason: "pending" }
  }]);
});
