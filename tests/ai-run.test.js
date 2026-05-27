import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_RUN_RESUME_TTL_MS,
  formatAiRunCountdown,
  getAiRunRemainingMs,
  getAiRunResumeExpiresAt,
  parseAiRunStartResponse,
  parseAiRunStatusResponse,
  normalizePersistedAiRunRecord,
  shouldResumePersistedAiRun
} from "../popup/ai-run.js";

test("AI run countdown formats remaining time as m:ss", () => {
  assert.equal(formatAiRunCountdown(300_000), "5:00");
  assert.equal(formatAiRunCountdown(241_000), "4:01");
  assert.equal(formatAiRunCountdown(999), "0:01");
  assert.equal(formatAiRunCountdown(0), "0:00");
});

test("AI run remaining time clamps at zero", () => {
  assert.equal(getAiRunRemainingMs(10_000, 8_000), 2_000);
  assert.equal(getAiRunRemainingMs(10_000, 10_000), 0);
  assert.equal(getAiRunRemainingMs(10_000, 12_000), 0);
});

test("AI run resume expiry uses the configured recovery window", () => {
  assert.equal(getAiRunResumeExpiresAt(50_000), 50_000 + AI_RUN_RESUME_TTL_MS);
});

test("AI run start response only accepts the expected session payload", () => {
  assert.equal(parseAiRunStartResponse({ session_id: "abc" }), "abc");
  assert.equal(parseAiRunStartResponse({ session_id: "abc", status: "running" }), "");
  assert.equal(parseAiRunStartResponse({}), "");
  assert.equal(parseAiRunStartResponse(null), "");
});

test("AI run status response accepts only known statuses with a session id", () => {
  assert.deepEqual(
    parseAiRunStatusResponse({ session_id: "abc", status: "running" }),
    { sessionId: "abc", status: "running" }
  );
  assert.deepEqual(
    parseAiRunStatusResponse({ session_id: "abc", status: "DONE" }),
    { sessionId: "abc", status: "done" }
  );
  assert.equal(parseAiRunStatusResponse({ session_id: "abc", status: "pending" }), null);
  assert.equal(parseAiRunStatusResponse({ status: "running" }), null);
});

test("persisted AI run records normalize and validate the current site", () => {
  const record = normalizePersistedAiRunRecord({
    sessionId: " session-1 ",
    siteId: " site-9 ",
    expiresAt: 20_000,
    deadlineAt: 300_000
  });
  assert.deepEqual(record, {
    sessionId: "session-1",
    siteId: "site-9",
    expiresAt: 20_000,
    deadlineAt: 300_000
  });
  assert.equal(shouldResumePersistedAiRun(record, "site-9", 19_999), true);
  assert.equal(shouldResumePersistedAiRun(record, "site-9", 20_000), false);
  assert.equal(shouldResumePersistedAiRun(record, "site-8", 19_999), false);
  assert.equal(normalizePersistedAiRunRecord({ sessionId: "", siteId: "x" }), null);
});
