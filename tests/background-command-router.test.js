import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  __resetBackgroundCommandRegistryForTests,
  dispatchBackgroundCommand,
  registerBackgroundCommand
} from "../src/background/command-router.js";
import {
  __resetTabRuntimeForTests,
  appendTabCommandLedger,
  deleteTabRuntime,
  getTabRuntime,
  getTabRuntimeSnapshot,
  updateTabRuntime
} from "../src/background/tab-runtime.js";

function createEnvelope(overrides = {}) {
  return {
    id: "req-1",
    type: "TEST_COMMAND",
    source: "popup",
    target: "background",
    tabId: 1,
    frameId: 0,
    expectsReply: true,
    payload: {},
    ...overrides
  };
}

test.beforeEach(() => {
  __resetBackgroundCommandRegistryForTests();
  __resetTabRuntimeForTests();
});

test("unknown command returns handler_not_found", async () => {
  const reply = await dispatchBackgroundCommand(
    createEnvelope({ type: "NO_SUCH_COMMAND" }),
    {},
    { requireTabForTypes: new Set() }
  );
  assert.equal(reply.ok, false);
  assert.equal(reply.code, "handler_not_found");
});

test("missing tab id for tab-scoped command fails with invalid_tab", async () => {
  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  registerBackgroundCommand("TAB_SCOPED", async () => ({ ok: true }));
  const reply = await dispatchBackgroundCommand(
    createEnvelope({ type: "TAB_SCOPED", tabId: null }),
    {},
    { requireTabForTypes: new Set(["TAB_SCOPED"]) }
  );
  assert.equal(reply.ok, false);
  assert.equal(reply.code, "invalid_tab");
});

test("command registration can enforce allowed sources", async () => {
  registerBackgroundCommand(
    "POPUP_ONLY",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async () => ({ ok: true }),
    {
      allowedSources: ["popup"]
    }
  );

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "POPUP_ONLY",
      source: "content"
    }),
    {},
    { requireTabForTypes: new Set() }
  );

  assert.equal(reply.ok, false);
  assert.equal(reply.code, "invalid_message");
});

test("content commands can resolve tab id from sender instead of matching message tab", async () => {
  registerBackgroundCommand(
    "CONTENT_SENDER_TAB",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async (context) => ({ resolvedTabId: context.tabId }),
    {
      allowedSources: ["content"],
      tabIdPolicy: "sender",
      requireTab: true
    }
  );

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "CONTENT_SENDER_TAB",
      source: "content",
      tabId: 6207
    }),
    {
      tab: { id: 6207 }
    },
    { requireTabForTypes: new Set() }
  );

  assert.equal(reply.ok, true);
  assert.equal(reply.result.resolvedTabId, 6207);
});

test("content sender-policy commands reject spoofed message tab ids", async () => {
  registerBackgroundCommand(
    "CONTENT_SENDER_TAB_STRICT",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async () => ({ ok: true }),
    {
      allowedSources: ["content"],
      tabIdPolicy: "sender",
      requireTab: true
    }
  );

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "CONTENT_SENDER_TAB_STRICT",
      source: "content",
      tabId: 9991
    }),
    {
      tab: { id: 6207 }
    },
    { requireTabForTypes: new Set() }
  );

  assert.equal(reply.ok, false);
  assert.equal(reply.code, "invalid_message");
});

test("sender-or-message policy prefers sender tab and records policy metadata", async () => {
  registerBackgroundCommand(
    "SENDER_OR_MESSAGE",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async (context) => ({
      resolvedTabId: context.tabId,
      tabIdSource: context.tabIdSource,
      policy: context.policy
    }),
    {
      allowedSources: ["content"],
      tabIdPolicy: "sender-or-message",
      requireTab: true
    }
  );

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "SENDER_OR_MESSAGE",
      source: "content",
      tabId: 9991
    }),
    {
      tab: { id: 6207 }
    },
    { requireTabForTypes: new Set() }
  );

  assert.equal(reply.ok, true);
  assert.equal(reply.result.resolvedTabId, 6207);
  assert.equal(reply.result.tabIdSource, "sender");
  assert.equal(reply.result.policy, "sender-or-message");
});

