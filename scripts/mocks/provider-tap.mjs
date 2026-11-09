/**
 * LOCAL TEST ONLY. Preloaded into the bridge (node --import) by scripts/verify-realtime-live-provider.mjs.
 * The socket guard allows loopback and api.openai.com, nothing else, so Twilio can never be reached. The tap
 * appends every event on the OpenAI socket to NAQAH_TAP_FILE as JSONL, with audio reduced to a byte count.
 * The bridge's own logs stay free of transcripts; this file exists only under /tmp, for the live-provider proof.
 */
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import net from "node:net";

const allowed = /^(localhost|127\.\d+\.\d+\.\d+|::1|::ffff:127\.0\.0\.1|api\.openai\.com)$/;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === "object" && first !== null ? first : { host: args[1] };
  const host = options.host ?? "localhost";
  if (!options.path && !allowed.test(String(host))) {
    process.stderr.write(`[guard] blocked ${host}\n`);
    process.nextTick(() => this.destroy(new Error(`Blocked connection to ${host}`)));
    return this;
  }
  return connect.apply(this, args);
};

const file = process.env.NAQAH_TAP_FILE;
const WS = createRequire(join(process.env.NAQAH_TAP_BRIDGE_DIR, "x.js"))("ws");
const isProvider = (socket) => /api\.openai\.com/.test(socket.url ?? "");

function record(direction, raw) {
  let event;
  try { event = JSON.parse(raw.toString()); } catch { return; }
  if (event.type === "input_audio_buffer.append") return;
  const summary = { ...event };
  if (typeof summary.delta === "string" && /audio\.delta$/.test(event.type) && !/transcript/.test(event.type)) {
    summary.bytes = Buffer.byteLength(summary.delta, "base64");
    delete summary.delta;
  }
  appendFileSync(file, `${JSON.stringify({ t: Date.now(), dir: direction, ...summary })}\n`);
}

const send = WS.prototype.send;
WS.prototype.send = function tappedSend(data, ...rest) {
  if (isProvider(this)) record("out", data);
  return send.call(this, data, ...rest);
};
const emit = WS.prototype.emit;
WS.prototype.emit = function tappedEmit(name, ...rest) {
  if (name === "message" && isProvider(this)) record("in", rest[0]);
  return emit.call(this, name, ...rest);
};
