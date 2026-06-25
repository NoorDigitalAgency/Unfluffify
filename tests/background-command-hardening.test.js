import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
const commandLedgerSource = readFileSync(new URL("../src/background/command-ledger.ts", import.meta.url), "utf8");

test("popup background commands declare explicit source and tab-id policy", () => {
  assert.match(
    backgroundSource,
    /const POPUP_TAB_COMMAND_POLICY = Object\.freeze\(\{[\s\S]*allowedSources:\s*\[MESSAGE_SOURCES\.POPUP\][\s\S]*tabIdPolicy:\s*"message"[\s\S]*requireTab:\s*true/
  );

  assert.doesNotMatch(backgroundSource, /BACKGROUND_COMMANDS\.POPUP_GET_TAB_VIEW_STATE/);
  assert.match(
    backgroundSource,
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_CONTENT_REQUEST, async \(context, payload\) => \{[\s\S]*?\}, POPUP_TAB_COMMAND_POLICY\);/
  );
});

test("command ledger payloads are redacted before persistence", () => {
  assert.match(backgroundSource, /function maybeGetCommandPayloadForLedger\(message(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(backgroundSource, /return redactCommandPayloadForLedger\(message\.payload\);/);
  assert.match(commandLedgerSource, /LEDGER_SENSITIVE_KEY_PATTERN\s*=\s*\/\(token\|password\|secret\|authorization\|cookie\|jwt/);
  assert.match(commandLedgerSource, /if \(normalizedKey === "payloadKey"\) \{/);
  assert.match(commandLedgerSource, /return "\[redacted:payload-key\]";/);
  assert.match(commandLedgerSource, /export function redactCommandPayloadForLedger\(payload, depth = 0\) \{/);
});

test("command ledger records use resolved command-context tab id", () => {
  assert.match(backgroundSource, /let resolvedContextTabId(?:\s*:\s*[^=]+)? = null;/);
  assert.match(backgroundSource, /onDispatched\(context(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(backgroundSource, /recordBackgroundCommandLedger\((?:message|runtimeRequest), sender, reply, startedAt, resolvedContextTabId\);/);
});
