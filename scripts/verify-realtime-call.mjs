#!/usr/bin/env node
/**
 * LOCAL ONLY, no paid service. Drives realtime voice report calls end to end: the real signed Next webhooks
 * and internal API, the real voice bridge, and a throwaway Postgres + PostgREST. OpenAI is the loopback mock in
 * scripts/mocks/realtime-provider.mjs and Twilio is the media-stream client in scripts/mocks/twilio-media.mjs.
 * The bridge runs with a preloaded guard that refuses every non-loopback socket.
 *
 *   node scripts/verify-realtime-call.mjs [--label final] [--only R1,R6] [--skip-scripted] [--keep-src]
 *
 * The model only ever calls tools; the server chooses every spoken word, and the mock plays it back verbatim.
 * Results: /tmp/naqah-rm-rt/logs/<label>/ (result.json, summary.txt, next.log, bridge.log). Exit code 1 on any failure.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockRealtime } from "./mocks/realtime-provider.mjs";
import { connectStream, SILENCE, VOICED } from "./mocks/twilio-media.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = "/tmp/naqah-rm-rt";
const SRC = join(ROOT, "src");
const BASE = join(ROOT, "base");
const PGDATA = join(ROOT, "pg");
const SOCK = join(ROOT, "sock");
const LABEL = arg("label", "run");
const LOGS = join(ROOT, "logs", LABEL);
const ONLY = arg("only", "")?.split(",").filter(Boolean);
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const PG_PORT = "54480";
const REST_PORT = "54481";
const GATEWAY_PORT = "54482";
const APP_PORT = "3720";
const BRIDGE_PORT = "3722";
const PROVIDER_PORT = 3723;
const REFUSE_BRIDGE_PORT = "3724";
const REWRITE_PROXY_PORT = "3725";
const LIMITS_BRIDGE_PORT = "3726";
const DB = "naqah_rt3";
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const PUBLIC = "https://naqah-rt3.example.test";
const BRIDGE_PUBLIC = "wss://naqah-rt3.example.test/voice-bridge/media";
const AUTH_TOKEN = "local-test-auth-token";
const SECRET = "local-only-voice-secret-for-realtime-scenarios";
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
/** Polls faster than waitFor: a call turn takes milliseconds. */
async function until(probe, what, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (probe()) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/* ─────────────────── environment ─────────────────── */

function exportTree() {
  mkdirSync(SRC, { recursive: true });
  execFileSync("rsync", ["-a", "--delete", "--exclude", "node_modules", "--exclude", ".next", "--exclude", ".env*", "--exclude", ".git", `${REPO}/`, `${SRC}/`]);
  if (!existsSync(join(SRC, "node_modules"))) execFileSync("cp", ["-c", "-R", join(REPO, "node_modules"), join(SRC, "node_modules")]);
  const bridgeModules = join(REPO, "services/voice-bridge/node_modules");
  if (existsSync(bridgeModules) && !existsSync(join(SRC, "services/voice-bridge/node_modules"))) {
    execFileSync("cp", ["-c", "-R", bridgeModules, join(SRC, "services/voice-bridge/node_modules")]);
  }
  return execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

function exportBaseline() {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
  execFileSync("sh", ["-c", `git -C "${REPO}" archive HEAD | tar -C "${BASE}" -xf -`]);
  execFileSync("cp", ["-c", "-R", join(SRC, "node_modules"), join(BASE, "node_modules")]);
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

const appEnv = (extra) => ({
  ...baseEnv, PATH, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--import=${join(SRC, "supabase/local-validation/mock-outbound.mjs")}`,
  NAQAH_TEST_OUTBOUND_GATEWAY: `${GATEWAY}/`,
  ...stackKeys,
  NEXT_PUBLIC_NAQAH_ACCOUNT_DATA: "1",
  NAQAH_VOICE_MODE: "farm", NAQAH_VOICE_LOCALE: "ar", NAQAH_VOICE_SECRET: SECRET, NAQAH_PUBLIC_BASE_URL: PUBLIC,
  NAQAH_MANUAL_REPORT_CALLS: "1", NAQAH_SCHEDULED_CALLS: "1", NAQAH_CALL_OWNER: "1", NAQAH_CALL_ALLOWLIST: `${WORKER},${OWNER}`,
  CRON_SECRET, TWILIO_ACCOUNT_SID: ACCOUNT_SID, TWILIO_AUTH_TOKEN: AUTH_TOKEN, TWILIO_PHONE_NUMBER: TWILIO_NUMBER,
  ...extra,
});

async function startNext(name, cwd, extra) {
  background(name, join(cwd, "node_modules/.bin/next"), ["dev", "-p", APP_PORT, "-H", "127.0.0.1"], appEnv(extra), cwd);
  await waitFor(async () => (await fetch(`${APP}/api/cron/report-calls`)).status === 401, `${name} ready`, 480);
}

const REALTIME_ENV = { NAQAH_VOICE_ENGINE: "realtime", NAQAH_BRIDGE_PUBLIC_URL: BRIDGE_PUBLIC };

const bridgeEntry = () => {
  const dir = join(SRC, "services/voice-bridge");
  const manifest = existsSync(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) : {};
  const found = [manifest.main, "index.mjs"].filter(Boolean).find((file) => existsSync(join(dir, file)));
  if (!found) throw new Error(`No bridge entry in ${dir}`);
  return join(dir, found);
};

const bridgeEnv = (port, extra = {}) => ({
  ...baseEnv, PATH, NODE_ENV: "production",
  NODE_OPTIONS: `--import=${join(REPO, "scripts/mocks/loopback-guard.mjs")}`,
  PORT: port, NAQAH_BRIDGE_PUBLIC_URL: BRIDGE_PUBLIC, NAQAH_BRIDGE_UPSTREAM: APP,
  NAQAH_REALTIME_URL: `ws://127.0.0.1:${PROVIDER_PORT}/v1/realtime`,
  NAQAH_VOICE_SECRET: SECRET, TWILIO_AUTH_TOKEN: AUTH_TOKEN, OPENAI_API_KEY: OPENAI_KEY,
  ...extra,
});

function startBridge(name, port, extra) {
  const entry = bridgeEntry();
  return background(name, process.execPath, [entry], bridgeEnv(port, extra), dirname(entry));
}

/** The real bridge code with shorter limits (the test entry only passes `limits` to createBridge). */
async function startLimitedBridge(limits, extra) {
  await stopChild("bridge-limits");
  const entry = join(REPO, "scripts/mocks/bridge-limits-entry.mjs");
  background("bridge-limits", process.execPath, [entry], bridgeEnv(LIMITS_BRIDGE_PORT, {
    NAQAH_TEST_BRIDGE_SERVER: join(SRC, "services/voice-bridge/server.mjs"),
    NAQAH_TEST_BRIDGE_CONFIG: join(SRC, "services/voice-bridge/config.mjs"),
    NAQAH_TEST_BRIDGE_LIMITS: JSON.stringify(limits),
    ...extra,
  }), dirname(bridgeEntry()));
  await waitFor(() => portOpen(LIMITS_BRIDGE_PORT), "limited bridge listening", 60);
}

/** Next, except /session reports a shorter maxSeconds, so the bridge's own maximum timer can be observed. */
function startRewriteProxy(maxSeconds) {
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const upstream = httpRequest({ host: "127.0.0.1", port: APP_PORT, path: request.url, method: request.method, headers: request.headers }, (incoming) => {
        const body = [];
        incoming.on("data", (chunk) => body.push(chunk));
        incoming.on("end", () => {
          let out = Buffer.concat(body);
          if (request.url === "/api/voice/realtime/session" && incoming.statusCode === 200) out = Buffer.from(JSON.stringify({ ...JSON.parse(out.toString()), maxSeconds }));
          const headers = { ...incoming.headers, "content-length": String(out.length) };
          delete headers["transfer-encoding"];
          response.writeHead(incoming.statusCode, headers);
          response.end(out);
        });
      });
      upstream.on("error", () => { response.writeHead(502); response.end(); });
      upstream.end(Buffer.concat(chunks));
    });
  });
  return new Promise((resolve) => server.listen(Number(REWRITE_PROXY_PORT), "127.0.0.1", () => resolve(server)));
}

