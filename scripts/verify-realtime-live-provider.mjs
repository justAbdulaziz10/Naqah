#!/usr/bin/env node
/**
 * PAID: uses the real OpenAI Realtime API (about 10 minutes of audio at most). Never touches Twilio or live Supabase.
 * Real Next + the real bridge on a throwaway stack, with a mock Twilio Media Streams caller speaking OpenAI-generated
 * Saudi Arabic in 20 ms mu-law frames and acknowledging marks at playback pace.
 *
 *   OPENAI_API_KEY="$(sed -n 's/^OPENAI_API_KEY=//p' .env.local)" \
 *     node scripts/verify-realtime-live-provider.mjs --label run1 --only A,C [--empty] [--cleanup]
 *
 * Only that one key is passed. Everything is under /tmp/naqah-rt4; logs and transcripts stay in /tmp/naqah-rt4/logs.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectStream, FRAME_BYTES, SILENCE } from "./mocks/twilio-media.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error("OPENAI_API_KEY is required"); process.exit(2); }

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = "/tmp/naqah-rt4";
const SRC = join(ROOT, "src");
const PGDATA = join(ROOT, "pg");
const SOCK = join(ROOT, "sock");
const LABEL = arg("label", "run");
const LOGS = join(ROOT, "logs", LABEL);
const LEDGER = join(ROOT, "logs", "budget.json");
const TTS_CACHE = join(ROOT, "logs", "tts");
const TAP = join(LOGS, "provider-events.jsonl");
const ONLY = arg("only", "A,C").split(",").filter(Boolean);
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const PG_PORT = "54960";
const REST_PORT = "54961";
const GATEWAY_PORT = "54962";
const APP_PORT = "3821";
const BRIDGE_PORT = "3822";
const DB = "naqah_rt4";
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const PUBLIC = "https://naqah-rt4.example.test";
const BRIDGE_PUBLIC = "wss://naqah-rt4.example.test/voice-bridge/media";
const AUTH_TOKEN = "local-test-auth-token";
const SECRET = "local-only-voice-secret-for-realtime-scenarios";
const CRON_SECRET = "local-only-cron-secret";
const ACCOUNT_SID = `AC${"0".repeat(32)}`;
const WORKER = "+15555550101";
const OWNER = "+15555550102";
const TWILIO_NUMBER = "+15555550100";
const MAX_RUNS = 4;
const MAX_SECONDS = 600;
const CALL_LIMIT_SECONDS = { A: 90, C: 330, E: 200 };

mkdirSync(LOGS, { recursive: true });
mkdirSync(TTS_CACHE, { recursive: true });
writeFileSync(TAP, "");
const PATH = `${PG_BIN}:${process.env.PATH}`;
const pgEnv = { PATH, LC_ALL: "en_US.UTF-8", PGHOST: "127.0.0.1", PGPORT: PG_PORT, PGUSER: "postgres" };
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NAQAH_|TWILIO_|SUPABASE|NEXT_PUBLIC_|CRON_|PG|OPENAI)/.test(key)));
const children = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ─────────────────── budget ─────────────────── */

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { runs: 0, seconds: 0, usage: [] };
const saveLedger = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
if (ledger.runs >= MAX_RUNS || ledger.seconds >= MAX_SECONDS) {
  console.error(`Budget reached: ${ledger.runs} runs, ${Math.round(ledger.seconds)} s of realtime. Stopping.`);
  process.exit(3);
}
ledger.runs += 1;
saveLedger();

/* ─────────────────── audio ─────────────────── */

const MULAW_MAX = 0x1fff;
function linearToMulaw(sample) {
  let value = sample >> 2;
  const sign = value < 0 ? 0x7f : 0xff;
  if (value < 0) value = -value;
  value = Math.min(value, MULAW_MAX) + 33;
  let segment = 7;
  for (let mask = 0x1000; segment > 0 && !(value & mask); mask >>= 1) segment -= 1;
  const low = (value >> (segment + 1)) & 0x0f;
  return (sign ^ ((segment << 4) | low)) & 0xff;
}

