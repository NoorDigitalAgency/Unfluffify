import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  __resetBackgroundCommandRegistryForTests,
  dispatchBackgroundCommand,
  registerBackgroundCommand
} from "../background/command-router.js";
import {
  __resetTabRuntimeForTests,
  deleteTabRuntime,
  getTabRuntimeSnapshot,
  updateTabRuntime
} from "../background/tab-runtime.js";
import { createSpinnerOperations } from "../background/spinner-operations.js";

function createEnvelope(overrides = {}) {
  return {
    id: "req-hardening",
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

function createSpinnerHarness() {
  const queueByTabId = new Map();
  const operations = createSpinnerOperations({
    queueByTabId,
    normalizeTabId(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 0;
      }
      const normalized = Math.trunc(numeric);
      return normalized > 0 ? normalized : 0;
    },
    appendTrace() {
      // No-op for this test harness.
    },
    broadcastState() {
      // No-op for this test harness.
    },
    buildState(tabId) {
      return {
        ok: Boolean(tabId),
        tabId,
        spinnerQueue: operations.serializeSpinnerQueue(tabId)
      };
    },
    updateRuntimeSpinnerQueue() {
      // No-op for this test harness.
    }
  });
  return { operations };
}

test.beforeEach(() => {
  __resetBackgroundCommandRegistryForTests();
  __resetTabRuntimeForTests();
});

test("same-URL tabs keep separate runtime modes", () => {
  updateTabRuntime(9001, {
    mode: "marking",
    lastKnownContentState: {
      url: "https://example.com/jobs",
      markingEnabled: true
    }
  });
  updateTabRuntime(9002, {
    mode: "silent",
    lastKnownContentState: {
      url: "https://example.com/jobs",
      markingEnabled: false
    }
  });

  assert.equal(getTabRuntimeSnapshot(9001).mode, "marking");
  assert.equal(getTabRuntimeSnapshot(9002).mode, "silent");
});

test("spinner state in tab A is invisible to tab B", () => {
  const { operations } = createSpinnerHarness();

  operations.setBackgroundSpinnerEntry(9101, "shared", { message: "A" });
  operations.setBackgroundSpinnerEntry(9102, "shared", { message: "B" });

  const tabA = operations.serializeSpinnerQueue(9101);
  const tabB = operations.serializeSpinnerQueue(9102);

  assert.equal(tabA.length, 1);
  assert.equal(tabB.length, 1);
  assert.equal(tabA[0].message, "A");
  assert.equal(tabB[0].message, "B");
});

test("lifecycle updates from tab A do not mutate tab B runtime", async () => {
  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  registerBackgroundCommand("UF_LIFECYCLE_EVENT", async (context, payload) => {
    const nextLifecycle = payload && payload.lifecycle && typeof payload.lifecycle === "object"
      ? payload.lifecycle
      : null;
    updateTabRuntime(context.tabId, { lifecycle: nextLifecycle });
    return { runtime: getTabRuntimeSnapshot(context.tabId) };
  });

  updateTabRuntime(9201, { lifecycle: null, mode: "marking" });
  updateTabRuntime(9202, { lifecycle: null, mode: "silent" });

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "UF_LIFECYCLE_EVENT",
      tabId: 9201,
      payload: {
        lifecycle: {
          kind: "activation",
          busy: true
        }
      }
    }),
    {},
    { requireTabForTypes: new Set(["UF_LIFECYCLE_EVENT"]) }
  );

  assert.equal(reply.ok, true);
  assert.equal(getTabRuntimeSnapshot(9201).lifecycle.kind, "activation");
  assert.equal(getTabRuntimeSnapshot(9202).lifecycle, null);
});

test("page-world command resolves only against the addressed tab", async () => {
  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  registerBackgroundCommand("PAGE_WORLD_RESOLVE", async (context, payload) => {
    const runtime = getTabRuntimeSnapshot(context.tabId);
    const nonce = runtime && runtime.pageWorld ? runtime.pageWorld.nonce : "";
    return {
      nonce,
      matched: nonce === (payload && payload.expectedNonce)
    };
  });

  updateTabRuntime(9301, { pageWorld: { ready: true, nonce: "nonce-a" } });
  updateTabRuntime(9302, { pageWorld: { ready: true, nonce: "nonce-b" } });

  const replyA = await dispatchBackgroundCommand(
    createEnvelope({
      type: "PAGE_WORLD_RESOLVE",
      tabId: 9301,
      payload: { expectedNonce: "nonce-b" }
    }),
    {},
    { requireTabForTypes: new Set(["PAGE_WORLD_RESOLVE"]) }
  );
  const replyB = await dispatchBackgroundCommand(
    createEnvelope({
      type: "PAGE_WORLD_RESOLVE",
      tabId: 9302,
      payload: { expectedNonce: "nonce-b" }
    }),
    {},
    { requireTabForTypes: new Set(["PAGE_WORLD_RESOLVE"]) }
  );

  assert.equal(replyA.ok, true);
  assert.equal(replyA.result.nonce, "nonce-a");
  assert.equal(replyA.result.matched, false);
  assert.equal(replyB.ok, true);
  assert.equal(replyB.result.nonce, "nonce-b");
  assert.equal(replyB.result.matched, true);
});

test("shared site id across tabs does not merge tab UI runtime state", () => {
  updateTabRuntime(9401, {
    mode: "marking",
    operation: { id: "op-9401", kind: "mode" },
    lastKnownContentState: {
      siteId: "5542",
      pageType: "candidate"
    }
  });
  updateTabRuntime(9402, {
    mode: "silent",
    operation: { id: "op-9402", kind: "mode" },
    lastKnownContentState: {
      siteId: "5542",
      pageType: "non-candidate"
    }
  });

  const tabA = getTabRuntimeSnapshot(9401);
  const tabB = getTabRuntimeSnapshot(9402);

  assert.equal(tabA.lastKnownContentState.siteId, "5542");
  assert.equal(tabB.lastKnownContentState.siteId, "5542");
  assert.equal(tabA.mode, "marking");
  assert.equal(tabB.mode, "silent");
  assert.equal(tabA.operation.id, "op-9401");
  assert.equal(tabB.operation.id, "op-9402");
});

test("popup debug-tab binding uses request tabId runtime, not sender tabId", async () => {
  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  registerBackgroundCommand("POPUP_GET_TAB_VIEW_STATE", async (context) => {
    return {
      runtime: getTabRuntimeSnapshot(context.tabId)
    };
  });

  updateTabRuntime(9501, { mode: "silent" });
  updateTabRuntime(9502, { mode: "marking" });

  const reply = await dispatchBackgroundCommand(
    createEnvelope({
      type: "POPUP_GET_TAB_VIEW_STATE",
      tabId: 9502
    }),
    {
      tab: { id: 9501 }
    },
    { requireTabForTypes: new Set(["POPUP_GET_TAB_VIEW_STATE"]) }
  );

  assert.equal(reply.ok, true);
  assert.equal(reply.result.runtime.tabId, 9502);
  assert.equal(reply.result.runtime.mode, "marking");
});

test("tab removal deletes only that tab runtime", () => {
  updateTabRuntime(9601, { mode: "marking" });
  updateTabRuntime(9602, { mode: "silent" });

  assert.equal(deleteTabRuntime(9601), true);
  assert.equal(getTabRuntimeSnapshot(9601).mode, "idle");
  assert.equal(getTabRuntimeSnapshot(9602).mode, "silent");
});
