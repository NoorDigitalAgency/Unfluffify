import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function collectJsFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

test("popup files do not call chrome.tabs.sendMessage directly", () => {
  const popupDir = fileURLToPath(new URL("../popup", import.meta.url));
  const popupFiles = collectJsFiles(popupDir);

  for (const popupFile of popupFiles) {
    const source = readFileSync(popupFile, "utf8");
    assert.doesNotMatch(source, /chrome\.tabs\.sendMessage\(/, popupFile);
  }
});

test("popup content messages are routed through TAB_CONTENT_REQUEST background command", () => {
  const popupMessagesSource = readFileSync(new URL("../popup/messages.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../background.ts", import.meta.url), "utf8");

  assert.match(popupMessagesSource, /TAB_CONTENT_REQUEST_COMMAND = "TAB_CONTENT_REQUEST"/);
  assert.match(popupMessagesSource, /requestRuntime\(\{[\s\S]*?type: TAB_CONTENT_REQUEST_COMMAND/);
  assert.match(backgroundSource, /TAB_CONTENT_REQUEST: "TAB_CONTENT_REQUEST"/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_CONTENT_REQUEST, async \(context, payload\) => \{/);
  assert.match(backgroundSource, /sendContentMessageToTab\([\s\S]*?message/);
});