/** 24 kHz 16-bit PCM → 8 kHz mu-law (a three-sample average is the anti-alias filter). */
function pcm24ToMulaw(pcm) {
  const frames = Math.floor(pcm.length / 6);
  const out = Buffer.alloc(frames);
  for (let index = 0; index < frames; index += 1) {
    const at = index * 6;
    out[index] = linearToMulaw(Math.round((pcm.readInt16LE(at) + pcm.readInt16LE(at + 2) + pcm.readInt16LE(at + 4)) / 3));
  }
  return out;
}

/** Caller speech, generated once per line. Only the mu-law bytes are cached, under /tmp. */
async function speechFor(line) {
  const file = join(TTS_CACHE, `${createHash("sha256").update(line).digest("hex").slice(0, 16)}.ulaw`);
  if (existsSync(file)) return readFileSync(file);
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts", voice: "ash", input: line, response_format: "pcm",
      instructions: "تكلم بلهجة سعودية بدوية طبيعية، بصوت رجل عامل في عزبة على الجوال، بدون مبالغة.",
    }),
  });
  if (!response.ok) throw new Error(`TTS failed: ${response.status}`);
  const audio = pcm24ToMulaw(Buffer.from(await response.arrayBuffer()));
  writeFileSync(file, audio);
  return audio;
}

/** Low-level line hiss at about -60 dBFS, as a phone sends when nobody is talking. */
function lineNoise() {
  const out = Buffer.alloc(FRAME_BYTES);
  for (let index = 0; index < FRAME_BYTES; index += 1) out[index] = linearToMulaw(Math.round((Math.random() - 0.5) * 60));
  return out.toString("base64");
}

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
function stopAll() {
  for (const child of children.values()) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  }
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
  rmSync(stackEnv, { force: true });
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
  // NAQAH_REALTIME_URL stays unset: the bridge dials the real provider. The tap's guard allows only loopback and OpenAI.
  background("bridge", process.execPath, [join(dir, "index.mjs")], {
    ...baseEnv, PATH, NODE_ENV: "production",
    NODE_OPTIONS: `--import=${join(SRC, "scripts/mocks/provider-tap.mjs")}`,
    NAQAH_TAP_FILE: TAP, NAQAH_TAP_BRIDGE_DIR: dir,
    PORT: BRIDGE_PORT, NAQAH_BRIDGE_PUBLIC_URL: BRIDGE_PUBLIC, NAQAH_BRIDGE_UPSTREAM: APP,
    NAQAH_VOICE_SECRET: SECRET, TWILIO_AUTH_TOKEN: AUTH_TOKEN, OPENAI_API_KEY: OPENAI_KEY,
  }, dir);
  await waitFor(() => portOpen(BRIDGE_PORT), "bridge listening", 60);
}

/* ─────────────────── database + webhooks ─────────────────── */

const sql = (query) => execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], {
  input: query, encoding: "utf8", env: { ...baseEnv, ...pgEnv }, maxBuffer: 1 << 26,
}).trim();
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const postJson = async (url, body) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const outbound = async () => (await (await fetch(`${GATEWAY}/__test/outbound`)).json()).requests;
const resetOutbound = () => postJson(`${GATEWAY}/__test/outbound`, { status: 201, reset: true });
const decode = (text) => text.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");

