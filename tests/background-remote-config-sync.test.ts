import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const remoteConfigSyncSource = readFileSync(
  new URL("../src/background/remote-config-sync.ts", import.meta.url),
  "utf8"
);

test("remote-config-sync module exports config reconciliation handlers", () => {
  assert.match(remoteConfigSyncSource, /export function collectStoredPageMarkingItems\(pageMarkings(?:\s*:\s*[^,)]+)?, baseUrl = ""\) \{/);
  assert.match(remoteConfigSyncSource, /export function mergeSelectorsIntoConfig\(targetConfig(?:\s*:\s*[^,)]+)?, incomingConfig(?:\s*:\s*[^,)]+)?\) \{/);
  assert.match(remoteConfigSyncSource, /export function getRemoteManagedConfigSignature\(baseUrl(?:\s*:\s*[^,)]+)?, sourceConfig(?:\s*:\s*[^,)]+)?\) \{/);
  assert.match(remoteConfigSyncSource, /export function getNormalizedPageEntrySignature\(pageUrl(?:\s*:\s*[^,)]+)?, entry(?:\s*:\s*[^,)]+)?\) \{/);
  assert.match(remoteConfigSyncSource, /export async function clearLocalPageDataForMissingRemote\(options = \{\}\) \{/);
  assert.match(remoteConfigSyncSource, /export async function replaceServerConfigIntoLocalSnapshot\(options = \{\}\) \{/);
  assert.match(remoteConfigSyncSource, /export async function mergeServerConfigIntoLocalSnapshot\(options = \{\}\) \{/);
  assert.match(remoteConfigSyncSource, /export async function preparePageTypeAssignmentsSnapshot\(options = \{\}\) \{/);
});

test("remote-config-sync relies on shared config normalization and transfer payload storage", () => {
  assert.match(remoteConfigSyncSource, /from "\.\.\/common\/config"/);
  assert.match(remoteConfigSyncSource, /from "\.\/transfer-payload-store"/);
  assert.match(remoteConfigSyncSource, /configStore\.normalizeConfigSyncPayload\(/);
  assert.match(remoteConfigSyncSource, /configStore\.mergePageMarkingsByTimestamp\(/);
  assert.match(remoteConfigSyncSource, /configStore\.setBackendSavedPageMarkings\(/);
  assert.match(remoteConfigSyncSource, /await consumeTransferPayload\(payloadKey, \{/);
  assert.match(remoteConfigSyncSource, /await putTransferPayload\("assign-page-types-prepare", payload\)/);
});

test("remote-config-sync prepare step backfills missing raw HTML through remote-network", () => {
  assert.match(remoteConfigSyncSource, /from "\.\/remote-network"/);
  assert.match(remoteConfigSyncSource, /const urlsMissingRawHtml = assignments/);
  assert.match(remoteConfigSyncSource, /await fetchStaticPageHtmlForBackground\(url\)/);
  assert.match(remoteConfigSyncSource, /const payload = assignments\.map\(\(item\) => \{/);
  assert.match(remoteConfigSyncSource, /rawHtml:/);
  assert.match(remoteConfigSyncSource, /renderedHtml:/);
});
