/**
 * LOCAL TEST ONLY. Plays both paid sides of a manual "Test AI Call" on one loopback port:
 *
 *   POST /__test/twilio/…/Calls.json   Twilio's REST API, reached through supabase/local-validation/mock-outbound.mjs
 *   ws   /v1/realtime                  the OpenAI Realtime socket (scripts/mocks/realtime-provider.mjs)
 *
 * An accepted call then runs like a real one: signed status callbacks, the signed TwiML fetch, a Media Stream to the
 * real bridge, a scripted model answering every question, the read-back and confirmation, then `completed`. Everything
 * observed is kept as evidence for scripts/verify-test-call.mjs.
 *
 *   GET  /__test/state     { requests, calls, control }
 *   POST /__test/control   { outcome?: "full" | "no-answer" | "hold", twilioError?: number | null, dwellMs?: number, reset?: true }
 *   POST /__test/release   { status?: "completed" | "no-answer" }  ends the call being held
 *
 * This proves wiring. A scripted model and a fake phone network say nothing about real Arabic quality or carriers.
 */
import { createHmac, randomBytes } from "node:crypto";
import { startMockRealtime } from "./realtime-provider.mjs";
import { connectStream, FRAME_BYTES, VOICED } from "./twilio-media.mjs";

export const FAKE_ACCOUNT_SID = `AC${"0".repeat(32)}`;
export const FAKE_AUTH_TOKEN = "local-test-auth-token";

/** The byte realtime-provider.mjs fills model audio with, to prove that exact audio reached the caller. */
const PROVIDER_AUDIO_BYTE = 0x55;
const CALLER_FRAMES = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (text) => text.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");

export function parseConnect(xml) {
  const action = xml.match(/<Connect\b[^>]*\baction="([^"]+)"/)?.[1];
  const url = xml.match(/<Stream\b[^>]*\burl="([^"]+)"/)?.[1];
  const ticket = xml.match(/<Parameter\b[^>]*\bname="ticket"[^>]*\bvalue="([^"]+)"/)?.[1];
  return action && url && ticket ? { action: decode(action), url: decode(url), ticket: decode(ticket) } : null;
}

export function twilioSignature(url, fields, token = FAKE_AUTH_TOKEN) {
  let value = url;
  for (const key of Object.keys(fields).sort()) value += key + fields[key];
  return createHmac("sha1", token).update(value, "utf8").digest("base64");
}

/** What a worker says at each step of the call, with the structured answer a good model would extract from it. */
const ANSWER_PLAN = [
  { when: (s) => s.step === "report_question" && s.q?.startsWith("herd_health"), say: "والله كلها بخير الحمد لله يا طويل العمر", args: { value: "yes" } },
  { when: (s) => s.step === "report_question" && s.q === "herd_count", say: "عشرين راس تقريبا", args: { text: "20" } },
  { when: (s) => s.step === "herd_count_confirm", say: "ايه صح عشرين", args: { value: "yes" } },
  { when: (s) => s.step === "report_question" && s.q === "feed_level", say: "العلف باقي منه شوي", args: { value: "low" } },
  { when: (s) => s.step === "quantity_input" && s.q === "feed_level", say: "خمسة وعشرين كيس", args: { text: "25" } },
  { when: (s) => s.step === "quantity_confirm", say: "ايه تمام", args: { value: "yes" } },
  { when: (s) => s.step === "report_question" && s.q === "water_level", say: "الموية كافية ما عليها", args: { value: "good" } },
  { when: (s) => s.step === "quantity_input" && s.q === "water_level", say: "حوالي ميه لتر", args: { text: "100" } },
  { when: (s) => s.step === "report_question" && s.q === "fences_condition", say: "السياج سليم ما فيه شي", args: { value: "good" } },
  { when: (s) => s.step === "report_question" && /^[0-9a-f-]{36}$/.test(s.q ?? ""), say: "لا والله ما جا أحد اليوم", args: { text: "لا ما جا" } },
];

