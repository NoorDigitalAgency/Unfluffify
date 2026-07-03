import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

// P5 (plan §5): the popup's re-derivation cadence is gone. Spinner broadcasts
// repaint ONLY the busy surface via the single busy-view builder; session
// surfaces render from machine memories on state changes; refreshUiInner runs
// only on real triggers (open, tab/url change, user actions, signal needs).

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

test("spinner broadcasts apply a targeted busy patch instead of a full refresh", () => {
  const start = popupSource.indexOf("function handleSpinnerSurfaceChangedFromBrain(");
  assert.ok(start > -1);
  const end = popupSource.indexOf("\nasync function init()", start);
  const body = popupSource.slice(start, end);
  assert.match(body, /uiModule\.setViewState\(buildProjectedBusyViewState\(\)\);/);
  assert.doesNotMatch(body, /refreshUi\(/);
});

test("the busy-view builder is the single source for both the full pass and the targeted repaint", () => {
  // refreshUiInner assigns the builder output once...
  assert.match(
    popupSource,
    /Object\.assign\(nextViewState, buildProjectedBusyViewState\(\)\);/
  );
  // ...and records the pass-computed aux flags the targeted repaint reuses.
  assert.match(
    popupSource,
    /lastProjectedBusyAuxFlags = \{ pageInspectionBusy, remoteConfigRetryBlocked \};/
  );
  // No duplicated busy-field derivation remains in the refresh pass.
  const builderStart = popupSource.indexOf("function buildProjectedBusyViewState()");
  assert.ok(builderStart > -1);
  const outsideBuilder =
    popupSource.slice(0, builderStart) +
    popupSource.slice(popupSource.indexOf("function getProjectedPopupBlockingSpinnerState()", builderStart));
  assert.doesNotMatch(outsideBuilder, /nextViewState\.busyMessage =[^=]/);
  assert.doesNotMatch(outsideBuilder, /nextViewState\.isBusy =[^=]/);
});

test("the stabilize-signature bookkeeping is deleted (the item latch is the only continuity mechanism)", () => {
  assert.doesNotMatch(popupSource, /stabilizePreviewViewState/);
  assert.doesNotMatch(popupSource, /getPreviewItemsSignature/);
  assert.doesNotMatch(popupSource, /lastPreviewItemsSignature/);
  const stateSource = readFileSync(new URL("../src/popup/state.ts", import.meta.url), "utf8");
  assert.doesNotMatch(stateSource, /lastPreviewItemsSignature/);
});
