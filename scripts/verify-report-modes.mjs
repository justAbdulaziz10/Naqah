#!/usr/bin/env node
/**
 * LOCAL ONLY, no paid service. Proves Guided and Open report calls end to end: the real signed Next routes,
 * the real voice bridge and a throwaway Postgres + PostgREST. OpenAI is the loopback mock in
 * scripts/mocks/realtime-provider.mjs and Twilio is the media-stream client in scripts/mocks/twilio-media.mjs.
 * The mock model only calls tools; the server chooses every spoken word and the mock plays it back verbatim.
 *
 *   node scripts/verify-report-modes.mjs [--label final] [--only A,G] [--keep]
 *     [--root /tmp/naqah-rm-modes] [--pg-port 54480] [--rest-port 54481] [--gateway-port 54482]
 *     [--app-port 3720] [--bridge-port 3722] [--provider-port 3723] [--limits-port 3724]
 *
 * Results: <root>/logs/<label>/ while it runs; deleted at the end unless --keep. Exit code 1 on any failure.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockRealtime } from "./mocks/realtime-provider.mjs";
import { connectStream } from "./mocks/twilio-media.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = arg("root", "/tmp/naqah-rm-modes");
const SRC = join(ROOT, "src");
const PGDATA = join(ROOT, "pg");
const SOCK = join(ROOT, "sock");
const LABEL = arg("label", "run");
const LOGS = join(ROOT, "logs", LABEL);
const ONLY = arg("only", "")?.split(",").filter(Boolean);
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const PG_PORT = arg("pg-port", "54480");
const REST_PORT = arg("rest-port", "54481");
const GATEWAY_PORT = arg("gateway-port", "54482");
const APP_PORT = arg("app-port", "3720");
const BRIDGE_PORT = arg("bridge-port", "3722");
const PROVIDER_PORT = Number(arg("provider-port", "3723"));
const LIMITS_BRIDGE_PORT = arg("limits-port", "3724");
const DB = "naqah_rm_modes";
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const PUBLIC = "https://naqah-rm.example.test";
const BRIDGE_PUBLIC = "wss://naqah-rm.example.test/voice-bridge/media";
const AUTH_TOKEN = "local-test-auth-token";
const SECRET = "local-only-voice-secret-for-report-modes";
const CRON_SECRET = "local-only-cron-secret";
const OPENAI_KEY = "local-test-key";
const ACCOUNT_SID = `AC${"0".repeat(32)}`;
const WORKER = "+15555550101";
const OWNER = "+15555550102";
const TWILIO_NUMBER = "+15555550100";

mkdirSync(LOGS, { recursive: true });
const PATH = `${PG_BIN}:${process.env.PATH}`;
const pgEnv = { PATH, LC_ALL: "en_US.UTF-8", PGHOST: "127.0.0.1", PGPORT: PG_PORT, PGUSER: "postgres" };
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NAQAH_|TWILIO_|SUPABASE|NEXT_PUBLIC_|CRON_|PG|OPENAI)/.test(key)));
const children = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ─────────────────── environment ─────────────────── */

