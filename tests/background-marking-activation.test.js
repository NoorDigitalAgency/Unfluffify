import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("popup enable delegates marking activation to TAB_ACTIVATE_MARKING command", () => {
  const source = readFileSync(new URL("../popup.ts", import.meta.url), "utf8");
  const enableBody = source.match(
    /async function handleEnableToggle\(event\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*async function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(enableBody, /messages\.requestTabActivateMarking\(tab\.id, \{/);
  assert.doesNotMatch(enableBody, /sendTabMessageWithRetry\(\{[\s\S]*?type: "setEnabled"[\s\S]*?enabled: true/);
  assert.doesNotMatch(enableBody, /ensureEditorMobileSimulation\(/);
  assert.doesNotMatch(enableBody, /messages\.setTabState\(tab\.id, \{[\s\S]*?enabled: true/);
});

test("background registers TAB_ACTIVATE_MARKING as tab-scoped spinner command", () => {
  const source = readFileSync(new URL("../background.ts", import.meta.url), "utf8");

  assert.match(source, /TAB_ACTIVATE_MARKING: "TAB_ACTIVATE_MARKING"/);
  assert.match(source, /TAB_SCOPED_BACKGROUND_COMMANDS = new Set\(\[[\s\S]*?BACKGROUND_COMMANDS\.TAB_ACTIVATE_MARKING/);
  assert.match(source, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_ACTIVATE_MARKING, async \(context, payload\) => \{/);
  assert.match(source, /withBackgroundTabSpinner\([\s\S]*?reason: "tab-activate-marking"/);
});

test("background TAB_ACTIVATE_MARKING routes content activation by requested tab id", () => {
  const source = readFileSync(new URL("../background.ts", import.meta.url), "utf8");
  const commandBody = source.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_ACTIVATE_MARKING, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);\n\nregisterBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_DEACTIVATE_MARKING/
  )[1];

  assert.match(commandBody, /ensureContentMainForTab\(normalizedTabId\)/);
  assert.match(commandBody, /sendContentMessageToTab\(normalizedTabId, \{/);
  assert.match(commandBody, /await utils\.setTabState\(normalizedTabId, \{[\s\S]*?enabled: true/);
});

test("background TAB_ACTIVATE_MARKING clears state and reports lock details on content failure", () => {
  const source = readFileSync(new URL("../background.ts", import.meta.url), "utf8");
  const commandBody = source.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_ACTIVATE_MARKING, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);\n\nregisterBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_DEACTIVATE_MARKING/
  )[1];

  assert.match(commandBody, /await utils\.setTabState\(normalizedTabId, \{[\s\S]*?enabled: false/);
  assert.match(commandBody, /context\.replyFail\([\s\S]*?MESSAGE_ERROR_CODES\.FEATURE_DISABLED,[\s\S]*?locked: true/);
  assert.match(commandBody, /"Unable to prepare mobile simulation"/);
});

test("popup disable delegates marking deactivation to TAB_DEACTIVATE_MARKING command", () => {
  const source = readFileSync(new URL("../popup.ts", import.meta.url), "utf8");
  const enableBody = source.match(
    /async function handleEnableToggle\(event\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*async function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(enableBody, /messages\.requestTabDeactivateMarking\(tab\.id, \{/);
  assert.doesNotMatch(enableBody, /sendTabMessageWithRetry\(\{[\s\S]*?type: "setEnabled"[\s\S]*?enabled: false/);
  assert.doesNotMatch(enableBody, /messages\.setTabState\(tab\.id, \{[\s\S]*?enabled: false/);
});

test("background registers TAB_DEACTIVATE_MARKING as tab-scoped spinner command", () => {
  const source = readFileSync(new URL("../background.ts", import.meta.url), "utf8");

  assert.match(source, /TAB_DEACTIVATE_MARKING: "TAB_DEACTIVATE_MARKING"/);
  assert.match(source, /TAB_SCOPED_BACKGROUND_COMMANDS = new Set\(\[[\s\S]*?BACKGROUND_COMMANDS\.TAB_DEACTIVATE_MARKING/);
  assert.match(source, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_DEACTIVATE_MARKING, async \(context, payload\) => \{/);
  assert.match(source, /withBackgroundTabSpinner\([\s\S]*?reason: "tab-deactivate-marking"/);
});

test("background TAB_DEACTIVATE_MARKING routes content disable and tab state update", () => {
  const source = readFileSync(new URL("../background.ts", import.meta.url), "utf8");
  const commandBody = source.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_DEACTIVATE_MARKING, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);\n\nregisterBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_APPLY_POST_SAVE_TRANSITION/
  )[1];

  assert.match(commandBody, /await utils\.setTabState\(normalizedTabId, \{[\s\S]*?enabled: false/);
  assert.match(commandBody, /sendContentMessageToTab\(normalizedTabId, \{[\s\S]*?type: "setEnabled"[\s\S]*?enabled: false/);
  assert.match(commandBody, /contentAcknowledged: Boolean\(disableResponse && disableResponse\.ok\)/);
});

test("popup save/discard and preview surfaces delegate to background commands", () => {
  const source = readFileSync(new URL("../popup.ts", import.meta.url), "utf8");

  assert.match(source, /messages\.requestTabApplyPostSaveTransition\(tabId, \{ baseUrl \}\)/);
  assert.match(source, /messages\.requestTabApplyLocalDiscard\(tabId, \{ baseUrl \}\)/);
  assert.match(source, /messages\.requestTabShowAiPreview\(tabId, \{/);
  assert.match(source, /messages\.requestTabCloseAiPreview\(tabId\)/);
  assert.match(source, /messages\.requestTabSetAiPreviewExpandedMode\(tabId, \{/);
  assert.match(source, /messages\.requestTabFocusPreviewElement\(tabId, \{/);
  assert.doesNotMatch(source, /type: "showAiPreview"/);
  assert.doesNotMatch(source, /type: "closeAiPreview"/);
  assert.doesNotMatch(source, /type: "setAiPreviewExpandedMode"/);
});

test("background registers save/discard and preview commands as tab-scoped commands", () => {
  const source = readFileSync(new URL("../background.ts", import.meta.url), "utf8");

  assert.match(source, /TAB_APPLY_POST_SAVE_TRANSITION: "TAB_APPLY_POST_SAVE_TRANSITION"/);
  assert.match(source, /TAB_APPLY_LOCAL_DISCARD: "TAB_APPLY_LOCAL_DISCARD"/);
  assert.match(source, /TAB_SHOW_AI_PREVIEW: "TAB_SHOW_AI_PREVIEW"/);
  assert.match(source, /TAB_CLOSE_AI_PREVIEW: "TAB_CLOSE_AI_PREVIEW"/);
  assert.match(source, /TAB_SET_AI_PREVIEW_EXPANDED_MODE: "TAB_SET_AI_PREVIEW_EXPANDED_MODE"/);
  assert.match(source, /TAB_FOCUS_PREVIEW_ELEMENT: "TAB_FOCUS_PREVIEW_ELEMENT"/);
  assert.match(source, /TAB_SCOPED_BACKGROUND_COMMANDS = new Set\(\[[\s\S]*?BACKGROUND_COMMANDS\.TAB_APPLY_POST_SAVE_TRANSITION/);
  assert.match(source, /TAB_SCOPED_BACKGROUND_COMMANDS = new Set\(\[[\s\S]*?BACKGROUND_COMMANDS\.TAB_FOCUS_PREVIEW_ELEMENT/);
  assert.match(source, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_APPLY_POST_SAVE_TRANSITION, async \(context, payload\) => \{/);
  assert.match(source, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_APPLY_LOCAL_DISCARD, async \(context, payload\) => \{/);
  assert.match(source, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_SHOW_AI_PREVIEW, async \(context, payload\) => \{/);
  assert.match(source, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_CLOSE_AI_PREVIEW, async \(context\) => \{/);
  assert.match(source, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_SET_AI_PREVIEW_EXPANDED_MODE, async \(context, payload\) => \{/);
  assert.match(source, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_FOCUS_PREVIEW_ELEMENT, async \(context, payload\) => \{/);
});
