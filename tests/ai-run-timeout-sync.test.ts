import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import {
  AI_RUN_DEFAULT_TIMEOUT_MS,
  AI_RUN_DEFAULT_TIMEOUT_MINUTES,
  formatAiRunTimeoutFallbackCountdown
} from "../src/common/bus/contracts/ai-run.js";
import { PopupText } from "../src/common/text.js";

// P4 step 4.0 (architect): ONE source of truth for the AI-run timeout —
// the actual abort deadline, the live countdown, and every piece of static
// copy displaying the minutes all derive from the same contract constant.

test("the displayed minutes derive from the timeout contract", () => {
  assert.equal(AI_RUN_DEFAULT_TIMEOUT_MINUTES, Math.round(AI_RUN_DEFAULT_TIMEOUT_MS / 60_000));
  assert.equal(
    formatAiRunTimeoutFallbackCountdown(),
    `Up to ${AI_RUN_DEFAULT_TIMEOUT_MINUTES}:00`
  );
  assert.ok(
    PopupText.overlay.computingSelectorsNote.includes(`up to ${AI_RUN_DEFAULT_TIMEOUT_MINUTES} minutes`),
    "the busy-curtain note carries the contract minutes"
  );
});

test("no hardcoded timeout minutes remain in the popup surfaces", () => {
  const uiSource = readFileSync(new URL("../src/popup/ui.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(uiSource, /Up to 8:00/, "the countdown fallback derives from the contract");
  assert.match(uiSource, /formatAiRunTimeoutFallbackCountdown\(\)/);
  const textSource = readFileSync(new URL("../src/common/text.ts", import.meta.url), "utf8");
  assert.doesNotMatch(textSource, /up to 8 minutes/, "the note derives from the contract");
});
