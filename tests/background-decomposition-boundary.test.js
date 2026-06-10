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

function assertBackgroundDoesNotDefine(functionName) {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const functionPattern = new RegExp(`(?:async\\s+)?function\\s+${escapedFunctionName}\\s*\\(`);
  assert.doesNotMatch(
    backgroundSource,
    functionPattern,
    `expected background.js to not define ${functionName}`
  );
}

test("background decomposition guard: baseline background modules are imported", () => {
  assertImportsBackgroundModule("command-router");
  assertImportsBackgroundModule("command-ledger");
  assertImportsBackgroundModule("tab-runtime");
  assertImportsBackgroundModule("tab-session-store");
  assertImportsBackgroundModule("spinner-operations");
  assertImportsBackgroundModule("transfer-payload-store");
  assertImportsBackgroundModule("ai-run-record-store");

  assertBackgroundDoesNotDefine("looksLikeJwtToken");
  assertBackgroundDoesNotDefine("summarizeLargeString");
  assertBackgroundDoesNotDefine("redactCommandPayloadValueForLedger");
  assertBackgroundDoesNotDefine("redactCommandPayloadForLedger");
});