function signature(url, fields, token = AUTH_TOKEN) {
  let value = url;
  for (const key of Object.keys(fields).sort()) value += key + fields[key];
  return createHmac("sha1", token).update(value, "utf8").digest("base64");
}
async function post(target, fields) {
  const publicUrl = new URL(target, PUBLIC).toString();
  const parsed = new URL(publicUrl);
  const response = await fetch(`${APP}${parsed.pathname}${parsed.search}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature(publicUrl, fields) }, body: new URLSearchParams(fields),
  });
  return { status: response.status, xml: await response.text() };
}
const callFields = (sid, extra) => ({
  AccountSid: ACCOUNT_SID, ApiVersion: "2010-04-01", CallSid: sid, CallStatus: "in-progress",
  Called: WORKER, Caller: TWILIO_NUMBER, Direction: "outbound-api", From: TWILIO_NUMBER, To: WORKER, ...extra,
});

async function makeOwner() {
  const email = `rt4-${randomBytes(5).toString("hex")}@example.test`;
  const password = "local-test-password";
  const user = await postJson(`${GATEWAY}/__test/users`, { email, password });
  const session = await postJson(`${GATEWAY}/auth/v1/token?grant_type=password`, { email, password });
  const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const account = async (body) => (await fetch(`${APP}/api/account`, { method: "POST", headers: { "Content-Type": "application/json", Origin: APP, Cookie: cookie }, body: JSON.stringify(body) })).json();
  return { user, account };
}
async function makeFarm({ camels = [], herd = null, resources = [], custom = [] } = {}) {
  const { user, account } = await makeOwner();
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

const rows = (query) => JSON.parse(sql(`select coalesce(json_agg(t), '[]') from (${query}) t`));
const state = (sid) => {
  const raw = sql(`select session::text from voice_call_sessions where call_sid = ${q(sid)}`);
  if (!raw) return null;
  const session = JSON.parse(raw);
  return { step: session.step, q: session.data?.currentQuestionId, done: session.done, replies: session.replies?.map((r) => r.value), turn: session.turns?.length };
};

async function warmUp() {
  const sid = `CA${"3".repeat(32)}`;
  for (const path of ["session", "tool"]) await fetch(`${APP}/api/voice/realtime/${path}`, { method: "POST", body: "{}" }).catch(() => {});
  for (const path of ["/api/voice/realtime/after?s=x", "/api/voice/turn?n=0", "/api/voice/outbound?s=x", "/api/voice/outbound/status?s=x"]) {
    await fetch(`${APP}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(callFields(sid)) }).catch(() => {});
  }
  await fetch(`${APP}/api/account`, { method: "POST", headers: { "Content-Type": "application/json", Origin: APP }, body: "{}" }).catch(() => {});
}

/* ─────────────────── provider event tap ─────────────────── */

class Tap {
  constructor() { this.events = []; this.fd = openSync(TAP, "r"); this.offset = 0; this.partial = ""; }
  poll() {
    const size = statSync(TAP).size;
    if (size <= this.offset) return;
    const buffer = Buffer.alloc(size - this.offset);
    readSync(this.fd, buffer, 0, buffer.length, this.offset);
    this.offset = size;
    const text = this.partial + buffer.toString("utf8");
    const lines = text.split("\n");
    this.partial = lines.pop();
    for (const line of lines) if (line) this.events.push(JSON.parse(line));
  }
}

/* ─────────────────── the caller ─────────────────── */

/**
 * Plays Twilio's part of a call: one 20 ms frame every 20 ms, always, and the bridge's audio "plays" at real-time pace:
 * each mark is acknowledged when the playhead reaches it, and a clear flushes the buffer and acknowledges what was queued.
 */
class Phone {
  constructor(stream, { noise = false } = {}) {
    this.stream = stream;
    stream.autoMark = false;
    this.noise = noise;
    this.pending = [];
    this.playheadEnd = 0;
    this.markTimers = [];
    this.outFrames = 0;
    this.outBytes = 0;
    this.firstOutAt = null;
    this.lastOutAt = null;
    this.clears = 0;
    this.lineLog = [];
    this.startedAt = null;
    this.speech = null;
    stream.on("event", (event) => this.onBridge(event));
  }
  onBridge(event) {
    const now = Date.now();
    if (event.event === "media") {
      const bytes = Buffer.from(event.media.payload, "base64").length;
      this.outFrames += 1;
      this.outBytes += bytes;
      this.firstOutAt ??= now;
      this.lastOutAt = now;
      this.playheadEnd = Math.max(this.playheadEnd, now) + bytes / 8;
    } else if (event.event === "mark") {
      const at = Math.max(this.playheadEnd, now);
      this.markTimers.push(setTimeout(() => { this.markTimers.shift(); this.stream.ackSome(1); }, at - now));
    } else if (event.event === "clear") {
      this.clears += 1;
      this.playheadEnd = now;
      for (const timer of this.markTimers.splice(0)) clearTimeout(timer);
    }
  }
  get playing() { return this.playheadEnd > Date.now() + 40; }
  get audioRemainingMs() { return Math.max(0, this.playheadEnd - Date.now()); }
  say(line, audio) {
    return new Promise((resolve) => {
      this.speech = { line, audio, offset: 0, resolve, startedAt: Date.now() };
      this.lineLog.push({ line, startedAt: Date.now() });
    });
  }
  frame() {
    const { speech } = this;
    if (!speech) return this.noise ? lineNoise() : SILENCE;
    const chunk = speech.audio.subarray(speech.offset, speech.offset + FRAME_BYTES);
    speech.offset += FRAME_BYTES;
    if (speech.offset >= speech.audio.length) {
      this.speech = null;
      this.lineLog.at(-1).endedAt = Date.now();
      speech.resolve(Date.now());
    }
    return Buffer.concat([chunk, Buffer.alloc(FRAME_BYTES - chunk.length, 0xff)]).toString("base64");
  }
  start() {
    this.startedAt = Date.now();
    let due = this.startedAt;
    this.interval = setInterval(() => {
      if (this.stream.closed) return this.halt();
      while (due <= Date.now()) {
        this.stream.media(this.frame());
        due += 20;
      }
      return undefined;
    }, 5);
  }
  halt() { clearInterval(this.interval); for (const timer of this.markTimers.splice(0)) clearTimeout(timer); }
}

