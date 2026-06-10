import test from "node:test";
import assert from "node:assert/strict";

let configStoreImportCounter = 0;

function createDeferred() {
  let resolve = null;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function normalizeIdbKeys(keys) {
  if (keys === null || keys === undefined) {
    return null;
  }
  if (Array.isArray(keys)) {
    return keys;
  }
  if (typeof keys === "string") {
    return [keys];
  }
  if (typeof keys === "object") {
    return Object.keys(keys);
  }
  return null;
}

function createRuntimeIdbBridge({ onSet = null } = {}) {
  const idbData = {};
  const calls = [];

  const chromeMock = {
    runtime: {
      lastError: null,
      getURL(path = "") {
        return `chrome-extension://unfluffify-test/${path}`;
      },
      async sendMessage(message) {
        if (!message || typeof message.type !== "string") {
          return { ok: false, error: "Invalid runtime message" };
        }
        if (message.type === "idbGet") {
          calls.push({ type: "idbGet", keys: message.keys });
          const keys = normalizeIdbKeys(message.keys);
          if (!keys) {
            return { ok: true, result: { ...idbData } };
          }
          const result = typeof message.keys === "object" && message.keys !== null && !Array.isArray(message.keys)
            ? { ...message.keys }
            : {};
          keys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(idbData, key)) {
              result[key] = idbData[key];
            }
          });
          return { ok: true, result };
        }
        if (message.type === "idbSet") {
          calls.push({ type: "idbSet:start", items: message.items || {} });
          if (onSet) {
            await onSet({ items: message.items || {}, idbData, calls });
          }
          Object.entries(message.items || {}).forEach(([key, value]) => {
            idbData[key] = value;
          });
          calls.push({ type: "idbSet:end", items: message.items || {} });
          return { ok: true };
        }
        if (message.type === "idbRemove") {
          calls.push({ type: "idbRemove", keys: message.keys });
          const keys = normalizeIdbKeys(message.keys) || [];
          keys.forEach((key) => {
            delete idbData[key];
          });
          return { ok: true };
        }
        return { ok: false, error: `Unsupported message type: ${message.type}` };
      }
    }
  };

  return {
    chromeMock,
    idbData,
    calls
  };
}

async function withNonExtensionRuntime(chromeMock, callback) {
  const originalChrome = globalThis.chrome;
  const originalLocation = globalThis.location;
  globalThis.chrome = chromeMock;
  globalThis.location = { origin: "https://runtime-test.example" };
  try {
    return await callback();
  } finally {
    if (typeof originalChrome === "undefined") {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
    if (typeof originalLocation === "undefined") {
      delete globalThis.location;
    } else {
      globalThis.location = originalLocation;
    }
  }
}

async function loadConfigModule() {
  configStoreImportCounter += 1;
  return import(new URL(`../common/config.js?queue=${configStoreImportCounter}`, import.meta.url));
}

async function waitFor(predicate, label, maxTicks = 80) {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for: ${label}`);
}

test("concurrent updateConfig calls on the same base URL preserve both updates", async () => {
  const baseUrl = "https://queue-same.example";
  const firstSetGate = createDeferred();
  let delayedFirstSet = false;
  const bridge = createRuntimeIdbBridge({
    async onSet({ items }) {
      const configs = items && items.configs && typeof items.configs === "object"
        ? items.configs
        : {};
      const current = configs[baseUrl];
      if (!delayedFirstSet && current && current.siteId === 101) {
        delayedFirstSet = true;
        await firstSetGate.promise;
      }
    }
  });

  await withNonExtensionRuntime(bridge.chromeMock, async () => {
    const { updateConfig, getConfigs } = await loadConfigModule();

    const first = updateConfig(baseUrl, (config) => {
      config.siteId = 101;
    });
    const second = updateConfig(baseUrl, (config) => {
      config.submittedSelectorsFingerprint = "fp-queue";
    });

    await waitFor(
      () => bridge.calls.some((call) => call.type === "idbSet:start"),
      "first queued save to start"
    );
    assert.equal(
      bridge.calls.filter((call) => call.type === "idbSet:start").length,
      1,
      "second same-base write must stay queued behind the first"
    );

    firstSetGate.resolve();
    await Promise.all([first, second]);

    const configs = await getConfigs();
    assert.equal(configs[baseUrl].siteId, 101);
    assert.equal(configs[baseUrl].submittedSelectorsFingerprint, "fp-queue");
  });
});

test("concurrent updateConfig calls on different base URLs can proceed independently", async () => {
  const baseA = "https://queue-a.example";
  const baseB = "https://queue-b.example";
  const holdBaseASet = createDeferred();
  let delayedBaseA = false;
  const bridge = createRuntimeIdbBridge({
    async onSet({ items }) {
      const configs = items && items.configs && typeof items.configs === "object"
        ? items.configs
        : {};
      if (!delayedBaseA && Object.prototype.hasOwnProperty.call(configs, baseA)) {
        delayedBaseA = true;
        await holdBaseASet.promise;
      }
    }
  });

  await withNonExtensionRuntime(bridge.chromeMock, async () => {
    const { updateConfig } = await loadConfigModule();

    const first = updateConfig(baseA, (config) => {
      config.siteId = 1;
    });
    const second = updateConfig(baseB, (config) => {
      config.siteId = 2;
    });

    await waitFor(
      () => bridge.calls.some((call) => {
        if (call.type !== "idbSet:start") {
          return false;
        }
        const configs = call.items && call.items.configs && typeof call.items.configs === "object"
          ? call.items.configs
          : {};
        return Object.prototype.hasOwnProperty.call(configs, baseB);
      }),
      "base B write to start while base A is delayed"
    );

    holdBaseASet.resolve();
    await Promise.all([first, second]);
  });
});

test("ensureConfig default creation does not overwrite a queued newer update", async () => {
  const baseUrl = "https://queue-ensure.example";
  const holdDefaultSet = createDeferred();
  let delayedDefaultWrite = false;
  const bridge = createRuntimeIdbBridge({
    async onSet({ items }) {
      const configs = items && items.configs && typeof items.configs === "object"
        ? items.configs
        : {};
      const current = configs[baseUrl];
      if (!delayedDefaultWrite && current && current.siteId === null) {
        delayedDefaultWrite = true;
        await holdDefaultSet.promise;
      }
    }
  });

  await withNonExtensionRuntime(bridge.chromeMock, async () => {
    const { ensureConfig, getConfigs, updateConfig } = await loadConfigModule();

    const ensuring = ensureConfig(baseUrl);
    const updating = updateConfig(baseUrl, (config) => {
      config.siteId = 777;
      config.submittedSelectorsFingerprint = "after-default";
    });

    await waitFor(
      () => bridge.calls.some((call) => call.type === "idbSet:start"),
      "default ensureConfig save to start"
    );

    holdDefaultSet.resolve();
    await Promise.all([ensuring, updating]);

    const configs = await getConfigs();
    assert.equal(configs[baseUrl].siteId, 777);
    assert.equal(configs[baseUrl].submittedSelectorsFingerprint, "after-default");
  });
});
