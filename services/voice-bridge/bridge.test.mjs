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
        opening: 'Mock opening', locale: 'en', maxSeconds: options.maxSeconds || 120,
      }));
    } else if (request.url === '/api/voice/realtime/tool') {
      if (options.toolDelay) await delay(options.toolDelay);
      response.writeHead(options.toolStatus || 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(options.toolResult || { output: '{"ok":true}', awaitingConfirmation: false, end: null, goodbye: null }));
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
      if (event.type === 'session.update' && !options.noReady) send(socket, { type: 'session.updated', session: event.session });
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
    config: loadConfig(TEST_ENV), logger: (record) => logs.push(record),
    limits: { closeMs: 10, ...options.limits },
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
    assert.deepEqual(await response.json(), { ok: true });
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

test('refused ticket closes Twilio without connecting to the provider', async () => {
  const state = await fixture({ sessionStatus: 403 });
  try {
    const { socket } = await state.connect();
    start(socket);
    await closed(socket);
    assert.equal(state.requests[0].url, '/api/voice/realtime/session');
    assert.deepEqual(state.requests[0].body, { ticket: 'mock-ticket', callSid: CALL_SID });
    assert.equal(state.provider, undefined);
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
    assert.equal(update.session.audio.input.format.type, 'audio/pcmu');
    assert.equal(update.session.audio.output.format.type, 'audio/pcmu');
    assert.equal(update.session.audio.input.turn_detection.type, 'server_vad');
    assert.equal(update.session.audio.input.turn_detection.interrupt_response, false);
    assert.equal(state.providerAuth, 'Bearer mock-key-never-paid');
    const opening = state.providerEvents.find((event) => event.type === 'response.create');
    assert.match(opening.response.instructions, /Mock opening/);
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
  const state = await fixture({ toolResult: { output: '{"summary":true}', awaitingConfirmation: true, end: null, goodbye: null } });
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
      args: { value: 'yes' }, userSpokeSinceLastTool: true,
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
    assert.equal(state.requests.length, 1);
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

test('silence, call duration and message size limits close the stream', async () => {
  for (const limit of ['silence', 'duration', 'size', 'invalid-start']) {
    const state = await fixture({
      maxSeconds: limit === 'duration' ? 0.06 : 120,
      limits: { silenceMs: limit === 'silence' ? 60 : 45_000 },
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
