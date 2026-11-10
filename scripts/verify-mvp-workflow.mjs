#!/usr/bin/env node
/**
 * LOCAL ONLY, no paid service. Proves the MVP call workflow end to end: the real signed Next routes, the cron
 * route, the real voice bridge and a throwaway Postgres + PostgREST. OpenAI is the loopback mock in
 * scripts/mocks/realtime-provider.mjs and Twilio is the media-stream client in scripts/mocks/twilio-media.mjs.
 * Retries are made due by moving the stored next attempt into the past; the product clock is never touched.
 *
 *   node scripts/verify-mvp-workflow.mjs [--label final] [--only A,F] [--keep]
 *     [--root /tmp/naqah-mvp-replay/workflow] [--pg-port 54520] [--rest-port 54521] [--gateway-port 54522]
 *     [--app-port 3730] [--bridge-port 3732] [--provider-port 3733]
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
const ROOT = arg("root", "/tmp/naqah-mvp-replay/workflow");
const SRC = join(ROOT, "src");
const PGDATA = join(ROOT, "pg");
const SOCK = join(ROOT, "sock");
const LABEL = arg("label", "run");
const LOGS = join(ROOT, "logs", LABEL);
const ONLY = arg("only", "")?.split(",").filter(Boolean);
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const PG_PORT = arg("pg-port", "54520");
const REST_PORT = arg("rest-port", "54521");
const GATEWAY_PORT = arg("gateway-port", "54522");
const APP_PORT = arg("app-port", "3730");
const BRIDGE_PORT = arg("bridge-port", "3732");
const PROVIDER_PORT = Number(arg("provider-port", "3733"));
const DB = "naqah_mvp_workflow";
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const PUBLIC = "https://naqah-workflow.example.test";
const BRIDGE_PUBLIC = "wss://naqah-workflow.example.test/voice-bridge/media";
const AUTH_TOKEN = "local-test-auth-token";
const SECRET = "local-only-voice-secret-for-mvp-workflow";
const CRON_SECRET = "local-only-cron-secret";
const OPENAI_KEY = "local-test-key";
const ACCOUNT_SID = `AC${"0".repeat(32)}`;
const WORKER = "+15555550101";
const OWNER = "+15555550102";
const TWILIO_NUMBER = "+15555550100";
const TWENTY_MINUTES = 20 * 60_000;
const REQUIRED_MIGRATIONS = ["20261109182526_owner_summary_schedule.sql", "20261110090000_mvp_owner_runs.sql"];

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

async function startBridge() {
  const dir = join(SRC, "services/voice-bridge");
  background("bridge", process.execPath, [join(dir, "index.mjs")], {
    ...baseEnv, PATH, NODE_ENV: "production",
    NODE_OPTIONS: `--import=${join(REPO, "scripts/mocks/loopback-guard.mjs")}`,
    PORT: BRIDGE_PORT, NAQAH_BRIDGE_PUBLIC_URL: BRIDGE_PUBLIC, NAQAH_BRIDGE_UPSTREAM: APP,
    NAQAH_REALTIME_URL: `ws://127.0.0.1:${PROVIDER_PORT}/v1/realtime`,
    NAQAH_VOICE_SECRET: SECRET, TWILIO_AUTH_TOKEN: AUTH_TOKEN, OPENAI_API_KEY: OPENAI_KEY,
  }, dir);
  await waitFor(() => portOpen(BRIDGE_PORT), "bridge listening", 60);
}

function stopAll() {
  for (const child of children.values()) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  }
}

/* ─────────────────── helpers ─────────────────── */

const sql = (query) => execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], {
  input: query, encoding: "utf8", env: { ...baseEnv, ...pgEnv }, maxBuffer: 1 << 26, stdio: ["pipe", "pipe", "pipe"],
}).trim();
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const postJson = async (url, body) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const outbound = async () => (await (await fetch(`${GATEWAY}/__test/outbound`)).json()).requests;
const setOutbound = (status, reset = false) => postJson(`${GATEWAY}/__test/outbound`, { status, reset });
const resetOutbound = () => setOutbound(201, true);
const dialsTo = async (to) => (await outbound()).filter((request) => request.To === to);

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
const redirectOf = (xml) => {
  const raw = xml.match(/<Redirect\b[^>]*>([^<]+)<\/Redirect>/)?.[1];
  return raw ? decode(raw) : null;
};

function signature(url, fields) {
  let value = url;
  for (const key of Object.keys(fields).sort()) value += key + fields[key];
  return createHmac("sha1", AUTH_TOKEN).update(value, "utf8").digest("base64");
}

async function post(target, fields) {
  const publicUrl = new URL(target, PUBLIC).toString();
  const parsed = new URL(publicUrl);
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature(publicUrl, fields) };
  const response = await fetch(`${APP}${parsed.pathname}${parsed.search}`, { method: "POST", headers, body: new URLSearchParams(fields) });
  return { status: response.status, xml: await response.text() };
}

const callFields = (sid, to, extra) => ({
  AccountSid: ACCOUNT_SID, ApiVersion: "2010-04-01", CallSid: sid, CallStatus: "in-progress",
  Called: to, Caller: TWILIO_NUMBER, Direction: "outbound-api", From: TWILIO_NUMBER, To: to, ...extra,
});
const speech = (text) => ({ SpeechResult: text, Confidence: "0.92", msg: "Gather End" });
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
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${passed || detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 800)}`}`);
}
/** Text comparison that survives TwiML breaking long speech into several <Say> blocks. */
const compact = (text) => String(text).replace(/\s+/g, "");
const heard = (text, part) => compact(text).includes(compact(part));
const heardAll = (text, parts) => parts.every((part) => heard(text, part));

/* ─────────────────── fixtures ─────────────────── */

async function makeOwner() {
  const email = `wf-${randomBytes(5).toString("hex")}@example.test`;
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

const on = (id) => ({ id, enabled: true, required: true });
const off = (id) => ({ id, enabled: false, required: true });
const HEALTH_ONLY = () => [on("herd_health"), off("herd_count")];
const CAMELS = ["نورة", "مزون"];

/** A fresh ranch and an empty call log. Older ranches are deleted, because the cron route walks every ranch. */
async function makeFarm({ plan = "basic", camels = CAMELS, resources = [], custom = [], questions = HEALTH_ONLY, tasks = [] } = {}) {
  sql("delete from farms");
  await resetOutbound();
  const account = await makeOwner();
  const opened = await account({ op: "open" });
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened)}`);
  const farm = opened.data.farmId;
  const list = resources.map(q).join(",") || "''";
  sql(`update farms set plan = ${q(plan)}, setup_complete = true, name = 'عزبة الاختبار', owner_name = 'سالم', owner_phone = ${q(OWNER)}, herd_count = null, report_mode = 'guided' where id = ${q(farm)};
    update workers set name = 'يوسف', phone = ${q(WORKER)}, language = 'ar' where farm_id = ${q(farm)};
    update farms set primary_worker_id = (select id from workers where farm_id = ${q(farm)} limit 1) where id = ${q(farm)};
    update resources set present = kind::text in (${list}) where farm_id = ${q(farm)};`);
  const camelIds = {};
  for (const name of camels) camelIds[name] = sql(`insert into camels (farm_id, name, tag) values (${q(farm)}, ${q(name)}, 'T1') returning id`);
  const customIds = custom.map((text, index) => sql(`insert into custom_questions (farm_id, text, sort_order) values (${q(farm)}, ${q(text)}, ${index}) returning id`));
  if (questions) sql(`update farms set question_plan = ${q(JSON.stringify(questions(customIds)))}::jsonb where id = ${q(farm)}`);
  const taskIds = tasks.map((instruction) => sql(`insert into task_tickets (farm_id, instruction) values (${q(farm)}, ${q(instruction)}) returning id`));
  return { farm, plan, account, camelIds, customIds, taskIds };
}

const riyadh = (minutes) => `(now() at time zone 'Asia/Riyadh' + interval '${minutes} minutes')`;
const weekday = (minutes, shift = 0) => `(extract(dow from ${riyadh(minutes)})::int + ${shift}) % 7`;

/** The owner's chosen worker slot, `minutes` from now. Basic needs a weekday, Ultimate needs only the time. */
function setWorkerSlot(ranch, minutes, { dayShift = 0 } = {}) {
  sql(`update farms set call_day = ${ranch.plan === "ultimate" ? "null" : weekday(minutes, dayShift)}, call_time = ${riyadh(minutes)}::time where id = ${q(ranch.farm)}`);
}
function setOwnerSlot(ranch, minutes, { dayShift = 0 } = {}) {
  sql(`update farms set owner_call_day = ${ranch.plan === "ultimate" ? "null" : weekday(minutes, dayShift)}, owner_call_time = ${riyadh(minutes)}::time where id = ${q(ranch.farm)}`);
}

const count = (table, farm, where = "true") => Number(sql(`select count(*) from ${table} where farm_id = ${q(farm)} and ${where}`));
const rows = (query) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(t)), '[]') from (${query}) t`));
const reportsOf = (farm) => rows(`select * from reports where farm_id = ${q(farm)} order by at`);
const answersOf = (farm) => rows(`select a.* from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm)} order by a.sort_order`);
const reportRuns = (farm) => rows(`select * from report_call_runs where farm_id = ${q(farm)} order by occurrence desc`);
const ownerRun = (farm) => JSON.parse(sql(`select owner_call_run::text from farms where id = ${q(farm)}`) || "null");
const ownerCalls = (farm) => rows(`select * from calls where farm_id = ${q(farm)} and kind = 'owner_notification' order by at`);
const tasksOf = (farm) => rows(`select * from task_tickets where farm_id = ${q(farm)} order by created_at, instruction`);
const relaysOf = (farm) => rows(`select * from relays where farm_id = ${q(farm)} order by at`);
const eventsOf = (farm) => rows(`select * from events where farm_id = ${q(farm)} order by at`);
const pendingCalls = (farm) => rows(`select p.*, (select count(*) from worker_call_attempts a where a.pending_call_id = p.id)::int as attempts,
  (select coalesce(json_agg(a.answered order by a.at), '[]') from worker_call_attempts a where a.pending_call_id = p.id) as answered,
  (select coalesce(json_agg(l.task_ticket_id), '[]') from pending_worker_call_tasks l where l.pending_call_id = p.id and l.covered_order is not null) as covered
  from pending_worker_calls p where p.farm_id = ${q(farm)} order by p.created_at`);
