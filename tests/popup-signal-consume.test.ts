import { runInNewContext } from "node:vm";
import * as ts from "typescript";

import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import { SIGNAL_NAMES } from "../src/common/bus/contracts/signals.js";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

// Extract the whole consumption block (mapping const + the three functions)
// so the module-level SIGNAL_FRAME_TO_MACHINE_SIGNAL table rides along.
function compileConsumptionBlock(): string {
  const start = popupSource.indexOf("const SIGNAL_FRAME_TO_MACHINE_SIGNAL");
  const end = popupSource.indexOf("function overrideDictatedMarkingButtons", start);
  assert.ok(start > -1 && end > start, "consumption block markers present");
  const block = popupSource
    .slice(start, end)
    // Strip TS type annotations the VM cannot digest via the transpiler alone.
    .replace(": Readonly<Record<string, MarkingSessionSignal | null>>", "")
    .replace(/\(frame: SignalFrame\)/g, "(frame)")
    .replace(/\(tabId: number \| null\)/g, "(tabId)")
    .replace(/ as MarkingSessionSignal/g, "");
  const moduleSource = `${block}
module.exports = { SIGNAL_FRAME_TO_MACHINE_SIGNAL, consumeSignalFrame, maybePullSignals, onPushedSignalFrame };
`;
  return ts.transpileModule(moduleSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
}

function makeConsumeContext() {
  const machineSignals: string[] = [];
  const pulls: number[] = [];
  const context = {
    module: {
      exports: {} as {
        consumeSignalFrame?: (frame: Record<string, unknown>) => void;
        onPushedSignalFrame?: (frame: Record<string, unknown>) => void;
        SIGNAL_FRAME_TO_MACHINE_SIGNAL?: Record<string, string | null>;
      }
    },
    exports: {},
    state: { lastConsumedSignalSeq: 0 },
    SIGNAL_NAMES,
    signalMarkingSession: (signal: string) => { machineSignals.push(signal); },
    logWorldTrace: () => undefined,
    pullPopupSignals: async (_tabId: number, afterSeq: number) => { pulls.push(afterSeq); return null; },
    getCurrentPopupTabId: () => 7,
    Date, Number, Object, Boolean
  };
  runInNewContext(compileConsumptionBlock(), context);
  return {
    consume: context.module.exports.consumeSignalFrame!,
    onPushed: context.module.exports.onPushedSignalFrame!,
    mapping: context.module.exports.SIGNAL_FRAME_TO_MACHINE_SIGNAL!,
    state: context.state,
    machineSignals,
    pulls
  };
}

function frame(seq: number, name: string, payload: Record<string, unknown> = {}) {
  return { kind: "uf-signal/1", tabId: 7, seq, name, source: "brain", cause: "t", at: 0, payload };
}

test("frames apply once, in order, and move the cursor", () => {
  const ctx = makeConsumeContext();
  ctx.consume(frame(1, SIGNAL_NAMES.RUN_STARTED));
  ctx.consume(frame(1, SIGNAL_NAMES.RUN_STARTED));
  ctx.consume(frame(2, SIGNAL_NAMES.PREVIEW_OPENED, { origin: "post_ai" }));
  assert.deepEqual(ctx.machineSignals, ["run-started", "post-ai-preview-opened"]);
  assert.equal(ctx.state.lastConsumedSignalSeq, 2);
});

test("preview.opened origin discriminates the machine signal; run.completed maps to none", () => {
  const ctx = makeConsumeContext();
  ctx.consume(frame(1, SIGNAL_NAMES.PREVIEW_OPENED, { origin: "silent" }));
  ctx.consume(frame(2, SIGNAL_NAMES.RUN_COMPLETED));
  ctx.consume(frame(3, SIGNAL_NAMES.PREVIEW_EXITED, { restored: true }));
  assert.deepEqual(ctx.machineSignals, ["preview-opened", "exit-settled"]);
  assert.equal(ctx.state.lastConsumedSignalSeq, 3, "unmapped frames still advance the cursor");
});

test("a pushed gap does not skip frames: it defers to the ordered pull", () => {
  const ctx = makeConsumeContext();
  ctx.onPushed(frame(1, SIGNAL_NAMES.RUN_STARTED));
  assert.deepEqual(ctx.machineSignals, ["run-started"]);
  // seq 3 arrives before 2: must NOT consume (cursor would skip 2).
  ctx.onPushed(frame(3, SIGNAL_NAMES.PREVIEW_EXITED));
  assert.deepEqual(ctx.machineSignals, ["run-started"]);
  assert.equal(ctx.state.lastConsumedSignalSeq, 1);
  assert.deepEqual(ctx.pulls, [1], "gap triggers a cursor pull after the last consumed seq");
});

test("the vocabulary mapping is complete", () => {
  const ctx = makeConsumeContext();
  for (const name of Object.values(SIGNAL_NAMES)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(ctx.mapping, name),
      `mapping covers ${name}`
    );
  }
});

