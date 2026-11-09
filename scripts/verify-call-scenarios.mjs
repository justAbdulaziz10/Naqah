#!/usr/bin/env node
/**
 * LOCAL ONLY. Drives complete NAQAH report calls through the real signed webhook routes against a
 * throwaway Postgres + PostgREST (supabase/local-validation) with Twilio mocked (mock-outbound.mjs).
 * It exports the working tree to /tmp/naqah-s3/src, boots everything, runs the scenarios and stops.
 * Nothing here can reach Twilio or Supabase: the app only ever gets fake credentials and loopback URLs.
 *
 *   node scripts/verify-call-scenarios.mjs [--label final] [--only S1,S3] [--ref HEAD] [--cleanup]
 *     [--root /tmp/naqah-s3] [--pg-port 54660] [--rest-port 54661] [--gateway-port 54662] [--app-port 3801]
 *   Without --ref it tests the working tree; with --ref it tests that commit (a clean baseline).
 *
 * Results and full call transcripts: /tmp/naqah-s3/logs/<label>/ (result.json, transcripts.txt, server logs).
 * The exit code is 1 when any check fails. --cleanup also deletes the export and node_modules clone.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = arg("root", "/tmp/naqah-s3");
const SRC = join(ROOT, "src");
// When /tmp/naqah-s3/ram holds a mounted scratch volume (ram.dev), Postgres and .next live there to spare the disk.
const SCRATCH = existsSync(join(ROOT, "ram.dev")) ? join(ROOT, "ram") : ROOT;
const PGDATA = join(SCRATCH, "pg");
const SOCK = join(ROOT, "sock");
const LABEL = arg("label", "run");
const LOGS = join(ROOT, "logs", LABEL);
const ONLY = arg("only", "")?.split(",").filter(Boolean);
const REF = arg("ref", "");
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const PG_PORT = arg("pg-port", "54660");
const REST_PORT = arg("rest-port", "54661");
const GATEWAY_PORT = arg("gateway-port", "54662");
const APP_PORT = arg("app-port", "3801");
const DB = "naqah_s3";
const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
const APP = `http://localhost:${APP_PORT}`;
const PUBLIC = "https://naqah-s3.example.test";
const AUTH_TOKEN = "local-test-auth-token";
const SECRET = "local-only-voice-secret-for-call-scenarios";
const CRON_SECRET = "local-only-cron-secret";
const SID = `AC${"0".repeat(32)}`;
const WORKER = "+15555550101";
const OWNER = "+15555550102";
const TWILIO_NUMBER = "+15555550100";

mkdirSync(LOGS, { recursive: true });
const PATH = `${PG_BIN}:${process.env.PATH}`;
const pgEnv = { PATH, LC_ALL: "en_US.UTF-8", PGHOST: "127.0.0.1", PGPORT: PG_PORT, PGUSER: "postgres" };
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NAQAH_|TWILIO_|SUPABASE|NEXT_PUBLIC_|CRON_|PG)/.test(key)));
const children = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ─────────────────── environment ─────────────────── */

function linkNext() {
  if (SCRATCH === ROOT) return;
  rmSync(join(SCRATCH, ".next"), { recursive: true, force: true });
  mkdirSync(join(SCRATCH, ".next"), { recursive: true });
  execFileSync("ln", ["-sfn", join(SCRATCH, ".next"), join(SRC, ".next")]);
  execFileSync("ln", ["-sfn", join(SRC, "node_modules"), join(SCRATCH, "node_modules")]);
}

