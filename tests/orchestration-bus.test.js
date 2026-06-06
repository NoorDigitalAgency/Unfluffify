import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createScenarioBusServer } from "../orchestration/bus-server.mjs";
import { normalizeBusMessage } from "../orchestration/lib/protocol.mjs";

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
