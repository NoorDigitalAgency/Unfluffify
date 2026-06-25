#!/usr/bin/env node
import { execFile } from "node:child_process";
import http from "node:http";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import { appendJsonLine, createRunId } from "./lib/artifacts.mjs";
import {
  createRpcError,
  createRpcSuccess,
  normalizeRpcMessage
} from "./lib/protocol.mjs";
import { WebSocketPeer } from "./lib/websocket.mjs";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9876;
const execFileAsync = promisify(execFile);

function parseArgs(argv = []) {
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
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

function nowIso() {
  return new Date().toISOString();
}

async function readGitCommit(cwd) {
  try {
    const output = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
    return output.stdout.trim();
  } catch {
    return "";
  }
}

function extractToken(request) {
  const authHeader = request.headers?.authorization || "";
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  try {
    const url = new URL(request.url || "/", `http://${request.headers?.host || "127.0.0.1"}`);
    return url.searchParams.get("token") || "";
  } catch {
    return "";
  }
}

export function createRpcServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const runRoot = resolve(options.runRoot || "orchestration/runs");
  const runId = options.runId || `${createRunId()}-rpc-server`;
  const runDir = options.runDir || join(runRoot, runId);
  const transcriptPath = join(runDir, "rpc.log");
  const expectedToken = options.token || process.env.UNFLUFFIFY_RPC_TOKEN || "";
  const repoPath = resolve(options.repoPath || process.cwd());
  const extensionPath = resolve(options.extensionPath || join(process.cwd(), ".output", "chrome-mv3"));
  const startMs = Date.now();
  const peers = new Set();

  let listener = null;
  let socketServer = null;
  let listeningPort = 0;
  let shuttingDown = false;

  async function append(entry) {
    await appendJsonLine(transcriptPath, {
      at: nowIso(),
      ...entry
    });
  }

  async function systemPing() {
    return {
      ok: true,
      pid: process.pid,
      hostname: os.hostname(),
      platform: process.platform,
      cwd: process.cwd(),
      repoPath,
      gitCommit: await readGitCommit(repoPath),
      nodeVersion: process.version,
      uptimeMs: Date.now() - startMs,
      display: {
        DISPLAY: process.env.DISPLAY || "",
        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "",
        XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE || ""
      },
      runDir
    };
  }

  async function systemPreflight() {
    const checks = {
      repoGit: false,
      extensionManifest: false,
      runDirWritable: false
    };
    try {
      await stat(join(repoPath, ".git"));
      checks.repoGit = true;
    } catch {
      // Ignore missing .git metadata in non-repo launch environments.
    }
    try {
      await stat(join(extensionPath, "manifest.json"));
      checks.extensionManifest = true;
    } catch {
      // Ignore absent manifest during capability probing.
    }
    try {
      await mkdir(runDir, { recursive: true });
      const markerPath = join(runDir, ".write-check");
      await writeFile(markerPath, nowIso());
      await rm(markerPath);
      checks.runDirWritable = true;
    } catch {
      // Ignore writeability probe failures; the returned check remains false.
    }
    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      displayMode: process.env.WAYLAND_DISPLAY
        ? "wayland"
        : process.env.DISPLAY
          ? "x11"
          : "none",
      runDir
    };
  }

  const methods = {
    "system.ping": () => systemPing(),
    "system.preflight": () => systemPreflight(),
    "system.shutdown": () => {
      shuttingDown = true;
      return { ok: true, shuttingDown: true };
    }
  };

  async function handleRequest(peer, request) {
    const handler = methods[request.method];
    if (!handler) {
      if (typeof request.id !== "undefined") {
        peer.sendJson(createRpcError(request.id, -32601, "Method not found", { method: request.method }));
      }
      return;
    }
    try {
      const result = await handler(request.params || {});
      if (typeof request.id !== "undefined") {
        peer.sendJson(createRpcSuccess(request.id, result));
      }
      if (request.method === "system.shutdown") {
        setTimeout(() => {
          close().catch(() => {});
        }, 10);
      }
      append({ direction: "response", method: request.method, id: request.id, ok: true }).catch(() => {});
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (typeof request.id !== "undefined") {
        peer.sendJson(createRpcError(request.id, -32000, message));
      }
      append({ direction: "response", method: request.method, id: request.id, ok: false, error: message }).catch(() => {});
    }
  }

  async function onRawMessage(peer, raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      peer.sendJson(createRpcError(null, -32700, "Parse error"));
      append({ direction: "reject", reason: "invalid-json" }).catch(() => {});
      return;
    }
    const normalized = normalizeRpcMessage(parsed);
    if (!normalized.ok) {
      const rawId = parsed && Object.prototype.hasOwnProperty.call(parsed, "id") ? parsed.id : null;
      const id = (rawId === null ||
        (typeof rawId === "string" && rawId.trim()) ||
        (typeof rawId === "number" && Number.isFinite(rawId)))
        ? rawId
        : null;
      peer.sendJson(createRpcError(id, -32600, normalized.error));
      append({ direction: "reject", reason: normalized.error }).catch(() => {});
      return;
    }
    const direction = normalized.kind === "request" || normalized.kind === "notification"
      ? "request"
      : "inbound";
    append({ direction, kind: normalized.kind, method: parsed.method || "", id: parsed.id }).catch(() => {});
    if (normalized.kind === "request" || normalized.kind === "notification") {
      await handleRequest(peer, parsed);
    }
  }

  async function listen(port = DEFAULT_PORT) {
    await mkdir(runDir, { recursive: true });
    listener = http.createServer((request, response) => {
      if (request.url && new URL(request.url, "http://localhost").pathname === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, peers: peers.size, shuttingDown }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    socketServer = new WebSocketServer({ noServer: true });
    socketServer.on("connection", (socket) => {
      const peer = new WebSocketPeer(socket, {
        onMessage: (raw) => {
          onRawMessage(peer, raw).catch(() => {});
        },
        onClose: () => {
          peers.delete(peer);
        }
      });
      peers.add(peer);
    });
    listener.on("upgrade", (request, socket, head) => {
      if (expectedToken && extractToken(request) !== expectedToken) {
        append({ direction: "reject", reason: "unauthorized-upgrade" }).catch(() => {});
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
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
      throw new Error("RPC listener did not expose a TCP address");
    }
    listeningPort = Number(address.port);
    const urlHost = host.includes(":") ? `[${host}]` : (host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host);
    return { host, port: listeningPort, url: `ws://${urlHost}:${listeningPort}` };
  }

  async function close() {
    for (const peer of Array.from(peers)) {
      peer.close();
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
  }

  return {
    runDir,
    transcriptPath,
    get tokenRequired() {
      return Boolean(expectedToken);
    },
    listen,
    close
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = typeof args.host === "string" ? args.host : DEFAULT_HOST;
  const port = Number.isFinite(Number(args.port)) ? Number(args.port) : DEFAULT_PORT;
  const runRoot = typeof args["run-root"] === "string" ? args["run-root"] : resolve("orchestration/runs");
  const token = typeof args.token === "string" ? args.token : process.env.UNFLUFFIFY_RPC_TOKEN || "";
  const repoPath = typeof args["repo-path"] === "string" ? args["repo-path"] : process.cwd();
  const extensionPath = typeof args["extension-path"] === "string"
    ? args["extension-path"]
    : join(process.cwd(), ".output", "chrome-mv3");
  const rpc = createRpcServer({ host, runRoot, token, repoPath, extensionPath });
  const listening = await rpc.listen(port);
  console.log(`[rpc] listening ${listening.url}`);
  console.log(`[rpc] runDir ${rpc.runDir}`);
  console.log(`[rpc] transcript ${rpc.transcriptPath}`);

  const shutdown = async () => {
    await rpc.close();
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