async function startRealtimeBridge(extra) {
  await stopChild("bridge");
  startBridge("bridge", BRIDGE_PORT, extra);
  await waitFor(() => portOpen(BRIDGE_PORT), "bridge listening", 60);
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
const faults = (rest) => postJson(`${GATEWAY}/__test/faults`, { rest });

const decode = (text) => text.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
const says = (xml) => [...xml.matchAll(/<Say\b[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => decode(m[1])).join(" ");
const gather = (xml) => {
  const raw = xml.match(/<Gather\b[^>]*\baction="([^"]+)"/)?.[1];
  return raw ? decode(raw) : null;
};
const REALTIME_MODEL_TOOLS = ["answer_question", "record_facts", "finish_update", "choose_mode", "repeat_or_clarify", "confirm_report", "correct_report", "flag_urgent", "end_call"];
const parseConnect = (xml) => {
  const action = xml.match(/<Connect\b[^>]*\baction="([^"]+)"/)?.[1];
  const url = xml.match(/<Stream\b[^>]*\burl="([^"]+)"/)?.[1];
  const ticket = xml.match(/<Parameter\b[^>]*\bname="ticket"[^>]*\bvalue="([^"]+)"/)?.[1];
  return action && url && ticket ? { action: decode(action), url: decode(url), ticket: decode(ticket) } : null;
};

function signature(url, fields, token = AUTH_TOKEN) {
  let value = url;
  for (const key of Object.keys(fields).sort()) value += key + fields[key];
  return createHmac("sha1", token).update(value, "utf8").digest("base64");
}

async function post(target, fields, { token = AUTH_TOKEN, signed = true } = {}) {
  const publicUrl = new URL(target, PUBLIC).toString();
  const parsed = new URL(publicUrl);
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (signed) headers["X-Twilio-Signature"] = signature(publicUrl, fields, token);
  const response = await fetch(`${APP}${parsed.pathname}${parsed.search}`, { method: "POST", headers, body: new URLSearchParams(fields) });
  return { status: response.status, xml: await response.text() };
}

const callFields = (sid, extra) => ({
  AccountSid: ACCOUNT_SID, ApiVersion: "2010-04-01", CallSid: sid, CallStatus: "in-progress",
  Called: WORKER, Caller: TWILIO_NUMBER, Direction: "outbound-api", From: TWILIO_NUMBER, To: WORKER, ...extra,
});
const speech = (text, confidence = "0.92") => ({ SpeechResult: text, Confidence: confidence, msg: "Gather End" });
const keys = (digits) => ({ Digits: digits, msg: "Gather End" });

const signTicket = (fields) => {
  const payload = Buffer.from(JSON.stringify(fields), "utf8").toString("base64url");
  return `${payload}.${createHmac("sha256", SECRET).update(`naqah-realtime-ticket:${payload}`).digest("base64url")}`;
};
const internalKey = createHmac("sha256", SECRET).update("naqah-bridge-internal").digest();
async function internal(path, body, { key = internalKey, timestamp = Date.now(), signature: forced, omit = false } = {}) {
  const raw = JSON.stringify(body);
  const headers = { "Content-Type": "application/json" };
  if (!omit) {
    headers["x-naqah-bridge-timestamp"] = String(timestamp);
    headers["x-naqah-bridge-signature"] = forced ?? createHmac("sha256", key).update(`${timestamp}.${raw}`).digest("hex");
  }
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
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${passed || detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 600)}`}`);
}
const note = (text) => { current.notes.push(text); console.log(`  NOTE ${text}`); };

/* ─────────────────── fixtures ─────────────────── */

async function makeOwner() {
  const email = `rt3-${randomBytes(5).toString("hex")}@example.test`;
  const password = "local-test-password";
  const user = await postJson(`${GATEWAY}/__test/users`, { email, password });
  const session = await postJson(`${GATEWAY}/auth/v1/token?grant_type=password`, { email, password });
  const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const account = async (body) => {
    const response = await fetch(`${APP}/api/account`, { method: "POST", headers: { "Content-Type": "application/json", Origin: APP, Cookie: cookie }, body: JSON.stringify(body) });
    return response.json();
  };
  return { user, account };
}

async function makeFarm({ camels = [], herd = null, resources = [], custom = [] } = {}) {
  const { user, account } = await makeOwner();
  sql(`insert into farms (owner_id, plan, plan_selected_at) values (${q(user.id)}, 'basic', now()) on conflict (owner_id) do update set plan_selected_at = now()`);
  const opened = await account({ op: "open" });
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened)}`);
  const farm = opened.data.farmId;
  const list = resources.map(q).join(",") || "''";
  sql(`update farms set plan = 'basic', setup_complete = true, name = 'عزبة الاختبار', owner_name = 'سالم', owner_phone = ${q(OWNER)}, herd_count = ${herd ?? "null"} where id = ${q(farm)};
    update workers set name = 'يوسف', phone = ${q(WORKER)}, language = 'ar' where farm_id = ${q(farm)};
    update farms set primary_worker_id = (select id from workers where farm_id = ${q(farm)} limit 1) where id = ${q(farm)};
    update resources set present = kind::text in (${list}) where farm_id = ${q(farm)};`);
  for (const name of camels) sql(`insert into camels (farm_id, name, tag) values (${q(farm)}, ${q(name)}, 'T1')`);
  custom.forEach((text, index) => sql(`insert into custom_questions (farm_id, text, sort_order) values (${q(farm)}, ${q(text)}, ${index})`));
  return { farm, owner: user.id, account };
}
const FULL = { camels: ["نورة", "مزون", "شيخة"], herd: 20, resources: ["feed", "water"], custom: ["جا البيطري اليوم؟"] };

const count = (table, farm, where = "true") => Number(sql(`select count(*) from ${table} where farm_id = ${q(farm)} and ${where}`));
const run = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(r) order by occurrence desc), '[]') from report_call_runs r where farm_id = ${q(farm)}`));
const answersOf = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(a) order by a.sort_order), '[]') from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm)}`));
const reportOf = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(r) order by at), '[]') from reports r where farm_id = ${q(farm)}`));
const callRows = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(c) order by at), '[]') from calls c where farm_id = ${q(farm)}`));
const sessions = (sid) => Number(sql(`select count(*) from voice_call_sessions where call_sid = ${q(sid)}`));

/** The call's engine state in the database: the ground truth for "nothing changed". */
function state(sid) {
  const raw = sql(`select session::text from voice_call_sessions where call_sid = ${q(sid)}`);
  if (!raw) return null;
  const session = JSON.parse(raw);
  return { step: session.step, q: session.data?.currentQuestionId, data: session.data, draft: session.draft, replies: session.replies, done: session.done };
}
const fingerprint = (value) => JSON.stringify(value && { step: value.step, data: value.data, draft: value.draft, done: value.done });

async function dashboard(ranch) {
  const loaded = await ranch.account({ op: "load" });
  return loaded.data?.workspace ?? loaded.data ?? loaded;
}

/* ─────────────────── the call ─────────────────── */

const seenTickets = new Set();
const openings = [];

class RealtimeCall {
  constructor(request) {
    this.request = request;
    this.sid = request.sid;
    this.xml = "";
    this.status = 0;
    this.heard = [];
  }
  get text() { return says(this.xml); }
  get action() { return gather(this.xml); }
  get connect() { return parseConnect(this.xml); }
  get ended() { return /<Hangup\s*\/?>/.test(this.xml) || !this.action; }
  async answer() {
    const reply = await post(this.request.Url, callFields(this.sid));
    Object.assign(this, reply);
    this.ticket = this.connect?.ticket;
    if (this.ticket) seenTickets.add(this.ticket);
    this.afterUrl = this.connect?.action;
    this.streamUrl = this.connect?.url;
    return this;
  }
  /** The upgrade Twilio makes for the <Stream> in the answer TwiML. */
  open({ ticket = this.ticket, callSid = this.sid, sig, bridgePort = BRIDGE_PORT } = {}) {
    return connectStream({
      bridgeUrl: `ws://127.0.0.1:${bridgePort}${new URL(this.streamUrl).pathname}`, publicUrl: this.streamUrl, authToken: AUTH_TOKEN,
      callSid, accountSid: ACCOUNT_SID, ticket, signature: sig,
    });
  }
  /** Twilio fetches the <Connect action> after the media WebSocket closes while the call is still up. */
  async after() {
    const reply = await post(this.afterUrl, callFields(this.sid));
    Object.assign(this, reply);
    this.heard.push(this.text);
    return this;
  }
  async turn(input) {
    const action = this.action;
    if (!action) throw new Error(`No Gather to answer: ${this.xml.slice(0, 200)}`);
    Object.assign(this, await post(action, callFields(this.sid, input)));
    this.heard.push(this.text);
    return this;
  }
  finalStatus(CallStatus = "completed") {
    return post(this.request.StatusCallback, callFields(this.sid, { CallStatus, CallDuration: "42", SequenceNumber: "3", CallbackSource: "call-progress-events", Timestamp: new Date().toUTCString() }));
  }
}