/* ─────────────────── one call ─────────────────── */

const results = [];

class Call {
  constructor(id, title, ranch) {
    this.id = id;
    this.ranch = ranch;
    this.result = { id, title, checks: [], notes: [], timings: { turns: [] }, tools: [], statuses: [], usage: [], transcript: [] };
    results.push(this.result);
    this.tap = new Tap();
    this.tap.offset = statSync(TAP).size;
    this.limitSeconds = CALL_LIMIT_SECONDS[id] ?? 240;
  }
  check(name, passed, detail) {
    this.result.checks.push({ name, passed: Boolean(passed), detail: passed ? undefined : detail });
    console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${passed || detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 500)}`}`);
  }
  note(text) { this.result.notes.push(text); console.log(`  NOTE ${text}`); }
  log(text) { this.result.transcript.push(`${new Date().toISOString().slice(11, 23)} ${text}`); console.log(`  ${text}`); }
  get events() { this.tap.poll(); return this.tap.events; }
  of(type) { return this.events.filter((event) => event.type === type); }
  over() { return !this.deadline || Date.now() > this.deadline; }

  async place({ noise = false, earlyHello = false } = {}) {
    await resetOutbound();
    const called = await this.ranch.account({ op: "callNow" });
    if (!called.ok || called.data?.status === "blocked") throw new Error(`callNow failed: ${JSON.stringify(called)}`);
    await waitFor(async () => (await outbound()).length >= 1, "outbound call request", 80);
    this.request = (await outbound())[0];
    this.sid = this.request.sid;
    const answered = await post(this.request.Url, callFields(this.sid));
    const xml = answered.xml;
    const action = xml.match(/<Connect\b[^>]*\baction="([^"]+)"/)?.[1];
    const url = xml.match(/<Stream\b[^>]*\burl="([^"]+)"/)?.[1];
    const ticket = xml.match(/<Parameter\b[^>]*\bname="ticket"[^>]*\bvalue="([^"]+)"/)?.[1];
    if (!action || !url || !ticket) throw new Error(`Answer TwiML has no <Connect>: ${xml.slice(0, 300)}`);
    this.afterUrl = decode(action);
    const opened = await connectStream({
      bridgeUrl: `ws://127.0.0.1:${BRIDGE_PORT}/voice-bridge/media`, publicUrl: decode(url), authToken: AUTH_TOKEN,
      callSid: this.sid, accountSid: ACCOUNT_SID, ticket: decode(ticket),
    });
    if (!opened.stream) throw new Error(`Bridge refused the upgrade: ${opened.refused}`);
    this.stream = opened.stream;
    this.phone = new Phone(this.stream, { noise });
    this.stream.connected();
    this.deadline = Date.now() + this.limitSeconds * 1000;
    this.startedAt = Date.now();
    this.stream.start();
    this.phone.start();
    if (earlyHello) await this.phone.say("ألو", await speechFor("ألو"));
  }

  async say(line) {
    const audio = await speechFor(line);
    this.log(`CALLER «${line}» (${(audio.length / 8000).toFixed(1)} s)`);
    const endedAt = await this.phone.say(line, audio);
    return endedAt;
  }

  /** Wait until a reply has fully played, or the socket closes. Null means nothing audible came back in time. */
  async assistantFinished(sinceIndex, { timeoutMs = 25_000, during } = {}) {
    const limit = Date.now() + timeoutMs;
    let audibleAt = null;
    for (;;) {
      if (this.stream.closed) return "closed";
      if (this.over()) throw new Error("Call time limit reached");
      const events = this.events.slice(sinceIndex);
      const dones = events.filter((event) => event.type === "response.done");
      const created = events.filter((event) => event.type === "response.created").length;
      const open = created > dones.length;
      const lastDone = dones.at(-1);
      const toolTurn = lastDone?.response?.output?.some((item) => item.type === "function_call");
      const finished = dones.length > 0 && !open && !toolTurn && !this.phone.playing;
      if (this.phone.playing || open) audibleAt ??= Date.now();
      if (during) await during();
      if (finished) { await sleep(450); return "finished"; }
      if (Date.now() > limit && !this.phone.playing && !open) return null;
      if (this.phone.playing) await sleep(40);
      else await sleep(60);
    }
  }

  async end() {
    this.phone.halt();
    if (!this.stream.closed) { this.stream.stop(); this.stream.conn.close(1000, "call ended"); }
    await this.stream.waitClosed(4000);
    const elapsed = (Date.now() - this.startedAt) / 1000;
    ledger.seconds += elapsed;
    saveLedger();
    this.result.timings.seconds = Math.round(elapsed);
  }

  /** Timing, response statuses, tool calls and token usage from the tapped provider events. */
  report() {
    const events = this.events;
    const at = (type) => events.find((event) => event.type === type)?.t;
    const firstDelta = events.find((event) => event.type === "response.output_audio.delta");
    const ready = at("session.updated");
    Object.assign(this.result.timings, {
      startToReadyMs: ready ? ready - this.startedAt : null,
      readyToFirstDeltaMs: ready && firstDelta ? firstDelta.t - ready : null,
    });
    this.result.statuses = this.of("response.done").map((event) => ({
      status: event.response?.status, reason: event.response?.status_details?.reason,
      outputs: event.response?.output?.map((item) => item.type),
    }));
    this.result.usage = this.of("response.done").map((event) => event.response?.usage).filter(Boolean);
    this.result.eventTypes = Object.entries(events.reduce((acc, event) => {
      if (event.dir === "in") acc[event.type] = (acc[event.type] ?? 0) + 1;
      return acc;
    }, {})).map(([type, count]) => `${type}:${count}`);
    this.result.deltaBytes = events.filter((event) => event.type === "response.output_audio.delta").map((event) => event.bytes);
    this.result.assistantSaid = this.of("response.output_audio_transcript.done").map((event) => event.transcript);
    this.result.errors = this.of("error").map((event) => event.error);
    this.result.sessionUpdated = this.of("session.updated")[0]?.session?.audio;
    ledger.usage.push({ label: LABEL, id: this.id, usage: this.result.usage });
    saveLedger();
    writeFileSync(join(LOGS, `transcript-${this.id}.txt`), `${this.result.transcript.join("\n")}\n\nASSISTANT\n${this.result.assistantSaid.join("\n")}\n`);
    return this.result;
  }
}

