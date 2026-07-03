import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  SESSION_EVENT_TYPES,
  SESSION_PHASES,
  SESSION_REPORT_TYPES,
  SESSION_REQUEST_TYPES,
} from "../src/common/bus/contracts/session-state.js";

test("session-state contract exposes the approved phase list", () => {
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
  assert.deepEqual(SESSION_REPORT_TYPES, {
    FACTS_REPORTED: "session.factsReported",
  });
  assert.deepEqual(SESSION_REQUEST_TYPES, {
    FACTS_APPLY: "session.facts.apply",
    STATE_GET: "session.state.get",
  });
  assert.deepEqual(SESSION_EVENT_TYPES, {
    DICTATION_UPDATED: "session.dictationUpdated",
  });
});
