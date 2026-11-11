/**
 * LOCAL TEST ONLY. Plays both paid sides of a manual "Test AI Call" on one loopback port:
 *
 *   POST /__test/twilio/…/Calls.json   Twilio's REST API, reached through supabase/local-validation/mock-outbound.mjs
 *   ws   /v1/realtime                  the OpenAI Realtime socket (scripts/mocks/realtime-provider.mjs)
 *
 * An accepted call then runs like a real one: signed status callbacks, the signed TwiML fetch, a Media Stream to the
 * real bridge, a scripted model that only classifies with tools while the server speaks every line, the read-back and
 * confirmation, then `completed`. Everything observed is kept as evidence for scripts/verify-test-call.mjs.
 *
 *   GET  /__test/state     { requests, calls, control }
 *   POST /__test/control   { outcome?: "full" | "no-answer" | "hold", twilioError?: number | null, dwellMs?: number, reset?: true,
 *                            natural?: NaturalScenario | null }   (natural: see runNaturalScenario; used by verify-natural-report.mjs)
 *   POST /__test/release   { status?: "completed" | "no-answer" }  ends the call being held
 *
 * This proves wiring. A scripted model and a fake phone network say nothing about real Arabic quality or carriers.
 */
import { createHmac, randomBytes } from "node:crypto";
import { startMockRealtime } from "./realtime-provider.mjs";
import { connectStream, FRAME_BYTES, VOICED } from "./twilio-media.mjs";
import { internalHeaders } from "../../services/voice-bridge/security.mjs";

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

/**
 * What a worker says at each question, with the classification a good model would make from it. The words travel as
 * the input transcription, because the server refuses an answer the worker's words don't support.
 */
