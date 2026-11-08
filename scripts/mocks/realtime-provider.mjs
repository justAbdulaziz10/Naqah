/**
 * LOCAL TEST ONLY. A stand-in for the OpenAI Realtime WebSocket on loopback. Each scenario drives a
 * connection imperatively: worker speech, model audio, tool calls, errors and disconnects, using the same
 * event names the provider emits. It records every event the bridge sends so scenarios can assert on them.
 */
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { wsServer } from "./ws-lite.mjs";

const id = (prefix) => `${prefix}_${randomBytes(6).toString("hex")}`;
const AUDIO_DELTA_MS = 100;
const AUDIO_BYTES = 800; // 100 ms of 8 kHz mu-law
const audioChunk = () => Buffer.alloc(AUDIO_BYTES, 0x55).toString("base64");

export class Upstream extends EventEmitter {
  constructor(conn, request, options) {
    super();
    this.conn = conn;
    this.url = request.url;
    this.headers = request.headers;
    this.received = [];
    this.options = options;
    this.toolWaiters = new Map();
    this.responseSlots = [];
    this.slotWaiters = [];
    this.spoken = [];
    this.openResponse = null;
    this.closed = false;
    conn.on("message", (text) => this.#onMessage(text));
    conn.on("close", (code) => {
      this.closed = true;
      this.closeCode = code;
      this.emit("closed", code);
    });
    this.emitEvent({ type: "session.created", session: { id: id("sess"), object: "realtime.session" } });
  }

  emitEvent(event) {
    if (!this.closed) this.conn.send(JSON.stringify({ event_id: id("event"), ...event }));
  }

  #onMessage(text) {
    let event;
    try { event = JSON.parse(text); } catch { this.received.push({ type: "__unparsable" }); return; }
    this.received.push(event);
    this.emit("event", event);
    switch (event.type) {
      case "session.update":
        this.session = event.session;
        this.emitEvent({ type: "session.updated", session: event.session });
        break;
      case "response.create":
        this.#onResponseCreate(event);
        break;
      case "response.cancel":
        this.#cancelResponse();
        break;
      case "conversation.item.truncate":
        this.emitEvent({ type: "conversation.item.truncated", item_id: event.item_id, content_index: event.content_index, audio_end_ms: event.audio_end_ms });
        break;
      case "conversation.item.create":
        this.emitEvent({ type: "conversation.item.created", item: event.item });
        if (event.item?.type === "function_call_output") {
          const waiter = this.toolWaiters.get(event.item.call_id);
          if (waiter) { this.toolWaiters.delete(event.item.call_id); waiter(event.item.output); }
        }
        break;
      default:
        break;
    }
  }