/* ─────────────────── scenarios ─────────────────── */

async function scenarioA() {
  const ranch = await makeFarm(FULL);
  const call = new Call("A", "Early hello and next turn on the real provider", ranch);
  console.log("\nA+B Early hello, greeting, next turn, then line noise");
  try {
    await call.place({ earlyHello: true });
    const earlyEnd = Date.now();
    await waitFor(() => call.of("session.updated").length > 0, "provider ready", 80);
    await waitFor(() => call.phone.firstOutAt !== null || call.stream.closed, "first audio to Twilio", 80);
    call.check("A: greeting audio reaches the Twilio mock", call.phone.outFrames > 0, call.phone.outFrames);
    const greeting = await call.assistantFinished(0);
    call.check("A: greeting plays through", greeting === "finished", greeting);
    call.check("A: greeting is not cancelled", call.of("response.cancel").length === 0, call.of("response.cancel"));
    call.check("A: no clear sent during the greeting", call.phone.clears === 0, call.phone.clears);
    call.check("A: a hello over the opening earns no extra turn", call.of("response.create").length === 1, call.of("response.create").length);
    call.result.timings.earlyHelloEndToFirstOutMs = call.phone.firstOutAt - earlyEnd;

    const index = call.events.length;
    const framesBefore = call.phone.outFrames;
    const endedAt = await call.say("ألو تسمعني");
    const finished = await call.assistantFinished(index);
    const firstAfter = call.events.slice(index).find((event) => event.type === "response.output_audio.delta");
    call.check("B: the next turn gets audio", call.phone.outFrames > framesBefore && finished === "finished", { finished, frames: call.phone.outFrames - framesBefore });
    call.result.timings.turns.push({ line: "ألو تسمعني", endToFirstDeltaMs: firstAfter ? firstAfter.t - endedAt : null });

    const noiseIndex = call.events.length;
    call.log("LINE quiet noise for 8 s");
    call.phone.noise = true;
    await sleep(8000);
    call.phone.noise = false;
    const noiseEvents = call.events.slice(noiseIndex);
    call.check("idle line noise is not committed", noiseEvents.filter((event) => event.type === "input_audio_buffer.committed").length === 0, noiseEvents.map((event) => event.type));
    call.result.noiseCommits = noiseEvents.filter((event) => event.type === "input_audio_buffer.committed").length;
  } finally {
    await call.end();
    try { await post(call.request.StatusCallback, callFields(call.sid, { CallStatus: "completed", CallDuration: "42", SequenceNumber: "3", CallbackSource: "call-progress-events", Timestamp: new Date().toUTCString() })); } catch { /* best effort */ }
    call.report();
  }
}