async function callNow(ranch) {
  await resetOutbound();
  const result = await ranch.account({ op: "callNow" });
  if (!result.ok || result.data?.status === "blocked") throw new Error(`callNow failed: ${JSON.stringify(result)}`);
  await waitFor(async () => (await outbound()).length >= 1, "provider request", 80);
  return new RealtimeCall((await outbound())[0]);
}

/** Answer the phone and bring up the stream: returns the Twilio side and the provider side. */
async function placeCall(ranch, { startStream = true, bridgePort } = {}) {
  const call = await callNow(ranch);
  await call.answer();
  if (!call.connect) throw new Error(`Answer TwiML has no <Connect>: ${call.xml.slice(0, 400)}`);
  const opened = await call.open({ bridgePort });
  if (!opened.stream) throw new Error(`Bridge refused the upgrade: ${opened.refused} ${opened.body}`);
  const stream = opened.stream;
  stream.connected();
  if (!startStream) return { call, stream, upstream: null };
  stream.start();
  const upstream = await provider.next();
  await upstream.waitForEvent((event) => event.type === "session.update", 20_000, "session.update");
  await upstream.waitForEvent((event) => event.type === "response.create" && typeof event.response?.instructions === "string", 10_000, "opening line");
  await waitFor(() => upstream.spoken.length >= 1 && stream.sent("media").length >= 1, "opening played", 40);
  await until(() => promptMarks(stream) >= 1, "the opening's playback mark");
  await sleep(50);
  return { call, stream, upstream };
}

const output = (raw) => {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return raw; }
};

const promptMarks = (stream) => stream.sent("mark").filter((event) => event.mark?.name?.startsWith("prompt-")).length;
const QUESTION_TOPIC = { herd_health: "herd", herd_count: "herd", feed_level: "feed", water_level: "water" };
const topicOf = (s) => QUESTION_TOPIC[s.q] ?? "other";

/** The worker talks and the model classifies with a tool. Returns the raw output once the server's next line has played. */
async function workerTurn(stream, upstream, words, name, args, { speech = true, ...options } = {}) {
  const spoken = upstream.spoken.length;
  const prompts = promptMarks(stream);
  upstream.workerSays(words);
  const raw = await upstream.toolCall(name, args, options);
  if (speech && raw !== null) await until(() => upstream.spoken.length > spoken && promptMarks(stream) > prompts, `the line after ${name}`);
  return raw;
}

/** Leaves the next server line open after its audio, so the worker can talk over it. */
function holdPlayback(upstream) {
  const finish = upstream.finishSpeaking;
  const held = {};
  upstream.finishSpeaking = (response) => {
    upstream.finishSpeaking = finish;
    held.response = response;
    return response;
  };
  return held;
}

/** One model response with several tool calls: the later ones arrive with no new worker speech. */
function toolBurst(upstream, calls) {
  return (async () => {
    await until(() => upstream.responseSlots.length > 0, "a model turn");
    upstream.responseSlots.shift();
    const responseId = `resp_burst_${randomBytes(4).toString("hex")}`;
    const items = calls.map(({ name, args }, index) => ({ id: `item_burst_${index}_${responseId}`, call_id: `call_burst_${index}_${responseId}`, name, arguments: JSON.stringify(args) }));
    const outputs = items.map((item) => new Promise((resolve) => upstream.toolWaiters.set(item.call_id, resolve)));
    upstream.emitEvent({ type: "response.created", response: { id: responseId, status: "in_progress", output: [] } });
    for (const item of items) upstream.emitEvent({ type: "response.function_call_arguments.done", response_id: responseId, item_id: item.id, output_index: 0, call_id: item.call_id, name: item.name, arguments: item.arguments });
    upstream.emitEvent({ type: "response.done", response: { id: responseId, status: "completed", output: items.map((item) => ({ ...item, type: "function_call", status: "completed" })) } });
    return Promise.all(outputs);
  })();
}

/** Saudi speech for each engine step, with the structured answer a good model extracts from it. */
const FULL_PLAN = [
  { when: (s) => s.step === "report_question" && s.q?.startsWith("herd_health"), say: "والله كلها بخير الحمد لله يا طويل العمر", args: { value: "yes" } },
  { when: (s) => s.step === "report_question" && s.q === "herd_count", say: "عشرين راس تقريبا", args: { text: "20" } },
  { when: (s) => s.step === "herd_count_confirm", say: "ايه صح عشرين", args: { value: "yes" } },
  { when: (s) => s.step === "report_question" && s.q === "feed_level", say: "العلف باقي منه شوي", args: { value: "low" } },
  { when: (s) => s.step === "quantity_input" && s.q === "feed_level", say: "خمسة وعشرين كيس", args: { text: "25" } },
  { when: (s) => s.step === "quantity_confirm", say: "ايه تمام", args: { value: "yes" } },
  { when: (s) => s.step === "report_question" && s.q === "water_level", say: "الموية كافية ما عليها", args: { value: "good" } },
  { when: (s) => s.step === "quantity_input" && s.q === "water_level", say: "حوالي ميه لتر", args: { text: "100" } },
  { when: (s) => s.step === "report_question" && /^[0-9a-f-]{36}$/.test(s.q ?? ""), say: "لا والله ما جا أحد اليوم", args: { text: "لا ما جا" } },
];
const SPOKEN_CANARIES = [...FULL_PLAN.map((step) => step.say), "إيه احفظه", "ايش تقصد بالعلف"];

const planFor = (s) => FULL_PLAN.find((step) => step.when(s));

/** Answers via tools until the engine reaches `until`. Returns the last tool output. */
async function answerUntil(call, stream, upstream, reached = (s) => s.step === "report_summary", { max = 20 } = {}) {
  let last = null;
  for (let index = 0; index < max; index += 1) {
    const s = state(call.sid);
    if (!s) throw new Error("The voice session row disappeared mid-call");
    if (reached(s)) return last;
    const step = planFor(s);
    if (!step) throw new Error(`No plan for step ${s.step} / ${s.q}`);
    last = await workerTurn(stream, upstream, step.say, "answer_question", { ...step.args, topic: topicOf(s) });
    if (last === null) throw new Error(`No tool output at ${s.step}/${s.q}`);
  }
  throw new Error("Too many turns");
}

/** Worker confirms and the bridge ends the call. Exercises /after and the final status like Twilio would. */
async function confirmAndFinish(call, stream, upstream) {
  await waitFor(() => stream.sent("mark").some((event) => event.mark?.name?.startsWith("summary-")), "summary playback boundary");
  await sleep(100);
  upstream.workerSays("إيه احفظه");
  const confirmed = output(await upstream.toolCall("confirm_report", { confirmed: true }));
  const closed = await stream.waitClosed(20_000);
  check("the bridge closes the Twilio socket after the save", closed !== null, { closed });
  check("the worker hears the saved goodbye over the realtime voice", upstream.spoken.some((line) => /تم حفظ/.test(line)), upstream.spoken);
  await call.after();
  check("/after only hangs up: the bridge already spoke the goodbye", call.status === 200 && /<Hangup/.test(call.xml) && !/<Gather|<Say/.test(call.xml), call.xml.slice(0, 400));
  return confirmed;
}

/** One saved report, its run linked, session gone, owner told, dashboard showing it. */
async function assertSaved(ranch, call, { expected = [], herd } = {}) {
  const status = await call.finalStatus("completed");
  check("final status callback is accepted", status.status === 204, status);
  const farm = ranch.farm;
  const reports = reportOf(farm);
  const report = reports[0];
  check("exactly one report row", reports.length === 1, reports);
  if (herd !== undefined) check(`herd count reported is ${herd}`, String(report?.herd_count_reported) === String(herd), report);
  const [latest] = run(farm);
  check("report_call_runs is completed and linked to the report", latest?.state === "completed" && latest?.report_id === report?.id, latest);
  const calls = callRows(farm).filter((row) => row.kind === "worker_report");
  check("one worker_report call row with the CallSid", calls.length === 1 && calls[0].provider_call_id === call.sid && calls[0].report_id === report?.id, calls);
  check("the voice session is cleaned up", sessions(call.sid) === 0, sessions(call.sid));
  const answers = answersOf(farm);
  current.answers = answers.map(({ question_id, answer, answer_ar, certainty }) => ({ question_id, answer, answer_ar, certainty }));
  for (const { id, text } of expected) {
    const found = answers.find((row) => row.question_id.startsWith(id) || (id === "cq_" && /^[0-9a-f-]{36}$/.test(row.question_id)));
    const value = `${found?.answer ?? ""} ${found?.answer_ar ?? ""} ${found?.answer_en ?? ""}`;
    check(`answer ${id} maps to ${text}`, found && text.test(value), found ?? answers.map((a) => a.question_id));
  }
  const ws = await dashboard(ranch);
  const last = ws.reports?.at?.(-1);
  check("the owner's dashboard reads the report", ws.reports?.length === 1 && Boolean(ws.lastUpdateAt) && last?.answers?.length === answers.length, { reports: ws.reports?.length, lastUpdateAt: ws.lastUpdateAt, answers: last?.answers?.length });
  check("the dashboard's run is completed", ws.reportCalls?.at?.(-1)?.state === "completed", ws.reportCalls?.at?.(-1));
  await waitFor(async () => (await outbound()).some((r) => r.To === OWNER), "owner call", 20).catch(() => {});
  check("the owner gets one update call", (await outbound()).filter((r) => r.To === OWNER).length === 1, (await outbound()).map((r) => r.To));
  return ws;
}