function exportTree() {
  mkdirSync(SRC, { recursive: true });
  execFileSync("rsync", ["-a", "--delete", "--exclude", "node_modules", "--exclude", ".next", "--exclude", ".env*", "--exclude", ".git", `${REPO}/`, `${SRC}/`]);
  if (!existsSync(join(SRC, "node_modules"))) execFileSync("cp", ["-c", "-R", join(REPO, "node_modules"), join(SRC, "node_modules")]);
  return execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

function startPg() {
  rmSync(PGDATA, { recursive: true, force: true });
  mkdirSync(SOCK, { recursive: true });
  execFileSync("initdb", ["-D", PGDATA, "-U", "postgres", "--auth=trust", "-E", "UTF8"], { env: { ...baseEnv, ...pgEnv }, stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", PGDATA, "-w", "-l", join(LOGS, "postgres.log"), "-o", `-p ${PG_PORT} -h 127.0.0.1 -k ${SOCK} -c fsync=off`, "start"], { env: { ...baseEnv, ...pgEnv }, stdio: "ignore" });
}
function stopPg() {
  try { execFileSync("pg_ctl", ["-D", PGDATA, "-m", "fast", "-w", "stop"], { env: { ...baseEnv, ...pgEnv }, stdio: "ignore" }); } catch { /* already stopped */ }
  rmSync(PGDATA, { recursive: true, force: true });
}

function background(name, command, args, env, cwd) {
  const out = openSync(join(LOGS, `${name}.log`), "a");
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", out, out], detached: true });
  closeSync(out);
  children.set(name, child);
  return child;
}

async function stopChild(name) {
  const child = children.get(name);
  if (!child) return;
  children.delete(name);
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  await Promise.race([exited, sleep(4000)]);
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
}

async function waitFor(probe, what, tries = 240) {
  for (let index = 0; index < tries; index += 1) {
    try { if (await probe()) return; } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function until(probe, what, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (probe()) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const portOpen = (port) => new Promise((resolve) => {
  const socket = tcpConnect(Number(port), "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

let stackKeys = {};

async function startStack() {
  startPg();
  const stackEnv = join(ROOT, "stack.env");
  background("stack", "sh", [join(SRC, "supabase/local-validation/run-stack.sh"), stackEnv], {
    ...baseEnv, ...pgEnv, NAQAH_TEST_DB: DB, NAQAH_TEST_REST_PORT: REST_PORT, NAQAH_TEST_GATEWAY_PORT: GATEWAY_PORT,
    POSTGREST_BIN: "/opt/homebrew/bin/postgrest",
  }, SRC);
  await waitFor(() => existsSync(stackEnv), "stack.env");
  stackKeys = Object.fromEntries([...readFileSync(stackEnv, "utf8").matchAll(/export (\w+)='([^']*)'/g)].map((m) => [m[1], m[2]]));
}

async function startNext() {
  background("next", join(SRC, "node_modules/.bin/next"), ["dev", "-p", APP_PORT, "-H", "127.0.0.1"], {
    ...baseEnv, PATH, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--import=${join(SRC, "supabase/local-validation/mock-outbound.mjs")}`,
    NAQAH_TEST_OUTBOUND_GATEWAY: `${GATEWAY}/`,
    ...stackKeys,
    NEXT_PUBLIC_NAQAH_ACCOUNT_DATA: "1",
    NAQAH_VOICE_MODE: "farm", NAQAH_VOICE_LOCALE: "ar", NAQAH_VOICE_SECRET: SECRET, NAQAH_PUBLIC_BASE_URL: PUBLIC,
    NAQAH_MANUAL_REPORT_CALLS: "1", NAQAH_SCHEDULED_CALLS: "1", NAQAH_CALL_OWNER: "1", NAQAH_CALL_ALLOWLIST: `${WORKER},${OWNER}`,
    CRON_SECRET, TWILIO_ACCOUNT_SID: ACCOUNT_SID, TWILIO_AUTH_TOKEN: AUTH_TOKEN, TWILIO_PHONE_NUMBER: TWILIO_NUMBER,
    NAQAH_VOICE_ENGINE: "realtime", NAQAH_BRIDGE_PUBLIC_URL: BRIDGE_PUBLIC,
  }, SRC);
  await waitFor(async () => (await fetch(`${APP}/api/cron/report-calls`)).status === 401, "next ready", 480);
}

const bridgeDir = () => join(SRC, "services/voice-bridge");
const bridgeEnv = (port, extra = {}) => ({
  ...baseEnv, PATH, NODE_ENV: "production",
  NODE_OPTIONS: `--import=${join(REPO, "scripts/mocks/loopback-guard.mjs")}`,
  PORT: port, NAQAH_BRIDGE_PUBLIC_URL: BRIDGE_PUBLIC, NAQAH_BRIDGE_UPSTREAM: APP,
  NAQAH_REALTIME_URL: `ws://127.0.0.1:${PROVIDER_PORT}/v1/realtime`,
  NAQAH_VOICE_SECRET: SECRET, TWILIO_AUTH_TOKEN: AUTH_TOKEN, OPENAI_API_KEY: OPENAI_KEY,
  ...extra,
});

async function startBridge() {
  background("bridge", process.execPath, [join(bridgeDir(), "index.mjs")], bridgeEnv(BRIDGE_PORT), bridgeDir());
  await waitFor(() => portOpen(BRIDGE_PORT), "bridge listening", 60);
}

/** The real bridge code with shorter limits, so reprompts can be observed without waiting ten seconds each. */
async function startLimitedBridge(limits) {
  background("bridge-limits", process.execPath, [join(REPO, "scripts/mocks/bridge-limits-entry.mjs")], bridgeEnv(LIMITS_BRIDGE_PORT, {
    NAQAH_TEST_BRIDGE_SERVER: join(bridgeDir(), "server.mjs"),
    NAQAH_TEST_BRIDGE_CONFIG: join(bridgeDir(), "config.mjs"),
    NAQAH_TEST_BRIDGE_LIMITS: JSON.stringify(limits),
  }), bridgeDir());
  await waitFor(() => portOpen(LIMITS_BRIDGE_PORT), "limited bridge listening", 60);
}

function stopAll() {
  for (const child of children.values()) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  }
}

/* ─────────────────── helpers ─────────────────── */

const sql = (query) => execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], {
  input: query, encoding: "utf8", env: { ...baseEnv, ...pgEnv }, maxBuffer: 1 << 26,
}).trim();
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const postJson = async (url, body) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const outbound = async () => (await (await fetch(`${GATEWAY}/__test/outbound`)).json()).requests;
const resetOutbound = () => postJson(`${GATEWAY}/__test/outbound`, { status: 201, reset: true });

const decode = (text) => text.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
const says = (xml) => [...xml.matchAll(/<Say\b[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => decode(m[1])).join(" ");
const gather = (xml) => {
  const raw = xml.match(/<Gather\b[^>]*\baction="([^"]+)"/)?.[1];
  return raw ? decode(raw) : null;
};
const parseConnect = (xml) => {
  const action = xml.match(/<Connect\b[^>]*\baction="([^"]+)"/)?.[1];
  const url = xml.match(/<Stream\b[^>]*\burl="([^"]+)"/)?.[1];
  const ticket = xml.match(/<Parameter\b[^>]*\bname="ticket"[^>]*\bvalue="([^"]+)"/)?.[1];
  return action && url && ticket ? { action: decode(action), url: decode(url), ticket: decode(ticket) } : null;
};

function signature(url, fields) {
  let value = url;
  for (const key of Object.keys(fields).sort()) value += key + fields[key];
  return createHmac("sha1", AUTH_TOKEN).update(value, "utf8").digest("base64");
}

async function post(target, fields, { signed = true } = {}) {
  const publicUrl = new URL(target, PUBLIC).toString();
  const parsed = new URL(publicUrl);
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (signed) headers["X-Twilio-Signature"] = signature(publicUrl, fields);
  const response = await fetch(`${APP}${parsed.pathname}${parsed.search}`, { method: "POST", headers, body: new URLSearchParams(fields) });
  return { status: response.status, xml: await response.text() };
}

const callFields = (sid, extra) => ({
  AccountSid: ACCOUNT_SID, ApiVersion: "2010-04-01", CallSid: sid, CallStatus: "in-progress",
  Called: WORKER, Caller: TWILIO_NUMBER, Direction: "outbound-api", From: TWILIO_NUMBER, To: WORKER, ...extra,
});
const keys = (digits) => ({ Digits: digits, msg: "Gather End" });

const internalKey = createHmac("sha256", SECRET).update("naqah-bridge-internal").digest();
async function internal(path, body) {
  const raw = JSON.stringify(body);
  const timestamp = Date.now();
  const headers = {
    "Content-Type": "application/json",
    "x-naqah-bridge-timestamp": String(timestamp),
    "x-naqah-bridge-signature": createHmac("sha256", internalKey).update(`${timestamp}.${raw}`).digest("hex"),
  };
  const response = await fetch(`${APP}/api/voice/realtime/${path}`, { method: "POST", headers, body: raw });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, text, json };
}

/* ─────────────────── scenario bookkeeping ─────────────────── */

const results = [];
let current = null;
const registry = [];
function scenario(id, title, run) { registry.push({ id, title, run }); }
function check(name, passed, detail) {
  current.checks.push({ name, passed: Boolean(passed), detail: passed ? undefined : detail });
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${passed || detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 700)}`}`);
}

/* ─────────────────── fixtures ─────────────────── */

async function makeOwner() {
  const email = `rm-${randomBytes(5).toString("hex")}@example.test`;
  const password = "local-test-password";
  const user = await postJson(`${GATEWAY}/__test/users`, { email, password });
  sql(`insert into farms (owner_id, plan, plan_selected_at) values (${q(user.id)}, 'basic', now()) on conflict (owner_id) do update set plan_selected_at = now()`);
  const session = await postJson(`${GATEWAY}/auth/v1/token?grant_type=password`, { email, password });
  const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  return async (body) => {
    const response = await fetch(`${APP}/api/account`, { method: "POST", headers: { "Content-Type": "application/json", Origin: APP, Cookie: cookie }, body: JSON.stringify(body) });
    return response.json();
  };
}

/** `questions(customIds)` is the owner's plan: array order is ask order. */
async function makeFarm({ camels = [], herd = null, resources = [], custom = [], mode = "guided", plan = "basic", questions = null, tasks = [] } = {}) {
  const account = await makeOwner();
  const opened = await account({ op: "open" });
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened)}`);
  const farm = opened.data.farmId;
  const list = resources.map(q).join(",") || "''";
  sql(`update farms set plan = ${q(plan)}, setup_complete = true, name = 'عزبة الاختبار', owner_name = 'سالم', owner_phone = ${q(OWNER)}, herd_count = ${herd ?? "null"}, report_mode = ${q(mode)} where id = ${q(farm)};
    update workers set name = 'يوسف', phone = ${q(WORKER)}, language = 'ar' where farm_id = ${q(farm)};
    update farms set primary_worker_id = (select id from workers where farm_id = ${q(farm)} limit 1) where id = ${q(farm)};
    update resources set present = kind::text in (${list}) where farm_id = ${q(farm)};`);
  const camelIds = {};
  for (const name of camels) camelIds[name] = sql(`insert into camels (farm_id, name, tag) values (${q(farm)}, ${q(name)}, 'T1') returning id`);
  const customIds = custom.map((text, index) => sql(`insert into custom_questions (farm_id, text, sort_order) values (${q(farm)}, ${q(text)}, ${index}) returning id`));
  if (questions) sql(`update farms set question_plan = ${q(JSON.stringify(questions(customIds)))}::jsonb where id = ${q(farm)}`);
  const taskIds = tasks.map((instruction) => sql(`insert into task_tickets (farm_id, instruction) values (${q(farm)}, ${q(instruction)}) returning id`));
  return { farm, account, camelIds, customIds, taskIds };
}
const on = (id) => ({ id, enabled: true, required: true });
const off = (id) => ({ id, enabled: false, required: true });
const VET = "جا البيطري اليوم؟";
const FULL = { camels: ["نورة", "مزون", "شيخة"], herd: 20, resources: ["feed", "water"], custom: [VET] };

const count = (table, farm, where = "true") => Number(sql(`select count(*) from ${table} where farm_id = ${q(farm)} and ${where}`));
const reportOf = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(r) order by at), '[]') from reports r where farm_id = ${q(farm)}`));
const answersOf = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(a) order by a.sort_order), '[]') from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm)}`));
const findingsOf = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(f)), '[]') from findings f join reports r on r.id = f.report_id where r.farm_id = ${q(farm)}`));
const camelsOf = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(c)), '[]') from camels c where farm_id = ${q(farm)}`));
const resourceOf = (farm, kind) => JSON.parse(sql(`select row_to_json(r) from resources r where farm_id = ${q(farm)} and kind = ${q(kind)}`) || "null");
const runs = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(r) order by occurrence desc), '[]') from report_call_runs r where farm_id = ${q(farm)}`));
const sessions = (sid) => Number(sql(`select count(*) from voice_call_sessions where call_sid = ${q(sid)}`));

function rawSession(sid) {
  const raw = sql(`select session::text from voice_call_sessions where call_sid = ${q(sid)}`);
  return raw ? JSON.parse(raw) : null;
}
function state(sid) {
  const session = rawSession(sid);
  return session && { step: session.step, q: session.data?.currentQuestionId, data: session.data, draft: session.draft, replies: session.replies, done: session.done };
}
const fingerprint = (value) => JSON.stringify(value && { step: value.step, data: value.data, draft: value.draft, done: value.done });

/** The same id `reportSummaryId` gives: the session row holds the last agent line. */
function summaryIdOf(sid, locale = "ar") {
  const session = rawSession(sid);
  const text = [...session.turns].reverse().find((entry) => entry.speaker === "agent")?.text[locale] ?? "";
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 33 + text.charCodeAt(index)) >>> 0;
  return `${session.data.draftRevision ?? 0}:${hash.toString(36)}`;
}

/* ─────────────────── the call ─────────────────── */

const output = (raw) => {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return raw; }
};
const marks = (stream, prefix) => stream.sent("mark").filter((event) => event.mark?.name?.startsWith(prefix)).length;

class Call {
  constructor(request) {
    this.request = request;
    this.sid = request.sid;
    this.xml = "";
    this.status = 0;
  }
  get text() { return says(this.xml); }
  get action() { return gather(this.xml); }
  get connect() { return parseConnect(this.xml); }
  get ended() { return /<Hangup\s*\/?>/.test(this.xml) || !this.action; }
  async answer() {
    Object.assign(this, await post(this.request.Url, callFields(this.sid)));
    this.ticket = this.connect?.ticket;
    this.afterUrl = this.connect?.action;
    this.streamUrl = this.connect?.url;
    return this;
  }
  open(bridgePort = BRIDGE_PORT) {
    return connectStream({ bridgeUrl: `ws://127.0.0.1:${bridgePort}${new URL(this.streamUrl).pathname}`, publicUrl: this.streamUrl, authToken: AUTH_TOKEN, callSid: this.sid, accountSid: ACCOUNT_SID, ticket: this.ticket });
  }
  async after() {
    Object.assign(this, await post(this.afterUrl, callFields(this.sid)));
    return this;
  }
  async turn(input) {
    if (!this.action) throw new Error(`No Gather to answer: ${this.xml.slice(0, 200)}`);
    Object.assign(this, await post(this.action, callFields(this.sid, input)));
    return this;
  }
  finalStatus() {
    return post(this.request.StatusCallback, callFields(this.sid, { CallStatus: "completed", CallDuration: "42", SequenceNumber: "3", CallbackSource: "call-progress-events", Timestamp: new Date().toUTCString() }));
  }
}

