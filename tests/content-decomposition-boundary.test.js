import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentMainSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

function assertImportsContentModule(moduleName) {
  const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(`from\\s+"\\./content/${escapedModuleName}\\.js"`);
  assert.match(
    contentMainSource,
    importPattern,
    `expected content-main.js to import ./content/${moduleName}.js`
  );
}

function assertContentDoesNotDefine(functionName) {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const functionPattern = new RegExp(`(?:async\\s+)?function\\s+${escapedFunctionName}\\s*\\(`);
  assert.doesNotMatch(
    contentMainSource,
    functionPattern,
    `expected content-main.js to not define ${functionName}`
  );
}

test("content decomposition guard: baseline content modules are imported", () => {
  assertImportsContentModule("core");
  assertImportsContentModule("shared-inclusion");
  assertImportsContentModule("silent-highlight-rules");
  assertImportsContentModule("shared-selector-cache");
  assertImportsContentModule("submission-rules");
  assertImportsContentModule("content-command-router");
  assertImportsContentModule("page-world-relay");

  // Future Track C slices will append does-not-define assertions here as
  // allowed domains move out of content-main.js into dedicated modules.
  assert.equal(typeof assertContentDoesNotDefine, "function");
});