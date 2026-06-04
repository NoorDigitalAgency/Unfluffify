import test from "node:test";
import assert from "node:assert/strict";
import { PopupText } from "../common/text.js";

test("remote support copy stays view-only in popup text", () => {
  const configText = PopupText.configuration;

  assert.equal(typeof configText.remoteSupportPageControlHint, "string");
  assert.equal(typeof configText.remoteSupportBeingSupportedHint, "string");
  assert.match(configText.remoteSupportHint, /one-time support code/i);
  assert.match(configText.remoteSupportHint, /support party/i);
  assert.match(configText.remoteSupportPageControlHint, /join from the extension popup/i);
  assert.match(configText.remoteSupportBeingSupportedHint, /view-only/i);
  assert.equal("remoteSupportTakeOverButton" in configText, false);
  assert.equal("remoteSupportHandOffButton" in configText, false);
  assert.equal("remoteSupportControlledModeHint" in configText, false);
});
