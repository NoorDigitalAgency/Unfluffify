import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { FEATURE_DISABLED_REASON } from "../src/common/feature-flags.js";
import {
  PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
  PROPERTY_LOCK_CONNECTION_CONNECTED,
  PROPERTY_LOCK_CONNECTION_INACTIVE,
  PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
  PROPERTY_LOCK_STATE_LOCKED,
  PROPERTY_LOCK_STATE_UNLOCKED,
  PROPERTY_LOCK_WS_LOCK_STATE,
  createInactiveLockState
} from "../src/common/property-lock.js";
import { propertyLockText } from "../src/common/text.js";
import { state } from "../src/popup/state.js";
import {
  applyPropertyLockServerMessage,
  fetchPropertyLockState,
  isPropertyLockCollaborationEnabled,
  refreshPropertyLockSnapshot,
  sendPropertyLockCommand,
  syncPropertyLockOffCandidateRefreshTimer
} from "../src/popup/property-lock-ui.js";

function resetPropertyLockState() {
  state.propertyLockSiteId = null;
  state.propertyLockState = null;
  state.propertyLockConnectionStatus = PROPERTY_LOCK_CONNECTION_INACTIVE;
  state.propertyLockConnectionError = "";
  state.propertyLockIdentity = "";
  state.propertyLockClientId = "";
  state.currentTab = { id: 7 };
  state.currentDraftDirty = false;
  state.currentPageSaveReconciliationPending = false;
}

function createDeps(overrides = {}) {
  const calls = {
    toasts: [],
    messages: []
  };
  const deps = {
    FEATURE_DISABLED_REASON,
    propertyLockText,
    PROPERTY_LOCK_BACKGROUND_GET_STATE: "propertyLockGetState",
    PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
    PROPERTY_LOCK_CONNECTION_CONNECTED,
    PROPERTY_LOCK_CONNECTION_INACTIVE,
    PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
    PROPERTY_LOCK_WS_LOCK_STATE,
    PROPERTY_LOCK_WS_ERROR: "propertyLockError",
    PROPERTY_LOCK_WS_DISCONNECT_WARNING: "disconnectWarning",
    PROPERTY_LOCK_WS_INACTIVITY_WARNING: "inactivityWarning",
    PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION: "takeoverSuggestion",
    PROPERTY_LOCK_WS_SUGGESTION_PENDING: "suggestionPending",
    PROPERTY_LOCK_WS_SUGGESTION_RESPONSE: "suggestionResponse",
    PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED: "suggestionAccepted",
    PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN: "transferCountdown",
    PROPERTY_LOCK_STATE_UNLOCKED,
    PROPERTY_LOCK_STATE_LOCKED,
    PROPERTY_LOCK_STATE_EXPIRY_WARNING: "expiry_warning",
    PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE: "takeover_available",
    PROPERTY_LOCK_STATE_TRANSFER: "transfer",
    isFeatureEnabled: (name) => name === "propertyLockCollaboration",
    normalizeSiteIdValue: (siteId) => (Number.isFinite(Number(siteId)) ? Number(siteId) : null),
    createInactiveLockState,
    normalizeLockStateMessage: (message) => message,
    showToast: (message) => {
      calls.toasts.push(message);
    },
    applyPropertyLockConnectionStatus: () => {},
    applyPropertyLockState: () => {},
    queueEditorBootstrapOnLockTransition: () => {},
    resetDisabledPropertyLockState: () => {},
    clearPropertyLockTransientState: () => {},
    clearPropertyLockOffCandidateRefreshTimer: () => {
      state.propertyLockOffCandidateRefreshTimer = 0;
    },
    resetPropertyLockState: () => {
      state.propertyLockSiteId = null;
      state.propertyLockState = null;
    },
    setViewState: () => {},
    buildPropertyLockViewState: () => ({
      propertyLockVisible: false,
      propertyLockTone: "muted",
      propertyLockIcon: "lock-open-outline",
      propertyLockStatusText: "",
      propertyLockDetailText: "",
      propertyLockSuggestVisible: false,
      propertyLockTakeVisible: false,
      propertyLockTakeText: "",
      propertyLockContinueVisible: false,
      propertyLockContinueText: "",
      propertyLockContinueDisabled: false,
      propertyLockForceContinueVisible: false,
      propertyLockForceContinueText: "",
      propertyLockSuggestionVisible: false,
      propertyLockAcceptVisible: false,
      propertyLockRejectVisible: false
    }),
    refreshUi: async () => {},
    windowRef: {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis)
    },
    sendRuntimeMessage: async (payload) => {
      calls.messages.push(payload);
      return {
        state: { state: PROPERTY_LOCK_STATE_UNLOCKED, isEditor: true },
        connectionStatus: PROPERTY_LOCK_CONNECTION_CONNECTED,
        identity: "editor",
        clientId: "cid"
      };
    },
    refreshCurrentPageRuntimeStatus: async () => {},
    isPropertyLockCollaborationEnabled: () => true,
    fetchPropertyLockState: async () => ({
      state: { state: PROPERTY_LOCK_STATE_UNLOCKED, isEditor: true },
      connectionStatus: PROPERTY_LOCK_CONNECTION_CONNECTED,
      identity: "editor",
      clientId: "cid"
    }),
    ...overrides
  };
  return { deps, calls };
}

