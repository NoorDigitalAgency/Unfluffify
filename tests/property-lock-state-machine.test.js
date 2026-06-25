import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const source = readFileSync(new URL("../src/content/property-lock-state-machine.ts", import.meta.url), "utf8");

test("property-lock state machine exports a dependency-injected factory", () => {
  assert.match(source, /export function createPropertyLockStateMachine\(deps(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(source, /return \{[\s\S]*?applyServerMessage,[\s\S]*?startOffCandidateWarning[\s\S]*?\};/);
});

test("property-lock state machine persists recovery and off-candidate deadlines through runtime tab state", () => {
  assert.match(source, /function persistRecoveryState\([\s\S]*?siteId = null,[\s\S]*?baseUrl = "",[\s\S]*?clientId = "",[\s\S]*?deadlineAt = 0[\s\S]*?\) \{/);
  assert.match(source, /propertyLockRecoverySiteId:[\s\S]*?typeof siteId === "number" && Number\.isFinite\(siteId\)[\s\S]*?Math\.trunc\(siteId\)[\s\S]*?: null/);
  assert.match(source, /function persistOffCandidateDeadline\(deadlineAt(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(source, /propertyLockOffCandidateDeadlineAt:[\s\S]*?typeof deadlineAt === "number" && Number\.isFinite\(deadlineAt\)[\s\S]*?Math\.max\(0, Math\.trunc\(deadlineAt\)\)[\s\S]*?: 0/);
});

test("property-lock state machine keeps disconnect and inactivity countdown fallback guards", () => {
  assert.match(source, /serverMessage\.connectionStatus === deps\.PROPERTY_LOCK_CONNECTION_UNAVAILABLE/);
  assert.match(source, /defaultDisconnectCountdownSeconds = Math\.ceil\(deps\.PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS \/ 1000\)/);
  assert.match(source, /defaultInactivityCountdownSeconds = Math\.ceil\(deps\.PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS \/ 1000\)/);
  assert.match(source, /if \(deps\.isRenderModeInspectionActive\(\)\) \{[\s\S]*?editor_inspection_reconnecting/);
});
