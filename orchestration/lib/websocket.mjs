export class WebSocketPeer {
  constructor(socket, { onMessage, onClose } = {}) {
    this.socket = socket;
    this.closed = false;
    this.onMessage = typeof onMessage === "function" ? onMessage : () => {};
    this.onClose = typeof onClose === "function" ? onClose : () => {};

    socket.onmessage = (event) => {
      if (this.closed) {
        return;
      }
      this.onMessage(typeof event.data === "string" ? event.data : String(event.data));
    };
    socket.onclose = () => this.handleClose();
    socket.onerror = () => this.handleClose();
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value));
  }

  sendText(value) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
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
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
    } catch {
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
