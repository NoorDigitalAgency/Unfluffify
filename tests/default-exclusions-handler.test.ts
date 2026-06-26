import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createDefaultExclusionsHandler } from "../src/content/default-exclusions-handler.js";

test("default exclusions handler returns immutable selectors from deps", () => {
  const selectors = [".alpha", ".beta"];
  const handler = createDefaultExclusionsHandler({
    getImmutableSelectors: () => selectors.slice()
  });

  const response = handler.handleMessage();

  assert.deepEqual(response, { immutableSelectors: selectors });
  assert.notEqual(response.immutableSelectors, selectors);
});
