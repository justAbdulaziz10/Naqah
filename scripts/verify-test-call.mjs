#!/usr/bin/env node
/**
 * LOCAL ONLY, free. Proves the manual "Test AI Call" wiring against scripts/test-call-local.mjs --mock: real Next routes,
 * the real voice bridge and a disposable Postgres, with Twilio and the model replaced by loopback mocks.
 *
 *   node scripts/verify-test-call.mjs                       both phases
 *   node scripts/verify-test-call.mjs --phase report        the existing report-call path only
 *   node scripts/verify-test-call.mjs --phase route         POST/GET /api/test-call and the browser flow only
 *   node scripts/verify-test-call.mjs --attach              use a runner already started by hand (see --phase)
 *   node scripts/verify-test-call.mjs --skip-build          reuse the existing .next build
 *
 * The route phase skips itself, with a message, while /api/test-call answers 404 because the feature code is absent.
 * A mock proves wiring only. It cannot prove the real model's Arabic quality or real telephony.
 * Results: /tmp/naqah-test-call/verify/ (result.json, runner.log, screenshots). Exit code 1 on any failure.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { CONTROL_FARM, GATEWAY, ROOT, MOCK_ALLOWED, READY_FILE, REPORT_PATH_WORKER, TEST_FARM, TESTER, WORKER_PLACEHOLDER } from "./test-call-local.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
/** --natural: run the local stack's natural conversation instead of the guided one. */
const NATURAL = flag("natural");
/** The one short word the server may say before the next question («تمام.»، «سلامتها.»). */
const ACKNOWLEDGED = /^(?:تمام|زين|طيب|ما عليه|الحمد لله|سلامتها|سلامته|سلامتهم|الله يعطيك العافية|عدلتها)\. $/u;

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "verify");
const PHASE = arg("phase", "all");
const ATTACH = flag("attach");
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const DB = "naqah_test_call";
const ALLOWED_NUMBER = MOCK_ALLOWED[0];
const SECOND_ALLOWED = MOCK_ALLOWED[1];
const OUTSIDE_ALLOWLIST = "+966500000003";
const NON_SAUDI_ALLOWED = MOCK_ALLOWED[2];
const CONTROL_REPORT = "22222222-2222-4222-8222-2222222222dd";
const SHIFT = /^[1-5]$/.test(process.env.NAQAH_TEST_CALL_ISOLATED ?? "") ? Number(process.env.NAQAH_TEST_CALL_ISOLATED) * 100 : 0;
const STOP_PORTS = [54350, 54351, 54352, 3310, 3311, 3313].map((port) => port + SHIFT);
if (!["all", "report", "route"].includes(PHASE)) throw new Error("--phase must be all, report or route");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pgEnv = { PATH: `${PG_BIN}:${process.env.PATH}`, LC_ALL: "en_US.UTF-8", PGHOST: "127.0.0.1", PGPORT: String(54350 + SHIFT), PGUSER: "postgres" };
const sql = (query) => execFileSync(join(PG_BIN, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], { input: query, encoding: "utf8", env: pgEnv, maxBuffer: 1 << 26 }).trim();
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const postJson = async (url, body, headers = {}) => {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  let json = null;
  try { json = await response.json(); } catch { /* not json */ }
  return { status: response.status, json };
};

async function waitFor(probe, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { const value = await probe(); if (value) return value; } catch { /* not ready */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(200);
  }
}

const results = [];
let current = null;
function section(title) {
  current = { title, checks: [], skipped: null };
  results.push(current);
  console.log(`\n${title}`);
}
function check(name, passed, detail) {
  current.checks.push({ name, passed: Boolean(passed), detail: passed ? undefined : detail });
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${passed || detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 600)}`}`);
}
function skip(reason) {
  current.skipped = reason;
  console.log(`  SKIP ${reason}`);
}

/* ─────────────────── the runner ─────────────────── */

let runner = null;
let runnerLog = null;
let ready = null;

const portOpen = (port) => new Promise((resolve) => {
  const socket = tcpConnect(port, "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

async function startRunner(extra) {
  if (ATTACH) {
    if (!existsSync(READY_FILE)) throw new Error(`--attach needs a running runner: ${READY_FILE} is missing`);
    ready = JSON.parse(readFileSync(READY_FILE, "utf8"));
    return;
  }
  if (existsSync(READY_FILE)) throw new Error(`A runner already looks active (${READY_FILE}). Stop it, or pass --attach.`);
  runnerLog = openSync(join(OUT, "runner.log"), "a");
  runner = spawn(process.execPath, [join(REPO, "scripts/test-call-local.mjs"), "--mock", ...extra, ...(NATURAL ? ["--natural"] : [])], { cwd: REPO, stdio: ["ignore", runnerLog, runnerLog] });
  await waitFor(() => {
    if (runner.exitCode !== null) throw Object.assign(new Error("runner exited"), { fatal: true });
    return existsSync(READY_FILE);
  }, "the runner", 420_000).catch((error) => {
    throw new Error(`The runner did not become ready (${error.message}); see ${join(OUT, "runner.log")}`);
  });
  ready = JSON.parse(readFileSync(READY_FILE, "utf8"));
}

async function stopRunner() {
  if (!runner) return;
  const child = runner;
  runner = null;
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, sleep(20_000)]);
  }
  closeSync(runnerLog);
  const open = (await Promise.all(STOP_PORTS.map(async (port) => [port, await portOpen(port)]))).filter(([, isOpen]) => isOpen).map(([port]) => port);
  check("the runner stopped everything it started", open.length === 0 && !existsSync(READY_FILE), open);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { runner?.kill("SIGTERM"); process.exit(130); });