function assertUnsaved(ranch, label = "no report") {
  check(`${label}: no report row`, count("reports", ranch.farm) === 0, reportOf(ranch.farm));
}

/** Scripted completion after a fallback: the same Gather route a call without realtime uses. */
const Q = { health: /حال الحلال/, herdCount: /كم عدد الحلال/, feed: /كم باقي من العلف/, water: /كيف وضع الماء/, custom: /^(?![\s\S]*أحفظه)[\s\S]*البيطري/, bags: /أكياس العلف/, litres: /الماء باللتر/, summary: /أحفظه/ };

async function driveScripted(call, how) {
  const speechPlan = [
    [Q.health, speech("كلها بخير")], [Q.herdCount, speech("عشرين ناقة")], [Q.feed, speech("باقي شوي")], [Q.bags, speech("٢٥")],
    [Q.water, speech("إيه كافي")], [Q.litres, speech("مية لتر")], [Q.custom, speech("لا ما جا")], [Q.summary, speech("إيه")],
  ];
  for (let index = 0; index < 40 && !call.ended; index += 1) {
    const text = call.text;
    if (how === "keypad") {
      if (call.xml.includes('finishOnKey="#"') && /قل العدد/.test(text)) await call.turn(keys(Q.herdCount.test(text) ? "20" : "25"));
      else await call.turn(keys("1"));
      continue;
    }
    const step = speechPlan.find(([ask]) => ask.test(text));
    await call.turn(step ? step[1] : speech("إيه"));
  }
}

/* ─────────────────── scenarios ─────────────────── */

let provider;

scenario("R1a", "Happy path: ranch with camels, resources and a custom question (natural Saudi speech)", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream, upstream } = await placeCall(ranch);

  check("Twilio's TwiML targets the public bridge with a ticket", call.streamUrl === BRIDGE_PUBLIC && Boolean(call.ticket), call.xml.slice(0, 300));
  check("<Connect action> is the signed /after route", new URL(call.afterUrl).pathname === "/api/voice/realtime/after" && new URL(call.afterUrl).searchParams.has("s"), call.afterUrl);
  check("the bridge authenticates to the provider with the server key", upstream.headers.authorization === `Bearer ${OPENAI_KEY}`, upstream.headers.authorization ? "wrong bearer" : "absent");
  const sessionUpdate = upstream.of("session.update")[0]?.session ?? {};
  current.sessionUpdate = sessionUpdate;
  check("session.update carries Next's instructions and tools", typeof sessionUpdate.instructions === "string" && sessionUpdate.instructions.length > 20 && Array.isArray(sessionUpdate.tools) && sessionUpdate.tools.length === REALTIME_MODEL_TOOLS.length, { instructions: typeof sessionUpdate.instructions, tools: sessionUpdate.tools?.length });
  check("session.update names every model tool", REALTIME_MODEL_TOOLS.every((name) => sessionUpdate.tools?.some((tool) => tool.name === name)), sessionUpdate.tools?.map((tool) => tool.name));
  check("the model must call a tool on every turn", sessionUpdate.tool_choice === "required", sessionUpdate.tool_choice);
  check("answer_question requires the topic", sessionUpdate.tools?.find((tool) => tool.name === "answer_question")?.parameters?.required?.includes("topic"), sessionUpdate.tools?.find((tool) => tool.name === "answer_question")?.parameters);
  check("GA input transcription uses the worker language", sessionUpdate.audio?.input?.transcription?.model === "gpt-4o-mini-transcribe" && sessionUpdate.audio.input.transcription.language === "ar", sessionUpdate.audio?.input?.transcription);
  const formats = JSON.stringify(sessionUpdate);
  check("audio format is G.711 mu-law", /pcmu|g711_ulaw/i.test(formats), formats.slice(0, 400));

  check("the opening line is spoken verbatim", upstream.spoken[0]?.length > 0 && upstream.of("response.create")[0]?.response?.tool_choice === "none", upstream.of("response.create")[0]);
  openings.push(upstream.spoken[0]);
  await stream.waitForEvent((event) => event.event === "media", 5000, "model audio to Twilio");
  const firstOut = stream.sent("media")[0];
  check("model audio reaches Twilio with the stream SID", firstOut.streamSid === stream.streamSid && Buffer.from(firstOut.media.payload, "base64").length === 800, firstOut.streamSid);
  await stream.waitForEvent((event) => event.event === "mark", 5000, "mark to Twilio").catch(() => note("no mark sent to Twilio for the opening"));
  for (let index = 0; index < 3; index += 1) stream.media(VOICED);
  await upstream.waitForEvent((event) => event.type === "input_audio_buffer.append", 5000, "worker audio to provider");
  check("worker audio is forwarded unchanged", upstream.audioIn[0].audio === VOICED, upstream.audioIn[0].audio?.slice(0, 20));

  const firstQuestion = state(call.sid);
  check("the run opens on the herd health question", firstQuestion?.step === "report_question" && firstQuestion.q?.startsWith("herd_health"), firstQuestion);

  const last = await answerUntil(call, stream, upstream);
  check("the last answer's tool output carries the summary to read", /أحفظه/.test(last ?? "") && output(last)?.isSummary === true, (last ?? "").slice(0, 300));
  const summaryState = state(call.sid);
  check("the engine is at the summary", summaryState.step === "report_summary", summaryState?.step);
  stream.media(VOICED);
  await confirmAndFinish(call, stream, upstream);
  await assertSaved(ranch, call, {
    herd: 20,
    expected: [
      { id: "herd_health", text: /well|بخير/i }, { id: "feed_level", text: /low|قليل|ناقص/i },
      { id: "water_level", text: /good|sufficient|كاف/i }, { id: "cq_", text: /ما جا/ },
    ],
  });
});

scenario("R1b", "Happy path: empty ranch (no camels, no herd count, no resources)", async () => {
  const ranch = await makeFarm();
  const { call, stream, upstream } = await placeCall(ranch);
  const first = state(call.sid);
  check("the empty ranch starts on a question the engine asks", first?.step === "report_question", first);
  await answerUntil(call, stream, upstream);
  check("no herd count step on an empty ranch", state(call.sid).step === "report_summary", state(call.sid)?.step);
  await confirmAndFinish(call, stream, upstream);
  await assertSaved(ranch, call);
});

