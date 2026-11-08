import http from 'node:http';
import https from 'node:https';
import { WebSocket, WebSocketServer } from 'ws';
import { REALTIME_MODEL } from './config.mjs';
import { internalHeaders, verifyTwilioSignature } from './security.mjs';

const HARMLESS_PROVIDER_ERRORS = new Set(['response_cancel_not_active', 'conversation_already_has_active_response']);
/** A provider enum for the logs; anything that doesn't look like one is not logged. */
const label = (value) => (typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : null);

const DEFAULT_LIMITS = Object.freeze({
  startMs: 10_000,
  internalMs: 5_000,
  connectMs: 5_000,
  readyMs: 5_000,
  responseMs: 45_000,
  goodbyeMs: 15_000,
  silenceMs: 45_000,
  closeMs: 250,
  twilioMessageBytes: 64 * 1024,
  providerMessageBytes: 256 * 1024,
  internalBodyBytes: 256 * 1024,
  socketBufferBytes: 256 * 1024,
  maxMarks: 1024,
  maxTools: 128,
});

function audioBytes(payload, maximum) {
  if (typeof payload !== 'string' || !payload.length || payload.length > Math.ceil(maximum / 3) * 4
    || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new Error('Invalid audio');
  }
  const bytes = Buffer.from(payload, 'base64');
  if (!bytes.length || bytes.length > maximum || bytes.toString('base64') !== payload) {
    throw new Error('Invalid audio');
  }
  return bytes;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validSession(session) {
  return isObject(session) && typeof session.instructions === 'string' && Array.isArray(session.tools)
    && typeof session.opening === 'string' && session.opening.trim().length > 0
    && ['ar', 'en'].includes(session.locale) && Number.isFinite(session.maxSeconds)
    && session.maxSeconds > 0 && session.maxSeconds <= 3600;
}

function trailers(rawHeaders) {
  const pairs = [];
  for (let index = 0; index < rawHeaders.length; index += 2) pairs.push([rawHeaders[index], rawHeaders[index + 1]]);
  return pairs;
}

function proxy(request, response, upstream) {
  const transport = upstream.protocol === 'https:' ? https : http;
  const outgoing = transport.request({
    protocol: upstream.protocol,
    hostname: upstream.hostname.replace(/^\[|\]$/g, ''),
    port: upstream.port,
    path: request.url,
    method: request.method,
    headers: request.rawHeaders,
    setHost: false,
  });
  outgoing.on('response', (incoming) => {
    response.writeHead(incoming.statusCode, incoming.statusMessage, incoming.rawHeaders);
    incoming.on('end', () => response.addTrailers(trailers(incoming.rawTrailers)));
    incoming.on('error', () => response.destroy());
    incoming.pipe(response);
  });
  outgoing.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
    response.end();
  });
  request.on('aborted', () => outgoing.destroy());
  request.on('error', () => outgoing.destroy());
  request.on('end', () => outgoing.addTrailers(trailers(request.rawTrailers)));
  response.on('close', () => outgoing.destroy());
  request.pipe(outgoing);
}

class CallStream {
  constructor(twilio, config, calls, streams, limits, logger) {
    this.twilio = twilio;
    this.config = config;
    this.calls = calls;
    this.streams = streams;
    this.limits = limits;
    this.logger = logger;
    this.abort = new AbortController();
    this.timers = new Map();
    this.droppedEarlyFrames = 0;
    this.responseAudible = false;
    this.marks = new Map();
    this.items = new Map();
    this.ignoredResponses = new Set();
    this.toolIds = new Set();
    this.toolQueue = Promise.resolve();
    this.toolPending = 0;
    this.markCount = 0;
    this.inputFrames = 0;
    this.outputFrames = 0;
    this.userSpoke = false;
    this.responsePending = false;
    this.responseId = null;
    this.responseKind = null;
    this.nextResponse = null;
    this.speaking = false;
    this.started = false;
    this.ready = false;
    this.closed = false;
    this.ending = false;
    this.timer('start', limits.startMs, () => this.finish('start_timeout'));
    twilio.on('message', (raw, binary) => {
      if (this.closed) return;
      try {
        if (binary) throw new Error('Binary message');
        this.onTwilio(JSON.parse(raw.toString()));
      } catch {
        this.finish('twilio_invalid');
      }
    });
    twilio.on('close', () => this.finish('twilio_closed'));
    twilio.on('error', () => this.finish('twilio_error'));
  }

