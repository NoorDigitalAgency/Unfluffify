import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import {
  CONTENT_OVERLAY_MEMORY,
  resolveContentOverlayMemory
} from "../src/content/overlay-memory.js";
import { ContentText, PopupText } from "../src/common/text.js";

// §3.2 overlay memory: per machine state, the complete page-overlay
// presentation — the renderer consumes the state's memory; brain broadcasts
// reduce to surface vocabulary, never content.

test("every state has a complete, frozen overlay memory", () => {
  const states = ["silent", "marking", "preview", "compute_lock", "restoring"] as const;
  for (const state of states) {
    const memory = CONTENT_OVERLAY_MEMORY[state];
    assert.ok(memory, `${state} memory exists`);
    assert.ok(Object.isFrozen(memory), `${state} memory frozen`);
    assert.ok(Object.isFrozen(memory.pageCurtain), `${state} curtain frozen`);
    assert.equal(typeof memory.markingTemporarilyDisabled, "boolean");
  }
});

test("the marking-paused class policy: previewing/restoring only", () => {
  assert.equal(CONTENT_OVERLAY_MEMORY.preview.markingTemporarilyDisabled, true);
  assert.equal(CONTENT_OVERLAY_MEMORY.restoring.markingTemporarilyDisabled, true);
  assert.equal(CONTENT_OVERLAY_MEMORY.silent.markingTemporarilyDisabled, false);
  assert.equal(CONTENT_OVERLAY_MEMORY.marking.markingTemporarilyDisabled, false);
  assert.equal(CONTENT_OVERLAY_MEMORY.compute_lock.markingTemporarilyDisabled, false);
});

test("curtain contents narrate with the established product copy", () => {
  const lock = CONTENT_OVERLAY_MEMORY.compute_lock.pageCurtain;
  assert.equal(lock.visible, true);
  assert.equal(lock.visible && lock.message, PopupText.overlay.computingSelectors);
  assert.equal(lock.visible && lock.blocksPageInput, true, "the AI run blocks page input");
  const restoring = CONTENT_OVERLAY_MEMORY.restoring.pageCurtain;
  assert.equal(restoring.visible, true);
  assert.equal(restoring.visible && restoring.message, ContentText.marking.pageInspection);
  assert.equal(restoring.visible && restoring.blocksPageInput, false);
  for (const state of ["silent", "marking", "preview"] as const) {
    assert.equal(CONTENT_OVERLAY_MEMORY[state].pageCurtain.visible, false, `${state} shows no curtain`);
  }
});

test("resolution falls back to silent for unknown states", () => {
  assert.equal(
    resolveContentOverlayMemory("bogus" as never),
    CONTENT_OVERLAY_MEMORY.silent
  );
});
