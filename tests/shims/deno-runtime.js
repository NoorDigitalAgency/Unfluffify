import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, readFile as readBinaryFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname as getHostname } from "node:os";

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws");

globalThis.WebSocket = WebSocket;

class DenoNotFoundError extends Error {}

function mapPlatform(platform) {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "darwin";
  }
  return "linux";
}

function normalizeFsError(error) {
  if (error && typeof error === "object" && error.code === "ENOENT") {
    const notFound = new DenoNotFoundError(error.message);
    notFound.cause = error;
    throw notFound;
  }
  throw error;
}

function createWebSocketProxy() {
  let socket = null;
  let onmessage = null;
  let onclose = null;
  let onerror = null;

  return {
    get readyState() {
      return socket ? socket.readyState : WebSocket.CONNECTING;
    },
    set onmessage(handler) {
      onmessage = typeof handler === "function" ? handler : null;
    },
    get onmessage() {
      return onmessage;
    },
    set onclose(handler) {
      onclose = typeof handler === "function" ? handler : null;
    },
    get onclose() {
      return onclose;
    },
    set onerror(handler) {
      onerror = typeof handler === "function" ? handler : null;
    },
    get onerror() {
      return onerror;
    },
    bind(nextSocket) {
      socket = nextSocket;
      socket.on("message", (data) => {
        onmessage?.({
          data: typeof data === "string" ? data : data.toString(),
        });
      });
      socket.on("close", () => {
        onclose?.();
      });
      socket.on("error", (error) => {
        onerror?.(error);
      });
    },
    send(data) {
      socket?.send(data);
    },
    close() {
      socket?.close();
    },
  };
}

function requestToFetchRequest(req) {
  const host = req.headers.host || "127.0.0.1";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return {
    method: req.method,
    url: new URL(req.url || "/", `http://${host}`).toString(),
    headers,
  };
}

async function writeNodeResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

async function writeUpgradeResponse(socket, response) {
  const headers = [];
  response.headers.forEach((value, key) => {
    headers.push(`${key}: ${value}`);
  });
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
  if (body.length && !response.headers.has("content-length")) {
    headers.push(`content-length: ${body.length}`);
  }
  const statusText = response.statusText || "OK";
  socket.write(
    `HTTP/1.1 ${response.status} ${statusText}\r\n${headers.join("\r\n")}\r\n\r\n`,
  );
  if (body.length) {
    socket.write(body);
  }
  socket.end();
}

function createCommand(command, options = {}) {
  return {
    async output() {
      return await new Promise((resolve, reject) => {
        const child = spawn(command, options.args || [], {
          cwd: options.cwd,
          env: options.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdoutChunks = [];
        const stderrChunks = [];

        child.stdout.on("data", (chunk) => {
          stdoutChunks.push(Buffer.from(chunk));
        });
        child.stderr.on("data", (chunk) => {
          stderrChunks.push(Buffer.from(chunk));
        });
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({
            stdout: Buffer.concat(stdoutChunks),
            stderr: Buffer.concat(stderrChunks),
            code: code ?? 0,
          });
        });
      });
    },
  };
}

const upgradeRequests = new WeakMap();
const upgradeResponses = new WeakMap();

globalThis.Deno = {
  args: [],
  pid: process.pid,
  build: {
    os: mapPlatform(process.platform),
  },
  version: {
    deno: process.version.replace(/^v/, ""),
  },
  errors: {
    NotFound: DenoNotFoundError,
  },
  env: {
    get(name) {
      return process.env[name];
    },
    toObject() {
      return { ...process.env };
    },
  },
  cwd() {
    return process.cwd();
  },
  hostname() {
    return getHostname();
  },
  async mkdir(path, options = {}) {
    try {
      await mkdir(path, { recursive: Boolean(options.recursive) });
    } catch (error) {
      normalizeFsError(error);
    }
  },
  async stat(path) {
    try {
      return await stat(path);
    } catch (error) {
      normalizeFsError(error);
    }
  },
  async readTextFile(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      normalizeFsError(error);
    }
  },
  async readFile(path) {
    try {
      return new Uint8Array(await readBinaryFile(path));
    } catch (error) {
      normalizeFsError(error);
    }
  },
  async writeTextFile(path, data, options = {}) {
    await writeFile(path, data, { flag: options.append ? "a" : "w" });
  },
  async writeFile(path, data, options = {}) {
    await writeFile(path, data, { flag: options.append ? "a" : "w" });
  },
  async remove(path, options = {}) {
    try {
      await rm(path, { recursive: Boolean(options.recursive), force: false });
    } catch (error) {
      normalizeFsError(error);
    }
  },
  Command: class {
    constructor(command, options) {
      this.command = command;
      this.options = options || {};
    }

    output() {
      return createCommand(this.command, this.options).output();
    }
  },
  serve(options, handler) {
    const wsServer = new WebSocketServer({ noServer: true });
    const listener = {
      addr: {
        hostname: options.hostname,
        port: options.port,
      },
      ready: null,
      async shutdown() {
        await new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
        await new Promise((resolve) => {
          wsServer.close(() => resolve());
        });
      },
    };

    const server = createServer(async (req, res) => {
      try {
        const response = await handler(requestToFetchRequest(req));
        await writeNodeResponse(res, response);
      } catch (error) {
        res.statusCode = 500;
        res.end(String(error?.message || error));
      }
    });

    server.on("upgrade", async (req, socket, head) => {
      const request = requestToFetchRequest(req);
      const entry = { req, socket, head, proxy: null };
      upgradeRequests.set(request, entry);
      try {
        const response = await handler(request);
        const upgraded = upgradeResponses.get(response);
        if (upgraded) {
          wsServer.handleUpgrade(req, socket, head, (ws) => {
            upgraded.proxy.bind(ws);
          });
          return;
        }
        await writeUpgradeResponse(socket, response);
      } catch {
        socket.write("HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\n\r\n");
        socket.end();
      }
    });

    listener.ready = new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.hostname, () => {
        const address = server.address();
        listener.addr = {
          hostname:
            address && typeof address === "object" && address.address
              ? address.address
              : options.hostname,
          port:
            address && typeof address === "object" && typeof address.port === "number"
              ? address.port
              : options.port,
        };
        if (typeof options.onListen === "function") {
          options.onListen(listener.addr);
        }
        resolve();
      });
    });

    return listener;
  },
  upgradeWebSocket(request) {
    const entry = upgradeRequests.get(request);
    if (!entry) {
      throw new Error("upgradeWebSocket called without a matching upgrade request");
    }
    const proxy = createWebSocketProxy();
    const response = { status: 101 };
    entry.proxy = proxy;
    upgradeResponses.set(response, entry);
    return { socket: proxy, response };
  },
  addSignalListener() {},
  exit(code = 0) {
    const error = new Error(`Deno.exit(${code})`);
    error.code = code;
    throw error;
  },
};