const ANSWER_PLAN = [
  { when: (s) => s.q === "herd_health", say: "كلها بخير", args: { value: "yes", topic: "herd" } },
  { when: (s) => s.q === "herd_count", say: "عشرين راس", args: { text: "20", topic: "herd" } },
  { when: (s) => s.q === "feed_level", say: "العلف باقي منه شوي", args: { value: "low", topic: "feed" } },
  { when: (s) => s.q === "water_level", say: "الموية كافية", args: { value: "good", topic: "water" } },
  { when: (s) => s.q === "fences_condition", say: "الشبك سليم", args: { value: "good", topic: "fences" } },
  { when: (s) => /^[0-9a-f-]{36}$/.test(s.q ?? ""), say: "لا والله ما جا أحد اليوم", args: { text: "لا ما جا", topic: "other" } },
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
    const marks = (prefix) => stream.sent("mark").filter((event) => event.mark?.name?.startsWith(prefix)).length;
    await waitUntil(() => upstream.spoken.length >= 1 && marks("prompt-") >= 1, "opening played");
    await sleep(50);
    call.provider.opening = upstream.spoken[0];

    for (let frame = 0; frame < CALLER_FRAMES; frame += 1) stream.media(VOICED);
    await waitUntil(() => upstream.audioIn.length >= CALLER_FRAMES, "caller audio at the provider");

    const farm = farmOfCall(call.sid);
    call.farm = farm;
    const first = engineState(call.sid);
    call.queue = (first?.data?.queue ?? []).map((item) => item.id ?? item.questionId ?? item.kind);

    let lastOutput = null;
    // A natural call: the worker answers freely and the model hands the whole report over once.
    call.natural = call.provider.sessionUpdate?.tool_choice === "auto";
    if (call.natural && call.scenario) {
      // A scripted natural scenario from verify-natural-report.mjs: answers, corrections, the confirmation timing.
      await runNaturalScenario(call, { upstream, stream, connect, farm, queue: first?.data?.queue ?? [] });
    } else if (call.natural) {
      const answers = (first?.data?.queue ?? []).map((item) => {
        const plan = ANSWER_PLAN.find((entry) => entry.when({ step: "report_question", q: item.id }));
        if (!plan) throw new Error(`The scripted worker has no answer for ${item.id}`);
        if (item.id === "herd_count") return { question_id: item.id, number: Number(plan.args.text) };
        return { question_id: item.id, ...(plan.args.text !== undefined ? { text: plan.args.text } : { value: plan.args.value }) };
      });
      upstream.workerSays("كلها بخير، عشرين راس، العلف باقي منه شوي، الموية كافية، الشبك سليم، ولا والله ما جا أحد اليوم");
      lastOutput = await upstream.toolCall("submit_report", { answers });
      if (lastOutput === null) throw new Error("No output for submit_report");
      call.toolResults.push({ name: "submit_report", output: lastOutput });
      if (JSON.parse(lastOutput).status !== "ok") throw new Error(`The server refused the hand-over: ${lastOutput.slice(0, 300)}`);
    }
    for (let turn = 0; turn < 30 && !call.natural; turn += 1) {
      const state = engineState(call.sid);
      if (!state) throw new Error("The voice session row disappeared mid-call");
      if (state.step === "report_summary") break;
      // The phone call greets and asks «جاهز؟» before the first question.
      if (state.step === "report_ready") {
        const [spoken, prompts] = [upstream.spoken.length, marks("prompt-")];
        upstream.workerSays("إيه جاهز");
        const output = await upstream.toolCall("answer_question", { value: "ready", topic: "herd" });
        if (output === null || JSON.parse(output).status !== "ok") throw new Error("The server refused «جاهز»");
        call.readyAnswered = true;
        await waitUntil(() => upstream.spoken.length > spoken && marks("prompt-") > prompts, "the first question", 20_000);
        continue;
      }
      const plan = state.step === "report_question" ? ANSWER_PLAN.find((entry) => entry.when(state)) : null;
      if (!plan) throw new Error(`The scripted worker has no answer for ${state.step}/${state.q}`);
      call.questions.push({ step: state.step, q: state.q });
      const [spoken, prompts] = [upstream.spoken.length, marks("prompt-")];
      upstream.workerSays(plan.say);
      const output = await upstream.toolCall("answer_question", plan.args);
      if (output === null) throw new Error(`No tool output at ${state.step}/${state.q}`);
      lastOutput = output;
      call.toolResults.push({ name: "answer_question", output });
      const parsed = JSON.parse(output);
      if (parsed.status !== "ok") throw new Error(`The server refused the answer at ${state.step}/${state.q}: ${output.slice(0, 300)}`);
      // The server chooses the next line; the model never speaks it. Wait until the caller has really heard it.
      await waitUntil(() => upstream.spoken.length > spoken && marks("prompt-") > prompts, `the line after ${state.q}`, 20_000);
      call.linesAfterAnswers.push({ expected: parsed.question, spoken: upstream.spoken.at(-1) });
    }
    if (!call.scenario) {
    if (engineState(call.sid)?.step !== "report_summary") throw new Error("The call never reached the summary");

    const parsed = JSON.parse(lastOutput ?? "{}");
    call.summary = { text: parsed.summary ?? null, flagged: parsed.isSummary === true, replies: parsed.replies?.map((reply) => reply.value) ?? [] };
    await waitUntil(() => marks("summary-") >= 1, "summary playback boundary", 20_000);
    await sleep(100);
    call.summary.readInFull = upstream.spoken.includes(call.summary.text);
    call.reportsBeforeConfirm = reportCount(farm);

    upstream.workerSays(CONFIRMATION);
    const confirmed = await upstream.toolCall("confirm_report", { confirmed: true });
    call.toolResults.push({ name: "confirm_report", output: confirmed });
    call.confirm = { output: confirmed === null ? null : JSON.parse(confirmed) };
    }

    const closed = await stream.waitClosed(20_000);
    call.streamClosed = closed !== null;
    call.provider.spoken = [...upstream.spoken];
    call.provider.responseCreates = upstream.of("response.create").length;
    call.provider.responses = upstream.of("response.create").map((event) => ({ toolChoice: event.response?.tool_choice ?? null, verbatim: typeof event.response?.instructions === "string", instructions: event.response?.instructions ?? null }));
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
    call.after = { http: after.status, hangup: /<Hangup/.test(after.xml), speaks: /<Say|<Gather/.test(after.xml), say: decode(after.xml.match(/<Say\b[^>]*>([\s\S]*?)<\/Say>/)?.[1] ?? "") || undefined };
    await sendStatus(call, "completed", { CallDuration: "42" });
    call.finished = true;
  }

  /**
   * Added for scripts/verify-natural-report.mjs. A natural call driven by a JSON scenario:
   *   answers      { [question id | "custom" | "task" | "weather_heat_day"]: submit_report answer fields }
   *   say          the worker's free answer before the hand-over
   *   corrections  [{ say, answers }]  after a summary, the worker corrects; the model hands everything over again
   *   unitClarifications [{ say, answers }]  each time the server asks for a feed amount's unit, the worker answers
   *   confirm      { say, earlyMs }    the worker's yes; with earlyMs, speech starts that long before the summary's
   *                                   playback mark comes back, as on the real call (VAD prefix padding, late marks)
   *   duplicates   { inResponse, direct, voiceSecret }  after the yes: the same confirm_report twice and a new id in
   *                                   the model's turn, and signed bridge retries straight to the tool route
   */
  async function runNaturalScenario(call, { upstream, stream, connect, farm, queue }) {
    const scenario = call.scenario;
    const marks = (prefix) => stream.sent("mark").filter((event) => event.mark?.name?.startsWith(prefix)).length;
    const build = (overrides = {}) => queue.filter((item) => !item.id.startsWith("open_note_")).map((item) => {
      const given = overrides[item.id] ?? overrides[item.kind] ?? scenario.answers[item.id] ?? scenario.answers[item.kind];
      if (!given) throw new Error(`The scenario has no answer for ${item.id} (${item.kind})`);
      return { question_id: item.id, ...given };
    });
    call.scenarioLog = { asked: queue.map((item) => ({ id: item.id, kind: item.kind })), summaries: [], submits: [] };
    const corrections = scenario.corrections ?? [];
    const clarifications = [...(scenario.unitClarifications ?? [])];
    let answers = build();
    let summaryMarks = marks("summary-");
    for (let round = 0; round <= corrections.length; round += 1) {
      const last = round === corrections.length;
      // The final summary's playback marks are held, so the worker's yes can start before they come back.
      if (last && scenario.confirm?.earlyMs !== undefined) stream.autoMark = false;
      upstream.workerSays(round === 0 ? scenario.say : corrections[round - 1].say);
      let output;
      let parsed;
      for (;;) {
        output = await upstream.toolCall("submit_report", { answers });
        if (output === null) throw new Error("No output for submit_report");
        call.toolResults.push({ name: "submit_report", output });
        call.scenarioLog.submits.push(answers);
        parsed = JSON.parse(output);
        // The server asked for the feed amount's unit: the model asks, the worker answers, everything goes over again.
        const clarify = parsed.status === "invalid" && parsed.error === "unit_missing" ? clarifications.shift() : null;
        if (!clarify) break;
        (call.unitRefusals ??= []).push(parsed);
        upstream.workerSays(clarify.say);
        answers = build(clarify.answers);
      }
      if (parsed.status !== "ok") throw new Error(`The server refused the hand-over: ${output.slice(0, 300)}`);
      const summary = { text: parsed.summary ?? null, flagged: parsed.isSummary === true, replies: parsed.replies?.map((reply) => reply.value) ?? [] };
      if (last && stream.autoMark === false) {
        await waitUntil(() => stream.pendingMarks.some((name) => name.startsWith("summary-")), "the summary's playback mark", 20_000);
      } else {
        await waitUntil(() => marks("summary-") > summaryMarks, "summary playback boundary", 20_000);
        await sleep(100);
      }
      summaryMarks = marks("summary-");
      // A natural summary is spoken as its facts, then the closing question as a second line.
      summary.readInFull = upstream.spoken.includes(summary.text) || upstream.spoken.some((line, index) => `${line} ${upstream.spoken[index + 1] ?? ""}`.trim() === summary.text);
      call.scenarioLog.summaries.push(summary);
      call.summary = summary;
      if (!last) answers = build(corrections[round].answers);
    }
    call.reportsBeforeConfirm = reportCount(farm);

    const confirmSay = scenario.confirm?.say ?? CONFIRMATION;
    if (scenario.confirm?.earlyMs !== undefined) {
      // Half a second of the worker's line while the summary's last audio plays, then speech starts before the mark.
      const before = upstream.audioIn.length;
      for (let frame = 0; frame < 25; frame += 1) stream.media(VOICED);
      await waitUntil(() => upstream.audioIn.length >= before + 25, "caller audio during the summary");
      const inputMs = (upstream.audioIn.length * FRAME_BYTES) / 8;
      const speechStartMs = inputMs - scenario.confirm.earlyMs;
      upstream.speechStarted(speechStartMs);
      await sleep(40);
      const held = [...stream.pendingMarks];
      stream.ackAll();
      await sleep(40);
      call.immediate = { inputMs, speechStartMs, marksAckedAfterSpeech: held };
      if (!scenario.duplicates) stream.autoMark = true;
      upstream.workerFinishes(confirmSay);
    } else {
      if (scenario.duplicates) stream.autoMark = false;
      upstream.workerSays(confirmSay);
    }

    let confirmed;
    if (scenario.duplicates?.inResponse) {
      const first = `call_dup_${randomBytes(4).toString("hex")}`;
      const second = `call_dup_${randomBytes(4).toString("hex")}`;
      const turn = await upstream.toolCalls([
        { name: "confirm_report", args: { confirmed: true }, callId: first },
        { name: "confirm_report", args: { confirmed: true }, callId: first },
        { name: "confirm_report", args: { confirmed: true }, callId: second },
      ], { waitMs: 4000 });
      confirmed = turn.outputs[first];
      call.duplicates = { inResponse: { first, second, outputs: turn.outputs } };
    } else {
      confirmed = await upstream.toolCall("confirm_report", { confirmed: true });
      // A save the server couldn't confirm: the model asks for the yes again, and the worker gives it.
      if (confirmed && JSON.parse(confirmed).status === "save_not_confirmed") {
        call.toolResults.push({ name: "confirm_report", output: confirmed });
        call.confirmRetried = true;
        await sleep(100);
        upstream.workerSays(confirmSay);
        confirmed = await upstream.toolCall("confirm_report", { confirmed: true });
      }
    }
    call.toolResults.push({ name: "confirm_report", output: confirmed });
    call.confirm = { output: confirmed === null ? null : JSON.parse(confirmed) };

    if (scenario.duplicates?.direct) {
      // What a retrying bridge would send: signed, same ticket, once with the saved call's id and once with a new one.
      const retry = async (toolCallId) => {
        const body = JSON.stringify({ ticket: connect.ticket, callSid: call.sid, toolCallId, name: "confirm_report", args: { confirmed: true }, userSpokeSinceLastTool: true, workerUtterance: confirmSay, heardSummary: true });
        const response = await fetch(`${appOrigin}/api/voice/realtime/tool`, { method: "POST", headers: internalHeaders(body, scenario.duplicates.voiceSecret), body });
        const text = await response.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        return { http: response.status, output: json?.output ? JSON.parse(json.output) : null, end: json?.end ?? null, goodbye: json?.goodbye ?? null };
      };
      const savedId = call.duplicates?.inResponse?.first ?? null;
      call.duplicates = { ...(call.duplicates ?? {}), direct: { same: savedId ? await retry(savedId) : null, fresh: await retry(`call_retry_${randomBytes(4).toString("hex")}`) } };
    }
    if (stream.autoMark === false) { stream.ackAll(); stream.autoMark = true; }
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
      requestedEvents: form.getAll("StatusCallbackEvent"), outcome: control.outcome, scenario: control.natural ?? null, statuses: [], questions: [], toolResults: [], linesAfterAnswers: [],
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
        if (input.natural !== undefined) control.natural = input.natural;
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
