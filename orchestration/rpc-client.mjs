#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRpcNotification,
  createRpcRequest,
  normalizeRpcMessage
} from "./lib/protocol.mjs";

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

function withToken(url, token) {
  if (!token) {
    return url;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid RPC url: ${url}`);
  }
  if (!parsed.searchParams.get("token")) {
    parsed.searchParams.set("token", token);
  }
  return parsed.toString();
}

function toError(value, fallbackMessage) {
  if (value instanceof Error) {
    return value;
  }
  if (value?.error instanceof Error) {
    return value.error;
  }
  const message = typeof value?.message === "string" && value.message.trim()
    ? value.message
    : fallbackMessage;
  const error = new Error(message);
  if (typeof value?.code !== "undefined") {
    error.code = value.code;
  }
  if (typeof value?.data !== "undefined") {
    error.data = value.data;
  }
  return error;
}

export function createRpcClient(options = {}) {
  const WebSocketImpl = options.WebSocketImpl || WebSocket;
  const url = withToken(String(options.url || ""), options.token || "");
  const requestTimeoutMs = Number(options.requestTimeoutMs) > 0 ? Number(options.requestTimeoutMs) : 30000;
  const pending = new Map();
  let nextId = 1;

  const socket = new WebSocketImpl(url);

  socket.addEventListener("message", (event) => {
    let parsed;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const normalized = normalizeRpcMessage(parsed);
    if (!normalized.ok) {
      return;
    }
    if (normalized.kind !== "response" && normalized.kind !== "error") {
      return;
    }
    const key = String(parsed.id);
    const record = pending.get(key);
    if (!record) {
      return;
    }
    pending.delete(key);
    clearTimeout(record.timeout);
    if (normalized.kind === "error") {
      record.reject(toError(parsed.error || { code: -32000, message: "RPC error" }, "RPC error"));
      return;
    }
    record.resolve(parsed.result);
  });

  socket.addEventListener("close", () => {
    for (const [key, record] of pending.entries()) {
      clearTimeout(record.timeout);
      record.reject(new Error("RPC socket closed"));
      pending.delete(key);
    }
  });

  function waitForOpen() {
    if (socket.readyState === WebSocketImpl.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onOpen = () => {
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        resolve();
      };
      const onError = (error) => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("close", onClose);
        reject(toError(error, "RPC socket error before opening"));
      };
      const onClose = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        reject(new Error("RPC socket closed before opening"));
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("close", onClose, { once: true });
    });
  }

  async function request(method, params = {}, options = {}) {
    await waitForOpen();
    const id = typeof options.id !== "undefined" ? options.id : `cmd_${nextId++}`;
    const payload = createRpcRequest(id, method, params);
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : requestTimeoutMs;
    const key = String(id);
    const resultPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(key);
        reject(new Error(`RPC timeout after ${timeoutMs}ms for ${method}`));
      }, timeoutMs);
      pending.set(key, { resolve, reject, timeout });
    });
    socket.send(JSON.stringify(payload));
    return resultPromise;
  }

  async function notify(method, params = {}) {
    await waitForOpen();
    socket.send(JSON.stringify(createRpcNotification(method, params)));
  }

  function close() {
    socket.close();
  }

  return {
    socket,
    waitForOpen,
    request,
    notify,
    close
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = typeof args.url === "string" ? args.url : "ws://127.0.0.1:9876";
  const method = typeof args.method === "string" ? args.method : "system.ping";
  const token = typeof args.token === "string" ? args.token : "";
  const params = typeof args.params === "string" ? JSON.parse(args.params) : {};
  const client = createRpcClient({ url, token });
  try {
    const result = await client.request(method, params);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    client.close();
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
