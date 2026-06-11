import test from "node:test";
import assert from "node:assert/strict";

import { createRemoteSupportStateHandler } from "../content/remote-support-state-handler.js";

function createDeps(overrides = {}) {
  const calls = {
    appliedStates: []
  };

  const deps = {
    applyRemoteSupportSessionState: (remoteSupportState) => {
      calls.appliedStates.push(remoteSupportState);
    },
    getRemoteSupportMode: () => "being_supported",
    getRemoteSupportRole: () => "viewer",
    ...overrides
  };

  return {
    calls,
    deps
  };
}

test("remote support state handler prefers nested state payload for remoteSupportState messages", () => {
  const { calls, deps } = createDeps();
  const handler = createRemoteSupportStateHandler(deps);
  const state = { active: true, sessionId: "abc" };

  const response = handler.handleMessage({ type: "remoteSupportState", state, ignored: true });

  assert.deepEqual(calls.appliedStates, [state]);
  assert.deepEqual(response, { ok: true, mode: "being_supported", role: "viewer" });
});

test("remote support state handler falls back to the message object for mode-change messages", () => {
  const { calls, deps } = createDeps({
    getRemoteSupportMode: () => "supporting",
    getRemoteSupportRole: () => "requester"
  });
  const handler = createRemoteSupportStateHandler(deps);
  const message = { type: "remoteSupportModeChanged", active: true };

  const response = handler.handleMessage(message);

  assert.deepEqual(calls.appliedStates, [message]);
  assert.deepEqual(response, { ok: true, mode: "supporting", role: "requester" });
});

test("remote support state handler applies null when no state payload is provided", () => {
  const { calls, deps } = createDeps();
  const handler = createRemoteSupportStateHandler(deps);
  const message = { type: "remoteSupportState", state: null };

  const response = handler.handleMessage(message);

  assert.deepEqual(calls.appliedStates, [message]);
  assert.deepEqual(response, { ok: true, mode: "being_supported", role: "viewer" });
});
