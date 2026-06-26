import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  detachDebugger,
  reloadPageWithJavaScriptControl,
  setPageJavaScriptExecutionDisabled
} from "../src/common/utilities.js";

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

test("setPageJavaScriptExecutionDisabled attaches and updates script execution", async () => {
  const originalChrome = globalThis.chrome;
  const calls = [];

  globalThis.chrome = {
    debugger: {
      async attach(target, version) {
        calls.push(["attach", target, version]);
      },
      async sendCommand(target, command, params) {
        calls.push(["sendCommand", target, command, params]);
      }
    }
  };

  try {
    const result = await setPageJavaScriptExecutionDisabled(789, false);

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [
      ["attach", { tabId: 789 }, "1.3"],
      ["sendCommand", { tabId: 789 }, "Emulation.setScriptExecutionDisabled", { value: false }]
    ]);
  } finally {
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
  }
});

test("reloadPageWithJavaScriptControl sets script state before reload", async () => {
  const originalChrome = globalThis.chrome;
  const calls = [];

  globalThis.chrome = {
    debugger: {
      async attach(target, version) {
        calls.push(["attach", target, version]);
      },
      async sendCommand(target, command, params) {
        calls.push(["sendCommand", target, command, params]);
      }
    }
  };

  try {
    const result = await reloadPageWithJavaScriptControl(321, true);

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [
      ["attach", { tabId: 321 }, "1.3"],
      ["sendCommand", { tabId: 321 }, "Emulation.setScriptExecutionDisabled", { value: true }],
      ["sendCommand", { tabId: 321 }, "Page.reload", { ignoreCache: true }]
    ]);
  } finally {
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
  }
});
