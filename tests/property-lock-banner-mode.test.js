import test from "node:test";
import assert from "node:assert/strict";

import { updatePropertyLockBannerMode } from "../content/property-lock-banner-mode.js";

function createDeps(overrides = {}) {
  let bannerMode = overrides.bannerMode || "no_banner";
  let countdownValue = Number.isFinite(overrides.countdownValue) ? overrides.countdownValue : 0;
  let clearCountdownCalls = 0;
  let restartCountdownCalls = 0;

  const deps = {
    isPropertyLockCollaborationEnabled: () => true,
    clearPropertyLockBannerCountdown: () => {
      clearCountdownCalls += 1;
    },
    restartPropertyLockBannerCountdown: () => {
      restartCountdownCalls += 1;
    },
    clearPropertyLockCrossPropertyWarning: () => {},
    clearPropertyLockOffCandidateWarning: () => {},
    getPropertyLockRecoveryDeadlineAt: () => 0,
    getPropertyLockOffCandidateDeadlineAt: () => 0,
    getPropertyLockState: () => null,
    getPropertyLockBannerMode: () => bannerMode,
    setPropertyLockBannerMode: (mode) => {
      bannerMode = mode;
    },
    getPropertyLockBannerCountdownValue: () => countdownValue,
    setPropertyLockBannerCountdownValue: (value) => {
      countdownValue = value;
    },
    PROPERTY_LOCK_STATE_UNLOCKED: "unlocked",
    PROPERTY_LOCK_STATE_LOCKED: "locked",
    PROPERTY_LOCK_STATE_EXPIRY_WARNING: "expiry_warning",
    PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE: "takeover_available",
    PROPERTY_LOCK_STATE_TRANSFER: "transfer",
    PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS: 70_000,
    ...overrides
  };

  return {
    deps,
    getBannerMode: () => bannerMode,
    getCountdownValue: () => countdownValue,
    getClearCountdownCalls: () => clearCountdownCalls,
    getRestartCountdownCalls: () => restartCountdownCalls
  };
}

test("property-lock banner mode: disabled feature sets no_banner and clears countdown", () => {
  const harness = createDeps({
    bannerMode: "passive_locked",
    countdownValue: 9,
    isPropertyLockCollaborationEnabled: () => false
  });

  updatePropertyLockBannerMode(harness.deps);

  assert.equal(harness.getBannerMode(), "no_banner");
  assert.equal(harness.getClearCountdownCalls(), 1);
  assert.equal(harness.getRestartCountdownCalls(), 0);
});

test("property-lock banner mode: recovery deadline sets editor_cross_property_countdown", () => {
  const now = Date.now();
  const harness = createDeps({
    getPropertyLockRecoveryDeadlineAt: () => now + 2500
  });

  updatePropertyLockBannerMode(harness.deps);

  assert.equal(harness.getBannerMode(), "editor_cross_property_countdown");
  assert.equal(harness.getCountdownValue(), 3);
  assert.equal(harness.getRestartCountdownCalls(), 1);
});

test("property-lock banner mode: unlocked state sets no_banner", () => {
  const harness = createDeps({
    getPropertyLockState: () => ({
      state: "unlocked",
      isEditor: false,
      secondsRemaining: null
    })
  });

  updatePropertyLockBannerMode(harness.deps);

  assert.equal(harness.getBannerMode(), "no_banner");
});

test("property-lock banner mode: editor expiry warning sets inactivity warning", () => {
  const harness = createDeps({
    getPropertyLockState: () => ({
      state: "expiry_warning",
      isEditor: true,
      secondsRemaining: null
    })
  });

  updatePropertyLockBannerMode(harness.deps);

  assert.equal(harness.getBannerMode(), "editor_inactivity_warning");
  assert.equal(harness.getCountdownValue(), 70);
  assert.equal(harness.getRestartCountdownCalls(), 1);
});

test("property-lock banner mode: passive locked state sets passive_locked", () => {
  const harness = createDeps({
    getPropertyLockState: () => ({
      state: "locked",
      isEditor: false,
      secondsRemaining: null
    })
  });

  updatePropertyLockBannerMode(harness.deps);

  assert.equal(harness.getBannerMode(), "passive_locked");
});