// Source contracts: the emitters and wiring exist at their choke points.
test("P1 wiring source contracts", () => {
  const brainSource = readFileSync(new URL("../src/background/brain/index.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

  // Brain: ai-run events double as signal emissions inside the ONE subscription.
  assert.match(brainSource, /function mapAiRunEventToSignalEmit\(/);
  assert.match(
    brainSource,
    /foldAiRunEvent\(tabId, eventType, eventPayload, `ai-run:\$\{eventType\}`\);\s*const signalEmit = mapAiRunEventToSignalEmit\(eventType, eventPayload\);\s*if \(signalEmit\) \{\s*emitSignal\(tabId, signalEmit\);/
  );
  // Brain: emit/pull handlers + push to both realms + persistence.
  assert.match(brainSource, /registerHandler\(SIGNAL_REQUEST_TYPES\.EMIT/);
  assert.match(brainSource, /registerHandler\(SIGNAL_REQUEST_TYPES\.PULL/);
  assert.match(brainSource, /bus\.publish\(SIGNAL_EVENT_TYPES\.EMITTED, admission\.frame, \{ target, tab: tabId \}\)/);
  assert.match(brainSource, /persistSignalLogSoon\(\);/);

  // Brain: reconciliation + inspection are PAIRED phase-edge signals; they are
  // born at the store's wrapped mutate — the single choke point every
  // dictation rewrite funnels through — never inside an individual fold (a
  // rewrite outside the fold would otherwise skip the closing -ended and
  // strand overlay consumers; live wedge 2026-07-03).
  assert.match(
    brainSource,
    /store\.mutate = wrapMutateWithSessionSignalEdges\(\s*store\.mutate,\s*\(tabId, emit\) => emitSignal\(tabId, emit\),?\s*\)/
  );
  assert.doesNotMatch(brainSource, /SIGNAL_NAMES\.RECONCILIATION_STARTED/);
  assert.doesNotMatch(brainSource, /SIGNAL_NAMES\.INSPECTION_STARTED/);
  const edgesSource = readFileSync(
    new URL("../src/background/brain/session-signal-edges.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    edgesSource,
    /isReconciling !== wasReconciling[\s\S]{0,500}SIGNAL_NAMES\.RECONCILIATION_STARTED[\s\S]{0,120}SIGNAL_NAMES\.RECONCILIATION_ENDED[\s\S]{0,300}cause: "save-lifecycle"/
  );
  assert.match(
    edgesSource,
    /isInspecting !== wasInspecting[\s\S]{0,500}SIGNAL_NAMES\.INSPECTION_STARTED : SIGNAL_NAMES\.INSPECTION_ENDED[\s\S]{0,300}cause: "render-mode-inspection-phase"/
  );

  // Background: marking activate/deactivate acks emit.
  assert.match(backgroundSource, /SIGNAL_NAMES\.MARKING_ENABLED,\s*source: "brain",\s*cause: "activate-command-ok"/);
  assert.match(backgroundSource, /SIGNAL_NAMES\.MARKING_DISABLED,\s*source: "brain",\s*cause: "deactivate-command-ok"/);

  // Popup: push consumption wired at both bus-client starts + throttled pull
  // piggybacked on projections; the three preview origins are tagged.
  const onSignalWirings = popupSource.match(/onSignal: onPushedSignalFrame/g) || [];
  assert.ok(onSignalWirings.length >= 2, "both popup bus-client starts consume pushes");
  assert.match(popupSource, /maybePullSignals\(currentTabId\);/);
  assert.match(popupSource, /AI_RUN_EVENT_TYPES\.PREVIEW_READY, \{ origin: "post_ai" \}/);
  assert.match(popupSource, /AI_RUN_EVENT_TYPES\.PREVIEW_READY, \{ origin: "silent" \}/);
  assert.match(popupSource, /AI_RUN_EVENT_TYPES\.PREVIEW_READY, \{ origin: "marking" \}/);
  // Popup-borne signals.
  assert.match(popupSource, /SIGNAL_NAMES\.PREVIEW_EXIT_REQUESTED,\s*source: "popup",\s*cause: "user-exit-click"/);
  assert.match(popupSource, /SIGNAL_NAMES\.SESSION_DISCARDED,\s*source: "popup",\s*cause: "user-discard"/);
  assert.match(popupSource, /SIGNAL_NAMES\.SESSION_SAVED,\s*source: "popup",\s*cause: "post-save-transition"/);
});