  /**
   * A model only produces a response when asked. A verbatim line (`response.instructions`, the opening and the
   * goodbye) plays automatically; an open turn waits for the scenario to play it with speak() or toolCall().
   */
  #onResponseCreate(event) {
    const instructions = event.response?.instructions;
    if (typeof instructions === "string") {
      const quoted = instructions.match(/"(?:[^"\\]|\\.)*"$/)?.[0];
      let line = instructions;
      try { line = quoted ? JSON.parse(quoted) : instructions; } catch { /* keep the raw text */ }
      this.spoken.push(line);
      this.#playVerbatim(line);
      return;
    }
    const waiter = this.slotWaiters.shift();
    if (waiter) waiter(event);
    else this.responseSlots.push(event);
  }

  #takeSlot(timeoutMs = 20_000) {
    if (this.responseSlots.length) return Promise.resolve(this.responseSlots.shift());
    return new Promise((resolve, reject) => {
      const entry = (value) => { clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => {
        this.slotWaiters.splice(this.slotWaiters.indexOf(entry), 1);
        reject(new Error("The bridge did not send response.create for this model turn"));
      }, timeoutMs);
      this.slotWaiters.push(entry);
    });
  }

  of(type) { return this.received.filter((event) => event.type === type); }
  get audioIn() { return this.of("input_audio_buffer.append"); }

  waitForEvent(predicate, timeoutMs = 5000, label = "provider event") {
    const found = this.received.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const onEvent = (event) => { if (predicate(event)) { cleanup(); resolve(event); } };
      const onClosed = () => { cleanup(); reject(new Error(`Provider socket closed waiting for ${label}`)); };
      const cleanup = () => { clearTimeout(timer); this.off("event", onEvent); this.off("closed", onClosed); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${label}`)); }, timeoutMs);
      this.on("event", onEvent);
      this.on("closed", onClosed);
    });
  }

  #beginResponse() {
    const response = { responseId: id("resp"), itemId: id("item"), cancelled: false };
    this.openResponse = response;
    this.emitEvent({ type: "response.created", response: { id: response.responseId, object: "realtime.response", status: "in_progress", output: [] } });
    this.emitEvent({ type: "response.output_item.added", response_id: response.responseId, output_index: 0, item: { id: response.itemId, object: "realtime.item", type: "message", role: "assistant", status: "in_progress", content: [] } });
    return response;
  }

  #cancelResponse() {
    const response = this.openResponse;
    if (!response) {
      this.emitEvent({ type: "error", error: { type: "invalid_request_error", code: "response_cancel_not_active", message: "Cancellation failed: no active response found" } });
      return;
    }
    response.cancelled = true;
    this.openResponse = null;
    if (this.deferCancelDone) { this.heldCancel = response; return; }
    this.#cancelDone(response);
  }

  #cancelDone(response) {
    this.emitEvent({ type: "response.done", response: { id: response.responseId, status: "cancelled", output: [] } });
  }

  /** With `deferCancelDone`, response.done (always a response's last event) waits for this, so in-flight audio can be sent first. */
  completeCancel() {
    if (this.heldCancel) this.#cancelDone(this.heldCancel);
    this.heldCancel = null;
  }

  async #playVerbatim(text) {
    return this.#play(text, { chunks: 2, gapMs: 5, hold: false });
  }

  /** Model audio and transcript for an open turn. `hold` leaves the response open for barge-in. */
  async speak(text, options = {}) {
    await this.#takeSlot(options.slotMs);
    return this.#play(text, { chunks: 3, gapMs: 10, hold: false, ...options });
  }

  async #play(text, { chunks, gapMs, hold }) {
    const response = this.#beginResponse();
    this.emitEvent({ type: "response.content_part.added", response_id: response.responseId, item_id: response.itemId, output_index: 0, content_index: 0, part: { type: "audio", transcript: "" } });
    this.emitEvent({ type: "response.output_audio_transcript.delta", response_id: response.responseId, item_id: response.itemId, output_index: 0, content_index: 0, delta: text });
    for (let index = 0; index < chunks && !response.cancelled; index += 1) {
      this.emitEvent({ type: "response.output_audio.delta", response_id: response.responseId, item_id: response.itemId, output_index: 0, content_index: 0, delta: audioChunk() });
      if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
    if (hold || response.cancelled) return response;
    return this.finishSpeaking(response, text);
  }

  finishSpeaking(response = this.openResponse, text = "") {
    if (!response || response.cancelled) return response;
    this.emitEvent({ type: "response.output_audio.done", response_id: response.responseId, item_id: response.itemId, output_index: 0, content_index: 0 });
    this.emitEvent({ type: "response.output_audio_transcript.done", response_id: response.responseId, item_id: response.itemId, output_index: 0, content_index: 0, transcript: text });
    this.emitEvent({ type: "response.output_item.done", response_id: response.responseId, output_index: 0, item: { id: response.itemId, type: "message", role: "assistant", status: "completed", content: [{ type: "audio", transcript: text }] } });
    this.emitEvent({ type: "response.done", response: { id: response.responseId, status: "completed", output: [{ id: response.itemId, type: "message" }] } });
    if (this.openResponse === response) this.openResponse = null;
    return response;
  }

  speechStarted(audioStartMs = 500) {
    this.lastSpeechItem = id("item");
    this.emitEvent({ type: "input_audio_buffer.speech_started", audio_start_ms: audioStartMs, item_id: this.lastSpeechItem });
    return this.lastSpeechItem;
  }

  /** The worker finished a turn: provider-side VAD stops, commits, and optionally transcribes. */
  workerSays(transcript) {
    this.speechStarted();
    this.workerFinishes(transcript);
  }

  workerFinishes(transcript) {
    const item = this.lastSpeechItem;
    this.emitEvent({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 2000, item_id: item });
    this.emitEvent({ type: "input_audio_buffer.committed", item_id: item, previous_item_id: null });
    this.emitEvent({ type: "conversation.item.created", previous_item_id: null, item: { id: item, type: "message", role: "user", status: "completed", content: [{ type: "input_audio", transcript: null }] } });
    if (transcript) {
      this.emitEvent({ type: "conversation.item.input_audio_transcription.delta", item_id: item, content_index: 0, delta: transcript });
      this.emitEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: item, content_index: 0, transcript });
    }
  }

  /** The model uses its turn to call a tool. Resolves with the bridge's output, or null when `waitMs` passes first. */
  async toolCall(name, args, { callId = id("call"), waitMs = 20_000, rawArguments, slotMs } = {}) {
    await this.#takeSlot(slotMs);
    const response = this.#beginResponse();
    const itemId = id("item");
    const text = rawArguments ?? JSON.stringify(args);
    this.emitEvent({ type: "response.output_item.added", response_id: response.responseId, output_index: 0, item: { id: itemId, type: "function_call", status: "in_progress", call_id: callId, name, arguments: "" } });
    this.emitEvent({ type: "response.function_call_arguments.delta", response_id: response.responseId, item_id: itemId, output_index: 0, call_id: callId, delta: text });
    this.emitEvent({ type: "response.function_call_arguments.done", response_id: response.responseId, item_id: itemId, output_index: 0, call_id: callId, name, arguments: text });
    this.emitEvent({ type: "response.output_item.done", response_id: response.responseId, output_index: 0, item: { id: itemId, type: "function_call", status: "completed", call_id: callId, name, arguments: text } });
    this.emitEvent({ type: "response.done", response: { id: response.responseId, status: "completed", output: [{ id: itemId, type: "function_call", call_id: callId, name, arguments: text }] } });
    if (this.openResponse === response) this.openResponse = null;
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error(`Provider socket closed before tool call ${name}`)); return; }
      const timer = setTimeout(() => {
        this.toolWaiters.delete(callId);
        this.off("closed", onClosed);
        resolve(null);
      }, waitMs);
      const onClosed = () => { clearTimeout(timer); this.toolWaiters.delete(callId); reject(new Error(`Provider socket closed during tool call ${name}`)); };
      this.once("closed", onClosed);
      this.toolWaiters.set(callId, (output) => { clearTimeout(timer); this.off("closed", onClosed); resolve(output); });
    });
  }

  errorMidCall() { this.emitEvent({ type: "error", error: { type: "server_error", code: "server_error", message: "mock provider failure" } }); }
  closeAbruptly() { this.conn.terminate(); }
  closeGracefully() { this.conn.close(1011, "mock server closing"); }
}

export async function startMockRealtime({ port }) {
  const pending = [];
  const waiters = [];
  const options = { refuseStatus: null };
  const stats = { refused: 0, connections: 0 };
  const instance = await wsServer({
    port,
    onUpgrade: (request) => {
      if (options.refuseStatus) {
        stats.refused += 1;
        return { status: options.refuseStatus, body: "mock refusal" };
      }
      if (!request.url.startsWith("/v1/realtime")) return { status: 404, body: "not realtime" };
      return null;
    },
    onConnection: (conn, request) => {
      stats.connections += 1;
      const upstream = new Upstream(conn, request, options);
      const waiter = waiters.shift();
      if (waiter) waiter(upstream);
      else pending.push(upstream);
    },
  });
  return {
    options,
    stats,
    /** Forget connections from earlier scenarios. */
    reset() { pending.length = 0; options.refuseStatus = null; },
    next(timeoutMs = 20_000) {
      const ready = pending.shift();
      if (ready) return Promise.resolve(ready);
      return new Promise((resolve, reject) => {
        const entry = (value) => { clearTimeout(timer); resolve(value); };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(entry), 1);
          reject(new Error("The bridge did not open a provider connection"));
        }, timeoutMs);
        waiters.push(entry);
      });
    },
    close: instance.close,
  };
}