scenario("R2", "Barge-in: worker speech during a server-spoken line clears Twilio and cancels the response", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream, upstream } = await placeCall(ranch);
  await sleep(200);
  const clearsBefore = stream.sent("clear").length;
  upstream.workerSays("لحظة");
  await sleep(300);
  check("speech with nothing playing sends no clear", stream.sent("clear").length === clearsBefore, stream.sent("clear").length - clearsBefore);
  check("speech with nothing playing sends no cancel", upstream.of("response.cancel").length === 0, upstream.of("response.cancel"));

  stream.autoMark = false;
  upstream.deferCancelDone = true;
  const held = holdPlayback(upstream);
  const framesBefore = stream.sent("media").length;
  await upstream.toolCall("repeat_or_clarify", { reason: "unclear" });
  await until(() => held.response && stream.sent("media").length >= framesBefore + 2, "the repeated question reaches Twilio");
  check("the server's line is spoken verbatim, with no tools", upstream.of("response.create").at(-1)?.response?.tool_choice === "none", upstream.of("response.create").at(-1));
  stream.ackSome(1);
  await sleep(100);
  upstream.speechStarted(1000);
  const clear = await stream.waitForEvent((event) => event.event === "clear" && stream.sent("clear").length > clearsBefore, 4000, "Twilio clear").catch(() => null);
  check("Twilio gets clear with the stream SID", clear?.streamSid === stream.streamSid, clear);
  const cancel = await upstream.waitForEvent((event) => event.type === "response.cancel", 4000, "response.cancel").catch(() => null);
  check("the provider gets response.cancel naming the playing response", cancel?.response_id === held.response.responseId, cancel);
  const truncate = await upstream.waitForEvent((event) => event.type === "conversation.item.truncate", 4000, "truncate").catch(() => null);
  check("the provider gets conversation.item.truncate for the playing item", truncate?.item_id === held.response.itemId && truncate?.content_index === 0, truncate);
  check("truncate lands where Twilio's marks say playback reached (100 ms)", truncate?.audio_end_ms === 100, truncate?.audio_end_ms);
  const late = Buffer.alloc(800, 0x66).toString("base64");
  upstream.emitEvent({ type: "response.output_audio.delta", response_id: held.response.responseId, item_id: held.response.itemId, output_index: 0, content_index: 0, delta: late });
  await sleep(300);
  upstream.completeCancel();
  await sleep(100);
  check("late audio from the cancelled response is not played", !stream.sent("media").some((event) => event.media?.payload === late), stream.sent("media").length - framesBefore);
  upstream.workerFinishes("والله كلها بخير");
  await upstream.toolCall("answer_question", { value: "yes", topic: "herd" });
  check("the call continues after barge-in", state(call.sid)?.q === "herd_count", state(call.sid)?.q);
  stream.stop();
  stream.closeNormally();
  await call.finalStatus("completed");
});

scenario("R2b", "Worker speech lands between response.create and response.created", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream, upstream } = await placeCall(ranch);
  upstream.workerSays("لحظة");
  await upstream.waitForEvent((event) => event.type === "response.create" && !event.response?.instructions, 3000, "an open turn").catch(() => null);
  upstream.speechStarted(1000);
  await sleep(400);
  check("speech before the reply is audible cancels nothing", upstream.of("response.cancel").length === 0, upstream.of("response.cancel"));
  check("the realtime call stays up", !stream.closed);
  upstream.workerFinishes("لحظة، وش قلت");
  const framesBefore = stream.sent("media").length;
  await upstream.toolCall("repeat_or_clarify", { reason: "asked_to_repeat" });
  await waitFor(() => stream.sent("media").length > framesBefore, "the reply reaches Twilio", 40);
  check("the reply is the question again", Q.health.test(upstream.spoken.at(-1) ?? ""), upstream.spoken.at(-1));
  stream.stop();
  stream.closeNormally();
  await call.finalStatus("completed");
  assertUnsaved(ranch);
});

scenario("R2c", "An early hello can't cancel the greeting, and the next turn is answered", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream } = await placeCall(ranch, { startStream: false });
  stream.start();
  for (let frame = 0; frame < 40; frame += 1) stream.media();
  const upstream = await provider.next();
  await upstream.waitForEvent((event) => event.type === "response.create" && typeof event.response?.instructions === "string", 20_000, "the greeting request");
  await waitFor(() => upstream.spoken.length >= 1 && stream.sent("media").length >= 1, "the greeting reaches Twilio", 40);
  await until(() => promptMarks(stream) >= 1, "the greeting's playback mark");
  await sleep(100);
  check("audio from before the session was ready never reaches the provider", upstream.audioIn.length === 0, upstream.audioIn.length);
  check("the greeting is not cancelled", upstream.of("response.cancel").length === 0, upstream.of("response.cancel"));
  const clears = stream.sent("clear").length;
  stream.media();
  await upstream.waitForEvent((event) => event.type === "input_audio_buffer.append", 3000, "live audio");
  upstream.workerSays("ألو");
  await upstream.waitForEvent((event) => event.type === "response.create" && !event.response?.instructions, 3000, "the next turn");
  upstream.speechStarted(1000); // Caller talks again before the reply is audible, as on the real call.
  await sleep(200);
  upstream.workerFinishes("ألو تسمعني");
  const framesBefore = stream.sent("media").length;
  await upstream.toolCall("repeat_or_clarify", { reason: "unclear" });
  await waitFor(() => stream.sent("media").length > framesBefore, "the reply to the next turn reaches Twilio", 40);
  check("the reply plays without being cancelled", upstream.of("response.cancel").length === 0 && stream.sent("clear").length === clears, upstream.of("response.cancel"));
  stream.stop();
  stream.closeNormally();
  await call.finalStatus("completed");
  assertUnsaved(ranch);
});

scenario("R3", "Clarification question mid-call: the server explains, no state change, then answered", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream, upstream } = await placeCall(ranch);
  await answerUntil(call, stream, upstream, (s) => s.q === "feed_level" && s.step === "report_question");
  const before = fingerprint(state(call.sid));
  await workerTurn(stream, upstream, "ايش تقصد بالعلف", "repeat_or_clarify", { reason: "asked_meaning" });
  check("the server explains with the question and its choices", /المقصود/.test(upstream.spoken.at(-1) ?? "") && Q.feed.test(upstream.spoken.at(-1) ?? ""), upstream.spoken.at(-1));
  check("a clarification turn makes no state change", fingerprint(state(call.sid)) === before, state(call.sid));
  const answered = await workerTurn(stream, upstream, "العلف باقي منه شوي", "answer_question", { value: "low", topic: "feed" });
  check("then the answer moves the call on", state(call.sid)?.step === "quantity_input", { step: state(call.sid)?.step, answered: answered?.slice(0, 200) });
  stream.stop();
  stream.closeNormally();
  await call.finalStatus("completed");
  assertUnsaved(ranch);
});

scenario("R4", "A cheating model cannot change or save anything", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream, upstream } = await placeCall(ranch);
  const expectRefused = async (label, send, { allowed } = {}) => {
    const before = fingerprint(state(call.sid));
    const raw = await send();
    check(`${label}: returns a tool result`, raw !== null, raw);
    check(`${label}: state unchanged`, fingerprint(state(call.sid)) === before, state(call.sid));
    check(`${label}: nothing saved`, count("reports", ranch.farm) === 0, reportOf(ranch.farm));
    if (allowed) check(`${label}: tells the model the allowed values`, allowed.every((value) => (raw ?? "").includes(value)), (raw ?? "").slice(0, 300));
  };
  const say = (words, name, args) => workerTurn(stream, upstream, words, name, args);

  await expectRefused("confirm_report true before the summary, after worker speech", () => say("إيه احفظه", "confirm_report", { confirmed: true }));
  upstream.workerSays("إيه احفظه");
  const [, unspoken] = await toolBurst(upstream, [{ name: "confirm_report", args: { confirmed: true } }, { name: "confirm_report", args: { confirmed: true } }]);
  await expectRefused("confirm_report true before the summary, with no worker speech", async () => unspoken);
  await sleep(300);
  await expectRefused("an invalid value", () => say("كلها بخير", "answer_question", { value: "banana", topic: "herd" }), { allowed: ["yes", "no", "unknown"] });
  await expectRefused("free text on a choice question", () => say("كلها بخير", "answer_question", { text: "كلها بخير", topic: "herd" }));
  await expectRefused("an unknown tool", () => say("كلها بخير", "delete_everything", {}));
  await expectRefused("end_call with an invalid reason", () => say("كلها بخير", "end_call", { reason: "because" }));
  await say("كلها بخير", "answer_question", { value: "yes", topic: "herd" });
  check("the honest answer still moves the call on after refusals", state(call.sid)?.q === "herd_count", state(call.sid)?.q);
  await expectRefused("extra arguments", () => say("عشرين", "answer_question", { text: "20", topic: "herd", herdCount: 999 }));
  await expectRefused("arbitrary fields only", () => say("عشرين", "answer_question", { report: { saved: true }, step: "report_summary" }));
  check("the live call survives every refusal", !stream.closed && state(call.sid) !== null, { closed: stream.closed });

  await answerUntil(call, stream, upstream);
  check("reaches the summary", state(call.sid).step === "report_summary", state(call.sid)?.step);
  await confirmAndFinish(call, stream, upstream);
  await assertSaved(ranch, call, { herd: 20 });
});

scenario("R4b", "Malformed tool JSON: the call falls back, nothing changes", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream, upstream } = await placeCall(ranch);
  const before = fingerprint(state(call.sid));
  upstream.workerSays("كلها بخير");
  const raw = await upstream.toolCall("answer_question", {}, { rawArguments: "{not json", waitMs: 3000 }).catch(() => null);
  check("no output is returned for unparsable arguments", raw === null, raw);
  const closed = await stream.waitClosed(5000);
  check("the bridge closes the Twilio socket", closed !== null, { closed });
  check("state unchanged", fingerprint(state(call.sid)) === before, state(call.sid));
  await call.after();
  check("/after resumes the same question by script", Boolean(call.action) && Q.health.test(call.text), call.text);
  await call.finalStatus("completed");
  assertUnsaved(ranch);
});

