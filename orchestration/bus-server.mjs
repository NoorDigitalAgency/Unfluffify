#!/usr/bin/env node
import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { WebSocketPeer } from "./lib/websocket.mjs";
import {
  BUS_ROLES,
  CONTROL_CHANNEL,
  createProtocolError,
  normalizeBusMessage
} from "./lib/protocol.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function nowIso(clock) {
  return (clock && typeof clock.now === "function" ? new Date(clock.now()) : new Date()).toISOString();
}

function normalizeRole(value) {
  return BUS_ROLES.has(value) ? value : "";
}

function getOppositeRole(role) {
  if (role === "director") return "follower";
  if (role === "follower") return "director";
  return "";
}

export function createScenarioBusServer(options = {}) {
  const peers = new Set();
  const runRoot = options.runRoot || resolve("orchestration/runs");
  const runId = options.runId || timestampForPath();
  const runDir = options.runDir || join(runRoot, runId);
  const transcriptPath = join(runDir, "bus.log");
  const clock = options.clock || null;

  let listener = null;
  let socketServer = null;
  let listeningUrl = "";
  let writeQueue = Promise.resolve();

  async function ensureRunDir() {
    await mkdir(runDir, { recursive: true });
  }

  function appendTranscript(entry) {
    writeQueue = writeQueue
      .then(async () => {
        await ensureRunDir();
        await writeFile(transcriptPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
      })
      .catch(() => {});
    return writeQueue;
  }

  function serializePeer(peer) {
    return {
      id: peer.id,
      role: peer.role || "",
      side: peer.side || ""
    };
  }

  function send(peer, message) {
    peer.connection.sendJson(message);
  }

  function relay(sender, message) {
    const target = message.to || getOppositeRole(sender.role) || "all";
    const recipients = Array.from(peers).filter((peer) => {
      if (peer === sender) {
        return false;
      }
      if (target === "all") {
        return true;
      }
      return peer.role === target;
    });

    for (const recipient of recipients) {
      send(recipient, {
        ...message,
        from: sender.role || sender.id,
        fromSide: sender.side || ""
      });
    }
  }

  function handleRawMessage(peer, rawValue) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      const errorMessage = createProtocolError("Message must be valid JSON");
      send(peer, errorMessage);
      appendTranscript({
        at: nowIso(clock),
        direction: "reject",
        from: serializePeer(peer),
        error: errorMessage.detail,
        raw: rawValue
      });
      return;
    }

    const normalized = normalizeBusMessage(parsed);
    if (!normalized.ok) {
      const errorMessage = createProtocolError(normalized.error);
      send(peer, errorMessage);
      appendTranscript({
        at: nowIso(clock),
        direction: "reject",
        from: serializePeer(peer),
        error: normalized.error,
        message: parsed
      });
      return;
    }

    const message = normalized.message;
    if (message.channel === CONTROL_CHANNEL && message.type === "hello") {
      peer.role = normalizeRole(message.role);
      peer.side = message.side.trim();
      send(peer, {
        channel: CONTROL_CHANNEL,
        type: "report",
        stepId: "bus:hello",
        state: {
          ok: true,
          role: peer.role,
          side: peer.side
        }
      });
      appendTranscript({
        at: nowIso(clock),
        direction: "receive",
        from: serializePeer(peer),
        message
      });
      return;
    }

    appendTranscript({
      at: nowIso(clock),
      direction: "receive",
      from: serializePeer(peer),
      message
    });
    relay(peer, message);
  }

  function attachPeer(socket) {
    const peer = {
      id: `peer-${peers.size + 1}-${Date.now().toString(36)}`,
      role: "",
      side: "",
      connection: null
    };
    peer.connection = new WebSocketPeer(socket, {
      onMessage: (rawValue) => handleRawMessage(peer, rawValue),
      onClose: () => {
        peers.delete(peer);
        appendTranscript({
          at: nowIso(clock),
          direction: "disconnect",
          from: serializePeer(peer)
        });
      }
    });
    peers.add(peer);
    appendTranscript({
      at: nowIso(clock),
      direction: "connect",
      from: serializePeer(peer)
    });
  }

  async function listen(port = DEFAULT_PORT, host = DEFAULT_HOST) {
    await ensureRunDir();
    listener = http.createServer((request, response) => {
      void handleRequest(request, response);
    });
    socketServer = new WebSocketServer({ noServer: true });
    socketServer.on("connection", (socket) => {
      attachPeer(socket);
    });
    listener.on("upgrade", (request, socket, head) => {
      socketServer.handleUpgrade(request, socket, head, (webSocket) => {
        socketServer.emit("connection", webSocket, request);
      });
    });
    await new Promise((resolvePromise, rejectPromise) => {
      listener.once("error", rejectPromise);
      listener.listen({ host, port }, () => {
        listener.off("error", rejectPromise);
        resolvePromise();
      });
    });
    const address = listener.address();
    if (!address || typeof address === "string") {
      throw new Error("Scenario bus listener did not expose a TCP address");
    }
    const boundHost = address.address;
    const actualHost = boundHost === "0.0.0.0" || boundHost === "::"
      ? "127.0.0.1"
      : boundHost;
    listeningUrl = `ws://${actualHost}:${address.port}`;
    return listeningUrl;
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, peers: peers.size }));
      return;
    }
    response.writeHead(404);
    response.end();
  }

  async function close() {
    for (const peer of Array.from(peers)) {
      peer.connection.close();
    }
    peers.clear();
    if (socketServer) {
      await new Promise((resolvePromise) => {
        socketServer.close(() => resolvePromise());
      });
      socketServer = null;
    }
    if (listener) {
      await new Promise((resolvePromise) => {
        listener.close(() => resolvePromise());
      });
      listener = null;
    }
    await writeQueue;
  }

  return {
    get url() {
      return listeningUrl;
    },
    get peers() {
      return peers.size;
    },
    runDir,
    transcriptPath,
    listen,
    close
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = typeof args.host === "string" ? args.host : DEFAULT_HOST;
  const port = Number.isFinite(Number(args.port)) ? Number(args.port) : DEFAULT_PORT;
  const runRoot = typeof args["run-root"] === "string" ? args["run-root"] : resolve("orchestration/runs");
  const bus = createScenarioBusServer({ runRoot });
  const url = await bus.listen(port, host);
  console.log(`[bus] listening ${url}`);
  console.log(`[bus] transcript ${bus.transcriptPath}`);

  const shutdown = async () => {
    await bus.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
