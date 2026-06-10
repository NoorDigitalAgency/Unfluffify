import test from "node:test";
import assert from "node:assert/strict";

import {
  __resetContentCommandRegistryForTests,
  dispatchContentCommand,
  registerContentCommand
} from "../content/content-command-router.js";

function createEnvelope(overrides = {}) {
  return {
    id: "content-req-1",
    type: "CONTENT_TEST",
    source: "background",
    target: "content",
    tabId: 91,
    frameId: 0,
    expectsReply: true,
    payload: {},
    ...overrides
  };
}

test.beforeEach(() => {
  __resetContentCommandRegistryForTests();
});

test("dispatchContentCommand returns handler_not_found for unknown command", async () => {
  const reply = await dispatchContentCommand(createEnvelope({ type: "MISSING" }), {}, {
    pageUrl: () => "https://example.com/page",
    mode: () => "silent"
  });

  assert.equal(reply.ok, false);
  assert.equal(reply.code, "handler_not_found");
});

test("dispatchContentCommand resolves successful handler responses", async () => {
  registerContentCommand("CONTENT_TEST", async (context, payload) => {
    assert.equal(context.tabId, 91);
    assert.equal(context.frameId, 0);
    assert.equal(context.pageUrl, "https://example.com/page");
    assert.equal(context.mode, "marking");
    return {
      seenType: context.message.type,
      payload
    };
  });

  const reply = await dispatchContentCommand(
    createEnvelope({ payload: { hello: "world" } }),
    {},
    {
      pageUrl: () => "https://example.com/page",
      mode: () => "marking"
    }
  );

  assert.equal(reply.ok, true);
  assert.deepEqual(reply.result, {
    seenType: "CONTENT_TEST",
    payload: { hello: "world" }
  });
});

test("dispatchContentCommand normalizes thrown handler errors", async () => {
  registerContentCommand("CONTENT_TEST", async () => {
    const error = new Error("content failure");
    error.code = "handler_failed";
    throw error;
  });

  const reply = await dispatchContentCommand(
    createEnvelope(),
    {},
    {
      pageUrl: () => "https://example.com/page",
      mode: () => "silent"
    }
  );

  assert.equal(reply.ok, false);
  assert.equal(reply.code, "handler_failed");
  assert.equal(reply.error, "content failure");
});