test("none tab policy treats commands as unscoped", async () => {
  registerBackgroundCommand(
    "UNTABBED",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async (context) => ({
      resolvedTabId: context.tabId,
      tabIdSource: context.tabIdSource,
      policy: context.policy
    }),
    {
      allowedSources: ["popup"],
      tabIdPolicy: "none"
    }
  );

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "UNTABBED",
      tabId: 8801
    }),
    {
      url: "chrome-extension://test-id/popup.html"
    },
    { requireTabForTypes: new Set(["UNTABBED"]) }
  );

  assert.equal(reply.ok, true);
  assert.equal(reply.result.resolvedTabId, 0);
  assert.equal(reply.result.tabIdSource, "none");
  assert.equal(reply.result.policy, "none");
});

test("popup-only command rejects content sender spoofing popup source", async () => {
  registerBackgroundCommand(
    "POPUP_ONLY_STRICT",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async (context) => ({ resolvedTabId: context.tabId }),
    {
      allowedSources: ["popup"],
      tabIdPolicy: "message",
      requireTab: true
    }
  );

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "POPUP_ONLY_STRICT",
      source: "popup",
      tabId: 4401
    }),
    {
      tab: { id: 2202 },
      url: "https://example.com/path"
    },
    { requireTabForTypes: new Set() }
  );

  assert.equal(reply.ok, false);
  assert.equal(reply.code, "invalid_message");
});

test("popup-only command accepts popup sender metadata", async () => {
  registerBackgroundCommand(
    "POPUP_ONLY_ACCEPTED",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async (context) => ({ resolvedTabId: context.tabId, source: context.source }),
    {
      allowedSources: ["popup"],
      tabIdPolicy: "message",
      requireTab: true
    }
  );

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "POPUP_ONLY_ACCEPTED",
      source: "popup",
      tabId: 8801
    }),
    {
      url: "chrome-extension://test-id/popup.html"
    },
    { requireTabForTypes: new Set() }
  );

  assert.equal(reply.ok, true);
  assert.equal(reply.result.resolvedTabId, 8801);
  assert.equal(reply.result.source, "popup");
});

test("popup-only command accepts extension page tabs as popup senders", async () => {
  registerBackgroundCommand(
    "POPUP_ONLY_EXTENSION_TAB",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async (context) => ({ resolvedTabId: context.tabId, source: context.source }),
    {
      allowedSources: ["popup"],
      tabIdPolicy: "message",
      requireTab: true
    }
  );

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "POPUP_ONLY_EXTENSION_TAB",
      source: "popup",
      tabId: 8801
    }),
    {
      tab: { id: 9902, url: "chrome-extension://test-id/popup.html?debugTabId=8801" }
    },
    { requireTabForTypes: new Set() }
  );

  assert.equal(reply.ok, true);
  assert.equal(reply.result.resolvedTabId, 8801);
  assert.equal(reply.result.source, "popup");
});

test("popup-only command accepts extension origins as popup senders", async () => {
  registerBackgroundCommand(
    "POPUP_ONLY_EXTENSION_ORIGIN",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async (context) => ({ resolvedTabId: context.tabId, source: context.source }),
    {
      allowedSources: ["popup"],
      tabIdPolicy: "message",
      requireTab: true
    }
  );

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "POPUP_ONLY_EXTENSION_ORIGIN",
      source: "popup",
      tabId: 8801
    }),
    {
      tab: { id: 9902 },
      origin: "chrome-extension://test-id"
    },
    { requireTabForTypes: new Set() }
  );

  assert.equal(reply.ok, true);
  assert.equal(reply.result.resolvedTabId, 8801);
  assert.equal(reply.result.source, "popup");
});

test("same URL tabs keep separate runtimes", () => {
  const runtimeOne = updateTabRuntime(11, {
    contentReady: true,
    mode: "marking",
    lastKnownContentState: {
      url: "https://example.com/jobs",
      markingEnabled: true
    }
  });
  const runtimeTwo = updateTabRuntime(22, {
    contentReady: false,
    mode: "silent",
    lastKnownContentState: {
      url: "https://example.com/jobs",
      markingEnabled: false
    }
  });

  assert.equal(runtimeOne.tabId, 11);
  assert.equal(runtimeTwo.tabId, 22);

  const snapshotOne = getTabRuntimeSnapshot(11);
  const snapshotTwo = getTabRuntimeSnapshot(22);

  assert.equal(snapshotOne.mode, "marking");
  assert.equal(snapshotTwo.mode, "silent");
  assert.equal(snapshotOne.lastKnownContentState.url, snapshotTwo.lastKnownContentState.url);
});

