import test from "node:test";
import assert from "node:assert/strict";

import {
  REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS,
  REMOTE_SUPPORT_INACTIVITY_WARNING_WINDOW_MS,
  REMOTE_SUPPORT_FRAME_INTERVAL_MS,
  REMOTE_SUPPORT_PAYLOAD_MAX_BYTES,
  REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES,
  REMOTE_SUPPORT_PAGE_PATH,
  REMOTE_SUPPORT_MODE_INACTIVE,
  REMOTE_SUPPORT_MODE_SUPPORTING,
  REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
  REMOTE_SUPPORT_ROLE_SUPPORTER,
  REMOTE_SUPPORT_ROLE_REQUESTER,
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED,
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
  REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP,
  REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE,
  createInactiveRemoteSupportState,
  formatRemoteSupportCountdown,
  getRemoteSupportDockFallbackState,
  getRemoteSupportPageUrl,
  isRemoteSupportStateForTab,
  isRemoteSupportPageUrl,
  isAjaxResourceType,
  normalizeRemoteSupportDockState,
  normalizeRemoteSupportCode,
  resolveEndpointUrl,
  scopeRemoteSupportStateToTab,
  serializeRemoteSupportMessage,
  parseRemoteSupportMessage,
  shouldShowRemoteSupportPopupJoin,
  shouldLockRemoteSupportConfigurationView,
  clampPayloadSize
} from "../common/remote-support.js";

// ──────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────

test("inactivity timeout is 10 minutes in ms", () => {
  assert.equal(REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS, 10 * 60 * 1000);
});

test("inactivity warning window is 1 minute in ms", () => {
  assert.equal(REMOTE_SUPPORT_INACTIVITY_WARNING_WINDOW_MS, 60 * 1000);
});

test("frame interval is 250 ms", () => {
  assert.equal(REMOTE_SUPPORT_FRAME_INTERVAL_MS, 250);
});

test("per-payload max is 2 MB", () => {
  assert.equal(REMOTE_SUPPORT_PAYLOAD_MAX_BYTES, 2 * 1024 * 1024);
});

test("total payload budget is 10 MB", () => {
  assert.equal(REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES, 10 * 1024 * 1024);
});

// ──────────────────────────────────────────────────────────────
// createInactiveRemoteSupportState
// ──────────────────────────────────────────────────────────────

test("createInactiveRemoteSupportState returns the correct inactive shape", () => {
  const state = createInactiveRemoteSupportState();
  assert.equal(state.active, false);
  assert.equal(state.mode, REMOTE_SUPPORT_MODE_INACTIVE);
  assert.equal(state.role, "");
  assert.equal(state.tabId, null);
  assert.equal(state.sessionId, "");
  assert.equal(state.supportCode, "");
  assert.equal(state.expiresAt, "");
  assert.equal(state.includePayloads, false);
  assert.equal(state.connected, false);
  assert.equal(state.streaming, false);
  assert.equal(state.partnerConnected, false);
  assert.equal(state.dockState, REMOTE_SUPPORT_DOCK_STATE_EMBEDDED);
  assert.equal(state.error, "");
  assert.equal(state.lastActivityAt, 0);
  assert.equal(state.inactivityCountdownActive, false);
  assert.equal(state.inactivitySecondsRemaining, 0);
});

test("createInactiveRemoteSupportState returns a fresh object each call", () => {
  const a = createInactiveRemoteSupportState();
  const b = createInactiveRemoteSupportState();
  assert.notEqual(a, b);
  a.sessionId = "mutated";
  assert.equal(b.sessionId, "");
});

// ──────────────────────────────────────────────────────────────
// isAjaxResourceType
// ──────────────────────────────────────────────────────────────

test("isAjaxResourceType recognizes xmlhttprequest (case-insensitive)", () => {
  assert.equal(isAjaxResourceType("xmlhttprequest"), true);
  assert.equal(isAjaxResourceType("XMLHttpRequest"), true);
  assert.equal(isAjaxResourceType("XMLHTTPREQUEST"), true);
});

test("isAjaxResourceType recognizes fetch (case-insensitive)", () => {
  assert.equal(isAjaxResourceType("fetch"), true);
  assert.equal(isAjaxResourceType("Fetch"), true);
  assert.equal(isAjaxResourceType("FETCH"), true);
});

