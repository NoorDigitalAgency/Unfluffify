import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  FEATURE_DISABLED_REASON,
  FEATURE_FLAGS,
  isFeatureEnabled
} from "../common/feature-flags.js";

import {
  PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
  PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
  PROPERTY_LOCK_CONTENT_CONTINUE,
  PROPERTY_LOCK_CONTENT_CONNECT,
  PROPERTY_LOCK_CONTENT_DISCONNECT,
  PROPERTY_LOCK_CONTENT_DRAFT_STATUS,
  PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS,
  PROPERTY_LOCK_PORT_NAME,
  PROPERTY_LOCK_WS_CLIENT_STATUS,
  PROPERTY_LOCK_WS_CONTINUE_EDITING,
  PROPERTY_LOCK_WS_SUBSCRIBE,
  PROPERTY_LOCK_WS_SUBSCRIBED,
  PROPERTY_LOCK_WS_LOCK_STATE,
  PROPERTY_LOCK_CONNECTION_INACTIVE,
  PROPERTY_LOCK_CONNECTION_CONNECTING,
  PROPERTY_LOCK_STATE_LOCKED,
  PROPERTY_LOCK_STATE_UNLOCKED
} from "../common/property-lock.js";

let backgroundModuleCounter = 0;
void [
  PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
  PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
  PROPERTY_LOCK_CONTENT_DISCONNECT,
  PROPERTY_LOCK_CONTENT_DRAFT_STATUS,
  PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS,
  PROPERTY_LOCK_WS_CLIENT_STATUS,
  PROPERTY_LOCK_WS_CONTINUE_EDITING,
  PROPERTY_LOCK_WS_SUBSCRIBE,
  PROPERTY_LOCK_WS_SUBSCRIBED,
  PROPERTY_LOCK_WS_LOCK_STATE,
  PROPERTY_LOCK_CONNECTION_CONNECTING,
  PROPERTY_LOCK_STATE_LOCKED,
];
void createFakeTimerController;

test("property lock background consumes port disconnect lastError", () => {
  const source = readFileSync(new URL("../common/property-lock-background.ts", import.meta.url), "utf8");

  assert.match(source, /function consumeRuntimeLastErrorMessage\(\) \{[\s\S]*?const lastError = chrome\.runtime\.lastError;[\s\S]*?\}/);
  assert.match(source, /function onPortDisconnect\(\) \{[\s\S]*?consumeRuntimeLastErrorMessage\(\);[\s\S]*?detachPortFromConnection/);
});

test("background tab removal immediately delegates property lock runtime disposal", () => {
  const source = readFileSync(new URL("../background.ts", import.meta.url), "utf8");

  assert.match(source, /handlePropertyLockBackgroundTabRemoved,\s*initPropertyLockBackground/);
  assert.match(source, /chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => \{[\s\S]*?handlePropertyLockBackgroundTabRemoved\(tabId\);/);
});

test("property lock holds the service-worker keepalive for active connections", () => {
  const source = readFileSync(new URL("../common/property-lock-background.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../background.ts", import.meta.url), "utf8");

  // The keepalive is injected through init and stored for runtime use.
  assert.match(source, /export function initPropertyLockBackground\(\s*options:\s*\{\s*keepAlive\?: PropertyLockKeepAlive\s*\}\s*=\s*\{\}\s*\)/);
  assert.match(source, /propertyLockKeepAlive = options\.keepAlive \|\| null;/);
  // Acquired once per runtime on creation, released on disposal (refcounted via keepAliveHeld).
  assert.match(source, /lockConnections\.set\(connectionKey, runtime\);\s*holdKeepAliveForRuntime\(runtime\);/);
  assert.match(source, /releaseKeepAliveForRuntime\(runtime\);\s*runtime\.dispose\(\);/);
  assert.match(source, /function holdKeepAliveForRuntime\([\s\S]*?runtime\.keepAliveHeld = true;[\s\S]*?propertyLockKeepAlive\.acquire\(\);/);
  assert.match(source, /function releaseKeepAliveForRuntime\([\s\S]*?runtime\.keepAliveHeld = false;[\s\S]*?propertyLockKeepAlive\.release\(\);/);
  // The background entry point wires the shared keepalive into property-lock init.
  assert.match(backgroundSource, /initPropertyLockBackground\(\{ keepAlive: swKeepAlive \}\)/);
});

function resolveStorageValues(keys, storageItems) {
  if (typeof keys === "string") {
    return { [keys]: storageItems[keys] };
  }
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, storageItems[key]]));
  }
  if (keys && typeof keys === "object") {
    return Object.fromEntries(
      Object.keys(keys).map((key) => [
        key,
        Object.prototype.hasOwnProperty.call(storageItems, key)
          ? storageItems[key]
          : keys[key]
      ])
    );
  }
  return { ...storageItems };
}

function createFakeTimerController() {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();

  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    timers.set(timerId, {
      runAt: now + Math.max(0, Number(delay) || 0),
      callback: () => callback(...args)
    });
    return timerId;
  };

  globalThis.clearTimeout = (timerId) => {
    timers.delete(timerId);
  };
  globalThis.setInterval = (callback, delay = 0, ...args) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    timers.set(timerId, {
      interval: Math.max(1, Number(delay) || 1),
      runAt: now + Math.max(1, Number(delay) || 1),
      callback: () => callback(...args)
    });
    return timerId;
  };
  globalThis.clearInterval = (timerId) => {
    timers.delete(timerId);
  };

  return {
    advance(ms) {
      now += Math.max(0, Number(ms) || 0);
      let ranTimer = true;
      while (ranTimer) {
        ranTimer = false;
        const dueTimers = [...timers.entries()]
          .filter(([, timer]) => timer.runAt <= now)
          .sort((left, right) => left[1].runAt - right[1].runAt);
        for (const [timerId, timer] of dueTimers) {
          if (timer.interval) {
            timer.runAt += timer.interval;
          } else {
            timers.delete(timerId);
          }
          timer.callback();
          ranTimer = true;
        }
      }
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  };
}

