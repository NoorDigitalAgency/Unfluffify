import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const remoteNetworkSource = readFileSync(new URL("../background/remote-network.ts", import.meta.url), "utf8");

test("remote-network module exports remote transport handlers", () => {
  assert.match(remoteNetworkSource, /export async function requestAiRunStatus\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function removeRemotePageMarking\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function submitSelectorSetGraphqlUpdate\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function loadRemoteConfigSnapshot\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function saveRemoteConfigSnapshot\(\s*options(?:\s*:\s*[^=]+)? = \{\}\s*\) \{/);
  assert.match(remoteNetworkSource, /export async function requestRenderModeDetection\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function submitPageTypeAssignments\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function requestAiRunStartSnapshot\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function requestAiRunResultSnapshot\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function fetchStaticPageHtmlForBackground\(url(?:\s*:\s*[^)]+)?\) \{/);
});

test("remote-network routes requests via network-core helpers", () => {
  assert.match(remoteNetworkSource, /from "\.\/network-core\.js"/);
  assert.match(remoteNetworkSource, /resolveBackgroundNetworkCredentials\(\{/);
  assert.match(remoteNetworkSource, /resolveBackgroundEndpoint\(endpointValue, "\/remove"\)/);
  assert.match(remoteNetworkSource, /resolveBackgroundEndpoint\(endpointValue, "\/load"\)/);
  assert.match(remoteNetworkSource, /resolveBackgroundEndpoint\(endpointValue, "\/save"\)/);
  assert.match(remoteNetworkSource, /resolveBackgroundEndpoint\(endpointValue, "\/is_js_rendered"\)/);
  assert.match(remoteNetworkSource, /resolveBackgroundEndpoint\(endpointValue, "\/assign_page_types"\)/);
  assert.match(remoteNetworkSource, /resolveBackgroundEndpoint\(endpointValue, "\/get_selectors"\)/);
});

test("remote-network uses transfer payload store for heavy request and response bodies", () => {
  assert.match(remoteNetworkSource, /from "\.\/transfer-payload-store\.js"/);
  assert.match(remoteNetworkSource, /await putTransferPayload\("load", payload\)/);
  assert.match(remoteNetworkSource, /await getTransferPayload\(requestPayloadKey, \{ expectedType: "object" \}\)/);
  assert.match(remoteNetworkSource, /await putTransferPayload\("save-response", payload\)/);
  assert.match(remoteNetworkSource, /await getTransferPayload\(requestPayloadKey, \{ expectedType: "array" \}\)/);
  assert.match(remoteNetworkSource, /await putTransferPayload\("ai-run-result", payload\)/);
  assert.match(remoteNetworkSource, /await removeTransferPayload\(requestPayloadKey\);/);
});

test("selector update mutation constant stays with remote-network module", () => {
  assert.match(remoteNetworkSource, /export const UPDATE_SCRAPING_CONDITIONS_MUTATION = `/);
  assert.match(remoteNetworkSource, /mutation updateScrapingConditions/);
  assert.match(remoteNetworkSource, /query: UPDATE_SCRAPING_CONDITIONS_MUTATION/);
});
