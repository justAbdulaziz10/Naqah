import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { loadConfig, REALTIME_URL } from './config.mjs';
import { internalHeaders, verifyTwilioSignature } from './security.mjs';
import { createBridge } from './server.mjs';

const CALL_SID = `CA${'a'.repeat(32)}`;
const STREAM_SID = `MZ${'b'.repeat(32)}`;
const PUBLIC_URL = 'wss://bridge.example.test/voice-bridge/media';
const TEST_ENV = {
  PORT: '3903', NAQAH_BRIDGE_PUBLIC_URL: PUBLIC_URL,
  TWILIO_AUTH_TOKEN: 'mock-twilio-token', NAQAH_VOICE_SECRET: 'mock-voice-secret',
  OPENAI_API_KEY: 'mock-key-never-paid', NAQAH_BRIDGE_UPSTREAM: 'http://127.0.0.1:3901',
  NAQAH_REALTIME_URL: 'ws://127.0.0.1:3902/provider',
};
const AUDIO = Buffer.alloc(160, 255).toString('base64');

function signature(url = PUBLIC_URL) {
  return createHmac('sha1', TEST_ENV.TWILIO_AUTH_TOKEN).update(url).digest('base64');
}

function inbox(socket) {
  const received = [];
  const waiters = new Set();
  socket.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    received.push(event);
    for (const waiter of waiters) {
      if (waiter.predicate(event)) {
        clearTimeout(waiter.timeout);
        waiters.delete(waiter);
        waiter.resolve(event);
      }
    }
  });
  return {
    received,
    wait(predicate) {
      const found = received.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiter.timeout = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error('Mock event timeout'));
        }, 2000);
        waiters.add(waiter);
      });
    },
  };
}

function send(socket, event) {
  socket.send(JSON.stringify(event));
}

function start(socket, changes = {}) {
  send(socket, {
    event: 'start', streamSid: STREAM_SID,
    start: {
      callSid: CALL_SID, streamSid: STREAM_SID, customParameters: { ticket: 'mock-ticket' },
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 }, ...changes,
    },
  });
}

function media(socket, payload = AUDIO) {
  send(socket, { event: 'media', streamSid: STREAM_SID, media: { track: 'inbound', payload, timestamp: '0' } });
}

async function closed(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  await Promise.race([once(socket, 'close'), delay(2000).then(() => { throw new Error('Mock close timeout'); })]);
}

async function listen(server, port) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
}

async function fixture(options = {}) {
  const requests = [];
  const providerEvents = [];
  const providerClients = new Set();
  const clients = new Set();
  const logs = [];
  let provider;
  let providerInbox;
  let responseCount = 0;
  let providerAuth;
  let latestResponseId;
  const upstream = http.createServer(async (request, response) => {
    if (options.streaming) return options.streaming(request, response);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString();
    const record = { url: request.url, method: request.method, rawBody, headers: request.headers, rawHeaders: request.rawHeaders };
    requests.push(record);
    if (request.url.startsWith('/api/voice/realtime/')) {
      assert.equal(request.headers['x-naqah-bridge-signature'], internalHeaders(
        rawBody, TEST_ENV.NAQAH_VOICE_SECRET, request.headers['x-naqah-bridge-timestamp'],
      )['x-naqah-bridge-signature']);
      record.body = JSON.parse(rawBody);
    }
    if (options.upstream) return options.upstream(request, response, record);
    if (request.url === '/api/voice/realtime/session') {
      if (options.sessionDelay) await delay(options.sessionDelay);
      response.writeHead(options.sessionStatus || 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        instructions: 'Mock instructions', tools: [{ type: 'function', name: 'answer_question', parameters: { type: 'object' } }],
        opening: 'Mock opening', locale: 'en', maxSeconds: options.maxSeconds || 120, ...options.session,
      }));
    } else if (request.url === '/api/voice/realtime/tool') {
      if (options.toolDelay) await delay(options.toolDelay);
      response.writeHead(options.toolStatus || 200, { 'content-type': 'application/json' });
      const result = typeof options.toolResult === 'function' ? options.toolResult(record.body) : options.toolResult;
      response.end(JSON.stringify(result || { output: '{"ok":true}', awaitingConfirmation: false, end: null, goodbye: null, sayText: 'Mock next question' }));
    } else if (request.url === '/api/voice/realtime/closed') {
      if (options.closedDelay) await delay(options.closedDelay);
      record.acknowledged = true;
      response.writeHead(options.closedStatus ?? 204);
      response.end();
    } else {
      response.writeHead(207, 'Mock response', { 'x-mock-result': 'passed', 'set-cookie': ['first=1', 'second=2'] });
      response.write(rawBody.slice(0, 3));
      response.end(rawBody.slice(3));
    }
  });
  const providerServer = http.createServer();
  const providerSockets = new WebSocketServer({ server: providerServer });
  providerSockets.on('connection', (socket, request) => {
    provider = socket;
    providerAuth = request.headers.authorization;
    providerClients.add(socket);
    providerInbox = inbox(socket);
    socket.on('close', () => providerClients.delete(socket));
    socket.on('error', () => {});
    send(socket, { type: 'session.created', session: { id: 'mock-session' } });
    socket.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      providerEvents.push(event);
      if (event.type === 'session.update' && options.sessionError) send(socket, { type: 'error', error: options.sessionError });
      else if (event.type === 'session.update' && !options.noReady) send(socket, { type: 'session.updated', session: event.session });
      if (event.type === 'response.create' && !options.noResponse) {
        latestResponseId = `response-${++responseCount}`;
        send(socket, { type: 'response.created', response: { id: latestResponseId } });
        if (options.autoComplete) send(socket, { type: 'response.done', response: { id: latestResponseId, status: 'completed' } });
      }
    });
  });
  await listen(upstream, 3901);
  await listen(providerServer, 3902);
  const bridge = createBridge({
    config: { ...loadConfig(TEST_ENV), ...options.config }, logger: (record) => logs.push(record), ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    limits: { closeMs: 10, transcriptionMs: 50, bargeInMs: 0, ...options.limits },
  });
  await listen(bridge.server, 3903);
  return {
    bridge, requests, logs, providerEvents,
    get provider() { return provider; },
    get providerInbox() { return providerInbox; },
    get providerAuth() { return providerAuth; },
    get responseId() { return latestResponseId; },
    async connect(headers = { 'X-Twilio-Signature': signature() }, path = '/voice-bridge/media') {
      const socket = new WebSocket(`ws://127.0.0.1:3903${path}`, { headers });
      clients.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => clients.delete(socket));
      const messages = inbox(socket);
      await once(socket, 'open');
      return { socket, messages };
    },
    async ready(socket) {
      start(socket);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (providerInbox) break;
        await delay(5);
      }
      assert.ok(providerInbox);
      await providerInbox.wait((event) => event.type === 'response.create');
      await delay(10);
    },
    complete() {
      send(provider, { type: 'response.done', response: { id: latestResponseId, status: 'completed' } });
    },
    audio(size = 1600, itemId = 'assistant-item') {
      send(provider, {
        type: 'response.output_audio.delta', response_id: latestResponseId, item_id: itemId,
        content_index: 0, delta: Buffer.alloc(size, 255).toString('base64'),
      });
    },
    async close() {
      for (const socket of clients) socket.terminate();
      for (const socket of providerClients) socket.terminate();
      await bridge.close();
      providerSockets.close();
      await Promise.all([new Promise((resolve) => upstream.close(resolve)), new Promise((resolve) => providerServer.close(resolve))]);
    },
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await delay(5);
  }
  assert.ok(predicate(), 'Mock state timeout');
}

async function playPrompt(state, connection, transcript, acknowledge = true) {
  const offset = connection.messages.received.length;
  const itemId = `audio-${state.responseId}`;
  state.audio(160, itemId);
  send(state.provider, { type: 'response.output_audio.done', item_id: itemId, content_index: 0 });
  if (transcript !== undefined) send(state.provider, {
    type: 'response.output_audio_transcript.done', response_id: state.responseId,
    item_id: itemId, content_index: 0, transcript,
  });
  state.complete();
  await waitFor(() => connection.messages.received.slice(offset).some((event) => event.mark?.name.startsWith('prompt-')));
  const marks = connection.messages.received.slice(offset).filter((event) => event.event === 'mark');
  if (acknowledge) {
    for (const event of marks) send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: event.mark });
    await delay(10);
  }
  return marks;
}

async function workerTool(state, callId, name = 'answer_question', transcript = 'Mock worker words', args = {}) {
  const previous = state.responseId;
  send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 0 });
  send(state.provider, { type: 'input_audio_buffer.committed', item_id: callId });
  send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: callId, content_index: 0, transcript });
  await waitFor(() => state.responseId !== previous);
  send(state.provider, { type: 'response.function_call_arguments.done', call_id: callId, name, arguments: JSON.stringify(args) });
  state.complete();
  await state.providerInbox.wait((event) => event.item?.call_id === callId);
  await delay(10);
  return state.requests.find((request) => request.body?.toolCallId === callId).body;
}

test('configuration fails closed and provider overrides can only reach loopback ws', () => {
  for (const name of ['OPENAI_API_KEY', 'TWILIO_AUTH_TOKEN', 'NAQAH_VOICE_SECRET', 'NAQAH_BRIDGE_PUBLIC_URL']) {
    assert.throws(() => loadConfig({ ...TEST_ENV, [name]: '' }));
  }
  for (const url of ['wss://api.openai.com/v1/realtime', 'ws://example.com', 'http://127.0.0.1',
    'ws://127.0.0.1.example.com', 'ws://user:pass@localhost', 'ws://[::ffff:192.168.1.1]', '']) {
    assert.throws(() => loadConfig({ ...TEST_ENV, NAQAH_REALTIME_URL: url }));
  }
  for (const url of ['ws://127.0.0.1:3902', 'ws://127.3.4.5:3902', 'ws://[::1]:3902', 'ws://localhost:3902']) {
    assert.ok(loadConfig({ ...TEST_ENV, NAQAH_REALTIME_URL: url }).providerUrl.startsWith('ws://'));
  }
  assert.equal(loadConfig({ ...TEST_ENV, NAQAH_REALTIME_URL: undefined }).providerUrl, REALTIME_URL);
  assert.throws(() => loadConfig({ ...TEST_ENV, NAQAH_BRIDGE_PUBLIC_URL: 'https://bridge.example.test/voice-bridge/media' }));
});

test('signature uses the configured wss URL, not request host or an https substitution', () => {
  assert.ok(verifyTwilioSignature(signature(), PUBLIC_URL, TEST_ENV.TWILIO_AUTH_TOKEN));
  assert.ok(verifyTwilioSignature(signature(`${PUBLIC_URL}/`), PUBLIC_URL, TEST_ENV.TWILIO_AUTH_TOKEN));
  assert.ok(!verifyTwilioSignature(signature(PUBLIC_URL.replace('wss:', 'https:')), PUBLIC_URL, TEST_ENV.TWILIO_AUTH_TOKEN));
  for (const value of [undefined, '', 'a'.repeat(28), `${signature()},${signature()}`, signature().replace(/^./, '!')]) {
    assert.equal(verifyTwilioSignature(value, PUBLIC_URL, TEST_ENV.TWILIO_AUTH_TOKEN), false);
  }
  const raw = '{"ticket":"mock-ticket"}';
  const key = createHmac('sha256', TEST_ENV.NAQAH_VOICE_SECRET).update('naqah-bridge-internal').digest();
  assert.equal(internalHeaders(raw, TEST_ENV.NAQAH_VOICE_SECRET, '123')['x-naqah-bridge-signature'],
    createHmac('sha256', key).update(`123.${raw}`).digest('hex'));
});

test('bridge rejects unsigned upgrades before accepting; health stays secret-free', async () => {
  const state = await fixture();
  try {
    for (const headers of [{}, { 'X-Twilio-Signature': 'invalid' }]) {
      const socket = new WebSocket('ws://127.0.0.1:3903/voice-bridge/media', { headers });
      let opened = false;
      socket.on('open', () => { opened = true; });
      socket.on('error', () => {});
      const [, response] = await once(socket, 'unexpected-response');
      assert.equal(response.statusCode, 403);
      socket.terminate();
      assert.equal(opened, false);
    }
    const response = await fetch('http://127.0.0.1:3903/voice-bridge/health');
    assert.deepEqual(await response.json(), { ok: true, publicUrl: 'wss://bridge.example.test/voice-bridge/media', maxCallSeconds: 300 });
    assert.equal(state.requests.length, 0);
  } finally { await state.close(); }
});