test("command ledger records success and failure per tab", () => {
  appendTabCommandLedger(71, {
    id: "ok-1",
    type: "TAB_ACTIVATE_MARKING",
    startedAt: 10,
    finishedAt: 20,
    durationMs: 10,
    status: "ok"
  });
  appendTabCommandLedger(71, {
    id: "fail-1",
    type: "TAB_CAPTURE_RENDER_MODE_HTML",
    startedAt: 30,
    finishedAt: 45,
    durationMs: 15,
    status: "error",
    errorCode: "handler_failed"
  });

  appendTabCommandLedger(72, {
    id: "ok-2",
    type: "TAB_ACTIVATE_MARKING",
    startedAt: 50,
    finishedAt: 52,
    durationMs: 2,
    status: "ok"
  });

  const tab71 = getTabRuntimeSnapshot(71);
  const tab72 = getTabRuntimeSnapshot(72);

  assert.equal(tab71.commandLedger.length, 2);
  assert.equal(tab71.commandLedger[0].status, "ok");
  assert.equal(tab71.commandLedger[1].status, "error");
  assert.equal(tab72.commandLedger.length, 1);
  assert.equal(tab72.commandLedger[0].status, "ok");
});

test("deleting one tab runtime does not affect another", () => {
  updateTabRuntime(4001, { contentReady: true });
  updateTabRuntime(4002, { contentReady: false });

  assert.equal(deleteTabRuntime(4001), true);
  assert.equal(deleteTabRuntime(4001), false);

  const remaining = getTabRuntimeSnapshot(4002);
  assert.equal(remaining.tabId, 4002);
  assert.equal(remaining.contentReady, false);

  const recreated = getTabRuntime(4001);
  assert.equal(recreated.tabId, 4001);
  assert.equal(recreated.contentReady, false);
});

test("popup snapshot command is tab-scoped", async () => {
  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  registerBackgroundCommand("POPUP_GET_TAB_VIEW_STATE", async (context) => ({
    state: {
      ok: true,
      tabId: context.tabId,
      runtime: getTabRuntimeSnapshot(context.tabId)
    }
  }));

  updateTabRuntime(5101, {
    mode: "marking",
    contentReady: true,
    lastKnownContentState: {
      url: "https://example.com/a"
    }
  });
  updateTabRuntime(5102, {
    mode: "silent",
    contentReady: false,
    lastKnownContentState: {
      url: "https://example.com/b"
    }
  });

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "POPUP_GET_TAB_VIEW_STATE",
      tabId: 5101
    }),
    {},
    { requireTabForTypes: new Set(["POPUP_GET_TAB_VIEW_STATE"]) }
  );

  assert.equal(reply.ok, true);
  assert.equal(reply.result.state.tabId, 5101);
  assert.equal(reply.result.state.runtime.tabId, 5101);
  assert.equal(reply.result.state.runtime.mode, "marking");
  assert.notEqual(reply.result.state.runtime.tabId, 5102);
});

test("popup snapshot reads runtime without mutating it", async () => {
  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  registerBackgroundCommand("POPUP_GET_TAB_VIEW_STATE", async (context) => ({
    state: {
      ok: true,
      tabId: context.tabId,
      runtime: getTabRuntimeSnapshot(context.tabId)
    }
  }));

  updateTabRuntime(6201, {
    contentReady: true,
    mode: "inspection",
    operation: {
      id: "op-6201",
      kind: "render-mode-inspection"
    }
  });

  const before = getTabRuntimeSnapshot(6201);
  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "POPUP_GET_TAB_VIEW_STATE",
      tabId: 6201
    }),
    {},
    { requireTabForTypes: new Set(["POPUP_GET_TAB_VIEW_STATE"]) }
  );
  const after = getTabRuntimeSnapshot(6201);

  assert.equal(reply.ok, true);
  assert.deepEqual(after, before);
});
