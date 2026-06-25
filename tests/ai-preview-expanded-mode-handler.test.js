import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createAiPreviewExpandedModeHandler } from "../src/content/ai-preview-expanded-mode-handler.js";

function createDeps(overrides = {}) {
  const calls = {
    setActiveValues: [],
    disabledResponses: 0,
    modeResponses: []
  };

  const deps = {
    isPreviewExpandedStatesEnabled: () => true,
    setAiPreviewExpandedMode: (active) => {
      calls.setActiveValues.push(active);
      return active;
    },
    buildExpandedModeDisabledResponse: () => {
      calls.disabledResponses += 1;
      return { ok: false, feature: "previewExpandedStates" };
    },
    buildExpandedModeResponse: (ok) => {
      calls.modeResponses.push(ok);
      return { ok };
    },
    ...overrides
  };

  return {
    calls,
    deps
  };
}

test("expanded-mode handler returns disabled response when feature is off", () => {
  const { calls, deps } = createDeps({
    isPreviewExpandedStatesEnabled: () => false,
    setAiPreviewExpandedMode: (active) => {
      calls.setActiveValues.push(active);
      return false;
    }
  });
  const handler = createAiPreviewExpandedModeHandler(deps);

  const response = handler.handleMessage({ active: true });

  assert.deepEqual(response, { ok: false, feature: "previewExpandedStates" });
  assert.deepEqual(calls.setActiveValues, [false]);
  assert.equal(calls.disabledResponses, 1);
  assert.deepEqual(calls.modeResponses, []);
});

test("expanded-mode handler normalizes active payload and returns mode response", () => {
  const { calls, deps } = createDeps({
    setAiPreviewExpandedMode: (active) => {
      calls.setActiveValues.push(active);
      return false;
    }
  });
  const handler = createAiPreviewExpandedModeHandler(deps);

  const response = handler.handleMessage({ active: "" });

  assert.deepEqual(response, { ok: false });
  assert.deepEqual(calls.setActiveValues, [false]);
  assert.equal(calls.disabledResponses, 0);
  assert.deepEqual(calls.modeResponses, [false]);
});

test("expanded-mode handler handles missing payload objects", () => {
  const { calls, deps } = createDeps();
  const handler = createAiPreviewExpandedModeHandler(deps);

  const response = handler.handleMessage();

  assert.deepEqual(response, { ok: false });
  assert.deepEqual(calls.setActiveValues, [false]);
  assert.equal(calls.disabledResponses, 0);
  assert.deepEqual(calls.modeResponses, [false]);
});
