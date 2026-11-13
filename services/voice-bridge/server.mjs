import { appendFileSync, lstatSync, readdirSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import https from 'node:https';
import { WebSocket, WebSocketServer } from 'ws';
import { REALTIME_MODEL } from './config.mjs';
import { internalHeaders, verifyInternalSignature, verifyTwilioSignature } from './security.mjs';

/** How the words are said, never which words. Saudi workers hear a Gulf accent as one of their own. */
const DELIVERY = Object.freeze({
  ar: ' Speak it as a friendly Saudi speaking natural Najdi Gulf Arabic, warm and calm, at an unhurried pace, with clear Gulf pronunciation of names and numbers. Do not use formal Modern Standard Arabic pronunciation or an Egyptian or Levantine accent.',
  en: ' Speak it warmly and clearly, at an unhurried pace.',
});
/** How close to the end of the summary a natural call's answer may start and still have heard all of it. */
const HEARD_GRACE_MS = 800;
/** What a natural call's tool request carries of the worker's words so far: the latest, within the internal body limit. */
const TRANSCRIPT_COUNT = 40;
const TRANSCRIPT_BYTES = 6 * 1024;

/** A natural call's silence prompt: the model checks in, in its own words. */
const NUDGE = Object.freeze({
  ar: 'العامل ساكت. بجملة سعودية قصيرة وودودة تأكد إنه يسمعك، وأعد سؤالك الأخير باختصار. لا تنادي أي أداة.',
  en: 'The worker is silent. In one short, friendly sentence, check they can hear you and briefly repeat your last question. Call no tool.',
});
/** The silence watchdog's check-in when there is no question to repeat word for word. */
const WATCHDOG_NUDGE = Object.freeze({
  ar: 'المتصل ساكت. بجملة سعودية قصيرة وودودة تأكد إنه يسمعك. لا تنادي أي أداة.',
  en: 'The caller is silent. In one short, friendly sentence, check they can hear you. Call no tool.',
});
/** Said word for word when nobody answered the check-in either. Claims nothing about what was saved. */
const WATCHDOG_GOODBYE = Object.freeze({
  ar: 'ما وصلني صوتك، بقفل المكالمة الحين. مع السلامة.',
  en: "I can't hear you, so I'll end the call now. Goodbye.",
});
const CREDIT_ERRORS = new Set(['insufficient_quota', 'credit_balance_exhausted']);
/** Why a stream closed, as Next records it. Anything not listed is the bridge's own failure. */
const CLOSE_REASONS = Object.freeze({
  goodbye_played: 'normal', tool_ended: 'normal', goodbye_timeout: 'normal',
  silence_timeout: 'silence',
  maximum_timeout: 'timeout', start_timeout: 'timeout', response_timeout: 'timeout',
  provider_ready_timeout: 'timeout', speech_recovery_timeout: 'timeout',
  twilio_closed: 'twilio_closed', twilio_stopped: 'twilio_closed', twilio_error: 'twilio_closed',
  provider_error: 'openai_error', provider_closed: 'openai_error', provider_invalid: 'openai_error',
  provider_response_failed: 'openai_error', provider_auth_failed: 'openai_error',
  provider_handshake_failed: 'openai_error', speech_recovery_failed: 'openai_error',
});
const HARMLESS_PROVIDER_ERRORS = new Set(['response_cancel_not_active', 'conversation_already_has_active_response']);
/** A provider enum for the logs; anything that doesn't look like one is not logged. */
const label = (value) => (typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : null);

const DEFAULT_LIMITS = Object.freeze({
  wrapUpMs: 60_000,
  confirmationGraceMs: 20_000,
  closedNoticeMs: 2_000,
  startMs: 10_000,
  internalMs: 9_000,
  toolMs: 15_000,
  connectMs: 5_000,
  readyMs: 5_000,
  responseMs: 45_000,
  transcriptionMs: 2_500,
  bargeInMs: 400,
  speechMs: 10_000,
  goodbyeMs: 15_000,
  repromptMs: 10_000,
  maxReprompts: 2,
  /** No caller speech and no NAQAH audio for this long: one check-in, then the call ends. Needs no Twilio mark. */
  watchdogMs: 12_000,
  closeMs: 250,
  twilioMessageBytes: 64 * 1024,
  providerMessageBytes: 256 * 1024,
  internalBodyBytes: 256 * 1024,
  socketBufferBytes: 256 * 1024,
  maxMarks: 1024,
  maxTools: 128,
  /** Natural call: how long a tool waits for words the worker said after its turn («احفظ… لا لحظة»). */
  laterSpeechMs: 4_000,
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

/** Spelling a transcript may vary (punctuation, hamza, ta marbuta, digit script) never counts as a changed summary. */
function summaryWords(value) {
  return value.normalize('NFKC').toLowerCase().replace(/\p{M}/gu, '').replace(/[أإآٱ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ة/gu, 'ه')
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * A natural call's summary ends on its question («أحفظه؟»). Spoken apart, the facts count as heard
 * once they have played, so a worker answering the question as soon as they understand it has still heard them.
 */
/**
 * How long a natural call waits after the worker stops talking before it answers. 700 ms (guided) felt slow on the
 * 11 Nov calls (about 1.7 s per turn); a worker who pauses mid-sentence can still talk over the reply (barge-in).
 */
const NATURAL_SILENCE_MS = 500;

function splitClosing(text) {
  const end = text.lastIndexOf('. ');
  if (end < 1) return null;
  const facts = text.slice(0, end + 1).trim();
  const closing = text.slice(end + 2).trim();
  return facts && /^[^.]+[?؟]$/u.test(closing) ? { facts, closing } : null;
}

function validSession(session) {
  return isObject(session) && typeof session.instructions === 'string' && Array.isArray(session.tools)
    && typeof session.opening === 'string' && session.opening.trim().length > 0
    && (session.repromptText === undefined || typeof session.repromptText === 'string')
    && (session.style === undefined || session.style === 'natural')
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
  outgoing.setTimeout(20_000, () => outgoing.destroy());
  request.on('aborted', () => outgoing.destroy());
  request.on('error', () => outgoing.destroy());
  request.on('end', () => outgoing.addTrailers(trailers(request.rawTrailers)));
  response.on('close', () => outgoing.destroy());
  request.pipe(outgoing);
}

class CallStream {
  constructor(twilio, config, calls, streams, limits, logger, notifications) {
    this.twilio = twilio;
    this.config = config;
    this.calls = calls;
    this.streams = streams;
    this.limits = limits;
    this.logger = logger;
    this.notifications = notifications;
    /** When NAQAH's audio already sent to Twilio should have finished playing, at 8 bytes per ms. */
    this.playbackEndsAt = 0;
    this.lastSpeechAt = 0;
    this.watchdogStage = 0;
    /** Set when the bridge itself decided to end the call, so the closed notice says why. */
    this.endReason = null;
    this.providerCredit = false;
    this.abort = new AbortController();
    this.timers = new Map();
    this.createdAt = Date.now();
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
    this.inputAudioMs = 0;
    this.speechStartAudioMs = null;
    this.outputFrames = 0;
    this.userSpoke = false;
    this.workerTurn = null;
    /** Recent worker turns in the order they were said; a natural call's tool reads its own turn and any after it. */
    this.turnLog = [];
    this.speechWaiters = new Set();
    this.speechEpoch = 0;
    this.summaryPlayback = null;
    this.responseSummary = null;
    this.lastPrompt = null;
    this.responsePrompt = null;
    this.reprompts = 0;
    this.responsePending = false;
    this.responseId = null;
    this.responseKind = null;
    this.nextResponse = null;
    this.speaking = false;
    this.started = false;
    this.ready = false;
    this.closed = false;
    this.ending = false;
    this.wrapUpPending = false;
    this.awaitingConfirmation = false;
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
      call: this.callSid?.slice(-6) || '', event, ms: Date.now() - this.createdAt,
      inputFrames: this.inputFrames, outputFrames: this.outputFrames, tools: this.toolIds.size, ...detail,
    });
  }

  /**
   * Local runs with --trace-transcripts only, after everyone on the call agreed: each line heard and spoken, to a
   * temp file Next's trace removes after 24 hours. Nothing is written without the directory being set.
   */
  trace(who, text) {
    if (!this.config.traceDir || !this.callSid) return;
    try {
      if (!this.traceCleaned) {
        this.traceCleaned = true;
        for (const name of readdirSync(this.config.traceDir)) {
          const file = join(this.config.traceDir, name);
          if (/^bridge-[0-9a-z]{1,6}\.jsonl$/i.test(name) && lstatSync(file).mtimeMs < Date.now() - 24 * 60 * 60 * 1000) unlinkSync(file);
        }
      }
      appendFileSync(join(this.config.traceDir, `bridge-${this.callSid.slice(-6)}.jsonl`), JSON.stringify({ at: Date.now() - this.createdAt, who, text: String(text).slice(0, 1000) }) + '\n', { mode: 0o600 });
    } catch { /* tracing never affects the call */ }
  }

  /** Next asked for one natural conversation: the model speaks for itself, only the summary is word for word. */
  get natural() {
    return this.session?.style === 'natural';
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
    this.clearTimer('silence');
    if (this.closed || this.ending || !this.lastPrompt?.played || this.speaking || this.toolPending
      || this.responsePending || this.responseId || this.nextResponse || this.userSpoke) return;
    this.timer('silence', this.limits.repromptMs, () => {
      const nudge = this.natural && this.lastPrompt.natural;
      if (this.reprompts >= this.limits.maxReprompts || (!nudge && !this.lastPrompt.repromptText?.trim())) {
        return this.finish('silence_timeout');
      }
      this.reprompts += 1;
      this.log('reprompt', { count: this.reprompts });
      if (nudge) return this.requestResponse('nudge', null, { instructions: NUDGE[this.session.locale] });
      this.requestResponse('reprompt', this.lastPrompt.repromptText, { prompt: this.lastPrompt });
    });
  }

  /**
   * A backstop to `activity()`, which waits for Twilio's playback mark: a call to voicemail sat 190 s with no reprompt.
   * Quiet is timed from the caller's last speech and the estimated end of NAQAH's audio, never from a mark.
   */
  watch(milliseconds = this.limits.watchdogMs) {
    if (this.closed || this.ending || !this.ready) return;
    this.timer('watchdog', milliseconds, () => this.onWatchdog());
  }

  onWatchdog() {
    if (this.closed || this.ending) return;
    // Speech, a tool and a response each have their own deadline; the watchdog only covers nobody doing anything.
    if (this.speaking || this.toolPending || this.responsePending || this.responseId || this.nextResponse) return this.watch();
    const quietFor = Date.now() - Math.max(this.lastSpeechAt, this.playbackEndsAt);
    if (quietFor < this.limits.watchdogMs) return this.watch(this.limits.watchdogMs - quietFor);
    if (this.watchdogStage === 0) {
      this.watchdogStage = 1;
      this.log('watchdog_reprompt');
      const prompt = this.lastPrompt?.text?.trim() ? this.lastPrompt : null;
      if (prompt && !this.natural) this.requestResponse('reprompt', prompt.repromptText?.trim() ? prompt.repromptText : prompt.text, { prompt });
      else this.requestResponse('nudge', null, { instructions: (this.natural ? NUDGE : WATCHDOG_NUDGE)[this.session.locale] });
      return this.watch();
    }
    this.log('watchdog_end');
    this.endReason = 'silence';
    // A guided call carries on by keypad through the <Connect action>, as after the reprompt limit; no goodbye first.
    if (!this.natural) return this.finish('silence_timeout');
    this.ending = true;
    this.clearTimer('silence');
    this.nextResponse = null;
    this.timer('goodbye', this.limits.goodbyeMs, () => this.finish('silence_timeout'));
    this.requestResponse('goodbye', WATCHDOG_GOODBYE[this.session.locale]);
  }

  heardCaller() {
    this.lastSpeechAt = Date.now();
    this.watch();
  }

  closeReason(event) {
    if (this.endReason) return this.endReason;
    if (this.providerCredit) return 'openai_credit';
    if (this.ending && !['maximum_timeout', 'server_stopped'].includes(event)) return 'normal';
    return CLOSE_REASONS[event] ?? 'bridge_error';
  }

  /** Signed, never retried; a normal or silent ending waits at most two seconds for persistence. */
  notifyClosed(event) {
    const body = JSON.stringify({ ticket: this.ticket, callSid: this.callSid, reason: this.closeReason(event), event });
    const notice = fetch(new URL('/api/voice/realtime/closed', this.config.upstream), {
      method: 'POST', body, headers: internalHeaders(body, this.config.voiceSecret),
      signal: AbortSignal.timeout(Math.min(this.limits.internalMs, this.limits.closedNoticeMs)), redirect: 'error',
    }).then(async (response) => {
      await response.body?.cancel();
      if (!response.ok) this.log('closed_notice_failed', { status: response.status });
    }).catch(() => this.log('closed_notice_failed'));
    this.notifications.add(notice);
    void notice.finally(() => this.notifications.delete(notice));
    return notice;
  }

  finish(event) {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.abort.abort();
    for (const turn of this.turnLog) turn.settle('');
    this.workerTurn = null;
    this.wakeSpeechWaiters();
    const ownsCall = Boolean(this.callSid) && this.calls.get(this.callSid) === this;
    if (ownsCall) this.calls.delete(this.callSid);
    this.streams.delete(this);
    this.log(event, { reason: this.closeReason(event) });
    const notice = ownsCall && this.ticket ? this.notifyClosed(event) : null;
    this.marks.clear();
    this.items.clear();
    for (const socket of [this.provider, this.twilio]) {
      if (!socket || socket.readyState === WebSocket.CLOSED) continue;
      const close = () => {
        if (socket.readyState === WebSocket.CLOSED) return;
        const force = setTimeout(() => socket.terminate(), this.limits.closeMs);
        force.unref();
        socket.once('close', () => clearTimeout(force));
        if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
        else socket.close(1000);
      };
      if (socket === this.twilio && notice && ['normal', 'silence'].includes(this.closeReason(event))) void notice.then(close, close);
      else close();
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
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(path === '/api/voice/realtime/tool' ? this.limits.toolMs : this.limits.internalMs)]),
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
      this.timer('maximum', (this.config.maxCallSeconds ?? 300) * 1000, () => this.finish('maximum_timeout'));
      this.clearTimer('start');
      this.log('started');
      void this.start();
    } else if (message.event === 'media') {
      if (!this.started || message.streamSid !== this.streamSid || message.media?.track !== 'inbound') {
        throw new Error('Invalid media');
      }
      const bytes = audioBytes(message.media.payload, 16 * 1024);
      this.inputFrames += 1;
      if (this.ending) return;
      // Audio from before the session is ready is stale: replayed, it reads as speech over the greeting.
      if (this.ready) {
        if (this.send(this.provider, { type: 'input_audio_buffer.append', audio: message.media.payload })) this.inputAudioMs += bytes.length / 8;
      } else this.droppedEarlyFrames += 1;
    } else if (message.event === 'mark') {
      if (!this.started || message.streamSid !== this.streamSid) throw new Error('Invalid mark');
      const mark = this.marks.get(message.mark?.name);
      if (!mark) return;
      this.marks.delete(message.mark.name);
      if (mark.final) return this.finish('goodbye_played');
      if (mark.summary) {
        if (this.summaryPlayback === mark.summary && !mark.summary.cancelled) {
          mark.summary.inputAudioMs = this.inputAudioMs;
          mark.summary.heard = true;
          // Every summary byte was played before the worker spoke (a barge-in would have cancelled it); only the mark
          // was still on its way back. Within the grace, that answer heard the whole summary.
          if (this.natural && this.speaking && !this.turnHeardSummary && this.speechStartAudioMs !== null
            && this.speechStartAudioMs + HEARD_GRACE_MS >= mark.summary.inputAudioMs) {
            this.turnHeardSummary = true;
            this.turnHeardSummaryId = mark.summary.id;
          }
        }
        return;
      }
      if (mark.prompt) {
        if (this.lastPrompt === mark.prompt && !mark.prompt.cutOff) {
          mark.prompt.played = true;
          this.activity();
        }
        return;
      }
      mark.item.playedBytes = Math.max(mark.item.playedBytes, mark.endBytes);
      if (mark.item.done && mark.item.playedBytes === mark.item.sentBytes) this.items.delete(mark.item.key);
      this.activity();
    } else if (message.event === 'stop') {
      if (!this.started || message.streamSid !== this.streamSid) throw new Error('Invalid stop');
      this.finish('twilio_stopped');
    } else if (message.event === 'dtmf') {
      if (!this.started || message.streamSid !== this.streamSid) throw new Error('Invalid dtmf');
      // Pressing 1 confirms only after the whole summary was heard; every other key is ignored.
      if (!this.natural && message.dtmf?.digit === '1' && this.summaryPlayback?.heard === true && !this.ending && !this.toolPending) this.queueKeypadConfirm();
    } else throw new Error('Unknown message');
  }

  async start() {
    try {
      // The greeting waits on both of these, so they run side by side.
      const opening = this.internal('/api/voice/realtime/session', { ticket: this.ticket, callSid: this.callSid });
      opening.catch(() => this.finish('session_failed'));
      this.provider = new WebSocket(this.config.providerUrl, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        handshakeTimeout: this.limits.connectMs,
        maxPayload: this.limits.providerMessageBytes,
        followRedirects: false,
        perMessageDeflate: false,
      });
      this.timer('ready', this.limits.connectMs + this.limits.readyMs, () => this.finish('provider_ready_timeout'));
      this.provider.on('open', async () => {
        if (this.closed) return;
        this.timer('ready', this.limits.readyMs, () => this.finish('provider_ready_timeout'));
        try {
          this.session = await opening;
        } catch {
          return;
        }
        if (this.closed) return;
        if (!validSession(this.session)) return this.finish('session_failed');
        const remainingMs = Math.max(1, Math.min(this.session.maxSeconds, this.config.maxCallSeconds ?? 300) * 1000 - (Date.now() - this.createdAt));
        this.timer('maximum', remainingMs, () => {
          if (this.awaitingConfirmation || this.toolPending || this.ending || this.speaking || ['wrapup', 'summary', 'closing'].includes(this.responseKind)) {
            this.timer('maximum', this.limits.confirmationGraceMs, () => this.finish('maximum_timeout'));
          } else this.finish('maximum_timeout');
        });
        if (this.natural) this.timer('wrapup', Math.max(1, remainingMs - this.limits.wrapUpMs), () => {
          if (this.closed || this.ending) return;
          this.wrapUpPending = true;
          this.flushResponse();
        });
        this.activity();
        this.send(this.provider, {
          type: 'session.update',
          session: {
            type: 'realtime', model: REALTIME_MODEL, output_modalities: ['audio'],
            instructions: this.session.instructions, tools: this.session.tools,
            // A natural call talks for itself and calls a tool only to hand over or confirm the report.
            tool_choice: this.natural ? 'auto' : 'required',
            reasoning: { effort: 'minimal' },
            audio: {
              input: {
                format: { type: 'audio/pcmu' },
                // A phone is held to the ear; filtering wind and animals before VAD keeps noise from becoming a "turn".
                noise_reduction: { type: 'near_field' },
                transcription: { model: 'gpt-4o-transcribe', language: this.session.locale },
                turn_detection: {
                  type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300,
                  silence_duration_ms: this.natural ? NATURAL_SILENCE_MS : 700, create_response: false, interrupt_response: false,
                },
              },
              output: { format: { type: 'audio/pcmu' }, voice: this.config.voice ?? 'marin' },
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
      this.provider.on('unexpected-response', (_request, response) => {
        response.resume();
        this.finish(response.statusCode === 401 || response.statusCode === 403 ? 'provider_auth_failed' : 'provider_handshake_failed');
      });
      this.provider.on('close', () => this.finish('provider_closed'));
    } catch {
      this.finish('session_failed');
    }
  }

  requestResponse(kind, text, options = {}) {
    this.nextResponse = { kind, text, ...options };
    this.activity();
    this.flushResponse();
  }

  flushResponse() {
    if (this.closed || !this.ready || this.responsePending || this.responseId || this.toolPending || this.speaking) return;
    if (this.wrapUpPending && !this.nextResponse && !this.awaitingConfirmation) {
      this.nextResponse = { kind: 'wrapup', wrapUp: true };
      this.wrapUpPending = false;
    }
    if (!this.nextResponse) return;
    const next = this.nextResponse;
    this.nextResponse = null;
    this.responsePending = true;
    this.responseKind = next.kind;
    this.responseAudible = false;
    this.responsePrompt = null;
    if (this.natural && !next.text && ['turn', 'nudge', 'wrapup'].includes(next.kind)) {
      // The model's own words: tracked so silence after them is noticed, never replayed word for word.
      this.responsePrompt = { kind: 'turn', text: '', natural: true, repromptText: null, played: false, cutOff: false };
      this.lastPrompt = this.responsePrompt;
    } else if (next.text && next.kind !== 'goodbye') {
      this.responsePrompt = next.prompt ?? {
        kind: next.kind, text: next.text, summaryId: next.summaryId,
        repromptText: next.repromptText ?? (next.kind === 'summary' ? null : next.text),
        ...(next.closing ? { closing: next.closing } : {}),
      };
      this.lastPrompt = this.responsePrompt;
      this.responsePrompt.played = false;
      this.responsePrompt.cutOff = false;
    }
    this.responseSummary = next.kind === 'summary' && next.text && !(next.prompt && this.summaryPlayback?.heard)
      ? { heard: false, cancelled: false, text: next.text, id: next.summaryId ?? next.prompt?.summaryId, audioKeys: new Set(), transcripts: new Map() } : null;
    if (this.responseSummary) this.summaryPlayback = this.responseSummary;
    this.activity();
    this.log('response_requested', { kind: next.kind });
    const response = { output_modalities: ['audio'] };
    if (next.wrapUp) {
      response.instructions = this.session.locale === 'ar'
        ? 'وقت المكالمة قرب ينتهي. لا تفتح موضوع جديد. لخّص فقط المعلومات اللي قالها العامل باستخدام أداة تسليم التقرير المعتادة، ثم اسأله «أحفظه؟». انتظر تأكيده الصريح أو تصحيحه، ولا تقول انحفظ قبل نجاح الأداة. إذا ما عندك معلومات، لا تخترع تقرير.'
        : 'The call is nearing its time limit. Start no new topic. Use the normal report submission tool to summarize only the worker’s actual information, then ask “Shall I save it?”. Wait for explicit confirmation or corrections. Never claim a save before the tool succeeds. With no information, do not invent a report.';
      response.tool_choice = 'auto';
    } else if (next.instructions) {
      response.instructions = next.instructions;
      response.tool_choice = 'none';
    } else if (next.text) {
      response.instructions = `Say only the following text verbatim, with no additions: ${JSON.stringify(next.text)}${DELIVERY[this.session?.locale] ?? ''}`;
      response.tool_choice = 'none';
    }
    this.send(this.provider, { type: 'response.create', response });
    this.timer('response', this.limits.responseMs, () => this.finish('response_timeout'));
  }

  /** Speech only interrupts a reply the caller can hear; one still being prepared goes ahead. */
  interrupt() {
    if (!this.responseAudible && !this.items.size) return this.log('speech_before_audio', { kind: this.responseKind });
    if (this.lastPrompt && !this.lastPrompt.played) this.lastPrompt.cutOff = true;
    if (this.summaryPlayback && !this.summaryPlayback.heard) this.summaryPlayback.cancelled = true;
    // The summary's question is asked only after its facts; the worker is talking now.
    if (this.nextResponse?.kind === 'closing') this.nextResponse = null;
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
    this.playbackEndsAt = Date.now();
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
    if (this.responseSummary?.responseId === event.response_id) this.responseSummary.audioKeys.add(key);
    let item = this.items.get(key);
    if (!item) {
      item = { key, id: event.item_id, contentIndex: event.content_index, playedBytes: 0, sentBytes: 0, done: false };
      this.items.set(key, item);
    }
    for (let offset = 0; offset < bytes.length; offset += 1600) {
      if (this.marks.size >= this.limits.maxMarks) return this.finish('playback_limit');
      const chunk = bytes.subarray(offset, offset + 1600);
      item.sentBytes += chunk.length;
      this.playbackEndsAt = Math.max(Date.now(), this.playbackEndsAt) + chunk.length / 8;
      this.outputFrames += 1;
      this.send(this.twilio, { event: 'media', streamSid: this.streamSid, media: { payload: chunk.toString('base64') } });
      const name = `audio-${++this.markCount}`;
      this.marks.set(name, { item, endBytes: item.sentBytes });
      this.send(this.twilio, { event: 'mark', streamSid: this.streamSid, mark: { name } });
    }
    this.watch();
    this.activity();
  }

  onProvider(event) {
    if (!isObject(event) || typeof event.type !== 'string') throw new Error('Invalid event');
    if (event.type === 'error') {
      // A barge-in can race the response it cancels; the conversation is still healthy.
      const detail = { type: label(event.error?.type), code: label(event.error?.code) };
      if (this.recoveryCommit && event.error?.event_id === this.recoveryCommit) {
        this.log('speech_recovery_failed', detail);
        return this.finish('speech_recovery_failed');
      }
      if (HARMLESS_PROVIDER_ERRORS.has(event.error?.code)) return this.log('provider_error_ignored', detail);
      if (CREDIT_ERRORS.has(event.error?.code) || CREDIT_ERRORS.has(event.error?.type)) this.providerCredit = true;
      this.log('provider_error_detail', detail);
      return this.finish('provider_error');
    }
    if (event.type === 'session.updated') {
      if (this.ready) throw new Error('Unexpected session update');
      this.ready = true;
      this.clearTimer('ready');
      this.requestResponse('opening', this.session.opening, { repromptText: this.session.repromptText });
      this.log('provider_ready', { droppedEarlyFrames: this.droppedEarlyFrames });
      this.watch();
    } else if (!this.ready) {
      if (event.type !== 'session.created') throw new Error('Provider not ready');
    } else if (event.type === 'response.created') {
      if (this.responseId || !this.responsePending || typeof event.response?.id !== 'string') {
        throw new Error('Unexpected response');
      }
      this.responsePending = false;
      this.responseId = event.response.id;
      if (this.responseSummary) this.responseSummary.responseId = this.responseId;
      this.log('response_created', { kind: this.responseKind });
    } else if (event.type === 'response.output_audio.delta') {
      this.outputAudio(event);
    } else if (event.type === 'response.output_audio_transcript.done') {
      if (typeof event.transcript === 'string') this.trace('naqah', event.transcript);
      if (this.responseSummary?.responseId === event.response_id && typeof event.transcript === 'string') {
        this.responseSummary.transcripts.set(`${event.item_id}:${event.content_index}`, event.transcript);
      }
    } else if (event.type === 'response.output_audio.done') {
      const item = this.items.get(`${event.item_id}:${event.content_index}`);
      if (item) {
        item.done = true;
        if (item.playedBytes === item.sentBytes) this.items.delete(item.key);
      }
    } else if (event.type === 'input_audio_buffer.speech_started') {
      if (this.ending) return;
      this.reprompts = 0;
      this.heardCaller();
      if (!this.speaking) {
        this.speechEpoch += 1;
        // VAD dates speech 300 ms early (prefix padding) and Twilio's playback mark arrives late: a worker answering
        // the instant the summary ends must not count as talking over it. Natural calls allow that much.
        const grace = this.natural ? HEARD_GRACE_MS : 0;
        this.speechStartAudioMs = Number.isSafeInteger(event.audio_start_ms) ? event.audio_start_ms : null;
        this.turnHeardSummary = this.summaryPlayback?.heard === true && this.speechStartAudioMs !== null
          && this.speechStartAudioMs + grace >= this.summaryPlayback.inputAudioMs;
        this.turnHeardSummaryId = this.turnHeardSummary ? this.summaryPlayback.id : undefined;
        this.timer('speech', this.limits.speechMs, () => {
          if (!this.speaking || this.ending) return;
          this.recoveryCommit = `speech-recovery-${this.speechEpoch}`;
          this.log('speech_recovery_commit');
          this.send(this.provider, { type: 'input_audio_buffer.commit', event_id: this.recoveryCommit });
          this.timer('speech_commit', this.limits.readyMs, () => this.finish('speech_recovery_timeout'));
        });
      }
      this.speaking = true;
      // A hello over the opening before it is audible needs no reply of its own: the opening already asks the question.
      this.earlySpeech = this.responseKind === 'opening' && Boolean(this.responsePending || this.responseId)
        && !this.responseAudible && !this.items.size;
      this.activity();
      this.log('speech_started');
      // A cough or a line click shouldn't cut NAQAH off: only speech that keeps going interrupts.
      if (this.limits.bargeInMs) this.timer('barge_in', this.limits.bargeInMs, () => { if (this.speaking) this.interrupt(); });
      else this.interrupt();
    } else if (event.type === 'input_audio_buffer.speech_stopped') {
      this.clearTimer('barge_in');
      this.speaking = false;
      this.heardCaller();
      this.clearTimer('speech');
      this.activity();
      this.log('speech_stopped');
      this.wakeSpeechWaiters();
    } else if (event.type === 'input_audio_buffer.committed') {
      if (this.ending) return;
      this.clearTimer('speech');
      this.clearTimer('speech_commit');
      this.recoveryCommit = null;
      this.speaking = false;
      this.reprompts = 0;
      // A whole turn from the caller: the check-in starts over. VAD noise alone (no commit) never does.
      this.watchdogStage = 0;
      this.heardCaller();
      // A natural call's earlier turn keeps waiting for its words: a tool may still be reading them.
      if (!this.natural) this.workerTurn?.settle('');
      const turn = {
        id: event.item_id, epoch: this.speechEpoch, heardSummary: this.turnHeardSummary === true,
        heardSummaryId: this.turnHeardSummaryId, settled: false, transcript: '', final: '', used: false,
      };
      turn.promise = new Promise((resolve) => {
        turn.settle = (transcript) => {
          if (turn.settled) return;
          turn.settled = true;
          turn.transcript = transcript;
          turn.final = transcript;
          resolve(transcript);
          this.wakeSpeechWaiters();
        };
      });
      this.workerTurn = turn;
      this.turnLog.push(turn);
      if (this.turnLog.length > TRANSCRIPT_COUNT * 2) this.turnLog.shift().settle('');
      this.turnHeardSummary = undefined;
      this.turnHeardSummaryId = undefined;
      this.activity();
      if (this.earlySpeech) {
        this.earlySpeech = false;
        if (this.responsePending || this.responseId) return this.log('input_committed_during_opening');
      }
      this.userSpoke = true;
      this.log('input_committed');
      this.wakeSpeechWaiters();
      // The worker answered before the summary's question was asked: the question isn't needed.
      if (this.nextResponse?.kind === 'closing') this.nextResponse = null;
      // Words said while the server's next line was waiting must not replace it: that question was never heard.
      if (this.nextResponse?.text) {
        this.userSpoke = false;
        turn.used = true;
        this.log('turn_discarded_for_prompt');
        return this.flushResponse();
      }
      this.requestResponse('turn');
    } else if (event.type === 'conversation.item.input_audio_transcription.completed'
      || event.type === 'conversation.item.input_audio_transcription.failed') {
      const turn = typeof event.item_id === 'string' ? this.turnLog.find((entry) => entry.id === event.item_id) : undefined;
      if (!turn || event.content_index !== 0) return;
      const transcript = event.type.endsWith('.completed') && typeof event.transcript === 'string'
        && event.transcript.length <= 1000 && !/[\u0000-\u001f\u007f]/u.test(event.transcript) ? event.transcript : '';
      this.trace('worker', transcript);
      turn.settle(transcript);
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
        const error = event.response.status_details?.error;
        if (CREDIT_ERRORS.has(error?.code) || CREDIT_ERRORS.has(error?.type)) this.providerCredit = true;
        return this.finish('provider_response_failed');
      }
      const kind = this.responseKind;
      const played = this.responsePrompt && !interrupted && this.responseAudible && !this.responsePrompt.cutOff;
      if (played) {
        const name = `prompt-${++this.markCount}`;
        this.marks.set(name, { prompt: this.responsePrompt });
        this.send(this.twilio, { event: 'mark', streamSid: this.streamSid, mark: { name } });
      }
      // The facts are on their way to the caller: the summary's question follows them, word for word too.
      if (played && this.responsePrompt.closing && !this.nextResponse && !this.ending) {
        this.nextResponse = { kind: 'closing', text: this.responsePrompt.closing, repromptText: this.responsePrompt.repromptText };
      }
      this.responsePrompt = null;
      const summaryKeys = [...(this.responseSummary?.audioKeys ?? [])];
      const summaryMatches = summaryKeys.length > 0 && summaryKeys.every((key) => this.responseSummary.transcripts.has(key))
        && summaryWords(summaryKeys.map((key) => this.responseSummary.transcripts.get(key)).join(' ')) === summaryWords(this.responseSummary.text);
      if (this.responseSummary && summaryMatches && !interrupted && this.responseAudible && !this.responseSummary.cancelled) {
        const name = `summary-${++this.markCount}`;
        this.marks.set(name, { summary: this.responseSummary });
        this.send(this.twilio, { event: 'mark', streamSid: this.streamSid, mark: { name } });
      }
      this.responseSummary = null;
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
        // The watchdog's goodbye doesn't wait on that mark: it closes once the audio should have played.
        if (this.endReason) this.timer('goodbye', Math.max(0, this.playbackEndsAt - Date.now()) + 1_000, () => this.finish('silence_timeout'));
      } else this.flushResponse();
      this.activity();
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
    this.activity();
    const turn = this.workerTurn;
    const epoch = this.speechEpoch;
    const spoke = this.userSpoke;
    this.toolQueue = this.toolQueue.then(async () => {
      if (this.closed || this.ending) return;
      const confirmation = event.name === 'confirm_report' && args.confirmed === true;
      if (spoke && turn && !turn.settled) {
        this.timer('transcription', this.limits.transcriptionMs, () => turn.settle(''));
        await turn.promise;
        this.clearTimer('transcription');
      }
      if (this.closed) return;
      if (this.natural) return await this.sendNaturalTool(event, args, turn, spoke);
      const current = this.workerTurn === turn && this.speechEpoch === epoch && !this.speaking;
      const result = await this.internal('/api/voice/realtime/tool', {
        ticket: this.ticket, callSid: this.callSid, toolCallId: event.call_id,
        name: event.name, args, userSpokeSinceLastTool: spoke && this.userSpoke && current,
        workerUtterance: current ? turn?.transcript ?? '' : '',
        ...(confirmation ? { heardSummary: current && turn?.heardSummary === true } : {}),
        ...(current && turn?.heardSummary && turn.heardSummaryId !== undefined ? { heardSummaryId: turn.heardSummaryId } : {}),
      });
      if (this.closed) return;
      if (this.workerTurn === turn) {
        this.userSpoke = false;
        turn?.settle('');
        if (turn) turn.transcript = '';
      }
      this.applyToolResult(result, event.call_id);
    }).catch(() => this.finish('tool_failed')).finally(() => {
      this.toolPending -= 1;
      this.flushResponse();
      this.activity();
    });
  }

  /**
   * A natural call's tool belongs to the turn it answered. If the worker said more before it ran («أحفظ… احفظ»,
   * «احفظ… لا لحظة»), those words are waited for and sent with it, never dropped: a second yes still saves with the
   * first one's words and heard summary, and a second thought still blocks. Words that never arrive count as unsaid.
   */
  async sendNaturalTool(event, args, turn, spoke) {
    const later = () => (turn && this.turnLog.includes(turn) ? this.turnLog.slice(this.turnLog.indexOf(turn) + 1).filter((entry) => !entry.used) : []);
    // Speech that has stopped but isn't committed yet is still on its way.
    const uncommitted = () => this.speaking || (this.turnLog.at(-1)?.epoch ?? -1) < this.speechEpoch;
    const more = () => Boolean(turn) && (uncommitted() || later().some((entry) => !entry.settled));
    if (spoke && more()) {
      this.log('tool_waits_for_later_speech');
      await this.waitForSpeech(() => this.closed || !more(), this.limits.laterSpeechMs);
      if (this.closed) return;
    }
    const after = spoke && turn ? later() : [];
    // Still talking, or words that never came through: nobody can tell what was said, so it isn't taken as a yes.
    const unclear = Boolean(turn) && (uncommitted() || after.some((entry) => !entry.settled || !entry.transcript));
    const own = [turn, ...after].filter(Boolean);
    const words = own.map((entry) => entry.transcript).filter(Boolean).join(' ').slice(0, 1000);
    const confirmation = event.name === 'confirm_report' && args.confirmed === true;
    const result = await this.internal('/api/voice/realtime/tool', {
      ticket: this.ticket, callSid: this.callSid, toolCallId: event.call_id,
      name: event.name, args, userSpokeSinceLastTool: spoke && Boolean(turn) && !turn.used && !unclear,
      workerUtterance: turn && !turn.used ? words : '',
      workerTranscripts: this.workerTranscripts(),
      ...(confirmation ? { heardSummary: turn?.heardSummary === true } : {}),
      ...(turn?.heardSummary && turn.heardSummaryId !== undefined ? { heardSummaryId: turn.heardSummaryId } : {}),
    });
    if (this.closed) return;
    for (const entry of own) {
      entry.used = true;
      entry.settle('');
      entry.transcript = '';
    }
    if (own.includes(this.workerTurn)) this.userSpoke = false;
    this.applyToolResult(result, event.call_id);
  }

  /** Every final transcript of the worker so far, in the order said: the latest 40, within a byte budget. */
  workerTranscripts() {
    const transcripts = [];
    let bytes = 0;
    for (const entry of [...this.turnLog].reverse()) {
      if (!entry.final) continue;
      bytes += Buffer.byteLength(entry.final) + 4;
      if (transcripts.length >= TRANSCRIPT_COUNT || bytes > TRANSCRIPT_BYTES) break;
      transcripts.unshift(entry.final);
    }
    return transcripts;
  }

  waitForSpeech(done, milliseconds) {
    if (done()) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = { done, resolve };
      waiter.timeout = setTimeout(() => {
        this.speechWaiters.delete(waiter);
        resolve();
      }, milliseconds);
      waiter.timeout.unref();
      this.speechWaiters.add(waiter);
    });
  }

  wakeSpeechWaiters() {
    for (const waiter of this.speechWaiters) {
      if (!waiter.done()) continue;
      clearTimeout(waiter.timeout);
      this.speechWaiters.delete(waiter);
      waiter.resolve();
    }
  }

  /** Key 1 at the summary: the same save path as a spoken yes, with no model turn to wait for. */
  queueKeypadConfirm() {
    const heardSummaryId = this.summaryPlayback.id;
    this.toolPending += 1;
    this.toolQueue = this.toolQueue.then(async () => {
      if (this.closed || this.ending) return;
      this.applyToolResult(await this.internal('/api/voice/realtime/tool', {
        ticket: this.ticket, callSid: this.callSid, toolCallId: `keypad-${++this.markCount}`, name: 'keypad_confirm', args: {},
        userSpokeSinceLastTool: true, heardSummary: true, keypad: true, ...(heardSummaryId !== undefined ? { heardSummaryId } : {}),
      }));
    }).catch(() => this.finish('tool_failed')).finally(() => {
      this.toolPending -= 1;
      this.flushResponse();
    });
  }

  applyToolResult(result, callId = null) {
    if (this.closed) return;
      if (!isObject(result) || typeof result.output !== 'string' || typeof result.awaitingConfirmation !== 'boolean'
        || ![null, 'hangup', 'fallback'].includes(result.end)
        || !(result.goodbye === null || typeof result.goodbye === 'string')
        || ['summaryText', 'summaryId', 'sayText', 'repromptText'].some((field) => result[field] !== undefined && typeof result[field] !== 'string')
        || (result.silent !== undefined && result.silent !== true)
        || (result.continue !== undefined && (result.continue !== true || !this.natural))) throw new Error('Invalid tool result');
      const summary = result.summaryText?.trim() ? result.summaryText : null;
      const question = result.sayText?.trim() ? result.sayText : null;
      const actions = [result.summaryText, result.sayText, result.silent, result.continue].filter((value) => value !== undefined);
      if (!result.end && (actions.length !== 1 || (!summary && !question && result.silent !== true && result.continue !== true))) {
        throw new Error('Invalid tool result');
      }
      // Only a summary the server speaks word for word counts as heard: a model reply could say anything.
      if (summary) this.summaryPlayback = null;
      if (callId) {
        this.send(this.provider, {
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: callId, output: result.output },
        });
      }
      this.log('tool_completed');
      this.awaitingConfirmation = result.awaitingConfirmation;
      if (result.end) {
        this.ending = true;
        this.clearTimer('silence');
        this.nextResponse = null;
        if (!result.goodbye?.trim()) return this.finish('tool_ended');
        this.speaking = false;
        this.timer('goodbye', this.limits.goodbyeMs, () => this.finish('goodbye_timeout'));
        this.requestResponse('goodbye', result.goodbye);
      } else if (summary) {
        const parts = this.natural ? splitClosing(summary) : null;
        this.requestResponse('summary', parts?.facts ?? summary, { summaryId: result.summaryId, repromptText: result.repromptText, closing: parts?.closing });
      }
      else if (question) this.requestResponse('question', question, { repromptText: result.repromptText });
      // The model was told what happened and answers in its own words.
      else if (result.continue) this.requestResponse('turn');
      else {
        this.log('tool_silent');
        if (this.lastPrompt?.cutOff) this.requestResponse(this.lastPrompt.kind, this.lastPrompt.text, { prompt: this.lastPrompt });
      }
  }
}

/**
 * A realtime session opened and configured, with no response requested, so nothing is generated or billed. Listing
 * models works on an account with no credit; this is what a call needs (10 Nov: «credit_balance_exhausted»).
 */
function realtimeProbe(config) {
  return new Promise((resolve) => {
    const socket = new WebSocket(config.providerUrl, {
      headers: { Authorization: `Bearer ${config.apiKey}` }, handshakeTimeout: 4_000, followRedirects: false, perMessageDeflate: false,
    });
    const done = (result) => { clearTimeout(timer); socket.removeAllListeners('message'); socket.terminate(); resolve(result); };
    const timer = setTimeout(() => done({ ready: false, error: 'timeout' }), 6_000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', model: REALTIME_MODEL, output_modalities: ['text'], instructions: 'Preflight only.' } })));
    socket.on('message', (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return done({ ready: false, error: 'invalid' }); }
      if (event.type === 'session.updated') done({ ready: true, error: null });
      else if (event.type === 'error') done({ ready: false, error: label(event.error?.code ?? event.error?.type) ?? 'provider_error' });
    });
    socket.on('error', () => done({ ready: false, error: 'connect' }));
    socket.on('unexpected-response', (_request, response) => { response.resume(); done({ ready: false, error: response.statusCode === 401 ? 'invalid_api_key' : 'handshake' }); });
  });
}

export function createBridge({ config, limits: overrides = {}, logger = (record) => console.log(JSON.stringify(record)), fetchImpl = fetch }) {
  const limits = { ...DEFAULT_LIMITS, ...(config.watchdogMs ? { watchdogMs: config.watchdogMs } : {}), ...overrides };
  const calls = new Map();
  const streams = new Set();
  const notifications = new Set();
  const sockets = new WebSocketServer({
    noServer: true, maxPayload: limits.twilioMessageBytes, perMessageDeflate: false,
  });
  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/voice-bridge/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return response.end(JSON.stringify({ ok: true, publicUrl: config.publicUrl, maxCallSeconds: config.maxCallSeconds ?? 300 }));
    }
    if (request.url === '/voice-bridge/preflight') {
      if (request.method !== 'POST') { response.writeHead(405); return response.end(); }
      let body = '';
      try {
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 1024) { response.writeHead(413); return response.end(); }
        }
        if (!verifyInternalSignature(request.headers, body, config.voiceSecret)) { response.writeHead(403); return response.end(); }
        const models = await fetchImpl('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(4_000), redirect: 'error',
        });
        const data = models.ok ? await models.json() : null;
        if (!models.ok) await models.body?.cancel();
        const realtime = data?.object === 'list' ? await realtimeProbe(config) : { ready: false, error: null };
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return response.end(JSON.stringify({ openaiKeyValid: data?.object === 'list' && Array.isArray(data.data), realtimeReady: realtime.ready, realtimeError: realtime.error }));
      } catch {
        response.writeHead(503, { 'cache-control': 'no-store' });
        return response.end();
      }
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
      const stream = new CallStream(twilio, config, calls, streams, limits, logger, notifications);
      streams.add(stream);
    });
  });
  return {
    server,
    async close() {
      for (const stream of streams) stream.finish('server_stopped');
      await Promise.allSettled([...notifications]);
      sockets.close();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
