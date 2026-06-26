import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

test("background command ledger redacts payloads before persisting debug entries", () => {
  assert.match(backgroundSource, /function maybeGetCommandPayloadForLedger\(message(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(backgroundSource, /if \(!isDebugFlagEnabled\("fullWorldMessagingLogging"\)\) \{/);
  assert.match(backgroundSource, /return redactCommandPayloadForLedger\(message\.payload\);/);
  assert.match(backgroundSource, /payload: maybeGetCommandPayloadForLedger\(message\)/);
});

test("command ledger records background commands against the resolved command-context tab id", () => {
  assert.match(backgroundSource, /let resolvedContextTabId(?:\s*:\s*[^=]+)? = null;/);
  assert.match(backgroundSource, /onDispatched\(context(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(backgroundSource, /recordBackgroundCommandLedger\((?:message|runtimeRequest), sender, reply, startedAt, resolvedContextTabId\);/);
});