test("isAjaxResourceType recognizes xhr alias", () => {
  assert.equal(isAjaxResourceType("xhr"), true);
  assert.equal(isAjaxResourceType("XHR"), true);
});

test("isAjaxResourceType rejects non-AJAX types", () => {
  assert.equal(isAjaxResourceType("script"), false);
  assert.equal(isAjaxResourceType("stylesheet"), false);
  assert.equal(isAjaxResourceType("image"), false);
  assert.equal(isAjaxResourceType(""), false);
  assert.equal(isAjaxResourceType(null), false);
  assert.equal(isAjaxResourceType(undefined), false);
});

// ──────────────────────────────────────────────────────────────
// normalizeRemoteSupportCode
// ──────────────────────────────────────────────────────────────

test("normalizeRemoteSupportCode trims surrounding whitespace", () => {
  assert.equal(normalizeRemoteSupportCode("  123456  "), "123456");
});

test("normalizeRemoteSupportCode collapses internal whitespace", () => {
  assert.equal(normalizeRemoteSupportCode("12 34 56"), "123456");
});

test("normalizeRemoteSupportCode clamps to 32 characters", () => {
  const long = "A".repeat(40);
  assert.equal(normalizeRemoteSupportCode(long).length, 32);
});

test("normalizeRemoteSupportCode returns empty string for falsy values", () => {
  assert.equal(normalizeRemoteSupportCode(""), "");
  assert.equal(normalizeRemoteSupportCode(null), "");
  assert.equal(normalizeRemoteSupportCode(undefined), "");
});

// ──────────────────────────────────────────────────────────────
// resolveEndpointUrl
// ──────────────────────────────────────────────────────────────

test("resolveEndpointUrl appends path to base without trailing slash", () => {
  assert.equal(
    resolveEndpointUrl("https://api.example.com", "/request-support"),
    "https://api.example.com/request-support"
  );
});

test("resolveEndpointUrl strips trailing slash from base before appending", () => {
  assert.equal(
    resolveEndpointUrl("https://api.example.com/v1/", "/support"),
    "https://api.example.com/v1/support"
  );
});

test("resolveEndpointUrl works when path has no leading slash", () => {
  assert.equal(
    resolveEndpointUrl("https://api.example.com", "support"),
    "https://api.example.com/support"
  );
});

test("resolveEndpointUrl strips query and hash from base", () => {
  assert.equal(
    resolveEndpointUrl("https://api.example.com/v1?token=abc#frag", "/webrtc"),
    "https://api.example.com/v1/webrtc"
  );
});

test("resolveEndpointUrl returns empty string when baseUrl is falsy", () => {
  assert.equal(resolveEndpointUrl("", "/path"), "");
  assert.equal(resolveEndpointUrl(null, "/path"), "");
});

test("resolveEndpointUrl returns empty string when path is falsy", () => {
  assert.equal(resolveEndpointUrl("https://api.example.com", ""), "");
  assert.equal(resolveEndpointUrl("https://api.example.com", null), "");
});

test("resolveEndpointUrl returns empty string for an invalid base URL", () => {
  assert.equal(resolveEndpointUrl("not-a-url", "/path"), "");
});

test("remote support page path is /support", () => {
  assert.equal(REMOTE_SUPPORT_PAGE_PATH, "/support");
});

test("getRemoteSupportPageUrl resolves the support page from the configured endpoint", () => {
  assert.equal(
    getRemoteSupportPageUrl("https://api.example.com"),
    "https://api.example.com/support"
  );
});

test("isRemoteSupportPageUrl matches the configured support page URL", () => {
  assert.equal(
    isRemoteSupportPageUrl("https://api.example.com/support", "https://api.example.com"),
    true
  );
});

test("isRemoteSupportPageUrl ignores query strings and trailing slashes on the current tab URL", () => {
  assert.equal(
    isRemoteSupportPageUrl("https://api.example.com/support/?code=123456", "https://api.example.com"),
    true
  );
});

test("isRemoteSupportPageUrl rejects unrelated origins and paths", () => {
  assert.equal(
    isRemoteSupportPageUrl("https://www.example.com/support", "https://api.example.com"),
    false
  );
  assert.equal(
    isRemoteSupportPageUrl("https://api.example.com/help", "https://api.example.com"),
    false
  );
});

