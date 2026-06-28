import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  BUTTON_IDS,
  CURTAIN_OPERATIONS,
  SESSION_EVENT_TYPES,
  SESSION_PHASES,
  SESSION_REPORT_TYPES,
} from "../src/common/bus/contracts/session-state.js";

test("session-state contract exposes the approved phase list and button ids", () => {
  assert.deepEqual(Object.keys(SESSION_PHASES), [
    "LOADING",
    "OUT_OF_SCOPE",
    "RENDER_MODE_INSPECTION",
    "SILENT",
    "MARKING_FRESH",
    "MARKING_DIRTY",
    "COMPUTING_AI",
    "PREVIEW_OPEN",
    "PREVIEW_RESTORING",
    "READY_TO_SAVE",
    "SAVING",
    "SAVED",
    "DISCARDING",
    "RECONCILIATION_PENDING",
    "PROPERTY_LOCK_BLOCKED",
  ]);
  assert.deepEqual(Object.values(BUTTON_IDS), [
    "toggle-enabled",
    "compute",
    "marking-preview",
    "page-save",
    "page-revert",
  ]);
  assert.deepEqual(Object.values(CURTAIN_OPERATIONS), [
    "idle",
    "busy",
    "computing_ai",
    "saving",
    "discarding",
  ]);
  assert.deepEqual(SESSION_REPORT_TYPES, {
    FACTS_REPORTED: "session.factsReported",
  });
  assert.deepEqual(SESSION_EVENT_TYPES, {
    DICTATION_UPDATED: "session.dictationUpdated",
  });
});