test('no valid start closes promptly without reaching either API', async () => {
  const state = await fixture({ limits: { startMs: 60 } });
  try {
    const { socket } = await state.connect();
    send(socket, { event: 'connected', protocol: 'Call', version: '1.0.0' });
    await closed(socket);
    assert.equal(state.requests.length, 0);
    assert.ok(state.logs.some((record) => record.event === 'start_timeout'));
  } finally { await state.close(); }
});

for (const sessionDelay of [0, 40]) {
  test(`refused ticket closes Twilio and the provider never speaks (session delay ${sessionDelay}ms)`, async () => {
    const state = await fixture({ sessionStatus: 403, sessionDelay });
    try {
      const { socket } = await state.connect();
      start(socket);
      await closed(socket);
      await delay(20);
      assert.equal(state.requests[0].url, '/api/voice/realtime/session');
      assert.deepEqual(state.requests[0].body, { ticket: 'mock-ticket', callSid: CALL_SID });
      assert.deepEqual(state.providerEvents, []);
      assert.ok(state.logs.some((record) => record.event === 'session_failed'));
    } finally { await state.close(); }
  });
}

test('session fetch and provider connection run side by side; nothing is sent until both are in', async () => {
  const state = await fixture({ sessionDelay: 120 });
  try {
    const { socket } = await state.connect();
    start(socket);
    await waitFor(() => state.requests.length === 1 && state.provider);
    await delay(20);
    assert.equal(state.providerEvents.length, 0);
    const update = await state.providerInbox.wait((event) => event.type === 'session.update');
    assert.equal(update.session.instructions, 'Mock instructions');
    await state.providerInbox.wait((event) => event.type === 'response.create');
  } finally { await state.close(); }
});

test('a natural call answers after 500 ms of silence, not 700', async () => {
  const state = await fixture({ session: { style: 'natural' } });
  try {
    const { socket } = await state.connect();
    await state.ready(socket);
    const input = state.providerEvents.find((event) => event.type === 'session.update').session.audio.input;
    assert.equal(input.turn_detection.silence_duration_ms, 500);
  } finally { await state.close(); }
});

test('input transcription carries no hint, phone noise is filtered and VAD waits 700 ms', async () => {
  const state = await fixture();
  try {
    const { socket } = await state.connect();
    await state.ready(socket);
    const input = state.providerEvents.find((event) => event.type === 'session.update').session.audio.input;
    assert.deepEqual(input.transcription, { model: 'gpt-4o-transcribe', language: 'en' });
    assert.equal(input.turn_detection.silence_duration_ms, 700);
    assert.deepEqual(input.noise_reduction, { type: 'near_field' });
  } finally { await state.close(); }
});

test('audio from before session.updated is dropped; both directions remain raw mu-law', async () => {
  const state = await fixture({ sessionDelay: 30 });
  try {
    const { socket, messages } = await state.connect();
    start(socket);
    media(socket);
    for (let attempt = 0; attempt < 100 && !state.providerInbox; attempt += 1) await delay(5);
    assert.ok(state.providerInbox);
    await state.providerInbox.wait((event) => event.type === 'response.create');
    await delay(10);
    assert.equal(state.providerEvents.filter((event) => event.type === 'input_audio_buffer.append').length, 0);
    assert.ok(state.logs.some((record) => record.event === 'provider_ready' && record.droppedEarlyFrames === 1));
    media(socket);
    const append = await state.providerInbox.wait((event) => event.type === 'input_audio_buffer.append');
    assert.equal(append.audio, AUDIO);
    const update = state.providerEvents.find((event) => event.type === 'session.update');
    assert.equal(update.session.model, 'gpt-realtime-2.1');
    assert.equal(update.session.instructions, 'Mock instructions');
    assert.equal(update.session.tool_choice, 'required');
    assert.equal(update.session.audio.input.format.type, 'audio/pcmu');
    assert.equal(update.session.audio.output.format.type, 'audio/pcmu');
    assert.equal(update.session.audio.input.turn_detection.type, 'server_vad');
    assert.equal(update.session.audio.input.turn_detection.interrupt_response, false);
    assert.equal(state.providerAuth, 'Bearer mock-key-never-paid');
    const opening = state.providerEvents.find((event) => event.type === 'response.create');
    assert.match(opening.response.instructions, /Mock opening/);
    assert.equal(opening.response.tool_choice, 'none');
    await delay(10);
    state.audio(160);
    const output = await messages.wait((event) => event.event === 'media');
    assert.equal(output.media.payload, AUDIO);
    assert.equal(output.streamSid, STREAM_SID);
    const logs = JSON.stringify(state.logs);
    for (const secret of ['mock-key', 'Mock opening', 'Mock instructions', 'mock-ticket', CALL_SID]) assert.ok(!logs.includes(secret));
  } finally { await state.close(); }
});

test('barge-in clears Twilio, cancels generation and truncates only acknowledged playback', async () => {
  const state = await fixture();
  try {
    const { socket, messages } = await state.connect();
    await state.ready(socket);
    state.audio(3200);
    await messages.wait((event) => event.event === 'mark' && event.mark.name === 'audio-2');
    send(socket, { event: 'mark', streamSid: STREAM_SID, mark: { name: 'audio-1' } });
    await delay(10);
    send(state.provider, { type: 'input_audio_buffer.speech_started' });
    await messages.wait((event) => event.event === 'clear');
    const truncate = await state.providerInbox.wait((event) => event.type === 'conversation.item.truncate');
    assert.deepEqual(truncate, {
      type: 'conversation.item.truncate', item_id: 'assistant-item', content_index: 0, audio_end_ms: 200,
    });
    const cancel = await state.providerInbox.wait((event) => event.type === 'response.cancel');
    assert.equal(cancel.response_id, state.responseId);
    state.audio(160);
    send(socket, { event: 'mark', streamSid: STREAM_SID, mark: { name: 'audio-2' } });
    await delay(15);
    assert.equal(messages.received.filter((event) => event.event === 'media').length, 2);
    send(state.provider, { type: 'response.done', response: { id: state.responseId, status: 'cancelled' } });
    assert.equal(socket.readyState, WebSocket.OPEN);
  } finally { await state.close(); }
});

test('barge-in truncates completed but unplayed audio without cancelling a finished response', async () => {
  const state = await fixture();
  try {
    const { socket, messages } = await state.connect();
    await state.ready(socket);
    state.audio(1600);
    send(state.provider, { type: 'response.output_audio.done', item_id: 'assistant-item', content_index: 0 });
    state.complete();
    await messages.wait((event) => event.event === 'mark');
    await delay(10);
    send(state.provider, { type: 'input_audio_buffer.speech_started' });
    const truncate = await state.providerInbox.wait((event) => event.type === 'conversation.item.truncate');
    assert.equal(truncate.audio_end_ms, 0);
    assert.equal(state.providerEvents.filter((event) => event.type === 'response.cancel').length, 0);
    assert.equal(socket.readyState, WebSocket.OPEN);
  } finally { await state.close(); }
});

test('tool round trip forwards signed args and speech; awaitingConfirmation resets speech', async () => {
  const state = await fixture({ toolResult: { output: '{"summary":true}', awaitingConfirmation: true, end: null, goodbye: null, sayText: 'Mock next question' } });
  try {
    const { socket } = await state.connect();
    await state.ready(socket);
    state.complete();
    await delay(10);
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'user-first' });
    await state.providerInbox.wait((event) => event.type === 'response.create' && !event.response.instructions);
    await delay(10);
    send(state.provider, {
      type: 'response.function_call_arguments.done', response_id: state.responseId,
      call_id: 'tool-first', name: 'answer_question', arguments: '{"value":"yes"}',
    });
    await state.providerInbox.wait((event) => event.item?.call_id === 'tool-first');
    const first = state.requests.find((request) => request.body?.toolCallId === 'tool-first');
    assert.deepEqual(first.body, {
      ticket: 'mock-ticket', callSid: CALL_SID, toolCallId: 'tool-first', name: 'answer_question',
      args: { value: 'yes' }, userSpokeSinceLastTool: true, workerUtterance: '',
    });
    const output = state.providerEvents.find((event) => event.item?.call_id === 'tool-first');
    assert.deepEqual(output.item, { type: 'function_call_output', call_id: 'tool-first', output: '{"summary":true}' });
    state.complete();
    await delay(15);
    assert.equal(state.providerEvents.filter((event) => event.type === 'response.create').length, 3);
    send(state.provider, {
      type: 'response.function_call_arguments.done', response_id: state.responseId,
      call_id: 'tool-second', name: 'confirm_report', arguments: '{"confirmed":true}',
    });
    await state.providerInbox.wait((event) => event.item?.call_id === 'tool-second');
    const second = state.requests.find((request) => request.body?.toolCallId === 'tool-second');
    assert.equal(second.body.userSpokeSinceLastTool, false);
    send(state.provider, {
      type: 'response.function_call_arguments.done', response_id: state.responseId,
      call_id: 'tool-second', name: 'confirm_report', arguments: '{"confirmed":true}',
    });
    await delay(15);
    assert.equal(state.requests.filter((request) => request.body?.toolCallId === 'tool-second').length, 1);
  } finally { await state.close(); }
});

for (const mode of ['ready', 'delayed', 'missing', 'late', 'failed', 'stale', 'superseded', 'oversized']) {
  test(`confirmation forwards only the latest bounded transcript: ${mode}`, async () => {
    const state = await fixture({ autoComplete: true, limits: { transcriptionMs: 50 } });
    try {
      const { socket } = await state.connect();
      await state.ready(socket);
      const update = state.providerEvents.find((event) => event.type === 'session.update');
      assert.deepEqual(update.session.audio.input.transcription, { model: 'gpt-4o-transcribe', language: 'en' });
      const complete = (item_id, transcript) => send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id, content_index: 0, transcript });
      send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'old' });
      complete('old', 'old-private-transcript');
      send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'latest' });
      if (mode === 'ready') complete('latest', 'إيه صح');
      if (mode === 'stale') complete('old', 'إيه صح');
      if (mode === 'oversized') complete('latest', 'a'.repeat(1001));
      if (mode === 'failed') {
        send(state.provider, { type: 'conversation.item.input_audio_transcription.failed', item_id: 'latest', content_index: 0, error: { message: 'private failure transcript' } });
        complete('latest', 'إيه صح');
      }
      send(state.provider, { type: 'response.function_call_arguments.done', response_id: state.responseId, call_id: 'confirm-test', name: 'confirm_report', arguments: '{"confirmed":true}' });
      if (mode === 'delayed') { await delay(15); complete('latest', 'إيه صح'); }
      if (mode === 'superseded') {
        await delay(10);
        send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'newer' });
        complete('latest', 'إيه صح');
        complete('newer', 'لا');
      }
      await state.providerInbox.wait((event) => event.item?.call_id === 'confirm-test');
      const body = state.requests.find((request) => request.body?.toolCallId === 'confirm-test').body;
      assert.equal(body.workerUtterance, ['ready', 'delayed'].includes(mode) ? 'إيه صح' : '');
      assert.equal(body.heardSummary, false);
      if (mode === 'late') {
        complete('latest', 'إيه صح');
        send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'late-confirm', name: 'confirm_report', arguments: '{"confirmed":true}' });
        await state.providerInbox.wait((event) => event.item?.call_id === 'late-confirm');
        const late = state.requests.find((request) => request.body?.toolCallId === 'late-confirm').body;
        assert.equal(late.workerUtterance, '');
        assert.equal(late.userSpokeSinceLastTool, false);
      }
      assert.ok(!JSON.stringify(state.logs).includes('private'));
      assert.ok(!JSON.stringify(state.logs).includes('إيه صح'));
      assert.ok(!JSON.stringify(state.providerEvents).includes('old-private-transcript'));
      assert.ok(!state.providerEvents.some((event) => event.item?.type === 'function_call_output' && event.item.output.includes('إيه صح')));
    } finally { await state.close(); }
  });
}

