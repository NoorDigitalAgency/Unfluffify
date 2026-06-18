import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS,
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES,
  shouldCollectSilentExcludedSource,
  shouldRetainIncludedSource,
  shouldRenderSilentHighlightOverlay,
  sampleSettledSilentHighlightPosition
} from "../content/silent-highlight-rules.js";

function runSamples(samples, sampleMs = 120) {
  let state = {
    lastSignature: "",
    stableSamples: 0
  };
  let finalizedIndex = -1;
  samples.forEach((signature, index) => {
    if (finalizedIndex !== -1) {
      return;
    }
    state = sampleSettledSilentHighlightPosition(
      state,
      signature,
      (index + 1) * sampleMs,
      {
        requiredStableSamples: DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES,
        maxWaitMs: DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS
      }
    );
    if (state.shouldFinalize) {
      finalizedIndex = index;
    }
  });
  return finalizedIndex;
}

test("movement-driven redraw waits until tracked positions settle", () => {
  assert.equal(runSamples(["A", "B", "C", "D", "D", "D", "D"]), 6);
});

test("long-running movement settles on the final stable run instead of a recent intermediate position", () => {
  assert.equal(runSamples(["A", "B", "C", "D", "E", "F", "G", "H", "H", "H", "H"]), 10);
});

test("max settle timeout still guarantees a redraw if movement never stabilizes", () => {
  const samples = Array.from({ length: 30 }, (_, index) => `S${index}`);
  assert.equal(runSamples(samples), 21);
});

test("full active silent highlight refresh repaints when the render key is unchanged", () => {
  assert.equal(
    shouldRenderSilentHighlightOverlay({
      shouldBeActive: true,
      renderChanged: false,
      positionRefreshPending: false,
      hasOverlay: true,
      isFullRefresh: true
    }),
    true
  );
});

test("full active silent highlight refresh still repaints when positions changed", () => {
  assert.equal(
    shouldRenderSilentHighlightOverlay({
      shouldBeActive: true,
      renderChanged: false,
      positionRefreshPending: true,
      hasOverlay: true,
      isFullRefresh: true
    }),
    true
  );
});

test("inactive silent highlight refresh does not repaint the overlay", () => {
  assert.equal(
    shouldRenderSilentHighlightOverlay({
      shouldBeActive: false,
      renderChanged: true,
      positionRefreshPending: true,
      hasOverlay: true,
      isFullRefresh: true
    }),
    false
  );
});

test("silent excluded sources remain collectable while temporarily hidden", () => {
  assert.equal(
    shouldCollectSilentExcludedSource({
      isWithinIncluded: false,
      hasRenderableText: true,
      visibleToUser: false,
      definitelyHiddenSubtree: true
    }),
    true
  );
});

test("silent excluded sources still respect explicit include boundaries", () => {
  assert.equal(
    shouldCollectSilentExcludedSource({
      isWithinIncluded: true,
      hasRenderableText: true,
      visibleToUser: true,
      definitelyHiddenSubtree: false
    }),
    false
  );
});

test("hidden included sources are retained only when explicitly included", () => {
  assert.equal(
    shouldRetainIncludedSource({
      explicitlyIncluded: true,
      visibleToUser: false
    }),
    true
  );
  assert.equal(
    shouldRetainIncludedSource({
      explicitlyIncluded: false,
      visibleToUser: false
    }),
    false
  );
  assert.equal(
    shouldRetainIncludedSource({
      explicitlyIncluded: false,
      visibleToUser: true
    }),
    true
  );
});