const PLAN = [
  { key: "health", when: (s) => s.step === "report_question" && s.q?.startsWith("herd_health"), say: "إيه كلها بخير الحمد لله", again: "كلها بخير" },
  { key: "herd", when: (s) => s.step === "report_question" && s.q === "herd_count", say: "عشرين ناقة", again: "عشرين" },
  { key: "feed", when: (s) => s.step === "report_question" && s.q === "feed_level", clarify: "ايش تقصد بالعلف؟", say: "باقي شوي", again: "باقي شوي من العلف" },
  { key: "water", when: (s) => s.step === "report_question" && s.q === "water_level", interrupt: "لحظة، الموية كافية الحمد لله", say: "الموية كافية", again: "كافية" },
  { key: "custom", when: (s) => s.step === "report_question" && /^[0-9a-f-]{36}$/.test(s.q ?? ""), say: "لا والله ما جا أحد اليوم", again: "لا ما جا" },
  { key: "summary", when: (s) => s.step === "report_summary", say: "إيه صح، احفظه", again: "إيه احفظه" },
];

const reusableLine = { said: new Map() };

async function converse(call) {
  const said = new Map();
  let clarified = false;
  let interrupted = false;
  let silent = 0;
  await call.assistantFinished(0);
  for (let turn = 0; turn < 30 && !call.stream.closed; turn += 1) {
    const current = state(call.sid);
    if (!current || current.done) break;
    const step = PLAN.find((entry) => entry.when(current));
    if (!step) { call.note(`No plan for ${current.step}/${current.q}`); break; }
    const count = said.get(step.key) ?? 0;
    if (count >= 3) { call.note(`Stuck on ${step.key}`); call.check(`engine advances past ${step.key}`, false, current); break; }
    said.set(step.key, count + 1);
    let line = count ? step.again : step.say;
    if (step.clarify && !clarified) { line = step.clarify; clarified = true; said.set(step.key, 0); call.clarifyTurn = true; }
    const index = call.events.length;
    const before = JSON.stringify(current);
    const endedAt = await call.say(line);
    const entry = { step: `${current.step}/${current.q ?? ""}`, line, turn: current.turn };
    const during = async () => {
      if (interrupted || call.stream.closed) return;
      const now = Date.now();
      if (call.lastInterruptProbe && now - call.lastInterruptProbe < 400) return;
      call.lastInterruptProbe = now;
      const live = state(call.sid);
      const target = live && PLAN.find((item) => item.when(live));
      if (target?.interrupt && call.phone.playing && call.phone.audioRemainingMs > 900) {
        interrupted = true;
        const clears = call.phone.clears;
        const interruptIndex = call.events.length;
        call.log(`CALLER interrupts during playback (${Math.round(call.phone.audioRemainingMs)} ms left)`);
        const interruptEnded = await call.say(target.interrupt);
        await waitFor(() => call.events.slice(interruptIndex).some((event) => event.type === "input_audio_buffer.speech_started"), "VAD on the interruption", 30).catch(() => {});
        await sleep(600);
        call.check("interruption clears Twilio playback", call.phone.clears > clears, call.phone.clears);
        const sent = call.events.slice(interruptIndex).filter((event) => ["response.cancel", "conversation.item.truncate"].includes(event.type));
        call.check("interruption cancels or truncates the reply", sent.length > 0, sent);
        call.result.interrupt = { endedAt: interruptEnded, cancels: sent.map((event) => event.type) };
        said.set(target.key, (said.get(target.key) ?? 0) + 1);
        call.interruptAnswered = true;
      }
    };
    const finished = await call.assistantFinished(index, { during });
    const firstDelta = call.events.slice(index).find((event) => event.type === "response.output_audio.delta" && event.t > endedAt);
    entry.endToFirstDeltaMs = firstDelta ? firstDelta.t - endedAt : null;
    call.result.timings.turns.push(entry);
    if (finished === "closed") break;
    if (finished === null) {
      silent += 1;
      call.note(`No reply within 25 s after «${line}» at ${entry.step}`);
      if (silent >= 2) { call.check("every turn gets a reply", false, entry); break; }
      continue;
    }
    if (line === step.clarify) {
      call.check("clarification turn changes no state", JSON.stringify(state(call.sid)) === before, state(call.sid));
      call.check("clarification turn is answered in speech", call.events.slice(index).some((event) => event.type === "response.output_audio.delta"), entry);
    }
  }
  return { reusableLine };
}

