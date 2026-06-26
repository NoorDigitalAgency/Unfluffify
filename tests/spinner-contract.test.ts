import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  SPINNER_OPERATION_KINDS,
  SPINNER_OPERATION_PHASES,
  SPINNER_PHASE_REGISTRY,
  SPINNER_REASON_PHASE_ALIASES,
  SPINNER_TIMER_MODES,
  createSpinnerOperationLease,
  resolveSpinnerPhaseDefinition
} from "../src/common/spinner-contract.js";

test("spinner phase registry defines clear copy and timing for every phase", () => {
  const definitions = Object.values(SPINNER_PHASE_REGISTRY);
  assert(definitions.length > 0);
  for (const definition of definitions) {
    assert.equal(typeof definition.title, "string");
    assert.equal(definition.title.trim().length > 0, true);
    assert.equal(typeof definition.note, "string");
    assert.equal(definition.note.trim().length > 0, true);
    assert.equal(["countdown", "elapsed", "none"].includes(definition.timerMode), true);
    assert.equal(typeof definition.blockSurfaces.popup, "boolean");
    assert.equal(typeof definition.blockSurfaces.page, "boolean");
    assert.equal(Number.isFinite(definition.maxDurationMs), true);
  }
});

test("spinner aliases map legacy reasons to deterministic phases", () => {
  const aiWait = resolveSpinnerPhaseDefinition({ reason: "tab-run-ai-running" });
  assert.equal(aiWait?.kind, SPINNER_OPERATION_KINDS.AI_RUN);
  assert.equal(aiWait?.phase, SPINNER_OPERATION_PHASES.AI_RUN.REMOTE_WAIT);
  assert.equal(aiWait?.timerMode, SPINNER_TIMER_MODES.COUNTDOWN);

  const revealFreeze = resolveSpinnerPhaseDefinition({ spinnerKey: "navInspect" });
  assert.equal(revealFreeze?.kind, SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP);
  assert.equal(revealFreeze?.phase, SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.PAGE_INSPECTION);
  assert.equal(revealFreeze?.timerMode, SPINNER_TIMER_MODES.ELAPSED);

  assert.equal(
    SPINNER_REASON_PHASE_ALIASES["tab-run-ai-preparing"],
    `${SPINNER_OPERATION_KINDS.AI_RUN}:${SPINNER_OPERATION_PHASES.AI_RUN.PREPARING_PAGE}`
  );
});

test("spinner leases derive deadlines and block surfaces from phase contract", () => {
  const lease = createSpinnerOperationLease({
    reason: "tab-run-ai-running",
    startedAt: 1_000,
    tabId: 42
  });

  assert.equal(lease?.operationId, "ai-run:remote-wait:42:1000");
  assert.equal(lease?.deadlineAt, 481_000);
  assert.equal(lease?.blockSurfaces.popup, true);
  assert.equal(lease?.blockSurfaces.page, true);
  assert.equal(lease?.timerMode, SPINNER_TIMER_MODES.COUNTDOWN);
});

test("spinner leases allow explicit surface and deadline overrides", () => {
  const lease = createSpinnerOperationLease({
    blockSurfaces: { page: false },
    deadlineAt: 12_345,
    kind: SPINNER_OPERATION_KINDS.PROPERTY_LOCK_TRANSFER,
    operationPhase: SPINNER_OPERATION_PHASES.PROPERTY_LOCK_TRANSFER.TRANSFERRING_EDITOR,
    startedAt: 1_000,
    tabId: 7
  });

  assert.equal(lease?.deadlineAt, 12_345);
  assert.equal(lease?.blockSurfaces.page, false);
  assert.equal(lease?.blockSurfaces.popup, true);
  assert.equal(lease?.timerMode, SPINNER_TIMER_MODES.COUNTDOWN);
});

test("spinner leases treat zero duration fields as absent", () => {
  const lease = createSpinnerOperationLease({
    deadlineAt: 0,
    maxDurationMs: 0,
    reason: "tab-run-ai-running",
    startedAt: 1_000,
    tabId: 9
  });

  assert.equal(lease?.deadlineAt, 481_000);
  assert.equal(lease?.maxDurationMs, 480_000);
});