scenario("R5", "A duplicate toolCallId is applied once", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream, upstream } = await placeCall(ranch);
  const callId = `call_duplicate_${randomBytes(3).toString("hex")}`;
  const first = await workerTurn(stream, upstream, "كلها بخير", "answer_question", { value: "yes", topic: "herd" }, { callId });
  const afterFirst = fingerprint(state(call.sid));
  check("the first delivery is applied", output(first)?.status === "ok" && state(call.sid)?.q === "herd_count", first);
  upstream.workerSays("كلها بخير");
  const second = await upstream.toolCall("answer_question", { value: "yes", topic: "herd" }, { callId, waitMs: 2000 });
  check("the bridge does not forward a redelivered call id", second === null, second);
  check("state advanced once through the bridge", fingerprint(state(call.sid)) === afterFirst, state(call.sid)?.step);

  // The same guarantee in Next, concurrently, with a fresh id.
  const directId = `direct-${randomBytes(3).toString("hex")}`;
  const body = { ticket: call.ticket, callSid: call.sid, toolCallId: directId, name: "answer_question", args: { text: "20", topic: "herd" }, userSpokeSinceLastTool: true, workerUtterance: "عشرين راس" };
  const [one, two] = await Promise.all([internal("tool", body), internal("tool", body)]);
  check("concurrent duplicates give the same output", one.status === 200 && two.status === 200 && one.json?.output === two.json?.output, { one: one.text.slice(0, 200), two: two.text.slice(0, 200) });
  const replayed = await internal("tool", body);
  check("a later replay gives the first output", replayed.json?.output === one.json?.output, replayed.text.slice(0, 200));
  check("the concurrent duplicate advanced exactly one step", state(call.sid)?.step === "herd_count_confirm", state(call.sid)?.step);

  await answerUntil(call, stream, upstream);
  await waitFor(() => stream.sent("mark").some((event) => event.mark?.name?.startsWith("summary-")), "summary playback boundary");
  await sleep(100);
  upstream.workerSays("إيه احفظه");
  const saveId = `call_save_${randomBytes(3).toString("hex")}`;
  const saved = await upstream.toolCall("confirm_report", { confirmed: true }, { callId: saveId });
  check("the confirm is applied", output(saved)?.status === "saved", saved);
  const replay = await internal("tool", { ticket: call.ticket, callSid: call.sid, toolCallId: saveId, name: "confirm_report", args: { confirmed: true }, userSpokeSinceLastTool: true });
  check("replaying the save returns the first result", replay.json?.output === saved, replay.text.slice(0, 200));
  await stream.waitClosed(20_000);
  await call.after();
  await assertSaved(ranch, call, { herd: 20 });
});

scenario("R6", "Security: upgrades, tickets, internal API, one stream, loopback only", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch);
  await call.answer();
  if (!call.connect) throw new Error("no Connect in TwiML");
  const before = provider.stats.connections;
  const pgBefore = fingerprint(state(call.sid));

  const refuseUpgrade = async (label, options) => {
    const outcome = await call.open(options);
    check(`${label} is refused at the upgrade`, outcome.refused !== undefined && outcome.refused >= 400 && outcome.refused < 500, { refused: outcome.refused, opened: Boolean(outcome.stream) });
    outcome.stream?.terminate();
  };
  await refuseUpgrade("absent Twilio signature", { sig: null });
  await refuseUpgrade("wrong Twilio signature", { sig: createHmac("sha1", "wrong-token").update(BRIDGE_PUBLIC).digest("base64") });
  await refuseUpgrade("a signature for another URL", { sig: createHmac("sha1", AUTH_TOKEN).update(`${BRIDGE_PUBLIC}/other`).digest("base64") });
  check("no provider connection from refused upgrades", provider.stats.connections === before, provider.stats.connections - before);

  const badTicket = async (label, options) => {
    const opened = await call.open(options);
    if (!opened.stream) { check(`${label} is refused`, true); return; }
    opened.stream.connected();
    opened.stream.start();
    const closed = await opened.stream.waitClosed(8000);
    check(`${label} closes the stream`, closed !== null, { closed });
    check(`${label} opens no provider connection`, provider.stats.connections === before, provider.stats.connections - before);
  };
  const forged = `${call.ticket.slice(0, -4)}AAAA`;
  await badTicket("a forged ticket", { ticket: forged });
  await badTicket("a ticket with another call's SID", { callSid: `CA${"1".repeat(32)}` });
  await badTicket("a missing ticket", { ticket: null });
  await badTicket("the call token used as a ticket", { ticket: new URL(call.afterUrl).searchParams.get("s") });
  const decoded = JSON.parse(Buffer.from(call.ticket.split(".")[0], "base64url").toString("utf8"));
  const expiredTicket = signTicket({ ...decoded, t: Date.now() - 3 * 60_000 });
  const futureTicket = signTicket({ ...decoded, t: Date.now() + 2 * 60_000 });
  const otherRunTicket = signTicket({ ...decoded, r: "00000000-0000-4000-8000-000000000000" });
  await badTicket("an expired ticket (validly signed, 3 minutes old)", { ticket: expiredTicket });
  await badTicket("a future-dated ticket", { ticket: futureTicket });
  await badTicket("a validly signed ticket for another run", { ticket: otherRunTicket });
  check("the session row is untouched by rejected streams", fingerprint(state(call.sid)) === pgBefore, state(call.sid));
  const forgedAfter = await post(call.afterUrl, callFields(call.sid), { token: "wrong-token" });
  check("a forged /after webhook gets 403", forgedAfter.status === 403, forgedAfter.status);

  const internalBody = { ticket: call.ticket, callSid: call.sid };
  const rejected = async (label, path, body, options) => {
    const reply = await internal(path, body, options);
    check(`${label} is rejected`, reply.status === 401 || reply.status === 403, { status: reply.status, body: reply.text.slice(0, 160) });
  };
  await rejected("/session with no signature headers", "session", internalBody, { omit: true });
  await rejected("/session signed with a wrong key", "session", internalBody, { key: Buffer.from("wrong-key") });
  await rejected("/session with a stale timestamp (2 minutes)", "session", internalBody, { timestamp: Date.now() - 120_000 });
  await rejected("/session with a future timestamp (2 minutes)", "session", internalBody, { timestamp: Date.now() + 120_000 });
  await rejected("/session with a tampered signature", "session", internalBody, { signature: "0".repeat(64) });
  await rejected("/tool signed with a wrong key", "tool", { ...internalBody, toolCallId: "x", name: "end_call", args: { reason: "worker_ended" }, userSpokeSinceLastTool: false }, { key: Buffer.from("wrong-key") });
  check("forged internal calls changed nothing", fingerprint(state(call.sid)) === pgBefore, state(call.sid));

  const session = await internal("session", internalBody);
  check("control: a correctly signed /session with the real ticket succeeds", session.status === 200 && typeof session.json?.instructions === "string", { status: session.status, body: session.text.slice(0, 300) });
  const reused = await internal("session", internalBody);
  check("the same ticket cannot be used twice (internal API)", reused.status === 403, { status: reused.status });
  const unclaimedTool = await internal("tool", { ticket: signTicket({ ...decoded, sid: `CA${"2".repeat(32)}` }), callSid: `CA${"2".repeat(32)}`, toolCallId: "x-1", name: "end_call", args: { reason: "worker_ended" }, userSpokeSinceLastTool: false });
  check("/tool for an unknown call changes nothing", unclaimedTool.status === 403 || unclaimedTool.json?.end === "hangup", { status: unclaimedTool.status, body: unclaimedTool.text.slice(0, 200) });

  // A second stream for one call while the first is live.
  const liveRanch = await makeFarm(FULL);
  const { call: live, stream, upstream } = await placeCall(liveRanch);
  const connections = provider.stats.connections;
  const second = await live.open();
  if (second.stream) {
    second.stream.connected();
    second.stream.start();
    const closed = await second.stream.waitClosed(8000);
    check("a second stream for the same call is closed", closed !== null, { closed });
  } else check("a second stream for the same call is refused at the upgrade", true);
  check("a second stream opens no provider connection", provider.stats.connections === connections, provider.stats.connections - connections);
  check("the first stream keeps working", !stream.closed && !upstream.closed, { stream: stream.closed, upstream: upstream.closed });
  upstream.workerSays("خلاص بس");
  await upstream.toolCall("end_call", { reason: "worker_ended" }, { waitMs: 8000 });
  await stream.waitClosed(20_000);
  await live.after();
  check("end_call speaks its goodbye over the realtime voice without claiming a save", upstream.spoken.length >= 2 && !upstream.spoken.some((line) => /تم حفظ/.test(line)), upstream.spoken);
  check("/after preserves the honest goodbye after end_call", /<Hangup/.test(live.xml) && /<Say/.test(live.xml) && !/<Gather/.test(live.xml), live.xml.slice(0, 300));
  await live.finalStatus("completed");
  check("end_call saved nothing", count("reports", liveRanch.farm) === 0, reportOf(liveRanch.farm));

  await refuseNonLoopback();
});

