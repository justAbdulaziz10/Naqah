/**
 * LOCAL TEST ONLY. Behaves like Twilio's side of a Media Streams connection: a signed upgrade, then
 * `connected`, `start`, G.711 mu-law `media`, `mark` acknowledgements and `stop`. Records what the bridge sends.
 */
import { createHmac, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { wsConnect } from "./ws-lite.mjs";

/** Twilio signs a WebSocket upgrade over the URL alone: HMAC-SHA1 with the auth token, base64. */
export const signUpgrade = (publicUrl, token) => createHmac("sha1", token).update(publicUrl, "utf8").digest("base64");

export const FRAME_BYTES = 160; // 20 ms of 8 kHz mu-law
export const SILENCE = Buffer.alloc(FRAME_BYTES, 0xff).toString("base64");

/** A distinctive non-silent frame (mu-law byte 0x15), a canary for audio leaking into logs. */
export const VOICED = Buffer.alloc(FRAME_BYTES, 0x15).toString("base64");

export class TwilioStream extends EventEmitter {
  constructor(conn, { callSid, accountSid, ticket }) {
    super();
    this.conn = conn;
    this.callSid = callSid;
    this.accountSid = accountSid;
    this.ticket = ticket;
    this.streamSid = `MZ${randomBytes(16).toString("hex")}`;
    this.sequence = 0;
    this.chunk = 0;
    this.timestamp = 0;
    this.outbound = [];
    this.pendingMarks = [];
    this.autoMark = true;
    this.closed = false;
    conn.on("message", (text) => this.#onMessage(text));
    conn.on("close", (code) => {
      this.closed = true;
      this.closeCode = code;
      this.emit("closed", code);
    });
  }

  #send(event) { if (!this.closed) this.conn.send(JSON.stringify(event)); }

  #onMessage(text) {
    let event;
    try { event = JSON.parse(text); } catch { this.outbound.push({ event: "__unparsable" }); return; }
    this.outbound.push(event);
    this.emit("event", event);
    if (event.event === "mark") {
      if (this.autoMark) this.#ack(event.mark?.name);
      else this.pendingMarks.push(event.mark?.name);
    }
    if (event.event === "clear") {
      for (const name of this.pendingMarks.splice(0)) this.#ack(name);
    }
  }

  #ack(name) {
    this.sequence += 1;
    this.#send({ event: "mark", sequenceNumber: String(this.sequence), streamSid: this.streamSid, mark: { name } });
  }

  ackAll() { for (const name of this.pendingMarks.splice(0)) this.#ack(name); }

  /** Playback reached the first `count` queued marks. */
  ackSome(count) { for (const name of this.pendingMarks.splice(0, count)) this.#ack(name); }

  connected() { this.#send({ event: "connected", protocol: "Call", version: "1.0.0" }); }

  start() {
    this.sequence += 1;
    this.#send({
      event: "start",
      sequenceNumber: String(this.sequence),
      streamSid: this.streamSid,
      start: {
        accountSid: this.accountSid,
        streamSid: this.streamSid,
        callSid: this.callSid,
        tracks: ["inbound"],
        customParameters: this.ticket === undefined ? {} : { ticket: this.ticket },
        mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
      },
    });
  }

  media(payload = VOICED) {
    this.sequence += 1;
    this.chunk += 1;
    this.timestamp += 20;
    this.#send({ event: "media", sequenceNumber: String(this.sequence), streamSid: this.streamSid, media: { track: "inbound", chunk: String(this.chunk), timestamp: String(this.timestamp), payload } });
  }

  stop() {
    this.sequence += 1;
    this.#send({ event: "stop", sequenceNumber: String(this.sequence), streamSid: this.streamSid, stop: { accountSid: this.accountSid, callSid: this.callSid } });
  }

  /** The call dropped: the socket goes away with no `stop`. */
  terminate() { this.conn.terminate(); }
  closeNormally() { this.conn.close(1000, "call ended"); }

  sent(name) { return this.outbound.filter((event) => event.event === name); }

  waitForEvent(predicate, timeoutMs = 5000, label = "bridge event") {
    const found = this.outbound.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const onEvent = (event) => { if (predicate(event)) { cleanup(); resolve(event); } };
      const onClosed = () => { cleanup(); reject(new Error(`Twilio socket closed waiting for ${label}`)); };
      const cleanup = () => { clearTimeout(timer); this.off("event", onEvent); this.off("closed", onClosed); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${label}`)); }, timeoutMs);
      this.on("event", onEvent);
      this.on("closed", onClosed);
    });
  }

  waitClosed(timeoutMs = 5000) {
    if (this.closed) return Promise.resolve(this.closeCode);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.off("closed", onClosed); resolve(null); }, timeoutMs);
      const onClosed = (code) => { clearTimeout(timer); resolve(code); };
      this.once("closed", onClosed);
    });
  }
}

/** Upgrade against the local bridge, signing the public URL Twilio would have dialled. Returns `{ refused }` or `{ stream }`. */
export async function connectStream({ bridgeUrl, publicUrl, authToken, callSid, accountSid, ticket, signature }) {
  const header = signature === null ? {} : { "X-Twilio-Signature": signature ?? signUpgrade(publicUrl, authToken) };
  const outcome = await wsConnect(bridgeUrl, { headers: header });
  if (outcome.refused !== undefined) return { refused: outcome.refused, body: outcome.body };
  return { stream: new TwilioStream(outcome.conn, { callSid, accountSid, ticket }) };
}