const taskOf = (farm, id) => tasksOf(farm).find((task) => task.id === id);
const pastIso = `to_char(now() at time zone 'utc' - interval '1 second', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Twenty minutes pass: the stored retry times move into the past. */
function retriesDue(ranch) {
  sql(`update report_call_runs set next_attempt_at = now() - interval '1 second' where farm_id = ${q(ranch.farm)} and state = 'calling' and next_attempt_at is not null;
    update pending_worker_calls set next_attempt_at = now() - interval '1 second' where farm_id = ${q(ranch.farm)} and state = 'pending' and next_attempt_at is not null;
    update farms set owner_call_run = jsonb_set(owner_call_run, '{nextAttemptAt}', to_jsonb(${pastIso})) where id = ${q(ranch.farm)} and owner_call_run ->> 'nextAttemptAt' is not null;`);
}
const twentyMinutesOut = (iso) => Boolean(iso) && Math.abs(Date.parse(iso) - Date.now() - TWENTY_MINUTES) < 90_000;

function rawSession(sid) {
  const raw = sql(`select session::text from voice_call_sessions where call_sid = ${q(sid)}`);
  return raw ? JSON.parse(raw) : null;
}
function state(sid) {
  const session = rawSession(sid);
  return session && { step: session.step, q: session.data?.currentQuestionId, data: session.data, draft: session.draft, replies: session.replies, done: session.done };
}
/** The same id `reportSummaryId` gives: the session row holds the last agent line. */
function summaryIdOf(sid, locale = "ar") {
  const session = rawSession(sid);
  const text = [...session.turns].reverse().find((entry) => entry.speaker === "agent")?.text[locale] ?? "";
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 33 + text.charCodeAt(index)) >>> 0;
  return `${session.data.draftRevision ?? 0}:${hash.toString(36)}`;
}

async function tick({ clean = true } = {}) {
  const response = await fetch(`${APP}/api/cron/report-calls`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  const body = await response.json();
  if (clean && (!body.ok || body.errors)) check("the cron tick runs cleanly", false, body);
  return body;
}

/* ─────────────────── the call ─────────────────── */

const output = (raw) => {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return raw; }
};
const marks = (stream, prefix) => stream.sent("mark").filter((event) => event.mark?.name?.startsWith(prefix)).length;
const tokenOf = (request) => JSON.parse(Buffer.from(new URL(request.Url).searchParams.get("s").split(".")[0], "base64url").toString("utf8"));

class Call {
  constructor(request) {
    this.request = request;
    this.sid = request.sid;
    this.to = request.To;
    this.xml = "";
    this.status = 0;
  }
  get text() { return says(this.xml); }
  get action() { return gather(this.xml); }
  get connect() { return parseConnect(this.xml); }
  get redirect() { return redirectOf(this.xml); }
  get token() { return tokenOf(this.request); }
  async answer() {
    Object.assign(this, await post(this.request.Url, callFields(this.sid, this.to)));
    this.ticket = this.connect?.ticket;
    this.afterUrl = this.connect?.action;
    this.streamUrl = this.connect?.url;
    return this;
  }
  open() {
    return connectStream({ bridgeUrl: `ws://127.0.0.1:${BRIDGE_PORT}${new URL(this.streamUrl).pathname}`, publicUrl: this.streamUrl, authToken: AUTH_TOKEN, callSid: this.sid, accountSid: ACCOUNT_SID, ticket: this.ticket });
  }
  async after() {
    Object.assign(this, await post(this.afterUrl, callFields(this.sid, this.to)));
    return this;
  }
  async turn(input) {
    if (!this.action) throw new Error(`No Gather to answer: ${this.xml.slice(0, 200)}`);
    Object.assign(this, await post(this.action, callFields(this.sid, this.to, input)));
    return this;
  }
  /** Twilio follows the <Redirect> only after the whole summary was spoken. */
  async heardToEnd() {
    if (!this.redirect) throw new Error(`No Redirect to follow: ${this.xml.slice(0, 200)}`);
    Object.assign(this, await post(this.redirect, callFields(this.sid, this.to)));
    return this;
  }
  finalStatus(status = "completed") {
    return post(this.request.StatusCallback, callFields(this.sid, this.to, { CallStatus: status, CallDuration: "42", SequenceNumber: "3", CallbackSource: "call-progress-events", Timestamp: new Date().toUTCString() }));
  }
}

