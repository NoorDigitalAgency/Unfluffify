import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PROPERTY_LOCK_STATE_UNLOCKED,
  buildPropertyLockWssUrl,
  createInactiveLockState,
  normalizeLockStateMessage
} from "../common/property-lock.js";

test("buildPropertyLockWssUrl requires a stage base and token", () => {
  assert.equal(buildPropertyLockWssUrl("", "token"), "");
  assert.equal(buildPropertyLockWssUrl("example.test", ""), "");
  assert.equal(buildPropertyLockWssUrl("https://example.test/path", "token value"), "wss://example.test/property-lock?token=token%20value");
});

test("buildPropertyLockWssUrl uses configured endpoint origin without api prefix", () => {
  assert.equal(
    buildPropertyLockWssUrl("https://config.example.test/load", "abc123"),
    "wss://config.example.test/property-lock?token=abc123"
  );
  assert.equal(
    buildPropertyLockWssUrl("https://config.example.test/nested/save?x=1#hash", "abc123"),
    "wss://config.example.test/property-lock?token=abc123"
  );
});

test("buildPropertyLockWssUrl preserves valid token query encoding", () => {
  assert.equal(
    buildPropertyLockWssUrl("https://example.test/remove", "token+value /?="),
    "wss://example.test/property-lock?token=token%2Bvalue%20%2F%3F%3D"
  );
});

test("buildPropertyLockWssUrl only downgrades http local endpoints to ws", () => {
  assert.equal(
    buildPropertyLockWssUrl("http://localhost:8787/load", "token"),
    "ws://localhost:8787/property-lock?token=token"
  );
  assert.equal(
    buildPropertyLockWssUrl("http://example.test/load", "token"),
    "wss://example.test/property-lock?token=token"
  );
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

test("content-main reconnects property lock after an unexpected active port disconnect", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /nextPort\.onDisconnect\.addListener\(\(\) => \{[\s\S]*?resetPropertyLockUiState\(\);[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?\}\);/
  );
});

test("content-main requests a reconnect when property lock activity or page commands have no active port", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function sendPropertyLockActivity\(\) \{[\s\S]*?if \(!propertyLockPort\) \{[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    source,
    /function sendPropertyLockMessage\(type, payload = \{\}\) \{[\s\S]*?if \(!propertyLockPort\) \{[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?return;[\s\S]*?\}/
  );
});

test("content-main connects property lock before Live Page candidate verification completes", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const syncStart = source.indexOf("async function syncPropertyLockConnection");
  const connectIndex = source.indexOf("type: PROPERTY_LOCK_CONTENT_CONNECT", syncStart);
  const candidateIndex = source.indexOf("resolvePropertyLockCandidateState(target)", syncStart);

  assert.ok(syncStart >= 0);
  assert.ok(connectIndex > syncStart);
  assert.ok(candidateIndex > connectIndex);
});
