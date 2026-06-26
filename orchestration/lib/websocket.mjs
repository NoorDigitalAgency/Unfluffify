function toTextMessage(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("utf8");
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8");
  }
  return String(value);
}

function getSocketState(socket, fallback) {
  if (socket && typeof socket[fallback] === "number") {
    return socket[fallback];
  }
  if (typeof WebSocket !== "undefined" && typeof WebSocket[fallback] === "number") {
    return WebSocket[fallback];
  }
  return fallback === "OPEN" ? 1 : 0;
}

export class WebSocketPeer {
  constructor(socket, { onMessage, onClose } = {}) {
    this.socket = socket;
    this.closed = false;
    this.onMessage = typeof onMessage === "function" ? onMessage : () => {};
    this.onClose = typeof onClose === "function" ? onClose : () => {};

    if (typeof socket.addEventListener === "function") {
      socket.addEventListener("message", (event) => {
        if (this.closed) {
          return;
        }
        this.onMessage(toTextMessage(event.data));
      });
      socket.addEventListener("close", () => this.handleClose());
      socket.addEventListener("error", () => this.handleClose());
    } else if (typeof socket.on === "function") {
      socket.on("message", (value) => {
        if (this.closed) {
          return;
        }
        this.onMessage(toTextMessage(value));
      });
      socket.on("close", () => this.handleClose());
      socket.on("error", () => this.handleClose());
    } else {
      throw new Error("Unsupported WebSocket implementation");
    }
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value));
  }

  sendText(value) {
    if (this.closed || this.socket.readyState !== getSocketState(this.socket, "OPEN")) {
      return false;
    }

    try {
      this.socket.send(String(value));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      if (
        this.socket.readyState === getSocketState(this.socket, "OPEN") ||
        this.socket.readyState === getSocketState(this.socket, "CONNECTING")
      ) {
        this.socket.close();
      }
    } catch {
      // Ignore socket close failures during shutdown.
    }
    this.onClose();
  }

  handleClose() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onClose();
  }
}