async function callNow(ranch) {
  await resetOutbound();
  const result = await ranch.account({ op: "callNow" });
  if (!result.ok || result.data?.status === "blocked") throw new Error(`callNow failed: ${JSON.stringify(result)}`);
  await waitFor(async () => (await outbound()).length >= 1, "provider request", 80);
  return new Call((await outbound())[0]);
}

/** A live realtime call: the worker talks, the mock model classifies with tools, the server speaks. */
class Live {
  constructor(ranch, call, stream, upstream) {
    Object.assign(this, { ranch, call, stream, upstream });
  }
  get spoken() { return this.upstream.spoken; }
  get said() { return this.spoken.at(-1) ?? ""; }
  get s() { return state(this.call.sid); }
  /** Waits for the line the server chose, and for its summary mark when it is a summary, before the next worker turn. */
  async settle(spoken, prompts, summaries, out, name) {
    await until(() => this.spoken.length > spoken && marks(this.stream, "prompt-") > prompts, `the line after ${name}`);
    if (out?.isSummary) {
      await until(() => marks(this.stream, "summary-") > summaries, "the summary's playback mark");
      await sleep(60);
    }
  }
  async say(words, name, args = {}, { speech = true, ...options } = {}) {
    const [spoken, prompts, summaries] = [this.spoken.length, marks(this.stream, "prompt-"), marks(this.stream, "summary-")];
    this.upstream.workerSays(words);
    const out = output(await this.upstream.toolCall(name, args, options));
    if (speech && out !== null) await this.settle(spoken, prompts, summaries, out, name);
    return out;
  }
  /** Speech the transcriber could not read: the provider commits a turn with no transcript. */
  async blip(name, args = {}, { speech = false } = {}) {
    const [spoken, prompts, summaries] = [this.spoken.length, marks(this.stream, "prompt-"), marks(this.stream, "summary-")];
    this.upstream.workerSays("");
    this.upstream.emitEvent({ type: "conversation.item.input_audio_transcription.failed", item_id: this.upstream.lastSpeechItem, content_index: 0, error: { message: "mock" } });
    const out = output(await this.upstream.toolCall(name, args));
    if (speech && out !== null) await this.settle(spoken, prompts, summaries, out, name);
    else await sleep(250);
    return out;
  }
  /** Saves the way a worker does: a clear yes after hearing the whole summary. */
  async save(words = "إيه احفظه") {
    const out = await this.say(words, "confirm_report", { confirmed: true }, { speech: false });
    await this.stream.waitClosed(20_000);
    await this.call.after();
    return out;
  }
  hangUp() {
    this.stream.stop();
    this.stream.closeNormally();
    return this.call.finalStatus();
  }
}

async function open(ranch, { bridgePort } = {}) {
  const call = await callNow(ranch);
  await call.answer();
  if (!call.connect) throw new Error(`Answer TwiML has no <Connect>: ${call.xml.slice(0, 400)}`);
  const opened = await call.open(bridgePort);
  if (!opened.stream) throw new Error(`Bridge refused the upgrade: ${opened.refused} ${opened.body}`);
  const stream = opened.stream;
  stream.connected();
  stream.start();
  const upstream = await provider.next();
  await upstream.waitForEvent((event) => event.type === "session.update", 20_000, "session.update");
  await upstream.waitForEvent((event) => event.type === "response.create" && typeof event.response?.instructions === "string", 10_000, "opening line");
  await until(() => upstream.spoken.length >= 1 && marks(stream, "prompt-") >= 1, "the opening played");
  await sleep(50);
  return new Live(ranch, call, stream, upstream);
}

/** One model response with several tool calls: the later ones arrive with no new worker speech. */
async function toolBurst(upstream, calls) {
  await until(() => upstream.responseSlots.length > 0, "a model turn");
  upstream.responseSlots.shift();
  const responseId = `resp_burst_${randomBytes(4).toString("hex")}`;
  const items = calls.map(({ name, args, callId }, index) => ({ id: `item_burst_${index}_${responseId}`, call_id: callId ?? `call_burst_${index}_${responseId}`, name, arguments: JSON.stringify(args) }));
  const outputs = items.map((item) => Promise.race([new Promise((resolve) => upstream.toolWaiters.set(item.call_id, resolve)), sleep(6000).then(() => null)]));
  upstream.emitEvent({ type: "response.created", response: { id: responseId, status: "in_progress", output: [] } });
  for (const item of items) upstream.emitEvent({ type: "response.function_call_arguments.done", response_id: responseId, item_id: item.id, output_index: 0, call_id: item.call_id, name: item.name, arguments: item.arguments });
  upstream.emitEvent({ type: "response.done", response: { id: responseId, status: "completed", output: items.map((item) => ({ ...item, type: "function_call", status: "completed" })) } });
  return (await Promise.all(outputs)).map(output);
}

/** The owner is called at the owner's own time by the scheduler, so saving a report never dials them. */
async function assertOwnerNotDialled() {
  await sleep(1200);
  const dialled = (await outbound()).map((r) => r.To);
  check("saving the report does not dial the owner", !dialled.includes(OWNER), dialled);
}

/** One saved report, its run linked, the session gone, and no call straight to the owner. */
async function assertSaved(ranch, call) {
  const status = await call.finalStatus();
  check("the final status callback is accepted", status.status === 204, status);
  const reports = reportOf(ranch.farm);
  check("exactly one report row", reports.length === 1, reports);
  const [latest] = runs(ranch.farm);
  check("the run is completed and linked to the report", latest?.state === "completed" && latest?.report_id === reports[0]?.id, latest);
  check("the voice session is cleaned up", sessions(call.sid) === 0, sessions(call.sid));
  await assertOwnerNotDialled();
  return reports[0];
}

const assertUnsaved = (ranch, label = "no report row") => check(label, count("reports", ranch.farm) === 0, reportOf(ranch.farm));
const hasEvery = (text, parts) => parts.every((part) => text.includes(part));
const answerWords = (row) => row.answer_ar ?? row.answer;
const coverageOf = (report, id) => report.coverage?.find((entry) => entry.questionId === id)?.status;

/** Every saved answer must have been read back to the worker in Arabic. */
function assertReadBack(summary, farm) {
  const missing = answersOf(farm).filter((row) => !summary.includes(answerWords(row)));
  check("the read-back contained every saved answer", missing.length === 0, { missing: missing.map(answerWords), summary });
}

/** The default order: health, count, feed, water, then the custom question. */
async function fillGuided(live, { feed = ["خمسة وعشرين كيس", { text: "25" }], water = ["الموية ناقصة", { value: "low" }], vet = "لا والله ما جا أحد" } = {}) {
  await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  await live.say("عشرين راس", "answer_question", { text: "20", topic: "herd" });
  await live.say(feed[0], "answer_question", { ...feed[1], topic: "feed" });
  await live.say(water[0], "answer_question", { ...water[1], topic: "water" });
  return live.say(vet, "answer_question", { text: vet, topic: "other" });
}

/** A scripted call after the stream is gone, entirely on the keypad. */
async function keypadToEnd(call) {
  for (let index = 0; index < 30 && !call.ended; index += 1) {
    const text = call.text;
    if (/قل العدد/.test(text)) await call.turn(keys(/كم الحلال عندكم/.test(text) ? "20" : "7"));
    else await call.turn(keys("1"));
  }
}

/* ─────────────────── wording the checks rely on ─────────────────── */

