import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const remoteNetworkSource = readFileSync(new URL("../src/background/remote-network.ts", import.meta.url), "utf8");

test("remote-network uses transfer payload store for heavy request and response bodies", () => {
  assert.match(remoteNetworkSource, /from "\.\/transfer-payload-store\.js"/);
  assert.match(remoteNetworkSource, /await putTransferPayload\("load", payload\)/);
  assert.match(remoteNetworkSource, /await getTransferPayload\(requestPayloadKey, \{ expectedType: "object" \}\)/);
  assert.match(remoteNetworkSource, /await putTransferPayload\("save-response", payload\)/);
  assert.match(remoteNetworkSource, /await getTransferPayload\(requestPayloadKey, \{ expectedType: "array" \}\)/);
  assert.match(remoteNetworkSource, /await putTransferPayload\("ai-run-result", payload\)/);
  assert.match(remoteNetworkSource, /await removeTransferPayload\(requestPayloadKey\);/);
});

test("AI run start reports running phase only immediately before fetch", () => {
  const startBlock = remoteNetworkSource.match(
    /export async function requestAiRunStartSnapshot\(options = \{\}\) \{([\s\S]*?)\n\}\n\nexport async function requestAiRunResultSnapshot/
  )[1];
  const beforeRequestIndex = startBlock.indexOf("await opts.onBeforeRequest?.({");
  const fetchIndex = startBlock.indexOf("const response = await fetch(computeSelectorsUrl");

  assert.match(startBlock, /return \{ ok: false, skipped: true, reason: "missing_endpoint" \};/);
  assert.match(startBlock, /return \{ ok: false, skipped: true, reason: "missing_payload_key" \};/);
  assert.match(startBlock, /return \{ ok: false, reason: "payload_unavailable" \};/);
  assert.ok(beforeRequestIndex > -1, "start transport should notify before fetch");
  assert.ok(fetchIndex > beforeRequestIndex, "notification should happen immediately before fetch");
});
