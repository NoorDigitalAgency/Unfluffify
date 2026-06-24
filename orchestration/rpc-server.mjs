#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run --allow-net --allow-sys
import { join, resolve } from "@std/path";
import { appendJsonLine, createRunId } from "./lib/artifacts.mjs";
import {
  createRpcError,
  createRpcSuccess,
  normalizeRpcMessage
} from "./lib/protocol.mjs";
import { WebSocketPeer } from "./lib/websocket.mjs";
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
    const output = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      cwd,
      stdout: "piped",
      stderr: "piped"
    }).output();
    return new TextDecoder().decode(output.stdout).trim();
  } catch {
    return "";
  }
}

function extractToken(request) {
  const authHeader = request.headers.get("authorization") || "";
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

export function createRpcServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const runRoot = resolve(options.runRoot || "orchestration/runs");
  const runId = options.runId || `${createRunId()}-rpc-server`;
  const runDir = options.runDir || join(runRoot, runId);
  const transcriptPath = join(runDir, "rpc.log");
  const expectedToken = options.token || Deno.env.get("UNFLUFFIFY_RPC_TOKEN") || "";
  const repoPath = resolve(options.repoPath || Deno.cwd());
  const extensionPath = resolve(options.extensionPath || Deno.cwd());
  const startMs = Date.now();
  const peers = new Set();

  let listener = null;
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
      pid: Deno.pid,
      hostname: typeof Deno.hostname === "function" ? Deno.hostname() : "",
      platform: Deno.build.os,
      cwd: Deno.cwd(),
      repoPath,
      gitCommit: await readGitCommit(repoPath),
      nodeVersion: Deno.version.deno,
      uptimeMs: Date.now() - startMs,
      display: {
        DISPLAY: Deno.env.get("DISPLAY") || "",
        WAYLAND_DISPLAY: Deno.env.get("WAYLAND_DISPLAY") || "",
        XDG_SESSION_TYPE: Deno.env.get("XDG_SESSION_TYPE") || ""
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
      await Deno.stat(join(repoPath, ".git"));
      checks.repoGit = true;
    } catch {
      // Ignore missing .git metadata in non-repo launch environments.
    }
    try {
      await Deno.stat(join(extensionPath, "manifest.json"));
      checks.extensionManifest = true;
    } catch {
      // Ignore absent manifest during capability probing.
    }
    try {
      await Deno.mkdir(runDir, { recursive: true });
      const markerPath = join(runDir, ".write-check");
      await Deno.writeTextFile(markerPath, nowIso());
      await Deno.remove(markerPath);
      checks.runDirWritable = true;
    } catch {
      // Ignore writeability probe failures; the returned check remains false.
    }
    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      displayMode: Deno.env.get("WAYLAND_DISPLAY")
        ? "wayland"
        : Deno.env.get("DISPLAY")
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
    await Deno.mkdir(runDir, { recursive: true });
    listener = Deno.serve({
      hostname: host,
      port,
      onListen() {
      }
    }, async (request) => {
      if (request.url && new URL(request.url).pathname === "/health") {
        return new Response(JSON.stringify({ ok: true, peers: peers.size, shuttingDown }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (expectedToken && extractToken(request) !== expectedToken) {
        append({ direction: "reject", reason: "unauthorized-upgrade" }).catch(() => {});
        return new Response("", { status: 401 });
      }
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const { socket, response } = Deno.upgradeWebSocket(request);
        const peer = new WebSocketPeer(socket, {
          onMessage: (raw) => {
            onRawMessage(peer, raw).catch(() => {});
          },
          onClose: () => {
            peers.delete(peer);
          }
        });
        peers.add(peer);
        return response;
      }
      return new Response(null, { status: 404 });
    });
    const address = listener.addr;
    listeningPort = Number(address.port);
    const urlHost = host.includes(":") ? `[${host}]` : (host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host);
    return { host, port: listeningPort, url: `ws://${urlHost}:${listeningPort}` };
  }

  async function close() {
    for (const peer of Array.from(peers)) {
      peer.close();
    }
    peers.clear();
    if (listener) {
      await listener.shutdown();
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
  const args = parseArgs(Deno.args);
  const host = typeof args.host === "string" ? args.host : DEFAULT_HOST;
  const port = Number.isFinite(Number(args.port)) ? Number(args.port) : DEFAULT_PORT;
  const runRoot = typeof args["run-root"] === "string" ? args["run-root"] : resolve("orchestration/runs");
  const token = typeof args.token === "string" ? args.token : Deno.env.get("UNFLUFFIFY_RPC_TOKEN") || "";
  const repoPath = typeof args["repo-path"] === "string" ? args["repo-path"] : Deno.cwd();
  const extensionPath = typeof args["extension-path"] === "string" ? args["extension-path"] : Deno.cwd();
  const rpc = createRpcServer({ host, runRoot, token, repoPath, extensionPath });
  const listening = await rpc.listen(port);
  console.log(`[rpc] listening ${listening.url}`);
  console.log(`[rpc] runDir ${rpc.runDir}`);
  console.log(`[rpc] transcript ${rpc.transcriptPath}`);

  const shutdown = async () => {
    await rpc.close();
    Deno.exit(0);
  };
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    Deno.exit(1);
  });
}
