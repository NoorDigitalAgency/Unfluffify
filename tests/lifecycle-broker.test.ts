import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  CURTAIN_BEARING_LIFECYCLE_KINDS,
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  SPINNER_KEYS,
  WORLD_MESSAGE_TYPES,
  buildPopupStatePortName,
  isCurtainBearingLifecycleKind,
  isLifecycleTerminalPhase
} from "../src/common/world-messaging-contract.js";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

test("lifecycle contract keeps the stable world message and spinner keys", () => {
  assert.equal(WORLD_MESSAGE_TYPES.LIFECYCLE_EVENT, "ufLifecycleEvent");
  assert.equal(WORLD_MESSAGE_TYPES.BACKGROUND_STATE, "ufBackgroundState");
  assert.equal(SPINNER_KEYS.NAV_INSPECT, "navInspect");
});

test("curtain-bearing lifecycle kinds stay limited to real inspection owners", () => {
  assert.deepEqual(CURTAIN_BEARING_LIFECYCLE_KINDS, [
    LIFECYCLE_KINDS.ACTIVATION,
    LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
    LIFECYCLE_KINDS.SILENT_HIGHLIGHTING
  ]);
  assert.equal(isCurtainBearingLifecycleKind(LIFECYCLE_KINDS.ACTIVATION), true);
  assert.equal(isCurtainBearingLifecycleKind(LIFECYCLE_KINDS.CONTENT_READY), false);
  assert.equal(isCurtainBearingLifecycleKind("unexpected"), false);
});

test("lifecycle helpers keep stable terminal phase and popup port rules", () => {
  assert.equal(isLifecycleTerminalPhase(LIFECYCLE_PHASES.FINISHED), true);
  assert.equal(isLifecycleTerminalPhase(LIFECYCLE_PHASES.FAILED), true);
  assert.equal(isLifecycleTerminalPhase(LIFECYCLE_PHASES.STARTED), false);
  assert.equal(buildPopupStatePortName(7), "ufPopupState:7");
  assert.equal(buildPopupStatePortName("11"), "ufPopupState:11");
});

test("content lifecycle events still flow through the background lifecycle broker", () => {
  assert.match(
    contentSource,
    /function emitLifecycleEvent\(event(?:\s*:\s*[^=]+)? = \{\}\) \{[\s\S]*?type: WORLD_MESSAGE_TYPES\.LIFECYCLE_EVENT/
  );
  assert.match(
    contentSource,
    /emitLifecycleEvent\(\{[\s\S]*?kind: LIFECYCLE_KINDS\.ACTIVATION,[\s\S]*?phase: LIFECYCLE_PHASES\.STARTED/
  );
  assert.match(
    contentSource,
    /emitLifecycleEvent\(\{[\s\S]*?kind: LIFECYCLE_KINDS\.ACTIVATION,[\s\S]*?phase: LIFECYCLE_PHASES\.(?:FINISHED|FAILED)/
  );
  assert.match(
    backgroundSource,
    /if \(message\.type === WORLD_MESSAGE_TYPES\.LIFECYCLE_EVENT\) \{[\s\S]*?updateTabRuntime\(normalizedTabId,[\s\S]*?appendWorldTraceEvent\(normalizedTabId, "lifecycle", "state-update", runtimeLifecycle\)[\s\S]*?brain\.mirrorActivationLifecycle\([\s\S]*?"background:world-lifecycle-event"/
  );
  assert.match(
    backgroundSource,
    /if \(message\.type === WORLD_MESSAGE_TYPES\.LIFECYCLE_EVENT\) \{[\s\S]*?eventKind === LIFECYCLE_KINDS\.ACTIVATION[\s\S]*?isLifecycleTerminalPhase\(eventPhase\)[\s\S]*?removeBackgroundSpinnerEntry\(normalizedTabId, "navInspect"\)/
  );
});
