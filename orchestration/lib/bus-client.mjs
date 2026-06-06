import { createProtocolError, normalizeBusMessage } from "./protocol.mjs";

function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

export class ScenarioBusClient {
  constructor({ url, role, side, onMessage }) {
    this.url = url;
    this.role = role;
    this.side = side;
    this.onMessage = typeof onMessage === "function" ? onMessage : () => {};
    this.socket = null;
    this.helloAck = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const normalized = normalizeBusMessage(message);
      if (!normalized.ok) {
        this.send(createProtocolError(normalized.error));
        return;
      }
      if (
        normalized.message.type === "report" &&
        normalized.message.stepId === "bus:hello" &&
        normalized.message.state &&
        normalized.message.state.ok
      ) {
        this.helloAck = normalized.message;
      }
      this.onMessage(normalized.message);
    });
    await waitForOpen(this.socket);
    this.send({
      channel: "control",
      type: "hello",
      role: this.role,
      side: this.side
    });
    await this.waitForHelloAck();
  }

  async waitForHelloAck(timeoutMs = 5000) {
    if (this.helloAck) {
      return this.helloAck;
    }
    const startedAt = Date.now();
    while (!this.helloAck) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Timed out waiting for scenario bus hello ack");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return this.helloAck;
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
