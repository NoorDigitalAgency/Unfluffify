import test from "node:test";
import assert from "node:assert/strict";

import { createAiPreviewCloseHandler } from "../content/ai-preview-close-handler.js";

function createDeps(overrides = {}) {
  const calls = {
    requestedClose: 0,
    exited: 0
  };

  const deps = {
    isAiPreviewActive: () => false,
    hasAiPopover: () => false,
    requestAiPopoverClose: () => {
      calls.requestedClose += 1;
    },
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

  assert.deepEqual(response, { ok: true, active: false });
  assert.equal(calls.requestedClose, 0);
  assert.equal(calls.exited, 0);
});

test("close handler requests popover close when preview popover is present", async () => {
  const { calls, deps } = createDeps({
    isAiPreviewActive: () => true,
    hasAiPopover: () => true
  });
  const handler = createAiPreviewCloseHandler(deps);

  const response = await handler.handleMessage();

  assert.deepEqual(response, { ok: true, active: false });
  assert.equal(calls.requestedClose, 1);
  assert.equal(calls.exited, 0);
});

test("close handler exits preview mode when no popover is active", async () => {
  const { calls, deps } = createDeps({
    isAiPreviewActive: () => true
  });
  const handler = createAiPreviewCloseHandler(deps);

  const response = await handler.handleMessage();

  assert.deepEqual(response, { ok: true, active: false });
  assert.equal(calls.requestedClose, 0);
  assert.equal(calls.exited, 1);
});
