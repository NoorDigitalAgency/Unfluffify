import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPropertyLockIdentityDiagnostics,
  getPropertyLockIdentityFromState,
  hasPopupButton,
  isEditorPopupState,
  isPassiveLockPopupState
} from "../orchestration/scenarios/property-lock-one-machine.mjs";

test("property-lock scenario classifies editor and passive popup states", () => {
  assert.equal(isEditorPopupState({
    propertyLockStatus: "You are editing this property"
  }), true);
  assert.equal(isEditorPopupState({
    propertyLockStatus: "Someone is currently editing this property"
  }), false);
  assert.equal(isPassiveLockPopupState({
    propertyLockStatus: "Someone is currently editing this property",
    propertyLockDetail: "Marking controls are paused until you take over or the lock is released."
  }), true);
});

test("property-lock scenario matches popup action labels", () => {
  assert.equal(hasPopupButton({
    propertyLockButtons: ["Suggest to take over", "Cancel"]
  }, /suggest to take over/i), true);
  assert.equal(hasPopupButton({
    propertyLockButtons: ["Accept", "Reject"]
  }, /take over/i), false);
});

test("property-lock scenario extracts release identity from initial tab state", () => {
  const identity = getPropertyLockIdentityFromState({
    tabId: 42,
    tabState: {
      raw: {
        "tabState:initial:42": {
          propertyLockRecoverySiteId: 5542,
          propertyLockRecoveryClientId: "client-1",
          propertyLockRecoveryBaseUrl: "https://example.test"
        }
      }
    }
  });

  test("property-lock scenario tolerates null state values", () => {
    assert.deepEqual(getPropertyLockIdentityFromState(null), {
      siteId: null,
      clientId: "",
      baseUrl: ""
    });
    assert.deepEqual(buildPropertyLockIdentityDiagnostics(null, null), {
      director: {
        isEditor: false,
        identity: {
          siteId: null,
          clientId: "",
          baseUrl: ""
        }
      },
      follower: {
        isEditor: false,
        identity: {
          siteId: null,
          clientId: "",
          baseUrl: ""
        }
      },
      sameSiteId: false,
      sameBaseUrl: false,
      sameClientId: false,
      bothEditor: false
    });
  });

  assert.deepEqual(identity, {
    siteId: 5542,
    clientId: "client-1",
    baseUrl: "https://example.test"
  });
});

test("property-lock scenario reports duplicate-editor identity diagnostics", () => {
  const directorState = {
    tabId: 11,
    popupState: {
      propertyLockStatus: "You are editing this property"
    },
    tabState: {
      raw: {
        "tabState:initial:11": {
          propertyLockRecoverySiteId: 5273,
          propertyLockRecoveryClientId: "director-client",
          propertyLockRecoveryBaseUrl: "https://prowork.se"
        }
      }
    }
  };
  const followerState = {
    tabId: 22,
    popupState: {
      propertyLockStatus: "You are editing this property"
    },
    tabState: {
      raw: {
        "tabState:initial:22": {
          propertyLockRecoverySiteId: 5273,
          propertyLockRecoveryClientId: "follower-client",
          propertyLockRecoveryBaseUrl: "https://prowork.se"
        }
      }
    }
  };

  assert.deepEqual(buildPropertyLockIdentityDiagnostics(directorState, followerState), {
    director: {
      isEditor: true,
      identity: {
        siteId: 5273,
        clientId: "director-client",
        baseUrl: "https://prowork.se"
      }
    },
    follower: {
      isEditor: true,
      identity: {
        siteId: 5273,
        clientId: "follower-client",
        baseUrl: "https://prowork.se"
      }
    },
    sameSiteId: true,
    sameBaseUrl: true,
    sameClientId: false,
    bothEditor: true
  });
});