function createFakeWebSocketClass() {
  return class FakeWebSocket {
    static instances = [];

    constructor(url) {
      this.url = url;
      this.sentMessages = [];
      this.closeCalls = [];
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      FakeWebSocket.instances.push(this);
    }

    send(message) {
      this.sentMessages.push(JSON.parse(message));
    }

    close(code = 1000) {
      this.closeCalls.push(code);
    }

    emitMessage(payload) {
      if (typeof this.onmessage === "function") {
        this.onmessage({ data: JSON.stringify(payload) });
      }
    }
  };
}

function createPort(name, options = {}) {
  const messageListeners = [];
  const disconnectListeners = [];
  const tabId = Number.isFinite(options.tabId) ? Math.trunc(options.tabId) : null;
  return {
    name,
    sender: tabId === null ? undefined : { tab: { id: tabId } },
    postedMessages: [],
    onMessage: {
      addListener(listener) {
        messageListeners.push(listener);
      }
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.push(listener);
      }
    },
    postMessage(message) {
      this.postedMessages.push(message);
    },
    emitMessage(message) {
      messageListeners.forEach((listener) => listener(message));
    },
    disconnect() {
      disconnectListeners.forEach((listener) => listener());
    }
  };
}

function createChromeMock(storageItems = {}) {
  const runtimeConnectListeners = [];
  const runtimeMessages = [];

  return {
    chromeMock: {
      runtime: {
        sendMessage(message) {
          runtimeMessages.push(message);
          return Promise.resolve({ ok: true });
        },
        onConnect: {
          addListener(listener) {
            runtimeConnectListeners.push(listener);
          }
        }
      },
      storage: {
        sync: {
          get(keys, callback) {
            callback(resolveStorageValues(keys, storageItems));
          },
          set(items, callback) {
            Object.assign(storageItems, items);
            if (typeof callback === "function") {
              callback();
            }
          }
        }
      }
    },
    connectPort(nameOrOptions = PROPERTY_LOCK_PORT_NAME, maybeOptions = {}) {
      const name = typeof nameOrOptions === "string" ? nameOrOptions : PROPERTY_LOCK_PORT_NAME;
      const options = typeof nameOrOptions === "string" ? maybeOptions : nameOrOptions;
      const port = createPort(name, options);
      runtimeConnectListeners.forEach((listener) => listener(port));
      return port;
    },
    runtimeMessages,
    storageItems
  };
}

// deno-lint-ignore require-await -- preserves existing promise/callback contract.
async function loadPropertyLockBackgroundModule() {
  backgroundModuleCounter += 1;
  return import(new URL(`../common/property-lock-background.js?case=${backgroundModuleCounter}`, import.meta.url));
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

test("property lock runtime stays inert when feature flag is disabled", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const FakeWebSocket = createFakeWebSocketClass();
  const { chromeMock, connectPort } = createChromeMock({
    globalStageBase: "stage.example.test",
    globalToken: "secret-token"
  });

  globalThis.chrome = chromeMock;
  globalThis.WebSocket = FakeWebSocket;

  try {
    assert.equal(FEATURE_FLAGS.propertyLockCollaboration, false);
    assert.equal(isFeatureEnabled("propertyLockCollaboration"), false);

    const {
      initPropertyLockBackground,
      handleGetPropertyLockState,
      handlePropertyLockBackgroundMessage,
      handlePropertyLockBackgroundTabRemoved
    } = await loadPropertyLockBackgroundModule();

    initPropertyLockBackground();

    const port = connectPort({ tabId: 33 });
    port.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: 303,
      clientId: "client-a"
    });
    await flushAsyncWork();

    assert.equal(FakeWebSocket.instances.length, 0);

    const state = await handleGetPropertyLockState({ siteId: 303, tabId: 33 }, {});
    assert.equal(state.state.state, PROPERTY_LOCK_STATE_UNLOCKED);
    assert.equal(state.connectionStatus, PROPERTY_LOCK_CONNECTION_INACTIVE);
    assert.equal(state.error, FEATURE_DISABLED_REASON);

    const commandResponse = await handlePropertyLockBackgroundMessage({
      type: PROPERTY_LOCK_CONTENT_CONTINUE,
      siteId: 303,
      clientId: "client-a"
    }, {
      tab: { id: 33 }
    });
    assert.equal(commandResponse.ok, false);
    assert.equal(commandResponse.reason, FEATURE_DISABLED_REASON);
    assert.equal(commandResponse.feature, "propertyLockCollaboration");

    const draftResponse = await handlePropertyLockBackgroundMessage({
      type: "pageDraftChanged",
      pageUrl: "https://example.test/page",
      dirty: true
    }, {
      tab: { id: 33 }
    });
    assert.equal(draftResponse.ok, false);
    assert.equal(draftResponse.reason, FEATURE_DISABLED_REASON);
    assert.equal(draftResponse.feature, "propertyLockCollaboration");

    handlePropertyLockBackgroundTabRemoved(33);
    assert.equal(FakeWebSocket.instances.length, 0);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
  }
});