test('one committed worker turn cannot authorize two queued answers', async () => {
  const state = await fixture({ autoComplete: true, toolDelay: 25 });
  try {
    const { socket } = await state.connect();
    await state.ready(socket);
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'one-turn' });
    for (const call_id of ['first-answer', 'second-answer']) {
      send(state.provider, { type: 'response.function_call_arguments.done', call_id, name: 'answer_question', arguments: '{"value":"yes"}' });
    }
    await state.providerInbox.wait((event) => event.item?.call_id === 'second-answer');
    const bodies = state.requests.filter((request) => request.url.endsWith('/tool')).map((request) => request.body);
    assert.deepEqual(bodies.map((body) => body.userSpokeSinceLastTool), [true, false]);
    assert.deepEqual(bodies.map((body) => body.workerUtterance), ['', '']);
    assert.ok(bodies.every((body) => !('heardSummary' in body)));
  } finally { await state.close(); }
});

for (const name of ['answer_question', 'record_facts', 'finish_update', 'choose_mode', 'repeat_or_clarify', 'confirm_report', 'correct_report', 'flag_urgent']) {
  test(`${name} waits for the worker's words and carries them to the server`, async () => {
    const state = await fixture({ autoComplete: true, limits: { transcriptionMs: 500 } });
    try {
      const { socket } = await state.connect();
      await state.ready(socket);
      send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'answer-words' });
      send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'words-answer', name, arguments: '{"value":"yes"}' });
      await delay(30);
      assert.equal(state.requests.some((request) => request.body?.toolCallId === 'words-answer'), false);
      send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'answer-words', content_index: 0, transcript: 'العلف زين' });
      await state.providerInbox.wait((event) => event.item?.call_id === 'words-answer');
      assert.equal(state.requests.find((request) => request.body?.toolCallId === 'words-answer').body.workerUtterance, 'العلف زين');
    } finally { await state.close(); }
  });
}

test('a reply that is not the server-spoken summary never counts as hearing it', async () => {
  const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: true, end: null, goodbye: null, sayText: 'Mock next question' } });
  try {
    const { socket, messages } = await state.connect();
    await state.ready(socket);
    state.complete();
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'answer' });
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'answer', content_index: 0, transcript: 'نعم' });
    await delay(15);
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'refused', name: 'confirm_report', arguments: '{"confirmed":true}' });
    await state.providerInbox.wait((event) => event.item?.call_id === 'refused');
    await delay(20);
    state.audio(160, 'model-question');
    send(state.provider, { type: 'response.output_audio.done', item_id: 'model-question', content_index: 0 });
    state.complete();
    await delay(15);
    assert.equal(messages.received.filter((event) => event.event === 'mark' && event.mark.name.startsWith('summary-')).length, 0);
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'second' });
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'second', content_index: 0, transcript: 'نعم' });
    await delay(15);
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'after-question', name: 'confirm_report', arguments: '{"confirmed":true}' });
    await state.providerInbox.wait((event) => event.item?.call_id === 'after-question');
    assert.equal(state.requests.find((request) => request.body?.toolCallId === 'after-question').body.heardSummary, false);
  } finally { await state.close(); }
});

for (const scenario of [
  { transcript: undefined },
  { transcript: 'Can I save it?' },
  { transcript: 'Mock summary' },
  { transcript: 'Mock summary', delayedSpeech: true },
  { transcript: 'Mock summary', noSpeechStart: true },
]) {
  const { transcript, delayedSpeech, noSpeechStart } = scenario;
  test(`summary playback requires matching content and a later worker turn: ${JSON.stringify(scenario)}`, async () => {
    const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: true, summaryText: 'Mock summary', summaryId: 'revision-1', end: null, goodbye: null } });
    try {
      const { socket, messages } = await state.connect();
      await state.ready(socket);
      send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'answer' });
      send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'summary-tool', name: 'answer_question', arguments: '{"value":"yes"}' });
      await state.providerInbox.wait((event) => event.item?.call_id === 'summary-tool');
      state.complete();
      await state.providerInbox.wait((event) => event.type === 'response.create' && /Mock summary/.test(event.response.instructions || ''));
      await delay(20);
      state.audio(160, 'summary-audio');
      if (transcript !== undefined) send(state.provider, {
        type: 'response.output_audio_transcript.done', response_id: state.responseId,
        item_id: 'summary-audio', content_index: 0, transcript,
      });
      state.complete();
      await delay(20);
      if (delayedSpeech) {
        media(socket);
        await state.providerInbox.wait((event) => event.type === 'input_audio_buffer.append');
      }
      const marks = messages.received.filter((event) => event.event === 'mark');
      for (const event of marks) send(socket, { event: 'mark', streamSid: STREAM_SID, mark: event.mark });
      await delay(15);
      if (!noSpeechStart) send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 0 });
      send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'confirmation' });
      send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'confirmation', content_index: 0, transcript: 'yes' });
      send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'confirmation-tool', name: 'confirm_report', arguments: '{"confirmed":true}' });
      await state.providerInbox.wait((event) => event.item?.call_id === 'confirmation-tool');
      const body = state.requests.find((request) => request.body?.toolCallId === 'confirmation-tool').body;
      const heard = transcript === 'Mock summary' && !delayedSpeech && !noSpeechStart;
      assert.equal(body.heardSummary, heard);
      assert.equal(body.heardSummaryId, heard ? 'revision-1' : undefined);
      assert.equal('heardSummaryId' in body, heard);
    } finally { await state.close(); }
  });
}

test('interrupted summary is not heard; only a complete re-read and its marks allow confirmation', async () => {
  const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: true, summaryText: 'Mock summary', summaryId: 'revision-1', end: null, goodbye: null } });
  try {
    const { socket, messages } = await state.connect();
    await state.ready(socket);
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'answer' });
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'summary-tool', name: 'answer_question', arguments: '{"value":"yes"}' });
    await state.providerInbox.wait((event) => event.item?.call_id === 'summary-tool');
    state.complete();
    const spoken = await state.providerInbox.wait((event) => event.type === 'response.create' && /Mock summary/.test(event.response.instructions || ''));
    assert.equal(spoken.response.tool_choice, 'none');
    await delay(20);
    state.audio(160, 'summary-first');
    const audioMark = await messages.wait((event) => event.event === 'mark');
    send(state.provider, { type: 'input_audio_buffer.speech_started' });
    await messages.wait((event) => event.event === 'clear');
    send(socket, { event: 'mark', streamSid: STREAM_SID, mark: audioMark.mark });
    send(state.provider, { type: 'response.done', response: { id: state.responseId, status: 'cancelled' } });
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'interruption' });
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'interruption', content_index: 0, transcript: 'إيه صح' });
    await delay(15);
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'interrupted-confirm', name: 'confirm_report', arguments: '{"confirmed":true}' });
    await state.providerInbox.wait((event) => event.item?.call_id === 'interrupted-confirm');
    assert.equal(state.requests.find((request) => request.body?.toolCallId === 'interrupted-confirm').body.heardSummary, false);
    assert.equal('heardSummaryId' in state.requests.find((request) => request.body?.toolCallId === 'interrupted-confirm').body, false);
    state.complete();
    await delay(20);
    state.audio(160, 'summary-reread');
    send(state.provider, { type: 'response.output_audio.done', item_id: 'summary-reread', content_index: 0 });
    send(state.provider, { type: 'response.output_audio_transcript.done', response_id: state.responseId, item_id: 'summary-reread', content_index: 0, transcript: 'Mock summary' });
    state.complete();
    const summaryMark = await messages.wait((event) => event.event === 'mark' && event.mark.name.startsWith('summary-'));
    send(socket, { event: 'mark', streamSid: STREAM_SID, mark: summaryMark.mark });
    await delay(15);
    send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 0 });
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'after-reread' });
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'after-reread', content_index: 0, transcript: 'إيه صح' });
    await delay(15);
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'reread-confirm', name: 'confirm_report', arguments: '{"confirmed":true}' });
    await state.providerInbox.wait((event) => event.item?.call_id === 'reread-confirm');
    assert.equal(state.requests.find((request) => request.body?.toolCallId === 'reread-confirm').body.heardSummary, true);
    assert.equal(state.requests.find((request) => request.body?.toolCallId === 'reread-confirm').body.heardSummaryId, 'revision-1');
  } finally { await state.close(); }
});

for (const mode of ['committed', 'error', 'timeout', 'normal']) {
  test(`long open speech recovery after interrupt: ${mode}`, async () => {
    const state = await fixture({ limits: { speechMs: 60, readyMs: 100 } });
    try {
      const { socket, messages } = await state.connect();
      await state.ready(socket);
      state.audio(160);
      await messages.wait((event) => event.event === 'media');
      const interruptedId = state.responseId;
      send(state.provider, { type: 'input_audio_buffer.speech_started' });
      await state.providerInbox.wait((event) => event.type === 'response.cancel');
      send(state.provider, { type: 'response.done', response: { id: interruptedId, status: 'cancelled' } });
      await delay(20);
      assert.equal(state.providerEvents.filter((event) => event.type === 'input_audio_buffer.commit').length, 0);
      if (mode === 'normal') {
        send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
        await delay(70);
        assert.equal(state.providerEvents.filter((event) => event.type === 'input_audio_buffer.commit').length, 0);
        return;
      }
      const commit = await state.providerInbox.wait((event) => event.type === 'input_audio_buffer.commit');
      if (mode === 'committed') {
        send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'recovered' });
        await state.providerInbox.wait((event) => event.type === 'response.create' && !event.response.instructions);
        assert.equal(state.requests.filter((request) => request.url.endsWith('/tool')).length, 0);
        assert.equal(socket.readyState, WebSocket.OPEN);
      } else {
        if (mode === 'error') send(state.provider, { type: 'error', error: { code: 'input_audio_buffer_commit_empty', event_id: commit.event_id } });
        await closed(socket);
        assert.ok(state.logs.some((record) => record.event === (mode === 'error' ? 'speech_recovery_failed' : 'speech_recovery_timeout')));
      }
    } finally { await state.close(); }
  });
}

test('goodbye waits for its final playback mark rather than provider completion', async () => {
  const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: false, end: 'hangup', goodbye: 'Mock goodbye' } });
  try {
    const { socket, messages } = await state.connect();
    await state.ready(socket);
    send(state.provider, {
      type: 'response.function_call_arguments.done', response_id: state.responseId,
      call_id: 'end-tool', name: 'end_call', arguments: '{"reason":"worker_ended"}',
    });
    await state.providerInbox.wait((event) => event.item?.call_id === 'end-tool');
    state.complete();
    const goodbye = await state.providerInbox.wait((event) => event.type === 'response.create' && /Mock goodbye/.test(event.response.instructions));
    assert.equal(goodbye.response.tool_choice, 'none');
    await delay(10);
    state.audio(160, 'goodbye-item');
    state.complete();
    const final = await messages.wait((event) => event.event === 'mark' && event.mark.name.startsWith('goodbye-'));
    assert.equal(socket.readyState, WebSocket.OPEN);
    send(socket, { event: 'mark', streamSid: STREAM_SID, mark: final.mark });
    await closed(socket);
    assert.ok(state.logs.some((record) => record.event === 'goodbye_played'));
  } finally { await state.close(); }
});

test('goodbye playback has a bounded timeout', async () => {
  const state = await fixture({
    limits: { goodbyeMs: 80 },
    toolResult: { output: '{}', awaitingConfirmation: false, end: 'fallback', goodbye: 'Mock goodbye' },
  });
  try {
    const { socket } = await state.connect();
    await state.ready(socket);
    send(state.provider, {
      type: 'response.function_call_arguments.done', response_id: state.responseId,
      call_id: 'end-timeout', name: 'end_call', arguments: '{}',
    });
    await closed(socket);
    assert.ok(state.logs.some((record) => record.event === 'goodbye_timeout'));
  } finally { await state.close(); }
});

