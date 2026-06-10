import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");

function assertImportsBackgroundModule(moduleName) {
  const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(`from\\s+"\\./background/${escapedModuleName}\\.js"`);
  assert.match(
    backgroundSource,
    importPattern,
    `expected background.js to import ./background/${moduleName}.js`
  );
}

test("background decomposition guard: baseline background modules are imported", () => {
  assertImportsBackgroundModule("command-router");
  assertImportsBackgroundModule("tab-runtime");
  assertImportsBackgroundModule("tab-session-store");
  assertImportsBackgroundModule("spinner-operations");
  assertImportsBackgroundModule("transfer-payload-store");
  assertImportsBackgroundModule("ai-run-record-store");
});
