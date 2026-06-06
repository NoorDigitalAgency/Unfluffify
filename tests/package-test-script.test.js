import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("npm test uses the clean Node test runner without force exit", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(packageJson.scripts.test, "node --test");
  assert.doesNotMatch(packageJson.scripts.test, /--test-force-exit/);
});