async function refuseNonLoopback() {
  const log = join(LOGS, "bridge-refuse.log");
  startBridge("bridge-refuse", REFUSE_BRIDGE_PORT, { NAQAH_REALTIME_URL: "wss://naqah-refused.invalid/v1/realtime" });
  await sleep(2500);
  const child = children.get("bridge-refuse");
  const exited = child.exitCode !== null;
  const blocked = readFileSync(log, "utf8");
  if (exited) {
    check("a non-loopback NAQAH_REALTIME_URL stops the bridge at startup", child.exitCode !== 0 && /configuration_invalid/.test(blocked), { exitCode: child.exitCode, log: blocked.slice(0, 200) });
  } else {
    check("a non-loopback NAQAH_REALTIME_URL stops the bridge at startup", false, { exitCode: child.exitCode });
  }
  check("no connection to the non-loopback URL was attempted", !/\[guard\] blocked/.test(blocked), blocked.slice(0, 300));
  await stopChild("bridge-refuse");
}

const fallbackFlow = (id, title, failure, how) => scenario(id, title, async () => {
  const ranch = await makeFarm(FULL);
  await resetOutbound();
  const { call, stream, upstream, expectQuestion } = await failure(ranch);
  const closed = await stream.waitClosed(10_000);
  check("the Twilio socket is closed by the bridge", closed !== null, { closed });
  await call.after();
  check("/after returns a Gather, not a hangup", call.status === 200 && Boolean(call.action) && !/<Hangup/.test(call.xml) && !/<Connect/.test(call.xml), call.xml.slice(0, 400));
  check("/after resumes at the current question", expectQuestion.test(call.text), call.text);
  check("no report yet", count("reports", ranch.farm) === 0, reportOf(ranch.farm));
  const replayed = await post(call.afterUrl, callFields(call.sid));
  check("a repeated /after gives the same question", says(replayed.xml) === call.text && gather(replayed.xml) === call.action, says(replayed.xml));
  await driveScripted(call, how);
  check("scripted mode ends with a save", /تم حفظ/.test(call.text), call.text);
  await assertSaved(ranch, call, { herd: 20 });
  void upstream;
});

fallbackFlow("R7a", "Provider refuses at start: scripted Gather from question 1, keypad completes", async (ranch) => {
  const call = await callNow(ranch);
  await call.answer();
  provider.options.refuseStatus = 503;
  const opened = await call.open();
  if (!opened.stream) throw new Error(`upgrade refused: ${opened.refused}`);
  opened.stream.connected();
  opened.stream.start();
  return { call, stream: opened.stream, upstream: null, expectQuestion: Q.health };
}, "keypad");

fallbackFlow("R7b", "Provider error mid-call: resumes at the current question, speech completes", async (ranch) => {
  const { call, stream, upstream } = await placeCall(ranch);
  await answerUntil(call, stream, upstream, (s) => s.q === "feed_level" && s.step === "report_question");
  upstream.errorMidCall();
  return { call, stream, upstream, expectQuestion: Q.feed };
}, "speech");

fallbackFlow("R7c", "Provider closes mid-call: resumes at the current question, keypad completes", async (ranch) => {
  const { call, stream, upstream } = await placeCall(ranch);
  await answerUntil(call, stream, upstream, (s) => s.q === "water_level" && s.step === "report_question");
  upstream.closeAbruptly();
  return { call, stream, upstream, expectQuestion: Q.water };
}, "keypad");

scenario("R7d", "Twilio socket closes while the call is up: /after resumes, no duplicate report", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream, upstream } = await placeCall(ranch);
  await answerUntil(call, stream, upstream, (s) => s.q === "feed_level" && s.step === "report_question");
  stream.terminate();
  await waitFor(() => upstream.closed, "bridge closes provider", 40).catch(() => {});
  check("the bridge closes the provider socket", upstream.closed, upstream.closed);
  await call.after();
  check("/after returns the current question as a Gather", Boolean(call.action) && Q.feed.test(call.text), call.text);
  await driveScripted(call, "speech");
  await assertSaved(ranch, call, { herd: 20 });
});

scenario("R8", "Worker hangs up mid-call: nothing saved, run ends via the status callback", async () => {
  const ranch = await makeFarm(FULL);
  const { call, stream, upstream } = await placeCall(ranch);
  await answerUntil(call, stream, upstream, (s) => s.q === "feed_level" && s.step === "report_question");
  stream.stop();
  stream.closeNormally();
  await waitFor(() => upstream.closed, "bridge closes provider", 40).catch(() => {});
  check("the bridge closes the provider socket on stop", upstream.closed, upstream.closed);
  const status = await call.finalStatus("completed");
  check("status accepted", status.status === 204, status);
  assertUnsaved(ranch);
  const [latest] = run(ranch.farm);
  check("the run ends as missed", latest.state === "missed", latest);
  check("the voice session is removed", sessions(call.sid) === 0, sessions(call.sid));
  check("the owner receives no update call", !(await outbound()).some((r) => r.To === OWNER), (await outbound()).map((r) => r.To));
  const late = await post(call.afterUrl, callFields(call.sid));
  check("a late /after does not resume or claim a save", !/تم حفظ/.test(says(late.xml)) && !gather(late.xml), late.xml.slice(0, 300));
});

scenario("R9a", "No start message: the bridge closes within 10 s", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch);
  await call.answer();
  const before = provider.stats.connections;
  const opened = await call.open();
  if (!opened.stream) throw new Error(`upgrade refused: ${opened.refused}`);
  opened.stream.connected();
  const started = Date.now();
  const closed = await opened.stream.waitClosed(13_000);
  const elapsed = Date.now() - started;
  check("the socket closes", closed !== null, { closed });
  check("close is around 10 s", elapsed >= 9000 && elapsed <= 12_000, elapsed);
  check("no provider connection", provider.stats.connections === before, provider.stats.connections - before);
  await call.finalStatus("completed");
});

scenario("R9b", "maxSeconds: the bridge closes when the Next-supplied limit passes (limit shortened to 3 s via /session)", async () => {
  const proxy = await startRewriteProxy(3);
  try {
    await startLimitedBridge({}, { NAQAH_BRIDGE_UPSTREAM: `http://127.0.0.1:${REWRITE_PROXY_PORT}` });
    const ranch = await makeFarm(FULL);
    const { call, stream, upstream } = await placeCall(ranch, { bridgePort: LIMITS_BRIDGE_PORT });
    const started = Date.now();
    const closed = await stream.waitClosed(7000);
    const elapsed = Date.now() - started;
    check("the socket closes at about maxSeconds", closed !== null && elapsed >= 1500 && elapsed < 5000, { closed, elapsed });
    await waitFor(() => upstream.closed, "provider close", 20).catch(() => {});
    check("the provider socket closes too", upstream.closed, upstream.closed);
    await call.after();
    check("/after resumes the current question by script", Boolean(call.action) && /<Gather/.test(call.xml), call.xml.slice(0, 300));
    await call.finalStatus("completed");
    assertUnsaved(ranch);
  } finally {
    await stopChild("bridge-limits");
    await new Promise((resolve) => proxy.close(resolve));
  }
});

scenario("R9c", "Silence: two reprompts, then the stream ends and the call continues by script (limit shortened to 500 ms, default 10 s)", async () => {
  await startLimitedBridge({ repromptMs: 500, maxReprompts: 2 });
  try {
    const ranch = await makeFarm(FULL);
    const { call, stream, upstream } = await placeCall(ranch, { bridgePort: LIMITS_BRIDGE_PORT });
    const started = Date.now();
    for (let index = 0; index < 8; index += 1) { stream.media(SILENCE); await sleep(100); }
    const closed = await stream.waitClosed(6000);
    const elapsed = Date.now() - started;
    check("the socket closes after two reprompts and one more silent interval", closed !== null && elapsed >= 1000 && elapsed < 6500, { closed, elapsed });
    check("the worker heard the opening and exactly two reprompts of the question", upstream.spoken.length === 3 && upstream.spoken.slice(1).every((line) => Q.health.test(line)), upstream.spoken);
    await waitFor(() => upstream.closed, "provider close", 20).catch(() => {});
    check("the provider socket closes too", upstream.closed, upstream.closed);
    await call.after();
    check("/after resumes the same question by script", Boolean(call.action) && Q.health.test(call.text), call.text);
    check("/after says the call continues on the keypad", /بالأزرار/.test(call.text), call.text);
    await call.finalStatus("completed");
    assertUnsaved(ranch);
  } finally {
    await stopChild("bridge-limits");
  }
});

