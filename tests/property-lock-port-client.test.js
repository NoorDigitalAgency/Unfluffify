import test from "node:test";
import assert from "node:assert/strict";

import { createPropertyLockPortClient } from "../content/property-lock-port-client.js";

function createTimerHost() {
  let nextId = 1;
  const timers = new Map();

  return {
    setTimeout(callback) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    run(id) {
      const callback = timers.get(id);
      if (!callback) {
        return false;
      }
      timers.delete(id);
      callback();
      return true;
    },
    pendingCount() {
      return timers.size;
    },
    latestId() {
      const ids = [...timers.keys()];
      return ids.length ? ids[ids.length - 1] : 0;
    }
  };
}

function createClientHarness(overrides = {}) {
  const timerHost = createTimerHost();
  const syncCalls = [];
  const clearCalls = [];
  const runtimeConnectCalls = [];
  let connectedSiteId = "site-1";
  let clientId = "client-1";

  const deps = {
    connectRuntimePort: (options) => {
      runtimeConnectCalls.push(options);
      return {
        onMessage: {
          addListener() {}
        },
        onDisconnect: {
          addListener() {}
        },
        postMessage() {},
        disconnect() {}
      };
    },
    consumeRuntimeLastErrorMessage: () => "runtime lastError",
    getClientId: () => clientId,
    getConnectedSiteId: () => connectedSiteId,
    getTimerHost: () => timerHost,
    onPortCleared: () => {
      clearCalls.push("cleared");
      connectedSiteId = null;
    },
    shouldSkipReconnect: () => false,
    runSync: (options) => {
      syncCalls.push(options);
    },
    PROPERTY_LOCK_CONTENT_DISCONNECT: "content_disconnect",
    PROPERTY_LOCK_PORT_NAME: "property_lock_content",
    PROPERTY_LOCK_RECONNECT_DELAY_MS: 150,
    ...overrides
  };

  const client = createPropertyLockPortClient(deps);
  return {
    client,
    timerHost,
    syncCalls,
    clearCalls,
    runtimeConnectCalls,
    setConnectedSiteId: (value) => {
      connectedSiteId = value;
    },
    setClientId: (value) => {
      clientId = value;
    }
  };
}

test("property lock port client schedules one reconnect timer and runs sync", () => {
  const harness = createClientHarness();

  harness.client.scheduleReconnect({ forceSiteIdRefresh: true });
  harness.client.scheduleReconnect({ forceSiteIdRefresh: false });

  assert.equal(harness.client.hasReconnectTimer(), true);
  assert.equal(harness.timerHost.pendingCount(), 1);

  const timerId = harness.timerHost.latestId();
  assert.equal(harness.timerHost.run(timerId), true);
  assert.equal(harness.client.hasReconnectTimer(), false);
  assert.deepEqual(harness.syncCalls, [{ forceSiteIdRefresh: true }]);
});

test("property lock port client skips reconnect when reconnects are disabled", () => {
  const harness = createClientHarness({
    shouldSkipReconnect: () => true
  });

  harness.client.scheduleReconnect({ forceSiteIdRefresh: true });

  assert.equal(harness.client.hasReconnectTimer(), false);
  assert.equal(harness.timerHost.pendingCount(), 0);
  assert.deepEqual(harness.syncCalls, []);
});

test("property lock port client connects runtime port and handles disconnect cleanup", () => {
  let onMessageHandler = null;
  let onDisconnectHandler = null;
  const postedMessages = [];
  const receivedDisconnectReasons = [];

  const harness = createClientHarness({
    connectRuntimePort: () => ({
      onMessage: {
        addListener(listener) {
          onMessageHandler = listener;
        }
      },
      onDisconnect: {
        addListener(listener) {
          onDisconnectHandler = listener;
        }
      },
      postMessage(payload) {
        postedMessages.push(payload);
      },
      disconnect() {}
    }),
    consumeRuntimeLastErrorMessage: () => "runtime error"
  });

  const messageHandler = () => {};
  harness.client.connect({
    connectPayload: { type: "connect", siteId: "site-1" },
    onMessage: messageHandler,
    onDisconnect: (reason) => {
      receivedDisconnectReasons.push(reason);
    }
  });

  assert.equal(harness.client.hasPort(), true);
  assert.equal(onMessageHandler, messageHandler);
  assert.deepEqual(postedMessages, [{ type: "connect", siteId: "site-1" }]);

  assert.equal(typeof onDisconnectHandler, "function");
  onDisconnectHandler();

  assert.equal(harness.client.hasPort(), false);
  assert.deepEqual(receivedDisconnectReasons, ["runtime error"]);
  assert.deepEqual(harness.clearCalls, ["cleared"]);
});

test("property lock port client disconnect notifies background with site and client metadata", () => {
  const postedMessages = [];
  let disconnectCalls = 0;

  const harness = createClientHarness({
    connectRuntimePort: () => ({
      onMessage: {
        addListener() {}
      },
      onDisconnect: {
        addListener() {}
      },
      postMessage(payload) {
        postedMessages.push(payload);
      },
      disconnect() {
        disconnectCalls += 1;
      }
    })
  });

  harness.setConnectedSiteId("site-42");
  harness.setClientId("client-42");
  harness.client.connect({
    connectPayload: { type: "connect", siteId: "site-42" }
  });

  harness.client.disconnect();

  assert.equal(harness.client.hasPort(), false);
  assert.equal(disconnectCalls, 1);
  assert.deepEqual(postedMessages, [
    { type: "connect", siteId: "site-42" },
    { type: "content_disconnect", siteId: "site-42", clientId: "client-42" }
  ]);
});

test("property lock port client throws when posting without an active port", () => {
  const harness = createClientHarness();

  assert.throws(
    () => {
      harness.client.postMessage({ type: "activity" });
    },
    /Property lock port unavailable/
  );
});
