import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const commandLedgerSource = readFileSync(new URL("../background/command-ledger.js", import.meta.url), "utf8");

test("popup background commands declare explicit source and tab-id policy", () => {
  assert.match(
    backgroundSource,
    /const POPUP_TAB_COMMAND_POLICY = Object\.freeze\(\{[\s\S]*allowedSources:\s*\[MESSAGE_SOURCES\.POPUP\][\s\S]*tabIdPolicy:\s*"message"[\s\S]*requireTab:\s*true/
  );

  assert.match(
    backgroundSource,
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.POPUP_GET_TAB_VIEW_STATE, async \(context\) => \{[\s\S]*?\}, POPUP_TAB_COMMAND_POLICY\);/
  );
  assert.match(
    backgroundSource,
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_CONTENT_REQUEST, async \(context, payload\) => \{[\s\S]*?\}, POPUP_TAB_COMMAND_POLICY\);/
  );
});

test("command ledger payloads are redacted before persistence", () => {
  assert.match(backgroundSource, /function maybeGetCommandPayloadForLedger\(message\) \{/);
  assert.match(backgroundSource, /return redactCommandPayloadForLedger\(message\.payload\);/);
  assert.match(commandLedgerSource, /LEDGER_SENSITIVE_KEY_PATTERN\s*=\s*\/\(token\|password\|secret\|authorization\|cookie\|jwt/);
  assert.match(commandLedgerSource, /if \(normalizedKey === "payloadKey"\) \{/);
  assert.match(commandLedgerSource, /return "\[redacted:payload-key\]";/);
  assert.match(commandLedgerSource, /export function redactCommandPayloadForLedger\(payload, depth = 0\) \{/);
});

test("command ledger records use resolved command-context tab id", () => {
  assert.match(backgroundSource, /let resolvedContextTabId = null;/);
  assert.match(backgroundSource, /onDispatched\(context\) \{/);
  assert.match(backgroundSource, /recordBackgroundCommandLedger\(message, sender, reply, startedAt, resolvedContextTabId\);/);
});
