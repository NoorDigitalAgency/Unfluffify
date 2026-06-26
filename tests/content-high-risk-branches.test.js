import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const contentMainSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
const runtimeMessageHandlerSource = readFileSync(
  new URL("../src/content/runtime-message-handler.ts", import.meta.url),
  "utf8"
);

function getMessageBranch(messageType) {
  for (const source of [contentMainSource, runtimeMessageHandlerSource]) {
    const branchStart = source.indexOf(`if (message.type === "${messageType}") {`);
    if (branchStart < 0) {
      continue;
    }

    const nextBranchStart = source.indexOf('\n\n  if (message.type === "', branchStart + 1);
    if (nextBranchStart > branchStart) {
      return source.slice(branchStart, nextBranchStart);
    }

    return source.slice(branchStart);
  }

  return "";
}

test("revertPageDraft load failures answer ok false", () => {
  const handlerSource = readFileSync(
    new URL("../src/content/page-draft-revert-handler.ts", import.meta.url),
    "utf8"
  );
  const branch = getMessageBranch("revertPageDraft");

  assert.ok(branch);
  assert.match(branch, /(?:deps\.)?getPageDraftRevertHandler\(\)\.revert\(\{ targetBaseUrl \}\)/);
  assert.match(
    branch,
    /\.catch\(\(\) => \{\s*sendResponse\(\{ ok: false \}\);\s*\}\);/
  );
  assert.match(handlerSource, /const config = await deps\.loadConfig\(targetBaseUrl\);/);
});

test("mutating runtime-message branches keep base-url, config, and lock guards", () => {
  const mutatingBranches = [
    { messageType: "savePageDraft", requiresReconciliationGuard: false, requiresCatchFallback: true },
    { messageType: "revertPageDraft", requiresReconciliationGuard: false, requiresCatchFallback: true },
    { messageType: "setExplicitExclude", requiresReconciliationGuard: true, requiresCatchFallback: false },
    { messageType: "setExplicitInclude", requiresReconciliationGuard: true, requiresCatchFallback: false }
  ];

  for (const branchPolicy of mutatingBranches) {
    const branch = getMessageBranch(branchPolicy.messageType);

    assert.ok(branch, `${branchPolicy.messageType} branch should exist`);
    assert.match(branch, /const targetBaseUrl = message\.baseUrl \|\| (?:state|deps\.state)\.baseUrl;/);
    assert.match(branch, /!targetBaseUrl \|\| !(?:matchesActiveBaseUrl|deps\.matchesActiveBaseUrl)\(targetBaseUrl\)/);
    assert.match(branch, /!(?:state|deps\.state)\.config/);
    assert.match(branch, /if \(!(?:checkPropertyLockBlocksMarking|deps\.checkPropertyLockBlocksMarking)\(\)\) \{\s*sendResponse\(\{ ok: false, locked: true \}\);/);

    if (branchPolicy.requiresReconciliationGuard) {
      assert.match(
        branch,
        /core\.isPageSaveReconciliationPending\(location\.href\)|deps\.isPageSaveReconciliationPending\(deps\.locationHref\(\)\)[\s\S]*?sendResponse\(\{ ok: false, reconciliationPending: true \}\);/
      );
    } else {
      assert.doesNotMatch(branch, /isPageSaveReconciliationPending\(/);
    }

    if (branchPolicy.requiresCatchFallback) {
      assert.match(branch, /\.catch\(\(\) => \{[\s\S]*?sendResponse\(\{/);
    } else {
      assert.doesNotMatch(branch, /\.catch\(\(\) => \{[\s\S]*?sendResponse\(\{ ok: false \}\);/);
    }
  }
});