const CONFIRMATION = "إيه احفظه";

/**
 * `sql` runs a query on the disposable local database. The scripted model reads the engine's position from it, where a
 * real model would rely on the tool output, so a wording change can't silently derail the script.
 */
export async function startTestCallMock({ port, appOrigin, publicBase, bridgePort, sql }) {
  const requests = [];
  const calls = [];
  const control = { outcome: "full", twilioError: null, dwellMs: 1500 };
  let held = null;
  let provider = null;

  const expectedAuth = `Basic ${Buffer.from(`${FAKE_ACCOUNT_SID}:${FAKE_AUTH_TOKEN}`).toString("base64")}`;
  const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

  const engineState = (sid) => {
    const raw = sql(`select session::text from voice_call_sessions where call_sid = ${q(sid)}`);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return { step: session.step, q: session.data?.currentQuestionId, data: session.data, done: session.done };
  };
  const farmOfCall = (sid) => sql(`select farm_id from voice_call_sessions where call_sid = ${q(sid)}`);
  const reportCount = (farm) => Number(sql(`select count(*) from reports where farm_id = ${q(farm)}`));

  const fieldsFor = (call, extra) => ({
    AccountSid: FAKE_ACCOUNT_SID, ApiVersion: "2010-04-01", CallSid: call.sid, CallStatus: "in-progress",
    Called: call.to, Caller: call.from, Direction: "outbound-api", From: call.from, To: call.to, ...extra,
  });

  /** Every webhook is signed over the public URL Twilio would have used, then delivered to local Next. */
  async function webhook(target, fields) {
    const publicUrl = new URL(target, publicBase).toString();
    const parsed = new URL(publicUrl);
    const response = await fetch(`${appOrigin}${parsed.pathname}${parsed.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSignature(publicUrl, fields) },
      body: new URLSearchParams(fields),
    });
    return { status: response.status, xml: await response.text() };
  }

  /** Twilio only sends the progress events a call subscribed to. `in-progress` is the `answered` event. */
  async function sendStatus(call, status, extra = {}) {
    const event = status === "in-progress" ? "answered" : status;
    const final = !["initiated", "ringing", "in-progress"].includes(status);
    if (!final && !call.requestedEvents.includes(event)) {
      call.statuses.push({ status, skipped: "not subscribed" });
      return;
    }
    const { status: http } = await webhook(call.statusCallback, fieldsFor(call, {
      CallStatus: status, SequenceNumber: String(call.statuses.length), CallbackSource: "call-progress-events",
      Timestamp: new Date().toUTCString(), ...extra,
    }));
    call.statuses.push({ status, http, at: Date.now() });
  }

  async function runConversation(call) {
    const answered = await webhook(call.url, fieldsFor(call));
    const connect = parseConnect(answered.xml);
    call.twiml = { http: answered.status, streamUrl: connect?.url ?? null, afterUrl: connect?.action ?? null, hasTicket: Boolean(connect?.ticket), excerpt: connect ? undefined : answered.xml.slice(0, 400) };
    if (!connect) throw new Error("The answer TwiML has no <Connect><Stream>");

    const opened = await connectStream({
      bridgeUrl: `ws://127.0.0.1:${bridgePort}${new URL(connect.url).pathname}`, publicUrl: connect.url, authToken: FAKE_AUTH_TOKEN,
      callSid: call.sid, accountSid: FAKE_ACCOUNT_SID, ticket: connect.ticket,
    });
    if (!opened.stream) throw new Error(`The bridge refused the stream: ${opened.refused}`);
    const stream = opened.stream;
    stream.connected();
    stream.start();

    const upstream = await provider.next();
    call.provider.bearerIsMockKey = /^Bearer \S+/.test(upstream.headers.authorization ?? "");
    const update = await upstream.waitForEvent((event) => event.type === "session.update", 20_000, "session.update");
    call.provider.sessionUpdate = update.session;
    const openingCreate = await upstream.waitForEvent((event) => event.type === "response.create" && typeof event.response?.instructions === "string", 10_000, "opening line");
    call.provider.openingToolChoice = openingCreate.response?.tool_choice ?? null;
    await waitUntil(() => upstream.spoken.length >= 1 && stream.sent("media").length >= 1, "opening played");
    call.provider.opening = upstream.spoken[0];

    for (let frame = 0; frame < CALLER_FRAMES; frame += 1) stream.media(VOICED);
    await waitUntil(() => upstream.audioIn.length >= CALLER_FRAMES, "caller audio at the provider");

    const farm = farmOfCall(call.sid);
    call.farm = farm;
    const first = engineState(call.sid);
    call.queue = (first?.data?.queue ?? []).map((item) => item.id ?? item.questionId ?? item.kind);

    let lastOutput = null;
    for (let turn = 0; turn < 30; turn += 1) {
      const state = engineState(call.sid);
      if (!state) throw new Error("The voice session row disappeared mid-call");
      if (state.step === "report_summary") break;
      const plan = ANSWER_PLAN.find((entry) => entry.when(state));
      if (!plan) throw new Error(`The scripted worker has no answer for ${state.step}/${state.q}`);
      call.questions.push({ step: state.step, q: state.q });
      upstream.workerSays(plan.say);
      const output = await upstream.toolCall("answer_question", plan.args);
      if (output === null) throw new Error(`No tool output at ${state.step}/${state.q}`);
      lastOutput = output;
      call.toolResults.push({ name: "answer_question", output });
      const next = engineState(call.sid);
      if (next && next.step !== "report_summary") await upstream.speak(JSON.parse(output).question ?? "السؤال التالي");
    }
    if (engineState(call.sid)?.step !== "report_summary") throw new Error("The call never reached the summary");

    const parsed = JSON.parse(lastOutput ?? "{}");
    call.summary = { text: parsed.summary ?? null, flagged: parsed.isSummary === true };
    await waitUntil(() => stream.sent("mark").some((event) => event.mark?.name?.startsWith("summary-")), "summary playback boundary", 20_000);
    await sleep(100);
    call.summary.readInFull = upstream.spoken.includes(call.summary.text);
    call.reportsBeforeConfirm = reportCount(farm);

    upstream.workerSays(CONFIRMATION);
    const confirmed = await upstream.toolCall("confirm_report", { confirmed: true });
    call.toolResults.push({ name: "confirm_report", output: confirmed });
    call.confirm = { output: confirmed === null ? null : JSON.parse(confirmed) };

    const closed = await stream.waitClosed(20_000);
    call.streamClosed = closed !== null;
    call.provider.spoken = [...upstream.spoken];
    call.provider.responseCreates = upstream.of("response.create").length;
    call.provider.toolChoices = upstream.of("response.create").map((event) => event.response?.tool_choice ?? null);
    call.audio = {
      callerFramesSent: CALLER_FRAMES,
      callerFramesAtProvider: upstream.audioIn.filter((event) => event.audio === VOICED).length,
      callerBytesPerFrame: FRAME_BYTES,
      providerFramesAtCaller: stream.sent("media").length,
      providerBytesIntact: stream.sent("media").every((event) => Buffer.from(event.media.payload, "base64").every((byte) => byte === PROVIDER_AUDIO_BYTE)),
      streamSidMatched: stream.sent("media").every((event) => event.streamSid === stream.streamSid),
    };
    call.reportsAfterConfirm = reportCount(farm);

    const after = await webhook(connect.action, fieldsFor(call));
    call.after = { http: after.status, hangup: /<Hangup/.test(after.xml), speaks: /<Say|<Gather/.test(after.xml) };
    await sendStatus(call, "completed", { CallDuration: "42" });
    call.finished = true;
  }

  function waitUntil(probe, label, timeoutMs = 10_000) {
    return (async () => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (probe()) return;
        await sleep(40);
      }
      throw new Error(`Timed out waiting for ${label}`);
    })();
  }

  async function runLifecycle(call) {
    try {
      await sendStatus(call, "initiated");
      await sleep(control.dwellMs);
      if (call.outcome === "hold") {
        // Registered before `ringing` is sent, so a release can never arrive while nothing is held.
        const released = new Promise((resolve) => { held = resolve; });
        await sendStatus(call, "ringing");
        const status = await released;
        held = null;
        await sendStatus(call, status, { CallDuration: "0" });
        call.finished = true;
        return;
      }
      await sendStatus(call, "ringing");
      await sleep(control.dwellMs);
      if (call.outcome === "no-answer") {
        await sendStatus(call, "no-answer", { CallDuration: "0" });
        call.finished = true;
        return;
      }
      await sendStatus(call, "in-progress");
      await sleep(control.dwellMs);
      await runConversation(call);
    } catch (error) {
      call.error = error.message;
      console.error(`[test-call-mock] call ${call.sid.slice(-6)} failed: ${error.message}`);
      try { await sendStatus(call, "completed", { CallDuration: "1" }); } catch { /* Next is gone */ }
      call.finished = true;
    }
  }

  async function readBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  const sendJson = (response, status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  async function onTwilio(request, response) {
    if (request.headers.authorization !== expectedAuth) return sendJson(response, 403, { message: "Fake credentials only" });
    const form = new URLSearchParams(await readBody(request));
    const fields = Object.fromEntries(form);
    const record = { To: fields.To, From: fields.From, Url: fields.Url, StatusCallback: fields.StatusCallback, Record: fields.Record, Timeout: fields.Timeout, at: Date.now() };
    requests.push(record);
    if (control.twilioError !== null) {
      record.rejected = control.twilioError;
      return sendJson(response, 400, { code: control.twilioError, message: `Mock Twilio error ${control.twilioError}`, status: 400 });
    }
    const sid = `CA${randomBytes(16).toString("hex")}`;
    record.sid = sid;
    const call = {
      sid, to: fields.To, from: fields.From, url: fields.Url, statusCallback: fields.StatusCallback, record: fields.Record,
      requestedEvents: form.getAll("StatusCallbackEvent"), outcome: control.outcome, statuses: [], questions: [], toolResults: [],
      provider: {}, finished: false,
    };
    calls.push(call);
    sendJson(response, 201, { sid, status: "queued" });
    setImmediate(() => runLifecycle(call));
    return undefined;
  }

  async function onRequest(request, response) {
    try {
      const url = new URL(request.url, "http://mock.local");
      if (request.method === "POST" && /^\/__test\/twilio\/2010-04-01\/Accounts\/[^/]+\/Calls\.json$/.test(url.pathname)) return await onTwilio(request, response);
      if (url.pathname === "/__test/state" && request.method === "GET") return sendJson(response, 200, { requests, calls, control });
      if (url.pathname === "/__test/control" && request.method === "POST") {
        const input = JSON.parse((await readBody(request)) || "{}");
        if (input.reset) { requests.length = 0; calls.length = 0; }
        if (input.outcome !== undefined) control.outcome = input.outcome;
        if (input.twilioError !== undefined) control.twilioError = input.twilioError;
        if (input.dwellMs !== undefined) control.dwellMs = input.dwellMs;
        return sendJson(response, 200, control);
      }
      if (url.pathname === "/__test/release" && request.method === "POST") {
        const input = JSON.parse((await readBody(request)) || "{}");
        if (!held) return sendJson(response, 409, { message: "No call is being held" });
        held(input.status ?? "completed");
        return sendJson(response, 200, { released: true });
      }
      return sendJson(response, 404, { message: "Not found" });
    } catch (error) {
      return sendJson(response, 500, { message: error.message });
    }
  }

  provider = await startMockRealtime({ port, onRequest });
  return { close: () => provider.close() };
}