  /** `detail` holds short labels and counts only: never audio, transcripts or message text. */
  log(event, detail = {}) {
    this.logger({
      call: this.callSid?.slice(-6) || '', event,
      inputFrames: this.inputFrames, outputFrames: this.outputFrames, tools: this.toolIds.size, ...detail,
    });
  }

  timer(name, milliseconds, callback) {
    this.clearTimer(name);
    const timer = setTimeout(callback, milliseconds);
    timer.unref();
    this.timers.set(name, timer);
  }

  clearTimer(name) {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
  }

  activity() {
    if (!this.closed && !this.ending) this.timer('silence', this.limits.silenceMs, () => {
      if (this.speaking) this.activity();
      else this.finish('silence_timeout');
    });
  }

  finish(event) {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.abort.abort();
    if (this.calls.get(this.callSid) === this) this.calls.delete(this.callSid);
    this.streams.delete(this);
    this.log(event);
    this.marks.clear();
    this.items.clear();
    for (const socket of [this.provider, this.twilio]) {
      if (!socket || socket.readyState === WebSocket.CLOSED) continue;
      const force = setTimeout(() => socket.terminate(), this.limits.closeMs);
      force.unref();
      socket.once('close', () => clearTimeout(force));
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else socket.close(1000);
    }
  }

