import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("background routes the current remote support runtime messages", () => {
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const match = source.match(/const REMOTE_SUPPORT_MESSAGE_TYPES = new Set\(\[(.*?)\]\);/s);

  assert.ok(match, "background remote support message whitelist should exist");

  const messageTypes = Array.from(match[1].matchAll(/"([^"]+)"/g), ([, type]) => type).sort();

  assert.deepEqual(messageTypes, [
    "getRemoteSupportState",
    "remoteSupportContinueSession",
    "remoteSupportDismissError",
    "remoteSupportEnd",
    "remoteSupportExtensionTelemetry",
    "remoteSupportJoin",
    "remoteSupportRequestCode",
    "remoteSupportSendCommand",
    "remoteSupportSetControlOwner",
    "remoteSupportSetDockState",
    "remoteSupportSetLocalMediaEnabled",
    "remoteSupportTransportEvent"
  ].sort());
});