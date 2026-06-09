import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEBUG_FLAGS,
  FEATURE_DISABLED_REASON,
  FEATURE_FLAGS,
  getDebugFlags,
  getFeatureFlags,
  isDebugFlagEnabled,
  isFeatureEnabled
} from "../common/feature-flags.js";
import { isPopupFeatureEnabled } from "../popup/ui.js";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popupUiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const contentMainSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
const emulationSource = readFileSync(new URL("../common/emulation.js", import.meta.url), "utf8");

const EXPECTED_FLAGS = [
  "remoteSupport",
  "desktopPreview",
  "deviceEmulationToggle",
  "traceDiagnostics",
  "renderModeAutoDetection",
  "appearanceCustomization",
  "cacheAndUnregisterTools",
  "propertyLockCollaboration",
  "previewExpandedStates"
];

const EXPECTED_DISABLED_FLAGS = [...EXPECTED_FLAGS];
const EXPECTED_DEBUG_FLAGS = [
  "ufDebugSpinnerQueue",
  "fullWorldMessagingLogging",
  "worldTraceEnabled"
];

test("feature flags expose the confirmed disabled stabilization set", () => {
  assert.equal(FEATURE_DISABLED_REASON, "feature_disabled");
  assert.deepEqual(Object.keys(FEATURE_FLAGS), EXPECTED_FLAGS);

  for (const flagName of EXPECTED_DISABLED_FLAGS) {
    assert.equal(FEATURE_FLAGS[flagName], false, `${flagName} should default disabled`);
    assert.equal(isFeatureEnabled(flagName), false, `${flagName} should not be enabled`);
  }

  assert.deepEqual(Object.keys(DEBUG_FLAGS), EXPECTED_DEBUG_FLAGS);
  assert.equal(DEBUG_FLAGS.ufDebugSpinnerQueue, true);
  assert.equal(DEBUG_FLAGS.fullWorldMessagingLogging, false);
  assert.equal(DEBUG_FLAGS.worldTraceEnabled, false);
  assert.equal(isDebugFlagEnabled("ufDebugSpinnerQueue"), true);
  assert.equal(isDebugFlagEnabled("fullWorldMessagingLogging"), false);
  assert.equal(isDebugFlagEnabled("worldTraceEnabled"), false);
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
    flags.remoteSupport = true;
  }, TypeError);
  assert.equal(FEATURE_FLAGS.remoteSupport, false);
  assert.equal(getFeatureFlags().remoteSupport, false);
});

test("popup refresh exposes a feature flag snapshot in view state", () => {
  assert.match(popupSource, /FEATURE_DISABLED_REASON,[\s\S]*?getFeatureFlags,[\s\S]*?isFeatureEnabled/);
  assert.match(popupSource, /featureFlags: getFeatureFlags\(\),/);
});

