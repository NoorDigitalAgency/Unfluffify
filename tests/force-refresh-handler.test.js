import test from "node:test";
import assert from "node:assert/strict";

import { createForceRefreshHandler } from "../content/force-refresh-handler.js";

test("force refresh handler refreshes state, highlights, property lock, and silent highlights in order", async () => {
  const calls = [];
  const handler = createForceRefreshHandler({
    refreshFromTabState: async () => {
      calls.push("refreshFromTabState:start");
      await Promise.resolve();
      calls.push("refreshFromTabState:end");
    },
    refreshEnabledAiHighlights: () => {
      calls.push("refreshEnabledAiHighlights");
    },
    runPropertyLockSync: (options) => {
      calls.push({ type: "runPropertyLockSync", options });
    },
    refreshSilentHighlightings: async () => {
      calls.push("refreshSilentHighlightings:start");
      await Promise.resolve();
      calls.push("refreshSilentHighlightings:end");
    }
  });

  const response = await handler.handleMessage();

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(calls, [
    "refreshFromTabState:start",
    "refreshFromTabState:end",
    "refreshEnabledAiHighlights",
    { type: "runPropertyLockSync", options: { forceSiteIdRefresh: true } },
    "refreshSilentHighlightings:start",
    "refreshSilentHighlightings:end"
  ]);
});