const normalizeTwiml = (xml) => xml.replace(/([?&]s=)[^"&]+/g, "$1<signed>").replace(/(ticket|value)="[^"]+"/g, '$1="<ticket>"');

/** Answer webhook and first scripted turn, for one fresh call through whichever Next is running. */
async function scriptedSample() {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch);
  await call.answer();
  const answered = call.xml;
  if (call.action) await call.turn(speech("كلها بخير"));
  const firstTurn = call.xml;
  await call.finalStatus("completed");
  return { answered: normalizeTwiml(answered), firstTurn: normalizeTwiml(firstTurn) };
}

scenario("R10", "Flag off: the call is scripted, TwiML byte-identical to the last commit (HEAD)", async () => {
  await stopChild("bridge");
  await stopChild("next");
  await waitFor(async () => !(await portOpen(APP_PORT)), "next stopped", 40);
  rmSync(join(SRC, ".next"), { recursive: true, force: true });
  await startNext("next-flag-off", SRC, {});
  const off = await scriptedSample();
  check("no <Connect> or <Stream> with the flag off", !/<Connect|<Stream/.test(off.answered), off.answered.slice(0, 300));
  check("the flag-off answer is a Gather", /<Gather/.test(off.answered), off.answered.slice(0, 300));
  await stopChild("next-flag-off");
  await waitFor(async () => !(await portOpen(APP_PORT)), "next stopped", 40);
  exportBaseline();
  await startNext("next-baseline", BASE, {});
  const baseline = await scriptedSample();
  check("answer TwiML is identical to HEAD", off.answered === baseline.answered, { off: off.answered.slice(0, 400), head: baseline.answered.slice(0, 400) });
  check("first-turn TwiML is identical to HEAD", off.firstTurn === baseline.firstTurn, { off: off.firstTurn.slice(0, 400), head: baseline.firstTurn.slice(0, 400) });
  await stopChild("next-baseline");
});

scenario("R11", "Logs from every call above contain no phone numbers, transcripts, audio or secrets", async () => {
  const bridgeFiles = ["bridge.log", "bridge-refuse.log", "bridge-limits.log"];
  const appFiles = ["next.log", "next-flag-off.log", "next-baseline.log"];
  const read = (files) => files.filter((file) => existsSync(join(LOGS, file))).map((file) => readFileSync(join(LOGS, file), "utf8")).join("\n");
  const bridge = read(bridgeFiles);
  const app = read(appFiles);
  check("the logs were actually produced", bridge.includes("provider_ready") && app.includes("realtime"), { bridge: bridge.length, app: app.length });
  const forbidden = [
    ["worker phone", WORKER], ["worker phone digits", WORKER.slice(1)], ["owner phone", OWNER], ["owner phone digits", OWNER.slice(1)],
    ["Twilio auth token", AUTH_TOKEN], ["voice secret", SECRET], ["OpenAI key", OPENAI_KEY], ["service role key", stackKeys.SUPABASE_SECRET_KEY],
    ["caller audio frame", VOICED.slice(0, 64)], ["model audio frame", Buffer.alloc(120, 0x55).toString("base64").slice(0, 64)],
    ...SPOKEN_CANARIES.map((text, index) => [`spoken line ${index + 1}`, text]),
    ...openings.map((text, index) => [`opening line ${index + 1}`, text]),
    ...[...seenTickets].map((ticket, index) => [`ticket ${index + 1}`, ticket]),
  ];
  for (const [name, value] of forbidden) {
    if (!value) continue;
    check(`bridge log has no ${name}`, !bridge.includes(value), name);
    check(`app log has no ${name}`, !app.includes(value), name);
  }
  check("no full CallSid in the bridge log", !/CA[0-9a-f]{32}/.test(bridge), bridge.match(/CA[0-9a-f]{32}/)?.[0]);
  check("no outbound connection attempted beyond loopback", !bridge.includes("[guard] blocked"), bridge.match(/\[guard\] blocked.*/)?.[0]);
  const fullSid = app.match(/CA[0-9a-f]{32}/)?.[0];
  if (fullSid) note("The app log contains a full CallSid (Next dev request logging of the status URL or `s` token)");
  if (/[?&]s=[A-Za-z0-9_-]{20,}\./.test(app)) note("next dev prints request URLs with the signed `s` call token; production logging is the host's setting");
});

/** Compile the realtime routes before a call so a dev-server compile can't hit the bridge's 5 s internal timeout. */
async function warmUp() {
  for (const path of ["session", "tool"]) await internal(path, {}, { omit: true }).catch(() => {});
  await post("/api/voice/realtime/after?s=x", callFields(`CA${"3".repeat(32)}`), { signed: false }).catch(() => {});
  await post("/api/voice/turn?n=0", callFields(`CA${"3".repeat(32)}`), { signed: false }).catch(() => {});
  await post("/api/voice/outbound?s=x", callFields(`CA${"3".repeat(32)}`), { signed: false }).catch(() => {});
  await post("/api/voice/outbound/status?s=x", callFields(`CA${"3".repeat(32)}`), { signed: false }).catch(() => {});
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
  await startNext("next", SRC, REALTIME_ENV);
  await startRealtimeBridge();
  await warmUp();
  for (const entry of registry) {
    if (ONLY?.length && !ONLY.some((id) => entry.id === id || entry.id.startsWith(id))) continue;
    console.log(`\n${entry.id} ${entry.title}`);
    current = { id: entry.id, title: entry.title, checks: [], notes: [], error: null };
    results.push(current);
    provider.reset();
    await faults(false);
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
  if (!flag("keep-src")) {
    rmSync(SRC, { recursive: true, force: true });
    rmSync(BASE, { recursive: true, force: true });
  } else {
    rmSync(join(SRC, ".next"), { recursive: true, force: true });
    rmSync(join(BASE, ".next"), { recursive: true, force: true });
  }
}

/* The existing scripted suite, unchanged, after everything above has stopped. Its own ports and /tmp/naqah-s3. */
if (!flag("skip-scripted") && !ONLY?.length) {
  console.log("\nRunning the existing scripted suite: node scripts/verify-call-scenarios.mjs --label final");
  current = { id: "R10-scripted", title: "Existing scripted suite (verify-call-scenarios --label final) passes", checks: [], notes: [], error: null };
  results.push(current);
  const out = join(LOGS, "scripted-suite.out");
  const fd = openSync(out, "w");
  let code = 0;
  try {
    execFileSync(process.execPath, [join(REPO, "scripts/verify-call-scenarios.mjs"), "--label", "final", "--root", join(ROOT, "s3"), "--pg-port", PG_PORT, "--rest-port", REST_PORT, "--gateway-port", GATEWAY_PORT, "--app-port", APP_PORT, "--cleanup"], { cwd: REPO, stdio: ["ignore", fd, fd], timeout: 1_500_000 });
  } catch (error) { code = error.status ?? 1; }
  closeSync(fd);
  const tail = readFileSync(out, "utf8").split("\n").slice(-40).join("\n");
  check(`verify-call-scenarios exits 0 (log ${out})`, code === 0, tail);
  exitCode = exitCode || (code === 0 ? 0 : 1);
}

const table = results.map((r) => {
  const failed = r.checks.filter((c) => !c.passed);
  const verdict = r.error ? "ERROR" : failed.length ? "FAIL" : "PASS";
  return `${verdict.padEnd(6)} ${r.id.padEnd(8)} ${r.title}${failed.length ? `  [${failed.length}/${r.checks.length} failed]` : ""}`;
}).join("\n");
console.log(`\n=== ${LABEL} (commit ${commit}, ${Math.round((Date.now() - started) / 1000)}s) ===\n${table}`);
writeFileSync(join(LOGS, "result.json"), JSON.stringify({ label: LABEL, commit, results }, null, 2));
writeFileSync(join(LOGS, "summary.txt"), `${table}\n`);
void SILENCE;
process.exit(exitCode);
