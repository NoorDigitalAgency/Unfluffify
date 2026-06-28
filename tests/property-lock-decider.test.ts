import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { propertyLockText } from "../src/common/text.js";
import { createInactiveLockState } from "../src/common/property-lock.js";
import { derivePropertyLockViewState } from "../src/background/brain/deciders/property-lock-decider.js";
import {
  PROPERTY_LOCK_TIMER_KINDS,
  PROPERTY_LOCK_TIMER_SOURCES
} from "../src/common/bus/contracts/property-lock-state.js";

function createInput(overrides = {}) {
  return {
    propertyLockFeatureEnabled: true,
    propertyLockSiteId: 11,
    lockState: createInactiveLockState(),
    propertyLockConnectionStatus: "connected",
    propertyLockSecondsRemaining: null,
    propertyLockSuggestionFromName: "",
    propertyLockSuggestionVisible: false,
    propertyLockSuggestionPending: false,
    propertyLockSuggestionRejected: false,
    propertyLockInactivityWarningVisible: false,
    propertyLockDisconnectCountdown: null,
    propertyLockTransferCountdown: null,
    propertyLockOffCandidateDeadlineAt: 0,
    propertyLockRecoveryDeadlineAt: 0,
    renderModeInspectionActive: false,
    now: 100_000,
    ...overrides
  };
}

function createDeps(overrides = {}) {
  return {
    propertyLockText,
    PROPERTY_LOCK_CONNECTION_CONNECTING: "connecting",
    PROPERTY_LOCK_CONNECTION_UNAVAILABLE: "unavailable",
    PROPERTY_LOCK_STATE_UNLOCKED: "unlocked",
    PROPERTY_LOCK_STATE_LOCKED: "locked",
    PROPERTY_LOCK_STATE_EXPIRY_WARNING: "expiry_warning",
    PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE: "takeover_available",
    PROPERTY_LOCK_STATE_TRANSFER: "transfer",
    ...overrides
  };
}

test("property-lock decider derives deadline-backed countdown branches", () => {
  const crossProperty = derivePropertyLockViewState(
    createDeps(),
    createInput({
      propertyLockRecoveryDeadlineAt: 104_001
    })
  );
  assert.equal(crossProperty.timerState?.kind, PROPERTY_LOCK_TIMER_KINDS.CROSS_PROPERTY);
  assert.equal(crossProperty.timerState?.source, PROPERTY_LOCK_TIMER_SOURCES.DEADLINE);
  assert.equal(crossProperty.timerState?.secondsRemaining, 5);
  assert.equal(crossProperty.viewState.propertyLockStatusText, "Previous property held • editor role ends in 5s");

  const offCandidate = derivePropertyLockViewState(
    createDeps(),
    createInput({
      propertyLockOffCandidateDeadlineAt: 103_001
    })
  );
  assert.equal(offCandidate.timerState?.kind, PROPERTY_LOCK_TIMER_KINDS.OFF_CANDIDATE);
  assert.equal(offCandidate.timerState?.source, PROPERTY_LOCK_TIMER_SOURCES.DEADLINE);
  assert.equal(offCandidate.timerState?.secondsRemaining, 4);
  assert.equal(offCandidate.viewState.propertyLockStatusText, "Off candidate page • editor role ends in 4s");
});

test("property-lock decider preserves snapshot-backed branches without inventing deadlines", () => {
  const disconnectWarning = derivePropertyLockViewState(
    createDeps(),
    createInput({
      propertyLockDisconnectCountdown: 17
    })
  );
  assert.equal(disconnectWarning.timerState?.kind, PROPERTY_LOCK_TIMER_KINDS.DISCONNECT);
  assert.equal(disconnectWarning.timerState?.source, PROPERTY_LOCK_TIMER_SOURCES.SNAPSHOT);
  assert.equal(disconnectWarning.timerState?.deadlineAt, 0);
  assert.equal(disconnectWarning.viewState.propertyLockStatusText, "Connection lost. You will lose the editor role in 17s unless the connection recovers.");

  const passiveExpiry = derivePropertyLockViewState(
    createDeps(),
    createInput({
      lockState: {
        ...createInactiveLockState(),
        state: "expiry_warning",
        editorName: "Alex"
      },
      propertyLockSecondsRemaining: 9
    })
  );
  assert.equal(passiveExpiry.timerState?.kind, PROPERTY_LOCK_TIMER_KINDS.PASSIVE_EXPIRY);
  assert.equal(passiveExpiry.timerState?.source, PROPERTY_LOCK_TIMER_SOURCES.SNAPSHOT);
  assert.equal(passiveExpiry.viewState.propertyLockStatusText, "This property will be released for editing in 9s");
});