  send(socket, message) {
    if (this.closed) return false;
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > this.limits.socketBufferBytes) {
      this.finish('socket_unavailable');
      return false;
    }
    socket.send(JSON.stringify(message), (error) => {
      if (error) this.finish('socket_send_failed');
    });
    return true;
  }

  async internal(path, body) {
    const rawBody = JSON.stringify(body);
    const response = await fetch(new URL(path, this.config.upstream), {
      method: 'POST', body: rawBody, headers: internalHeaders(rawBody, this.config.voiceSecret),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.limits.internalMs)]),
      redirect: 'error',
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error('Internal refusal');
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > this.limits.internalBodyBytes) throw new Error('Internal size');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }

  onTwilio(message) {
    if (!isObject(message)) throw new Error('Invalid message');
    if (message.event === 'connected') {
      if (message.protocol !== 'Call' || message.version !== '1.0.0') throw new Error('Invalid protocol');
    } else if (message.event === 'start') {
      const start = message.start;
      if (this.started || !isObject(start) || !/^CA[0-9a-fA-F]{32}$/.test(start.callSid)
        || !/^MZ[0-9a-fA-F]{32}$/.test(start.streamSid) || message.streamSid !== start.streamSid
        || start.mediaFormat?.encoding !== 'audio/x-mulaw' || start.mediaFormat.sampleRate !== 8000
        || start.mediaFormat.channels !== 1 || typeof start.customParameters?.ticket !== 'string'
        || !start.customParameters.ticket.length || start.customParameters.ticket.length > 4096) {
        throw new Error('Invalid start');
      }
      this.callSid = start.callSid;
      this.streamSid = start.streamSid;
      this.ticket = start.customParameters.ticket;
      if (this.calls.has(this.callSid)) return this.finish('duplicate_call');
      this.calls.set(this.callSid, this);
      this.started = true;
      this.clearTimer('start');
      this.log('started');
      void this.start();
    } else if (message.event === 'media') {
      if (!this.started || message.streamSid !== this.streamSid || message.media?.track !== 'inbound') {
        throw new Error('Invalid media');
      }
      audioBytes(message.media.payload, 16 * 1024);
      this.inputFrames += 1;
      if (this.ending) return;
      // Audio from before the session is ready is stale: replayed, it reads as speech over the greeting.
      if (this.ready) this.send(this.provider, { type: 'input_audio_buffer.append', audio: message.media.payload });
      else this.droppedEarlyFrames += 1;
    } else if (message.event === 'mark') {
      if (!this.started || message.streamSid !== this.streamSid) throw new Error('Invalid mark');
      const mark = this.marks.get(message.mark?.name);
      if (!mark) return;
      this.marks.delete(message.mark.name);
      if (mark.final) return this.finish('goodbye_played');
      mark.item.playedBytes = Math.max(mark.item.playedBytes, mark.endBytes);
      if (mark.item.done && mark.item.playedBytes === mark.item.sentBytes) this.items.delete(mark.item.key);
      this.activity();
    } else if (message.event === 'stop') {
      if (!this.started || message.streamSid !== this.streamSid) throw new Error('Invalid stop');
      this.finish('twilio_stopped');
    } else throw new Error('Unknown message');
  }

  async start() {
    try {
      this.session = await this.internal('/api/voice/realtime/session', { ticket: this.ticket, callSid: this.callSid });
      if (this.closed) return;
      if (!validSession(this.session)) throw new Error('Invalid session');
      this.timer('maximum', this.session.maxSeconds * 1000, () => this.finish('maximum_timeout'));
      this.activity();
      this.provider = new WebSocket(this.config.providerUrl, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        handshakeTimeout: this.limits.connectMs,
        maxPayload: this.limits.providerMessageBytes,
        followRedirects: false,
        perMessageDeflate: false,
      });
      this.timer('ready', this.limits.connectMs + this.limits.readyMs, () => this.finish('provider_ready_timeout'));
      this.provider.on('open', () => {
        if (this.closed) return;
        this.timer('ready', this.limits.readyMs, () => this.finish('provider_ready_timeout'));
        this.send(this.provider, {
          type: 'session.update',
          session: {
            type: 'realtime', model: REALTIME_MODEL, output_modalities: ['audio'],
            instructions: this.session.instructions, tools: this.session.tools, tool_choice: 'auto',
            audio: {
              input: {
                format: { type: 'audio/pcmu' },
                turn_detection: {
                  type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300,
                  silence_duration_ms: 500, create_response: false, interrupt_response: false,
                },
              },
              output: { format: { type: 'audio/pcmu' }, voice: 'marin' },
            },
          },
        });
      });
      this.provider.on('message', (raw, binary) => {
        if (this.closed) return;
        try {
          if (binary) throw new Error('Binary message');
          this.onProvider(JSON.parse(raw.toString()));
        } catch {
          this.finish('provider_invalid');
        }
      });
      this.provider.on('error', () => this.finish('provider_error'));
      this.provider.on('close', () => this.finish('provider_closed'));
    } catch {
      this.finish('session_failed');
    }
  }

  requestResponse(kind, text) {
    this.nextResponse = { kind, text };
    this.flushResponse();
  }

  flushResponse() {
    if (this.closed || !this.ready || this.responsePending || this.responseId || this.toolPending
      || this.speaking || !this.nextResponse) return;
    const next = this.nextResponse;
    this.nextResponse = null;
    this.responsePending = true;
    this.responseKind = next.kind;
    this.responseAudible = false;
    this.log('response_requested', { kind: next.kind });
    const response = { output_modalities: ['audio'] };
    if (next.text) {
      response.instructions = `Say only the following text verbatim, with no additions: ${JSON.stringify(next.text)}`;
      response.tool_choice = 'none';
    }
    this.send(this.provider, { type: 'response.create', response });
    this.timer('response', this.limits.responseMs, () => this.finish('response_timeout'));
  }

  /** Speech only interrupts a reply the caller can hear; one still being prepared goes ahead. */
  interrupt() {
    if (!this.responseAudible && !this.items.size) return this.log('speech_before_audio', { kind: this.responseKind });
    this.send(this.twilio, { event: 'clear', streamSid: this.streamSid });
    if (this.responseId && this.responseAudible) {
      this.ignoredResponses.add(this.responseId);
      if (!this.cancelSent) this.send(this.provider, { type: 'response.cancel', response_id: this.responseId });
      this.cancelSent = true;
    }
    for (const item of this.items.values()) {
      if (item.playedBytes < item.sentBytes) {
        this.send(this.provider, {
          type: 'conversation.item.truncate', item_id: item.id, content_index: item.contentIndex,
          audio_end_ms: Math.floor(item.playedBytes / 8),
        });
      }
    }
    this.items.clear();
    this.marks.clear();
    this.log('barge_in');
  }

  outputAudio(event) {
    if (this.ignoredResponses.has(event.response_id)) return;
    if (typeof event.item_id !== 'string' || !Number.isInteger(event.content_index) || event.content_index < 0) {
      throw new Error('Invalid audio item');
    }
    const bytes = audioBytes(event.delta, this.limits.providerMessageBytes);
    if (!this.responseAudible) {
      this.responseAudible = true;
      this.log('response_audio_started', { kind: this.responseKind });
    }
    const key = `${event.item_id}:${event.content_index}`;
    let item = this.items.get(key);
    if (!item) {
      item = { key, id: event.item_id, contentIndex: event.content_index, playedBytes: 0, sentBytes: 0, done: false };
      this.items.set(key, item);
    }
    for (let offset = 0; offset < bytes.length; offset += 1600) {
      if (this.marks.size >= this.limits.maxMarks) return this.finish('playback_limit');
      const chunk = bytes.subarray(offset, offset + 1600);
      item.sentBytes += chunk.length;
      this.outputFrames += 1;
      this.send(this.twilio, { event: 'media', streamSid: this.streamSid, media: { payload: chunk.toString('base64') } });
      const name = `audio-${++this.markCount}`;
      this.marks.set(name, { item, endBytes: item.sentBytes });
      this.send(this.twilio, { event: 'mark', streamSid: this.streamSid, mark: { name } });
    }
    this.activity();
  }

  onProvider(event) {
    if (!isObject(event) || typeof event.type !== 'string') throw new Error('Invalid event');
    if (event.type === 'error') {
      // A barge-in can race the response it cancels; the conversation is still healthy.
      const detail = { type: label(event.error?.type), code: label(event.error?.code) };
      if (HARMLESS_PROVIDER_ERRORS.has(event.error?.code)) return this.log('provider_error_ignored', detail);
      this.log('provider_error_detail', detail);
      return this.finish('provider_error');
    }
    if (event.type === 'session.updated') {
      if (this.ready) throw new Error('Unexpected session update');
      this.ready = true;
      this.clearTimer('ready');
      this.requestResponse('opening', this.session.opening);
      this.log('provider_ready', { droppedEarlyFrames: this.droppedEarlyFrames });
    } else if (!this.ready) {
      if (event.type !== 'session.created') throw new Error('Provider not ready');
    } else if (event.type === 'response.created') {
      if (this.responseId || !this.responsePending || typeof event.response?.id !== 'string') {
        throw new Error('Unexpected response');
      }
      this.responsePending = false;
      this.responseId = event.response.id;
      this.log('response_created', { kind: this.responseKind });
    } else if (event.type === 'response.output_audio.delta') {
      this.outputAudio(event);
    } else if (event.type === 'response.output_audio.done') {
      const item = this.items.get(`${event.item_id}:${event.content_index}`);
      if (item) {
        item.done = true;
        if (item.playedBytes === item.sentBytes) this.items.delete(item.key);
      }
    } else if (event.type === 'input_audio_buffer.speech_started') {
      if (this.ending) return;
      this.speaking = true;
      // A hello over the opening before it is audible needs no reply of its own: the opening already asks the question.
      this.earlySpeech = this.responseKind === 'opening' && Boolean(this.responsePending || this.responseId)
        && !this.responseAudible && !this.items.size;
      this.activity();
      this.log('speech_started');
      this.interrupt();
    } else if (event.type === 'input_audio_buffer.speech_stopped') {
      this.speaking = false;
      this.activity();
      this.log('speech_stopped');
    } else if (event.type === 'input_audio_buffer.committed') {
      if (this.ending) return;
      this.speaking = false;
      this.activity();
      if (this.earlySpeech) {
        this.earlySpeech = false;
        if (this.responsePending || this.responseId) return this.log('input_committed_during_opening');
      }
      this.userSpoke = true;
      this.log('input_committed');
      this.requestResponse('turn');
    } else if (event.type === 'response.function_call_arguments.done') {
      if (!this.ending && !this.ignoredResponses.has(event.response_id)) this.queueTool(event);
    } else if (event.type === 'response.done') {
      if (event.response?.id !== this.responseId) throw new Error('Invalid response completion');
      const interrupted = this.ignoredResponses.delete(this.responseId);
      this.log('response_done', {
        kind: this.responseKind, status: label(event.response.status), reason: label(event.response.status_details?.reason),
        outputs: Array.isArray(event.response.output) ? event.response.output.map((item) => label(item?.type)) : [], interrupted,
      });
      if (event.response.status !== 'completed' && !(interrupted && event.response.status === 'cancelled')) {
        return this.finish('provider_response_failed');
      }
      const kind = this.responseKind;
      this.responseId = null;
      this.responseAudible = false;
      this.responsePending = false;
      this.cancelSent = false;
      this.clearTimer('response');
      if (this.answerDroppedCalls(event.response.output) && !this.nextResponse && !this.speaking && !this.ending) this.requestResponse('turn');
      if (kind === 'goodbye') {
        const name = `goodbye-${++this.markCount}`;
        this.marks.set(name, { final: true });
        this.send(this.twilio, { event: 'mark', streamSid: this.streamSid, mark: { name } });
      } else this.flushResponse();
    }
  }

  /**
   * A cancel can lose the race and the response completes anyway. Its function call is then in the conversation with
   * no output, and the model waits for it forever. The worker spoke over it, so it is not applied; the model is told.
   */
  answerDroppedCalls(output) {
    if (this.ending || !Array.isArray(output)) return false;
    const dropped = output.filter((item) => item?.type === 'function_call' && item.status === 'completed'
      && typeof item.call_id === 'string' && !this.toolIds.has(item.call_id));
    for (const item of dropped) {
      this.toolIds.add(item.call_id);
      this.send(this.provider, {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output', call_id: item.call_id,
          output: JSON.stringify({ status: 'not_applied', error: 'worker_interrupted', message: 'The worker spoke over this and it was not recorded. Listen to what they said and call the tool again.' }),
        },
      });
      this.log('tool_dropped_after_interrupt');
    }
    return dropped.length > 0;
  }

  queueTool(event) {
    if (typeof event.call_id !== 'string' || !event.call_id.length || event.call_id.length > 512
      || typeof event.name !== 'string' || !event.name.length || event.name.length > 256
      || typeof event.arguments !== 'string' || event.arguments.length > 32 * 1024) {
      throw new Error('Invalid tool call');
    }
    if (this.toolIds.has(event.call_id)) return;
    if (this.toolIds.size >= this.limits.maxTools) return this.finish('tool_limit');
    const args = JSON.parse(event.arguments);
    if (!isObject(args)) throw new Error('Invalid tool args');
    this.toolIds.add(event.call_id);
    this.toolPending += 1;
    this.toolQueue = this.toolQueue.then(async () => {
      if (this.closed || this.ending) return;
      const result = await this.internal('/api/voice/realtime/tool', {
        ticket: this.ticket, callSid: this.callSid, toolCallId: event.call_id,
        name: event.name, args, userSpokeSinceLastTool: this.userSpoke,
      });
      if (this.closed) return;
      if (!isObject(result) || typeof result.output !== 'string' || typeof result.awaitingConfirmation !== 'boolean'
        || ![null, 'hangup', 'fallback'].includes(result.end)
        || !(result.goodbye === null || typeof result.goodbye === 'string')) throw new Error('Invalid tool result');
      this.userSpoke = false;
      this.send(this.provider, {
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: event.call_id, output: result.output },
      });
      this.log('tool_completed');
      if (result.end) {
        this.ending = true;
        this.clearTimer('silence');
        this.nextResponse = null;
        if (!result.goodbye?.trim()) return this.finish('tool_ended');
        this.speaking = false;
        this.timer('goodbye', this.limits.goodbyeMs, () => this.finish('goodbye_timeout'));
        this.requestResponse('goodbye', result.goodbye);
      } else this.requestResponse('turn');
    }).catch(() => this.finish('tool_failed')).finally(() => {
      this.toolPending -= 1;
      this.flushResponse();
    });
  }
}

export function createBridge({ config, limits: overrides = {}, logger = (record) => console.log(JSON.stringify(record)) }) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const calls = new Map();
  const streams = new Set();
  const sockets = new WebSocketServer({
    noServer: true, maxPayload: limits.twilioMessageBytes, perMessageDeflate: false,
  });
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/voice-bridge/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return response.end('{"ok":true}');
    }
    proxy(request, response, config.upstream);
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/voice-bridge/media') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (request.method !== 'GET' || !verifyTwilioSignature(request.headers['x-twilio-signature'], config.publicUrl, config.authToken)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (twilio) => {
      const stream = new CallStream(twilio, config, calls, streams, limits, logger);
      streams.add(stream);
    });
  });
  return {
    server,
    async close() {
      for (const stream of streams) stream.finish('server_stopped');
      sockets.close();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