test('provider error, disconnect and failed responses immediately close Twilio', async () => {
  for (const failure of ['error', 'disconnect', 'response']) {
    const state = await fixture();
    try {
      const { socket } = await state.connect();
      await state.ready(socket);
      if (failure === 'error') send(state.provider, { type: 'error', error: { message: 'sensitive provider content' } });
      if (failure === 'disconnect') state.provider.terminate();
      if (failure === 'response') send(state.provider, { type: 'response.done', response: { id: state.responseId, status: 'failed' } });
      await closed(socket);
      assert.ok(!JSON.stringify(state.logs).includes('sensitive'));
    } finally { await state.close(); }
  }
});

test('a cancel that races its response keeps the call on the realtime voice', async () => {
  const state = await fixture();
  try {
    const { socket } = await state.connect();
    await state.ready(socket);
    send(state.provider, { type: 'error', error: { code: 'response_cancel_not_active' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(socket.readyState, WebSocket.OPEN);
    send(state.provider, { type: 'error', error: { code: 'server_error' } });
    await closed(socket);
  } finally { await state.close(); }
});

test('speech before a reply is audible cancels nothing, and the next turn is answered', async () => {
  const state = await fixture();
  try {
    const { socket, messages } = await state.connect();
    await state.ready(socket);
    send(state.provider, { type: 'input_audio_buffer.speech_started' });
    await delay(20);
    assert.equal(state.providerEvents.filter((event) => event.type === 'response.cancel').length, 0);
    assert.equal(messages.received.filter((event) => event.event === 'clear').length, 0);
    state.audio(160);
    await messages.wait((event) => event.event === 'media');
    state.complete();
    send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
    send(state.provider, { type: 'input_audio_buffer.committed' });
    await state.providerInbox.wait((event) => event.type === 'response.create' && !event.response.instructions);
    await delay(10);
    send(state.provider, { type: 'input_audio_buffer.speech_started' });
    await delay(20);
    assert.equal(state.providerEvents.filter((event) => event.type === 'response.cancel').length, 0);
    state.audio(160, 'next-item');
    await delay(20);
    assert.equal(messages.received.filter((event) => event.event === 'media').length, 2);
    const events = state.logs.map((record) => record.event);
    for (const name of ['speech_before_audio', 'response_requested', 'response_created', 'response_audio_started', 'response_done']) assert.ok(events.includes(name), name);
    const done = state.logs.find((record) => record.event === 'response_done');
    assert.deepEqual([done.kind, done.status], ['opening', 'completed']);
  } finally { await state.close(); }
});

test('a hello committed during the opening earns no extra turn; later speech is answered', async () => {
  const state = await fixture();
  try {
    const { socket, messages } = await state.connect();
    await state.ready(socket);
    const turns = () => state.providerEvents.filter((event) => event.type === 'response.create' && !event.response.instructions);
    send(state.provider, { type: 'input_audio_buffer.speech_started' });
    state.audio(160);
    await messages.wait((event) => event.event === 'media');
    send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
    send(state.provider, { type: 'input_audio_buffer.committed' });
    await delay(20);
    state.complete();
    await delay(20);
    assert.equal(turns().length, 0);
    assert.ok(state.logs.some((record) => record.event === 'input_committed_during_opening'));
    send(state.provider, { type: 'input_audio_buffer.speech_started' });
    send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
    send(state.provider, { type: 'input_audio_buffer.committed' });
    await state.providerInbox.wait((event) => event.type === 'response.create' && !event.response.instructions);
    assert.equal(turns().length, 1);
  } finally { await state.close(); }
});

test('a function call that outlives a lost cancel gets an output and the conversation continues', async () => {
  const state = await fixture();
  try {
    const { socket, messages } = await state.connect();
    await state.ready(socket);
    state.audio(160);
    await messages.wait((event) => event.event === 'media');
    state.complete();
    send(state.provider, { type: 'input_audio_buffer.committed' });
    await state.providerInbox.wait((event) => event.type === 'response.create' && !event.response.instructions);
    await delay(10);
    const racedId = state.responseId;
    state.audio(1600, 'turn-item');
    await delay(10);
    send(state.provider, { type: 'input_audio_buffer.speech_started' });
    await state.providerInbox.wait((event) => event.type === 'response.cancel');
    send(state.provider, { type: 'response.function_call_arguments.done', response_id: racedId, call_id: 'raced-call', name: 'answer_question', arguments: '{"value":"good"}' });
    send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
    send(state.provider, { type: 'response.done', response: { id: racedId, status: 'completed', output: [{ type: 'function_call', status: 'completed', call_id: 'raced-call' }] } });
    const told = await state.providerInbox.wait((event) => event.item?.call_id === 'raced-call');
    assert.equal(told.item.type, 'function_call_output');
    assert.equal(JSON.parse(told.item.output).status, 'not_applied');
    await delay(30);
    const toldAt = state.providerEvents.findIndex((event) => event.item?.call_id === 'raced-call');
    assert.ok(state.providerEvents.slice(toldAt + 1).some((event) => event.type === 'response.create' && !event.response.instructions));
    assert.equal(state.requests.filter((record) => record.url === '/api/voice/realtime/tool').length, 0);
    assert.equal(socket.readyState, WebSocket.OPEN);
    assert.ok(state.logs.some((record) => record.event === 'tool_dropped_after_interrupt'));
  } finally { await state.close(); }
});

test('response logs carry labels only, never provider text', async () => {
  const state = await fixture();
  try {
    const { socket } = await state.connect();
    await state.ready(socket);
    send(state.provider, { type: 'response.done', response: {
      id: state.responseId, status: 'completed', status_details: { reason: 'private words here' },
      output: [{ type: 'message', content: [{ transcript: 'private transcript' }] }],
    } });
    await delay(20);
    const logs = JSON.stringify(state.logs);
    assert.ok(!logs.includes('private'));
    assert.deepEqual(state.logs.find((record) => record.event === 'response_done').outputs, ['message']);
  } finally { await state.close(); }
});

test('provider connection refusal closes Twilio; it never retries', async () => {
  const state = await fixture();
  let attempts = 0;
  const unavailable = http.createServer((request, response) => {
    attempts += 1;
    response.writeHead(503);
    response.end();
  });
  const other = createBridge({ config: loadConfig({ ...TEST_ENV, PORT: '3904', NAQAH_REALTIME_URL: 'ws://127.0.0.1:3905/unavailable' }), logger: () => {} });
  try {
    await listen(unavailable, 3905);
    await listen(other.server, 3904);
    const socket = new WebSocket('ws://127.0.0.1:3904/voice-bridge/media', { headers: { 'X-Twilio-Signature': signature() } });
    await once(socket, 'open');
    start(socket);
    await closed(socket);
    await waitFor(() => state.requests.length === 2);
    assert.deepEqual(state.requests.map((request) => request.url), ['/api/voice/realtime/session', '/api/voice/realtime/closed']);
    assert.equal(state.requests[1].body.reason, 'openai_error');
    assert.equal(attempts, 1);
  } finally {
    await other.close();
    await new Promise((resolve) => unavailable.close(resolve));
    await state.close();
  }
});

test('session timeout, tool failure, provider readiness and response timeouts fall back', async () => {
  for (const failure of ['session', 'tool', 'ready', 'response']) {
    const state = await fixture({
      sessionDelay: failure === 'session' ? 100 : 0,
      toolStatus: failure === 'tool' ? 500 : 200,
      noReady: failure === 'ready',
      noResponse: failure === 'response',
      limits: { internalMs: 40, readyMs: 40, responseMs: 60 },
    });
    try {
      const { socket } = await state.connect();
      if (failure === 'tool') {
        await state.ready(socket);
        send(state.provider, {
          type: 'response.function_call_arguments.done', response_id: state.responseId,
          call_id: 'failed-tool', name: 'answer_question', arguments: '{}',
        });
      } else start(socket);
      await closed(socket);
    } finally { await state.close(); }
  }
});

test('duplicate callSid cannot consume a second ticket or start a second provider', async () => {
  const state = await fixture();
  try {
    const first = await state.connect();
    await state.ready(first.socket);
    const second = await state.connect();
    start(second.socket);
    await closed(second.socket);
    assert.equal(first.socket.readyState, WebSocket.OPEN);
    assert.equal(state.requests.length, 1);
  } finally { await state.close(); }
});

test('call duration and message size limits close the stream', async () => {
  for (const limit of ['duration', 'size', 'invalid-start']) {
    const state = await fixture({
      maxSeconds: limit === 'duration' ? 0.06 : 120,
    });
    try {
      const { socket } = await state.connect();
      if (limit === 'invalid-start') start(socket, { callSid: 'not-a-call' });
      else start(socket);
      if (limit === 'size') socket.send('x'.repeat(70 * 1024));
      await closed(socket);
    } finally { await state.close(); }
  }
});

test('sayText is spoken verbatim as a question without leaking text to logs', async () => {
  const question = 'وش حالة العلف في العزبة؟';
  const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: false, end: null, goodbye: null, sayText: question } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'question-tool');
    const response = state.providerEvents.filter((event) => event.type === 'response.create').at(-1).response;
    assert.deepEqual({ ...response, instructions: response.instructions.split(' Speak it ')[0] }, {
      output_modalities: ['audio'], tool_choice: 'none',
      instructions: `Say only the following text verbatim, with no additions: ${JSON.stringify(question)}`,
    });
    // The delivery note says how to speak, never what: the words stay the server's.
    assert.match(response.instructions, / Speak it (as a friendly Saudi|warmly)/);
    assert.ok(state.logs.some((record) => record.event === 'response_requested' && record.kind === 'question'));
    assert.ok(!JSON.stringify(state.logs).includes(question));
    assert.ok(!JSON.stringify(state.logs).includes('Mock worker words'));
  } finally { await state.close(); }
});

test('speech during a tool call cannot replace the question the server has queued', async () => {
  const question = 'Next question';
  const state = await fixture({ toolDelay: 40, toolResult: { output: '{}', awaitingConfirmation: false, end: null, goodbye: null, sayText: question } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    const previous = state.responseId;
    send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 0 });
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'first' });
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'first', content_index: 0, transcript: 'Mock answer' });
    await waitFor(() => state.responseId !== previous);
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'first', name: 'answer_question', arguments: '{}' });
    state.complete();
    send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 100 });
    await state.providerInbox.wait((event) => event.item?.call_id === 'first');
    send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'second' });
    await waitFor(() => state.logs.some((record) => record.event === 'turn_discarded_for_prompt'));
    await waitFor(() => state.providerEvents.filter((event) => event.type === 'response.create').at(-1)?.response?.instructions?.includes(question));
  } finally { await state.close(); }
});

test('a short noise does not cut NAQAH off; speech that keeps going does', async () => {
  const state = await fixture({ limits: { bargeInMs: 30 } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection, undefined, false);
    send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 0 });
    send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
    await delay(60);
    assert.ok(!state.logs.some((record) => record.event === 'barge_in'));
    send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 100 });
    await waitFor(() => state.logs.some((record) => record.event === 'barge_in'));
  } finally { await state.close(); }
});

test('silent results request no reply after a fully played prompt', async () => {
  const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: false, end: null, goodbye: null, silent: true } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    const before = state.providerEvents.filter((event) => event.type === 'response.create').length;
    await workerTool(state, 'noise', 'repeat_or_clarify');
    assert.equal(state.providerEvents.filter((event) => event.type === 'response.create').length, before + 1);
    assert.ok(state.logs.some((record) => record.event === 'tool_silent'));
    assert.equal(connection.socket.readyState, WebSocket.OPEN);
  } finally { await state.close(); }
});

test('silent results re-speak a cut-off prompt without granting worker speech', async () => {
  const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: false, end: null, goodbye: null, silent: true } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    const oldMarks = await playPrompt(state, connection, undefined, false);
    await workerTool(state, 'noise', 'repeat_or_clarify');
    const response = state.providerEvents.filter((event) => event.type === 'response.create').at(-1).response;
    assert.match(response.instructions, /Mock opening/);
    assert.equal(response.tool_choice, 'none');
    assert.ok(connection.messages.received.some((event) => event.event === 'clear'));
    for (const event of oldMarks) send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: event.mark });
    await playPrompt(state, connection);
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'no-new-worker', name: 'repeat_or_clarify', arguments: '{}' });
    await state.providerInbox.wait((event) => event.item?.call_id === 'no-new-worker');
    const body = state.requests.find((request) => request.body?.toolCallId === 'no-new-worker').body;
    assert.equal(body.userSpokeSinceLastTool, false);
    assert.equal(body.workerUtterance, '');
  } finally { await state.close(); }
});