test("popup UI helper treats missing and unknown flags as disabled", () => {
  assert.match(popupUiSource, /featureFlags: FEATURE_FLAGS,/);
  assert.match(popupUiSource, /export function isPopupFeatureEnabled\(view, flagName\) \{/);

  assert.equal(isPopupFeatureEnabled({}, "remoteSupport"), false);
  assert.equal(isPopupFeatureEnabled({ featureFlags: {} }, "remoteSupport"), false);
  assert.equal(isPopupFeatureEnabled({ featureFlags: { remoteSupport: true } }, "remoteSupport"), true);
  assert.equal(isPopupFeatureEnabled({ featureFlags: { missingFeature: true } }, "missingFeature"), false);
});

test("low-risk optional popup extras are gated by disabled flags", () => {
  assert.match(
    popupUiSource,
    /if \(isPopupFeatureEnabled\(view, "appearanceCustomization"\)\) \{[\s\S]*?sections\.push\(renderConfigurationAppearanceSection\(view, handlers\)\);/
  );
  assert.match(
    popupUiSource,
    /if \(isPopupFeatureEnabled\(view, "traceDiagnostics"\)\) \{[\s\S]*?id: "trace-mode-enabled"/
  );
  assert.match(
    popupUiSource,
    /isPopupFeatureEnabled\(view, "previewExpandedStates"\)[\s\S]*?type: "checkbox"[\s\S]*?onChange: handlers\.onPreviewShowAllCategoriesChange[\s\S]*?: null/
  );
  assert.match(popupUiSource, /if \(!sections\.length\) \{\s*return null;\s*\}/);
});

test("disabled optional state cannot leak through hidden controls", () => {
  assert.match(popupSource, /function isWorldTraceEnabled\(\) \{\s*return isFeatureEnabled\("traceDiagnostics"\) && isDebugFlagEnabled\("worldTraceEnabled"\);\s*\}/);
  assert.match(popupSource, /async function loadTraceModeSetting\(\) \{\s*return isFeatureEnabled\("traceDiagnostics"\) && isDebugFlagEnabled\("worldTraceEnabled"\);\s*\}/);
  assert.match(popupSource, /async function applyTraceModePreferenceToTab\(tabId, enabled\) \{[\s\S]*?if \(!isFeatureEnabled\("traceDiagnostics"\)\) \{[\s\S]*?traceModeEnabled: false[\s\S]*?return null;/);
  assert.match(popupSource, /type: WORLD_MESSAGE_TYPES\.GET_BACKGROUND_STATE,/);
  assert.match(
    backgroundSource,
    /function isWorldTraceEnabled\(\) \{\s*return isFeatureEnabled\("traceDiagnostics"\) && isDebugFlagEnabled\("worldTraceEnabled"\);\s*\}/
  );
  assert.doesNotMatch(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.TRACE_SET\) \{/);

  assert.match(popupSource, /function resetDisabledAppearanceCustomization\(\) \{[\s\S]*?state\.currentTheme = THEME_DEFAULT;[\s\S]*?state\.currentThemeMode = THEME_MODE_DEFAULT;[\s\S]*?applyPopupTheme\(state\.currentTheme, state\.currentThemeMode\);/);
  assert.match(popupSource, /async function ensureThemeSettings\(\) \{\s*if \(!isFeatureEnabled\("appearanceCustomization"\)\) \{[\s\S]*?resetDisabledAppearanceCustomization\(\);[\s\S]*?return;/);
  assert.match(popupSource, /async function applyThemeValue\(nextThemeValue\) \{\s*if \(!isFeatureEnabled\("appearanceCustomization"\)\) \{/);
  assert.match(popupSource, /const appearanceCustomizationEnabled = isFeatureEnabled\("appearanceCustomization"\);[\s\S]*?if \(!appearanceCustomizationEnabled && \(changes\[GLOBAL_THEME_KEY\] \|\| changes\[GLOBAL_THEME_MODE_KEY\]\)\) \{/);

  assert.match(contentMainSource, /FEATURE_DISABLED_REASON,[\s\S]*?isFeatureEnabled/);
  assert.match(contentMainSource, /function setAiPreviewExpandedMode\(active\) \{\s*if \(!isFeatureEnabled\("previewExpandedStates"\)\) \{[\s\S]*?aiPreviewState\.showAllCategories = false;[\s\S]*?return false;/);
  assert.match(contentMainSource, /if \(message\.type === "setAiPreviewExpandedMode"\) \{[\s\S]*?if \(!isFeatureEnabled\("previewExpandedStates"\)\) \{[\s\S]*?reason: FEATURE_DISABLED_REASON,[\s\S]*?feature: "previewExpandedStates"/);
});

test("desktop preview and manual device switching are gated at runtime", () => {
  assert.match(
    popupSource,
    /const normalizedEnabled = isFeatureEnabled\("desktopPreview"\) && Boolean\(enabled\);[\s\S]*?desktopPreviewEnabled: normalizedEnabled/
  );
  assert.match(
    popupSource,
    /const desktopPreviewFeatureEnabled = isFeatureEnabled\("desktopPreview"\);[\s\S]*?state\.currentDesktopPreviewEnabled = Boolean\(\s*desktopPreviewFeatureEnabled && initialTabState && initialTabState\.desktopPreviewEnabled\s*\);/
  );
  assert.match(popupSource, /if \(!isFeatureEnabled\("deviceEmulationToggle"\)\) \{\s*return;\s*\}\s*if \(uiModule\.getViewState\(\)\.toggleEnabled\)/);
  assert.match(popupSource, /if \(!isFeatureEnabled\("desktopPreview"\)\) \{\s*return;\s*\}\s*const desiredEnabled/);
  assert.match(popupSource, /if \(key === "m" && !isFeatureEnabled\("desktopPreview"\)\) \{\s*return;\s*\}\s*event\.preventDefault\(\);/);

  assert.match(popupUiSource, /isPopupFeatureEnabled\(view, "desktopPreview"\) && view\.desktopPreviewVisible/);

  assert.match(
    backgroundSource,
    /nextState\.desktopPreviewEnabled = isFeatureEnabled\("desktopPreview"\) &&\s*Boolean\(message\.state\.desktopPreviewEnabled\);/
  );
  assert.match(backgroundSource, /reason: result\.reason \|\| \(result\.feature \? FEATURE_DISABLED_REASON : undefined\)/);

  assert.match(
    emulationSource,
    /updates\.enabled === false &&\s*!isFeatureEnabled\("deviceEmulationToggle"\)[\s\S]*?return buildFeatureDisabledResult\("deviceEmulationToggle", current\);/
  );
  assert.match(
    emulationSource,
    /if \(next\.mode === "desktop" && !isFeatureEnabled\("desktopPreview"\)\) \{\s*return buildFeatureDisabledResult\("desktopPreview", current\);\s*\}/
  );
  assert.match(
    contentMainSource,
    /if \(!isFeatureEnabled\("deviceEmulationToggle"\)\) \{\s*return;\s*\}\s*if \(deviceEmulationHotkeyBusy\)/
  );
  assert.match(
    contentMainSource,
    /if \(key === "m" && !isFeatureEnabled\("deviceEmulationToggle"\)\) \{\s*return;\s*\}\s*event\.preventDefault\(\);/
  );
});

test("render mode auto detection is blocked while manual inspection remains", () => {
  assert.match(popupSource, /if \(!isFeatureEnabled\("renderModeAutoDetection"\)\) \{\s*return false;\s*\}/);
  assert.match(
    backgroundSource,
    /if \(message\.type === "requestRenderModeDetection"\) \{[\s\S]*?if \(!isFeatureEnabled\("renderModeAutoDetection"\)\) \{[\s\S]*?sendResponse\(buildFeatureDisabledResponse\("renderModeAutoDetection"\)\);/
  );
  assert.match(popupSource, /type: "renderModeInspectionBegin"/);
  assert.match(popupSource, /type: "runRenderModeRevealOnce"/);
  assert.match(popupSource, /type: "captureRenderModeInspectionHtml"/);
  assert.match(popupSource, /type: "renderModeInspectionEnd"/);
});

test("cache and unregister tools are hidden and blocked when disabled", () => {
  assert.match(
    popupSource,
    /nextViewState\.clearDomainCacheDisabled =\s*!isFeatureEnabled\("cacheAndUnregisterTools"\) \|\| state\.clearDomainCacheDisabled;/
  );
  assert.match(
    popupSource,
    /nextViewState\.unregisterCurrentTabDisabled =\s*!isFeatureEnabled\("cacheAndUnregisterTools"\) \|\|[\s\S]*?state\.unregisterCurrentTabDisabled \|\| !state\.currentTab \|\| !state\.currentTab\.id;/
  );
  assert.match(
    popupSource,
    /async function handleClearDomainCache\(\) \{[\s\S]*?uiModule\.setConfigMenuOpen\(false\);[\s\S]*?if \(!isFeatureEnabled\("cacheAndUnregisterTools"\)\) \{\s*return;\s*\}/
  );
  assert.match(
    popupSource,
    /async function handleUnregisterCurrentTab\(\) \{[\s\S]*?uiModule\.setConfigMenuOpen\(false\);[\s\S]*?if \(!isFeatureEnabled\("cacheAndUnregisterTools"\)\) \{\s*return;\s*\}/
  );

  assert.match(
    popupUiSource,
    /isPopupFeatureEnabled\(view, "cacheAndUnregisterTools"\)[\s\S]*?id: "close-tab"/
  );
  assert.match(
    popupUiSource,
    /isPopupFeatureEnabled\(view, "cacheAndUnregisterTools"\)[\s\S]*?id: "clear-domain-cache"/
  );

  assert.match(
    backgroundSource,
    /if \(message\.type === "clearBrowsingDataForOrigin"\) \{[\s\S]*?buildFeatureDisabledResponse\("cacheAndUnregisterTools"\)/
  );
  assert.match(
    backgroundSource,
    /if \(message\.type === "unregisterTabAndReload"\) \{[\s\S]*?buildFeatureDisabledResponse\("cacheAndUnregisterTools"\)/
  );
});