const mockState = async () => (await fetch(`${ready.provider}/__test/state`)).json();
const control = (body) => postJson(`${ready.provider}/__test/control`, body);
const release = (status) => postJson(`${ready.provider}/__test/release`, { status });

/* ─────────────────── fixtures ─────────────────── */

async function createUser(prefix) {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
  const password = "local-test-password";
  const made = await postJson(`${GATEWAY}/__test/users`, { email, password });
  if (made.status !== 201) throw new Error(`Could not create ${prefix}: ${made.status}`);
  return { id: made.json.id, email, password };
}

async function sessionCookie(user) {
  const session = await postJson(`${GATEWAY}/auth/v1/token?grant_type=password`, { email: user.email, password: user.password });
  if (session.status !== 200) throw new Error(`Could not sign in ${user.email}: ${session.status}`);
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session.json)).toString("base64url")}`;
}

async function signInThroughForm(page) {
  await page.goto(`${ready.app}/ar/login?method=email`);
  await page.locator('input[name="email"]:visible').fill(TESTER.email);
  await page.locator('input[name="password"]:visible').fill(TESTER.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/ar/app"), { timeout: 20_000 });
}

/** A third ranch whose worker has a fake dialable number. The existing path can only call a farm's own worker. */
async function seedReportPathRanch() {
  const owner = await createUser("report-path");
  const farm = randomUUID();
  const worker = randomUUID();
  sql(`begin;
    insert into farms (id, owner_id, plan, plan_selected_at, setup_complete, name, owner_name, owner_phone, herd_count)
      values (${q(farm)}, ${q(owner.id)}, 'ultimate', now(), true, 'عزبة مسار التقرير (اختبار)', 'مالك', '+966500000092', 20);
    insert into workers (id, farm_id, name, phone, language) values (${q(worker)}, ${q(farm)}, 'يوسف', ${q(REPORT_PATH_WORKER)}, 'ar');
    update farms set primary_worker_id = ${q(worker)} where id = ${q(farm)};
    insert into resources (farm_id, kind, present) values (${q(farm)}, 'feed', true), (${q(farm)}, 'water', true), (${q(farm)}, 'fences', true), (${q(farm)}, 'shelter', false), (${q(farm)}, 'medicine', false);
    insert into camels (farm_id, name, certainty) values (${q(farm)}, 'نورة', 'reported'), (${q(farm)}, 'مزون', 'reported');
    insert into custom_questions (farm_id, text, sort_order) values (${q(farm)}, 'جا البيطري اليوم؟', 0), (${q(farm)}, 'فيه أحد زار العزبة اليوم؟', 1);
    commit;`);
  return { owner, farm };
}

/** Every row a ranch owns, as text, so "unchanged" means byte-identical. */
function snapshotFarm(farm) {
  const tables = sql("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'farm_id' order by table_name").split("\n");
  const rows = (name, where) => sql(`select coalesce(string_agg(r::text, E'\\n' order by r::text), '') from ${name} r where ${where}`);
  return [
    `farms\n${rows("farms", `id = ${q(farm)}`)}`,
    ...tables.map((table) => `${table}\n${rows(table, `farm_id = ${q(farm)}`)}`),
    `report_answers\n${rows("report_answers", `report_id in (select id from reports where farm_id = ${q(farm)})`)}`,
    `findings\n${rows("findings", `report_id in (select id from reports where farm_id = ${q(farm)})`)}`,
  ].join("\n=====\n");
}

const count = (table, farm) => Number(sql(`select count(*) from ${table} where farm_id = ${q(farm)}`));
const answersOf = (farm) => JSON.parse(sql(`select coalesce(json_agg(row_to_json(a) order by a.sort_order), '[]') from report_answers a join reports r on r.id = a.report_id where r.farm_id = ${q(farm)}`));

/* ─────────────────── what every completed mock call must show ─────────────────── */

const ARABIC = /[؀-ۿ]/g;
const CALL_TOOLS = ["answer_question", "choose_mode", "confirm_report", "correct_report", "end_call", "finish_update", "flag_urgent", "record_facts", "repeat_or_clarify"];

function assertCallEvidence(call, farm, destination) {
  check("the mock call finished without an error", call.finished === true && !call.error, call.error);
  const http = Object.fromEntries(call.statuses.map((entry) => [entry.status, entry.http]));
  for (const status of ["initiated", "ringing", "in-progress", "completed"]) check(`signed status callback ${status} accepted`, http[status] === 204, call.statuses);
  check("the call went to the requested number only", call.to === destination, call.to);
  check("recording is off on the outbound request", call.record === "false", call.record);
  check("Twilio's TwiML has <Connect><Stream> with a ticket and the signed /after", call.twiml?.http === 200 && /\/voice-bridge\/media$/.test(call.twiml.streamUrl ?? "") && call.twiml.hasTicket && /\/api\/voice\/realtime\/after\?s=/.test(call.twiml.afterUrl ?? ""), call.twiml);

  const audio = call.audio ?? {};
  check("the bridge forwards caller audio to the provider, unchanged", audio.callerFramesAtProvider === audio.callerFramesSent && audio.callerFramesSent > 0, audio);
  check("the bridge plays provider audio to the caller, unchanged", audio.providerFramesAtCaller > 0 && audio.providerBytesIntact === true && audio.streamSidMatched === true, audio);
  check("the bridge authenticates to the provider with the server key", call.provider.bearerIsMockKey === true, call.provider.bearerIsMockKey);

  const session = call.provider.sessionUpdate ?? {};
  const instructions = session.instructions ?? "";
  const natural = call.natural === true;
  if (natural) {
    check("natural: the model talks for itself and calls a tool only to hand over or confirm", session.tool_choice === "auto", session.tool_choice);
    check("natural: the instructions keep it from asking again what was answered", /لا تعيد سؤال انجاوب/.test(instructions) && /submit_report/.test(instructions) && /لا تخمّن/.test(instructions), instructions.slice(0, 300));
    check("natural: exactly four tools, none to answer question by question", JSON.stringify((session.tools ?? []).map((tool) => tool.name)) === JSON.stringify(["submit_report", "confirm_report", "flag_urgent", "end_call"]), session.tools?.map((tool) => tool.name));
  } else {
  check("session.update makes the model call tools only: tool_choice is required", session.tool_choice === "required", session.tool_choice);
  check("session.update limits the model to listening and classifying", /دورك الاستماع والتصنيف فقط/.test(instructions) && /لا تتكلم بنفسك أبداً/.test(instructions), instructions.slice(0, 300));
  check("session.update requires one tool per worker turn", /في كل دور للعامل نادِ أداة واحدة بالضبط/.test(instructions), instructions.slice(0, 300));
  check("session.update has the server choose every word and read questions verbatim", /الخادم يختار كل الكلام ويقرأ السؤال حرفياً/.test(instructions), instructions.slice(0, 300));
  check("session.update requires a topic and forbids guessing", /answer_question فوراً مع topic المطابق/.test(instructions) && /لا تخمن رقماً أو حالة/.test(instructions), instructions.length);
  check("session.update requires the whole summary and clear agreement before saving", /confirm_report\(true\) فقط بعد سماع الملخص كاملاً والموافقة الواضحة/.test(instructions) && /ولا تخترع حقائق أو تدعي الحفظ/.test(instructions), instructions.length);
  check("the provider gets exactly the current call tools", JSON.stringify((session.tools ?? []).map((tool) => tool.name).sort()) === JSON.stringify(CALL_TOOLS), session.tools?.map((tool) => tool.name));
  const answerTool = session.tools?.find((tool) => tool.name === "answer_question");
  check("answer_question requires a topic", answerTool?.parameters?.required?.includes("topic"), answerTool?.parameters);
  }
  check("input transcription is Arabic and audio is G.711", session.audio?.input?.transcription?.language === "ar" && /pcmu/i.test(JSON.stringify(session.audio ?? {})), session.audio);
  const opening = call.provider.opening ?? "";
  const letters = opening.match(/\p{L}/gu)?.length ?? 0;
  check("the opening is Arabic, spoken verbatim with tools disabled", letters > 10 && (opening.match(ARABIC)?.length ?? 0) >= letters * 0.8 && call.provider.openingToolChoice === "none", { opening, toolChoice: call.provider.openingToolChoice });
  check("the opening says it is an automated assistant", /آلي/.test(opening), opening);

  const responses = call.provider.responses ?? [];
  const verbatim = responses.filter((entry) => entry.verbatim);
  if (natural) {
    check("natural: only the opening, the summary and the goodbye are the server's words", verbatim.length === 3 && verbatim.every((entry) => entry.toolChoice === "none"), verbatim.map((entry) => entry.instructions?.slice(0, 60)));
    check("natural: the model's turns carry no server words", responses.some((entry) => !entry.verbatim) && responses.filter((entry) => !entry.verbatim).every((entry) => entry.instructions === null), responses.map((entry) => entry.toolChoice));
  } else {
  check("every line the caller heard was the server's, verbatim, with tools disabled", verbatim.length > 0 && verbatim.length === call.provider.spoken?.length && verbatim.every((entry) => entry.toolChoice === "none" && entry.instructions.startsWith("Say only the following text verbatim")), verbatim.map((entry) => entry.toolChoice));
  check("the model's own turns only classify: they carry no words to say", responses.some((entry) => !entry.verbatim) && responses.filter((entry) => !entry.verbatim).every((entry) => entry.toolChoice !== "none"), responses.map((entry) => entry.toolChoice));
  }
  const arabicShare = (line) => (line.match(ARABIC)?.length ?? 0) / Math.max(1, line.match(/\p{L}/gu)?.length ?? 0);
  check("every spoken line is Arabic", (call.provider.spoken ?? []).length > 0 && call.provider.spoken.every((line) => arabicShare(line) >= 0.8), call.provider.spoken);
  check("the caller hears the ranch's Saudi wording", (call.provider.spoken ?? []).some((line) => /الحلال/.test(line)) && (call.provider.spoken ?? []).some((line) => /العزبة|عزبة/.test(line) || /وش|زين|ولا فيه/.test(line)), call.provider.spoken);
  if (!natural) check("each answer is followed by exactly the server's next line", (call.linesAfterAnswers ?? []).length === call.questions.length && call.linesAfterAnswers.every((entry) => entry.expected && (entry.spoken === entry.expected || ACKNOWLEDGED.test(entry.spoken.slice(0, -entry.expected.length)) && entry.spoken.endsWith(entry.expected))), call.linesAfterAnswers);

  const answers = answersOf(farm);
  const answered = new Set(answers.map((row) => row.question_id));
  const queued = call.queue ?? [];
  if (natural) check("natural: one hand-over then the confirmation, nothing question by question", JSON.stringify(call.toolResults.map((entry) => entry.name)) === JSON.stringify(["submit_report", "confirm_report"]), call.toolResults.map((entry) => entry.name));
  else check("every question queued for the session was asked", queued.length >= 4 && queued.every((id) => call.questions.some((entry) => entry.q === id)), { queued, asked: call.questions });
  check("every question queued for the session was answered", queued.every((id) => answered.has(id)), { queued, answered: [...answered] });
  if (!natural) check("the model never skipped to a save: one tool call per step, then the confirmation", call.toolResults.filter((entry) => entry.name === "confirm_report").length === 1 && call.toolResults.at(-1).name === "confirm_report" && call.toolResults.length === call.questions.length + 1, call.toolResults.map((entry) => entry.name));

  check("the engine flagged the summary", call.summary?.flagged === true && Boolean(call.summary?.text), call.summary);
  check("the summary offers exactly save, correct and end without saving", JSON.stringify([...(call.summary?.replies ?? [])].sort()) === JSON.stringify(["confirm_save", "correct", "end_without_save"]), call.summary?.replies);
  check("the complete summary was read to the caller, word for word", call.summary?.readInFull === true, call.summary);
  check("the summary covers the herd, feed and water answers", /20/.test(call.summary?.text ?? "") && /(العلف|الأعلاف)/.test(call.summary?.text ?? "") && /(الماء|الموية)/.test(call.summary?.text ?? ""), call.summary?.text);
  check("no report exists before confirm_report", call.reportsBeforeConfirm === 0, call.reportsBeforeConfirm);
  check("confirm_report returned saved and the report then exists", call.confirm?.output?.status === "saved" && call.reportsAfterConfirm === 1, { confirm: call.confirm, after: call.reportsAfterConfirm });
  check("the bridge closed the stream after the goodbye", call.streamClosed === true, call.streamClosed);
  check("/after only hangs up: the bridge already said goodbye", call.after?.http === 200 && call.after.hangup && !call.after.speaks, call.after);
  check("the voice session row is cleaned up", Number(sql(`select count(*) from voice_call_sessions where call_sid = ${q(call.sid)}`)) === 0);
  check("exactly one report on the called ranch", count("reports", farm) === 1, count("reports", farm));
  check("the report's herd count is the spoken one", sql(`select herd_count_reported from reports where farm_id = ${q(farm)}`) === "20");
  check("the official herd count stayed the owner's", sql(`select herd_count from farms where id = ${q(farm)}`) === "20");
}

async function assertCronRefuses(requestsBefore) {
  const noAuth = await fetch(`${ready.app}/api/cron/report-calls`);
  const withBearer = await fetch(`${ready.app}/api/cron/report-calls`, { headers: { Authorization: "Bearer guessed-secret" } });
  const body = await noAuth.json();
  check("the cron route refuses: no CRON_SECRET is configured", noAuth.status === 503 && body.reason === "cron_secret_missing" && withBearer.status === 503, { status: noAuth.status, body });
  check("the cron route placed no call", (await mockState()).requests.length === requestsBefore, (await mockState()).requests.length);
}

/* ─────────────────── phase 1: the existing report-call path ─────────────────── */

async function phaseReportPath() {
  section("Phase 1: a report really saved on the existing report-call path (real Next, real bridge, mock Twilio and model)");
  await startRunner(["--report-path", ...(flag("skip-build") ? ["--skip-build"] : [])]);
  try {
    await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200 });
    const anonProbe = await fetch(`${ready.app}/api/test-call`);

    // The sign-in details the runner prints have to really work.
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
      await signInThroughForm(page);
      check("the printed tester details sign in through the real form", /^\/ar\/app/.test(new URL(page.url()).pathname), page.url());
      await page.screenshot({ path: join(OUT, "signed-in.png") });
    } finally {
      await browser.close();
    }

    const controlBefore = snapshotFarm(CONTROL_FARM);
    const testBefore = snapshotFarm(TEST_FARM);
    check("the control snapshot really holds the seeded report and answers", controlBefore.includes(CONTROL_REPORT) && /\nreport_answers\n.*herd_health/s.test(controlBefore), controlBefore.length);
    const { owner, farm } = await seedReportPathRanch();
    const cookie = await sessionCookie(owner);
    const placed = await postJson(`${ready.app}/api/account`, { op: "callNow" }, { Origin: ready.app, Cookie: cookie });
    check("Call now accepted the fake worker number", placed.status === 200 && placed.json?.ok === true && placed.json?.data?.status === "placed", placed);
    const finished = await waitFor(async () => {
      const state = await mockState();
      return state.calls[0]?.finished ? state : null;
    }, "the mock call to finish");
    const call = finished.calls[0];
    writeFileSync(join(OUT, "report-path-call.json"), JSON.stringify(call, null, 2));

    assertCallEvidence(call, farm, REPORT_PATH_WORKER);
    check("the run is completed and linked to the report", sql(`select state || ':' || (report_id is not null) from report_call_runs where farm_id = ${q(farm)}`) === "completed:true", sql(`select state from report_call_runs where farm_id = ${q(farm)}`));
    check("one outbound Twilio request in the whole call", finished.requests.length === 1 && finished.requests[0].To === REPORT_PATH_WORKER, finished.requests.map((request) => request.To));
    check("the owner was not called: NAQAH_CALL_OWNER is unset", !finished.requests.some((request) => request.To === "+966500000092"), finished.requests.map((request) => request.To));
    check("the test ranch's placeholder worker number was never dialled", !finished.requests.some((request) => request.To === WORKER_PLACEHOLDER), finished.requests.map((request) => request.To));
    check("ISOLATION: the control ranch is byte-identical", snapshotFarm(CONTROL_FARM) === controlBefore);
    check("ISOLATION: the test ranch is byte-identical", snapshotFarm(TEST_FARM) === testBefore);
    await assertCronRefuses(finished.requests.length);

    section("The mock's failure modes, on the same path");
    const callNow = async () => {
      const ranch = await seedReportPathRanch();
      const result = await postJson(`${ready.app}/api/account`, { op: "callNow" }, { Origin: ready.app, Cookie: await sessionCookie(ranch.owner) });
      return { ...ranch, result };
    };
    await control({ reset: true, outcome: "full", twilioError: 21215, dwellMs: 100 });
    const rejected = await callNow();
    check("Twilio error 21215 comes back as a failed call", rejected.result.json?.data?.status === "failed", rejected.result);
    check("the mock recorded the 21215 rejection", (await mockState()).requests[0]?.rejected === 21215, (await mockState()).requests);
    check("a rejected call leaves no unanswered attempt", sql(`select state || ':' || attempts::text from report_call_runs where farm_id = ${q(rejected.farm)}`) === "missed:[]", sql(`select state, attempts from report_call_runs where farm_id = ${q(rejected.farm)}`));

    await control({ reset: true, outcome: "no-answer", twilioError: null, dwellMs: 100 });
    const unanswered = await callNow();
    const missed = await waitFor(async () => { const state = await mockState(); return state.calls[0]?.finished ? state : null; }, "the unanswered mock call", 15_000);
    check("the no-answer status is accepted", missed.calls[0].statuses.find((entry) => entry.status === "no-answer")?.http === 204, missed.calls[0].statuses);
    check("no answer means no media stream", missed.calls[0].twiml === undefined, missed.calls[0].twiml);
    await sleep(500);
    await assertCronRefuses(missed.requests.length);
    check("no call was placed for the waiting retry, with cron off", (await mockState()).requests.length === 1 && count("reports", unanswered.farm) === 0, (await mockState()).requests.length);

    await control({ reset: true, outcome: "hold", dwellMs: 100 });
    await callNow();
    await waitFor(async () => (await mockState()).calls[0]?.statuses.some((entry) => entry.status === "ringing"), "the held call to ring", 15_000);
    check("a held call stays open until released", (await mockState()).calls[0].finished === false);
    check("the mock accepted the release", (await release("completed")).status === 200);
    const releasedState = await waitFor(async () => { const state = await mockState(); return state.calls[0]?.finished ? state : null; }, "the held call to end", 15_000);
    check("releasing a held call sends its final status", releasedState.calls[0].statuses.at(-1).status === "completed", releasedState.calls[0].statuses);
    check("ISOLATION: the control ranch is byte-identical after every failure mode", snapshotFarm(CONTROL_FARM) === controlBefore);
    return anonProbe.status;
  } finally {
    await stopRunner();
  }
}

/* ─────────────────── phase 2: POST/GET /api/test-call and the browser ─────────────────── */

/** Copy the UI team may still adjust is matched loosely; the API's own statuses are the strict check. */
const UI = {
  number: /جوال|رقم/,
  start: /اختبار|اتصل|جرّب|ابدأ/,
  confirm: /تأكيد|أكّد|اتصل|ابدأ/,
  statuses: { calling: /(جاري|جار|نتصل|يتصل)/, ringing: /يرن|رنين/, connected: /متصل|رد|مكالمة جارية|بدأت/, completed: /انتهت|اكتملت/ },
  saved: /انحفظ|تم حفظ|حُفظ|محفوظ/,
  saudiNotEnabled: /السعودي/,
};

const REQUEST = (extra = {}) => ({ phone: ALLOWED_NUMBER, confirmedCharge: true, consentConfirmed: true, requestId: randomUUID(), ...extra });

function resetTestRanch() {
  sql(`begin;
    delete from report_call_runs where farm_id = ${q(TEST_FARM)};
    delete from reports where farm_id = ${q(TEST_FARM)};
    delete from calls where farm_id = ${q(TEST_FARM)};
    delete from voice_call_sessions where farm_id = ${q(TEST_FARM)};
    delete from test_calls;
    commit;`);
}

async function phaseRoute() {
  section("Phase 2: the manual Test AI Call route and screen");
  await startRunner(flag("skip-build") || PHASE === "all" ? ["--skip-build"] : []);
  const browser = await chromium.launch();
  try {
    await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 3500 });
    const tester = { email: TESTER.email, password: TESTER.password };
    const testerCookie = await sessionCookie(tester);
    const stranger = await createUser("not-a-tester");
    const strangerCookie = await sessionCookie(stranger);
    const asTester = { Origin: ready.app, Cookie: testerCookie };
    const post = (body, headers = asTester) => postJson(`${ready.app}/api/test-call`, body, headers);
    const get = async (cookie = testerCookie) => {
      const response = await fetch(`${ready.app}/api/test-call`, { headers: cookie ? { Cookie: cookie } : {} });
      return { status: response.status, json: await response.json().catch(() => null) };
    };
    const requestsMade = async () => (await mockState()).requests.length;
    const refused = (result) => result.status >= 400 || result.json?.ok === false;

    section("Route security (no call may be placed)");
    const controlBefore = snapshotFarm(CONTROL_FARM);
    const anon = await post(REQUEST(), { Origin: ready.app });
    check("anonymous POST is 401", anon.status === 401, anon);
    check("anonymous GET is 401", (await get(null)).status === 401);
    const notTester = await post(REQUEST(), { Origin: ready.app, Cookie: strangerCookie });
    check("a signed-in non-tester gets 404", notTester.status === 404, notTester);
    check("a signed-in non-tester's GET is 404", (await get(strangerCookie)).status === 404);
    const wrongOrigin = await post(REQUEST(), { Origin: "https://evil.example", Cookie: testerCookie });
    check("a wrong origin gets 403", wrongOrigin.status === 403, wrongOrigin);
    const outside = await post(REQUEST({ phone: OUTSIDE_ALLOWLIST }));
    check("a number outside the allowlist is refused", refused(outside), outside);
    const nonSaudi = await post(REQUEST({ phone: NON_SAUDI_ALLOWED }));
    check("a non-Saudi number is refused, even when allowlisted", refused(nonSaudi), nonSaudi);
    const noCharge = await post(REQUEST({ confirmedCharge: false }));
    check("a missing charge confirmation is refused", refused(noCharge), noCharge);
    const noConsent = await post(REQUEST({ consentConfirmed: undefined }));
    check("a missing consent confirmation is refused", refused(noConsent), noConsent);
    check("Twilio received zero requests while nothing was approved", (await requestsMade()) === 0, await requestsMade());
    const readiness = await get();
    check("GET reports ready for the tester", readiness.status === 200 && readiness.json?.ok === true && readiness.json?.ready === true, readiness);

    section("The whole call from the browser");
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-SA" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const uiStatuses = [];
    page.on("response", async (response) => {
      if (!response.url().endsWith("/api/test-call") || response.request().method() !== "GET") return;
      const status = (await response.json().catch(() => null))?.call?.status;
      if (status && uiStatuses.at(-1) !== status) uiStatuses.push(status);
    });
    await page.addInitScript(() => {
      window.__seen = [];
      const record = () => { if (document.body) window.__seen.push(document.body.innerText); };
      document.addEventListener("DOMContentLoaded", () => { record(); new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true }); });
    });
    await signInThroughForm(page);
    await page.goto(`${ready.app}/ar/app/lab`);
    await page.waitForLoadState("networkidle");
    check("the tester stays on /ar/app/lab", new URL(page.url()).pathname === "/ar/app/lab", page.url());

    const placeFromUi = async (number) => {
      const field = page.locator('input[type="tel"]:visible').or(page.getByRole("textbox", { name: UI.number })).first();
      await field.fill(number);
      await page.getByRole("button", { name: UI.start }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      for (const box of await dialog.getByRole("checkbox").all()) await box.check();
      await dialog.getByRole("button", { name: UI.confirm }).last().click();
    };
    const controlBeforeCall = snapshotFarm(CONTROL_FARM);
    await placeFromUi(ALLOWED_NUMBER);
    const finished = await waitFor(async () => {
      const state = await mockState();
      return state.calls[0]?.finished ? state : null;
    }, "the mock call to finish", 120_000);
    const call = finished.calls[0];
    writeFileSync(join(OUT, "route-call.json"), JSON.stringify(call, null, 2));
    await waitFor(async () => (await get()).json?.call?.status === "completed", "GET to report completed", 15_000).catch(() => {});
    await sleep(4000);
    await page.screenshot({ path: join(OUT, "route-completed.png"), fullPage: true });

    assertCallEvidence(call, TEST_FARM, ALLOWED_NUMBER);
    const finalState = await get();
    check("GET reports the call completed with the report saved", finalState.json?.call?.status === "completed" && finalState.json?.call?.reportSaved === true, finalState);
    check("GET shows the destination masked, never the full number", finalState.json?.call?.destination === `+9665******${ALLOWED_NUMBER.slice(-2)}` && !JSON.stringify(finalState.json).includes(ALLOWED_NUMBER), finalState.json?.call?.destination);
    for (const status of ["calling", "ringing", "connected", "completed"]) check(`the screen's polling saw ${status}`, uiStatuses.includes(status), uiStatuses);
    const seen = (await page.evaluate(() => window.__seen)).join("\n");
    for (const [status, pattern] of Object.entries(UI.statuses)) check(`the screen showed text for ${status}`, pattern.test(seen), status);
    check("the screen shows the report was saved", UI.saved.test(await page.locator("body").innerText()));
    check("no uncaught browser errors", errors.length === 0, errors);
    const testRun = JSON.parse(sql(`select coalesce(json_agg(json_build_object('state', r.state, 'attempts', jsonb_array_length(r.attempts), 'next', r.next_attempt_at, 'linked', r.report_id is not null)), '[]') from report_call_runs r where r.farm_id = ${q(TEST_FARM)}`));
    check("a test run is one attempt with no retry due, and it holds the report", testRun.length === 1 && testRun[0].attempts === 1 && testRun[0].next === null && testRun[0].state === "completed" && testRun[0].linked === true, testRun);
    check("ISOLATION: the only Twilio request went to the entered number", finished.requests.length === 1 && finished.requests[0].To === ALLOWED_NUMBER, finished.requests.map((request) => request.To));
    check("ISOLATION: the worker's placeholder number was never dialled", !finished.requests.some((request) => request.To === WORKER_PLACEHOLDER), finished.requests.map((request) => request.To));
    check("ISOLATION: the control ranch is byte-identical", snapshotFarm(CONTROL_FARM) === controlBeforeCall);
    check("ISOLATION: the report exists only on the test ranch", count("reports", TEST_FARM) === 1 && Number(sql(`select count(*) from reports where farm_id not in (${q(TEST_FARM)}, ${q(CONTROL_FARM)})`)) === 0, sql("select farm_id, count(*) from reports group by 1"));
    await assertCronRefuses(finished.requests.length);

    section("Double submission and a second call");
    resetTestRanch();
    await control({ reset: true, outcome: "hold", dwellMs: 200 });
    const requestId = randomUUID();
    await Promise.all([post(REQUEST({ requestId })), post(REQUEST({ requestId }))]);
    await waitFor(async () => (await requestsMade()) >= 1, "the held call");
    await sleep(1000);
    check("a double submission with one requestId places one call", (await requestsMade()) === 1, await requestsMade());
    const busy = await post(REQUEST({ phone: SECOND_ALLOWED }));
    check("a second call while one is active is busy", /busy/.test(JSON.stringify(busy.json)), busy);
    check("the busy attempt reached no provider", (await requestsMade()) === 1, await requestsMade());
    check("the mock accepted the release", (await release("no-answer")).status === 200);
    await waitFor(async () => (await mockState()).calls[0]?.finished, "the held call to end", 15_000);

    section("Failure: no answer, and Saudi calling not enabled");
    resetTestRanch();
    await control({ reset: true, outcome: "no-answer", dwellMs: 200 });
    await post(REQUEST());
    await waitFor(async () => (await mockState()).calls[0]?.finished, "the unanswered call", 15_000);
    await waitFor(async () => (await get()).json?.call?.status === "failed", "GET to report failed", 15_000).catch(() => {});
    const unanswered = await get();
    check("an unanswered call ends as failed", unanswered.json?.call?.status === "failed", unanswered);
    check("no retry is due after a no-answer", Number(sql(`select count(*) from report_call_runs where farm_id = ${q(TEST_FARM)} and (state = 'calling' or next_attempt_at is not null)`)) === 0 && Number(sql(`select coalesce(sum(jsonb_array_length(attempts)), 0) from report_call_runs where farm_id = ${q(TEST_FARM)}`)) === 1, sql(`select state, next_attempt_at, attempts from report_call_runs where farm_id = ${q(TEST_FARM)}`));
    await sleep(1500);
    check("an unanswered test call stays at one Twilio request", (await mockState()).requests.length === 1, (await mockState()).requests.length);
    await assertCronRefuses((await mockState()).requests.length);

    resetTestRanch();
    await control({ reset: true, outcome: "full", twilioError: 21215, dwellMs: 200 });
    await page.goto(`${ready.app}/ar/app/lab`);
    await page.waitForLoadState("networkidle");
    await placeFromUi(ALLOWED_NUMBER);
    await page.getByText(UI.saudiNotEnabled).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.screenshot({ path: join(OUT, "route-21215.png"), fullPage: true });
    check("Twilio error 21215 tells the tester Saudi calling isn't enabled", UI.saudiNotEnabled.test(await page.locator("body").innerText()));
    await control({ twilioError: null });

    section("Rate limit");
    resetTestRanch();
    await control({ reset: true, outcome: "no-answer", dwellMs: 50 });
    let limited = null;
    for (let attempt = 0; attempt < 25 && !limited; attempt += 1) {
      const result = await post(REQUEST());
      if (result.status === 429 || /rate/i.test(JSON.stringify(result.json))) limited = result;
      else {
        const before = attempt + 1;
        await waitFor(async () => (await mockState()).calls.filter((entry) => entry.finished).length >= Math.min(before, (await mockState()).calls.length), "the attempt to end", 15_000).catch(() => {});
        await sleep(300);
        resetTestRanch();
      }
    }
    check("the rate limit eventually refuses", limited !== null, limited);
    check("ISOLATION: the control ranch is byte-identical after every scenario", snapshotFarm(CONTROL_FARM) === controlBefore);
  } finally {
    await browser.close();
    await stopRunner();
  }
}