test('a later fully heard summary replaces the id sent on all subsequent tools', async () => {
  const state = await fixture({ toolResult: (body) => ({
    output: '{}', awaitingConfirmation: true, end: null, goodbye: null,
    ...(body.toolCallId === 'first-summary' ? { summaryText: 'First summary', summaryId: 'revision-1' }
      : body.toolCallId === 'second-summary' ? { summaryText: 'Corrected summary', summaryId: 'revision-2' } : { silent: true }),
  }) });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    const first = await workerTool(state, 'first-summary');
    assert.equal('heardSummaryId' in first, false);
    await playPrompt(state, connection, 'First summary');
    const correction = await workerTool(state, 'second-summary', 'correct_report');
    assert.equal(correction.heardSummaryId, 'revision-1');
    await playPrompt(state, connection, 'Corrected summary');
    const after = await workerTool(state, 'after-summary', 'repeat_or_clarify');
    assert.equal(after.heardSummaryId, 'revision-2');
  } finally { await state.close(); }
});

for (const interrupted of ['summary', 'reprompt']) {
  test(`silent result replays a cut-off ${interrupted} with the correct summary evidence`, async () => {
    const state = await fixture({
      limits: { repromptMs: interrupted === 'reprompt' ? 70 : 10_000 },
      toolResult: (body) => ({
        output: '{}', awaitingConfirmation: true, end: null, goodbye: null,
        ...(body.toolCallId === 'start-summary'
          ? { summaryText: 'Mock summary', summaryId: 'current-summary', repromptText: 'Summary nudge' } : { silent: true }),
      }),
    });
    try {
      const connection = await state.connect();
      await state.ready(connection.socket);
      await playPrompt(state, connection);
      await workerTool(state, 'start-summary');
      let staleMarks;
      if (interrupted === 'reprompt') {
        await playPrompt(state, connection, 'Mock summary');
        await waitFor(() => state.responseId === 'response-4');
        staleMarks = await playPrompt(state, connection, undefined, false);
      } else staleMarks = await playPrompt(state, connection, 'Mock summary', false);
      const noise = await workerTool(state, 'summary-noise', 'repeat_or_clarify');
      assert.equal(noise.heardSummaryId, interrupted === 'reprompt' ? 'current-summary' : undefined);
      assert.match(state.providerEvents.filter((event) => event.type === 'response.create').at(-1).response.instructions, /Mock summary/);
      for (const event of staleMarks) send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: event.mark });
      await playPrompt(state, connection, interrupted === 'summary' ? 'Mock summary' : undefined);
      const confirmation = await workerTool(state, 'after-silent-replay', 'confirm_report', 'yes', { confirmed: true });
      assert.equal(confirmation.heardSummary, true);
      assert.equal(confirmation.heardSummaryId, 'current-summary');
    } finally { await state.close(); }
  });
}

test('reprompts wait for full playback marks, run twice, then time out after one more interval', async () => {
  const state = await fixture({ session: { repromptText: 'Mock nudge' }, limits: { repromptMs: 80, maxReprompts: 2 } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    const marks = await playPrompt(state, connection, undefined, false);
    await delay(100);
    assert.equal(state.logs.filter((record) => record.event === 'reprompt').length, 0);
    for (const event of marks.filter((event) => event.mark.name.startsWith('audio-'))) {
      send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: event.mark });
    }
    await delay(100);
    assert.equal(state.logs.filter((record) => record.event === 'reprompt').length, 0);
    const final = marks.find((event) => event.mark.name.startsWith('prompt-'));
    send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: final.mark });
    await delay(30);
    assert.equal(state.logs.filter((record) => record.event === 'reprompt').length, 0);
    for (const count of [1, 2]) {
      await waitFor(() => state.providerEvents.filter((event) => event.type === 'response.create').length === count + 1 && state.responseId === `response-${count + 1}`);
      const response = state.providerEvents.filter((event) => event.type === 'response.create').at(-1).response;
      assert.match(response.instructions, /Mock nudge/);
      assert.equal(response.tool_choice, 'none');
      assert.deepEqual(state.logs.filter((record) => record.event === 'reprompt').map((record) => record.count), count === 1 ? [1] : [1, 2]);
      await delay(100);
      assert.equal(connection.socket.readyState, WebSocket.OPEN);
      assert.equal(state.logs.filter((record) => record.event === 'reprompt').length, count);
      await playPrompt(state, connection);
    }
    await delay(30);
    assert.equal(connection.socket.readyState, WebSocket.OPEN);
    await closed(connection.socket);
    assert.ok(state.logs.some((record) => record.event === 'silence_timeout'));
    await waitFor(() => state.requests.length === 2);
    assert.equal(state.requests[0].url, '/api/voice/realtime/session');
    assert.deepEqual(state.requests[1].body, { ticket: 'mock-ticket', callSid: CALL_SID, reason: 'silence', event: 'silence_timeout', workerSpoke: false });
  } finally { await state.close(); }
});

const responses = (state) => state.providerEvents.filter((event) => event.type === 'response.create');

test('watchdog: with no playback marks at all, silence gets one verbatim reprompt, then the guided call closes', async () => {
  const state = await fixture({ limits: { watchdogMs: 80, repromptMs: 60_000 } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection, undefined, false);
    await waitFor(() => responses(state).length === 2);
    assert.match(responses(state)[1].response.instructions, /Mock opening/);
    assert.equal(responses(state)[1].response.tool_choice, 'none');
    assert.equal(state.logs.filter((record) => record.event === 'watchdog_reprompt').length, 1);
    await playPrompt(state, connection, undefined, false);
    await closed(connection.socket);
    assert.ok(state.logs.some((record) => record.event === 'watchdog_end'));
    assert.equal(responses(state).length, 2);
    await waitFor(() => state.requests.some((request) => request.url === '/api/voice/realtime/closed'));
    assert.deepEqual(state.requests.at(-1).body, { ticket: 'mock-ticket', callSid: CALL_SID, reason: 'silence', event: 'silence_timeout', workerSpoke: false });
  } finally { await state.close(); }
});

test('watchdog: a committed worker turn starts the check-in over', async () => {
  const state = await fixture({ limits: { watchdogMs: 120, repromptMs: 60_000 } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection, undefined, false);
    await waitFor(() => responses(state).length === 2);
    await playPrompt(state, connection, undefined, false);
    await workerTool(state, 'call-after-check-in');
    await playPrompt(state, connection, undefined, false);
    await waitFor(() => state.logs.filter((record) => record.event === 'watchdog_reprompt').length === 2);
    assert.equal(connection.socket.readyState, WebSocket.OPEN);
    assert.ok(!state.logs.some((record) => record.event === 'watchdog_end'));
  } finally { await state.close(); }
});

test('watchdog: waits for the estimated playback of long audio, not just the last delta', async () => {
  const state = await fixture({ limits: { watchdogMs: 80, repromptMs: 60_000 } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    // 4 seconds of audio sent at once: the caller is still hearing it long after the delta.
    state.audio(32_000, 'long-item');
    send(state.provider, { type: 'response.output_audio.done', item_id: 'long-item', content_index: 0 });
    state.complete();
    await delay(400);
    assert.equal(state.logs.filter((record) => record.event === 'watchdog_reprompt').length, 0);
  } finally { await state.close(); }
});

test('watchdog: a natural call checks in once in its own words, then says goodbye and closes without any mark', async () => {
  const state = await fixture({ session: { style: 'natural' }, closedDelay: 100, limits: { watchdogMs: 80, repromptMs: 60_000 } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection, undefined, false);
    await waitFor(() => responses(state).length === 2);
    assert.match(responses(state)[1].response.instructions, /silent/);
    await playPrompt(state, connection, undefined, false);
    await waitFor(() => responses(state).length === 3);
    assert.match(responses(state)[2].response.instructions, /I can't hear you/);
    const offset = connection.messages.received.length;
    state.audio(160, 'goodbye-item');
    state.complete();
    await closed(connection.socket);
    assert.ok(connection.messages.received.slice(offset).some((event) => event.event === 'media'));
    await waitFor(() => state.requests.some((request) => request.url === '/api/voice/realtime/closed'));
    assert.equal(state.requests.at(-1).body.reason, 'silence');
    assert.equal(state.requests.at(-1).body.workerSpoke, false);
    assert.equal(state.requests.at(-1).acknowledged, true);
  } finally { await state.close(); }
});

test('closed notice: silence after the worker spoke is reported with workerSpoke, under the same signature', async () => {
  const state = await fixture({ session: { style: 'natural' }, limits: { watchdogMs: 80, repromptMs: 60_000 } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection, undefined, false);
    send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 0 });
    send(state.provider, { type: 'input_audio_buffer.speech_stopped', audio_end_ms: 500 });
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'worker-said' });
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'worker-said', content_index: 0, transcript: 'Fifty camels' });
    await waitFor(() => responses(state).length === 2);
    await playPrompt(state, connection, undefined, false);
    await waitFor(() => responses(state).length === 3);
    await playPrompt(state, connection, undefined, false);
    await waitFor(() => responses(state).length === 4);
    state.audio(160, 'goodbye-item');
    state.complete();
    await closed(connection.socket);
    await waitFor(() => state.requests.some((request) => request.url === '/api/voice/realtime/closed'));
    const notice = state.requests.find((request) => request.url === '/api/voice/realtime/closed');
    assert.equal(notice.body.reason, 'silence');
    assert.equal(notice.body.workerSpoke, true);
  } finally { await state.close(); }
});

test('closed notice: a server-ended call is normal and a credit error is named', async () => {
  for (const [scenario, expected] of [['ended', 'normal'], ['credit', 'openai_credit'], ['twilio', 'twilio_closed']]) {
    const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: false, end: 'hangup', goodbye: null } });
    try {
      const connection = await state.connect();
      await state.ready(connection.socket);
      await playPrompt(state, connection);
      if (scenario === 'ended') await workerTool(state, 'call-end', 'end_call');
      else if (scenario === 'credit') send(state.provider, { type: 'error', error: { type: 'insufficient_quota', code: 'insufficient_quota' } });
      else connection.socket.close();
      await closed(connection.socket);
      await waitFor(() => state.requests.some((request) => request.url === '/api/voice/realtime/closed'));
      const notice = state.requests.find((request) => request.url === '/api/voice/realtime/closed');
      assert.equal(notice.body.reason, expected, scenario);
      assert.equal(notice.body.ticket, 'mock-ticket');
      assert.equal(state.requests.filter((request) => request.url === '/api/voice/realtime/closed').length, 1);
    } finally { await state.close(); }
  }
});

test('closed notice: a stream that never started sends nothing', async () => {
  const state = await fixture({ limits: { startMs: 30 } });
  try {
    const connection = await state.connect();
    await closed(connection.socket);
    await delay(30);
    assert.equal(state.requests.length, 0);
  } finally { await state.close(); }
});

test('closed notice: a normal ending waits for persistence before releasing Twilio', async () => {
  const state = await fixture({ closedDelay: 100, toolResult: { output: '{}', awaitingConfirmation: false, end: 'hangup', goodbye: null } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'end-with-ack', 'end_call');
    await waitFor(() => state.requests.some((request) => request.url === '/api/voice/realtime/closed'));
    const notice = state.requests.at(-1);
    assert.equal(connection.socket.readyState, WebSocket.OPEN);
    assert.ok(!notice.acknowledged);
    await closed(connection.socket);
    assert.equal(notice.acknowledged, true);
  } finally { await state.close(); }
});

test('closed notice: a slow acknowledgement cannot keep Twilio open past its bound, and the notice still lands', async () => {
  const state = await fixture({ closedDelay: 300, limits: { closedNoticeMs: 50 }, toolResult: { output: '{}', awaitingConfirmation: false, end: 'hangup', goodbye: null } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'end-without-ack', 'end_call');
    await closed(connection.socket);
    const notice = state.requests.at(-1);
    assert.ok(!notice.acknowledged);
    // Only Twilio's wait is bounded; the request keeps the normal internal timeout and is not aborted.
    await waitFor(() => notice.acknowledged === true);
    assert.ok(!state.logs.some((record) => record.event === 'closed_notice_failed'));
  } finally { await state.close(); }
});

