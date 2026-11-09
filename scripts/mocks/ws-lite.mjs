/**
 * LOCAL TEST ONLY. A small RFC 6455 client and server with no dependencies, so the harness can see the
 * raw HTTP status of a refused upgrade and set arbitrary upgrade headers (the browser-style global
 * WebSocket can do neither). Text and ping/pong/close frames only; no extensions.
 */
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { connect as netConnect } from "node:net";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const accept = (key) => createHash("sha1").update(key + GUID).digest("base64");

export class WsConn extends EventEmitter {
  constructor(socket, isClient, head) {
    super();
    this.socket = socket;
    this.isClient = isClient;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.closed = false;
    this.closeInfo = null;
    socket.setNoDelay?.(true);
    socket.on("data", (chunk) => this.#feed(chunk));
    socket.on("error", () => {});
    socket.on("close", () => this.#finished(this.closeInfo?.code ?? 1006, this.closeInfo?.reason ?? ""));
    if (head?.length) queueMicrotask(() => this.#feed(head));
  }

  #finished(code, reason) {
    if (this.closed) return;
    this.closed = true;
    this.closeInfo = { code, reason };
    this.emit("close", code, reason);
  }

  #feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const first = this.buffer[0];
      const second = this.buffer[1];
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskAt = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      if (masked) {
        const mask = this.buffer.subarray(maskAt, maskAt + 4);
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }
      this.buffer = this.buffer.subarray(offset + length);
      this.#frame(first & 0x0f, (first & 0x80) !== 0, payload);
    }
  }

  #frame(opcode, fin, payload) {
    if (opcode === 0x8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
      this.closeInfo = { code, reason };
      if (!this.sentClose) this.#write(0x8, payload);
      this.socket.end();
      this.#finished(code, reason);
      return;
    }
    if (opcode === 0x9) return this.#write(0xa, payload);
    if (opcode === 0xa) return undefined;
    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      if (opcode !== 0) this.fragmentOpcode = opcode;
      this.fragments.push(payload);
      if (!fin) return undefined;
      const message = Buffer.concat(this.fragments);
      this.fragments = [];
      this.emit("message", this.fragmentOpcode === 1 ? message.toString("utf8") : message);
    }
    return undefined;
  }

  #write(opcode, payload) {
    if (this.socket.destroyed || !this.socket.writable) return;
    const header = [0x80 | opcode];
    const mask = this.isClient ? 0x80 : 0;
    if (payload.length < 126) header.push(mask | payload.length);
    else if (payload.length < 65536) header.push(mask | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);
    else {
      header.push(mask | 127, 0, 0, 0, 0);
      header.push((payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff);
    }
    if (!this.isClient) {
      this.socket.write(Buffer.concat([Buffer.from(header), payload]));
      return;
    }
    const key = randomBytes(4);
    const masked = Buffer.from(payload);
    for (let index = 0; index < masked.length; index += 1) masked[index] ^= key[index % 4];
    this.socket.write(Buffer.concat([Buffer.from(header), key, masked]));
  }

  send(text) { this.#write(0x1, Buffer.from(text, "utf8")); }

  /** A graceful close handshake. */
  close(code = 1000, reason = "") {
    if (this.sentClose || this.closed) return;
    this.sentClose = true;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.#write(0x8, body);
    setTimeout(() => this.socket.destroy(), 500).unref();
  }

  /** Drop the TCP connection with no close frame. */
  terminate() { this.socket.destroy(); }
}

/**
 * `onUpgrade(request)` returns `{ status, body }` to refuse, or anything else to accept; `onConnection(conn, request)` follows.
 * `onRequest(request, response)` answers ordinary HTTP on the same port; without it every plain request gets 426.
 */
export function wsServer({ port, host = "127.0.0.1", onUpgrade, onConnection, onRequest }) {
  const server = createServer(onRequest ?? ((_request, response) => { response.writeHead(426); response.end(); }));
  const sockets = new Set();
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", (request, socket, head) => {
    const refusal = onUpgrade?.(request);
    if (refusal?.status) {
      socket.end(`HTTP/1.1 ${refusal.status} Refused\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(refusal.body ?? "")}\r\n\r\n${refusal.body ?? ""}`);
      return;
    }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept(request.headers["sec-websocket-key"])}\r\n\r\n`);
    onConnection(new WsConn(socket, false, head), request);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({
      server,
      close: () => new Promise((done) => { for (const socket of sockets) socket.destroy(); server.close(() => done()); }),
    }));
  });
}

/** Resolves `{ conn }` on 101, or `{ refused: status, body }` when the server answers anything else or drops it. */
export function wsConnect(url, { headers = {}, timeoutMs = 10_000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== "ws:" || !/^(127\.0\.0\.1|localhost)$/.test(target.hostname)) {
    throw new Error(`The local client only dials ws:// on loopback, not ${url}`);
  }
  const socket = netConnect(Number(target.port || 80), target.hostname);
  const key = randomBytes(16).toString("base64");
  return new Promise((resolve) => {
    let settled = false;
    let raw = Buffer.alloc(0);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("data", onData);
      resolve(value);
    };
    const timer = setTimeout(() => { socket.destroy(); finish({ refused: 0, body: "timeout" }); }, timeoutMs);
    const onData = (chunk) => {
      raw = Buffer.concat([raw, chunk]);
      const end = raw.indexOf("\r\n\r\n");
      if (end < 0) return;
      const status = Number(raw.subarray(0, end).toString("latin1").split(" ")[1]);
      const rest = raw.subarray(end + 4);
      if (status === 101) return finish({ conn: new WsConn(socket, true, rest) });
      socket.destroy();
      return finish({ refused: status, body: rest.toString("utf8") });
    };
    socket.on("data", onData);
    socket.on("error", () => finish({ refused: 0, body: "connection error" }));
    socket.on("close", () => finish({ refused: 0, body: "connection closed" }));
    socket.on("connect", () => {
      const lines = [
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.host}`, "Upgrade: websocket", "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), "", "",
      ];
      socket.write(lines.join("\r\n"));
    });
  });
}
