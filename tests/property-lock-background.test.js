import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

test("property lock background consumes port disconnect lastError", () => {
  const source = readFileSync(new URL("../common/property-lock-background.js", import.meta.url), "utf8");

  assert.match(source, /function consumeRuntimeLastErrorMessage\(\) \{[\s\S]*?const lastError = chrome\.runtime\.lastError;[\s\S]*?\}/);
  assert.match(source, /function onPortDisconnect\(\) \{[\s\S]*?consumeRuntimeLastErrorMessage\(\);[\s\S]*?detachPortFromConnection/);
});

test("background tab removal immediately delegates property lock runtime disposal", () => {
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");

  assert.match(source, /handlePropertyLockBackgroundTabRemoved,\s*initPropertyLockBackground/);
  assert.match(source, /chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => \{[\s\S]*?handlePropertyLockBackgroundTabRemoved\(tabId\);/);
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

async function loadPropertyLockBackgroundModule() {
  backgroundModuleCounter += 1;
  return import(new URL(`../common/property-lock-background.js?case=${backgroundModuleCounter}`, import.meta.url));
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

test("property lock keeps a same-site runtime alive when a new port reconnects within the grace window", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const timerController = createFakeTimerController();
  const FakeWebSocket = createFakeWebSocketClass();
  const { chromeMock, connectPort } = createChromeMock({
    globalStageBase: "stage.example.test",
    globalToken: "secret-token"
  });

  globalThis.chrome = chromeMock;
  globalThis.WebSocket = FakeWebSocket;

  try {
    const {
      initPropertyLockBackground,
      handleGetPropertyLockState
    } = await loadPropertyLockBackgroundModule();
    initPropertyLockBackground();

    const firstPort = connectPort();
    firstPort.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: 101,
      clientId: "client-a"
    });
    await flushAsyncWork();

    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(
      FakeWebSocket.instances[0].url,
      "wss://stage.example.test/property-lock?token=secret-token"
    );

    FakeWebSocket.instances[0].emitMessage({
      type: PROPERTY_LOCK_WS_LOCK_STATE,
      state: PROPERTY_LOCK_STATE_LOCKED,
      editorIdentity: "editor@example.test",
      editorName: "Editor",
      isEditor: false,
      isRecentEditor: false,
      expiresAtUtc: "",
      secondsRemaining: null
    });

    firstPort.emitMessage({ type: PROPERTY_LOCK_CONTENT_DISCONNECT, siteId: 101 });
    firstPort.disconnect();

    const duringGrace = await handleGetPropertyLockState({ siteId: 101 }, {});
    assert.equal(duringGrace.state.state, PROPERTY_LOCK_STATE_LOCKED);
    assert.equal(duringGrace.connectionStatus, PROPERTY_LOCK_CONNECTION_CONNECTING);

    timerController.advance(PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS - 1);

    const secondPort = connectPort();
    secondPort.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: 101,
      clientId: "client-a"
    });
    await flushAsyncWork();

    timerController.advance(1);

    assert.equal(FakeWebSocket.instances.length, 1);
    assert.deepEqual(FakeWebSocket.instances[0].closeCalls, []);

    const afterReconnect = await handleGetPropertyLockState({ siteId: 101 }, {});
    assert.equal(afterReconnect.state.state, PROPERTY_LOCK_STATE_LOCKED);
    assert.equal(afterReconnect.connectionStatus, PROPERTY_LOCK_CONNECTION_CONNECTING);
  } finally {
    timerController.restore();
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("property lock releases the editor immediately when the tab is removed", async () => {
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
    const {
      initPropertyLockBackground,
      handleGetPropertyLockState,
      handlePropertyLockBackgroundTabRemoved
    } = await loadPropertyLockBackgroundModule();
    initPropertyLockBackground();

    const port = connectPort({ tabId: 77 });
    port.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: 707,
      clientId: "client-a",
      pageUrl: "https://example.test/a",
      hasUnsavedChanges: false
    });
    await flushAsyncWork();

    FakeWebSocket.instances[0].onopen();
    FakeWebSocket.instances[0].emitMessage({
      type: PROPERTY_LOCK_WS_SUBSCRIBED,
      identity: "editor@example.test",
      name: "Editor"
    });
    FakeWebSocket.instances[0].emitMessage({
      type: PROPERTY_LOCK_WS_LOCK_STATE,
      state: PROPERTY_LOCK_STATE_LOCKED,
      editorIdentity: "editor@example.test",
      editorClientId: "client-a",
      editorName: "Editor",
      isEditor: true,
      isRecentEditor: false,
      expiresAtUtc: "",
      secondsRemaining: null
    });

    handlePropertyLockBackgroundTabRemoved(77);

    assert.equal(FakeWebSocket.instances[0].sentMessages.at(-1).type, "release_lock");
    assert.deepEqual(FakeWebSocket.instances[0].closeCalls, [1000]);

    const state = await handleGetPropertyLockState({ siteId: 707, tabId: 77 }, {});
    assert.equal(state.state.state, PROPERTY_LOCK_STATE_UNLOCKED);
    assert.equal(state.connectionStatus, PROPERTY_LOCK_CONNECTION_INACTIVE);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("property lock opens a new runtime for a different site immediately and drops the old one after the grace window", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const timerController = createFakeTimerController();
  const FakeWebSocket = createFakeWebSocketClass();
  const { chromeMock, connectPort } = createChromeMock({
    globalStageBase: "stage.example.test",
    globalToken: "secret-token"
  });
  globalThis.chrome = chromeMock;
  globalThis.WebSocket = FakeWebSocket;

  try {
    const {
      initPropertyLockBackground,
      handleGetPropertyLockState
    } = await loadPropertyLockBackgroundModule();
    initPropertyLockBackground();

    const firstPort = connectPort();
    firstPort.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: 101,
      clientId: "client-a"
    });
    await flushAsyncWork();

    FakeWebSocket.instances[0].emitMessage({
      type: PROPERTY_LOCK_WS_LOCK_STATE,
      state: PROPERTY_LOCK_STATE_LOCKED,
      editorIdentity: "editor@example.test",
      editorName: "Editor",
      isEditor: false,
      isRecentEditor: false,
      expiresAtUtc: "",
      secondsRemaining: null
    });

    firstPort.emitMessage({ type: PROPERTY_LOCK_CONTENT_DISCONNECT, siteId: 101 });
    firstPort.disconnect();

    const secondPort = connectPort();
    secondPort.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: 202,
      clientId: "client-a"
    });
    await flushAsyncWork();

    assert.equal(FakeWebSocket.instances.length, 2);

    const oldSiteDuringGrace = await handleGetPropertyLockState({ siteId: 101 }, {});
    assert.equal(oldSiteDuringGrace.state.state, PROPERTY_LOCK_STATE_LOCKED);
    assert.equal(oldSiteDuringGrace.connectionStatus, PROPERTY_LOCK_CONNECTION_CONNECTING);

    timerController.advance(PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS);

    assert.deepEqual(FakeWebSocket.instances[0].closeCalls, [1000]);
    assert.deepEqual(FakeWebSocket.instances[1].closeCalls, []);

    const oldSiteAfterGrace = await handleGetPropertyLockState({ siteId: 101 }, {});
    assert.equal(oldSiteAfterGrace.state.state, PROPERTY_LOCK_STATE_UNLOCKED);
    assert.equal(oldSiteAfterGrace.connectionStatus, PROPERTY_LOCK_CONNECTION_INACTIVE);

    const newSiteState = await handleGetPropertyLockState({ siteId: 202 }, {});
    assert.equal(newSiteState.connectionStatus, PROPERTY_LOCK_CONNECTION_CONNECTING);
  } finally {
    timerController.restore();
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("property lock accepts numeric string site IDs and rejects invalid connect messages", async () => {
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
    const { initPropertyLockBackground, handleGetPropertyLockState } = await loadPropertyLockBackgroundModule();
    initPropertyLockBackground();

    const invalidPort = connectPort();
    invalidPort.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: "not-a-site"
    });
    await flushAsyncWork();

    assert.equal(FakeWebSocket.instances.length, 0);
    assert.equal(invalidPort.postedMessages[0].type, "propertyLockConnectionStatus");
    assert.equal(invalidPort.postedMessages[0].error, "invalid_site_id");

    const missingClientPort = connectPort();
    missingClientPort.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: "303"
    });
    await flushAsyncWork();

    assert.equal(FakeWebSocket.instances.length, 0);
    assert.equal(missingClientPort.postedMessages[0].type, "propertyLockConnectionStatus");
    assert.equal(missingClientPort.postedMessages[0].error, "invalid_client_id");

    const validPort = connectPort();
    validPort.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: "303",
      clientId: "client-a"
    });
    await flushAsyncWork();

    assert.equal(FakeWebSocket.instances.length, 1);
    const state = await handleGetPropertyLockState({ siteId: "303" }, {});
    assert.equal(state.connectionStatus, PROPERTY_LOCK_CONNECTION_CONNECTING);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("property lock sends stable client session metadata to the server", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const timerController = createFakeTimerController();
  const FakeWebSocket = createFakeWebSocketClass();
  const { chromeMock, connectPort } = createChromeMock({
    globalStageBase: "stage.example.test",
    globalToken: "secret-token"
  });

  globalThis.chrome = chromeMock;
  globalThis.WebSocket = FakeWebSocket;

  try {
    const { initPropertyLockBackground } = await loadPropertyLockBackgroundModule();
    initPropertyLockBackground();

    const port = connectPort();
    port.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: 404,
      clientId: "client-a",
      pageUrl: "https://example.test/a",
      hasUnsavedChanges: false
    });
    await flushAsyncWork();

    FakeWebSocket.instances[0].onopen();

    assert.deepEqual(FakeWebSocket.instances[0].sentMessages[0], {
      type: PROPERTY_LOCK_WS_SUBSCRIBE,
      siteId: 404,
      clientId: "client-a",
      pageUrl: "https://example.test/a",
      hasUnsavedChanges: false
    });
    assert.deepEqual(FakeWebSocket.instances[0].sentMessages[1], {
      type: PROPERTY_LOCK_WS_CLIENT_STATUS,
      siteId: 404,
      clientId: "client-a",
      pageUrl: "https://example.test/a",
      hasUnsavedChanges: false
    });

    port.emitMessage({
      type: PROPERTY_LOCK_CONTENT_DRAFT_STATUS,
      hasUnsavedChanges: true,
      pageUrl: "https://example.test/a"
    });
    port.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONTINUE,
      force: true,
      discardPrevious: true
    });

    assert.equal(FakeWebSocket.instances[0].sentMessages.at(-2).type, PROPERTY_LOCK_WS_CLIENT_STATUS);
    assert.equal(FakeWebSocket.instances[0].sentMessages.at(-2).hasUnsavedChanges, true);
    assert.equal(FakeWebSocket.instances[0].sentMessages.at(-1).type, PROPERTY_LOCK_WS_CONTINUE_EDITING);
    assert.equal(FakeWebSocket.instances[0].sentMessages.at(-1).clientId, "client-a");
    assert.equal(FakeWebSocket.instances[0].sentMessages.at(-1).force, true);
    assert.equal(FakeWebSocket.instances[0].sentMessages.at(-1).discardPrevious, true);
  } finally {
    timerController.restore();
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("property lock rotates duplicated tab client IDs and routes popup state by tab", async () => {
  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  const timerController = createFakeTimerController();
  const FakeWebSocket = createFakeWebSocketClass();
  const { chromeMock, connectPort } = createChromeMock({
    globalStageBase: "stage.example.test",
    globalToken: "secret-token"
  });

  globalThis.chrome = chromeMock;
  globalThis.WebSocket = FakeWebSocket;

  try {
    const {
      initPropertyLockBackground,
      handleGetPropertyLockState
    } = await loadPropertyLockBackgroundModule();
    initPropertyLockBackground();

    const firstPort = connectPort({ tabId: 11 });
    firstPort.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: 505,
      clientId: "client-a"
    });
    await flushAsyncWork();
    FakeWebSocket.instances[0].onopen();
    FakeWebSocket.instances[0].emitMessage({
      type: PROPERTY_LOCK_WS_SUBSCRIBED,
      identity: "editor@example.test",
      name: "Editor"
    });
    FakeWebSocket.instances[0].emitMessage({
      type: PROPERTY_LOCK_WS_LOCK_STATE,
      state: PROPERTY_LOCK_STATE_LOCKED,
      editorIdentity: "editor@example.test",
      editorClientId: "client-a",
      editorName: "Editor",
      isEditor: true,
      isRecentEditor: false,
      expiresAtUtc: "",
      secondsRemaining: null
    });

    const secondPort = connectPort({ tabId: 22 });
    secondPort.emitMessage({
      type: PROPERTY_LOCK_CONTENT_CONNECT,
      siteId: 505,
      clientId: "client-a"
    });
    await flushAsyncWork();

    assert.equal(FakeWebSocket.instances.length, 2);

    const secondConnectUpdate = secondPort.postedMessages.find((message) =>
      message &&
      message.type === PROPERTY_LOCK_BACKGROUND_STATE_UPDATE &&
      message.message &&
      message.message.type === PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS
    );
    const rotatedClientId = secondConnectUpdate && typeof secondConnectUpdate.clientId === "string"
      ? secondConnectUpdate.clientId
      : "";
    assert.ok(rotatedClientId);
    assert.notEqual(rotatedClientId, "client-a");

    FakeWebSocket.instances[1].onopen();
    FakeWebSocket.instances[1].emitMessage({
      type: PROPERTY_LOCK_WS_SUBSCRIBED,
      identity: "editor@example.test",
      name: "Editor"
    });
    FakeWebSocket.instances[1].emitMessage({
      type: PROPERTY_LOCK_WS_LOCK_STATE,
      state: PROPERTY_LOCK_STATE_LOCKED,
      editorIdentity: "editor@example.test",
      editorClientId: "client-a",
      editorName: "Editor",
      isEditor: true,
      isRecentEditor: false,
      expiresAtUtc: "",
      secondsRemaining: null
    });

    const firstState = await handleGetPropertyLockState({ siteId: 505, tabId: 11 }, {});
    const secondState = await handleGetPropertyLockState({ siteId: 505, tabId: 22, clientId: "client-a" }, {});

    assert.equal(firstState.clientId, "client-a");
    assert.equal(firstState.state.isEditor, true);
    assert.equal(secondState.clientId, rotatedClientId);
    assert.equal(secondState.state.isEditor, false);
    assert.equal(secondState.state.isSameUserEditor, true);
  } finally {
    timerController.restore();
    globalThis.chrome = originalChrome;
    globalThis.WebSocket = originalWebSocket;
  }
});