test('closed notice: an unreachable acknowledgement is still bounded by the internal timeout', async () => {
  const state = await fixture({ closedDelay: 300, limits: { closedNoticeMs: 50, internalMs: 100 }, toolResult: { output: '{}', awaitingConfirmation: false, end: 'hangup', goodbye: null } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'end-timeout', 'end_call');
    await closed(connection.socket);
    await waitFor(() => state.logs.some((record) => record.event === 'closed_notice_failed'));
  } finally { await state.close(); }
});

test('wrap-up: asks for the normal summary and explicit save near the cap, retaining tools', async () => {
  for (const locale of ['ar', 'en']) {
    const state = await fixture({ session: { style: 'natural', locale }, maxSeconds: 1, limits: { wrapUpMs: 450 } });
    try {
      const connection = await state.connect();
      await state.ready(connection.socket);
      await playPrompt(state, connection);
      await waitFor(() => responses(state).length === 2);
      const wrap = responses(state)[1].response;
      assert.equal(wrap.tool_choice, 'auto');
      assert.match(wrap.instructions, locale === 'ar' ? /أحفظه/ : /Shall I save it/);
      assert.match(wrap.instructions, locale === 'ar' ? /لا تخترع تقرير/ : /do not invent a report/);
      assert.equal(connection.socket.readyState, WebSocket.OPEN);
    } finally { await state.close(); }
  }
});

test('wrap-up: waits for the active reply instead of interrupting it', async () => {
  const state = await fixture({ session: { style: 'natural' }, maxSeconds: 1, limits: { wrapUpMs: 450 } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await delay(600);
    assert.equal(responses(state).length, 1);
    assert.ok(!state.providerEvents.some((event) => event.type === 'response.cancel'));
    await playPrompt(state, connection);
    await waitFor(() => responses(state).length === 2);
    assert.match(responses(state)[1].response.instructions, /Shall I save it/);
  } finally { await state.close(); }
});

test('wrap-up: pending confirmation gets bounded closing grace, without another prompt', async () => {
  const state = await fixture({
    session: { style: 'natural' }, maxSeconds: 0.3,
    limits: { wrapUpMs: 50, confirmationGraceMs: 150 },
    toolResult: { output: '{}', awaitingConfirmation: true, end: null, goodbye: null, summaryText: 'Mock summary. Shall I save it?' },
  });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'summary-at-deadline', 'submit_report');
    await delay(300);
    assert.equal(connection.socket.readyState, WebSocket.OPEN);
    assert.ok(!responses(state).some((event) => /nearing its time limit/.test(event.response.instructions ?? '')));
    await closed(connection.socket);
    assert.ok(state.logs.some((record) => record.event === 'maximum_timeout'));
  } finally { await state.close(); }
});

test('wrap-up: a cap shorter than twice the wrap-up has none, rather than one at the opening', async () => {
  const state = await fixture({ session: { style: 'natural' }, maxSeconds: 0.5, limits: { wrapUpMs: 400, confirmationGraceMs: 50 } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await closed(connection.socket);
    assert.ok(!responses(state).some((event) => /nearing its time limit/.test(event.response.instructions ?? '')));
    assert.ok(state.logs.some((record) => record.event === 'maximum_timeout'));
  } finally { await state.close(); }
});

test('wrap-up: a wrap-up held for a pending confirmation is not spoken after the call starts ending', async () => {
  let calls = 0;
  const state = await fixture({
    session: { style: 'natural' }, maxSeconds: 1.2,
    limits: { wrapUpMs: 500, confirmationGraceMs: 2_000 },
    toolResult: () => (calls++ === 0
      ? { output: '{}', awaitingConfirmation: true, end: null, goodbye: null, summaryText: 'Mock summary. Shall I save it?' }
      : { output: '{}', awaitingConfirmation: false, end: 'hangup', goodbye: 'Mock goodbye' }),
  });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'summary-first', 'submit_report');
    await playPrompt(state, connection);
    // The summary's question is spoken on its own.
    await waitFor(() => state.logs.some((record) => record.event === 'response_created' && record.kind === 'closing'));
    await playPrompt(state, connection);
    // The wrap-up comes due while the summary waits for its answer: it stays pending.
    await delay(800);
    await workerTool(state, 'refuse-and-end', 'confirm_report');
    await waitFor(() => state.logs.some((record) => record.event === 'response_requested' && record.kind === 'goodbye'));
    state.audio(160, 'goodbye-item');
    state.complete();
    await delay(50);
    assert.ok(state.logs.some((record) => record.event === 'response_requested' && record.kind === 'goodbye'));
    assert.ok(!responses(state).some((event) => /nearing its time limit/.test(event.response.instructions ?? '')));
  } finally { await state.close(); }
});

test('configuration: IPv4-first DNS and a 12 s silence watchdog by default, both overridable', () => {
  assert.equal(loadConfig(TEST_ENV).dnsOrder, 'ipv4first');
  assert.equal(loadConfig({ ...TEST_ENV, NAQAH_BRIDGE_DNS_ORDER: 'verbatim' }).dnsOrder, 'verbatim');
  assert.throws(() => loadConfig({ ...TEST_ENV, NAQAH_BRIDGE_DNS_ORDER: 'ipv4' }));
  assert.equal(loadConfig(TEST_ENV).watchdogMs, 12_000);
  assert.equal(loadConfig({ ...TEST_ENV, NAQAH_BRIDGE_SILENCE_SECONDS: '20' }).watchdogMs, 20_000);
  for (const value of ['2', '61', '1.5', 'x']) assert.throws(() => loadConfig({ ...TEST_ENV, NAQAH_BRIDGE_SILENCE_SECONDS: value }));
});

test('any worker speech resets the reprompt count, including a noise turn with a silent result', async () => {
  const state = await fixture({
    toolResult: { output: '{}', awaitingConfirmation: false, end: null, goodbye: null, silent: true },
    limits: { repromptMs: 70, maxReprompts: 1 },
  });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await waitFor(() => state.responseId === 'response-2');
    await playPrompt(state, connection);
    await workerTool(state, 'noise-reset', 'repeat_or_clarify');
    await waitFor(() => state.responseId === 'response-4');
    await playPrompt(state, connection);
    assert.deepEqual(state.logs.filter((record) => record.event === 'reprompt').map((record) => record.count), [1, 1]);
    await closed(connection.socket);
    assert.ok(state.logs.some((record) => record.event === 'silence_timeout'));
  } finally { await state.close(); }
});

for (const pending of ['tool', 'response', 'requested', 'speech']) {
  test(`no reprompt while ${pending} is pending`, async () => {
    const options = { limits: { repromptMs: 50 }, toolDelay: pending === 'tool' ? 180 : 0 };
    const state = await fixture(options);
    try {
      const connection = await state.connect();
      await state.ready(connection.socket);
      await playPrompt(state, connection);
      if (pending === 'speech') send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 0 });
      else {
        options.noResponse = pending === 'requested';
        send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'pending-tool', name: 'repeat_or_clarify', arguments: '{}' });
        if (pending !== 'tool') await state.providerInbox.wait((event) => event.item?.call_id === 'pending-tool');
      }
      await delay(110);
      assert.equal(state.logs.filter((record) => record.event === 'reprompt').length, 0);
      assert.equal(connection.socket.readyState, WebSocket.OPEN);
    } finally { await state.close(); }
  });
}

for (const mode of ['default', 'custom', 'summary']) {
  test(`tool prompt uses its ${mode} reprompt text and preserves heard summary evidence`, async () => {
    const state = await fixture({
      limits: { repromptMs: 70 },
      toolResult: (body) => ({
        output: '{}', awaitingConfirmation: mode === 'summary', end: null, goodbye: null,
        ...(body.toolCallId !== 'prompt-tool' ? { silent: true } : mode === 'summary'
          ? { summaryText: 'Mock summary', summaryId: 'summary-revision', repromptText: 'Summary nudge' }
          : { sayText: 'Mock question', ...(mode === 'custom' ? { repromptText: 'Question nudge' } : {}) }),
      }),
    });
    try {
      const connection = await state.connect();
      await state.ready(connection.socket);
      await playPrompt(state, connection);
      await workerTool(state, 'prompt-tool');
      await playPrompt(state, connection, mode === 'summary' ? 'Mock summary' : undefined);
      await waitFor(() => state.responseId === 'response-4');
      const response = state.providerEvents.filter((event) => event.type === 'response.create').at(-1).response;
      assert.match(response.instructions, new RegExp(mode === 'summary' ? 'Summary nudge' : mode === 'custom' ? 'Question nudge' : 'Mock question'));
      await playPrompt(state, connection);
      const body = await workerTool(state, 'after-reprompt', 'confirm_report', 'yes', { confirmed: true });
      assert.equal(body.userSpokeSinceLastTool, true);
      assert.equal(body.heardSummary, mode === 'summary');
      assert.equal(body.heardSummaryId, mode === 'summary' ? 'summary-revision' : undefined);
    } finally { await state.close(); }
  });
}

for (const fields of [{}, { summaryText: 42 }, { summaryId: 42, sayText: 'Question' }, { sayText: 42 },
  { sayText: 'Question', repromptText: false }, { silent: false }, { silent: 'true' },
  { sayText: ' ' }, { summaryText: '' }, { sayText: 'Question', silent: true },
  { summaryText: '', silent: true }, { summaryText: '', sayText: 'Question' },
  { summaryText: 'Summary', sayText: 'Question' }]) {
  test(`invalid tool result ends via tool_failed: ${JSON.stringify(fields)}`, async () => {
    const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: false, end: null, goodbye: null, ...fields } });
    try {
      const { socket } = await state.connect();
      await state.ready(socket);
      send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'invalid-result', name: 'repeat_or_clarify', arguments: '{}' });
      await closed(socket);
      assert.ok(state.logs.some((record) => record.event === 'tool_failed'));
      assert.equal(state.providerEvents.filter((event) => event.type === 'response.create').length, 1);
    } finally { await state.close(); }
  });
}

test('end_call waits for the worker transcript and carries it to the server', async () => {
  const state = await fixture({
    toolResult: { output: '{}', awaitingConfirmation: false, end: 'hangup', goodbye: null },
    limits: { transcriptionMs: 500 },
  });
  try {
    const { socket } = await state.connect();
    await state.ready(socket);
    state.complete();
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'end-worker' });
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'end-tool', name: 'end_call', arguments: '{}' });
    await delay(30);
    assert.equal(state.requests.some((request) => request.body?.toolCallId === 'end-tool'), false);
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'end-worker', content_index: 0, transcript: 'مع السلامة' });
    await closed(socket);
    assert.equal(state.requests.find((request) => request.body?.toolCallId === 'end-tool').body.workerUtterance, 'مع السلامة');
    assert.ok(state.logs.some((record) => record.event === 'tool_ended'));
  } finally { await state.close(); }
});

test('end_call the server refuses keeps the call open', async () => {
  const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: false, end: null, goodbye: null, silent: true } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'not-a-stop', 'end_call', 'العلف زين');
    assert.equal(connection.socket.readyState, WebSocket.OPEN);
    assert.ok(!state.logs.some((record) => record.event === 'tool_ended'));
  } finally { await state.close(); }
});

const SAVED_GOODBYE = 'انحفظ التحديث. يعطيك العافية، مع السلامة.';
const keypadResult = (body) => body.name === 'keypad_confirm'
  ? { output: '{"status":"saved"}', awaitingConfirmation: false, end: 'hangup', goodbye: SAVED_GOODBYE }
  : { output: '{}', awaitingConfirmation: true, end: null, goodbye: null, summaryText: 'Mock summary', summaryId: 'revision-1' };
const dtmf = (socket, digit) => send(socket, { event: 'dtmf', streamSid: STREAM_SID, dtmf: { track: 'inbound_track', digit } });

