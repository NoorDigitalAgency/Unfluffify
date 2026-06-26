import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  clearDeviceEmulationState,
  setDeviceEmulationEnabled
} from "../src/common/emulation.js";
import { DEVICE_EMULATION_PREFIX } from "../src/common/constants.js";

function withChrome(value, callback) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (typeof originalChrome === "undefined") {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = originalChrome;
      }
    });
}

function createDeferred() {
  let resolve = null;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function waitFor(predicate, label, maxTicks = 50) {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for: ${label}`);
}

function createChromeSessionMock({
  initialData = {},
  onSet = null,
  onRemove = null
} = {}) {
  const storageData = { ...initialData };
  const calls = [];
  let runtimeLastError = null;

  const chromeMock = {
    runtime: {
      get lastError() {
        return runtimeLastError;
      }
    },
    storage: {
      session: {
        get(keys, callback) {
          calls.push({ type: "get", keys });
          const normalizedKeys = Array.isArray(keys)
            ? keys
            : (typeof keys === "string" ? [keys] : Object.keys(keys || {}));
          const result = {};
          normalizedKeys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(storageData, key)) {
              result[key] = storageData[key];
            }
          });
          callback(result);
        },
        set(items, callback) {
          calls.push({ type: "set:start", items });
          Promise.resolve()
            .then(() => (onSet ? onSet({ items, storageData, setRuntimeLastError }) : null))
            .then(() => {
              Object.entries(items || {}).forEach(([key, value]) => {
                storageData[key] = value;
              });
              calls.push({ type: "set:end", items });
              callback();
              runtimeLastError = null;
            });
        },
        remove(keys, callback) {
          calls.push({ type: "remove:start", keys });
          Promise.resolve()
            .then(() => (onRemove ? onRemove({ keys, storageData, setRuntimeLastError }) : null))
            .then(() => {
              const normalizedKeys = Array.isArray(keys) ? keys : [keys];
              normalizedKeys.forEach((key) => {
                delete storageData[key];
              });
              calls.push({ type: "remove:end", keys: Array.isArray(keys) ? [...keys] : [keys] });
              callback();
              runtimeLastError = null;
            });
        }
      }
    }
  };

  function setRuntimeLastError(value) {
    runtimeLastError = value;
  }

  return {
    chromeMock,
    storageData,
    calls,
    setRuntimeLastError
  };
}

test("same-tab enable and clear operations serialize without overlap", async () => {
  const tabId = 401;
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const gate = createDeferred();
  const mock = createChromeSessionMock({
    initialData: {
      [key]: {
        enabled: false,
        mode: "mobile",
        scale: 0.8
      }
    },
    onSet() {
      return gate.promise;
    }
  });

  await withChrome(mock.chromeMock, async () => {
    const enablePromise = setDeviceEmulationEnabled(tabId, true);
    const clearPromise = clearDeviceEmulationState(tabId);

    await waitFor(
      () => mock.calls.some((call) => call.type === "set:start"),
      "first set to start"
    );
    assert.equal(
      mock.calls.some((call) => call.type.startsWith("remove:")),
      false,
      "clear must wait until enable completes"
    );

    gate.resolve();
    await Promise.all([enablePromise, clearPromise]);

    assert.deepEqual(
      mock.calls.map((call) => call.type),
      ["get", "set:start", "set:end", "remove:start", "remove:end"]
    );
    assert.equal(Object.prototype.hasOwnProperty.call(mock.storageData, key), false);
  });
});

test("same-tab queue continues after a storage failure", async () => {
  const tabId = 402;
  const key = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  let shouldFailNextSet = true;
  const mock = createChromeSessionMock({
    initialData: {
      [key]: {
        enabled: true,
        mode: "mobile",
        scale: 1
      }
    },
    onSet({ setRuntimeLastError }) {
      if (shouldFailNextSet) {
        shouldFailNextSet = false;
        setRuntimeLastError({ message: "forced storage set failure" });
      }
    }
  });

  await withChrome(mock.chromeMock, async () => {
    const failingEnable = setDeviceEmulationEnabled(tabId, false);
    const queuedClear = clearDeviceEmulationState(tabId);

    await assert.rejects(failingEnable, /forced storage set failure/);
    await queuedClear;

    assert.equal(
      mock.calls.some((call) => call.type === "remove:end"),
      true,
      "queued clear should still execute after the failed write"
    );
    assert.equal(Object.prototype.hasOwnProperty.call(mock.storageData, key), false);

    const recovered = await setDeviceEmulationEnabled(tabId, true);
    assert.equal(recovered.enabled, true);
    assert.equal(Object.prototype.hasOwnProperty.call(mock.storageData, key), true);
  });
});