test("isRemoteSupportStateForTab matches only the owning tab", () => {
  assert.equal(isRemoteSupportStateForTab({ active: true, tabId: 22 }, 22), true);
  assert.equal(isRemoteSupportStateForTab({ active: true, tabId: 22 }, 23), false);
});

test("scopeRemoteSupportStateToTab hides active session data from unrelated tabs", () => {
  const scoped = scopeRemoteSupportStateToTab({
    active: true,
    mode: REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
    role: REMOTE_SUPPORT_ROLE_REQUESTER,
    tabId: 9,
    supportCode: "123456",
    connected: true,
    error: ""
  }, 10);

  assert.equal(scoped.active, false);
  assert.equal(scoped.mode, REMOTE_SUPPORT_MODE_INACTIVE);
  assert.equal(scoped.supportCode, "");
  assert.equal(scoped.connected, false);
});

test("scopeRemoteSupportStateToTab keeps the session for the owning tab", () => {
  const scoped = scopeRemoteSupportStateToTab({
    active: true,
    mode: REMOTE_SUPPORT_MODE_SUPPORTING,
    role: REMOTE_SUPPORT_ROLE_SUPPORTER,
    tabId: 11,
    supportCode: "654321",
    connected: true,
    streaming: false,
    includePayloads: true,
    error: ""
  }, 11);

  assert.equal(scoped.active, true);
  assert.equal(scoped.mode, REMOTE_SUPPORT_MODE_SUPPORTING);
  assert.equal(scoped.role, REMOTE_SUPPORT_ROLE_SUPPORTER);
  assert.equal(scoped.supportCode, "654321");
  assert.equal(scoped.connected, true);
  assert.equal(scoped.includePayloads, true);
});

test("shouldLockRemoteSupportConfigurationView only locks the support page before the session starts", () => {
  assert.equal(shouldLockRemoteSupportConfigurationView(true, null, 3), true);
  assert.equal(
    shouldLockRemoteSupportConfigurationView(true, { active: true, tabId: 3 }, 3),
    false
  );
  assert.equal(
    shouldLockRemoteSupportConfigurationView(false, { active: false, tabId: 3 }, 3),
    false
  );
});

test("normalizeRemoteSupportDockState keeps known dock states and defaults unknown values", () => {
  assert.equal(normalizeRemoteSupportDockState(REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP), REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP);
  assert.equal(normalizeRemoteSupportDockState(REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED), REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED);
  assert.equal(normalizeRemoteSupportDockState(REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE), REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE);
  assert.equal(normalizeRemoteSupportDockState("unknown"), REMOTE_SUPPORT_DOCK_STATE_EMBEDDED);
});

test("getRemoteSupportDockFallbackState restores embedded minimized when PiP or fullscreen closes", () => {
  assert.equal(getRemoteSupportDockFallbackState(REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP), REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED);
  assert.equal(getRemoteSupportDockFallbackState(REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE), REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED);
  assert.equal(getRemoteSupportDockFallbackState(REMOTE_SUPPORT_DOCK_STATE_EMBEDDED), REMOTE_SUPPORT_DOCK_STATE_EMBEDDED);
});

test("shouldShowRemoteSupportPopupJoin only shows join controls on the support page before a session starts", () => {
  assert.equal(shouldShowRemoteSupportPopupJoin(true, { active: false }), true);
  assert.equal(shouldShowRemoteSupportPopupJoin(true, { active: true }), false);
  assert.equal(shouldShowRemoteSupportPopupJoin(false, { active: false }), false);
});

test("formatRemoteSupportCountdown returns m:ss countdown text", () => {
  assert.equal(formatRemoteSupportCountdown(59), "0:59");
  assert.equal(formatRemoteSupportCountdown(60), "1:00");
  assert.equal(formatRemoteSupportCountdown(-5), "0:00");
});

// ──────────────────────────────────────────────────────────────
// serializeRemoteSupportMessage / parseRemoteSupportMessage
// ──────────────────────────────────────────────────────────────