/** The bridge speaks the goodbye verbatim, waits for its last mark, then closes the stream for Twilio's hang-up. */
async function finishGoodbye(state, connection) {
  const goodbye = await state.providerInbox.wait((event) => event.type === 'response.create' && event.response.instructions?.includes(SAVED_GOODBYE));
  assert.equal(goodbye.response.tool_choice, 'none');
  await delay(10);
  state.audio(160, 'goodbye-item');
  state.complete();
  const final = await connection.messages.wait((event) => event.event === 'mark' && event.mark.name.startsWith('goodbye-'));
  assert.equal(connection.socket.readyState, WebSocket.OPEN);
  send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: final.mark });
  await closed(connection.socket);
  assert.ok(state.logs.some((record) => record.event === 'goodbye_played'));
}

test('key 1 after the whole summary saves through the normal path, then the goodbye plays and the stream closes', async () => {
  const state = await fixture({ toolResult: keypadResult });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'to-summary');
    await playPrompt(state, connection, 'Mock summary');
    dtmf(connection.socket, '1');
    await waitFor(() => state.requests.some((request) => request.body?.name === 'keypad_confirm'));
    const body = state.requests.find((request) => request.body?.name === 'keypad_confirm').body;
    assert.deepEqual({ keypad: body.keypad, heardSummary: body.heardSummary, heardSummaryId: body.heardSummaryId, args: body.args, spoke: body.userSpokeSinceLastTool },
      { keypad: true, heardSummary: true, heardSummaryId: 'revision-1', args: {}, spoke: true });
    assert.equal(state.providerEvents.filter((event) => event.item?.type === 'function_call_output').some((event) => event.item.call_id === body.toolCallId), false);
    await finishGoodbye(state, connection);
  } finally { await state.close(); }
});

test('a spoken save ends the same way: goodbye played, then the stream closes', async () => {
  const state = await fixture({ toolResult: (body) => body.name === 'confirm_report'
    ? { output: '{"status":"saved"}', awaitingConfirmation: false, end: 'hangup', goodbye: SAVED_GOODBYE }
    : keypadResult({ name: 'other' }) });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'to-summary');
    await playPrompt(state, connection, 'Mock summary');
    await workerTool(state, 'spoken-save', 'confirm_report', 'إيه', { confirmed: true });
    await finishGoodbye(state, connection);
  } finally { await state.close(); }
});

for (const scenario of [
  { name: 'key 1 before the summary is heard', digit: '1', summary: false },
  { name: 'key 1 while the summary is still playing', digit: '1', summary: true, acknowledge: false },
  { name: 'another key after the summary', digit: '2', summary: true },
  { name: 'star after the summary', digit: '*', summary: true },
]) {
  test(`${scenario.name} is ignored and keeps the stream`, async () => {
    const state = await fixture({ toolResult: keypadResult });
    try {
      const connection = await state.connect();
      await state.ready(connection.socket);
      await playPrompt(state, connection);
      if (scenario.summary) {
        await workerTool(state, 'to-summary');
        await playPrompt(state, connection, 'Mock summary', scenario.acknowledge !== false);
      }
      dtmf(connection.socket, scenario.digit);
      await delay(30);
      assert.equal(state.requests.some((request) => request.body?.name === 'keypad_confirm'), false);
      assert.equal(connection.socket.readyState, WebSocket.OPEN);
      assert.ok(!state.logs.some((record) => /invalid|fail/i.test(record.event)));
    } finally { await state.close(); }
  });
}

for (const repromptText of [null, 1, false, {}]) {
  test(`session rejects non-string repromptText: ${JSON.stringify(repromptText)}`, async () => {
    const state = await fixture({ session: { repromptText } });
    try {
      const { socket } = await state.connect();
      start(socket);
      await closed(socket);
      assert.deepEqual(state.providerEvents, []);
      assert.ok(state.logs.some((record) => record.event === 'session_failed'));
    } finally { await state.close(); }
  });
}

test('ordinary HTTP streams unchanged method, URL, body and duplicate headers', async () => {
  const state = await fixture();
  try {
    const body = 'streamed-request-body';
    const result = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1', port: 3903, agent: false, method: 'PATCH', path: '/passthrough?original=%2Fyes',
        headers: [
          'Host', 'public.example.test', 'Content-Type', 'text/plain', 'Content-Length', String(Buffer.byteLength(body)),
          'X-Original', 'first', 'X-Original', 'second', 'X-Twilio-Signature', 'opaque-signed-value',
        ],
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, statusMessage: response.statusMessage,
          headers: response.headers, body: Buffer.concat(chunks).toString() }));
      });
      request.on('error', reject);
      request.write(body.slice(0, 5));
      request.end(body.slice(5));
    });
    assert.equal(result.status, 207);
    assert.equal(result.statusMessage, 'Mock response');
    assert.equal(result.body, body);
    assert.deepEqual(result.headers['set-cookie'], ['first=1', 'second=2']);
    assert.equal(result.headers['x-mock-result'], 'passed');
    assert.equal(state.requests[0].method, 'PATCH');
    assert.equal(state.requests[0].url, '/passthrough?original=%2Fyes');
    assert.equal(state.requests[0].headers.host, 'public.example.test');
    assert.equal(state.requests[0].headers['x-twilio-signature'], 'opaque-signed-value');
    assert.equal(state.requests[0].rawBody, body);
    const originals = state.requests[0].rawHeaders.filter((value) => value === 'X-Original');
    assert.equal(originals.length, 2);
  } finally { await state.close(); }
});

test('HTTP proxy forwards trailers and response bytes before the request body ends', async () => {
  let requestTrailers;
  const state = await fixture({ streaming(request, response) {
    response.writeHead(200, { 'content-type': 'text/plain', trailer: 'X-Upstream-Trailer' });
    response.write('early-response');
    request.on('data', (chunk) => response.write(chunk));
    request.on('end', () => {
      requestTrailers = request.rawTrailers;
      response.addTrailers({ 'X-Upstream-Trailer': 'upstream-finished' });
      response.end();
    });
  } });
  try {
    const result = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1', port: 3903, agent: false, path: '/stream', method: 'POST',
        headers: { 'transfer-encoding': 'chunked', trailer: 'X-Client-Trailer' },
      }, (response) => {
        const chunks = [];
        let requestEnded = false;
        response.on('data', (chunk) => {
          chunks.push(chunk);
          if (!requestEnded) {
            requestEnded = true;
            request.addTrailers({ 'X-Client-Trailer': 'client-finished' });
            request.end('second-half');
          }
        });
        response.on('end', () => resolve({ body: Buffer.concat(chunks).toString(), trailers: response.rawTrailers }));
      });
      request.on('error', reject);
      request.write('first-half');
    });
    assert.equal(result.body, 'early-responsefirst-halfsecond-half');
    assert.deepEqual(requestTrailers, ['X-Client-Trailer', 'client-finished']);
    assert.deepEqual(result.trailers, ['X-Upstream-Trailer', 'upstream-finished']);
  } finally { await state.close(); }
});

test('natural style: auto tools, the model answers in its own words, and a continue result lets it carry on', async () => {
  const state = await fixture({
    session: { style: 'natural' },
    toolResult: { output: '{"status":"invalid","questions":["water_level"]}', awaitingConfirmation: false, end: null, goodbye: null, continue: true },
  });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    const update = state.providerEvents.find((event) => event.type === 'session.update').session;
    assert.equal(update.tool_choice, 'auto');
    await playPrompt(state, connection);
    await workerTool(state, 'hand-over', 'submit_report', 'Mock worker words', { answers: [] });
    await waitFor(() => state.providerEvents.filter((event) => event.type === 'response.create').length >= 3);
    const free = state.providerEvents.filter((event) => event.type === 'response.create').at(-1).response;
    // No words of the server's: the model says it for itself.
    assert.deepEqual(free, { output_modalities: ['audio'] });
    assert.ok(state.logs.some((record) => record.event === 'response_requested' && record.kind === 'turn'));
  } finally { await state.close(); }
});

test('natural style: the summary is still spoken word for word, and a key press never confirms it', async () => {
  const state = await fixture({ session: { style: 'natural' }, toolResult: keypadResult });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'to-summary', 'submit_report', 'Mock worker words', { answers: [] });
    const summary = state.providerEvents.filter((event) => event.type === 'response.create').at(-1).response;
    assert.match(summary.instructions, /^Say only the following text verbatim, with no additions: "Mock summary"/);
    await playPrompt(state, connection, 'Mock summary');
    dtmf(connection.socket, '1');
    await delay(50);
    assert.equal(state.requests.some((request) => request.body?.name === 'keypad_confirm'), false);
  } finally { await state.close(); }
});

test('a continue result is refused outside the natural style', async () => {
  const state = await fixture({ toolResult: { output: '{}', awaitingConfirmation: false, end: null, goodbye: null, continue: true } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 0 });
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'c1' });
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'c1', content_index: 0, transcript: 'x' });
    await waitFor(() => state.responseId);
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'c1', name: 'answer_question', arguments: '{}' });
    state.complete();
    await closed(connection.socket);
  } finally { await state.close(); }
});

test('lines are traced to a file only when the local trace directory is set', async () => {
  const { mkdtempSync, readdirSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'naqah-trace-'));
  const state = await fixture({ config: { traceDir: directory } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection, 'Mock opening');
    await workerTool(state, 'traced', 'answer_question', 'كلها بخير');
    const files = readdirSync(directory);
    assert.equal(files.length, 1);
    const lines = readFileSync(join(directory, files[0]), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => [line.who, line.text]), [['naqah', 'Mock opening'], ['worker', 'كلها بخير']]);
  } finally { await state.close(); rmSync(directory, { recursive: true, force: true }); }
});

async function preflight(options) {
  const models = async () => new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 });
  const state = await fixture({ ...options, fetchImpl: models });
  try {
    const body = '{"preflight":true}';
    const response = await fetch('http://127.0.0.1:3903/voice-bridge/preflight', { method: 'POST', body, headers: internalHeaders(body, TEST_ENV.NAQAH_VOICE_SECRET) });
    return { status: response.status, json: await response.json(), events: state.providerEvents };
  } finally { await state.close(); }
}

test('preflight opens a realtime session and asks for nothing, so it costs nothing', async () => {
  const result = await preflight({});
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { openaiKeyValid: true, realtimeReady: true, realtimeError: null });
  assert.equal(result.events.some((event) => event.type === 'response.create'), false);
});

test('preflight reports an account with no credit left, which listing models cannot show', async () => {
  const result = await preflight({ sessionError: { type: 'insufficient_quota', code: 'credit_balance_exhausted', message: 'secret detail' } });
  assert.deepEqual(result.json, { openaiKeyValid: true, realtimeReady: false, realtimeError: 'credit_balance_exhausted' });
});

/** The 11 Nov call: the whole summary played, the worker answered at once, and VAD dated the speech 300 ms early. */
async function answerRightAfterSummary(style, markAfterSpeech = false) {
  const state = await fixture({ session: style ? { style } : {}, toolResult: (body) => body.name === 'confirm_report'
    ? { output: '{"status":"saved"}', awaitingConfirmation: false, end: 'hangup', goodbye: SAVED_GOODBYE }
    : { output: '{}', awaitingConfirmation: true, end: null, goodbye: null, summaryText: 'Mock summary', summaryId: 'revision-1' } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'to-summary', style ? 'submit_report' : 'answer_question');
    for (let frame = 0; frame < 50; frame += 1) media(connection.socket); // 1 s of caller line while the summary plays
    await delay(20);
    const offset = connection.messages.received.length;
    const itemId = `audio-${state.responseId}`;
    state.audio(160, itemId);
    send(state.provider, { type: 'response.output_audio.done', item_id: itemId, content_index: 0 });
    send(state.provider, { type: 'response.output_audio_transcript.done', response_id: state.responseId, item_id: itemId, content_index: 0, transcript: 'Mock summary' });
    state.complete();
    await waitFor(() => connection.messages.received.slice(offset).some((event) => event.mark?.name.startsWith('summary-')));
    const marks = connection.messages.received.slice(offset).filter((event) => event.event === 'mark');
    const ack = () => { for (const event of marks) send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: event.mark }); };
    const audioMarks = marks.filter((event) => !event.mark.name.startsWith('summary-'));
    for (const event of audioMarks) send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: event.mark });
    if (!markAfterSpeech) { ack(); await delay(15); }
    send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 1000 - 300 });
    if (markAfterSpeech) { await delay(5); ack(); await delay(15); }
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'yes' });
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'yes', content_index: 0, transcript: 'إيه احفظه' });
    await delay(15);
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'yes-confirm', name: 'confirm_report', arguments: '{"confirmed":true}' });
    await waitFor(() => state.requests.some((request) => request.body?.toolCallId === 'yes-confirm'));
    const body = state.requests.find((request) => request.body?.toolCallId === 'yes-confirm').body;
    return { heard: body.heardSummary, id: body.heardSummaryId };
  } finally { await state.close(); }
}

