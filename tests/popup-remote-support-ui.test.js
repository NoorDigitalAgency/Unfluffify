import test from "node:test";
import assert from "node:assert/strict";

import { PopupText } from "../common/text.js";
import { state } from "../popup/state.js";
import {
  handleRemoteSupportJoin,
  handleRemoteSupportJoinCodeInput,
  handleRemoteSupportRequest,
  syncRemoteSupportViewState
} from "../popup/remote-support-ui.js";

const REMOTE_SUPPORT_DOCK_STATE_EMBEDDED = "embedded";

function resetState() {
  state.currentTab = { id: 8, url: "https://example.com/page" };
  state.remoteSupportState = null;
  state.remoteSupportJoinCode = "";
  state.remoteSupportLastFrame = "";
  state.remoteSupportLocalCameraActive = false;
  state.remoteSupportRemoteCameraActive = false;
}

function createDeps(overrides = {}) {
  const calls = {
    viewState: [],
    toasts: [],
    messages: [],
    refreshes: 0,
    stoppedStreams: 0
  };

  const deps = {
    PopupText,
    REMOTE_SUPPORT_DOCK_STATE_EMBEDDED,
    shouldBlockRemoteSupportFeature: () => false,
    scopeRemoteSupportStateToTab: (remoteSupportState) => remoteSupportState || { active: false },
    buildRemoteSupportStatusText: () => "Connected",
    normalizeRemoteSupportDockState: (dockState) => dockState || REMOTE_SUPPORT_DOCK_STATE_EMBEDDED,
    formatRemoteSupportCountdown: () => "0:30",
    stopRemoteSupportCameraMediaStreams: () => {
      calls.stoppedStreams += 1;
    },
    requireRemoteSupportSetup: async () => ({
      tokenValue: "token",
      configEndpointValue: "https://api.example.com"
    }),
    sendRuntimeMessage: async (payload) => {
      calls.messages.push(payload);
      if (payload.type === "remoteSupportRequestCode") {
        return {
          ok: true,
          state: {
            active: true,
            mode: "being_supported",
            supportCode: "ABCD"
          }
        };
      }
      if (payload.type === "remoteSupportJoin") {
        return {
          ok: true,
          state: {
            active: true,
            mode: "supporting",
            supportCode: payload.supportCode
          }
        };
      }
      return { ok: false };
    },
    refreshUi: async () => {
      calls.refreshes += 1;
    },
    getViewState: () => ({
      remoteSupportJoinCode: state.remoteSupportJoinCode
    }),
    setViewState: (viewState) => {
      calls.viewState.push(viewState);
    },
    showToast: (message) => {
      calls.toasts.push(message);
    },
    syncRemoteSupportViewState: (remoteSupportState) => {
      syncRemoteSupportViewState(deps, remoteSupportState);
    },
    ...overrides
  };

  return { deps, calls };
}

test("popup remote-support-ui sync maps scoped state to popup view", () => {
  resetState();
  const { deps, calls } = createDeps({
    scopeRemoteSupportStateToTab: () => ({
      active: true,
      mode: "being_supported",
      role: "supportee",
      supportCode: "ABCD",
      connected: true,
      streaming: true,
      supporteeCameraAvailable: true,
      supporteeCameraEnabled: true,
      supporteeMicrophoneAvailable: false,
      supporteeMicrophoneEnabled: false,
      supporteeAudioAvailable: true,
      supporteeAudioEnabled: true,
      dockState: "pip",
      inactivityCountdownActive: true,
      inactivitySecondsRemaining: 25,
      error: ""
    }),
    normalizeRemoteSupportDockState: (value) => value,
    formatRemoteSupportCountdown: () => "0:25"
  });

  syncRemoteSupportViewState(deps, { active: true });

  assert.equal(calls.viewState.length > 0, true);
  assert.equal(calls.viewState[0].remoteSupportSessionActive, true);
  assert.equal(calls.viewState[0].remoteSupportCode, "ABCD");
  assert.equal(calls.viewState[0].remoteSupportInactivityCountdownText, "0:25");
});

test("popup remote-support-ui request delegates runtime transport and refreshes view", async () => {
  resetState();
  const { deps, calls } = createDeps();

  await handleRemoteSupportRequest(deps);

  assert.equal(calls.messages.some((item) => item.type === "remoteSupportRequestCode"), true);
  assert.equal(calls.refreshes, 1);
  assert.equal(calls.viewState.some((item) => Object.prototype.hasOwnProperty.call(item, "remoteSupportRequestLoading")), true);
});

test("popup remote-support-ui join-code input normalizes to uppercase", () => {
  resetState();
  const { deps, calls } = createDeps();

  handleRemoteSupportJoinCodeInput(deps, {
    target: { value: " ab12 " }
  });

  assert.equal(state.remoteSupportJoinCode, "AB12");
  assert.equal(calls.viewState.at(-1).remoteSupportJoinCode, "AB12");
});

test("popup remote-support-ui join enforces code and delegates join request", async () => {
  resetState();
  state.remoteSupportJoinCode = "JOIN1";
  const { deps, calls } = createDeps({
    getViewState: () => ({ remoteSupportJoinCode: "JOIN1" })
  });

  await handleRemoteSupportJoin(deps);

  assert.equal(calls.messages.some((item) => item.type === "remoteSupportJoin" && item.supportCode === "JOIN1"), true);
  assert.equal(calls.refreshes, 1);
  assert.equal(calls.toasts.length, 0);

  const { deps: missingCodeDeps, calls: missingCodeCalls } = createDeps({
    getViewState: () => ({ remoteSupportJoinCode: "" })
  });
  await handleRemoteSupportJoin(missingCodeDeps);
  assert.equal(missingCodeCalls.toasts.at(-1), PopupText.configuration.remoteSupportJoinCodePlaceholder);
});