async function finishConversation(call, { expect = {}, herd } = {}) {
  await call.stream.waitClosed(20_000);
  call.check("the bridge closes the Twilio socket after the call", call.stream.closed, null);
  const after = await post(call.afterUrl, callFields(call.sid));
  call.after = after;
  call.check("/after only hangs up after a save", after.status === 200 && /<Hangup/.test(after.xml) && !/<Gather|<Say/.test(after.xml), after.xml.slice(0, 300));
  const status = await post(call.request.StatusCallback, callFields(call.sid, { CallStatus: "completed", CallDuration: "42", SequenceNumber: "3", CallbackSource: "call-progress-events", Timestamp: new Date().toUTCString() }));
  call.check("status callback is accepted", status.status === 204, status);
  const farm = call.ranch.farm;
  const reports = rows(`select * from reports where farm_id = ${q(farm)}`);
  call.check("exactly one report row", reports.length === 1, reports.length);
  const report = reports[0];
  if (herd !== undefined) call.check(`herd count reported is ${herd}`, String(report?.herd_count_reported) === String(herd), report?.herd_count_reported);
  const runs = rows(`select * from report_call_runs where farm_id = ${q(farm)}`);
  call.check("the run is completed and linked", runs[0]?.state === "completed" && runs[0]?.report_id === report?.id, runs[0]);
  call.check("voice session is cleaned up", state(call.sid) === null, state(call.sid));
  const answers = rows(`select question_id, answer, answer_ar, answer_en, certainty from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm)} order by a.sort_order`);
  call.result.answers = answers;
  for (const [id, pattern] of Object.entries(expect)) {
    const found = answers.find((row) => row.question_id.startsWith(id) || (id === "cq_" && /^[0-9a-f-]{36}$/.test(row.question_id)));
    const text = `${found?.answer ?? ""} ${found?.answer_ar ?? ""} ${found?.answer_en ?? ""}`;
    call.check(`answer ${id} maps to ${pattern}`, found && pattern.test(text), found ?? null);
  }
  const owner = (await outbound()).filter((request) => request.To === OWNER);
  call.check("owner update call is requested once", owner.length === 1, owner.length);
}

