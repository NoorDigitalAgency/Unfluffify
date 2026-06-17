import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../content/property-lock-state-machine.ts", import.meta.url), "utf8");

test("property-lock state machine exports a dependency-injected factory", () => {
  assert.match(source, /export function createPropertyLockStateMachine\(deps\) \{/);
  assert.match(source, /return \{[\s\S]*?applyServerMessage,[\s\S]*?startOffCandidateWarning[\s\S]*?\};/);
});

test("property-lock state machine persists recovery and off-candidate deadlines through runtime tab state", () => {
  assert.match(source, /function persistRecoveryState\(\{ siteId = null, baseUrl = "", clientId = "", deadlineAt = 0 \} = \{\}\) \{/);
  assert.match(source, /propertyLockRecoverySiteId: Number\.isFinite\(siteId\) \? Math\.trunc\(siteId\) : null/);
  assert.match(source, /function persistOffCandidateDeadline\(deadlineAt\) \{/);
  assert.match(source, /propertyLockOffCandidateDeadlineAt: Number\.isFinite\(deadlineAt\) \? Math\.max\(0, Math\.trunc\(deadlineAt\)\) : 0/);
});

test("property-lock state machine keeps disconnect and inactivity countdown fallback guards", () => {
  assert.match(source, /serverMessage\.connectionStatus === deps\.PROPERTY_LOCK_CONNECTION_UNAVAILABLE/);
  assert.match(source, /defaultDisconnectCountdownSeconds = Math\.ceil\(deps\.PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS \/ 1000\)/);
  assert.match(source, /defaultInactivityCountdownSeconds = Math\.ceil\(deps\.PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS \/ 1000\)/);
  assert.match(source, /if \(deps\.isRenderModeInspectionActive\(\)\) \{[\s\S]*?editor_inspection_reconnecting/);
});
