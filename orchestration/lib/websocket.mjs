import { createHash } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

function createAcceptKey(key) {
  return createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
}

function encodeFrame(payload, opcode = OPCODE_TEXT) {
  const body = Buffer.from(payload);
  const header = [];
  header.push(0x80 | opcode);
  if (body.length < 126) {
    header.push(body.length);
  } else if (body.length <= 0xffff) {
    header.push(126, (body.length >> 8) & 0xff, body.length & 0xff);
  } else {
    const length = BigInt(body.length);
    header.push(127);
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      header.push(Number((length >> shift) & 0xffn));
    }
  }
  return Buffer.concat([Buffer.from(header), body]);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket frame is too large");
      }
      length = Number(bigLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;

    const mask = masked
      ? buffer.subarray(offset + headerLength, offset + headerLength + 4)
      : null;
    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    frames.push({ opcode, payload });
    offset += frameLength;
  }

  return {
    frames,
    remaining: buffer.subarray(offset)
  };
}

export function acceptWebSocketUpgrade(request, socket) {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return false;
  }

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${createAcceptKey(key)}`,
    "",
    ""
  ].join("\r\n"));

  return true;
}

export class WebSocketPeer {
  constructor(socket, { onMessage, onClose } = {}) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.onMessage = typeof onMessage === "function" ? onMessage : () => {};
    this.onClose = typeof onClose === "function" ? onClose : () => {};

    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("close", () => this.handleClose());
    socket.on("error", () => this.handleClose());
  }

  handleData(chunk) {
    if (this.closed) {
      return;
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);
    let decoded;
    try {
      decoded = decodeFrames(this.buffer);
    } catch (error) {
      this.close();
      return;
    }
    this.buffer = decoded.remaining;

    for (const frame of decoded.frames) {
      if (frame.opcode === OPCODE_TEXT) {
        this.onMessage(frame.payload.toString("utf8"));
      } else if (frame.opcode === OPCODE_PING) {
        this.socket.write(encodeFrame(frame.payload, OPCODE_PONG));
      } else if (frame.opcode === OPCODE_CLOSE) {
        this.close();
      }
    }
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value));
  }

  sendText(value) {
    if (this.closed || this.socket.destroyed) {
      return false;
    }

    try {
      this.socket.write(encodeFrame(String(value)));
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
      if (!this.socket.destroyed) {
        this.socket.write(encodeFrame(Buffer.alloc(0), OPCODE_CLOSE));
        this.socket.end();
      }
    } catch {
      this.socket.destroy();
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