function checkTools(call) {
  call.result.tools = call.of("response.function_call_arguments.done").map((event) => ({ name: event.name, arguments: event.arguments }));
  const outputs = call.of("conversation.item.create").filter((event) => event.dir === "out" && event.item?.type === "function_call_output").map((event) => JSON.parse(event.item.output));
  call.result.toolOutputs = outputs;
  call.result.rejected = outputs.filter((output) => output.status === "invalid");
  const summary = outputs.find((output) => output.isSummary)?.summary;
  const said = call.of("response.output_audio_transcript.done").map((event) => event.transcript).join(" ");
  if (summary) {
    const words = summary.split(/\s+/).filter((word) => word.length > 2);
    const heard = words.filter((word) => said.includes(word)).length;
    call.result.summaryOverlap = heard / words.length;
    call.check("the model reads the summary back", heard / words.length >= 0.6, { overlap: heard / words.length, summary, said: said.slice(-600) });
  } else call.check("the engine produced a summary", false, outputs.at(-1));
  const saved = call.of("conversation.item.create").filter((event) => event.dir === "out" && event.item?.type === "function_call_output" && /"status":"saved"/.test(event.item.output)).length;
  call.check("a confirm_report call saved the report", saved === 1, saved);
}

async function scenarioC() {
  const ranch = await makeFarm(FULL);
  const call = new Call("C", "Full conversation: Basic ranch with camels, resources and a custom question", ranch);
  console.log("\nC Full conversation");
  try {
    await call.place();
    await converse(call);
    checkTools(call);
    await call.stream.waitClosed(20_000);
    await call.end();
    await finishConversation(call, { herd: 20, expect: { herd_health: /well|بخير/i, feed_level: /low|قليل|ناقص|شوي/i, water_level: /good|sufficient|كاف/i, cq_: /ما جا|ما فيه|nothing new|no/i } });
  } catch (error) {
    call.result.error = error.stack ?? String(error);
    console.log(`  ERROR ${error.message}`);
    await call.end();
  } finally {
    call.report();
  }
}

async function scenarioE() {
  const ranch = await makeFarm();
  const call = new Call("E", "Full conversation: empty ranch", ranch);
  console.log("\nE Empty ranch");
  try {
    await call.place();
    await converse(call);
    checkTools(call);
    await call.stream.waitClosed(20_000);
    await call.end();
    await finishConversation(call, {});
  } catch (error) {
    call.result.error = error.stack ?? String(error);
    console.log(`  ERROR ${error.message}`);
    await call.end();
  } finally {
    call.report();
  }
}

/* ─────────────────── main ─────────────────── */

const scenarios = { A: scenarioA, C: scenarioC, E: scenarioE };
const started = Date.now();
let exitCode = 1;
let commit = "";
try {
  commit = exportTree();
  await startStack();
  await startNext();
  await startBridge();
  await warmUp();
  for (const id of ONLY) {
    if (ledger.seconds >= MAX_SECONDS) { console.log(`Budget reached before ${id}`); break; }
    await scenarios[id]();
  }
  exitCode = results.every((r) => !r.error && r.checks.every((c) => c.passed)) && results.length === ONLY.length ? 0 : 1;
} catch (error) {
  console.error(`HARNESS ERROR ${error.stack ?? error}`);
} finally {
  stopAll();
  await sleep(800);
  stopPg();
  if (flag("cleanup")) rmSync(SRC, { recursive: true, force: true });
  else rmSync(join(SRC, ".next"), { recursive: true, force: true });
}

const table = results.map((r) => {
  const failed = r.checks.filter((c) => !c.passed);
  return `${r.error ? "ERROR" : failed.length ? "FAIL" : "PASS"} ${r.id} ${r.title} (${r.checks.length - failed.length}/${r.checks.length})`;
}).join("\n");
const bridgeLog = existsSync(join(LOGS, "bridge.log")) ? readFileSync(join(LOGS, "bridge.log"), "utf8") : "";
if (bridgeLog.includes("[guard] blocked")) console.log(`GUARD: ${bridgeLog.match(/\[guard\] blocked.*/)[0]}`);
if (OPENAI_KEY && (bridgeLog.includes(OPENAI_KEY) || readFileSync(TAP, "utf8").includes(OPENAI_KEY))) console.log("WARNING: the key appeared in a log");
writeFileSync(join(LOGS, "result.json"), JSON.stringify({ label: LABEL, commit, results }, null, 2));
writeFileSync(join(LOGS, "summary.txt"), `${table}\n`);
console.log(`\n=== ${LABEL} (commit ${commit}, ${Math.round((Date.now() - started) / 1000)}s, budget ${ledger.runs} runs ${Math.round(ledger.seconds)} s) ===\n${table}`);
process.exit(exitCode);
