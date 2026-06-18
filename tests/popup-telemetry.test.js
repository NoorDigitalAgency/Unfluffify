import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  POPUP_READY_LOG_MESSAGE,
  getPopupTelemetryTabId,
  logPopupReady
} from "../popup/telemetry.js";

test("popup telemetry tab id resolves only finite active tab ids", () => {
  assert.equal(getPopupTelemetryTabId(null), null);
  assert.equal(getPopupTelemetryTabId({ currentTab: null }), null);
  assert.equal(getPopupTelemetryTabId({ currentTab: { id: Number.NaN } }), null);
  assert.equal(getPopupTelemetryTabId({ currentTab: { id: "52" } }), null);
  assert.equal(getPopupTelemetryTabId({ currentTab: { id: 52 } }), 52);
});

test("popup ready log only emits after an active tab exists", () => {
  const messages = [];
  const consoleLike = {
    info(message) {
      messages.push(message);
    }
  };

  assert.equal(logPopupReady(consoleLike, { currentTab: null }), false);
  assert.deepEqual(messages, []);

  assert.equal(logPopupReady(consoleLike, { currentTab: { id: 52 } }), true);
  assert.deepEqual(messages, [POPUP_READY_LOG_MESSAGE]);
});
