#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { appendJsonLine, createRunId } from "./lib/artifacts.mjs";
import {
  createRpcError,
  createRpcSuccess,
  normalizeRpcMessage
} from "./lib/protocol.mjs";
import { acceptWebSocketUpgrade, WebSocketPeer } from "./lib/websocket.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9876;

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
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
    return String(stdout).trim();
  } catch {
    return "";
  }
}

function extractToken(request) {
  const authHeader = request.headers.authorization || "";
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  try {
    const url = new URL(request.url || "/", "http://localhost");
    return url.searchParams.get("token") || "";
  } catch {
    return "";
  }
}

function writeUpgradeRejection(socket) {
  socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  socket.end();
}

export function createRpcServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const runRoot = path.resolve(options.runRoot || "orchestration/runs");
  const runId = options.runId || `${createRunId()}-rpc-server`;
  const runDir = options.runDir || path.join(runRoot, runId);
  const transcriptPath = path.join(runDir, "rpc.log");
  const expectedToken = options.token || process.env.UNFLUFFIFY_RPC_TOKEN || "";
  const repoPath = path.resolve(options.repoPath || process.cwd());
  const extensionPath = path.resolve(options.extensionPath || process.cwd());
  const startMs = Date.now();
  const peers = new Set();

  let server = null;
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
      await fs.access(path.join(repoPath, ".git"));
      checks.repoGit = true;
    } catch {}
    try {
      await fs.access(path.join(extensionPath, "manifest.json"));
      checks.extensionManifest = true;
    } catch {}
    try {
      await fs.mkdir(runDir, { recursive: true });
      const markerPath = path.join(runDir, ".write-check");
      await fs.writeFile(markerPath, nowIso());
      await fs.unlink(markerPath);
      checks.runDirWritable = true;
    } catch {}
    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      displayMode: process.env.WAYLAND_DISPLAY
        ? "wayland"
        : process.env.DISPLAY
          ? "real"
          : "xvfb-or-headless",
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
      await append({ direction: "reject", reason: "invalid-json" });
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
      await append({ direction: "reject", reason: normalized.error });
      return;
    }
    const direction = normalized.kind === "request" || normalized.kind === "notification"
      ? "request"
      : "inbound";
    await append({ direction, kind: normalized.kind, method: parsed.method || "", id: parsed.id });
    if (normalized.kind === "request" || normalized.kind === "notification") {
      await handleRequest(peer, parsed);
    }
  }

  async function listen(port = DEFAULT_PORT) {
    await fs.mkdir(runDir, { recursive: true });
    server = http.createServer((request, response) => {
      if (request.url && request.url.startsWith("/health")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, peers: peers.size, shuttingDown }));
        return;
      }
      response.writeHead(404);
      response.end();
    });

    server.on("upgrade", (request, socket, head) => {
      if (expectedToken && extractToken(request) !== expectedToken) {
        writeUpgradeRejection(socket);
        append({ direction: "reject", reason: "unauthorized-upgrade" }).catch(() => {});
        return;
      }
      if (!acceptWebSocketUpgrade(request, socket)) {
        return;
      }
      if (head && head.length) {
        socket.unshift(head);
      }
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

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        listeningPort = Number(server.address().port);
        resolve();
      });
    });
    return { host, port: listeningPort, url: `ws://${host}:${listeningPort}` };
  }

  async function close() {
    for (const peer of Array.from(peers)) {
      peer.close();
    }
    peers.clear();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
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
  const runRoot = typeof args["run-root"] === "string" ? args["run-root"] : path.resolve("orchestration/runs");
  const token = typeof args.token === "string" ? args.token : process.env.UNFLUFFIFY_RPC_TOKEN || "";
  const repoPath = typeof args["repo-path"] === "string" ? args["repo-path"] : process.cwd();
  const extensionPath = typeof args["extension-path"] === "string" ? args["extension-path"] : process.cwd();
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

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
