import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  DEBUG_FLAGS,
  FEATURE_DISABLED_REASON,
  FEATURE_FLAGS,
  getDebugFlags,
  getFeatureFlags,
  isDebugFlagEnabled,
  isFeatureEnabled
} from "../src/common/feature-flags.js";
import { DEVICE_EMULATION_PREFIX } from "../src/common/constants.js";
import { updateDeviceEmulation } from "../src/common/emulation.js";
import { isPopupFeatureEnabled } from "../src/popup/feature-flags-helpers.js";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

const EXPECTED_FLAGS = [
  "desktopPreview",
  "deviceEmulationToggle",
  "traceDiagnostics",
  "renderModeAutoDetection",
  "appearanceCustomization",
  "cacheAndUnregisterTools",
  "propertyLockCollaboration",
  "previewExpandedStates",
  "centralStateDictation"
];

const EXPECTED_DISABLED_FLAGS = EXPECTED_FLAGS.filter((flagName) => flagName !== "centralStateDictation");
const EXPECTED_DEBUG_FLAGS = [
  "ufDebugSpinnerQueue",
  "fullWorldMessagingLogging",
  "worldTraceEnabled",
  "swLifecycleDiagnostics"
];

test("feature flags expose the confirmed disabled stabilization set", () => {
  assert.equal(FEATURE_DISABLED_REASON, "feature_disabled");
  assert.deepEqual(Object.keys(FEATURE_FLAGS), EXPECTED_FLAGS);

  for (const flagName of EXPECTED_DISABLED_FLAGS) {
    assert.equal(FEATURE_FLAGS[flagName], false, `${flagName} should default disabled`);
    assert.equal(isFeatureEnabled(flagName), false, `${flagName} should not be enabled`);
  }
  assert.equal(FEATURE_FLAGS.centralStateDictation, true, "centralStateDictation should default enabled");
  assert.equal(isFeatureEnabled("centralStateDictation"), true, "centralStateDictation should be enabled");

  assert.deepEqual(Object.keys(DEBUG_FLAGS), EXPECTED_DEBUG_FLAGS);
  assert.equal(DEBUG_FLAGS.ufDebugSpinnerQueue, true);
  assert.equal(DEBUG_FLAGS.fullWorldMessagingLogging, false);
  assert.equal(DEBUG_FLAGS.worldTraceEnabled, false);
  assert.equal(DEBUG_FLAGS.swLifecycleDiagnostics, false);
  assert.equal(isDebugFlagEnabled("ufDebugSpinnerQueue"), true);
  assert.equal(isDebugFlagEnabled("fullWorldMessagingLogging"), false);
  assert.equal(isDebugFlagEnabled("worldTraceEnabled"), false);
  assert.equal(isDebugFlagEnabled("swLifecycleDiagnostics"), false);
});

test("unknown debug flags are disabled", () => {
  assert.equal(isDebugFlagEnabled(""), false);
  assert.equal(isDebugFlagEnabled("missingDebugFlag"), false);
  assert.equal(isDebugFlagEnabled("toString"), false);
});

test("unknown feature flags are disabled", () => {
  assert.equal(isFeatureEnabled(""), false);
  assert.equal(isFeatureEnabled("missingFeature"), false);
  assert.equal(isFeatureEnabled("toString"), false);
});

test("getDebugFlags returns an immutable resolved copy", () => {
  const flags = getDebugFlags();

  assert.notEqual(flags, DEBUG_FLAGS);
  assert.deepEqual(flags, DEBUG_FLAGS);
  assert.throws(() => {
    flags.ufDebugSpinnerQueue = false;
  }, TypeError);
  assert.equal(DEBUG_FLAGS.ufDebugSpinnerQueue, true);
  assert.equal(getDebugFlags().ufDebugSpinnerQueue, true);
});

