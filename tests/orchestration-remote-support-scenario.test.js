import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOneMachineMediaGate,
  getRemoteSupportCodeFromState,
  getRemoteSupportRuntimeState,
  isRemoteSupportActiveWithRole
} from "../orchestration/scenarios/remote-support-one-machine.mjs";

test("remote-support scenario extracts runtime state and support code", () => {
  const state = {
    remoteSupportState: {
      ok: true,
      state: {
        active: true,
        role: "requester",
        supportCode: "123456"
      }
    }
  };

  assert.deepEqual(getRemoteSupportRuntimeState(state), {
    active: true,
    role: "requester",
    supportCode: "123456"
  });
  assert.equal(getRemoteSupportCodeFromState(state), "123456");
});

test("remote-support scenario matches active role exactly", () => {
  const requesterState = {
    remoteSupportState: {
      state: {
        active: true,
        role: "requester"
      }
    }
  };

  assert.equal(isRemoteSupportActiveWithRole(requesterState, "requester"), true);
  assert.equal(isRemoteSupportActiveWithRole(requesterState, "supporter"), false);
  assert.equal(isRemoteSupportActiveWithRole({
    remoteSupportState: {
      state: {
        active: false,
        role: "requester"
      }
    }
  }, "requester"), false);
});

test("remote-support scenario marks same-host media assertions as gated", () => {
  assert.deepEqual(buildOneMachineMediaGate("two host only"), {
    screenShareVisible: {
      ok: false,
      skipped: true,
      reason: "two host only"
    },
    viewOnlyMirror: {
      ok: false,
      skipped: true,
      reason: "two host only"
    },
    devtoolsMirror: {
      ok: false,
      skipped: true,
      reason: "two host only"
    }
  });
});