test("serializeRemoteSupportMessage produces valid JSON with required fields", () => {
  const before = Date.now();
  const raw = serializeRemoteSupportMessage("offer", { sdp: "..." });
  const after = Date.now();
  const parsed = JSON.parse(raw);
  assert.equal(parsed.type, "offer");
  assert.deepEqual(parsed.payload, { sdp: "..." });
  assert.ok(parsed.timestamp >= before && parsed.timestamp <= after);
});

test("serializeRemoteSupportMessage defaults payload to empty object", () => {
  const parsed = JSON.parse(serializeRemoteSupportMessage("register"));
  assert.deepEqual(parsed.payload, {});
});

test("parseRemoteSupportMessage round-trips a serialized message", () => {
  const raw = serializeRemoteSupportMessage("ice", { candidate: "x" });
  const result = parseRemoteSupportMessage(raw);
  assert.equal(result.type, "ice");
  assert.deepEqual(result.payload, { candidate: "x" });
});

test("parseRemoteSupportMessage returns null for non-string input", () => {
  assert.equal(parseRemoteSupportMessage(42), null);
  assert.equal(parseRemoteSupportMessage(null), null);
  assert.equal(parseRemoteSupportMessage(undefined), null);
  assert.equal(parseRemoteSupportMessage({}), null);
});

test("parseRemoteSupportMessage returns null for invalid JSON", () => {
  assert.equal(parseRemoteSupportMessage("{not valid json"), null);
});

test("parseRemoteSupportMessage returns null when type field is missing", () => {
  assert.equal(parseRemoteSupportMessage(JSON.stringify({ payload: {} })), null);
});

test("parseRemoteSupportMessage returns null when type is not a string", () => {
  assert.equal(parseRemoteSupportMessage(JSON.stringify({ type: 42, payload: {} })), null);
});

test("parseRemoteSupportMessage returns null for a plain JSON string", () => {
  assert.equal(parseRemoteSupportMessage('"just a string"'), null);
});

// ──────────────────────────────────────────────────────────────
// clampPayloadSize
// ──────────────────────────────────────────────────────────────

test("clampPayloadSize returns the value unchanged when it fits within the budget", () => {
  assert.equal(clampPayloadSize("hello", 100), "hello");
});

test("clampPayloadSize returns empty string for empty input", () => {
  assert.equal(clampPayloadSize("", 100), "");
});

test("clampPayloadSize returns empty string for non-string input", () => {
  assert.equal(clampPayloadSize(null, 100), "");
  assert.equal(clampPayloadSize(undefined, 100), "");
  assert.equal(clampPayloadSize(42, 100), "");
});

test("clampPayloadSize truncates ASCII text to the exact byte budget", () => {
  const input = "A".repeat(20);
  const result = clampPayloadSize(input, 10);
  assert.equal(result.length, 10);
  assert.ok(new TextEncoder().encode(result).length <= 10);
});

test("clampPayloadSize handles multibyte characters correctly", () => {
  // Each '€' is 3 UTF-8 bytes. With a 9-byte budget we can fit 3 '€' characters.
  const input = "€".repeat(10);
  const result = clampPayloadSize(input, 9);
  assert.equal(result, "€€€");
  assert.ok(new TextEncoder().encode(result).length <= 9);
});

test("clampPayloadSize does not split a multibyte character mid-sequence", () => {
  // '€' = 3 bytes. A 10-byte budget fits 3 '€' (9 bytes), not 3.33.
  const input = "€".repeat(5);
  const result = clampPayloadSize(input, 10);
  assert.equal(result, "€€€");
  const encoded = new TextEncoder().encode(result);
  assert.ok(encoded.length <= 10);
});

test("clampPayloadSize uses UTF-8 byte count, not character count, for the limit", () => {
  // 4 ASCII + 1 multibyte '€' (3 bytes) = 7 bytes total. Budget of 6 bytes drops the '€'.
  const input = "abcd€";
  const result = clampPayloadSize(input, 6);
  assert.equal(result, "abcd");
  assert.ok(new TextEncoder().encode(result).length <= 6);
});

test("clampPayloadSize with a zero budget returns empty string", () => {
  assert.equal(clampPayloadSize("hello", 0), "");
});

test("clampPayloadSize with a budget exactly equal to the string byte length returns the full string", () => {
  const input = "hello";
  const byteLen = new TextEncoder().encode(input).length;
  assert.equal(clampPayloadSize(input, byteLen), input);
});
