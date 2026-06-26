import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createAiPreviewGetStateHandler } from "../src/content/ai-preview-get-state-handler.js";

test("get-state handler returns builder response as-is", () => {
  const expected = {
    ok: true,
    active: true,
    mode: "preview",
    items: [{ xpath: "//h1" }]
  };

  const handler = createAiPreviewGetStateHandler({
    buildGetStateResponse: () => expected
  });

  const response = handler.handleMessage();

  assert.equal(response, expected);
});

test("get-state handler tolerates non-object builder responses", () => {
  const handler = createAiPreviewGetStateHandler({
    buildGetStateResponse: () => null
  });

  assert.equal(handler.handleMessage(), null);
});