test("getFeatureFlags returns an immutable copy", () => {
  const flags = getFeatureFlags();

  assert.notEqual(flags, FEATURE_FLAGS);
  assert.deepEqual(flags, FEATURE_FLAGS);
  assert.throws(() => {
    flags.desktopPreview = true;
  }, TypeError);
  assert.equal(FEATURE_FLAGS.desktopPreview, false);
  assert.equal(getFeatureFlags().desktopPreview, false);
});

test("popup UI helper treats missing and unknown flags as disabled", () => {
  assert.equal(isPopupFeatureEnabled({}, "desktopPreview"), false);
  assert.equal(isPopupFeatureEnabled({ featureFlags: {} }, "desktopPreview"), false);
  assert.equal(isPopupFeatureEnabled({ featureFlags: { desktopPreview: true } }, "desktopPreview"), true);
  assert.equal(isPopupFeatureEnabled({ featureFlags: { missingFeature: true } }, "missingFeature"), false);
});

test("disabled background-only commands still reply with feature-disabled responses", () => {
  assert.match(
    backgroundSource,
    /if \(message\.type === "clearBrowsingDataForOrigin"\) \{[\s\S]*?buildFeatureDisabledResponse\("cacheAndUnregisterTools"\)/
  );
  assert.match(
    backgroundSource,
    /if \(message\.type === "requestRenderModeDetection"\) \{[\s\S]*?buildFeatureDisabledResponse\("renderModeAutoDetection"\)/
  );
  assert.match(
    backgroundSource,
    /if \(message\.type === "unregisterTabAndReload"\) \{[\s\S]*?buildFeatureDisabledResponse\("cacheAndUnregisterTools"\)/
  );
});

test("device emulation rejects disabled feature-gated updates without mutating stored state", async () => {
  const tabId = 71;
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const storageData = {
    [key]: {
      enabled: true,
      mode: "mobile",
      scale: 0.8,
    },
  };
  const browserMock = {
    runtime: {
      id: "test-extension",
    },
    storage: {
      session: {
        async get(keys) {
          const normalizedKeys = Array.isArray(keys) ? keys : [keys];
          const result = {};
          normalizedKeys.forEach((candidateKey) => {
            if (Object.prototype.hasOwnProperty.call(storageData, candidateKey)) {
              result[candidateKey] = storageData[candidateKey];
            }
          });
          return result;
        },
        async set(items) {
          Object.assign(storageData, items || {});
        },
        async remove(keys) {
          const normalizedKeys = Array.isArray(keys) ? keys : [keys];
          normalizedKeys.forEach((candidateKey) => {
            delete storageData[candidateKey];
          });
        },
      },
    },
    debugger: {
      async attach() {
        throw new Error("attach should not run for disabled feature gates");
      },
      async sendCommand() {
        throw new Error("sendCommand should not run for disabled feature gates");
      },
      async detach() {
        throw new Error("detach should not run for disabled feature gates");
      },
    },
  };
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;

  globalThis.browser = browserMock;
  delete globalThis.chrome;

  try {
    const disableResult = await updateDeviceEmulation(tabId, { enabled: false });
    assert.deepEqual(disableResult, {
      ok: false,
      error: "Feature disabled",
      reason: FEATURE_DISABLED_REASON,
      feature: "deviceEmulationToggle",
      state: storageData[key],
    });

    const desktopResult = await updateDeviceEmulation(tabId, { enabled: true, mode: "desktop" });
    assert.deepEqual(desktopResult, {
      ok: false,
      error: "Feature disabled",
      reason: FEATURE_DISABLED_REASON,
      feature: "desktopPreview",
      state: storageData[key],
    });

    assert.deepEqual(storageData[key], {
      enabled: true,
      mode: "mobile",
      scale: 0.8,
    });
  } finally {
    if (typeof originalBrowser === "undefined") {
      delete globalThis.browser;
    } else {
      globalThis.browser = originalBrowser;
    }
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
  }
});