const TEXT = {
  health: "وش وضع الحلال اليوم؟",
  count: "كم الحلال عندكم اليوم؟",
  feed: "وش وضع العلف؟",
  water: "وش وضع الموية عندكم؟",
  openAsk: "وش صار في العزبة؟",
  openMore: "فيه شي ثاني تبي تضيفه؟",
  choice: "تبي أسألك سؤال سؤال، ولا تقول لي وش صار؟",
  keypad: "بالأزرار",
};
const ATTENTION = /needs attention|تحتاج متابعة/;
const CONTRADICTION = /unknown \(|غير معروف \(|ما أدري \(/i;

/* ─────────────────── scenarios ─────────────────── */

let provider;

scenario("M0", "The migrations this verifier depends on are applied", async () => {
  for (const file of ["20261109182526_owner_summary_schedule.sql", "20261110090000_mvp_owner_runs.sql"]) check(`${file} is in the tree`, existsSync(join(SRC, "supabase/migrations", file)));
  const columns = sql("select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name = 'farms' and column_name in ('owner_call_day', 'owner_call_time', 'owner_call_run')");
  check("the owner schedule and owner run columns exist", ["owner_call_day", "owner_call_time", "owner_call_run"].every((name) => columns.includes(name)), columns);
});

scenario("A", "Guided: only enabled questions, owner's order, verbatim wording, full read-back, one report", async () => {
  const ranch = await makeFarm({ ...FULL, questions: ([vet]) => [on(vet), on("water_level"), on("herd_health"), off("feed_level"), off("herd_count")] });
  const live = await open(ranch);
  check("the opening goes straight to the owner's first question", hasEvery(live.spoken[0], [VET]) && !live.spoken[0].includes(TEXT.choice), live.spoken[0]);
  await live.say("لا والله ما جا أحد اليوم", "answer_question", { text: "لا ما جا", topic: "other" });
  check("second comes the owner's second question, word for word", live.said === TEXT.water, live.said);
  await live.say("الموية كافية", "answer_question", { value: "good", topic: "water" });
  check("third comes the owner's third question, word for word", live.said === TEXT.health, live.said);
  const reached = await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  check("the summary comes next, marked as the summary", reached?.isSummary === true, reached);
  const summary = live.said;
  check("disabled questions were never asked", !live.spoken.some((line) => line.includes(TEXT.feed) || line.includes(TEXT.count)), live.spoken);
  const saved = await live.save();
  check("confirm_report reports saved", saved?.status === "saved", saved);
  const report = await assertSaved(ranch, live.call);
  check("reports.mode is guided", report?.mode === "guided", report?.mode);
  const answers = answersOf(ranch.farm);
  check("answers are stored in the owner's order", answers.map((row) => row.question_id).join() === [ranch.customIds[0], "water_level", "herd_health"].join(), answers.map((row) => row.question_id));
  check("the custom answer is stored as the worker said it", answers[0]?.answer === "لا والله ما جا أحد اليوم", answers[0]);
  assertReadBack(summary, ranch.farm);
  check("a disabled question is not in coverage", !report.coverage?.some((entry) => entry.questionId === "feed_level" || entry.questionId === "herd_count"), report.coverage);
  check("enabled questions are covered as reported", ["water_level", "herd_health", ranch.customIds[0]].every((id) => coverageOf(report, id) === "reported"), report.coverage);
});

scenario("B", "Replay of real call 1: repeated tools with no speech, a bad number, then a summary", async () => {
  const ranch = await makeFarm(FULL);
  const live = await open(ranch);
  const { upstream, stream } = live;
  const [spoken, prompts] = [live.spoken.length, marks(stream, "prompt-")];
  upstream.workerSays("كلها بخير");
  const outs = await toolBurst(upstream, [1, 2, 3].map(() => ({ name: "answer_question", args: { value: "yes", topic: "herd" } })));
  check("the first of the repeated calls is applied", outs[0]?.status === "ok", outs[0]);
  await until(() => live.spoken.length > spoken && marks(stream, "prompt-") > prompts, "the reply to the repeated calls");
  check("the repeated calls moved the call on exactly one question", live.s?.q === "herd_count" && live.s?.step === "report_question", { q: live.s?.q, step: live.s?.step });
  check("the repeated calls recorded one answer", live.s?.draft.answers.length === 1, live.s?.draft.answers);
  check("the worker hears the next question once", live.spoken.length === spoken + 1 && live.said.includes(TEXT.count), live.spoken.slice(spoken));

  const before = fingerprint(live.s);
  const refused = await live.say("عشرين راس", "answer_question", { text: "200", topic: "herd" });
  check("a number the worker did not say is refused", refused?.error === "number_not_in_answer", refused);
  check("the bad number changes nothing", fingerprint(live.s) === before, live.s?.draft);
  check("the worker hears the question again", live.said.includes(TEXT.count), live.said);
  await live.say("عشرين راس", "answer_question", { text: "20", topic: "herd" });
  await live.say("العلف باقي منه شوي", "answer_question", { value: "low", topic: "feed" });
  await live.say("ميتين الف لتر", "answer_question", { text: "200000", topic: "water" });
  check("a spoken number moves straight on, with no quantity confirmation", live.s?.step === "report_question" && live.s?.q !== "water_level", { step: live.s?.step, q: live.s?.q });
  await live.say("لا ما جا", "answer_question", { text: "لا ما جا", topic: "other" });
  const summary = live.said;
  check("the summary reads the quantity on its own", summary.includes("200000 لتر") && !summary.includes("(200000"), summary);
  check("the summary never says unknown with a quantity", !CONTRADICTION.test(summary), summary);

  const unverified = await live.say("طيب الحين وش باقي", "confirm_report", { confirmed: true });
  check("a confirmation the words do not support is refused", unverified?.error === "worker_has_not_confirmed", unverified);
  assertUnsaved(ranch, "nothing saved before a real yes");
  const saved = await live.save();
  check("a real yes saves", saved?.status === "saved", saved);
  await assertSaved(ranch, live.call);
  const water = answersOf(ranch.farm).find((row) => row.question_id === "water_level");
  check("water is stored as the quantity alone", water?.answer_ar === "200000 لتر" && !CONTRADICTION.test(`${water?.answer} ${water?.answer_ar} ${water?.answer_en}`), water);
  const tank = resourceOf(ranch.farm, "water");
  check("the water resource holds the quantity", tank?.quantity === "200000 لتر" && tank?.certainty === "approximate", tank);
});

const healthOnly = { camels: ["نورة", "مزون"], questions: () => [on("herd_health"), off("herd_count")] };

scenario("C1", "Replay of real call 2: a herd-health yes refused every time ends as unknown", async () => {
  const ranch = await makeFarm(healthOnly);
  const live = await open(ranch);
  const before = fingerprint(live.s);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const refused = await live.say("الجو حار اليوم", "answer_question", { value: "yes", topic: "herd" });
    check(`refusal ${attempt + 1} records nothing`, refused?.status === "invalid" && fingerprint(live.s) === before, refused);
    check(`refusal ${attempt + 1} repeats the question`, live.said.includes(TEXT.health), live.said);
  }
  const third = await live.say("الجو حار اليوم", "answer_question", { value: "yes", topic: "herd" });
  check("the third refusal says it is marked unknown and moves on", live.said.includes("غير معروف") && third?.isSummary === true, { third, said: live.said });
  check("the draft holds unknown, not a guess", live.s?.draft.answers[0]?.certainty === "unknown" && live.s?.draft.camelUpdates.length === 0, live.s?.draft);
  check("nothing ever says a camel needs attention", !live.spoken.some((line) => ATTENTION.test(line) && !line.includes("قلها لي بكلمة")), live.spoken);
  const saved = await live.save();
  check("the unknown report saves", saved?.status === "saved", saved);
  await assertSaved(ranch, live.call);
  const rows = answersOf(ranch.farm);
  check("the stored answer is unknown", rows[0]?.certainty === "unknown" && !ATTENTION.test(JSON.stringify(rows)), rows);
  check("no camel changed", camelsOf(ranch.farm).every((camel) => camel.health === "unknown"), camelsOf(ranch.farm));
  check("no finding was created", findingsOf(ranch.farm).length === 0, findingsOf(ranch.farm));
});

scenario("C2", "Replay of real call 2: yes refused twice, then no without supporting words ends as unknown", async () => {
  const ranch = await makeFarm(healthOnly);
  const live = await open(ranch);
  await live.say("الجو حار اليوم", "answer_question", { value: "yes", topic: "herd" });
  await live.say("الجو حار اليوم", "answer_question", { value: "yes", topic: "herd" });
  const no = await live.say("الجو حار اليوم", "answer_question", { value: "no", topic: "herd" });
  check("a no the words do not support does not open the sick-camel path", live.s?.step !== "health_pick", { step: live.s?.step, no, said: live.said });
  check("nothing says a camel needs attention", !live.spoken.some((line) => ATTENTION.test(line) && !line.includes("قلها لي بكلمة")), live.spoken);
  const status = live.s?.step === "report_summary" ? await live.save() : null;
  if (status) {
    await assertSaved(ranch, live.call);
    const rows = answersOf(ranch.farm);
    check("the stored answer is unknown", rows[0]?.certainty === "unknown" && !ATTENTION.test(JSON.stringify(rows)), rows);
  } else {
    check("the call reaches the summary with herd health unknown", false, { step: live.s?.step, draft: live.s?.draft });
    await live.hangUp();
  }
});

scenario("C3", "An unreadable no after a refused yes stays silent and records nothing", async () => {
  const ranch = await makeFarm(healthOnly);
  const live = await open(ranch);
  await live.say("الجو حار اليوم", "answer_question", { value: "yes", topic: "herd" });
  const before = fingerprint(live.s);
  const spoken = live.spoken.length;
  const out = await live.blip("answer_question", { value: "no", topic: "herd" });
  check("no words means no change", fingerprint(live.s) === before, live.s?.draft);
  check("the first blip is silent", live.spoken.length === spoken, live.spoken.slice(spoken));
  check("the tool still gets a result", out?.status === "ok", out);
  await live.hangUp();
  assertUnsaved(ranch);
});

scenario("C4", "Off-topic guided words are kept as a note, read back and saved", async () => {
  const ranch = await makeFarm(healthOnly);
  const live = await open(ranch);
  const words = "العلف زين";
  const refused = await live.say(words, "answer_question", { value: "yes", topic: "herd" });
  check("the words do not answer the question", refused?.error === "answer_off_topic" && live.s?.step === "report_question" && live.s?.q === "herd_health", refused);
  check("the worker hears it is a note and the question again", hasEvery(live.said, ["سجلتها ملاحظة", TEXT.health]), live.said);
  check("the note is kept, nothing is guessed", live.s?.draft.answers.some((answer) => answer.questionId.startsWith("open_note_") && answer.answer === words) && live.s?.draft.camelUpdates.length === 0, live.s?.draft);
  const reached = await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  check("the note is not asked as a question of its own", !live.spoken.some((line) => line.includes("الملاحظة الصحيحة")), live.spoken);
  check("the summary comes next and reads the note back", reached?.isSummary === true && live.said.includes(words), { reached, said: live.said });
  if (reached?.isSummary !== true) { await live.hangUp(); return; }
  const saved = await live.save();
  check("the report saves", saved?.status === "saved", saved);
  await assertSaved(ranch, live.call);
  check("the note is saved in the worker's words", answersOf(ranch.farm).some((row) => row.answer === words), answersOf(ranch.farm));
  check("a note changes no camel", camelsOf(ranch.farm).every((camel) => camel.health !== "sick"), camelsOf(ranch.farm));
});

scenario("D1", "Noise blips: silent first, repeated only after that, no state change", async () => {
  const ranch = await makeFarm(FULL);
  const live = await open(ranch);
  const before = fingerprint(live.s);
  const spoken = live.spoken.length;
  const quiet = await live.blip("repeat_or_clarify", { reason: "noise" });
  check("the first blip says nothing", live.spoken.length === spoken && quiet?.status === "ok", { quiet, new: live.spoken.slice(spoken) });
  check("the first blip changes nothing", fingerprint(live.s) === before, live.s?.draft);
  const guess = await live.blip("answer_question", { value: "yes", topic: "herd" }, { speech: true });
  check("a guessed answer over noise records nothing", fingerprint(live.s) === before && guess?.status === "ok", { guess, draft: live.s?.draft });
  check("a second blip says it was not heard and repeats the same question", live.said.includes("ما وصلني صوتك") && live.said.includes(TEXT.health), live.said);
  await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  check("a clear answer after noise moves on", live.s?.q === "herd_count", live.s?.q);
  const next = fingerprint(live.s);
  const count = live.spoken.length;
  const word = await live.say("ضجيج", "answer_question", { text: "5", topic: "herd" }, { speech: false });
  await sleep(250);
  check("the transcriber's noise word is treated as noise and stays silent", fingerprint(live.s) === next && live.spoken.length === count && word?.status === "ok", { word, new: live.spoken.slice(count) });
  await live.hangUp();
  assertUnsaved(ranch);
});

scenario("D2", "Silence: two reprompts, stream ends, the same question continues by script with a keypad line", async () => {
  await startLimitedBridge({ repromptMs: 1200, maxReprompts: 2 });
  try {
    const ranch = await makeFarm(FULL);
    const live = await open(ranch, { bridgePort: LIMITS_BRIDGE_PORT });
    await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
    const heard = live.spoken.length;
    const closed = await live.stream.waitClosed(7000);
    check("the stream closes after sustained silence", closed !== null, { closed });
    const reprompts = live.spoken.slice(heard);
    check("exactly two reprompts, each the question", reprompts.length === 2 && reprompts.every((line) => line === TEXT.count), reprompts);
    const before = live.s;
    check("silence recorded no answer", before?.q === "herd_count" && before?.draft.answers.length === 1, before?.draft);
    await live.call.after();
    check("the script continues from the same question", live.call.text.includes(TEXT.count) && Boolean(live.call.action), live.call.text);
    check("the worker is told about the keypad", live.call.text.includes(TEXT.keypad), live.call.text);
    await keypadToEnd(live.call);
    check("the keypad call saves", /انحفظ التحديث/.test(live.call.text), live.call.text);
    await assertSaved(ranch, live.call);
  } finally {
    await stopChild("bridge-limits");
  }
});

scenario("E", "Keypad fallback: a digit is not a custom answer, and digits still answer choice questions", async () => {
  const ranch = await makeFarm({ ...FULL, questions: ([vet]) => [on(vet), on("herd_health"), on("water_level"), off("feed_level"), off("herd_count")] });
  provider.options.refuseStatus = 503;
  const call = await callNow(ranch);
  await call.answer();
  const opened = await call.open();
  if (!opened.stream) throw new Error(`upgrade refused: ${opened.refused}`);
  opened.stream.connected();
  opened.stream.start();
  const closed = await opened.stream.waitClosed(10_000);
  check("the stream ends when the provider refuses", closed !== null, { closed });
  await call.after();
  check("the script starts with the custom question and asks for a spoken answer", call.text.includes(VET) && /بصوتك/.test(call.text), call.text);
  await call.turn(keys("1"));
  check("a digit is refused on a custom text question", /يحتاج إجابة بصوتك/.test(call.text) && call.text.includes(VET), call.text);
  check("the digit is not stored", state(call.sid)?.draft.answers.length === 0, state(call.sid)?.draft);
  await call.turn(keys("1"));
  check("after the retry it is marked unknown and moves on", /غير معروف/.test(call.text) && call.text.includes(TEXT.health), call.text);
  const unknown = state(call.sid)?.draft.answers[0];
  check("the custom answer is unknown, not the digit", unknown?.certainty === "unknown" && unknown?.answer !== "1", unknown);
  await call.turn(keys("1"));
  check("digit 1 answers herd health", state(call.sid)?.draft.answers[1]?.questionId === "herd_health" && state(call.sid)?.draft.answers[1]?.certainty === "reported", state(call.sid)?.draft.answers);
  check("the next question is water", call.text.includes(TEXT.water), call.text);
  await call.turn(keys("3"));
  check("digit 3 picks the third level and moves on", state(call.sid)?.draft.resourceUpdates.at(-1)?.level === "low" && state(call.sid)?.draft.resourceUpdates.at(-1)?.quantity === null, state(call.sid)?.draft.resourceUpdates);
  check("the summary is read for the keypad", /أحفظه/.test(call.text), call.text);
  await call.turn(keys("1"));
  check("digit 1 saves", /انحفظ التحديث/.test(call.text), call.text);
  await assertSaved(ranch, call);
  const rows = answersOf(ranch.farm);
  const custom = rows.find((row) => row.question_id === ranch.customIds[0]);
  check("the saved custom answer is unknown", custom?.certainty === "unknown" && custom?.answer !== "1", custom);
  const report = reportOf(ranch.farm)[0];
  check("coverage marks the custom question unknown", coverageOf(report, ranch.customIds[0]) === "unknown", report.coverage);
  const water = rows.find((row) => row.question_id === "water_level");
  check("the keypad level is stored, with no quantity", resourceOf(ranch.farm, "water")?.level === "low" && !resourceOf(ranch.farm, "water")?.quantity, water);
});

scenario("F", "Correction: deny, correct one item, full re-read, a stale confirmation is refused, one corrected report", async () => {
  const ranch = await makeFarm(FULL);
  const live = await open(ranch);
  await fillGuided(live);
  const first = live.said;
  const oldId = summaryIdOf(live.call.sid);
  check("the first summary has the first feed quantity", first.includes("25 كيس"), first);
  await live.say("لا مو صحيح", "confirm_report", { confirmed: false });
  check("denying the summary offers what to correct", live.s?.step === "report_correct_pick" && /تعدله/.test(live.said), { step: live.s?.step, said: live.said });
  check("every recorded item is offered", ["herd_health", "herd_count", "feed_level", "water_level", ranch.customIds[0]].every((id) => live.s?.replies.some((reply) => reply.value === `correct:${id}`)), live.s?.replies);
  await live.say("العلف غلط", "correct_report", { item_id: "feed_level" });
  check("only that item is asked again, in its normal words", live.s?.step === "report_question" && live.s?.q === "feed_level" && live.said === TEXT.feed, { q: live.s?.q, said: live.said });
  check("only that item is forgotten", live.s?.draft.answers.length === 4 && !live.s?.draft.answers.some((answer) => answer.questionId === "feed_level"), live.s?.draft.answers);
  const reread = await live.say("سبعة أكياس", "answer_question", { text: "7", topic: "feed" });
  const summary = live.said;
  check("the whole summary is read again", reread?.isSummary === true && live.s?.step === "report_summary", reread);
  check("the new summary has every other item and the new quantity", hasEvery(summary, ["الحلال كله بخير", "20 من الحلال", "الماء", "7 كيس", VET]), summary);
  check("the new summary drops the old quantity", !summary.includes("25 كيس"), summary);
  check("the correction changes the summary id", summaryIdOf(live.call.sid) !== oldId, { oldId, now: summaryIdOf(live.call.sid) });

  const before = fingerprint(live.s);
  const stale = await internal("tool", {
    ticket: live.call.ticket, callSid: live.call.sid, toolCallId: `stale-${randomBytes(3).toString("hex")}`, name: "confirm_report",
    args: { confirmed: true }, userSpokeSinceLastTool: true, workerUtterance: "إيه احفظه", heardSummaryId: oldId,
  });
  const staleOutput = output(stale.json?.output);
  check("a confirmation carrying the old summary id is refused", stale.status === 200 && staleOutput?.error === "summary_not_finished", stale.text.slice(0, 300));
  check("the refused confirmation names the current summary", stale.json?.summaryId === summaryIdOf(live.call.sid) && typeof stale.json?.summaryText === "string", stale.json);
  check("the refused confirmation changes nothing", fingerprint(live.s) === before, live.s?.draft);
  assertUnsaved(ranch, "the stale confirmation saved nothing");

  const saved = await live.save();
  check("after hearing the new summary the worker saves", saved?.status === "saved", saved);
  await assertSaved(ranch, live.call);
  const rows = answersOf(ranch.farm);
  const feed = rows.filter((row) => row.question_id === "feed_level");
  check("feed is one row with only the corrected value", feed.length === 1 && answerWords(feed[0]).includes("7 كيس") && !JSON.stringify(rows).includes("25 كيس"), feed);
  const stock = resourceOf(ranch.farm, "feed");
  check("the feed resource holds the corrected value, with no invented level", stock?.level === "unknown" && stock?.quantity === "7 كيس", stock);
  assertReadBack(summary, ranch.farm);
});

scenario("G", "Open: one utterance fills its topics, the rest stay not_reported, tasks after, one report", async () => {
  const ranch = await makeFarm({ ...FULL, mode: "open", plan: "ultimate", tasks: ["صلح الحوض"] });
  const live = await open(ranch);
  check("the opening is the open question, with no mode choice", live.spoken[0].includes(TEXT.openAsk) && !live.spoken[0].includes(TEXT.choice), live.spoken[0]);
  check("the engine waits in open_listen", live.s?.step === "open_listen", live.s?.step);
  const noora = ranch.camelIds["نورة"];
  await live.say("نورة تعبانة والعلف خلص والموية ناقصة باقي ميتين لتر جا البيطري اليوم", "record_facts", { facts: [
    { type: "camel_health", camelId: noora, scope: "one", status: "sick", note: null, evidence: "نورة تعبانة" },
    { type: "resource", resource: "feed", level: "critical", quantity: null, evidence: "والعلف خلص" },
    { type: "resource", resource: "water", level: "low", quantity: 200, evidence: "والموية ناقصة باقي ميتين لتر" },
    { type: "custom", questionId: ranch.customIds[0], answer: "جا البيطري اليوم", evidence: "جا البيطري اليوم" },
  ] });
  check("the server asks if there is more", live.s?.step === "open_more" && live.said === TEXT.openMore, { step: live.s?.step, said: live.said });
  const answered = live.s?.draft.answers.map((answer) => answer.questionId) ?? [];
  check("the facts land in their own topics", ["herd_health", "feed_level", "water_level", ranch.customIds[0]].every((id) => answered.includes(id)), answered);
  check("no other topic is asked", !live.spoken.some((line) => line.includes(TEXT.count)), live.spoken);
  await live.say("لا بس", "finish_update", {});
  check("the follow-up task is asked after", live.s?.step === "report_question" && live.said.includes("صلح الحوض"), { step: live.s?.step, said: live.said });
  const summaryOut = await live.say("إيه خلصت", "answer_question", { value: "yes", topic: "task" });
  check("then the summary", summaryOut?.isSummary === true, summaryOut);
  const summary = live.said;
  const saved = await live.save();
  check("the open report saves", saved?.status === "saved", saved);
  const report = await assertSaved(ranch, live.call);
  check("reports.mode is open", report?.mode === "open", report?.mode);
  check("the unmentioned herd count is not_reported", coverageOf(report, "herd_count") === "not_reported", report.coverage);
  check("mentioned topics are reported", ["herd_health", "feed_level", "water_level", ranch.customIds[0]].every((id) => coverageOf(report, id) === "reported"), report.coverage);
  check("the herd count was not invented", report.herd_count_reported === null, report.herd_count_reported);
  assertReadBack(summary, ranch.farm);
  const camels = camelsOf(ranch.farm);
  const named = camels.find((camel) => camel.id === noora);
  check("the named camel changed", named?.health === "sick", named);
  check("no unnamed camel changed", camels.filter((camel) => camel.id !== noora).every((camel) => camel.health === "unknown"), camels);
  check("feed and water hold what was said", resourceOf(ranch.farm, "feed")?.level === "critical" && resourceOf(ranch.farm, "water")?.level === "low" && resourceOf(ranch.farm, "water")?.quantity === "200 لتر", [resourceOf(ranch.farm, "feed"), resourceOf(ranch.farm, "water")]);
  check("the task is closed by the worker's yes", sql(`select status from task_tickets where id = ${q(ranch.taskIds[0])}`) === "closed");
});

/** Facts the words don't support change nothing on the ranch, but the worker's words are kept as a note. */
const notedFacts = (live) => async (label, words, facts) => {
  const factsOf = (s) => JSON.stringify({ camels: s?.draft.camelUpdates, resources: s?.draft.resourceUpdates, herd: s?.draft.herdCount });
  const before = live.s;
  const out = await live.say(words, "record_facts", { facts });
  check(`${label} is not refused`, out?.status === "ok" && !out?.error, out);
  check(`${label} changes no fact`, factsOf(live.s) === factsOf(before), live.s?.draft);
  check(`${label} leaves the call listening`, live.s?.step === "open_more", live.s?.step);
  const note = live.s?.draft.answers.at(-1);
  check(`${label} is kept in the worker's words`, live.s?.draft.answers.length === before?.draft.answers.length + 1 && note?.questionId.startsWith("open_note_") && note?.answer === words, live.s?.draft.answers);
  check(`${label} is reported to the worker as a note`, live.said.includes("سجلت كلامك كملاحظة"), live.said);
};

scenario("H1", "Open safety: unheard facts dropped, numbers must match the words", async () => {
  const ranch = await makeFarm({ ...FULL, mode: "open" });
  const live = await open(ranch);
  const expectNoted = notedFacts(live);
  const partly = await live.say("العلف ناقص", "record_facts", { facts: [
    { type: "resource", resource: "feed", level: "low", quantity: null, evidence: "العلف ناقص" },
    { type: "resource", resource: "water", level: "low", quantity: null, evidence: "الموية ناقصة" },
  ] });
  check("a fact whose evidence was not said is dropped", live.s?.draft.resourceUpdates.map((entry) => entry.kind).join() === "feed", live.s?.draft.resourceUpdates);
  check("the supported fact still counts", partly?.status === "ok" && live.s?.step === "open_more", partly);
  await expectNoted("a quantity that does not match the words", "عندنا عشرين كيس علف", [{ type: "resource", resource: "feed", level: null, quantity: 50, evidence: "عشرين كيس علف" }]);
  await expectNoted("a herd count that does not match the words", "عشرين ناقة", [{ type: "herd_count", count: 30, evidence: "عشرين ناقة" }]);
  await live.say("عشرين ناقة", "record_facts", { facts: [{ type: "herd_count", count: 20, evidence: "عشرين ناقة" }] });
  check("a matching herd count is kept", live.s?.draft.herdCount === 20, live.s?.draft.herdCount);
  const end = await live.say("لا بس", "finish_update", {});
  check("finish_update brings the summary", end?.isSummary === true, end);
  const summary = live.said;
  const saved = await live.save();
  check("the report saves", saved?.status === "saved", saved);
  const report = await assertSaved(ranch, live.call);
  check("only supported facts were saved", !answersOf(ranch.farm).some((row) => row.question_id === "water_level"), answersOf(ranch.farm).map((row) => row.question_id));
  check("water is not_reported", coverageOf(report, "water_level") === "not_reported", report.coverage);
  check("the herd count is saved", String(report.herd_count_reported) === "20", report.herd_count_reported);
  assertReadBack(summary, ranch.farm);
});

scenario("H2", "Open safety: all camels needs explicit words, and an unclear camel is asked about", async () => {
  const ranch = await makeFarm({ ...FULL, mode: "open" });
  const live = await open(ranch);
  const [noora, mazoon] = [ranch.camelIds["نورة"], ranch.camelIds["مزون"]];
  await notedFacts(live)("all camels without the words", "الحلال زين", [{ type: "camel_health", camelId: null, scope: "all", status: "healthy", note: null, evidence: "الحلال زين" }]);
  check("no camel was touched by the unsupported claim", live.s?.draft.camelUpdates.length === 0, live.s?.draft.camelUpdates);
  await live.say("كل الحلال بخير", "record_facts", { facts: [{ type: "camel_health", camelId: null, scope: "all", status: "healthy", note: null, evidence: "كل الحلال بخير" }] });
  check("all camels with the words applies to every camel", live.s?.draft.camelUpdates.length === 3 && live.s?.draft.camelUpdates.every((entry) => entry.health === "healthy"), live.s?.draft.camelUpdates);

  await live.say("نورة تعبانة", "record_facts", { facts: [{ type: "camel_health", camelId: mazoon, scope: "one", status: "sick", note: null, evidence: "نورة تعبانة" }] });
  check("a camel id that the words do not name asks which camel", live.s?.step === "open_clarify" && live.said.includes("أي ناقة تقصد"), { step: live.s?.step, said: live.said });
  check("the wrong camel was not changed", live.s?.draft.camelUpdates.find((entry) => entry.camelId === mazoon)?.health === "healthy", live.s?.draft.camelUpdates);
  await live.say("نورة", "answer_question", { value: `camel:${noora}`, topic: "herd" });
  check("the worker's answer picks the camel", live.s?.draft.camelUpdates.find((entry) => entry.camelId === noora)?.health === "sick" && live.s?.step === "open_more", live.s?.draft.camelUpdates);

  await live.say("وحدة من النوق تعبانة", "record_facts", { facts: [{ type: "camel_health", camelId: null, scope: "one", status: "sick", note: null, evidence: "وحدة من النوق تعبانة" }] });
  check("an unnamed camel asks which one", live.s?.step === "open_clarify", live.s?.step);
  await live.say("ما أدري", "answer_question", { value: "unknown", topic: "herd" });
  check("not knowing which camel keeps the concern as a note and changes no camel", live.s?.step === "open_more" && live.s?.draft.answers.some((answer) => /غير محددة/.test(answer.answerText?.ar ?? "")) && live.s?.draft.camelUpdates.filter((entry) => entry.health === "sick").length === 1, live.s?.draft);

  const before = live.s?.draft.answers.length;
  const joined = await live.say("وجا البيطري اليوم", "record_facts", { facts: [{ type: "custom", questionId: ranch.customIds[0], answer: "جا البيطري اليوم", evidence: "وجا البيطري اليوم" }] });
  check("a leading «و» on a short word does not drop the answer", joined?.status === "ok" && live.s?.draft.answers.length === (before ?? 0) + 1, { joined, answers: live.s?.draft.answers.map((answer) => answer.questionId) });

  const end = await live.say("لا بس", "finish_update", {});
  check("finish_update brings the summary", end?.isSummary === true, end);
  const summary = live.said;
  const saved = await live.save();
  check("the report saves", saved?.status === "saved", saved);
  await assertSaved(ranch, live.call);
  const camels = camelsOf(ranch.farm);
  check("the camels hold only what was said", camels.find((camel) => camel.id === noora)?.health === "sick" && camels.filter((camel) => camel.id !== noora).every((camel) => camel.health === "healthy"), camels);
  assertReadBack(summary, ranch.farm);
});

scenario("H3", "Open safety: unsupported updates become kept notes, the worker is never asked to repeat them, and they reach the owner", async () => {
  const ranch = await makeFarm({ ...FULL, mode: "open" });
  const live = await open(ranch);
  await live.say("العلف ناقص", "record_facts", { facts: [{ type: "resource", resource: "feed", level: "low", quantity: null, evidence: "العلف ناقص" }] });
  const claim = [{ type: "camel_health", camelId: null, scope: "all", status: "healthy", note: null, evidence: "الحلال زين" }];
  const expectNoted = notedFacts(live);
  await expectNoted("the first unsupported update", "الحلال زين", claim);
  await expectNoted("the second unsupported update", "الحلال زين ما عليه", claim);
  await expectNoted("the third unsupported update", "الحلال زين والله", claim);
  check("the call is still listening", live.s?.step === "open_more", live.s?.step);
  const end = await live.say("لا بس", "finish_update", {});
  check("finish_update brings the read-back", end?.isSummary === true && live.s?.step === "report_summary", end);
  const summary = live.said;
  check("no camel was changed by the unsupported claims", live.s?.draft.camelUpdates.length === 0, live.s?.draft.camelUpdates);
  check("the captured fact is in the read-back", summary.includes("العلف"), summary);
  check("the worker's notes are in the read-back", hasEvery(summary, ["الحلال زين", "الحلال زين ما عليه", "الحلال زين والله"]), summary);
  const saved = await live.save();
  check("the report saves", saved?.status === "saved", saved);
  await assertSaved(ranch, live.call);
  const notes = answersOf(ranch.farm).filter((row) => row.question_id.startsWith("open_note_"));
  check("the notes are saved as the worker said them", notes.map((row) => row.answer).join("|") === "الحلال زين|الحلال زين ما عليه|الحلال زين والله", notes);
  check("the camels stayed unknown", camelsOf(ranch.farm).every((camel) => camel.health === "unknown"), camelsOf(ranch.farm));
  check("no finding was made from the notes", !findingsOf(ranch.farm).some((finding) => finding.text_ar.includes("الحلال زين")), findingsOf(ranch.farm));
});

scenario("I1", "Worker choice: the worker picks guided", async () => {
  const ranch = await makeFarm({ ...FULL, mode: "worker_choice" });
  const live = await open(ranch);
  check("the call asks how to take the report", live.spoken[0].includes(TEXT.choice) && live.s?.step === "report_mode_choice", live.spoken[0]);
  await live.say("سؤال سؤال", "choose_mode", { mode: "guided" });
  check("guided starts with the first question", live.s?.data.reportMode === "guided" && live.said.includes(TEXT.health), live.said);
  await live.hangUp();
  assertUnsaved(ranch);
});

scenario("I2", "Worker choice: the worker picks open", async () => {
  const ranch = await makeFarm({ ...FULL, mode: "worker_choice" });
  const live = await open(ranch);
  await live.say("أقول اللي صار", "choose_mode", { mode: "open" });
  check("open starts with the open question", live.s?.data.reportMode === "open" && live.s?.step === "open_listen" && live.said === TEXT.openAsk, { mode: live.s?.data.reportMode, said: live.said });
  await live.hangUp();
  assertUnsaved(ranch);
});

scenario("I3", "An owner-fixed mode is never offered, and choose_mode is refused", async () => {
  const guided = await makeFarm({ ...FULL, mode: "guided" });
  const one = await open(guided);
  check("guided: no mode choice", !one.spoken[0].includes(TEXT.choice) && one.s?.step === "report_question", one.spoken[0]);
  const before = fingerprint(one.s);
  const out = await one.say("أقول اللي صار", "choose_mode", { mode: "open" });
  check("guided: choose_mode is refused", out?.status === "invalid" && out?.error === "tool_not_available", out);
  check("guided: state unchanged", fingerprint(one.s) === before, one.s?.draft);
  await one.hangUp();
  provider.reset();
  const open2 = await makeFarm({ ...FULL, mode: "open" });
  const two = await open(open2);
  check("open: no mode choice", !two.spoken[0].includes(TEXT.choice) && two.s?.step === "open_listen", two.spoken[0]);
  const refused = await two.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  check("open: guided answers are not offered", refused?.status === "invalid", refused);
  await two.hangUp();
  assertUnsaved(open2);
});

scenario("I4", "Disabled questions are never asked; owner's custom wording is not personalized", async () => {
  const SAMPLE = "هل كلّم أحمد عبدالله عن الخزان؟";
  const ranch = await makeFarm({ camels: ["نورة"], resources: ["feed", "water"], custom: [SAMPLE], questions: ([custom]) => [on(custom), off("herd_health"), off("herd_count"), off("feed_level"), off("water_level")] });
  const live = await open(ranch);
  check("the greeting uses the real worker name", /يوسف/.test(live.spoken[0]), live.spoken[0]);
  check("the owner's question is spoken word for word", live.spoken[0].includes(SAMPLE), live.spoken[0]);
  check("disabled questions are not in the queue", live.s?.data.queue.length === 1, live.s?.data.queue);
  await live.say("وش قلت؟", "repeat_or_clarify", { reason: "asked_to_repeat" });
  check("repeating it keeps the owner's words", live.said.includes(SAMPLE), live.said);
  live.upstream.closeAbruptly();
  await live.stream.waitClosed(10_000);
  await live.call.after();
  check("the scripted fallback keeps the owner's words", live.call.text.includes(SAMPLE), live.call.text);
  await live.call.turn({ SpeechResult: "إيه كلمه", Confidence: "0.9", msg: "Gather End" });
  check("the summary keeps the owner's words", live.call.text.includes(SAMPLE) && /إيه كلمه/.test(live.call.text), live.call.text);
  await live.call.turn(keys("1"));
  check("the keypad saves", /انحفظ التحديث/.test(live.call.text), live.call.text);
  await assertSaved(ranch, live.call);
  const [row] = answersOf(ranch.farm);
  check("the stored question keeps the owner's words", row?.question_ar === SAMPLE, row);
  check("the stored answer is the worker's words", row?.answer === "إيه كلمه", row);
});

scenario("J", "Urgent: the worker is told to call the owner, the note is read back and saved as one finding", async () => {
  const ranch = await makeFarm(healthOnly);
  const live = await open(ranch);
  const before = fingerprint(live.s);
  const words = "ناقة طايحة وما تقوم";
  await live.say(words, "flag_urgent", { note: "ناقة طايحة" });
  check("a fixed line tells the worker to call the owner directly", hasEvery(live.said, ["اتصل بصاحب العزبة مباشرة", "ناقة ما تبلغ أحد بالطوارئ"]), live.said);
  check("the question is repeated", live.said.includes(TEXT.health), live.said);
  check("the question position did not move", live.s?.step === "report_question" && live.s?.q === "herd_health" && live.s?.draft.answers.length === 0, live.s);
  check("the note is the worker's own words", live.s?.draft.urgentNote === words, live.s?.draft.urgentNote);
  check("the report state otherwise did not change", JSON.stringify({ ...JSON.parse(fingerprint(live.s)), draft: { ...live.s?.draft, urgentNote: undefined } }) === JSON.stringify({ ...JSON.parse(before), draft: { ...JSON.parse(before).draft, urgentNote: undefined } }), live.s?.draft);
  check("no dispatch: nothing was called except the worker", (await outbound()).every((request) => request.To === WORKER), (await outbound()).map((request) => request.To));
  const reached = await live.say("كلها غيرها بخير", "answer_question", { value: "yes", topic: "herd" });
  check("the summary comes next", reached?.isSummary === true, reached);
  check("the note is read back", live.said.includes(words), live.said);
  const saved = await live.save();
  check("the report saves", saved?.status === "saved", saved);
  await assertSaved(ranch, live.call);
  const findings = findingsOf(ranch.farm);
  const urgent = findings.filter((finding) => finding.text_ar.includes(words));
  check("the note is saved as exactly one finding", urgent.length === 1, findings);
  check("the finding says it was reported by the worker", /حسب كلام العامل/.test(urgent[0]?.text_ar ?? "") && /reported by the worker/.test(urgent[0]?.text_en ?? ""), urgent[0]);
  check("no dispatch: the call to the worker is the only call placed", (await outbound()).every((request) => request.To === WORKER), (await outbound()).map((request) => request.To));
});

scenario("K1", "Double confirm_report and repeated ids save one report", async () => {
  const ranch = await makeFarm(FULL);
  const live = await open(ranch);
  const duplicateId = `call_duplicate_${randomBytes(3).toString("hex")}`;
  await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" }, { callId: duplicateId });
  const afterFirst = fingerprint(live.s);
  live.upstream.workerSays("كلها بخير");
  const repeat = await live.upstream.toolCall("answer_question", { value: "yes", topic: "herd" }, { callId: duplicateId, waitMs: 2000 });
  check("a repeated tool id is not applied again", repeat === null && fingerprint(live.s) === afterFirst, { repeat, q: live.s?.q });
  await live.say("عشرين راس", "answer_question", { text: "20", topic: "herd" });
  await live.say("العلف كافي", "answer_question", { value: "good", topic: "feed" });
  await live.say("الموية كافية", "answer_question", { value: "good", topic: "water" });
  await live.say("لا ما جا", "answer_question", { text: "لا ما جا", topic: "other" });
  const firstId = `call_save_${randomBytes(3).toString("hex")}`;
  live.upstream.workerSays("إيه احفظه");
  const [first] = await toolBurst(live.upstream, [{ name: "confirm_report", args: { confirmed: true }, callId: firstId }, { name: "confirm_report", args: { confirmed: true } }]);
  check("the first confirm saves", first?.status === "saved", first);
  await live.stream.waitClosed(20_000);
  await live.call.after();
  const body = (toolCallId) => ({ ticket: live.call.ticket, callSid: live.call.sid, toolCallId, name: "confirm_report", args: { confirmed: true }, userSpokeSinceLastTool: true, workerUtterance: "إيه احفظه" });
  const replay = await internal("tool", body(firstId));
  check("a replayed confirm returns the first result", output(replay.json?.output)?.status === "saved", replay.text.slice(0, 200));
  const another = await internal("tool", body(`call_save_again_${randomBytes(3).toString("hex")}`));
  check("a new confirm id after the save adds nothing", output(another.json?.output)?.status === "saved", another.text.slice(0, 200));
  check("still one report", count("reports", ranch.farm) === 1, reportOf(ranch.farm));
  await assertSaved(ranch, live.call);
});

scenario("K2", "Two concurrent confirmations save one report and never dial the owner", async () => {
  const ranch = await makeFarm(healthOnly);
  const live = await open(ranch);
  await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  const summaryId = summaryIdOf(live.call.sid);
  const body = (toolCallId) => ({ ticket: live.call.ticket, callSid: live.call.sid, toolCallId, name: "confirm_report", args: { confirmed: true }, userSpokeSinceLastTool: true, workerUtterance: "إيه احفظه", heardSummaryId: summaryId });
  const [one, two] = await Promise.all([internal("tool", body(`race-a-${randomBytes(3).toString("hex")}`)), internal("tool", body(`race-b-${randomBytes(3).toString("hex")}`))]);
  check("both requests return", one.status === 200 && two.status === 200, [one.status, two.status]);
  check("at least one says saved", [one, two].some((reply) => output(reply.json?.output)?.status === "saved"), [one.text.slice(0, 200), two.text.slice(0, 200)]);
  await live.hangUp();
  await assertSaved(ranch, live.call);
});

scenario("K3", "A dropped stream mid-open falls back with the captured facts kept", async () => {
  const ranch = await makeFarm({ ...FULL, mode: "open" });
  const live = await open(ranch);
  await live.say("العلف ناقص", "record_facts", { facts: [{ type: "resource", resource: "feed", level: "low", quantity: null, evidence: "العلف ناقص" }] });
  check("the facts are captured before the drop", live.s?.step === "open_more" && live.s?.draft.resourceUpdates.length === 1, live.s?.draft);
  live.upstream.closeAbruptly();
  const closed = await live.stream.waitClosed(10_000);
  check("the stream ends", closed !== null, { closed });
  await live.call.after();
  check("the script continues on the keypad", live.call.text.includes(TEXT.keypad) && Boolean(live.call.action), live.call.text);
  check("the captured fact is read back and no captured topic is asked again", live.call.text.includes("العلف") && /أحفظه/.test(live.call.text) && !live.call.text.includes(TEXT.feed), live.call.text);
  await live.call.turn(keys("1"));
  check("the keypad saves", /انحفظ التحديث/.test(live.call.text), live.call.text);
  const report = await assertSaved(ranch, live.call);
  check("the report stays open with the captured fact", report?.mode === "open" && answersOf(ranch.farm).some((row) => row.question_id === "feed_level"), { mode: report?.mode, answers: answersOf(ranch.farm).map((row) => row.question_id) });
  check("unmentioned topics stay not_reported", coverageOf(report, "water_level") === "not_reported" && coverageOf(report, "herd_health") === "not_reported", report.coverage);
});

scenario("K4", "A dropped stream before any fact falls back to the guided script", async () => {
  const ranch = await makeFarm({ ...FULL, mode: "open" });
  const live = await open(ranch);
  live.upstream.closeAbruptly();
  await live.stream.waitClosed(10_000);
  await live.call.after();
  check("the script asks the first guided question", live.call.text.includes(TEXT.health) && live.call.text.includes(TEXT.keypad), live.call.text);
  await keypadToEnd(live.call);
  check("the keypad call saves", /انحفظ التحديث/.test(live.call.text), live.call.text);
  const report = await assertSaved(ranch, live.call);
  check("the fallback report is guided", report?.mode === "guided", report?.mode);
});

/** Compile the realtime routes before a call so a dev-server compile can't hit the bridge's 5 s internal timeout. */
async function warmUp() {
  for (const path of ["session", "tool"]) await fetch(`${APP}/api/voice/realtime/${path}`, { method: "POST", body: "{}" }).catch(() => {});
  const sid = `CA${"3".repeat(32)}`;
  for (const target of ["/api/voice/realtime/after?s=x", "/api/voice/turn?n=0", "/api/voice/outbound?s=x", "/api/voice/outbound/status?s=x"]) await post(target, callFields(sid), { signed: false }).catch(() => {});
  await fetch(`${APP}/api/account`, { method: "POST", headers: { "Content-Type": "application/json", Origin: APP }, body: "{}" }).catch(() => {});
}

/* ─────────────────── main ─────────────────── */

const started = Date.now();
let commit = "";
let exitCode = 1;
try {
  commit = exportTree();
  await startStack();
  provider = await startMockRealtime({ port: PROVIDER_PORT });
  await startNext();
  await startBridge();
  await warmUp();
  for (const entry of registry) {
    if (ONLY?.length && !ONLY.some((id) => entry.id === id || entry.id.startsWith(id))) continue;
    console.log(`\n${entry.id} ${entry.title}`);
    current = { id: entry.id, title: entry.title, checks: [], notes: [], error: null };
    results.push(current);
    provider.reset();
    try {
      await entry.run();
    } catch (error) {
      current.error = error.stack ?? String(error);
      console.log(`  ERROR ${error.message}`);
    } finally {
      provider.options.refuseStatus = null;
    }
  }
  exitCode = results.some((r) => r.error || r.checks.some((c) => !c.passed)) ? 1 : 0;
} finally {
  await provider?.close();
  stopAll();
  await sleep(500);
  stopPg();
}

const table = results.map((r) => {
  const failed = r.checks.filter((c) => !c.passed);
  const verdict = r.error ? "ERROR" : failed.length ? "FAIL" : "PASS";
  return `${verdict.padEnd(6)} ${r.id.padEnd(4)} ${r.title}${failed.length ? `  [${failed.length}/${r.checks.length} failed]` : ` [${r.checks.length}]`}`;
}).join("\n");
const totals = results.flatMap((r) => r.checks);
console.log(`\n=== ${LABEL} (commit ${commit}, ${Math.round((Date.now() - started) / 1000)}s) ===\n${table}\n\nchecks: ${totals.filter((c) => c.passed).length} passed, ${totals.filter((c) => !c.passed).length} failed; errored scenarios: ${results.filter((r) => r.error).length}`);
writeFileSync(join(LOGS, "result.json"), JSON.stringify({ label: LABEL, commit, results }, null, 2));
if (!flag("keep")) rmSync(ROOT, { recursive: true, force: true });
process.exit(exitCode);
