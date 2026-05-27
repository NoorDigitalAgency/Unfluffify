import test from "node:test";
import assert from "node:assert/strict";

import {
  PROPERTY_LOCK_STATE_UNLOCKED,
  buildPropertyLockWssUrl,
  createInactiveLockState,
  normalizeLockStateMessage
} from "../common/property-lock.js";

test("buildPropertyLockWssUrl requires a stage base and token", () => {
  assert.equal(buildPropertyLockWssUrl("", "token"), "");
  assert.equal(buildPropertyLockWssUrl("example.test", ""), "");
  assert.equal(buildPropertyLockWssUrl("https://example.test/path", "token value"), "wss://api.example.test/property-lock?token=token%20value");
});

test("normalizeLockStateMessage clamps countdown and preserves editor flags", () => {
  const normalized = normalizeLockStateMessage({
    state: "expiry_warning",
    editorIdentity: "editor@example.test",
    editorName: "Editor",
    isEditor: true,
    isRecentEditor: false,
    expiresAtUtc: "2026-05-27T10:00:00.0000000Z",
    secondsRemaining: -4
  });

  assert.equal(normalized.state, "expiry_warning");
  assert.equal(normalized.editorIdentity, "editor@example.test");
  assert.equal(normalized.editorName, "Editor");
  assert.equal(normalized.isEditor, true);
  assert.equal(normalized.isRecentEditor, false);
  assert.equal(normalized.secondsRemaining, 0);
});

test("createInactiveLockState returns an unlocked non-editor snapshot", () => {
  assert.deepEqual(createInactiveLockState(), {
    state: PROPERTY_LOCK_STATE_UNLOCKED,
    editorIdentity: "",
    editorName: "",
    isEditor: false,
    isRecentEditor: false,
    expiresAtUtc: "",
    secondsRemaining: null
  });
});