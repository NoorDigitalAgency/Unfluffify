import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createAiPreviewCloseHandler } from "../src/content/ai-preview-close-handler.js";

function createDeps(overrides = {}) {
  const calls = {
    requestedClose: 0,
    exited: 0
  };

  const deps = {
    isAiPreviewActive: () => false,
    hasAiPopover: () => false,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    requestAiPopoverClose: async () => {
      calls.requestedClose += 1;
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    exitAiPreviewMode: async () => {
      calls.exited += 1;
    },
    ...overrides
  };

  return {
    calls,
    deps
  };
}

test("close handler returns inactive success when preview is not active", async () => {
  const { calls, deps } = createDeps();
  const handler = createAiPreviewCloseHandler(deps);

  const response = await handler.handleMessage();

  assert.deepEqual(response, { ok: true, active: false, previewRestoreToken: null });
  assert.equal(calls.requestedClose, 0);
  assert.equal(calls.exited, 0);
});

test("close handler requests popover close when preview popover is present", async () => {
  const requestedCloseArgs = [];
  const popoverCloseState = {
    markingEnabled: true,
    baseUrl: "https://example.com/path",
    pageUrl: "https://example.com/path/page",
    draftStatus: {
      ok: true,
      dirty: false
    }
  };
  const { calls, deps } = createDeps({
    isAiPreviewActive: () => true,
    hasAiPopover: () => true,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    requestAiPopoverClose: async (options) => {
      calls.requestedClose += 1;
      requestedCloseArgs.push(options);
      return popoverCloseState;
    }
  });
  const handler = createAiPreviewCloseHandler(deps);

  const response = await handler.handleMessage({ previewRestoreToken: 7 });

  assert.deepEqual(response, {
    ok: true,
    active: false,
    ...popoverCloseState,
    previewRestoreToken: 7
  });
  assert.equal(calls.requestedClose, 1);
  assert.deepEqual(requestedCloseArgs, [{ closeToken: 7 }]);
  assert.equal(calls.exited, 0);
});

test("close handler exits preview mode when no popover is active", async () => {
  const { calls, deps } = createDeps({
    isAiPreviewActive: () => true
  });
  const handler = createAiPreviewCloseHandler(deps);

  const response = await handler.handleMessage();

  assert.deepEqual(response, { ok: true, active: false, previewRestoreToken: null });
  assert.equal(calls.requestedClose, 0);
  assert.equal(calls.exited, 1);
});
