import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

function getMessageBranch(messageType: string) {
  const branchStart = backgroundSource.indexOf(`if (message.type === "${messageType}") {`);
  if (branchStart < 0) {
    return "";
  }
  const nextBranchStart = backgroundSource.indexOf('\n\n  if (message.type === "', branchStart + 1);
  if (nextBranchStart > branchStart) {
    return backgroundSource.slice(branchStart, nextBranchStart);
  }
  return backgroundSource.slice(branchStart);
}

test("background async runtime handlers keep the service worker alive", () => {
  assert.match(
    backgroundSource,
    /function replyWithKeepAlive\([\s\S]*?swKeepAlive\.acquire\(\);[\s\S]*?\.finally\(\(\) => \{\s*swKeepAlive\.release\(\);\s*\}\);/
  );
  assert.match(
    backgroundSource,
    /function handleBackgroundCommandEnvelope\([\s\S]*?const dispatch = dispatchBackgroundCommandEnvelope\(message, sender\);[\s\S]*?swKeepAlive\.acquire\(\);[\s\S]*?dispatch[\s\S]*?\.finally\(\(\) => \{\s*swKeepAlive\.release\(\);\s*\}\);/
  );

  const expectedBranches: Array<[string, string]> = [
    ["loadRemoteConfigSnapshot", "loadRemoteConfigSnapshot"],
    ["saveRemoteConfigSnapshot", "saveRemoteConfigSnapshot"],
    ["replaceServerConfigIntoLocalSnapshot", "replaceServerConfigIntoLocalSnapshot"],
    ["mergeServerConfigIntoLocalSnapshot", "mergeServerConfigIntoLocalSnapshot"],
    ["getTabState", "utils.getTabState"],
    ["clearReloadRestoreTabState", "clearReloadRestoreTabState"],
    ["setTabState", "queueTabSessionWrite"],
    ["idbGet", "utils.idbGet"],
    ["idbSet", "utils.idbSet"],
    ["idbRemove", "utils.idbRemove"]
  ];

  for (const [messageType, handlerName] of expectedBranches) {
    const branch = getMessageBranch(messageType);
    assert.ok(branch, `${messageType} branch should exist`);
    assert.match(
      branch,
      new RegExp(`replyWithKeepAlive\\(\\(\\) => ${handlerName}\\(`),
      `${messageType} should hold the worker awake until sendResponse`
    );
  }
});

test("background keepalive preserves explicit null getTabState replies when nullIfMissing is requested", () => {
  const keepAliveBody = backgroundSource.match(
    /function replyWithKeepAlive\([\s\S]*?\n\}/
  )?.[0];
  assert.ok(keepAliveBody, "Expected replyWithKeepAlive in background.ts");
  assert.match(keepAliveBody, /if \(typeof result === "undefined"\) \{/);
  assert.doesNotMatch(keepAliveBody, /if \(result === null \|\| typeof result === "undefined"\) \{/);

  const getTabStateBranch = getMessageBranch("getTabState");
  assert.match(getTabStateBranch, /if \(!state && message\.nullIfMissing\) \{\s*return null;\s*\}/);
});
