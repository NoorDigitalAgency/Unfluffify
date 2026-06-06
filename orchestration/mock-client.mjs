#!/usr/bin/env node

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

function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

const args = parseArgs(process.argv.slice(2));
const host = typeof args.host === "string" ? args.host : "127.0.0.1";
const port = Number.isFinite(Number(args.port)) ? Number(args.port) : 8765;
const role = args.role === "follower" ? "follower" : "director";
const side = typeof args.side === "string" ? args.side : (role === "director" ? "A" : "B");
const note = typeof args.note === "string" ? args.note : "";
const url = typeof args.url === "string" ? args.url : `ws://${host}:${port}`;

const socket = new WebSocket(url);
socket.addEventListener("message", (event) => {
  console.log(`[bus:${role}] ${event.data}`);
});

await waitForOpen(socket);
socket.send(JSON.stringify({
  channel: "control",
  type: "hello",
  role,
  side
}));

if (note) {
  socket.send(JSON.stringify({
    channel: "debug",
    type: "note",
    text: note,
    to: "all"
  }));
}

await new Promise((resolve) => setTimeout(resolve, 500));
socket.close();
