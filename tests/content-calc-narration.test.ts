import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  getSpinnerPhaseDefinition,
  resolveSpinnerPhaseDefinition,
  SPINNER_OPERATION_KINDS,
  SPINNER_OPERATION_PHASES
} from "../src/common/spinner-contract.js";

const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
const busClientSource = readFileSync(
  new URL("../src/content/layers/content-bus-client.ts", import.meta.url),
  "utf8"
);

// Calculation narration ("user left lingering" class): the marking overlay
// rebuild and the silent-highlight collection run for seconds on heavy pages
// with no engaged surface once the bootstrap/reveal curtains clear. Content
// leases the highlight-render broker spinners around those routines so BOTH
// surfaces narrate from the shared phase table.
test("highlight-render calculation phases narrate both surfaces from the shared table", () => {
  const markings = getSpinnerPhaseDefinition(
    SPINNER_OPERATION_KINDS.HIGHLIGHT_RENDER,
    SPINNER_OPERATION_PHASES.HIGHLIGHT_RENDER.CALCULATING_MARKINGS
  );
  assert.equal(markings?.title, "Calculating markings...");
  assert.equal(markings?.blockSurfaces.popup, true);
  assert.equal(markings?.blockSurfaces.page, true);

  const highlights = getSpinnerPhaseDefinition(
    SPINNER_OPERATION_KINDS.HIGHLIGHT_RENDER,
    SPINNER_OPERATION_PHASES.HIGHLIGHT_RENDER.CALCULATING_HIGHLIGHTS
  );
  assert.equal(highlights?.title, "Calculating highlightings...");
  assert.equal(highlights?.blockSurfaces.popup, true);
  assert.equal(highlights?.blockSurfaces.page, true);

  // The reason aliases resolve so broker entries built from reasons admit.
  assert.equal(
    resolveSpinnerPhaseDefinition({ reason: "content-calc-markings" })?.phase,
    SPINNER_OPERATION_PHASES.HIGHLIGHT_RENDER.CALCULATING_MARKINGS
  );
  assert.equal(
    resolveSpinnerPhaseDefinition({ reason: "content-calc-highlights" })?.phase,
    SPINNER_OPERATION_PHASES.HIGHLIGHT_RENDER.CALCULATING_HIGHLIGHTS
  );
});

// Core reports the initial full marking rebuild from the SCHEDULED pass: the
// predictor engages before the rAF (the lease message flushes over IPC in the
// timer->frame gap so the popup can paint while this document's main thread
// runs the sync pass), only for the first render after an enable (fresh
// baseline pending) or with no overlay yet — steady/toggle renders reuse
// caches and must stay silent.
test("core narrates only the initial marking rebuild, engaged before the render frame", () => {
  assert.match(
    coreSource,
    /const narrateMarkingCalc = Boolean\(\s*markingRenderNarrationReporter &&\s*state\.enabled &&\s*\(!state\.overlay \|\| state\.pendingFreshBaselinePageUrl === location\.href\)\s*\);/
  );
  // Engage happens in the timer callback, BEFORE extensionRequestAnimationFrame.
  assert.match(
    coreSource,
    /if \(narrateMarkingCalc\) \{\s*markingRenderNarrationReporter\?\.\(true\);\s*\}\s*state\.renderRaf = extensionRequestAnimationFrame/
  );
  // The release is exception-safe around the sync render pass.
  assert.match(
    coreSource,
    /try \{\s*renderHighlights\(\);\s*\} finally \{\s*if \(narrateMarkingCalc\) \{\s*markingRenderNarrationReporter\?\.\(false\);\s*\}\s*\}/
  );
});

test("content-main leases the calc spinners refcounted, threshold-delayed for highlights", () => {
  // The marking reporter engages immediately (one sync block — a threshold
  // timer could never fire before it ends).
  assert.match(
    contentSource,
    /core\.setMarkingRenderNarrationReporter\(\(active\) => \{\s*if \(active\) \{\s*beginContentCalcNarration\("markings", \{ immediate: true \}\);\s*\} else \{\s*endContentCalcNarration\("markings"\);\s*\}\s*\}\);/
  );
  // The silent-highlight wrap narrates ONLY the plain silent posture (a
  // preview/compute-lock/restore comparison render must not raise a
  // page-blocking curtain over the open preview) and releases in finally.
  assert.match(
    contentSource,
    /const narrateSilentCalc = contentMarkingMachine\.state === "silent";\s*if \(narrateSilentCalc\) \{\s*beginContentCalcNarration\("highlights"\);\s*\}\s*try \{/
  );
  assert.match(
    contentSource,
    /\} finally \{\s*if \(narrateSilentCalc\) \{\s*endContentCalcNarration\("highlights"\);\s*\}\s*\}\s*\}\s*\n\s*\/\*\*\s*\n \* Check if marking interactions should be blocked due to property lock\./
  );
  // The threshold keeps trivial pages from flashing.
  assert.match(contentSource, /const CONTENT_CALC_NARRATION_THRESHOLD_MS = 300;/);
  // The lease REMOVE only fires when the last outstanding routine ends.
  assert.match(
    contentSource,
    /slot\.count = Math\.max\(0, slot\.count - 1\);\s*if \(slot\.count > 0\) \{\s*return;\s*\}/
  );
});

test("content bus client exposes best-effort broker spinner set/remove", () => {
  assert.match(
    busClientSource,
    /export async function requestContentSpinnerSet\(\s*payload: SpinnerSetRequestPayload,\s*\): Promise<void> \{[\s\S]{0,400}SPINNER_REQUEST_TYPES\.SET/
  );
  assert.match(
    busClientSource,
    /export async function requestContentSpinnerRemove\(\s*payload: SpinnerRemoveRequestPayload,\s*\): Promise<void> \{[\s\S]{0,400}SPINNER_REQUEST_TYPES\.REMOVE/
  );
  // SET and REMOVE ride ONE transport helper so their delivery guarantees
  // (target, timeout, best-effort swallow) can never diverge.
  assert.match(
    busClientSource,
    /async function requestSpinnerBroker\(\s*type: typeof SPINNER_REQUEST_TYPES\.SET \| typeof SPINNER_REQUEST_TYPES\.REMOVE,/
  );
  assert.match(
    busClientSource,
    /requestSpinnerBroker\(SPINNER_REQUEST_TYPES\.SET, payload\)/
  );
  assert.match(
    busClientSource,
    /requestSpinnerBroker\(SPINNER_REQUEST_TYPES\.REMOVE, payload\)/
  );
});