test("popup property-lock-ui feature gate checks collaboration flag", () => {
  const { deps } = createDeps();

  assert.equal(isPropertyLockCollaborationEnabled(deps), true);
  assert.equal(
    isPropertyLockCollaborationEnabled({ ...deps, isFeatureEnabled: () => false }),
    false
  );
});

test("popup property-lock-ui applies lock-state server payload and updates site scope", () => {
  resetPropertyLockState();
  const { deps } = createDeps({
    applyPropertyLockState: (message) => {
      state.propertyLockState = message;
    },
    queueEditorBootstrapOnLockTransition: () => {}
  });

  const applied = applyPropertyLockServerMessage(deps, {
    type: PROPERTY_LOCK_WS_LOCK_STATE,
    state: PROPERTY_LOCK_STATE_LOCKED,
    isEditor: false
  }, 11);

  assert.equal(applied, true);
  assert.equal(state.propertyLockSiteId, 11);
});

test("popup property-lock-ui fetch fallback returns disabled response when feature is off", async () => {
  resetPropertyLockState();
  const { deps } = createDeps({
    isPropertyLockCollaborationEnabled: () => false
  });

  const result = await fetchPropertyLockState(deps, 22);

  assert.equal(result.connectionStatus, PROPERTY_LOCK_CONNECTION_INACTIVE);
  assert.equal(result.error, FEATURE_DISABLED_REASON);
});

test("popup property-lock-ui snapshot refresh normalizes lock payload and connection status", async () => {
  resetPropertyLockState();
  const { deps } = createDeps({
    queueEditorBootstrapOnLockTransition: () => {},
    clearPropertyLockTransientState: () => {},
    applyPropertyLockConnectionStatus: (status, error) => {
      state.propertyLockConnectionStatus = status;
      state.propertyLockConnectionError = error;
    }
  });

  const lockState = await refreshPropertyLockSnapshot(deps, 30);

  assert.equal(state.propertyLockSiteId, 30);
  assert.equal(lockState.state, PROPERTY_LOCK_STATE_UNLOCKED);
  assert.equal(state.propertyLockConnectionStatus, PROPERTY_LOCK_CONNECTION_CONNECTED);
});

test("popup property-lock-ui command transport includes draft status and client hint", async () => {
  resetPropertyLockState();
  state.propertyLockSiteId = 44;
  state.propertyLockClientId = "client-7";
  state.currentDraftDirty = true;
  const { deps, calls } = createDeps();

  await sendPropertyLockCommand(deps, "propertyLockTake", { takeover: true });

  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].siteId, 44);
  assert.equal(calls.messages[0].clientId, "client-7");
  assert.equal(calls.messages[0].hasUnsavedChanges, true);
});

test("popup property-lock-ui deadline timer repaints locally and only refreshes on expiry", () => {
  resetPropertyLockState();
  state.propertyLockSiteId = 44;
  state.propertyLockOffCandidateDeadlineAt = 103_000;
  let tick = null;
  let setViewStateCalls = 0;
  let refreshCalls = 0;
  let clearCalls = 0;
  const originalNow = Date.now;
  Date.now = () => 100_000;
  try {
    const { deps } = createDeps({
      setViewState: () => {
        setViewStateCalls += 1;
      },
      refreshUi: async () => {
        refreshCalls += 1;
      },
      clearPropertyLockOffCandidateRefreshTimer: () => {
        clearCalls += 1;
        state.propertyLockOffCandidateRefreshTimer = 0;
      },
      windowRef: {
        setInterval: (callback) => {
          tick = callback;
          return 77;
        },
        clearInterval: () => {}
      }
    });

    syncPropertyLockOffCandidateRefreshTimer(deps, true);
    assert.equal(state.propertyLockOffCandidateRefreshTimer, 77);
    assert.ok(typeof tick === "function");

    tick();
    assert.equal(setViewStateCalls, 1);
    assert.equal(refreshCalls, 0);
    assert.equal(clearCalls, 0);

    Date.now = () => 104_000;
    tick();
    assert.equal(setViewStateCalls, 2);
    assert.equal(refreshCalls, 1);
    assert.equal(clearCalls, 1);
  } finally {
    Date.now = originalNow;
  }
});