function exportTree() {
  mkdirSync(SRC, { recursive: true });
  if (REF) {
    for (const entry of readdirSync(SRC)) if (entry !== "node_modules") rmSync(join(SRC, entry), { recursive: true, force: true });
    execFileSync("sh", ["-c", `git -C "${REPO}" archive ${REF} | tar -C "${SRC}" -xf -`]);
    if (!existsSync(join(SRC, "node_modules"))) execFileSync("cp", ["-c", "-R", join(REPO, "node_modules"), join(SRC, "node_modules")]);
    linkNext();
    return `${execFileSync("git", ["-C", REPO, "rev-parse", "--short", REF], { encoding: "utf8" }).trim()} (clean)`;
  }
  const files = execFileSync("git", ["-C", REPO, "ls-files", "-co", "--exclude-standard"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const list = join(ROOT, "files.txt");
  writeFileSync(list, files.split("\n").filter((file) => file && !/(^|\/)\.env/.test(file) && existsSync(join(REPO, file))).join("\n"));
  for (const entry of readdirSync(SRC)) if (entry !== "node_modules") rmSync(join(SRC, entry), { recursive: true, force: true });
  execFileSync("sh", ["-c", `tar -C "${REPO}" -cf - -T "${list}" | tar -C "${SRC}" -xf -`]);
  if (!existsSync(join(SRC, "node_modules"))) execFileSync("cp", ["-c", "-R", join(REPO, "node_modules"), join(SRC, "node_modules")]);
  linkNext();
  return execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

function startPg() {
  rmSync(PGDATA, { recursive: true, force: true });
  mkdirSync(SOCK, { recursive: true });
  execFileSync("initdb", ["-D", PGDATA, "-U", "postgres", "--auth=trust", "-E", "UTF8"], { env: { ...baseEnv, ...pgEnv }, stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", PGDATA, "-w", "-l", join(SCRATCH, "postgres.log"), "-o", `-p ${PG_PORT} -h 127.0.0.1 -k ${SOCK} -c fsync=off`, "start"], { env: { ...baseEnv, ...pgEnv }, stdio: "ignore" });
}
function stopPg() {
  try { execFileSync("pg_ctl", ["-D", PGDATA, "-m", "fast", "-w", "stop"], { env: { ...baseEnv, ...pgEnv }, stdio: "ignore" }); } catch { /* already stopped */ }
  rmSync(PGDATA, { recursive: true, force: true });
}

function background(name, command, args, env, cwd) {
  const out = openSync(join(LOGS, `${name}.log`), "w");
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", out, out], detached: true });
  closeSync(out);
  children.push(child);
  return child;
}

async function waitFor(probe, what, tries = 240) {
  for (let index = 0; index < tries; index += 1) {
    try { if (await probe()) return; } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function startStack() {
  startPg();
  const stackEnv = join(ROOT, "stack.env");
  background("stack", "sh", [join(SRC, "supabase/local-validation/run-stack.sh"), stackEnv], {
    ...baseEnv, ...pgEnv, NAQAH_TEST_DB: DB, NAQAH_TEST_REST_PORT: REST_PORT, NAQAH_TEST_GATEWAY_PORT: GATEWAY_PORT,
    POSTGREST_BIN: "/opt/homebrew/bin/postgrest",
  }, SRC);
  await waitFor(() => existsSync(stackEnv), "stack.env");
  const keys = Object.fromEntries([...readFileSync(stackEnv, "utf8").matchAll(/export (\w+)='([^']*)'/g)].map((m) => [m[1], m[2]]));
  background("next", join(SRC, "node_modules/.bin/next"), ["dev", "-p", APP_PORT], {
    ...baseEnv, PATH, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--import=${join(SRC, "supabase/local-validation/mock-outbound.mjs")}`,
    NAQAH_TEST_OUTBOUND_GATEWAY: `${GATEWAY}/`,
    ...keys,
    NEXT_PUBLIC_NAQAH_ACCOUNT_DATA: "1",
    NAQAH_VOICE_MODE: "farm", NAQAH_VOICE_LOCALE: "ar", NAQAH_VOICE_SECRET: SECRET, NAQAH_PUBLIC_BASE_URL: PUBLIC,
    NAQAH_MANUAL_REPORT_CALLS: "1", NAQAH_SCHEDULED_CALLS: "1", NAQAH_CALL_OWNER: "1", NAQAH_CALL_ALLOWLIST: `${WORKER},${OWNER}`,
    CRON_SECRET, TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: AUTH_TOKEN, TWILIO_PHONE_NUMBER: TWILIO_NUMBER,
  }, SRC);
  await waitFor(async () => (await fetch(`${APP}/api/cron/report-calls`)).status === 401, "next dev", 480);
}

function stopAll() {
  for (const child of children) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  }
}

/* ─────────────────── helpers ─────────────────── */

const sql = (query) => execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], {
  input: query, encoding: "utf8", env: { ...baseEnv, ...pgEnv }, maxBuffer: 1 << 26,
}).trim();
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const postJson = async (url, body) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const provider = async () => (await (await fetch(`${GATEWAY}/__test/outbound`)).json()).requests;
const resetProvider = () => postJson(`${GATEWAY}/__test/outbound`, { status: 201, reset: true });
const faults = (rest) => postJson(`${GATEWAY}/__test/faults`, { rest });

const decode = (text) => text.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
const says = (xml) => [...xml.matchAll(/<Say\b[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => decode(m[1])).join(" ");
const gather = (xml) => {
  const raw = xml.match(/<Gather\b[^>]*\baction="([^"]+)"/)?.[1];
  return raw ? decode(raw) : null;
};

function signature(url, fields, token = AUTH_TOKEN) {
  let value = url;
  for (const key of Object.keys(fields).sort()) value += key + fields[key];
  return createHmac("sha1", token).update(value, "utf8").digest("base64");
}

async function post(target, fields, { token = AUTH_TOKEN, signed = true, signUrl } = {}) {
  const publicUrl = new URL(target, PUBLIC).toString();
  const parsed = new URL(publicUrl);
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (signed) headers["X-Twilio-Signature"] = signature(signUrl ?? publicUrl, fields, token);
  const response = await fetch(`${APP}${parsed.pathname}${parsed.search}`, { method: "POST", headers, body: new URLSearchParams(fields) });
  return { status: response.status, xml: await response.text() };
}

const callFields = (sid, extra) => ({
  AccountSid: SID, ApiVersion: "2010-04-01", CallSid: sid, CallStatus: "in-progress",
  Called: WORKER, Caller: TWILIO_NUMBER, Direction: "outbound-api", From: TWILIO_NUMBER, To: WORKER, ...extra,
});
const speech = (text, confidence = "0.92") => ({ SpeechResult: text, Confidence: confidence, msg: "Gather End" });
const keys = (digits) => ({ Digits: digits, msg: "Gather End" });
const SILENT = { SpeechResult: "", Confidence: "0.0", msg: "Gather End" };
const NOTHING = { msg: "Gather End" };

class Call {
  constructor(request, scenario) {
    this.request = request;
    this.sid = request.sid;
    this.scenario = scenario;
    this.xml = "";
    this.status = 0;
    this.transcript = [];
    this.turns = 0;
    (current.calls ??= []).push({ name: scenario, sid: this.sid, transcript: this.transcript });
  }
  get text() { return says(this.xml); }
  get action() { return gather(this.xml); }
  get ended() { return /<Hangup\s*\/?>/.test(this.xml) || !this.action; }
  log(input) { this.transcript.push({ in: input, status: this.status, said: this.text, ended: this.ended, gather: this.xml.match(/<Gather\b[^>]*>/)?.[0] ?? null }); }
  async answer() {
    const reply = await post(this.request.Url, callFields(this.sid));
    Object.assign(this, reply);
    this.log("[answered]");
    return this;
  }
  async turn(input) {
    const action = this.action;
    if (!action) throw new Error("No Gather to answer");
    const reply = await post(action, callFields(this.sid, input));
    Object.assign(this, reply);
    this.turns += 1;
    this.log(input);
    return this;
  }
  async finalStatus(CallStatus = "completed", extra = {}) {
    const reply = await post(this.request.StatusCallback, callFields(this.sid, { CallStatus, CallDuration: "42", SequenceNumber: "3", CallbackSource: "call-progress-events", Timestamp: new Date().toUTCString(), ...extra }));
    this.transcript.push({ in: `[status ${CallStatus}]`, status: reply.status, said: "", ended: true });
    return reply;
  }
}

/* ─────────────────── scenario bookkeeping ─────────────────── */

const results = [];
let current = null;
function scenario(id, title, run) { registry.push({ id, title, run }); }
const registry = [];
function check(name, passed, detail) {
  current.checks.push({ name, passed: Boolean(passed), detail: passed ? undefined : detail });
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${passed || detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 500)}`}`);
}
const note = (text) => { current.notes.push(text); console.log(`  NOTE ${text}`); };

/* ─────────────────── fixtures ─────────────────── */

async function makeOwner() {
  const email = `s3-${randomBytes(5).toString("hex")}@example.test`;
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

/** Basic ranch, one primary worker. Default: no camels, no herd count, no resources. */
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

async function callNow(ranch, scenarioName) {
  await resetProvider();
  const result = await ranch.account({ op: "callNow" });
  if (!result.ok) throw new Error(`callNow failed: ${JSON.stringify(result)}`);
  if (result.data?.status === "blocked") throw new Error(`callNow blocked: ${JSON.stringify(result.data)}`);
  await waitFor(async () => (await provider()).length >= 1, "provider request", 80);
  const request = (await provider())[0];
  check("the call goes to the fake worker with recording off", request.To === WORKER && request.Record === "false", { To: request.To, Record: request.Record });
  return new Call(request, scenarioName);
}

const count = (table, farm, where = "true") => Number(sql(`select count(*) from ${table} where farm_id = ${q(farm)} and ${where}`));
const run = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(r) order by occurrence desc), '[]') from report_call_runs r where farm_id = ${q(farm)}`));
const answersOf = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(a) order by a.sort_order), '[]') from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm)}`));
const reportOf = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(r) order by at), '[]') from reports r where farm_id = ${q(farm)}`));
const callRows = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(c) order by at), '[]') from calls c where farm_id = ${q(farm)}`));
const sessions = (sid) => Number(sql(`select count(*) from voice_call_sessions where call_sid = ${q(sid)}`));

async function dashboard(ranch) {
  const loaded = await ranch.account({ op: "load" });
  return loaded.data?.workspace ?? loaded.data ?? loaded;
}

/** The worker hears each prompt; `plan` answers what matches, anything unplanned gets `fallback`. */
async function drive(call, plan, { fallback = speech("إيه"), max = 45, until } = {}) {
  for (let index = 0; index < max && !call.ended; index += 1) {
    const text = call.text;
    if (until?.test(text)) return;
    const step = plan.find((item) => item.ask.test(text));
    await call.turn(step ? step.input : fallback);
  }
}

/** The owner is called at the owner's own time by the scheduler, so saving a report never dials them. */
async function assertOwnerNotDialled() {
  await sleep(1200);
  const dialled = (await provider()).map((r) => r.To);
  check("saving the report does not dial the owner", !dialled.includes(OWNER), dialled);
}

/** One saved report, its run linked, no call straight to the owner, and the dashboard showing it. */
async function assertSaved(ranch, call, { expected = [], herd } = {}) {
  check("the worker hears that the update is saved", /تم حفظ التحديث/.test(call.text), call.text);
  const status = await call.finalStatus("completed");
  check("final status callback is accepted", status.status === 204, status);
  const farm = ranch.farm;
  const reports = reportOf(farm);
  const report = reports[0];
  check("exactly one report row", reports.length === 1, reports);
  if (herd !== undefined) check(`herd count reported is ${herd}`, String(report?.herd_count_reported) === String(herd), report);
  const [latest] = run(farm);
  check("report_call_runs is completed and linked to the report", latest?.state === "completed" && latest?.report_id === report?.id, latest);
  check("the run keeps the provider CallSid", latest?.provider_call_id === call.sid || latest?.provider_call_id === null, latest);
  if (latest?.provider_call_id === null) note("report_call_runs.provider_call_id is null after the call");
  const calls = callRows(farm).filter((row) => row.kind === "worker_report");
  check("one worker_report call row with the CallSid", calls.length === 1 && calls[0].provider_call_id === call.sid && calls[0].report_id === report?.id, calls);
  check("the live session is cleaned up", sessions(call.sid) === 0, sessions(call.sid));
  const answers = answersOf(farm);
  current.answers = answers.map(({ question_id, answer, answer_ar, certainty }) => ({ question_id, answer, answer_ar, certainty }));
  for (const { id, text, certainty } of expected) {
    const found = answers.find((row) => row.question_id.startsWith(id) || (id === "cq_" && /^[0-9a-f-]{36}$/.test(row.question_id)));
    const value = `${found?.answer ?? ""} ${found?.answer_ar ?? ""} ${found?.answer_en ?? ""}`;
    check(`answer ${id} maps to ${text}`, found && text.test(value), found ?? answers.map((a) => a.question_id));
    if (certainty && found) check(`answer ${id} certainty is ${certainty}`, found.certainty === certainty, found);
  }
  const ws = await dashboard(ranch);
  const last = ws.reports?.at?.(-1);
  check("the owner's dashboard reads the report", ws.reports?.length === 1 && Boolean(ws.lastUpdateAt) && last?.answers?.length === answers.length, { reports: ws.reports?.length, lastUpdateAt: ws.lastUpdateAt, answers: last?.answers?.length });
  check("the dashboard's run points to the report", ws.reportCalls?.at?.(-1)?.state === "completed", ws.reportCalls?.at?.(-1));
  await assertOwnerNotDialled();
  return ws;
}

function assertNotSaved(ranch, call, label = "no report") {
  check(`${label}: no report row`, count("reports", ranch.farm) === 0, reportOf(ranch.farm));
  const transcript = call.transcript.map((t) => t.said).join(" ");
  check(`${label}: never says the update was saved`, !/تم حفظ/.test(transcript), transcript.slice(-300));
}

/* ─────────────────── questions ─────────────────── */

const Q = {
  // The full read-back repeats questions, so the question patterns must not match the summary.
  health: /^(?![\s\S]*أحفظه)[\s\S]*حال الحلال/,
  herdCount: /كم عدد الحلال/,
  feed: /كم باقي من العلف/,
  water: /كيف وضع الماء/,
  custom: /^(?![\s\S]*أحفظه)[\s\S]*البيطري/,
  summary: /أحفظه/,
};

/* ─────────────────── scenarios ─────────────────── */

scenario("M0", "The migrations this verifier depends on are applied", async () => {
  for (const file of ["20261109182526_owner_summary_schedule.sql", "20261110090000_mvp_owner_runs.sql"]) check(`${file} is in the tree`, existsSync(join(SRC, "supabase/migrations", file)));
  const columns = sql("select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name = 'farms' and column_name in ('owner_call_day', 'owner_call_time', 'owner_call_run')");
  check("the owner schedule and owner run columns exist", ["owner_call_day", "owner_call_time", "owner_call_run"].every((name) => columns.includes(name)), columns);
});

scenario("S1a", "Happy: zero camels, no herd count, natural speech", async () => {
  const ranch = await makeFarm();
  const call = await callNow(ranch, "S1a");
  await call.answer();
  check("answering the phone gets a question", call.status === 200 && Boolean(call.action), call.xml.slice(0, 400));
  await drive(call, [
    { ask: Q.health, input: speech("كلها بخير") },
    { ask: Q.summary, input: speech("إيه") },
  ]);
  note(`empty ranch hears the herd question: ${/حال الحلال/.test(call.transcript[0].said)}; summary: ${call.transcript.find((t) => /أحفظه/.test(t.said))?.said}`);
  check("not asked for a herd count on an empty ranch", !call.transcript.some((t) => /كم عدد/.test(t.said)), call.transcript.map((t) => t.said));
  await assertSaved(ranch, call, { expected: [] });
});

scenario("S1b", "Happy: camels, resources, custom question, natural speech", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S1b");
  await call.answer();
  await drive(call, [
    { ask: Q.health, input: speech("كلها بخير") },
    { ask: Q.herdCount, input: speech("عشرين ناقة") },
    { ask: Q.feed, input: speech("باقي شوي") },
    { ask: Q.water, input: speech("إيه كافي") },
    { ask: Q.custom, input: speech("لا ما جا") },
    { ask: Q.summary, input: speech("إيه") },
  ], { fallback: speech("إيه") });
  await assertSaved(ranch, call, {
    herd: 20,
    expected: [
      { id: "herd_health", text: /well|بخير/i },
      { id: "feed_level", text: /low|قليل|ناقص/i },
      { id: "water_level", text: /good|sufficient|كاف/i },
      { id: "cq_", text: /ما جا/ },
    ],
  });
});

scenario("S1c", "Happy: diacritics, hamza variants and trailing words", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S1c");
  await call.answer();
  await drive(call, [
    { ask: Q.health, input: speech("كُلُّها بِخَيْر الحمد لله") },
    { ask: Q.herdCount, input: speech("٢٠ ناقة تقريبا") },
    { ask: Q.feed, input: speech("باقي شوي يا طويل العمر") },
    { ask: Q.water, input: speech("ايوه الخزان كافي") },
    { ask: Q.custom, input: speech("لا والله ما جاء أحد") },
    { ask: Q.summary, input: speech("أيوه احفظه") },
  ], { fallback: speech("أيوه") });
  await assertSaved(ranch, call, { herd: 20, expected: [
    { id: "herd_health", text: /well|بخير/i },
    { id: "feed_level", text: /low|قليل|ناقص/i },
    { id: "water_level", text: /good|sufficient|كاف/i },
  ] });
});

scenario("S1d", "Happy: «ما أدري» and «مدري» are saved as unknown", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S1d");
  await call.answer();
  await drive(call, [
    { ask: Q.health, input: speech("مدري") },
    { ask: Q.herdCount, input: speech("ما أدري") },
    { ask: Q.feed, input: speech("ما ادري والله") },
    { ask: Q.water, input: speech("مدري") },
    { ask: Q.custom, input: speech("ما أدري") },
    { ask: Q.summary, input: speech("إيه") },
  ]);
  await assertSaved(ranch, call, { expected: [
    { id: "herd_health", text: /know|ما أدري|لم يعرف/i, certainty: "unknown" },
    { id: "feed_level", text: /know|unknown|ما أدري|غير معروف/i, certainty: "unknown" },
    { id: "water_level", text: /know|unknown|ما أدري|غير معروف/i, certainty: "unknown" },
    { id: "cq_", text: /know|ما أدري/i, certainty: "unknown" },
  ] });
});

scenario("S2", "Keypad path", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S2");
  await call.answer();
  for (let index = 0; index < 40 && !call.ended; index += 1) {
    const text = call.text;
    const xml = call.xml;
    if (xml.includes('finishOnKey="#"') && /قل العدد/.test(text)) {
      check("number prompts do not cut off at one digit", !xml.includes("numDigits="), xml.slice(0, 300));
      await call.turn(keys(Q.herdCount.test(text) ? "20" : "25"));
    } else if (xml.includes('finishOnKey="#"')) {
      await call.turn(keys("1"));
    } else await call.turn(keys("1"));
  }
  await assertSaved(ranch, call, { herd: 20, expected: [{ id: "herd_health", text: /well|بخير/i }, { id: "feed_level", text: /.+/ }, { id: "water_level", text: /.+/ }] });
});

scenario("S3a", "Silence once, then answered (empty SpeechResult and no fields)", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S3a");
  await call.answer();
  const first = call.text;
  await call.turn(SILENT);
  check("one empty SpeechResult repeats the same question", call.action && call.text.includes(first.slice(-40)) && /معليش/.test(call.text), call.text);
  await call.turn(speech("كلها بخير"));
  const second = call.text;
  await call.turn(NOTHING);
  check("a Gather with no speech field also repeats the question", call.action && call.text.includes(second.slice(-30)), call.text);
  await drive(call, [{ ask: Q.herdCount, input: speech("عشرين") }, { ask: Q.feed, input: speech("كافي") }, { ask: Q.water, input: speech("كافي") }, { ask: Q.custom, input: speech("لا") }]);
  await assertSaved(ranch, call, { herd: 20 });
});

scenario("S3b", "Silence until the call gives up", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S3b");
  await call.answer();
  for (let index = 0; index < 45 && !call.ended; index += 1) await call.turn(SILENT);
  note(`silent call ended after ${call.turns} turns; last line: ${call.text}`);
  check("repeated silence ends the call", call.ended, call.text);
  check("repeated silence ends within a sensible number of turns (<= 12)", call.turns <= 12, call.turns);
  const repeats = {};
  for (const line of call.transcript) {
    const key = line.said.replace(/^معليش،[^.]*\. (?:نعيد السؤال مرة أخيرة\. )?/, "");
    repeats[key] = (repeats[key] ?? 0) + 1;
  }
  check("no prompt loops more than 3 times", Math.max(...Object.values(repeats)) <= 3, repeats);
  const status = await call.finalStatus("completed");
  check("final status accepted", status.status === 204, status);
  assertNotSaved(ranch, call);
  const [latest] = run(ranch.farm);
  note(`run state after silent call: ${latest.state}; events: ${sql(`select string_agg(text_en, ' | ' order by at) from events where farm_id = ${q(ranch.farm)}`)}`);
  check("the run is closed as missed, not left open", latest.state === "missed", latest);
  check("the live session is cleaned up", sessions(call.sid) === 0);
});

scenario("S3c", "Replay of call 9b929d (speech, speech, 2 silent, speech, 3 silent), then a correct call", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S3c-replay");
  await call.answer();
  const noise = speech("البطيخ طاير فوق السطح", "0.0");
  for (const input of [noise, noise, SILENT, SILENT, noise, SILENT, SILENT]) {
    await call.turn(input);
    check(`turn ${call.turns - 1} keeps the call open`, !call.ended, call.text);
  }
  await call.turn(SILENT);
  note(`what each turn replied: ${call.transcript.map((line) => `[${line.said.length} chars] ${line.said}`).join(" || ")}`);
  check("the call gives up on the eighth turn", call.ended && call.turns === 8, { turns: call.turns, ended: call.ended });
  check("the last line asks the caller to call again and hangs up", /ما قدرت أفهم إجابتك/.test(call.text) && /<Hangup/.test(call.xml), call.text);
  const logged = readFileSync(join(LOGS, "next.log"), "utf8").split("\n")
    .filter((line) => line.includes(`[NAQAH] voice turn call=${call.sid.slice(-6)}`))
    .slice(-8).map((line) => line.match(/parse=(\w+)/)?.[1]);
  check("the server log matches the real call's sequence", logged.join() === "unmapped,unmapped,empty,empty,unmapped,empty,empty,empty", logged);
  const status = await call.finalStatus("completed");
  check("final status accepted", status.status === 204, status);
  assertNotSaved(ranch, call);
  const [ended] = run(ranch.farm);
  check("the run is missed with one answered attempt and no retry", ended.state === "missed" && ended.attempts?.length === 1 && ended.attempts[0].result === "answered" && ended.next_attempt_at === null, ended);
  check("the owner is told the call ended unsaved", /ended before the report was saved/.test(sql(`select string_agg(text_en, ' | ' order by at) from events where farm_id = ${q(ranch.farm)}`)));
  check("the live session is cleaned up", sessions(call.sid) === 0);
  check("no owner update call follows it", !(await provider()).some((r) => r.To === OWNER));

  const retry = await callNow(ranch, "S3c-correct");
  await retry.answer();
  await drive(retry, [
    { ask: Q.health, input: speech("كلها بخير") }, { ask: Q.herdCount, input: speech("عشرين ناقة") },
    { ask: Q.feed, input: speech("باقي شوي") },
    { ask: Q.water, input: speech("إيه كافي") },
    { ask: Q.custom, input: speech("لا ما جا") }, { ask: Q.summary, input: speech("إيه") },
  ]);
  await assertSaved(ranch, retry, {
    herd: 20,
    expected: [
      { id: "herd_health", text: /well|بخير/i },
      { id: "feed_level", text: /low|قليل|ناقص/i },
      { id: "water_level", text: /good|sufficient|كاف/i },
      { id: "cq_", text: /ما جا/ },
    ],
  });
  const runs = run(ranch.farm);
  check("the earlier run stays missed beside the completed one", runs.length === 2 && runs.filter((r) => r.state === "missed").length === 1, runs.map((r) => r.state));
});

scenario("S4a", "Recognised words count even at low confidence", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S4a");
  await call.answer();
  const first = call.text;
  await call.turn(speech("كلها بخير", "0.2"));
  check("confidence 0.2 moves on", call.action && !call.text.includes(first.slice(-40)), call.text);
  assertNotSaved(ranch, call, "before the worker confirms");
});

scenario("S4b", "Nonsense speech", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S4b");
  await call.answer();
  const first = call.text;
  await call.turn(speech("البطيخ طاير فوق السطح"));
  check("nonsense on a choice question is asked again", call.action && call.text.includes(first.slice(-40)), call.text);
  await call.turn(speech("كلها بخير"));
  check("herd count is the next question", Q.herdCount.test(call.text), call.text);
  const before = call.text;
  await call.turn(speech("الجو حلو اليوم"));
  check("nonsense on a number question is asked again", call.action && call.text.includes(before.slice(-30)), call.text);
  await drive(call, [{ ask: Q.herdCount, input: speech("عشرين") }, { ask: Q.feed, input: speech("كافي") }, { ask: Q.water, input: speech("كافي") }, { ask: Q.custom, input: speech("لا") }]);
  check("reached the summary", /تم حفظ/.test(call.text), call.text);
});

scenario("S4e", "Off-topic words on a guided question are kept as a note and read back", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S4e");
  await call.answer();
  const words = "العلف زين";
  await call.turn(speech(words));
  const after = JSON.parse(sql(`select session::text from voice_call_sessions where call_sid = ${q(call.sid)}`)).draft;
  check("the words do not answer the health question", after.answers.every((answer) => answer.questionId !== "herd_health"), after.answers);
  check("the note is kept", after.answers.some((answer) => answer.answer === words), after.answers);
  check("the question is asked again", Q.health.test(call.text) && Boolean(call.action), call.text);
  await drive(call, [
    { ask: Q.health, input: speech("كلها بخير") }, { ask: Q.herdCount, input: speech("عشرين ناقة") },
    { ask: Q.feed, input: speech("باقي شوي") },
    { ask: Q.water, input: speech("إيه كافي") },
    { ask: Q.custom, input: speech("لا ما جا") },
  ], { until: Q.summary });
  check("the note is not asked as a question of its own", !call.transcript.some((t) => /الملاحظة الصحيحة/.test(t.said)), call.transcript.map((t) => t.said));
  check("the note is read back", Q.summary.test(call.text) && call.text.includes(words), call.text);
  if (!Q.summary.test(call.text)) { await call.finalStatus("completed"); return; }
  await call.turn(speech("إيه"));
  await assertSaved(ranch, call, { herd: 20 });
  check("the note is saved in the worker's words", answersOf(ranch.farm).some((row) => row.answer === words), answersOf(ranch.farm));
});

scenario("S4c", "Correct words with the confidence values Twilio may send", async () => {
  for (const [label, confidence] of [["absent", null], ["zero", "0.0"], ["0.45", "0.45"], ["0.6", "0.6"]]) {
    const ranch = await makeFarm();
    const call = await callNow(ranch, `S4c-${label}`);
    await call.answer();
    const input = confidence === null ? { SpeechResult: "كلها بخير", msg: "Gather End" } : speech("كلها بخير", confidence);
    await call.turn(input);
    const accepted = /أحفظه/.test(call.text);
    note(`Confidence ${label}: ${accepted ? "accepted" : `rejected, hears: ${call.text.slice(0, 80)}`}`);
    current[`confidence_${label}`] = accepted;
    check(`Confidence ${label} is accepted`, accepted, call.text);
    await call.finalStatus("completed");
  }
});

scenario("S4d", "A whole call whose speech scores below 0.5", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S4d");
  await call.answer();
  await drive(call, [
    { ask: Q.health, input: speech("كلها بخير", "0.42") }, { ask: Q.herdCount, input: speech("عشرين", "0.42") },
    { ask: Q.feed, input: speech("كافي", "0.42") },
    { ask: Q.water, input: speech("كافي", "0.42") },
    { ask: Q.custom, input: speech("لا", "0.42") }, { ask: Q.summary, input: speech("إيه", "0.42") },
  ], { fallback: speech("إيه", "0.42") });
  await call.finalStatus("completed");
  note(`after ${call.turns} turns; last line: ${call.text}`);
  note(`reports saved: ${count("reports", ranch.farm)}; summary heard: ${call.transcript.find((t) => /أحفظه/.test(t.said))?.said ?? "never reached"}`);
  check("the answers the worker gave are saved", /تم حفظ/.test(call.text) && count("reports", ranch.farm) === 1, call.text);
});

scenario("S5", "Hang-up midway", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S5");
  await call.answer();
  await call.turn(speech("كلها بخير"));
  await call.turn(speech("عشرين"));
  const status = await call.finalStatus("completed");
  check("status accepted", status.status === 204, status);
  assertNotSaved(ranch, call);
  const [latest] = run(ranch.farm);
  check("the run ends as missed, not left answered", latest.state === "missed", latest);
  check("the answered attempt is recorded", latest.attempts?.[0]?.result === "answered", latest.attempts);
  check("the live session is removed", sessions(call.sid) === 0);
  const late = await post(call.action ?? "/api/voice/turn?n=99", callFields(call.sid, speech("إيه")));
  check("a late Gather after the hang-up changes nothing", late.status === 200 && /Hangup/.test(late.xml) && !/Gather/.test(late.xml), late.xml.slice(0, 200));
  const ws = await dashboard(ranch);
  check("the dashboard shows no report for this call", (ws.reports?.length ?? 0) === 0, ws.reports);
  check("the owner receives no update call", !(await provider()).some((r) => r.To === OWNER));
});

scenario("S6a", "Database 503 on a turn", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S6a");
  await call.answer();
  await call.turn(speech("كلها بخير"));
  const before = call.action;
  await faults(true);
  try { await call.turn(speech("عشرين")); } finally { await faults(false); }
  note(`during the 503 the worker hears: ${call.text} (HTTP ${call.status}, hangup: ${/Hangup/.test(call.xml)})`);
  check("a failed turn is an honest message, not a claim of saving", !/تم حفظ/.test(call.text), call.text);
  check("the webhook answers valid TwiML within the failure", call.status === 200 && /<Response>/.test(call.xml), call.xml.slice(0, 200));
  await call.finalStatus("completed");
  assertNotSaved(ranch, call);
  const [latest] = run(ranch.farm);
  note(`run after DB failure and hang-up: ${latest.state}`);
  check("the run does not stay open forever", latest.state !== "answered", latest);
  void before;
});

scenario("S6b", "Duplicate POST of the same turn (Twilio retry)", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S6b");
  await call.answer();
  const firstAction = call.action;
  const input = callFields(call.sid, speech("كلها بخير"));
  const [one, two] = await Promise.all([post(firstAction, input), post(firstAction, input)]);
  check("concurrent duplicates return the same next question", one.xml === two.xml && one.status === 200, [says(one.xml), says(two.xml)]);
  Object.assign(call, one);
  call.log("[turn x2 concurrent]");
  const again = await post(firstAction, input);
  check("a later duplicate replays the same reply", again.xml === one.xml, says(again.xml));
  await drive(call, [{ ask: Q.herdCount, input: speech("عشرين") }, { ask: Q.feed, input: speech("كافي") }, { ask: Q.water, input: speech("كافي") }, { ask: Q.custom, input: speech("لا") }], { until: Q.summary });
  check("reached the save question", Q.summary.test(call.text), call.text);
  const saveAction = call.action;
  const saveInput = callFields(call.sid, speech("إيه"));
  const [save1, save2] = await Promise.all([post(saveAction, saveInput), post(saveAction, saveInput)]);
  check("both duplicate saves answer with the same outcome", save1.xml === save2.xml && /تم حفظ/.test(says(save1.xml)), [says(save1.xml), says(save2.xml)]);
  Object.assign(call, save1);
  call.log("[save x2 concurrent]");
  const replay = await post(saveAction, saveInput);
  check("a later replay of the save turn repeats the reply", replay.xml === save1.xml, says(replay.xml));
  await assertSaved(ranch, call, { herd: 20 });
});

scenario("S6c", "Out-of-order status callbacks", async () => {
  // A no-answer arriving after the call was answered must not undo the answered run.
  let ranch = await makeFarm(FULL);
  let call = await callNow(ranch, "S6c-late-noanswer");
  await call.answer();
  await call.finalStatus("no-answer");
  let [latest] = run(ranch.farm);
  note(`no-answer after answered: run state ${latest.state}`);
  check("a late no-answer does not retry an answered manual run", (latest.next_attempt_at ?? null) === null, latest);
  const late = await call.finalStatus("completed");
  check("a second final status is harmless", late.status === 204, late);
  [latest] = run(ranch.farm);
  check("the answered run ends missed, not stuck", latest.state === "missed", latest);
  await call.turn(speech("كلها بخير")).catch(() => {});
  check("turns after the status change nothing", count("reports", ranch.farm) === 0, reportOf(ranch.farm));

  // A final status received before the last save turn: the call ended, so nothing may be saved after.
  ranch = await makeFarm();
  call = await callNow(ranch, "S6c-status-before-save");
  await call.answer();
  await call.turn(speech("كلها بخير"));
  const confirm = call.action;
  await call.finalStatus("completed");
  const reply = await post(confirm, callFields(call.sid, speech("إيه")));
  Object.assign(call, reply);
  call.log("[late confirm after status]");
  note(`late confirm after completed status hears: ${says(reply.xml)}`);
  check("a confirm after the final status does not save", count("reports", ranch.farm) === 0, reportOf(ranch.farm));
  check("and does not claim it did", !/تم حفظ/.test(says(reply.xml)), says(reply.xml));

  // A duplicate completed after a save leaves the report alone.
  ranch = await makeFarm();
  call = await callNow(ranch, "S6c-duplicate-completed");
  await call.answer();
  await drive(call, [{ ask: Q.health, input: speech("كلها بخير") }, { ask: Q.summary, input: speech("إيه") }]);
  await assertSaved(ranch, call);
  await call.finalStatus("completed");
  [latest] = run(ranch.farm);
  check("a repeated completed keeps the run completed", latest.state === "completed" && count("reports", ranch.farm) === 1, latest);

  // Completed before the answer webhook arrives.
  ranch = await makeFarm();
  call = await callNow(ranch, "S6c-completed-before-answer");
  await call.finalStatus("completed");
  [latest] = run(ranch.farm);
  note(`completed before the answer webhook: run state ${latest.state}, attempts ${JSON.stringify(latest.attempts)}`);
  check("a run does not stay 'calling' after a final status", latest.state !== "calling" || latest.attempts?.[0]?.result !== "pending", latest);
});

for (const status of ["no-answer", "busy", "failed"]) {
  scenario(`S7-manual-${status}`, `Manual run: ${status}`, async () => {
    const ranch = await makeFarm(FULL);
    const call = await callNow(ranch, `S7-manual-${status}`);
    await call.finalStatus(status);
    const [latest] = run(ranch.farm);
    check("the manual run ends missed without a retry", latest.state === "missed" && latest.next_attempt_at === null, latest);
    check("the unanswered attempt is logged", callRows(ranch.farm).some((row) => row.kind === "worker_report_missed"), callRows(ranch.farm).map((row) => row.kind));
    check("no report", count("reports", ranch.farm) === 0);
    check("no second call placed", (await provider()).length === 1, (await provider()).length);
  });
}

scenario("S7-scheduled", "Scheduled run: no-answer, busy, failed with retries", async () => {
  const ranch = await makeFarm(FULL);
  sql(`update farms set call_day = extract(dow from now() at time zone 'Asia/Riyadh' - interval '1 minute')::int,
       call_time = (now() at time zone 'Asia/Riyadh' - interval '1 minute')::time where id = ${q(ranch.farm)}`);
  await resetProvider();
  const cron = async () => (await fetch(`${APP}/api/cron/report-calls`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })).json();
  const first = await cron();
  check("the cron dials the due slot", first.placed === 1, first);
  for (const [attempt, status] of [[1, "no-answer"], [2, "busy"]]) {
    const requests = await provider();
    check(`attempt ${attempt} is dialled once`, requests.length === attempt, requests.length);
    const call = new Call(requests[attempt - 1], `sched-${attempt}`);
    await call.finalStatus(status);
    const [latest] = run(ranch.farm);
    check(`${status}: stays calling with a retry about 20 minutes out`, latest.state === "calling" && latest.next_attempt_at && Math.abs(new Date(latest.next_attempt_at) - Date.now() - 20 * 60_000) < 120_000, latest);
    const early = await cron();
    check(`no redial before the retry is due (${status})`, early.placed === 0 && (await provider()).length === attempt, early);
    sql(`update report_call_runs set next_attempt_at = now() - interval '1 second' where farm_id = ${q(ranch.farm)} and state = 'calling'`);
    const again = await cron();
    check(`the retry is placed when due (attempt ${attempt + 1})`, again.placed === 1, again);
  }
  const requests = await provider();
  check("three attempts in total", requests.length === 3, requests.length);
  const third = new Call(requests[2], "sched-3");
  await third.finalStatus("failed");
  const [latest] = run(ranch.farm);
  check("the run is missed after the last retry", latest.state === "missed" && latest.next_attempt_at === null, latest);
  check("attempts are recorded as unanswered", latest.attempts?.length === 3 && latest.attempts.every((a) => a.result === "no_answer"), latest.attempts);
  const after = await cron();
  check("no further call after the last retry", after.placed === 0 && (await provider()).length === 3, after);
});

scenario("S7-interrupted", "Scheduled run: a call answered then cut off counts as an attempt and retries", async () => {
  const ranch = await makeFarm(FULL);
  sql(`update farms set call_day = extract(dow from now() at time zone 'Asia/Riyadh' - interval '1 minute')::int,
       call_time = (now() at time zone 'Asia/Riyadh' - interval '1 minute')::time where id = ${q(ranch.farm)}`);
  await resetProvider();
  const cron = async () => (await fetch(`${APP}/api/cron/report-calls`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })).json();
  check("the cron dials the due slot", (await cron()).placed === 1);
  for (const attempt of [1, 2, 3]) {
    const requests = await provider();
    check(`attempt ${attempt} is dialled once`, requests.length === attempt, requests.length);
    const call = new Call(requests[attempt - 1], `interrupted-${attempt}`);
    await call.answer();
    await call.turn(speech("كلها بخير"));
    await call.finalStatus("completed");
    assertNotSaved(ranch, call, `interrupted attempt ${attempt}`);
    const [latest] = run(ranch.farm);
    if (attempt === 3) {
      check("the third interruption ends the run as missed", latest.state === "missed" && latest.next_attempt_at === null && latest.attempts?.length === 3, latest);
      break;
    }
    check(`interrupted attempt ${attempt} keeps the run calling, 20 minutes out`, latest.state === "calling" && latest.next_attempt_at && Math.abs(new Date(latest.next_attempt_at) - Date.now() - 20 * 60_000) < 120_000, latest);
    check(`no redial before attempt ${attempt + 1} is due`, (await cron()).placed === 0 && (await provider()).length === attempt);
    sql(`update report_call_runs set next_attempt_at = now() - interval '1 second' where farm_id = ${q(ranch.farm)} and state = 'calling'`);
    check(`attempt ${attempt + 1} is placed when due`, (await cron()).placed === 1);
  }
  check("no further call after the last retry", (await cron()).placed === 0 && (await provider()).length === 3);
  check("the owner was never dialled for the worker's report run", !(await provider()).some((r) => r.To === OWNER), (await provider()).map((r) => r.To));
  check("no No Answer ticket row exists", count("no_answer_tickets", ranch.farm) === 0);
});

scenario("S8", "Forged signatures are rejected", async () => {
  const ranch = await makeFarm(FULL);
  const call = await callNow(ranch, "S8");
  const fields = callFields(call.sid);
  const before = JSON.stringify(run(ranch.farm));
  const forged = await post(call.request.Url, fields, { token: "wrong-token" });
  check("a wrong auth token on the answer webhook gets 403", forged.status === 403, forged);
  const unsigned = await post(call.request.Url, fields, { signed: false });
  check("an unsigned answer webhook gets 403", unsigned.status === 403, unsigned);
  const otherUrl = await post(call.request.Url, fields, { signUrl: `${APP}/api/voice/outbound` });
  check("a signature for another URL gets 403", otherUrl.status === 403, otherUrl);
  const turn = await post("/api/voice/turn?n=0", callFields(call.sid, speech("إيه")), { token: "wrong-token" });
  check("a forged turn gets 403", turn.status === 403, turn);
  const status = await post(call.request.StatusCallback, callFields(call.sid, { CallStatus: "completed" }), { token: "wrong-token" });
  check("a forged status callback gets 403", status.status === 403, status);
  check("forged requests changed nothing", JSON.stringify(run(ranch.farm)) === before && count("calls", ranch.farm) === 0, run(ranch.farm));
  const parsed = new URL(call.request.Url);
  const s = parsed.searchParams.get("s");
  const [payload] = s.split(".");
  const forgedSig = createHmac("sha256", "not-the-secret").update(`naqah-call:${payload}`).digest("base64url");
  const badToken = await post(`/api/voice/outbound?s=${encodeURIComponent(`${payload}.${forgedSig}`)}`, fields);
  check("a correctly signed request with a forged call token gets 403", badToken.status === 403, badToken);
});

/* ─────────────────── main ─────────────────── */

const started = Date.now();
let commit = "";
let exitCode = 1;
try {
  commit = exportTree();
  await startStack();
  for (const entry of registry) {
    if (ONLY?.length && !ONLY.some((id) => entry.id === id || entry.id.startsWith(`${id}-`))) continue;
    console.log(`\n${entry.id} ${entry.title}`);
    current = { id: entry.id, title: entry.title, checks: [], notes: [], error: null };
    results.push(current);
    await faults(false);
    try {
      await entry.run();
    } catch (error) {
      current.error = error.stack ?? String(error);
      console.log(`  ERROR ${error.message}`);
    } finally {
      await faults(false);
    }
  }
  exitCode = results.some((r) => r.error || r.checks.some((c) => !c.passed)) ? 1 : 0;
} finally {
  stopAll();
  await sleep(500);
  stopPg();
  if (flag("cleanup")) rmSync(SRC, { recursive: true, force: true });
  else rmSync(join(SRC, ".next"), { recursive: true, force: true });
  if (SCRATCH !== ROOT) rmSync(join(SCRATCH, ".next"), { recursive: true, force: true });
}

const seen = new Set();
const lines = [];
for (const r of results) {
  const failed = r.checks.filter((c) => !c.passed);
  const verdict = r.error ? "ERROR" : failed.length ? "FAIL" : "PASS";
  lines.push(`${verdict.padEnd(6)} ${r.id.padEnd(20)} ${r.title}${failed.length ? `  [${failed.length}/${r.checks.length} failed]` : ""}`);
  seen.add(r.id);
}
const table = lines.join("\n");
console.log(`\n=== ${LABEL} (commit ${commit}, ${Math.round((Date.now() - started) / 1000)}s) ===\n${table}`);
writeFileSync(join(LOGS, "result.json"), JSON.stringify({ label: LABEL, commit, results }, null, 2));
writeFileSync(join(LOGS, "summary.txt"), `${table}\n`);
writeFileSync(join(LOGS, "transcripts.txt"), results.map((r) => [
  `## ${r.id} ${r.title}`,
  ...(r.calls ?? []).flatMap((call) => [`-- call ${call.name}`, ...call.transcript.map((t) => `  W: ${typeof t.in === "string" ? t.in : JSON.stringify(t.in)}\n  N(${t.status}${t.ended ? ",end" : ""}): ${t.said}`)]),
  ...(r.answers ? [`answers: ${JSON.stringify(r.answers)}`] : []),
].join("\n")).join("\n\n"));
process.exit(exitCode);