/** A live realtime call: the person talks, the mock model classifies with tools, the server speaks. */
class Live {
  constructor(call, stream, upstream) { Object.assign(this, { call, stream, upstream }); }
  get spoken() { return this.upstream.spoken; }
  get said() { return this.spoken.at(-1) ?? ""; }
  get s() { return state(this.call.sid); }
  async settle(spoken, prompts, summaries, out, name) {
    await until(() => this.spoken.length > spoken && marks(this.stream, "prompt-") > prompts, `the line after ${name}`);
    if (out?.isSummary) {
      await until(() => marks(this.stream, "summary-") > summaries, "the summary's playback mark");
      await sleep(60);
    }
  }
  async say(words, name, args = {}, { speech: waitForSpeech = true, ...options } = {}) {
    const [spoken, prompts, summaries] = [this.spoken.length, marks(this.stream, "prompt-"), marks(this.stream, "summary-")];
    this.upstream.workerSays(words);
    const out = output(await this.upstream.toolCall(name, args, options));
    if (waitForSpeech && out !== null) await this.settle(spoken, prompts, summaries, out, name);
    return out;
  }
  /** A saving turn: the server says goodbye over the stream, closes it, and Twilio fetches /after. */
  async closing(words, name, args) {
    const out = await this.say(words, name, args, { speech: false });
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

async function openLive(call) {
  const opened = await call.open();
  if (!opened.stream) throw new Error(`Bridge refused the upgrade: ${opened.refused} ${opened.body}`);
  const stream = opened.stream;
  stream.connected();
  stream.start();
  const upstream = await provider.next();
  await upstream.waitForEvent((event) => event.type === "session.update", 20_000, "session.update");
  await upstream.waitForEvent((event) => event.type === "response.create" && typeof event.response?.instructions === "string", 10_000, "opening line");
  await until(() => upstream.spoken.length >= 1 && marks(stream, "prompt-") >= 1, "the opening played");
  await sleep(50);
  return new Live(call, stream, upstream);
}

async function answerLive(request) {
  const call = new Call(request);
  await call.answer();
  if (!call.connect) throw new Error(`Answer TwiML has no <Connect>: ${call.xml.slice(0, 400)}`);
  return openLive(call);
}

/** The provider is down: the stream closes at once and the call continues by script. */
async function answerScripted(request) {
  const call = new Call(request);
  await call.answer();
  if (!call.connect) throw new Error(`Answer TwiML has no <Connect>: ${call.xml.slice(0, 400)}`);
  provider.options.refuseStatus = 503;
  try {
    const opened = await call.open();
    if (!opened.stream) throw new Error(`upgrade refused: ${opened.refused}`);
    opened.stream.connected();
    opened.stream.start();
    await opened.stream.waitClosed(10_000);
  } finally {
    provider.options.refuseStatus = null;
  }
  await call.after();
  return call;
}

/** One manual report through the real line, so owner scenarios start from real saved facts. */
async function saveReport(ranch) {
  await resetOutbound();
  const opened = await ranch.account({ op: "callNow" });
  if (!opened.ok || opened.data?.status === "blocked") throw new Error(`callNow failed: ${JSON.stringify(opened)}`);
  await waitFor(async () => (await outbound()).length >= 1, "provider request", 80);
  const live = await answerLive((await outbound())[0]);
  const summary = await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  if (summary?.isSummary !== true) throw new Error(`no summary: ${JSON.stringify(summary)}`);
  const saved = await live.closing("إيه احفظه", "confirm_report", { confirmed: true });
  if (saved?.status !== "saved") throw new Error(`not saved: ${JSON.stringify(saved)}`);
  await live.call.finalStatus();
  await resetOutbound();
  return reportsOf(ranch.farm).at(-1);
}

/** A task the worker has already heard about, without staging a whole instruction call first. */
function addTask(ranch, instruction, scheduledAt = null) {
  return sql(`insert into task_tickets (farm_id, instruction, scheduled_for) values (${q(ranch.farm)}, ${q(instruction)}, ${scheduledAt ? q(scheduledAt) : "null"}) returning id`);
}
const minutesAgoIso = (minutes) => new Date(Math.floor(Date.now() / 60_000) * 60_000 - minutes * 60_000).toISOString();
const riyadhTomorrowAt = (hour) => {
  const date = new Date(Date.now() + 3 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
  return `${date}T${String(hour).padStart(2, "0")}:00:00+03:00`;
};
function addPendingCall(ranch, { purpose, message, taskIds, state: callState = "pending", dueInMinutes = 30 }) {
  const id = sql(`insert into pending_worker_calls (farm_id, purpose, message, task_ticket_id, next_attempt_at, state, task_links_explicit)
    values (${q(ranch.farm)}, ${q(purpose)}, ${q(message)}, ${taskIds.length === 1 ? q(taskIds[0]) : "null"}, ${callState === "pending" ? `now() + interval '${dueInMinutes} minutes'` : "null"}, ${q(callState)}, true) returning id`);
  taskIds.forEach((taskId, order) => sql(`insert into pending_worker_call_tasks (farm_id, pending_call_id, task_ticket_id, covered_order) values (${q(ranch.farm)}, ${q(id)}, ${q(taskId)}, ${order}) on conflict (farm_id, pending_call_id, task_ticket_id) do update set covered_order = excluded.covered_order`));
  return id;
}

/* ─────────────────── scenarios ─────────────────── */

let provider;

scenario("M0", "Every migration this workflow needs is applied", async () => {
  for (const file of REQUIRED_MIGRATIONS) check(`${file} is in the tree`, existsSync(join(SRC, "supabase/migrations", file)));
  const columns = sql("select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name = 'farms' and column_name in ('owner_call_day', 'owner_call_time', 'owner_call_run')");
  check("the owner schedule and owner run columns exist", ["owner_call_day", "owner_call_time", "owner_call_run"].every((name) => columns.includes(name)), columns);
  const guards = sql("select count(*) from pg_trigger where tgname in ('task_tickets_ultimate_only', 'relays_ultimate_only', 'pending_worker_calls_ultimate_only')");
  check("the three Basic guard triggers exist", guards === "3", guards);
});

scenario("A1", "Basic: weekly worker report and owner slots, on the owner's chosen days and times", async () => {
  const ranch = await makeFarm();
  setWorkerSlot(ranch, -1, { dayShift: 2 });
  setOwnerSlot(ranch, -1, { dayShift: 2 });
  let result = await tick();
  check("another weekday dials nobody", result.placed === 0 && (await outbound()).length === 0, { result, dials: await outbound() });
  setWorkerSlot(ranch, 30);
  setOwnerSlot(ranch, 40);
  result = await tick();
  check("a time later today dials nobody", result.placed === 0 && (await outbound()).length === 0, { result, dials: await outbound() });
  setWorkerSlot(ranch, -1);
  result = await tick();
  check("the worker's chosen weekday and time dials the worker", result.placed === 1 && (await dialsTo(WORKER)).length === 1, { result, dials: await outbound() });
  check("the owner is not dialled at the worker's slot", (await dialsTo(OWNER)).length === 0);
  const [run] = reportRuns(ranch.farm);
  check("the run is for this occurrence, scheduled, attempt 1", run?.trigger === "schedule" && run?.attempts.length === 1 && run?.state === "calling", run);
  check("the attempt is signed with its number", tokenOf((await dialsTo(WORKER))[0]).n === 1, tokenOf((await dialsTo(WORKER))[0]));
  result = await tick();
  check("a second tick for the same slot places nothing", result.placed === 0 && (await outbound()).length === 1, { result, dials: (await outbound()).length });

  const live = await answerLive((await dialsTo(WORKER))[0]);
  await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  const saved = await live.closing("إيه احفظه", "confirm_report", { confirmed: true });
  check("the worker's scheduled report saves", saved?.status === "saved", saved);
  await live.call.finalStatus();
  setOwnerSlot(ranch, 40);
  check("a saved report does not dial the owner", (await tick()).placed === 0 && (await dialsTo(OWNER)).length === 0, await outbound());
  setOwnerSlot(ranch, -1);
  result = await tick();
  check("the owner's own weekday and time dials the owner", result.placed === 1 && (await dialsTo(OWNER)).length === 1, { result, dials: await outbound() });
  check("the owner slot is signed with its attempt and report", tokenOf((await dialsTo(OWNER))[0]).n === 1 && tokenOf((await dialsTo(OWNER))[0]).r === reportsOf(ranch.farm)[0]?.id, tokenOf((await dialsTo(OWNER))[0]));
  check("a second tick does not open the owner slot again", (await tick()).placed === 0 && (await dialsTo(OWNER)).length === 1);
});

scenario("A2", "Ultimate: daily worker report and owner slots, on any day, from the owner's chosen times", async () => {
  const ranch = await makeFarm({ plan: "ultimate" });
  setWorkerSlot(ranch, 30);
  setOwnerSlot(ranch, 40);
  check("a later time today dials nobody", (await tick()).placed === 0 && (await outbound()).length === 0, await outbound());
  setWorkerSlot(ranch, -1);
  const result = await tick();
  check("the daily worker slot dials the worker", result.placed === 1 && (await dialsTo(WORKER)).length === 1, { result, dials: await outbound() });
  check("the worker slot does not dial the owner", (await dialsTo(OWNER)).length === 0);
  const live = await answerLive((await dialsTo(WORKER))[0]);
  await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  const saved = await live.closing("إيه احفظه", "confirm_report", { confirmed: true });
  check("the report saves", saved?.status === "saved", saved);
  await live.call.finalStatus();
  setOwnerSlot(ranch, -1);
  check("the daily owner slot dials the owner", (await tick()).placed === 1 && (await dialsTo(OWNER)).length === 1, await outbound());
});

scenario("B1", "Worker report: unanswered and interrupted each use an attempt, 3 attempts 20 minutes apart, then missed", async () => {
  const ranch = await makeFarm();
  setWorkerSlot(ranch, -1);
  await tick();
  // Attempt 1: nobody picks up.
  let [request] = await dialsTo(WORKER);
  check("attempt 1 is dialled", tokenOf(request).n === 1);
  const first = new Call(request);
  await first.finalStatus("no-answer");
  let [run] = reportRuns(ranch.farm);
  check("an unanswered attempt stays calling, 20 minutes out", run.state === "calling" && twentyMinutesOut(run.next_attempt_at) && run.attempts[0].result === "no_answer", run);
  check("no redial before the 20 minutes pass", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 1, await dialsTo(WORKER));
  retriesDue(ranch);
  check("attempt 2 is dialled when due", (await tick()).placed === 1 && (await dialsTo(WORKER)).length === 2, await dialsTo(WORKER));

  // Attempt 2: the worker picks up, then the line drops before a save.
  request = (await dialsTo(WORKER))[1];
  check("attempt 2 is numbered 2", tokenOf(request).n === 2);
  const live = await answerLive(request);
  await live.hangUp();
  check("an interrupted attempt saves nothing", reportsOf(ranch.farm).length === 0, reportsOf(ranch.farm));
  [run] = reportRuns(ranch.farm);
  check("the interrupted attempt stays calling, 20 minutes out", run.state === "calling" && twentyMinutesOut(run.next_attempt_at), run);
  check("no redial before the 20 minutes pass", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 2);
  retriesDue(ranch);
  check("attempt 3 is dialled when due", (await tick()).placed === 1 && (await dialsTo(WORKER)).length === 3, await dialsTo(WORKER));

  // Attempt 3: nobody picks up. No more attempts are left.
  request = (await dialsTo(WORKER))[2];
  check("attempt 3 is numbered 3", tokenOf(request).n === 3);
  await new Call(request).finalStatus("busy");
  [run] = reportRuns(ranch.farm);
  check("the third failure ends the run as missed", run.state === "missed" && run.next_attempt_at === null && run.attempts.length === 3, run);
  check("the attempts are recorded in order", run.attempts.map((a) => a.result).join() === "no_answer,answered,no_answer", run.attempts);
  check("no report", reportsOf(ranch.farm).length === 0);
  check("no further dial after the run is missed", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 3);
  check("the owner was not dialled by the worker's attempts", (await dialsTo(OWNER)).length === 0, await outbound());
});

scenario("B2", "Worker report: a saved report stops the attempts", async () => {
  const ranch = await makeFarm();
  setWorkerSlot(ranch, -1);
  await tick();
  await new Call((await dialsTo(WORKER))[0]).finalStatus("no-answer");
  retriesDue(ranch);
  await tick();
  const live = await answerLive((await dialsTo(WORKER))[1]);
  await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  const saved = await live.closing("إيه احفظه", "confirm_report", { confirmed: true });
  check("attempt 2 saves", saved?.status === "saved", saved);
  await live.call.finalStatus();
  const [run] = reportRuns(ranch.farm);
  const report = reportsOf(ranch.farm)[0];
  check("the run is completed and linked to its report", run.state === "completed" && run.report_id === report?.id && run.next_attempt_at === null, run);
  retriesDue(ranch);
  check("no third attempt", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 2, await dialsTo(WORKER));
  check("saving dialled nobody else", (await dialsTo(OWNER)).length === 0, await outbound());
});

scenario("C1", "Owner call: the scheduled summary is built from real report facts and completes when heard to the end", async () => {
  const ranch = await makeFarm();
  const report = await saveReport(ranch);
  const [answer] = answersOf(ranch.farm);
  setOwnerSlot(ranch, -1);
  check("the owner slot dials the owner", (await tick()).placed === 1 && (await dialsTo(OWNER)).length === 1, await outbound());
  const call = new Call((await dialsTo(OWNER))[0]);
  await call.answer();
  check("the summary names who reported", heard(call.text, "وصل تقرير من يوسف"), call.text);
  check("the summary reads the saved answer", heard(call.text, answer.answer_ar ?? answer.answer), { saved: answer, said: call.text });
  check("the summary says when the report came", /اليوم|أمس/.test(call.text), call.text);
  check("a Basic call plays to a redirect", Boolean(call.redirect) && !call.action && !call.connect, call.xml.slice(0, 500));
  check("the attempt is answered, not yet completed", ownerRun(ranch.farm).state === "answered", ownerRun(ranch.farm));
  await call.heardToEnd();
  check("the end of the summary hangs up", /<Hangup\s*\/?>/.test(call.xml), call.xml);
  const run = ownerRun(ranch.farm);
  check("the run is completed for this report", run.state === "completed" && run.reportId === report.id && run.attempts[0].result === "completed", run);
  check("one completed owner call is logged", ownerCalls(ranch.farm).length === 1 && ownerCalls(ranch.farm)[0].outcome === "completed" && ownerCalls(ranch.farm)[0].report_id === report.id, ownerCalls(ranch.farm));
  await call.finalStatus();
  check("the final status cannot downgrade it", ownerRun(ranch.farm).state === "completed" && ownerCalls(ranch.farm).length === 1, ownerRun(ranch.farm));
  retriesDue(ranch);
  check("a completed call is not retried", (await tick()).placed === 0 && (await dialsTo(OWNER)).length === 1, await dialsTo(OWNER));
});

scenario("C2", "Owner call: unanswered and interrupted each use an attempt, 20 minutes apart, then missed", async () => {
  const ranch = await makeFarm();
  const report = await saveReport(ranch);
  setOwnerSlot(ranch, -1);
  await tick();
  await new Call((await dialsTo(OWNER))[0]).finalStatus("no-answer");
  let run = ownerRun(ranch.farm);
  check("attempt 1 unanswered keeps calling, 20 minutes out", run.state === "calling" && run.attempts[0].result === "unanswered" && twentyMinutesOut(run.nextAttemptAt), run);
  check("no redial before the 20 minutes pass", (await tick()).placed === 0 && (await dialsTo(OWNER)).length === 1);
  retriesDue(ranch);
  check("attempt 2 is dialled", (await tick()).placed === 1 && (await dialsTo(OWNER)).length === 2);

  const second = new Call((await dialsTo(OWNER))[1]);
  check("attempt 2 is numbered 2", second.token.n === 2);
  await second.answer();
  await second.finalStatus("completed");
  run = ownerRun(ranch.farm);
  check("hanging up before the end is interrupted, not completed", run.state === "calling" && run.attempts[1].result === "interrupted" && twentyMinutesOut(run.nextAttemptAt), run);
  check("an interrupted attempt logs no completed owner call", !ownerCalls(ranch.farm).some((row) => row.outcome === "completed"), ownerCalls(ranch.farm));
  retriesDue(ranch);
  check("attempt 3 is dialled", (await tick()).placed === 1 && (await dialsTo(OWNER)).length === 3);

  const third = new Call((await dialsTo(OWNER))[2]);
  check("attempt 3 is numbered 3", third.token.n === 3);
  await third.finalStatus("busy");
  run = ownerRun(ranch.farm);
  check("the third failure ends the run as missed", run.state === "missed" && run.nextAttemptAt === null && run.attempts.length === 3, run);
  check("the attempts are recorded in order", run.attempts.map((a) => a.result).join() === "unanswered,interrupted,unanswered", run.attempts);
  const missed = ownerCalls(ranch.farm).filter((row) => row.outcome === "no_answer");
  check("exactly one missed notification, for this report", missed.length === 1 && missed[0].report_id === report.id, ownerCalls(ranch.farm));
  check("exactly one honest event for the failure", eventsOf(ranch.farm).filter((event) => /ما اكتملت مكالمة/.test(event.text_ar)).length === 1, eventsOf(ranch.farm).map((event) => event.text_ar));
  check("no further dial", (await tick()).placed === 0 && (await dialsTo(OWNER)).length === 3);
});

scenario("C3", "Owner call: retries stop as soon as a call completes", async () => {
  const ranch = await makeFarm();
  await saveReport(ranch);
  setOwnerSlot(ranch, -1);
  await tick();
  await new Call((await dialsTo(OWNER))[0]).finalStatus("no-answer");
  retriesDue(ranch);
  await tick();
  const second = new Call((await dialsTo(OWNER))[1]);
  await second.answer();
  await second.heardToEnd();
  await second.finalStatus();
  const run = ownerRun(ranch.farm);
  check("attempt 2 completes the run", run.state === "completed" && run.attempts.length === 2 && run.attempts[1].result === "completed" && run.nextAttemptAt === null, run);
  retriesDue(ranch);
  check("no attempt 3", (await tick()).placed === 0 && (await dialsTo(OWNER)).length === 2, await dialsTo(OWNER));
  check("one completed notification", ownerCalls(ranch.farm).filter((row) => row.outcome === "completed").length === 1, ownerCalls(ranch.farm));
});

scenario("D1", "No verified report: the owner slot waits for the worker's attempts, then the owner is told the truth", async () => {
  const ranch = await makeFarm();
  setWorkerSlot(ranch, -1);
  setOwnerSlot(ranch, -1);
  const opened = await tick();
  check("the shared minute dials only the worker", opened.placed === 1 && (await dialsTo(WORKER)).length === 1 && (await dialsTo(OWNER)).length === 0, { opened, dials: await outbound() });
  check("no owner run opens while the worker run is live", ownerRun(ranch.farm) === null, ownerRun(ranch.farm));
  await new Call((await dialsTo(WORKER))[0]).finalStatus("no-answer");
  check("still deferred while a retry waits", (await tick()).placed === 0 && (await dialsTo(OWNER)).length === 0, await outbound());
  retriesDue(ranch);
  await tick();
  await new Call((await dialsTo(WORKER))[1]).finalStatus("no-answer");
  retriesDue(ranch);
  await tick();
  check("the owner is not dialled during the third attempt", (await dialsTo(OWNER)).length === 0, await outbound());
  await new Call((await dialsTo(WORKER))[2]).finalStatus("no-answer");
  check("the worker's run ended as missed", reportRuns(ranch.farm)[0].state === "missed", reportRuns(ranch.farm)[0]);
  const after = await tick();
  check("once the attempts end, the owner is dialled", after.placed === 1 && (await dialsTo(OWNER)).length === 1, { after, dials: await outbound() });
  const call = new Call((await dialsTo(OWNER))[0]);
  check("the token says no report", call.token.r === "", call.token);
  await call.answer();
  check("the owner is told no report arrived", heard(call.text, "ما وصلنا أي تقرير مؤكد من يوسف إلى الآن"), call.text);
  check("the owner is told the last call failed", heard(call.text, "آخر مكالمة") && heard(call.text, "ما نجحت"), call.text);
  check("the owner is told nothing new is known", heard(call.text, "ما عندي معلومات جديدة"), call.text);
  await call.heardToEnd();
  await call.finalStatus();
  const run = ownerRun(ranch.farm);
  check("a truthful no-report call still completes", run.state === "completed" && run.reportId === null, run);
  check("it is logged against no report", ownerCalls(ranch.farm).length === 1 && ownerCalls(ranch.farm)[0].report_id === null && ownerCalls(ranch.farm)[0].outcome === "completed", ownerCalls(ranch.farm));
});

scenario("D2", "No verified report: a later slot says so and never replays the last report as new", async () => {
  const ranch = await makeFarm();
  const report = await saveReport(ranch);
  const [saved] = answersOf(ranch.farm);
  setOwnerSlot(ranch, -3);
  await tick();
  const first = new Call((await dialsTo(OWNER))[0]);
  await first.answer();
  await first.heardToEnd();
  await first.finalStatus();
  check("the first slot delivered the report", ownerRun(ranch.farm).state === "completed" && ownerRun(ranch.farm).reportId === report.id, ownerRun(ranch.farm));
  setOwnerSlot(ranch, -1);
  check("the next slot dials the owner", (await tick()).placed === 1 && (await dialsTo(OWNER)).length === 2, await dialsTo(OWNER));
  const second = new Call((await dialsTo(OWNER))[1]);
  check("the next slot carries no report", second.token.r === "", second.token);
  await second.answer();
  check("the owner hears there is nothing new since the last report", heard(second.text, "ما وصلنا تقرير مؤكد جديد من يوسف بعد آخر تقرير"), second.text);
  check("the old report's facts are not read as news", !heard(second.text, saved.answer_ar ?? saved.answer) && !heard(second.text, "اللي انسجل"), second.text);
  check("the owner is told nothing new is known", heard(second.text, "ما عندي معلومات جديدة"), second.text);
});

scenario("D3", "Owner slot: deferral stops before the grace period ends, and a slot past it is skipped", async () => {
  let ranch = await makeFarm();
  setWorkerSlot(ranch, -1);
  setOwnerSlot(ranch, -55);
  const result = await tick();
  check("a slot near the end of its hour opens even with a worker run live", (await dialsTo(OWNER)).length === 1, { result, dials: await outbound() });
  check("the worker's slot also opens", (await dialsTo(WORKER)).length === 1, await outbound());

  ranch = await makeFarm();
  setOwnerSlot(ranch, -70);
  check("a slot more than an hour old is not called", (await tick()).placed === 0 && (await outbound()).length === 0, await outbound());
  check("no run opens for it", ownerRun(ranch.farm) === null, ownerRun(ranch.farm));
});

scenario("E1", "Basic owner call never offers instructions", async () => {
  const ranch = await makeFarm();
  await saveReport(ranch);
  setOwnerSlot(ranch, -1);
  await tick();
  const call = new Call((await dialsTo(OWNER))[0]);
  await call.answer();
  check("no instruction question", !heard(call.text, "تعليمات"), call.text);
  check("no way to answer: no Gather, no stream", !call.action && !call.connect, call.xml.slice(0, 500));
  check("a voice session is not opened", rawSession(call.sid) === null, rawSession(call.sid));
  await call.heardToEnd();
  check("no tasks, relays or worker calls on Basic", count("task_tickets", ranch.farm) === 0 && count("relays", ranch.farm) === 0 && count("pending_worker_calls", ranch.farm) === 0);
});

/** A plan downgrade between the review and the yes: the only way a Basic farm can reach these guards. */
async function ultimateAtReview({ scripted = false } = {}) {
  const ranch = await makeFarm({ plan: "ultimate" });
  await saveReport(ranch);
  setOwnerSlot(ranch, -1);
  await tick();
  const [request] = await dialsTo(OWNER);
  if (scripted) {
    const call = await answerScripted(request);
    await call.turn(speech("إيه"));
    await call.turn(speech("قل ليوسف يصلح الحوض"));
    await call.turn(keys("1"));
    await call.turn(speech("في أي وقت"));
    await call.turn(speech("لا خلاص"));
    return { ranch, call };
  }
  const live = await answerLive(request);
  await live.say("قل ليوسف يصلح الحوض بأي وقت", "propose_instructions", { items: [{ message: "يصلح الحوض", kind: "task", due: "any_time", evidence: "يصلح الحوض بأي وقت" }] });
  return { ranch, live };
}

scenario("E2", "Basic guard: the database refuses tasks, relays and worker calls", async () => {
  const ranch = await makeFarm();
  const refused = (label, query) => {
    let error = "";
    try { sql(query); } catch (caught) { error = String(caught.stderr ?? caught.message); }
    check(`${label} is refused`, /Basic plan has no/.test(error), error || "no error");
  };
  refused("a task ticket", `insert into task_tickets (farm_id, instruction) values (${q(ranch.farm)}, 'صلح الحوض')`);
  refused("a relay", `insert into relays (farm_id, message) values (${q(ranch.farm)}, 'سلم على الجماعة')`);
  refused("a worker call", `insert into pending_worker_calls (farm_id, purpose, message) values (${q(ranch.farm)}, 'instruction', 'صلح الحوض')`);
  check("nothing was written", count("task_tickets", ranch.farm) === 0 && count("relays", ranch.farm) === 0 && count("pending_worker_calls", ranch.farm) === 0);
});

scenario("E3", "Basic guard: the contract refuses an instruction when the plan drops to Basic mid-call", async () => {
  const { ranch, live } = await ultimateAtReview();
  check("the review is reached on Ultimate", live.s?.step === "instruction_review", live.s?.step);
  sql(`update farms set plan = 'basic' where id = ${q(ranch.farm)}`);
  const out = await live.closing("إيه احفظها", "confirm_instructions", { confirmed: true });
  check("the save is not claimed", out?.status === "save_failed" && !live.spoken.some((line) => /انحفظ\. /.test(line)), { out, spoken: live.spoken });
  await live.call.finalStatus();
  check("the contract wrote nothing", count("task_tickets", ranch.farm) === 0 && count("relays", ranch.farm) === 0 && count("pending_worker_calls", ranch.farm) === 0);
  check("no worker call is dialled", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 0, await outbound());
});

scenario("E4", "Basic guard: the domain refuses an instruction on the scripted path after a downgrade", async () => {
  const { ranch, call } = await ultimateAtReview({ scripted: true });
  check("the review is reached on Ultimate", state(call.sid)?.step === "instruction_review", state(call.sid)?.step);
  sql(`update farms set plan = 'basic' where id = ${q(ranch.farm)}`);
  await call.turn(speech("إيه احفظها"));
  check("the caller hears nothing was saved", heard(call.text, "ما انحفظ شيء"), call.text);
  check("the domain wrote nothing", count("task_tickets", ranch.farm) === 0 && count("relays", ranch.farm) === 0 && count("pending_worker_calls", ranch.farm) === 0);
});

scenario("E5", "Basic guard: a worker call already pending is neither dialled nor answered after a downgrade", async () => {
  const ranch = await makeFarm({ plan: "ultimate" });
  const taskId = addTask(ranch, "صلح الحوض");
  addPendingCall(ranch, { purpose: "instruction", message: "صلح الحوض", taskIds: [taskId] });
  retriesDue(ranch);
  await tick();
  const [request] = await dialsTo(WORKER);
  check("Ultimate dials the pending worker call", Boolean(request), await outbound());
  sql(`update farms set plan = 'basic' where id = ${q(ranch.farm)}`);
  const call = new Call(request);
  await call.answer();
  check("answering a Basic farm's worker call only says goodbye", !call.action && !heard(call.text, "صلح الحوض") && rawSession(call.sid) === null, call.xml.slice(0, 300));
  retriesDue(ranch);
  check("Basic never dials a pending worker call", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 1, await dialsTo(WORKER));
});

const PROPOSALS = (due) => [
  { message: "يصلح الحوض", kind: "task", due, evidence: "يصلح الحوض بكرة الساعة خمسة العصر" },
  { message: "ينظف المظلة", kind: "task", due: "any_time", evidence: "ينظف المظلة بأي وقت" },
  { message: "البيطري بيجي الخميس", kind: "information", due: null, evidence: "البيطري بيجي الخميس" },
  { message: "الخزان يبي غسيل", kind: "information", due: null, evidence: "الخزان يبي غسيل" },
];
const OWNER_WORDS = "قل ليوسف يصلح الحوض بكرة الساعة خمسة العصر، وينظف المظلة بأي وقت، وترى البيطري بيجي الخميس، وبعد الخزان يبي غسيل";
const REVIEW_LABELS = ["فهمتها مهمة", "فهمتها معلومة فقط"];

async function ultimateCall({ ranch } = {}) {
  const farm = ranch ?? await makeFarm({ plan: "ultimate" });
  await saveReport(farm);
  setOwnerSlot(farm, -1);
  const result = await tick();
  check("the owner slot dials the owner", result.placed === 1 && (await dialsTo(OWNER)).length === 1, { result, dials: await outbound() });
  return { ranch: farm, request: (await dialsTo(OWNER)).at(-1) };
}

scenario("F1", "Ultimate instructions by voice: natural speech, proposal, read-back, correction, one batch, tickets only for tasks", async () => {
  const { ranch, request } = await ultimateCall();
  const live = await answerLive(request);
  check("the summary comes first", heard(live.spoken[0], "وصل تقرير من يوسف"), live.spoken[0]);
  check("the instruction question comes after the summary", heard(live.spoken[0], "هل عندك أي تعليمات تبي أقولها للعامل"), live.spoken[0]);
  check("the engine waits on the question", live.s?.step === "instruction_yesno", live.s?.step);
  check("the model is offered the owner tools", live.upstream.of("session.update")[0]?.session?.tools?.some((tool) => tool.name === "propose_instructions"), live.upstream.of("session.update")[0]?.session?.tools?.map((tool) => tool.name));

  const before = count("task_tickets", ranch.farm);
  const review = await live.say(OWNER_WORDS, "propose_instructions", { items: PROPOSALS(riyadhTomorrowAt(17)) });
  const first = live.said;
  check("the proposal reaches a read-back of the whole list", review?.isSummary === true && live.s?.step === "instruction_review", review);
  check("every item is read back with its kind", heardAll(first, ["يصلح الحوض", "ينظف المظلة", "البيطري بيجي الخميس", "الخزان يبي غسيل", ...REVIEW_LABELS]), first);
  check("the time is read back", heard(first, "موعدها"), first);
  check("the any-time task is read back as any time", heard(first, "في أي وقت"), first);
  check("the owner can save or change something", heard(first, "أحفظها، ولا تبي تغير شي؟"), first);
  check("nothing is saved during the proposal", count("task_tickets", ranch.farm) === before && count("pending_worker_calls", ranch.farm) === 0, { tasks: count("task_tickets", ranch.farm), calls: count("pending_worker_calls", ranch.farm) });

  const firstId = summaryIdOf(live.call.sid);
  await live.say("لا الخزان خلها مهمة", "correct_instruction", { index: 3, kind: "task" });
  check("the correction asks when the new task is due", live.s?.step === "instruction_schedule" && heard(live.said, "متى ودك تنفذ هذي المهمة"), { step: live.s?.step, said: live.said });
  const reread = await live.say("بأي وقت", "correct_instruction", { index: 3, due: "any_time" });
  const second = live.said;
  check("the corrected list is read back in full", reread?.isSummary === true && heardAll(second, ["يصلح الحوض", "ينظف المظلة", "البيطري بيجي الخميس", "الخزان يبي غسيل"]), second);
  check("the correction changes what the owner hears", heard(second, "فهمتها مهمة، في أي وقت: الخزان يبي غسيل"), second);
  check("the correction changes the summary id", summaryIdOf(live.call.sid) !== firstId, { firstId, now: summaryIdOf(live.call.sid) });

  const fingerprint = JSON.stringify(live.s?.data.pendingInstructions);
  const stale = await internal("tool", { ticket: live.call.ticket, callSid: live.call.sid, toolCallId: `stale-${randomBytes(3).toString("hex")}`, name: "confirm_instructions", args: { confirmed: true }, userSpokeSinceLastTool: true, workerUtterance: "إيه احفظها", heardSummaryId: firstId });
  const staleOut = output(stale.json?.output);
  check("a confirmation of the old read-back is refused", staleOut?.error === "summary_not_finished", stale.text.slice(0, 300));
  check("the refused confirmation changes and saves nothing", JSON.stringify(live.s?.data.pendingInstructions) === fingerprint && count("task_tickets", ranch.farm) === before && count("pending_worker_calls", ranch.farm) === 0, live.s?.data);

  const saved = await live.closing("إيه احفظها", "confirm_instructions", { confirmed: true });
  check("a clear yes after the full read-back saves", saved?.status === "saved", saved);
  check("the owner hears the outcome only after the save", live.spoken.some((line) => /انحفظ\. 3 تذكرة مهمة/.test(line)), live.spoken.slice(-2));
  check("/after only hangs up", /<Hangup/.test(live.call.xml) && !/<Gather/.test(live.call.xml), live.call.xml.slice(0, 300));
  await live.call.finalStatus();

  const tasks = tasksOf(ranch.farm);
  check("a ticket for each task and none for the information", tasks.map((t) => t.instruction).sort().join("|") === ["الخزان يبي غسيل", "ينظف المظلة", "يصلح الحوض"].sort().join("|"), tasks.map((t) => t.instruction));
  check("the task with a time keeps it", Date.parse(tasks.find((t) => t.instruction === "يصلح الحوض")?.scheduled_for) === Date.parse(riyadhTomorrowAt(17)), tasks);
  check("any-time tasks have no time", tasks.filter((t) => t.instruction !== "يصلح الحوض").every((t) => t.scheduled_for === null), tasks);
  const relays = relaysOf(ranch.farm);
  check("the information is one undelivered relay", relays.length === 1 && relays[0].message === "البيطري بيجي الخميس" && relays[0].delivered === false, relays);
  const calls = pendingCalls(ranch.farm);
  check("one batch makes exactly one worker call", calls.length === 1 && calls[0].purpose === "instruction" && calls[0].state === "pending" && calls[0].covered.length === 3, calls);
  check("the owner run is completed", ownerRun(ranch.farm).state === "completed", ownerRun(ranch.farm));
  check("the completed run logs one owner call", ownerCalls(ranch.farm).length === 1 && ownerCalls(ranch.farm)[0].outcome === "completed", ownerCalls(ranch.farm));

  const dial = await tick();
  check("one worker call is dialled for the whole batch", dial.placed === 1 && (await dialsTo(WORKER)).length === 1, { dial, dials: await dialsTo(WORKER) });
  check("a second tick does not dial again", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 1);
});

scenario("F2", "Ultimate instructions: interrupted before confirmation saves nothing and retries", async () => {
  const { ranch, request } = await ultimateCall();
  const live = await answerLive(request);
  await live.say(OWNER_WORDS, "propose_instructions", { items: PROPOSALS(riyadhTomorrowAt(17)) });
  check("the review is reached", live.s?.step === "instruction_review", live.s?.step);
  await live.hangUp();
  check("nothing was saved", count("task_tickets", ranch.farm) === 0 && count("relays", ranch.farm) === 0 && count("pending_worker_calls", ranch.farm) === 0, tasksOf(ranch.farm));
  let run = ownerRun(ranch.farm);
  check("the attempt is interrupted, 20 minutes out", run.state === "calling" && run.attempts[0].result === "interrupted" && twentyMinutesOut(run.nextAttemptAt), run);
  check("no redial before the retry is due", (await tick()).placed === 0 && (await dialsTo(OWNER)).length === 1);
  retriesDue(ranch);
  check("the retry is dialled", (await tick()).placed === 1 && (await dialsTo(OWNER)).length === 2, await dialsTo(OWNER));
  const retry = await answerLive((await dialsTo(OWNER))[1]);
  check("the retry carries the summary again", heard(retry.spoken[0], "وصل تقرير من يوسف"), retry.spoken[0]);
  await retry.say(OWNER_WORDS, "propose_instructions", { items: PROPOSALS(riyadhTomorrowAt(17)) });
  const saved = await retry.closing("إيه احفظها", "confirm_instructions", { confirmed: true });
  check("the retry saves", saved?.status === "saved", saved);
  await retry.call.finalStatus();
  check("one worker call is created", pendingCalls(ranch.farm).length === 1, pendingCalls(ranch.farm));
  run = ownerRun(ranch.farm);
  check("the retry completes the run", run.state === "completed" && run.attempts.length === 2, run);
});

scenario("F3", "Ultimate instructions: the scripted fallback asks the owner, labels the owner's choice, and saves once", async () => {
  const { ranch, request } = await ultimateCall();
  const call = await answerScripted(request);
  check("the call continues by script", Boolean(call.action) && heard(call.text, "بنكمل المكالمة"), call.text);
  check("the instruction question is asked", heard(call.text, "هل عندك أي تعليمات"), call.text);
  await call.turn(speech("إيه"));
  check("the script asks for the words", state(call.sid)?.step === "instruction_text", state(call.sid)?.step);
  await call.turn(speech("قل ليوسف يصلح الحوض"));
  check("the script asks the owner task or information", state(call.sid)?.step === "instruction_kind" && heard(call.text, "معلومة فقط"), { step: state(call.sid)?.step, text: call.text });
  await call.turn(keys("1"));
  check("the script asks when", state(call.sid)?.step === "instruction_schedule", state(call.sid)?.step);
  await call.turn(speech("في أي وقت"));
  check("the script asks for more", state(call.sid)?.step === "instruction_more", state(call.sid)?.step);
  await call.turn(speech("لا خلاص"));
  check("the read-back labels the owner's choice", state(call.sid)?.step === "instruction_review" && heard(call.text, "حددتها مهمة"), { step: state(call.sid)?.step, text: call.text });
  check("nothing saved before the yes", count("task_tickets", ranch.farm) === 0 && count("pending_worker_calls", ranch.farm) === 0);
  await call.turn(speech("إيه احفظها"));
  check("the owner hears it was saved", heard(call.text, "انحفظ"), call.text);
  await call.finalStatus();
  check("one ticket and one worker call", count("task_tickets", ranch.farm) === 1 && pendingCalls(ranch.farm).length === 1, { tasks: tasksOf(ranch.farm), calls: pendingCalls(ranch.farm) });
  check("the run is completed", ownerRun(ranch.farm).state === "completed", ownerRun(ranch.farm));
});

scenario("F4", "Ultimate: declining instructions completes the call and saves nothing", async () => {
  const { ranch, request } = await ultimateCall();
  const live = await answerLive(request);
  await live.closing("لا ما عندي شي", "no_instructions", {});
  await live.call.finalStatus();
  const run = ownerRun(ranch.farm);
  check("declining completes the run", run.state === "completed" && run.attempts[0].result === "completed", run);
  check("nothing else was created", count("task_tickets", ranch.farm) === 0 && count("relays", ranch.farm) === 0 && count("pending_worker_calls", ranch.farm) === 0);
  check("no worker call follows", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 0, await dialsTo(WORKER));
});

async function pendingInstruction(ranch, message = "صلح الحوض\nالبيطري بيجي الخميس") {
  const taskId = addTask(ranch, "صلح الحوض");
  const id = addPendingCall(ranch, { purpose: "instruction", message, taskIds: [taskId] });
  retriesDue(ranch);
  return { taskId, id };
}

scenario("G1", "Worker delivery: three attempts, interrupted counts, and a call that isn't confirmed isn't delivered", async () => {
  const ranch = await makeFarm({ plan: "ultimate" });
  await pendingInstruction(ranch);
  check("attempt 1 is dialled", (await tick()).placed === 1 && (await dialsTo(WORKER)).length === 1, await dialsTo(WORKER));
  const first = new Call((await dialsTo(WORKER))[0]);
  check("attempt 1 is numbered 1", first.token.n === 1, first.token);
  await first.finalStatus("no-answer");
  let [pending] = pendingCalls(ranch.farm);
  check("unanswered is an attempt, retried in 20 minutes", pending.state === "pending" && pending.attempts === 1 && pending.answered[0] === false && twentyMinutesOut(pending.next_attempt_at), pending);
  check("no redial before the retry is due", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 1);
  retriesDue(ranch);
  check("attempt 2 is dialled", (await tick()).placed === 1 && (await dialsTo(WORKER)).length === 2);

  const second = new Call((await dialsTo(WORKER))[1]);
  check("attempt 2 is numbered 2", second.token.n === 2, second.token);
  await second.answer();
  check("the worker hears the message", heardAll(second.text, ["رسالة من سالم", "صلح الحوض", "البيطري بيجي الخميس"]), second.text);
  check("the worker is asked for a receipt", heard(second.text, "سمعت كل التعليمات؟"), second.text);
  await second.finalStatus("completed");
  [pending] = pendingCalls(ranch.farm);
  check("hanging up before the receipt is an interrupted attempt", pending.state === "pending" && pending.attempts === 2 && pending.answered[1] === true && twentyMinutesOut(pending.next_attempt_at), pending);
  check("the instruction is not marked delivered", ownerRun(ranch.farm) === null && !rows(`select * from calls where farm_id = ${q(ranch.farm)} and kind = 'worker_instruction' and outcome = 'completed'`).length);
  retriesDue(ranch);
  check("attempt 3 is dialled", (await tick()).placed === 1 && (await dialsTo(WORKER)).length === 3);

  await new Call((await dialsTo(WORKER))[2]).finalStatus("busy");
  [pending] = pendingCalls(ranch.farm);
  check("after 3 attempts the calls stop", pending.state !== "pending" && pending.next_attempt_at === null && pending.attempts === 3, pending);
  check("no fourth attempt", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 3);
  check("the task stays open", tasksOf(ranch.farm).every((task) => task.status === "open"), tasksOf(ranch.farm));
});

scenario("G2", "Worker delivery: delivered only after an explicit receipt", async () => {
  const ranch = await makeFarm({ plan: "ultimate" });
  await pendingInstruction(ranch);
  await tick();
  const call = new Call((await dialsTo(WORKER))[0]);
  await call.answer();
  await call.turn(speech("الجو حار اليوم"));
  let [pending] = pendingCalls(ranch.farm);
  check("words that aren't a receipt deliver nothing", pending.state === "pending" && pending.attempts === 0, pending);
  check("the receipt is asked again", heard(call.text, "سمعت كل التعليمات؟") && Boolean(call.action), call.text);
  await call.turn(speech("إيه سمعتها"));
  check("an explicit receipt ends the call", !call.action, call.xml.slice(0, 300));
  await call.finalStatus();
  [pending] = pendingCalls(ranch.farm);
  check("an explicit receipt delivers it", pending.state === "delivered" && pending.attempts === 1 && pending.next_attempt_at === null, pending);
  check("the delivery is logged", rows(`select * from calls where farm_id = ${q(ranch.farm)} and kind = 'worker_instruction' and outcome = 'completed'`).length === 1);
  check("the task stays open until the worker confirms it", tasksOf(ranch.farm).every((task) => task.status === "open"), tasksOf(ranch.farm));
  retriesDue(ranch);
  check("a delivered call is not retried", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 1);
});

scenario("H1", "Grouped verification: tasks due together share one call, different times get separate calls", async () => {
  const ranch = await makeFarm({ plan: "ultimate" });
  setOwnerSlot(ranch, 30);
  const at = minutesAgoIso(2);
  const a = addTask(ranch, "صلح الحوض", at);
  const b = addTask(ranch, "نظف المظلة", at);
  const c = addTask(ranch, "اغسل الخزان", minutesAgoIso(4));
  await tick();
  const calls = pendingCalls(ranch.farm).filter((call) => call.purpose === "task_verification");
  check("two calls for two distinct times", calls.length === 2, calls);
  const together = calls.find((call) => call.covered.length === 2);
  const alone = calls.find((call) => call.covered.length === 1);
  check("the tasks due together share one call", Boolean(together) && together.covered.includes(a) && together.covered.includes(b), calls);
  check("the task with another time has its own call", Boolean(alone) && alone.covered[0] === c, calls);
  check("the first tick dials one call", (await dialsTo(WORKER)).length === 1, await dialsTo(WORKER));
  await tick();
  check("the next tick dials the other", (await dialsTo(WORKER)).length === 2, await dialsTo(WORKER));
  check("no further dial", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 2);
});

scenario("H2", "Grouped verification: each yes closes only its task; a partial answer retries only what is left", async () => {
  const ranch = await makeFarm({ plan: "ultimate" });
  setOwnerSlot(ranch, 30);
  const at = minutesAgoIso(2);
  const a = addTask(ranch, "صلح الحوض", at);
  const b = addTask(ranch, "نظف المظلة", at);
  await tick();
  const first = new Call((await dialsTo(WORKER))[0]);
  await first.answer();
  const [firstTask, secondTask] = heard(first.text, "صلح الحوض") ? [a, b] : [b, a];
  const firstName = firstTask === a ? "صلح الحوض" : "نظف المظلة";
  const secondName = firstTask === a ? "نظف المظلة" : "صلح الحوض";
  check("the worker hears one task at a time", heard(first.text, firstName) && !heard(first.text, secondName), first.text);
  await first.turn(speech("إيه خلصت"));
  check("the yes closes only that task", taskOf(ranch.farm, firstTask).status === "closed" && taskOf(ranch.farm, firstTask).closed_via === "worker_task_verification" && taskOf(ranch.farm, secondTask).status === "open", tasksOf(ranch.farm));
  check("the next task is asked", heard(first.text, secondName) && Boolean(first.action), first.text);
  await first.turn(speech("ما أدري"));
  check("not knowing leaves it open", taskOf(ranch.farm, secondTask).status === "open", tasksOf(ranch.farm));
  check("the worker is told a retry is coming", heard(first.text, "بتصل عليك بعد"), first.text);
  await first.finalStatus();
  let [pending] = pendingCalls(ranch.farm).filter((call) => call.purpose === "task_verification");
  check("the attempt is not delivered and retries in 20 minutes", pending.state === "pending" && pending.attempts === 1 && twentyMinutesOut(pending.next_attempt_at), pending);
  retriesDue(ranch);
  check("the retry is dialled", (await tick()).placed === 1 && (await dialsTo(WORKER)).length === 2, await dialsTo(WORKER));

  const retry = new Call((await dialsTo(WORKER))[1]);
  await retry.answer();
  check("the retry asks only the open task", heard(retry.text, secondName) && !heard(retry.text, firstName), retry.text);
  await retry.turn(speech("إيه خلصت"));
  await retry.finalStatus();
  check("the second yes closes the other task", taskOf(ranch.farm, secondTask).status === "closed", tasksOf(ranch.farm));
  [pending] = pendingCalls(ranch.farm).filter((call) => call.purpose === "task_verification");
  check("every task answered: the call is delivered", pending.state === "delivered" && pending.next_attempt_at === null, pending);
  check("no further dial", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 2);
});

scenario("H3", "Grouped verification: nothing closes without an explicit yes", async () => {
  const ranch = await makeFarm({ plan: "ultimate" });
  setOwnerSlot(ranch, 30);
  const at = minutesAgoIso(2);
  const a = addTask(ranch, "صلح الحوض", at);
  const b = addTask(ranch, "نظف المظلة", at);
  await tick();
  let call = new Call((await dialsTo(WORKER))[0]);
  await call.answer();
  await call.turn(speech("الجو حار اليوم"));
  check("unrelated words close nothing", tasksOf(ranch.farm).every((task) => task.status === "open"), tasksOf(ranch.farm));
  await call.turn(speech("لا باقي"));
  check("a no closes nothing", tasksOf(ranch.farm).every((task) => task.status === "open"), tasksOf(ranch.farm));
  await call.turn(speech("لا باقي"));
  check("two no's keep both open", taskOf(ranch.farm, a).status === "open" && taskOf(ranch.farm, b).status === "open", tasksOf(ranch.farm));
  await call.finalStatus();
  let [pending] = pendingCalls(ranch.farm).filter((item) => item.purpose === "task_verification");
  check("an explicit no on every task delivers the call", pending.state === "delivered", pending);

  const second = await makeFarm({ plan: "ultimate" });
  setOwnerSlot(second, 30);
  const other = addTask(second, "صلح الحوض", at);
  await tick();
  call = new Call((await dialsTo(WORKER))[0]);
  await call.answer();
  await call.finalStatus("completed");
  [pending] = pendingCalls(second.farm).filter((item) => item.purpose === "task_verification");
  check("hanging up closes nothing and counts as an attempt", taskOf(second.farm, other).status === "open" && pending.state === "pending" && pending.attempts === 1 && twentyMinutesOut(pending.next_attempt_at), { task: taskOf(second.farm, other), pending });
});

scenario("I", "Report queue: skips undelivered and actively verified tasks, asks the rest once", async () => {
  const ranch = await makeFarm({ plan: "ultimate" });
  const undelivered = addTask(ranch, "صلح الحوض");
  addPendingCall(ranch, { purpose: "instruction", message: "صلح الحوض", taskIds: [undelivered] });
  const verifying = addTask(ranch, "نظف المظلة", minutesAgoIso(5));
  addPendingCall(ranch, { purpose: "task_verification", message: "نظف المظلة", taskIds: [verifying] });
  const ready = addTask(ranch, "اغسل الخزان");
  addPendingCall(ranch, { purpose: "instruction", message: "اغسل الخزان", taskIds: [ready], state: "delivered" });

  await resetOutbound();
  const opened = await ranch.account({ op: "callNow" });
  if (!opened.ok || opened.data?.status === "blocked") throw new Error(`callNow failed: ${JSON.stringify(opened)}`);
  await waitFor(async () => (await outbound()).length >= 1, "provider request", 80);
  const live = await answerLive((await outbound())[0]);
  const queue = (live.s?.data.queue ?? []).filter((item) => item.kind === "task");
  check("only the delivered, unverified task is queued", queue.length === 1 && queue[0].taskId === ready, queue);
  await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  check("the worker is asked about it", heard(live.said, "اغسل الخزان"), live.said);
  await live.say("إيه خلصت", "answer_question", { value: "yes", topic: "task" });
  const asked = live.spoken.join(" ");
  check("the undelivered task is never asked", !heard(asked, "صلح الحوض"), asked);
  check("the actively verified task is never asked", !heard(asked, "نظف المظلة"), asked);
  check("the ready task is asked once", asked.split("اغسل الخزان").length - 1 === 2, asked);
  const saved = await live.closing("إيه احفظه", "confirm_report", { confirmed: true });
  check("the report saves", saved?.status === "saved", saved);
  await live.call.finalStatus();
  check("the worker's yes closes that task", taskOf(ranch.farm, ready).status === "closed" && taskOf(ranch.farm, ready).closed_via === "worker_report", taskOf(ranch.farm, ready));
  check("the other two stay open", taskOf(ranch.farm, undelivered).status === "open" && taskOf(ranch.farm, verifying).status === "open", tasksOf(ranch.farm));
});

const NOTE_WORDS = "العلف زين";

scenario("J1", "Off-topic words are kept as a note and read back, on realtime", async () => {
  const ranch = await makeFarm();
  await resetOutbound();
  await ranch.account({ op: "callNow" });
  await waitFor(async () => (await outbound()).length >= 1, "provider request", 80);
  const live = await answerLive((await outbound())[0]);
  const refused = await live.say(NOTE_WORDS, "answer_question", { value: "yes", topic: "herd" });
  check("the answer is not taken for the question", refused?.error === "answer_off_topic" && live.s?.step === "report_question", refused);
  check("the worker hears it is a note and the question again", heardAll(live.said, ["سجلتها ملاحظة", "وضع الحلال"]), live.said);
  check("the note is kept, nothing is guessed", live.s?.draft.answers.some((answer) => answer.answer === NOTE_WORDS) && live.s?.draft.camelUpdates.length === 0, live.s?.draft);
  const summary = await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  check("the note is read back", summary?.isSummary === true && heard(live.said, NOTE_WORDS), live.said);
  if (summary?.isSummary !== true) { await live.hangUp(); return; }
  const saved = await live.closing("إيه احفظه", "confirm_report", { confirmed: true });
  check("the report saves", saved?.status === "saved", saved);
  await live.call.finalStatus();
  check("the note is saved in the worker's words", answersOf(ranch.farm).some((row) => row.answer === NOTE_WORDS), answersOf(ranch.farm));
  check("the feed resource isn't changed by a note", count("reports", ranch.farm) === 1 && rows(`select * from findings f join reports r on r.id = f.report_id where r.farm_id = ${q(ranch.farm)}`).length === 0, rows(`select * from findings f join reports r on r.id = f.report_id where r.farm_id = ${q(ranch.farm)}`));
});

scenario("J2", "Off-topic words are kept as a note and read back, on the scripted path", async () => {
  const ranch = await makeFarm();
  await resetOutbound();
  await ranch.account({ op: "callNow" });
  await waitFor(async () => (await outbound()).length >= 1, "provider request", 80);
  const call = await answerScripted((await outbound())[0]);
  check("the script asks the question", heard(call.text, "وضع الحلال") && Boolean(call.action), call.text);
  await call.turn(speech(NOTE_WORDS));
  const after = state(call.sid);
  check("the words did not answer the question", after?.step === "report_question" && after?.draft.answers.every((answer) => answer.questionId !== "herd_health"), after?.draft);
  check("the note is kept", after?.draft.answers.some((answer) => answer.answer === NOTE_WORDS), after?.draft);
  check("the question is asked again", heard(call.text, "وضع الحلال") && Boolean(call.action), call.text);
  await call.turn(speech("كلها بخير"));
  check("the note is read back", heard(call.text, NOTE_WORDS) && heard(call.text, "أحفظه"), call.text);
  if (!heard(call.text, "أحفظه")) { await call.finalStatus(); return; }
  await call.turn(keys("1"));
  check("the worker hears the save", /(?<!ما )انحفظ التحديث/.test(call.text), call.text);
  await call.finalStatus();
  check("the note is saved in the worker's words", answersOf(ranch.farm).some((row) => row.answer === NOTE_WORDS), answersOf(ranch.farm));
});

scenario("K1", "A provider refusal is not an attempt", async () => {
  // Worker report run.
  let ranch = await makeFarm();
  setWorkerSlot(ranch, -1);
  await setOutbound(503);
  let result = await tick();
  check("the refused worker call is counted as failed, not placed", result.placed === 0 && result.failed === 1, result);
  let [run] = reportRuns(ranch.farm);
  check("a refused worker call uses no attempt", run.attempts.length === 0 && run.state === "calling" && twentyMinutesOut(run.next_attempt_at), run);
  await setOutbound(201, true);
  retriesDue(ranch);
  result = await tick();
  check("the next try is attempt 1", result.placed === 1 && tokenOf((await dialsTo(WORKER))[0]).n === 1, tokenOf((await dialsTo(WORKER))[0]));

  // Owner run.
  ranch = await makeFarm();
  setOwnerSlot(ranch, -1);
  await setOutbound(503);
  result = await tick();
  check("the refused owner call is counted as failed, not placed", result.placed === 0 && result.failed === 1, result);
  let owner = ownerRun(ranch.farm);
  check("a refused owner call uses no attempt", owner.attempts.length === 0 && owner.state === "calling" && twentyMinutesOut(owner.nextAttemptAt), owner);
  check("no missed notification is logged", ownerCalls(ranch.farm).length === 0, ownerCalls(ranch.farm));
  await setOutbound(201, true);
  retriesDue(ranch);
  result = await tick();
  check("the next try is attempt 1", result.placed === 1 && tokenOf((await dialsTo(OWNER))[0]).n === 1, tokenOf((await dialsTo(OWNER))[0]));
  owner = ownerRun(ranch.farm);
  check("the run counts one attempt", owner.attempts.length === 1, owner);

  // Instruction call.
  ranch = await makeFarm({ plan: "ultimate" });
  await pendingInstruction(ranch);
  await setOutbound(503);
  result = await tick();
  check("the refused worker call is counted as failed", result.placed === 0 && result.failed === 1, result);
  const [pending] = pendingCalls(ranch.farm);
  check("a refused instruction call uses no attempt", pending.state === "pending" && pending.attempts === 0 && twentyMinutesOut(pending.next_attempt_at), pending);
  await setOutbound(201, true);
  check("it is not retried on the very next tick", (await tick()).placed === 0 && (await dialsTo(WORKER)).length === 0, await dialsTo(WORKER));
  retriesDue(ranch);
  result = await tick();
  check("the next try is attempt 1", result.placed === 1 && tokenOf((await dialsTo(WORKER))[0]).n === 1, tokenOf((await dialsTo(WORKER))[0]));
});

scenario("K2", "Duplicate cron ticks don't dial twice", async () => {
  let ranch = await makeFarm();
  setWorkerSlot(ranch, -1);
  await Promise.all([tick({ clean: false }), tick({ clean: false }), tick({ clean: false })]);
  await sleep(300);
  check("concurrent ticks dial the worker once", (await dialsTo(WORKER)).length === 1, await dialsTo(WORKER));
  check("one attempt recorded", reportRuns(ranch.farm)[0].attempts.length === 1, reportRuns(ranch.farm)[0]);
  ranch = await makeFarm();
  setOwnerSlot(ranch, -1);
  await Promise.all([tick({ clean: false }), tick({ clean: false }), tick({ clean: false })]);
  await sleep(300);
  check("concurrent ticks dial the owner once", (await dialsTo(OWNER)).length === 1, await dialsTo(OWNER));
  check("one owner attempt recorded", ownerRun(ranch.farm).attempts.length === 1, ownerRun(ranch.farm));
  ranch = await makeFarm({ plan: "ultimate" });
  await pendingInstruction(ranch);
  await Promise.all([tick({ clean: false }), tick({ clean: false }), tick({ clean: false })]);
  await sleep(300);
  check("concurrent ticks dial the worker call once", (await dialsTo(WORKER)).length === 1, await dialsTo(WORKER));
  check("no attempt was claimed twice", pendingCalls(ranch.farm)[0].state === "pending", pendingCalls(ranch.farm)[0]);
});

scenario("K3", "Late Twilio callbacks can't downgrade a completed run", async () => {
  const ranch = await makeFarm();
  const report = await saveReport(ranch);
  setOwnerSlot(ranch, -1);
  await tick();
  await new Call((await dialsTo(OWNER))[0]).finalStatus("no-answer");
  retriesDue(ranch);
  await tick();
  const [firstRequest, secondRequest] = await dialsTo(OWNER);
  const first = new Call(firstRequest);
  const second = new Call(secondRequest);
  await second.answer();
  const late = await first.finalStatus("completed");
  check("a late callback for an earlier attempt is accepted", late.status === 204, late);
  let run = ownerRun(ranch.farm);
  check("a late callback for an earlier attempt can't touch the one running", run.state === "answered" && run.attempts.length === 2 && run.attempts[1].result === "pending", run);
  await second.heardToEnd();
  await second.finalStatus("completed");
  await second.finalStatus("no-answer");
  await second.finalStatus("busy");
  run = ownerRun(ranch.farm);
  check("a completed run stays completed through late callbacks", run.state === "completed" && run.reportId === report.id && run.attempts[1].result === "completed", run);
  check("one completed notification, no missed one", ownerCalls(ranch.farm).filter((row) => row.outcome === "completed").length === 1 && ownerCalls(ranch.farm).filter((row) => row.outcome === "no_answer").length === 0, ownerCalls(ranch.farm));

  const worker = await makeFarm();
  setWorkerSlot(worker, -1);
  await tick();
  const live = await answerLive((await dialsTo(WORKER))[0]);
  await live.say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  await live.closing("إيه احفظه", "confirm_report", { confirmed: true });
  await live.call.finalStatus("completed");
  await live.call.finalStatus("no-answer");
  const [runRow] = reportRuns(worker.farm);
  check("a saved report's run stays completed through late callbacks", runRow.state === "completed" && reportsOf(worker.farm).length === 1, runRow);

  const task = await makeFarm({ plan: "ultimate" });
  await pendingInstruction(task);
  await tick();
  const delivery = new Call((await dialsTo(WORKER))[0]);
  await delivery.answer();
  await delivery.turn(speech("إيه سمعتها"));
  await delivery.finalStatus("completed");
  await delivery.finalStatus("no-answer");
  check("a delivered call stays delivered through late callbacks", pendingCalls(task.farm)[0].state === "delivered", pendingCalls(task.farm)[0]);
});

/** Compile the routes before a call so a dev-server compile can't hit the bridge's 5 s internal timeout. */
async function warmUp() {
  for (const path of ["session", "tool"]) await fetch(`${APP}/api/voice/realtime/${path}`, { method: "POST", body: "{}" }).catch(() => {});
  const sid = `CA${"3".repeat(32)}`;
  const routes = ["/api/voice/realtime/after?s=x", "/api/voice/turn?n=0", "/api/voice/outbound?s=x", "/api/voice/outbound/status?s=x", "/api/voice/owner?s=x", "/api/voice/owner/heard?s=x", "/api/voice/owner/status?s=x", "/api/voice/worker?s=x", "/api/voice/worker/status?s=x"];
  for (const target of routes) await post(target, callFields(sid, WORKER)).catch(() => {});
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
      check("no No Answer ticket row was ever created", sql("select count(*) from no_answer_tickets") === "0", sql("select count(*) from no_answer_tickets"));
    } catch (error) {
      current.error = error.stack ?? String(error);
      console.log(`  ERROR ${error.message}`);
    } finally {
      provider.options.refuseStatus = null;
      await setOutbound(201).catch(() => {});
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
