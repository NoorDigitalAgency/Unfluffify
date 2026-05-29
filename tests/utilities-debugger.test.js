import test from "node:test";
import assert from "node:assert/strict";

import { detachDebugger } from "../common/utilities.js";

test("detachDebugger treats an already-detached tab as a successful cleanup", async () => {
  const originalChrome = globalThis.chrome;
  const originalConsoleError = console.error;
  const loggedErrors = [];

  globalThis.chrome = {
    debugger: {
      async detach(target) {
        assert.deepEqual(target, { tabId: 123 });
        throw new Error("Debugger is not attached to the tab with id: 123.");
      }
    }
  };
  console.error = (...args) => {
    loggedErrors.push(args);
  };

  try {
    const result = await detachDebugger(123);

    assert.deepEqual(result, { ok: true, alreadyDetached: true });
    assert.equal(loggedErrors.length, 0);
  } finally {
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
    console.error = originalConsoleError;
  }
});

test("detachDebugger still reports unexpected detach failures", async () => {
  const originalChrome = globalThis.chrome;
  const originalConsoleError = console.error;
  const loggedErrors = [];

  globalThis.chrome = {
    debugger: {
      async detach() {
        throw new Error("Permission denied");
      }
    }
  };
  console.error = (...args) => {
    loggedErrors.push(args);
  };

  try {
    const result = await detachDebugger(456);

    assert.deepEqual(result, { ok: false, error: "Permission denied" });
    assert.deepEqual(loggedErrors, [["Error detaching debugger:", "Permission denied"]]);
  } finally {
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
    console.error = originalConsoleError;
  }
});