/* ─────────────────── main ─────────────────── */

let routeAvailable = PHASE === "route" ? true : null;
let exitCode = 1;
try {
  if (PHASE !== "route") routeAvailable = (await phaseReportPath()) !== 404;
  if (PHASE !== "report") {
    if (routeAvailable) await phaseRoute();
    else {
      section("Phase 2: the manual Test AI Call route and screen");
      skip("/api/test-call answered 404 to an anonymous request: the feature code is not on this commit. Re-run after the server and UI branches land.");
    }
  }
  exitCode = results.some((entry) => entry.checks.some((item) => !item.passed)) ? 1 : 0;
} catch (error) {
  console.error(`\nERROR ${error.stack ?? error}`);
  if (current) current.error = String(error.message ?? error);
  await stopRunner().catch(() => {});
}

const summary = results.map((entry) => {
  const failed = entry.checks.filter((item) => !item.passed).length;
  const verdict = entry.error ? "ERROR" : entry.skipped ? "SKIP" : failed ? "FAIL" : "PASS";
  return `${verdict.padEnd(6)} ${entry.title}${entry.checks.length ? `  [${entry.checks.length - failed}/${entry.checks.length}]` : ""}`;
}).join("\n");
console.log(`\n=== verify-test-call ===\n${summary}`);
console.log("\nThis was a mock. It proves wiring only: fake Twilio, a scripted model and a local database. It cannot prove the real model's Arabic quality, real telephony or Saudi carrier delivery.");
writeFileSync(join(OUT, "result.json"), JSON.stringify({ phase: PHASE, results }, null, 2));
process.exit(exitCode);
