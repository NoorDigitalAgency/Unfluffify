import { assert } from "./test-kit.ts";
import { mkdtemp, readFile, rm } from "./file-kit.ts";
import os from "node:os";
import { path } from "./file-kit.ts";
import { test } from "./test-kit.ts";

import { createScenarioBusServer } from "../orchestration/bus-server.mjs";
import {
  createRpcError,
  createRpcNotification,
  createRpcRequest,
  createRpcSuccess,
  normalizeBusMessage,
  normalizeRpcMessage
} from "../orchestration/lib/protocol.mjs";

function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

function waitForMessage(socket) {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => {
      resolve(JSON.parse(event.data));
    }, { once: true });
  });
}

function sendJson(socket, message) {
  socket.send(JSON.stringify(message));
}

async function sendHello(socket, role, side) {
  const ackPromise = waitForMessage(socket);
  sendJson(socket, { channel: "control", type: "hello", role, side });
  const ack = await ackPromise;
  assert.equal(ack.type, "report");
  assert.equal(ack.stepId, "bus:hello");
  assert.equal(ack.state.ok, true);
  assert.equal(ack.state.role, role);
  assert.equal(ack.state.side, side);
}

test("orchestration protocol accepts the initial control and debug schema", () => {
  assert.equal(normalizeBusMessage({
    channel: "control",
    type: "hello",
    role: "director",
    side: "A"
  }).ok, true);
  assert.equal(normalizeBusMessage({
    channel: "control",
    type: "step",
    id: "open-property",
    action: "openProperty",
    params: { url: "https://www.bonliva.no/" }
  }).ok, true);
  assert.equal(normalizeBusMessage({
    channel: "debug",
    type: "note",
    text: "checking popup state"
  }).ok, true);
});

test("orchestration protocol rejects unknown or malformed messages", () => {
  assert.equal(normalizeBusMessage({ channel: "control", type: "takeover" }).ok, false);
  assert.equal(normalizeBusMessage({ channel: "debug", type: "note", text: "" }).ok, false);
  assert.equal(normalizeBusMessage({ channel: "control", type: "hello", role: "agent", side: "A" }).ok, false);
});

test("json-rpc helpers build valid request, notification, and response envelopes", () => {
  const request = createRpcRequest("cmd_1", "system.ping", { traceId: "abc" });
  assert.equal(normalizeRpcMessage(request).ok, true);
  assert.equal(normalizeRpcMessage(request).kind, "request");

  const notification = createRpcNotification("event.console", { level: "error" });
  assert.equal(normalizeRpcMessage(notification).ok, true);
  assert.equal(normalizeRpcMessage(notification).kind, "notification");

  const success = createRpcSuccess("cmd_1", { ok: true });
  assert.equal(normalizeRpcMessage(success).ok, true);
  assert.equal(normalizeRpcMessage(success).kind, "response");

  const failure = createRpcError("cmd_1", -32000, "Popup did not become ready", {
    category: "timeout"
  });
  assert.equal(normalizeRpcMessage(failure).ok, true);
  assert.equal(normalizeRpcMessage(failure).kind, "error");

  const parseError = createRpcError(null, -32700, "Parse error");
  const normalizedParseError = normalizeRpcMessage(parseError);
  assert.equal(normalizedParseError.ok, true);
  assert.equal(normalizedParseError.kind, "error");
  assert.equal(normalizedParseError.message.id, null);
});

test("json-rpc normalization rejects malformed envelopes", () => {
  assert.equal(normalizeRpcMessage({}).ok, false);
  assert.equal(normalizeRpcMessage({ jsonrpc: "2.0", method: "", id: "cmd_1" }).ok, false);
  assert.equal(normalizeRpcMessage({
    jsonrpc: "2.0",
    method: "system.ping",
    id: "cmd_1",
    result: { ok: true }
  }).ok, false);
  assert.equal(normalizeRpcMessage({
    jsonrpc: "2.0",
    id: "cmd_1",
    result: { ok: true },
    error: { code: -32000, message: "bad" }
  }).ok, false);
  assert.equal(normalizeRpcMessage({
    jsonrpc: "2.0",
    id: "cmd_1",
    error: { code: "x", message: "bad" }
  }).ok, false);
  assert.equal(normalizeRpcMessage({
    jsonrpc: "2.0",
    id: null,
    result: { ok: true }
  }).ok, false);
});

test("scenario bus relays typed control and debug messages and writes a transcript", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "unfluffify-bus-test-"));
  const bus = createScenarioBusServer({ runRoot, runId: "relay" });

  try {
    await bus.listen(0, "127.0.0.1");
    const director = new WebSocket(bus.url);
    const follower = new WebSocket(bus.url);
    await Promise.all([waitForOpen(director), waitForOpen(follower)]);

    await sendHello(director, "director", "A");
    await sendHello(follower, "follower", "B");

    const followerStepPromise = waitForMessage(follower);
    sendJson(director, {
      channel: "control",
      type: "step",
      id: "read-state",
      action: "readState",
      params: { tab: "active" }
    });
    assert.deepEqual(await followerStepPromise, {
      channel: "control",
      type: "step",
      id: "read-state",
      action: "readState",
      params: { tab: "active" },
      from: "director",
      fromSide: "A"
    });

    const directorNotePromise = waitForMessage(director);
    sendJson(follower, {
      channel: "debug",
      type: "note",
      text: "popup loaded",
      to: "director"
    });
    assert.deepEqual(await directorNotePromise, {
      channel: "debug",
      type: "note",
      text: "popup loaded",
      to: "director",
      from: "follower",
      fromSide: "B"
    });

    director.close();
    follower.close();
    await bus.close();

    const transcript = await readFile(bus.transcriptPath, "utf8");
    assert.match(transcript, /"type":"hello"/);
    assert.match(transcript, /"type":"step"/);
    assert.match(transcript, /"type":"note"/);
  } finally {
    await bus.close();
    await rm(runRoot, { recursive: true, force: true });
  }
});

test("scenario bus rejects unknown message types without relaying them", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "unfluffify-bus-test-"));
  const bus = createScenarioBusServer({ runRoot, runId: "reject" });

  try {
    await bus.listen(0, "127.0.0.1");
    const director = new WebSocket(bus.url);
    const follower = new WebSocket(bus.url);
    await Promise.all([waitForOpen(director), waitForOpen(follower)]);

    await sendHello(director, "director", "A");
    await sendHello(follower, "follower", "B");

    let relayed = false;
    follower.addEventListener("message", () => {
      relayed = true;
    }, { once: true });

    const errorPromise = waitForMessage(director);
    sendJson(director, { channel: "control", type: "unsupported_action" });
    const error = await errorPromise;
    assert.equal(error.type, "error");
    assert.match(error.detail, /Unknown control message type/);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(relayed, false);
  } finally {
    await bus.close();
    await rm(runRoot, { recursive: true, force: true });
  }
});