test('natural: an answer the instant the summary ends has heard it', async () => {
  assert.deepEqual(await answerRightAfterSummary('natural'), { heard: true, id: 'revision-1' });
});

test('natural: so has one whose playback mark arrives just after the worker starts speaking', async () => {
  assert.deepEqual(await answerRightAfterSummary('natural', true), { heard: true, id: 'revision-1' });
});

test('the guided call keeps its strict rule for the same timing', async () => {
  assert.deepEqual(await answerRightAfterSummary(undefined), { heard: false, id: undefined });
});

/** A natural call at a summary the worker has heard in full, ready for their yes. */
async function heardNaturalSummary(options = {}) {
  const state = await fixture({ session: { style: 'natural' }, ...options, toolResult: (body) => body.name === 'confirm_report'
    ? { output: '{"status":"saved"}', awaitingConfirmation: false, end: 'hangup', goodbye: SAVED_GOODBYE }
    : { output: '{}', awaitingConfirmation: true, end: null, goodbye: null, summaryText: 'Mock summary', summaryId: 'revision-1' } });
  const connection = await state.connect();
  await state.ready(connection.socket);
  await playPrompt(state, connection);
  await workerTool(state, 'to-summary', 'submit_report');
  for (let frame = 0; frame < 50; frame += 1) media(connection.socket);
  await delay(20);
  const offset = connection.messages.received.length;
  const itemId = `audio-${state.responseId}`;
  state.audio(160, itemId);
  send(state.provider, { type: 'response.output_audio.done', item_id: itemId, content_index: 0 });
  send(state.provider, { type: 'response.output_audio_transcript.done', response_id: state.responseId, item_id: itemId, content_index: 0, transcript: 'Mock summary' });
  state.complete();
  await waitFor(() => connection.messages.received.slice(offset).some((event) => event.mark?.name.startsWith('summary-')));
  for (const event of connection.messages.received.slice(offset).filter((event) => event.event === 'mark')) send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: event.mark });
  await delay(15);
  return { state, connection };
}

/**
 * Call 050ac3: the worker said «أحفظ», and said it again while the model's confirm_report waited on the first
 * transcript. The tool still belongs to the first yes: its words, its spoke flag and its heard summary go with it.
 */
async function yesThenMore(second, { stops = true, laterSpeechMs } = {}) {
  const { state } = await heardNaturalSummary({ limits: { transcriptionMs: 500, ...(laterSpeechMs ? { laterSpeechMs } : {}) } });
  try {
    send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 1500 });
    send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'yes-1' });
    await delay(10);
    // The model hears audio, not text: it confirms before the transcript arrives.
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'confirm-1', name: 'confirm_report', arguments: '{"confirmed":true}' });
    state.complete();
    await delay(10);
    if (second !== undefined) send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 2600 });
    await delay(10);
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'yes-1', content_index: 0, transcript: 'أحفظ' });
    if (second !== undefined && stops) {
      await delay(10);
      send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
      send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'yes-2' });
      await delay(10);
      assert.equal(state.requests.some((request) => request.body?.toolCallId === 'confirm-1'), false, 'waits for the second words');
      send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'yes-2', content_index: 0, transcript: second });
    }
    await waitFor(() => state.requests.some((request) => request.body?.toolCallId === 'confirm-1'));
    const body = state.requests.find((request) => request.body?.toolCallId === 'confirm-1').body;
    return { utterance: body.workerUtterance, spoke: body.userSpokeSinceLastTool, heardSummaryId: body.heardSummaryId };
  } finally { await state.close(); }
}

test('natural: one yes reaches the server with its words and the heard summary', async () => {
  assert.deepEqual(await yesThenMore(undefined), { utterance: 'أحفظ', spoke: true, heardSummaryId: 'revision-1' });
});

test('natural: a second «احفظ» before the tool runs keeps the first yes and is sent with it', async () => {
  assert.deepEqual(await yesThenMore('احفظ'), { utterance: 'أحفظ احفظ', spoke: true, heardSummaryId: 'revision-1' });
});

test('natural: a second thought after the yes goes with it, so the server can refuse the save', async () => {
  assert.deepEqual(await yesThenMore('لا لحظة'), { utterance: 'أحفظ لا لحظة', spoke: true, heardSummaryId: 'revision-1' });
});

test('natural: words still being said when the wait ends are never taken as a yes', async () => {
  assert.deepEqual(await yesThenMore('…', { stops: false, laterSpeechMs: 60 }), { utterance: 'أحفظ', spoke: false, heardSummaryId: 'revision-1' });
});

test('natural: every tool request carries the worker\'s transcripts so far, in order and within limits', async () => {
  const state = await fixture({ session: { style: 'natural' }, toolResult: { output: '{}', awaitingConfirmation: false, end: null, goodbye: null, continue: true } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    // The model answers each continue result in its own words before the worker speaks again.
    const turn = async (id, words) => {
      const body = await workerTool(state, id, 'submit_report', words);
      state.complete();
      await delay(5);
      return body;
    };
    const first = await turn('turn-1', 'الحلال بخير');
    assert.deepEqual(first.workerTranscripts, ['الحلال بخير']);
    assert.equal(first.workerUtterance, 'الحلال بخير');
    const second = await turn('turn-2', 'العلف خمسين كيس');
    assert.deepEqual(second.workerTranscripts, ['الحلال بخير', 'العلف خمسين كيس']);
    for (let index = 3; index <= 45; index += 1) await turn(`turn-${index}`, `جواب ${index}`);
    const many = state.requests.find((request) => request.body?.toolCallId === 'turn-45').body.workerTranscripts;
    assert.equal(many.length, 40);
    assert.equal(many[0], 'جواب 6');
    assert.equal(many.at(-1), 'جواب 45');
    const long = 'ع'.repeat(1000);
    for (let index = 0; index < 5; index += 1) await turn(`long-${index}`, long);
    const capped = state.requests.find((request) => request.body?.toolCallId === 'long-4').body.workerTranscripts;
    assert.deepEqual(capped, [long, long, long]);
    assert.ok(Buffer.byteLength(JSON.stringify(state.requests.find((request) => request.body?.toolCallId === 'long-4').body)) < 16 * 1024);
  } finally { await state.close(); }
});

test('the guided call sends no transcript history', async () => {
  const state = await fixture();
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    assert.equal('workerTranscripts' in await workerTool(state, 'guided-1'), false);
  } finally { await state.close(); }
});

const SPLIT_SUMMARY = 'هذا ملخص التحديث: الحلال كله بخير، العلف: 50 كيس. أحفظه، ولا تبي تعدل شي؟';
const SPLIT_FACTS = 'هذا ملخص التحديث: الحلال كله بخير، العلف: 50 كيس.';

/** Calls 050ac3 and 4f6a40: the worker answered over «أحفظه، ولا تبي تعدل شي؟», after every fact had played. */
/** 12 Nov: a natural summary now ends on a plain «أحفظه؟». */
const SHORT_SUMMARY = 'هذا اللي فهمته: الحلال كله بخير، العلف 50 كيس، والمهمة خلصت. أحفظه؟';
const SHORT_FACTS = 'هذا اللي فهمته: الحلال كله بخير، العلف 50 كيس، والمهمة خلصت.';

async function answerOverClosing(style, { cutFacts = false, summary = SPLIT_SUMMARY, facts = SPLIT_FACTS, closing = /تبي تعدل/ } = {}) {
  const state = await fixture({ session: style ? { style } : {}, limits: { transcriptionMs: 500 }, toolResult: (body) => body.name === 'confirm_report'
    ? { output: '{"status":"saved"}', awaitingConfirmation: false, end: 'hangup', goodbye: SAVED_GOODBYE }
    : { output: '{}', awaitingConfirmation: true, end: null, goodbye: null, summaryText: summary, summaryId: 'revision-1', repromptText: 'أحفظه؟' } });
  try {
    const connection = await state.connect();
    await state.ready(connection.socket);
    await playPrompt(state, connection);
    await workerTool(state, 'to-summary', style ? 'submit_report' : 'answer_question');
    const factsRequest = await state.providerInbox.wait((event) => event.type === 'response.create' && /الحلال كله بخير/.test(event.response.instructions || ''));
    for (let frame = 0; frame < 50; frame += 1) media(connection.socket);
    await delay(20);
    const offset = connection.messages.received.length;
    const factsId = state.responseId;
    state.audio(160, 'facts');
    send(state.provider, { type: 'response.output_audio.done', item_id: 'facts', content_index: 0 });
    if (cutFacts) {
      // The worker talks over the facts themselves: nothing was heard, and the question is never asked.
      send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 600 });
      await connection.messages.wait((event) => event.event === 'clear');
      send(state.provider, { type: 'response.done', response: { id: factsId, status: 'cancelled' } });
    } else {
      send(state.provider, { type: 'response.output_audio_transcript.done', response_id: factsId, item_id: 'facts', content_index: 0, transcript: style ? facts : summary });
      state.complete();
      await waitFor(() => connection.messages.received.slice(offset).some((event) => event.mark?.name.startsWith('summary-')));
      for (const event of connection.messages.received.slice(offset).filter((event) => event.event === 'mark')) send(connection.socket, { event: 'mark', streamSid: STREAM_SID, mark: event.mark });
      await delay(15);
    }
    const closingRequest = state.providerEvents.find((event) => event.type === 'response.create' && closing.test(event.response.instructions || '') && !/الحلال كله بخير/.test(event.response.instructions));
    if (style && !cutFacts) {
      // The question plays; the worker answers over it.
      assert.ok(closingRequest);
      state.audio(160, 'closing');
      send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 1300 });
      await connection.messages.wait((event) => event.event === 'clear');
      send(state.provider, { type: 'response.done', response: { id: state.responseId, status: 'cancelled' } });
    } else if (!cutFacts) {
      send(state.provider, { type: 'input_audio_buffer.speech_started', audio_start_ms: 1300 });
    }
    send(state.provider, { type: 'input_audio_buffer.speech_stopped' });
    send(state.provider, { type: 'input_audio_buffer.committed', item_id: 'yes' });
    send(state.provider, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'yes', content_index: 0, transcript: 'إيه احفظه' });
    await delay(15);
    send(state.provider, { type: 'response.function_call_arguments.done', call_id: 'yes-confirm', name: 'confirm_report', arguments: '{"confirmed":true}' });
    await waitFor(() => state.requests.some((request) => request.body?.toolCallId === 'yes-confirm'));
    const body = state.requests.find((request) => request.body?.toolCallId === 'yes-confirm').body;
    return {
      factsOnly: !closing.test(factsRequest.response.instructions), closingAsked: Boolean(closingRequest),
      heard: body.heardSummary, id: body.heardSummaryId,
    };
  } finally { await state.close(); }
}

test('natural: the summary\'s question is spoken after its facts, and an answer over the question has heard them', async () => {
  assert.deepEqual(await answerOverClosing('natural'), { factsOnly: true, closingAsked: true, heard: true, id: 'revision-1' });
});

test('natural: the short summary\'s plain «أحفظه؟» is spoken after its facts, and an answer over it has heard them', async () => {
  assert.deepEqual(await answerOverClosing('natural', { summary: SHORT_SUMMARY, facts: SHORT_FACTS, closing: /أحفظه؟/ }), { factsOnly: true, closingAsked: true, heard: true, id: 'revision-1' });
});

test('natural: talking over the facts still means the summary was not heard, and its question is dropped', async () => {
  assert.deepEqual(await answerOverClosing('natural', { cutFacts: true }), { factsOnly: true, closingAsked: false, heard: false, id: undefined });
});

test('the guided call still speaks its summary as one line', async () => {
  const result = await answerOverClosing(undefined);
  assert.equal(result.factsOnly, false);
  assert.equal(result.closingAsked, false);
});
