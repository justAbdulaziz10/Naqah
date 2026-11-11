#!/usr/bin/env node
/**
 * LOCAL ONLY, free. Natural report calls on the presentation ranch «عزبة الوسم (عرض تجريبي)», end to end: real Next
 * routes, the real voice bridge and a disposable Postgres, with Twilio and the model replaced by loopback mocks
 * (scripts/mocks/test-call-twilio.mjs runs each call from a JSON scenario; see runNaturalScenario there).
 *
 *   NAQAH_TEST_CALL_ISOLATED=1 node scripts/verify-natural-report.mjs [--skip-build] [--only 1,9]
 *
 * Scenarios (each on a freshly seeded copy of the ranch, worker +966500000001, no report today):
 *   1 happy path, the worker's yes starting 300 ms before the summary's playback mark returns (placed from the
 *     Dashboard's «اتصال حقيقي» → «اتصل الآن» in Playwright)   5 the Dashboard and Calls page after scenario 1
 *   2 a correction after the summary   3 duplicate confirmations   4 a failed save (a test-only trigger refuses the
 *     report insert for that one ranch in the disposable database)
 *   6 the owner changes the worker's number in Settings (with the recipient's consent), then the Dashboard calls exactly
 *     that number   7 «اتصال حقيقي» rate limit: a 4th placed call in an hour is refused
 *   8 repeat demo calls: the presentation ranch takes a second report call today (two reports, the Dashboard shows the
 *     latest); the test ranch with a report today stays blocked; in_progress and the hourly limit still apply
 *   9 feed amount «كم باقي من العلف عندكم؟»: «باقي 25 كيس», «عندنا 10 بالات», «باقي شوي», «ما أدري» keep the amount and
 *     unit (or the level), invent nothing; the Dashboard and Calls page show «25 كيس» (runs before 8)
 *
 * The runner is started with --keep-data --repeat-demo-reports (its database emptied before the first start), and scenario 8
 * restarts it after seeding, because the repeat list holds the ranch ids present when the runner starts.
 * The runner is started with --owner-approves, so the build must include NEXT_PUBLIC_NAQAH_OWNER_APPROVES_NUMBERS: run once
 * without --skip-build after switching branches or flags.
 *
 * Always run with NAQAH_TEST_CALL_ISOLATED=1 (ports +100, /tmp/naqah-test-call-iso), so the running demo is untouched.
 * A mock proves wiring only. It cannot prove the real model's Arabic or real telephony.
 * Results: /tmp/naqah-test-call-iso/verify/natural-report.json and screenshots there. Exit code 1 on any failure.
 */
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APPROVED_FILE, GATEWAY, MOCK_ALLOWED, READY_FILE, ROOT, TEST_FARM, TESTER } from "./test-call-local.mjs";

if (process.env.NAQAH_TEST_CALL_ISOLATED !== "1") {
  console.error("Run with NAQAH_TEST_CALL_ISOLATED=1: this verifier only uses the isolated stack.");
  process.exit(2);
}

const flag = (name) => process.argv.includes(`--${name}`);
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "verify");
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const DB = "naqah_test_call";
const PG_PORT = "54450";
const STOP_PORTS = [54450, 54451, 54452, 3410, 3411, 3413];
const WORKER = MOCK_ALLOWED[0]; // +966500000001
const DEMO = { email: "demo@naqah.demo", password: "naqah-demo-2026" };
const RANCH = "عزبة الوسم (عرض تجريبي)";
/** The mock stack's voice secret (scripts/test-call-local.mjs, mock credentials): signs the direct retries. */
const MOCK_VOICE_SECRET = "local-only-voice-secret-for-test-call";
const CUSTOM_OTHER = "فيه شي ثاني تبي تبلغ عنه؟";
const SAVED_WORDS = /انحفظ|حفظت|تم الحفظ|سجلت|سجّلت/;
const CONNECTION_EXCUSE = /الاتصال|الشبكة|النت\b|الإنترنت|الانترنت|الخط/;
mkdirSync(OUT, { recursive: true });
if (GATEWAY !== "http://127.0.0.1:54452") throw new Error(`Unexpected gateway ${GATEWAY}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pgEnv = { PATH: `${PG_BIN}:${process.env.PATH}`, LC_ALL: "en_US.UTF-8", PGHOST: "127.0.0.1", PGPORT: PG_PORT, PGUSER: "postgres" };
const sql = (query) => execFileSync(join(PG_BIN, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], { input: query, encoding: "utf8", env: pgEnv, maxBuffer: 1 << 26 }).trim();
const json = (query) => JSON.parse(sql(query) || "null");
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const postJson = async (url, body, headers = {}) => {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  let parsed = null;
  try { parsed = await response.json(); } catch { /* not json */ }
  return { status: response.status, json: parsed };
};

async function waitFor(probe, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { const value = await probe(); if (value) return value; } catch { /* not ready */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(200);
  }
}

/* ─────────────────── results ─────────────────── */

const results = [];
let current = null;
function section(id, title) {
  current = { id, title, checks: [], evidence: {} };
  results.push(current);
  console.log(`\n${id}. ${title}`);
}
function check(name, passed, detail) {
  current.checks.push({ name, passed: Boolean(passed), ...(passed ? {} : { detail }) });
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${passed || detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 700)}`}`);
}
const evidence = (key, value) => { current.evidence[key] = value; };

/* ─────────────────── the runner ─────────────────── */

let runner = null;
let runnerLog = null;
let ready = null;
const portOpen = (port) => new Promise((resolve) => {
  const socket = tcpConnect(port, "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

/**
 * --repeat-demo-reports reads the presentation ranch's id once, when the runner starts, and every scenario reseeds the
 * ranch under a new id. So the runner always keeps its database (--keep-data, emptied before the first start) and
 * scenario 8 restarts it after seeding, so that ranch's id is the one on the repeat list.
 */
async function startRunner({ restart = false } = {}) {
  if (existsSync(READY_FILE)) throw new Error(`A runner already looks active (${READY_FILE}). Stop it first.`);
  if (!restart) {
    if (await portOpen(Number(PG_PORT))) throw new Error(`Port ${PG_PORT} is in use: another isolated stack is running.`);
    rmSync(join(ROOT, "pg"), { recursive: true, force: true }); // a fresh database, as before --keep-data
  }
  const logName = restart ? "natural-report-runner-repeat.log" : "natural-report-runner.log";
  runnerLog = openSync(join(OUT, logName), "w");
  const args = [join(REPO, "scripts/test-call-local.mjs"), "--mock", "--report-path", "--natural", "--owner-approves", "--keep-data", "--repeat-demo-reports",
    ...(restart || flag("skip-build") ? ["--skip-build"] : [])];
  runner = spawn(process.execPath, args, { cwd: REPO, stdio: ["ignore", runnerLog, runnerLog], env: { ...process.env, NAQAH_TEST_CALL_ISOLATED: "1" } });
  await waitFor(() => {
    if (runner.exitCode !== null) throw Object.assign(new Error("runner exited"), { fatal: true });
    return existsSync(READY_FILE);
  }, "the runner", 420_000).catch((error) => { throw new Error(`The runner did not become ready (${error.message}); see ${join(OUT, logName)}`); });
  ready = JSON.parse(readFileSync(READY_FILE, "utf8"));
  if (ready.app !== "http://127.0.0.1:3411" || ready.provider !== "http://127.0.0.1:3413") throw new Error(`Not the isolated stack: ${JSON.stringify(ready)}`);
}

async function stopRunner() {
  if (!runner) return [];
  const child = runner;
  runner = null;
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, sleep(20_000)]);
  }
  closeSync(runnerLog);
  return (await Promise.all(STOP_PORTS.map(async (port) => [port, await portOpen(port)]))).filter(([, open]) => open).map(([port]) => port);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { runner?.kill("SIGTERM"); process.exit(130); });

const mockState = async () => (await fetch(`${ready.provider}/__test/state`)).json();
const control = (body) => postJson(`${ready.provider}/__test/control`, body);

/* ─────────────────── the presentation ranch ─────────────────── */

function seedRanch() {
  const seedArgs = [join(REPO, "scripts/demo/seed-presentation.mjs"), "--db", DB, "--gateway", GATEWAY];
  const env = { ...process.env, ...pgEnv };
  execFileSync(process.execPath, [...seedArgs, "--reset"], { cwd: REPO, env, stdio: "ignore" });
  const out = execFileSync(process.execPath, [...seedArgs, "--worker-phone", WORKER, "--end-yesterday"], { cwd: REPO, env, encoding: "utf8" });
  const farm = sql(`select id from farms where name = ${q(RANCH)}`);
  if (!/^[0-9a-f-]{36}$/.test(farm)) throw new Error(`The demo ranch was not seeded: ${out}`);
  return farm;
}

/** The plan this verifier expects; set through SQL when the seed ever drifts from it. */
function ensurePlan(farm) {
  const other = sql(`select id from custom_questions where farm_id = ${q(farm)} and text = ${q(CUSTOM_OTHER)}`);
  const plan = json(`select question_plan from farms where id = ${q(farm)}`) ?? [];
  const enabled = plan.filter((entry) => entry.enabled).map((entry) => entry.id);
  const wanted = ["herd_health", "feed_level", "water_level", "fences_condition", other];
  if (JSON.stringify(enabled) !== JSON.stringify(wanted)) {
    const next = [...wanted.map((id) => ({ id, enabled: true, required: true })), ...plan.filter((entry) => !wanted.includes(entry.id)).map((entry) => ({ ...entry, enabled: false }))];
    sql(`update farms set question_plan = ${q(JSON.stringify(next))}::jsonb, revision = revision + 1 where id = ${q(farm)}`);
  }
  return { other, plan: json(`select question_plan from farms where id = ${q(farm)}`), wasAsSeeded: JSON.stringify(enabled) === JSON.stringify(wanted) };
}

async function demoCookie(account = DEMO) {
  const session = await postJson(`${GATEWAY}/auth/v1/token?grant_type=password`, account);
  if (session.status !== 200) throw new Error(`Could not sign in ${account.email}: ${session.status}`);
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session.json)).toString("base64url")}`;
}

async function signIn(page, account = DEMO) {
  await page.goto(`${ready.app}/ar/login?method=email`);
  await page.locator('input[name="email"]:visible').fill(account.email);
  await page.locator('input[name="password"]:visible').fill(account.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/ar/app"), { timeout: 30_000 });
}

/** A freshly started Next can take a press before the form has hydrated: load the pages once, then sign in (one retry). */
async function signInAfterStart(page, account = DEMO) {
  for (const path of ["/ar/login?method=email", "/ar/app", "/ar/app/calls"]) await fetch(`${ready.app}${path}`).catch(() => {});
  try { await signIn(page, account); } catch { await signIn(page, account); }
}

/** Everything a call may write, as text, so "unchanged" means byte-identical. */
function snapshot(farm) {
  const rows = (table, where) => sql(`select coalesce(string_agg(r::text, E'\\n' order by r::text), '') from ${table} r where ${where}`);
  return ["camels", "resources", "reports", "task_tickets", "findings_of", "answers_of"].map((table) => {
    if (table === "findings_of") return rows("findings", `report_id in (select id from reports where farm_id = ${q(farm)})`);
    if (table === "answers_of") return rows("report_answers", `report_id in (select id from reports where farm_id = ${q(farm)})`);
    return rows(table, `farm_id = ${q(farm)}`);
  }).join("\n=====\n");
}

const counts = (farm, sid) => json(`select json_build_object(
  'reports', (select count(*) from reports where farm_id = ${q(farm)}),
  'events', (select count(*) from events where farm_id = ${q(farm)}),
  'calls', (select count(*) from calls where farm_id = ${q(farm)}),
  'voiceEvents', (select count(*) from voice_events where farm_id = ${q(farm)}),
  'reportEvents', ${sid ? `(select count(*) from voice_events where farm_id = ${q(farm)} and event_id = ${q(`${sid}:report`)})` : "0"},
  'runs', (select count(*) from report_call_runs where farm_id = ${q(farm)}))`);

/** The base answers: Mazoon still sick, Wadha under watch, the rest well; feed low, water fine, nothing broken. */
const BASE = {
  say: "مزون للحين تعبانة، ووضحة ما تاكل زين، والباقي بخير. العلف ناقص شوي، الماي يكفي، ما فيه شي خربان، ولا فيه شي ثاني",
  answers: {
    herd_health: { value: "no", camels: [{ name: "مزون", status: "sick", note: "مزون للحين تعبانة" }, { name: "وضحة", status: "watch", note: "وضحة ما تاكل زين" }], rest_well: true },
    feed_level: { value: "low" },
    water_level: { value: "good" },
    fences_condition: { value: "good" },
    custom: { text: "لا ما فيه شي ثاني" },
    task: { value: "no" },
    weather_heat_day: { value: "unknown" },
  },
  confirm: { say: "كل شيء تمام، لا تعدل", earlyMs: 300 },
};

/** Places «اتصال حقيقي» through the owner's API (the same op the Dashboard button calls) and waits for the mock call. */
async function callViaApi(cookie) {
  const placed = await postJson(`${ready.app}/api/account`, { op: "callNow" }, { Origin: ready.app, Cookie: cookie });
  return placed;
}

async function finishedCall() {
  const state = await waitFor(async () => {
    const s = await mockState();
    return s.calls[0]?.finished ? s : null;
  }, "the mock call to finish", 120_000);
  await sleep(1500); // the final status callback and its writes
  return state;
}

const run = (farm) => json(`select row_to_json(r) from (select id, state, report_id, attempts, next_attempt_at, provider_call_id, trigger from report_call_runs where farm_id = ${q(farm)} order by created_at desc limit 1) r`);

/** What every natural call must show on the wire and in the summary, whatever its ending. */
function callBasics(call, enabledOther) {
  check("the mock call finished without a harness error", call.finished === true && !call.error, call.error);
  check("natural mode: the model was given tool_choice auto and the four natural tools", call.provider?.sessionUpdate?.tool_choice === "auto"
    && JSON.stringify((call.provider.sessionUpdate.tools ?? []).map((tool) => tool.name)) === JSON.stringify(["submit_report", "confirm_report", "flag_urgent", "end_call"]), call.provider?.sessionUpdate?.tools?.map((tool) => tool.name));
  // An open task joins the call once it is due (the presentation ranch's «اعزل مزون…»), so tasks are not topics here.
  const asked = (call.scenarioLog?.asked ?? []).filter((item) => item.kind !== "task").map((item) => item.id);
  check("only the ranch's enabled topics were queued (herd health, feed, water, fences, «فيه شي ثاني»)",
    JSON.stringify(asked.filter((id) => !id.startsWith("open_note_"))) === JSON.stringify(["herd_health", "feed_level", "water_level", "fences_condition", enabledOther]), call.scenarioLog?.asked);
  const instructions = call.provider?.sessionUpdate?.instructions ?? "";
  check("the model's instructions list no disabled topic (herd count, shelter, medicine, milk, visitors)",
    !/\[herd_count\]|\[shelter_condition\]|\[medicine_stock\]|حليب|زار العزبة/.test(instructions), instructions.match(/الأسئلة بالترتيب:[\s\S]*?\n(?=أسماء)/)?.[0]);
  for (const [index, summary] of (call.scenarioLog?.summaries ?? []).entries()) {
    const label = index === 0 ? "the summary" : `summary ${index + 1}`;
    check(`${label} is the engine's, flagged, with save/correct/end replies`, summary.flagged && JSON.stringify([...summary.replies].sort()) === JSON.stringify(["confirm_save", "correct", "end_without_save"]), summary);
    check(`${label} was read to the worker in full, word for word`, summary.readInFull === true, summary.text);
    check(`${label} names the camels and covers feed, water and fences`, /مزون/.test(summary.text) && /وضحة/.test(summary.text) && /(العلف|الأعلاف)/.test(summary.text) && /(الماء|الموية|الماي)/.test(summary.text) && /(الشبك|السياج|خربان)/.test(summary.text), summary.text);
    check(`${label} mentions no disabled topic`, !/(راس|رأس|عدد الحلال|المظل|الظل|الأدوية|الدواء|حليب|زار)/.test(summary.text ?? ""), summary.text);
  }
}

/** The bridge spoke a goodbye after the confirmation, closed the stream, and /after only hung up. */
function savedEnding(call) {
  const spoken = call.provider?.spoken ?? [];
  const goodbye = spoken.at(-1) ?? "";
  evidence("goodbye", goodbye);
  check("confirm_report returned saved", call.confirm?.output?.status === "saved", call.confirm);
  check("no report existed before confirm_report", call.reportsBeforeConfirm !== undefined && call.reportsAfterConfirm === call.reportsBeforeConfirm + 1, { before: call.reportsBeforeConfirm, after: call.reportsAfterConfirm });
  check("the goodbye was played by the bridge and says it was saved", call.confirm?.output && goodbye !== call.summary?.text && SAVED_WORDS.test(goodbye), spoken.slice(-2));
  check("the bridge closed the stream after the goodbye", call.streamClosed === true, call.streamClosed);
  check("/after only hangs up", call.after?.http === 200 && call.after.hangup && !call.after.speaks, call.after);
  check("the voice_call_sessions row is removed", Number(sql(`select count(*) from voice_call_sessions where call_sid = ${q(call.sid)}`)) === 0);
}

/* ─────────────────── scenario 1 (+5): happy path from the Dashboard ─────────────────── */

async function scenarioHappy(browser) {
  section(1, "Happy path: saved topics, immediate «كل شيء تمام، لا تعدل», every field in Postgres");
  const farm = seedRanch();
  const plan = ensurePlan(farm);
  evidence("farm", farm);
  evidence("questionPlan", plan.plan);
  check("the seeded ranch already had the requested plan (no SQL change needed)", plan.wasAsSeeded, plan.plan);
  check("the primary worker is the mock-allowed number", sql(`select w.phone from farms f join workers w on w.id = f.primary_worker_id where f.id = ${q(farm)}`) === WORKER);
  const before = counts(farm);
  const camelsBefore = json(`select json_object_agg(name, json_build_object('health', health, 'note', health_note)) from camels where farm_id = ${q(farm)}`);
  const started = sql("select now()");
  await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: BASE });

  // The owner presses «اتصال حقيقي» → «اتصل الآن» on the Dashboard.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-SA" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  // The free preflight asks the public bridge URL and OpenAI, which a mock stack can't reach; only it is stubbed.
  await page.route("**/api/report-call-now?preflight=1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ready: true, checks: [], message: null }) }));
  let placedFromUi = false;
  try {
    await signIn(page);
    await page.goto(`${ready.app}/ar/app`);
    const button = page.getByRole("button", { name: "اتصال حقيقي", exact: true });
    await button.waitFor({ timeout: 20_000 });
    await waitFor(async () => button.isEnabled(), "«اتصال حقيقي» to be enabled", 20_000);
    await page.screenshot({ path: join(OUT, "natural-dashboard-before.png"), fullPage: true });
    await button.click();
    await page.getByRole("dialog").getByRole("button", { name: "اتصل الآن", exact: true }).click();
    await waitFor(async () => (await mockState()).requests.length > 0, "the Dashboard's call to reach mock Twilio", 20_000);
    placedFromUi = true;
  } catch (error) {
    evidence("uiError", error.message);
    await page.screenshot({ path: join(OUT, "natural-dashboard-ui-failure.png"), fullPage: true }).catch(() => {});
  }
  check("the call was placed from the Dashboard's «اتصال حقيقي» → «اتصل الآن»", placedFromUi, current.evidence.uiError);
  if (!placedFromUi) {
    const placed = await callViaApi(await demoCookie());
    check("fallback: the same callNow op placed the call", placed.json?.data?.status === "placed", placed);
  }
  const state = await finishedCall();
  const call = state.calls[0];
  writeFileSync(join(OUT, "natural-happy-call.json"), JSON.stringify(call, null, 2));
  check("one Twilio request, to the ranch's worker only", state.requests.length === 1 && state.requests[0].To === WORKER, state.requests.map((r) => r.To));
  callBasics(call, plan.other);
  check("the worker's yes started ~300 ms before the summary's playback mark came back",
    call.immediate && call.immediate.inputMs - call.immediate.speechStartMs === 300 && call.immediate.marksAckedAfterSpeech.some((name) => name.startsWith("summary-")), call.immediate);
  evidence("immediate", call.immediate);
  check("natural: one hand-over, then the confirmation", JSON.stringify(call.toolResults.map((entry) => entry.name)) === JSON.stringify(["submit_report", "confirm_report"]), call.toolResults.map((entry) => entry.name));
  savedEnding(call);

  const after = counts(farm, call.sid);
  const runRow = run(farm);
  evidence("run", runRow);
  check("exactly ONE new report", after.reports === before.reports + 1, { before, after });
  check("the report-call run is completed and linked to the report", runRow?.state === "completed" && Boolean(runRow.report_id) && runRow.trigger === "manual", runRow);
  const report = json(`select row_to_json(r) from (select id, at, herd_count_reported, mode, coverage, call_id from reports where id = ${q(runRow?.report_id)}) r`);
  evidence("report", report);
  const todayRiyadh = sql("select to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD')");
  check("the report is dated today (Asia/Riyadh) and after the call started", report && sql(`select to_char(${q(report.at)}::timestamptz at time zone 'Asia/Riyadh', 'YYYY-MM-DD')`) === todayRiyadh && sql(`select ${q(report.at)}::timestamptz >= ${q(started)}::timestamptz`) === "t", report?.at);
  check("herd_count_reported is null: herd count is disabled and was never asked", report?.herd_count_reported === null, report?.herd_count_reported);
  check("reports.mode is set (guided/open)", ["guided", "open"].includes(report?.mode), report?.mode);
  check("reports.coverage is a JSON array", Array.isArray(report?.coverage), report?.coverage);
  const answers = json(`select coalesce(json_agg(row_to_json(a) order by a.sort_order), '[]') from (select question_id, question_ar, answer, answer_ar, certainty, follow_up, sort_order from report_answers where report_id = ${q(runRow?.report_id)}) a`) ?? [];
  evidence("answers", answers);
  const byId = Object.fromEntries(answers.map((row) => [row.question_id, row]));
  const asked = (call.scenarioLog?.asked ?? []).map((item) => item.id);
  check("one report_answers row per asked question, and only those", answers.length === asked.length && asked.every((id) => byId[id]), { asked, saved: answers.map((row) => row.question_id) });
  check("herd_health answer names مزون and وضحة", /مزون/.test(`${byId.herd_health?.answer} ${byId.herd_health?.answer_ar}`) && /وضحة/.test(`${byId.herd_health?.answer} ${byId.herd_health?.answer_ar}`), byId.herd_health);
  check("feed_level saved as low («قارب على النفاد» / Running low)", byId.feed_level?.answer === "Running low" && /قارب على النفاد/.test(byId.feed_level?.answer_ar ?? ""), byId.feed_level);
  check("water_level saved as good", /(كاف|يكفي|جيد|زين)/.test(`${byId.water_level?.answer_ar ?? byId.water_level?.answer}`), byId.water_level);
  check("fences_condition saved as good", /(سليم|جيد|زين|ما فيه)/.test(`${byId.fences_condition?.answer_ar ?? byId.fences_condition?.answer}`), byId.fences_condition);
  check("«فيه شي ثاني» keeps the worker's words", byId[plan.other]?.answer === BASE.answers.custom.text, byId[plan.other]);
  check("every answer is labelled reported (no invented certainty)", answers.every((row) => row.certainty === "reported"), answers.map((row) => [row.question_id, row.certainty]));
  const camels = json(`select json_object_agg(name, json_build_object('health', health, 'note', health_note, 'certainty', certainty, 'updated', updated_at >= ${q(started)}::timestamptz)) from camels where farm_id = ${q(farm)}`);
  evidence("camelsBefore", { مزون: camelsBefore["مزون"], وضحة: camelsBefore["وضحة"], هيا: camelsBefore["هيا"] });
  evidence("camelsAfter", camels);
  check("مزون is sick with the worker's words «مزون للحين تعبانة»", camels["مزون"].health === "sick" && /مزون للحين تعبانة/.test(camels["مزون"].note ?? "") && camels["مزون"].updated, camels["مزون"]);
  check("وضحة is under watch with the worker's note", camels["وضحة"].health === "watch" && /ما تاكل زين/.test(camels["وضحة"].note ?? "") && camels["وضحة"].updated, camels["وضحة"]);
  const resources = json(`select json_object_agg(kind, json_build_object('level', level, 'certainty', certainty, 'updated', updated_at >= ${q(started)}::timestamptz)) from resources where farm_id = ${q(farm)}`);
  evidence("resources", resources);
  check("resources: feed low, water good, fences good, all updated by this call", resources.feed.level === "low" && resources.water.level === "good" && resources.fences.level === "good" && resources.feed.updated && resources.water.updated && resources.fences.updated, resources);
  check("resources not asked (shelter, medicine) were not touched", !resources.shelter?.updated && !resources.medicine?.updated, { shelter: resources.shelter, medicine: resources.medicine });
  const findings = json(`select coalesce(json_agg(json_build_object('ar', text_ar, 'source', source, 'criterion', criterion_id is not null)), '[]') from findings where report_id = ${q(runRow?.report_id)}`);
  evidence("findings", findings);
  check("findings include the sick camel مزون", findings.some((finding) => /مزون/.test(finding.ar)), findings);
  const events = json(`select coalesce(json_agg(text_ar order by at), '[]') from events where farm_id = ${q(farm)} and at >= ${q(started)}::timestamptz`);
  evidence("newEvents", events);
  check("events were written for this call", events.length > 0 && after.events > before.events, events);
  check("exactly one recorded worker_report outcome for this call (voice_events)", after.reportEvents === 1, after);
  const callRows = json(`select coalesce(json_agg(row_to_json(c)), '[]') from (select kind, direction, outcome, report_id, provider_call_id, summary_ar from calls where farm_id = ${q(farm)} and at >= ${q(started)}::timestamptz) c`);
  evidence("callRows", callRows);
  check("one calls row for this call, completed and linked to the report", callRows.length === 1 && callRows[0].outcome === "completed" && callRows[0].report_id === runRow?.report_id, callRows);
  await context.close();
  return { farm, call, report, answers, resources, errors, started };
}

async function scenarioDisplay(browser, happy) {
  section(5, "Display: Dashboard and Calls page after scenario 1");
  if (!happy?.report) { check("scenario 1 saved a report to display", false, "no report"); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-SA" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await signIn(page);
  await page.goto(`${ready.app}/ar/app`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: join(OUT, "natural-dashboard.png"), fullPage: true });
  const dash = await page.locator("body").innerText();
  const time = sql(`select to_char(${q(happy.report.at)}::timestamptz at time zone 'Asia/Riyadh', 'HH24:MI')`);
  const time12 = sql(`select to_char(${q(happy.report.at)}::timestamptz at time zone 'Asia/Riyadh', 'FMHH12:MI')`);
  evidence("dashboardText", dash.slice(0, 3000));
  evidence("reportTime", { time, time12 });
  check("Dashboard shows the new report's time (or «اليوم»)", dash.includes(time) || dash.includes(time12) || /اليوم/.test(dash), { time, time12 });
  check("Dashboard names مزون and وضحة", /مزون/.test(dash) && /وضحة/.test(dash));
  check("Dashboard shows the worker's note for مزون from this call", /مزون للحين تعبانة/.test(dash), dash.match(/مزون[^\n]*/g)?.slice(0, 5));
  const feed = happy.answers.find((row) => row.question_id === "feed_level")?.answer_ar;
  const water = happy.answers.find((row) => row.question_id === "water_level")?.answer_ar;
  check("Dashboard shows the feed and water state from this call", Boolean(feed && dash.includes(feed) && water && dash.includes(water)), { feed, water, lines: dash.split("\n").filter((line) => /العلف|الماء|الماي|الموية/.test(line)).slice(0, 6) });
  check("Dashboard has no «محاكاة» line for today's report (it is the real call's)", !new RegExp(`محاكاة[^\\n]*${time}`).test(dash));

  await page.goto(`${ready.app}/ar/app/calls`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: join(OUT, "natural-calls.png"), fullPage: true });
  const calls = await page.locator("body").innerText();
  evidence("callsText", calls.slice(0, 3000));
  // Today's card: from today's date heading to the next date heading.
  const today = sql("select to_char(now() at time zone 'Asia/Riyadh', 'FMDD')");
  const card = calls.split(/\n(?=(?:السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)، )/).find((block) => new RegExp(`^(?:السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)، ${today} `).test(block)) ?? "";
  evidence("todayCard", card.slice(0, 800));
  check("Calls page lists today's call (today's date and the call's time)", card.includes(time) || card.includes(time12), { today, time, time12, card: card.slice(0, 300) });
  check("today's call is the worker's report with this call's note «مزون للحين تعبانة» and a link to the report", /تقرير أحمد/.test(card) && /مزون للحين تعبانة/.test(card) && /اعرض التقرير/.test(card), card.slice(0, 400));
  check("today's call is shown as completed with the report saved («ردّ», «انحفظ التقرير · 3 ملاحظات مهمة»)", /ردّ/.test(card) && /انحفظ التقرير · 3 ملاحظات مهمة/.test(card) && !/ما فيه رد|انتهت قبل حفظ التقرير/.test(card), card.slice(0, 400));
  const all = [...happy.errors, ...errors];
  evidence("browserErrors", all);
  check("no console errors or page errors (sign-in, Dashboard, Calls)", all.length === 0, all);
  await context.close();
}

/* ─────────────────── scenario 2: a correction ─────────────────── */

async function scenarioCorrection() {
  section(2, "Correction: feed corrected after the summary, a new summary, one report with the corrected value only");
  const farm = seedRanch();
  const plan = ensurePlan(farm);
  const before = counts(farm);
  await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: { ...BASE, corrections: [{ say: "لا، العلف خلص كله", answers: { feed_level: { value: "critical" } } }] } });
  const placed = await callViaApi(await demoCookie());
  check("callNow placed the call", placed.json?.data?.status === "placed", placed);
  const call = (await finishedCall()).calls[0];
  writeFileSync(join(OUT, "natural-correction-call.json"), JSON.stringify(call, null, 2));
  callBasics(call, plan.other);
  const [first, second] = call.scenarioLog?.summaries ?? [];
  evidence("summaries", [first?.text, second?.text]);
  check("two hand-overs then the confirmation", JSON.stringify(call.toolResults.map((entry) => entry.name)) === JSON.stringify(["submit_report", "submit_report", "confirm_report"]), call.toolResults.map((entry) => entry.name));
  check("a second, different summary was read after the correction", Boolean(first && second) && first.text !== second.text && second.readInFull, { first: first?.text, second: second?.text });
  check("the new summary has the corrected feed and not the old one", Boolean(second) && /(خلص|خالص|نفد|ما بقى|حرج)/.test(second.text) && !/(قليل|ناقص)/.test(second.text.match(/(العلف|الأعلاف)[^.،]*/)?.[0] ?? ""), second?.text.match(/(العلف|الأعلاف)[^.،]*/)?.[0]);
  savedEnding(call);
  const after = counts(farm, call.sid);
  check("exactly ONE new report", after.reports === before.reports + 1, { before, after });
  const runRow = run(farm);
  const feed = json(`select row_to_json(a) from (select answer, answer_ar from report_answers where report_id = ${q(runRow?.report_id)} and question_id = 'feed_level') a`);
  const feedRows = Number(sql(`select count(*) from report_answers where report_id = ${q(runRow?.report_id)} and question_id = 'feed_level'`));
  evidence("feedAnswer", feed);
  check("one feed answer, the corrected one", feedRows === 1 && !/(قليل|ناقص)/.test(`${feed?.answer_ar} ${feed?.answer}`) && /(خلص|نفد|ما بقى|حرج|خالص)/.test(`${feed?.answer_ar} ${feed?.answer}`), { feedRows, feed });
  const level = sql(`select level from resources where farm_id = ${q(farm)} and kind = 'feed'`);
  check("resources.feed is critical", level === "critical", level);
  check("the run is completed and linked", runRow?.state === "completed" && Boolean(runRow.report_id), runRow);
}

/* ─────────────────── scenario 3: duplicate confirmations ─────────────────── */

async function scenarioDuplicates() {
  section(3, "Duplicate confirmation: the same confirm_report twice + a new id in one model turn, then signed retries");
  const farm = seedRanch();
  const plan = ensurePlan(farm);
  const before = counts(farm);
  await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: { ...BASE, duplicates: { inResponse: true, direct: true, voiceSecret: MOCK_VOICE_SECRET } } });
  const placed = await callViaApi(await demoCookie());
  check("callNow placed the call", placed.json?.data?.status === "placed", placed);
  const call = (await finishedCall()).calls[0];
  writeFileSync(join(OUT, "natural-duplicates-call.json"), JSON.stringify(call, null, 2));
  callBasics(call, plan.other);
  const dup = call.duplicates ?? {};
  evidence("duplicates", dup);
  savedEnding(call);
  const second = dup.inResponse?.outputs?.[dup.inResponse?.second];
  evidence("secondInTurnOutput", second ?? null);
  check("in the same model turn, the bridge sent the repeated id once and never ran the new-id confirm (call already ending)", dup.inResponse && (second === null || second === undefined), second);
  check("a signed retry with the saved call's id replays, it doesn't save again", dup.direct?.same?.http === 200 && ["saved", "call_ended"].includes(dup.direct.same.output?.status), dup.direct?.same);
  check("a signed retry with a new id doesn't save again", dup.direct?.fresh?.http === 200 && ["saved", "call_ended", "invalid"].includes(dup.direct.fresh.output?.status), dup.direct?.fresh);
  const after = counts(farm, call.sid);
  evidence("counts", { before, after });
  check("still exactly ONE new report", after.reports === before.reports + 1, { before, after });
  check("exactly one recorded worker_report outcome (voice_events) for this call", after.reportEvents === 1, after);
  check("no extra events: same number of new events as a single save (scenario 1)", happyEventDelta === null || after.events - before.events === happyEventDelta, { delta: after.events - before.events, happy: happyEventDelta });
  check("one calls row for this call", after.calls === before.calls + 1, { before: before.calls, after: after.calls });
  check("only one goodbye was spoken", (call.provider?.spoken ?? []).filter((line) => SAVED_WORDS.test(line)).length === 1, call.provider?.spoken?.slice(-3));
  check("the run is completed and linked", run(farm)?.state === "completed" && Boolean(run(farm)?.report_id), run(farm));
}

/* ─────────────────── scenario 4: a failed save ─────────────────── */

async function scenarioFailedSave() {
  section(4, "Failed save: the report insert is refused for this ranch only, nothing half-saved, an accurate goodbye");
  const farm = seedRanch();
  const plan = ensurePlan(farm);
  // Test-only, disposable local database: refuse inserting this ranch's reports, so apply_farm_changes rolls back.
  sql(`create or replace function public.verify_natural_fail_report() returns trigger language plpgsql as $$
    begin raise exception 'verify-natural-report: report save refused on purpose'; end $$;
    drop trigger if exists verify_natural_fail_report on public.reports;
    create trigger verify_natural_fail_report before insert on public.reports for each row
      when (new.farm_id = ${q(farm)}::uuid) execute function public.verify_natural_fail_report();`);
  try {
    const before = counts(farm);
    const snap = snapshot(farm);
    await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: BASE });
    const placed = await callViaApi(await demoCookie());
    check("callNow placed the call", placed.json?.data?.status === "placed", placed);
    const call = (await finishedCall()).calls[0];
    writeFileSync(join(OUT, "natural-failed-save-call.json"), JSON.stringify(call, null, 2));
    callBasics(call, plan.other);
    evidence("confirmOutput", call.confirm?.output);
    evidence("spokenTail", call.provider?.spoken?.slice(-2));
    evidence("after", call.after);
    check("confirm_report did not claim saved", call.confirm?.output?.status !== "saved", call.confirm);
    check("the first failure asked for the yes again (one retry, as a guided call)", call.confirmRetried === true, call.toolResults?.map((entry) => entry.name));
    check("the second failure ended honestly: save_failed", call.confirm?.output?.status === "save_failed", call.confirm);
    const heard = [...(call.provider?.spoken ?? []).slice((call.provider?.spoken ?? []).indexOf(call.summary?.text) + 1), call.after?.say ?? ""].filter(Boolean);
    evidence("goodbyeHeard", heard);
    check("the worker heard a goodbye after the failed save", heard.length > 0, { spoken: call.provider?.spoken?.slice(-2), after: call.after });
    check("the goodbye says nothing was saved / the save could not be confirmed", heard.some((line) => /(ما انحفظ|ما قدرت أتأكد من حفظ|لم يُحفظ|ما تم الحفظ|ما حفظت)/.test(line)), heard);
    check("the goodbye never claims it was saved", !heard.some((line) => /(انحفظ التقرير|تم الحفظ|حفظت التحديث)/.test(line) && !/ما /.test(line)), heard);
    check("the goodbye is accurate: a save failure, not a connection/internet excuse", heard.length > 0 && !heard.some((line) => CONNECTION_EXCUSE.test(line)), heard);
    const after = counts(farm, call.sid);
    evidence("counts", { before, after });
    check("NO report saved", after.reports === before.reports, { before, after });
    check("nothing half-saved: camels, resources, reports, answers, findings, tasks byte-identical", snapshot(farm) === snap);
    check("no worker_report outcome recorded", after.reportEvents === 0, after);
    const runRow = run(farm);
    evidence("run", runRow);
    check("the run ended without a report (not completed, no report_id, no retry due)", runRow && runRow.state !== "completed" && runRow.report_id === null && runRow.next_attempt_at === null, runRow);
    check("the voice_call_sessions row is removed", Number(sql(`select count(*) from voice_call_sessions where call_sid = ${q(call.sid)}`)) === 0);
    check("the stream closed", call.streamClosed === true);
  } finally {
    sql(`drop trigger if exists verify_natural_fail_report on public.reports; drop function if exists public.verify_natural_fail_report();`);
  }
}

/* ─────────────────── scenario 6: the owner changes the worker's number ─────────────────── */

const NEW_NUMBER = "+966500000177";
const OTHER_VALID = "+966500000166"; // typed, then edited away: never confirmed
const UNAPPROVED = "+966500000155"; // written straight to Postgres, never approved
const FILLER = "+966500000188"; // fills the local approved list to its limit
const OVER_LIMIT = "+966500000199";
const MAX_APPROVED_NUMBERS = 5; // src/server/calls/config.ts
const AUDIT_FILE = `${APPROVED_FILE.replace(/\.txt$/, "")}.audit.jsonl`;
const approvedList = () => (existsSync(APPROVED_FILE) ? readFileSync(APPROVED_FILE, "utf8").split("\n").map((line) => line.trim()).filter(Boolean) : []);
const auditLines = () => (existsSync(AUDIT_FILE) ? readFileSync(AUDIT_FILE, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
const masked = (number) => `${number.slice(0, 6)}•••••${number.slice(-3)}`;
const primaryPhone = (farm) => sql(`select w.phone from farms f join workers w on w.id = f.primary_worker_id where f.id = ${q(farm)}`);
const compact = (phone) => phone.replace(/[\s-]/g, "");
const runCount = (farm) => Number(sql(`select count(*) from report_call_runs where farm_id = ${q(farm)}`));

/** The primary worker's row in Settings → team, with its number shown and «تغيير الرقم» ready. */
async function teamRow(page) {
  await page.goto(`${ready.app}/ar/app/settings#settings-team`);
  const row = page.locator("#settings-team li").first();
  await row.getByRole("button", { name: "تغيير الرقم", exact: true }).waitFor({ timeout: 20_000 });
  return row;
}
/** The «ناقة بتتصل على … على هذا الرقم:» card (the row also holds a fieldset and a details, both role=group). */
const checkCard = (row) => row.locator('div[role="group"][aria-label^="ناقة بتتصل على"]');
async function typeNumber(row, local) {
  await row.getByRole("button", { name: "تغيير الرقم", exact: true }).click();
  await row.locator('input[type="tel"]').fill(local);
}

async function scenarioNumberChange(browser) {
  section(6, "Number change: Settings → consent → saved + approved, no call; the Dashboard then calls exactly the new number");
  const farm = seedRanch();
  const plan = ensurePlan(farm);
  evidence("farm", farm);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-SA" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.route("**/api/report-call-now?preflight=1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ready: true, checks: [], message: null }) }));
  try {
    await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: BASE });
    const approvedAtStart = approvedList();
    evidence("approvedAtStart", approvedAtStart.map(masked));
    check("pre: the new number is not approved yet", !approvedAtStart.includes(NEW_NUMBER), approvedAtStart.map(masked));
    check("pre: the worker's saved number is the old one", compact(primaryPhone(farm)) === WORKER, masked(compact(primaryPhone(farm))));
    const runsBefore = runCount(farm);
    const auditBefore = auditLines().length;
    await signIn(page);

    // a. Settings: «تغيير الرقم» → type → «احفظ الرقم» → full number + consent → «إيه، احفظه».
    let row = await teamRow(page);
    await typeNumber(row, "50 000 0177");
    await row.getByRole("button", { name: "احفظ الرقم", exact: true }).click();
    const card = checkCard(row);
    await card.waitFor({ timeout: 5_000 });
    const cardText = await card.innerText();
    evidence("aCard", cardText.replace(/0177/g, "•177"));
    check("a. the check card shows the full new number", /\+966 50 000 0177/.test(cardText.replace(/[⁦-⁩]/g, "")), cardText);
    check("a. the card shows the consent sentence", /صاحب الرقم موافق يستقبل مكالمات تجريبية من ناقة/.test(cardText), cardText);
    const confirmButton = card.getByRole("button", { name: "إيه، احفظه", exact: true });
    check("a. «إيه، احفظه» is DISABLED before consent", await confirmButton.isDisabled());
    await card.getByRole("checkbox").check();
    check("a. «إيه، احفظه» is enabled once the box is ticked", await confirmButton.isEnabled());
    await page.screenshot({ path: join(OUT, "number-change-consent.png"), fullPage: false });
    await confirmButton.click();
    const stored = await waitFor(() => { const phone = primaryPhone(farm); return compact(phone) === NEW_NUMBER ? phone : null; }, "workers.phone to change", 15_000).catch(() => null);
    evidence("aStoredPhone", stored && stored.replace(/0177$/, "•177"));
    check("a. workers.phone in Postgres is the new number (stored as formatted «+966 50 000 0177»)", stored !== null, masked(compact(primaryPhone(farm))));
    check("a. the stored form normalizes to the dialable +966500000177", stored !== null && compact(stored) === NEW_NUMBER);
    check("a. Settings says it was saved", await row.getByRole("status").filter({ hasText: "انحفظ" }).isVisible().catch(() => false));
    const approvedAfterA = approvedList();
    check("a. the new number is now in approved-numbers.txt", approvedAfterA.includes(NEW_NUMBER), approvedAfterA.map(masked));
    const newAudit = auditLines().slice(auditBefore);
    evidence("aAudit", newAudit);
    check("a. one audit line: consent true, this farm, number masked (never in full)", newAudit.length === 1 && newAudit[0].consent === true && newAudit[0].farm === farm && newAudit[0].number === masked(NEW_NUMBER)
      && !readFileSync(AUDIT_FILE, "utf8").includes(NEW_NUMBER), newAudit);

    // b. Saving placed no call.
    await sleep(1500);
    check("b. no new report_call_runs row", runCount(farm) === runsBefore, { before: runsBefore, after: runCount(farm) });
    check("b. mock Twilio received no request", (await mockState()).requests.length === 0, (await mockState()).requests.map((r) => masked(r.To)));

    // c. «تعديل» back to typing, an invalid number can't be saved, cancel keeps the saved one.
    row = await teamRow(page);
    await typeNumber(row, "50 000 0166");
    await row.getByRole("button", { name: "احفظ الرقم", exact: true }).click();
    await checkCard(row).getByRole("button", { name: "تعديل", exact: true }).click();
    const input = row.locator('input[type="tel"]');
    check("c. «تعديل» returns to the number field", await input.isVisible());
    await input.fill("12345");
    check("c. an invalid number (12345): «احفظ الرقم» is disabled", await row.getByRole("button", { name: "احفظ الرقم", exact: true }).isDisabled());
    await row.getByRole("button", { name: "إلغاء", exact: true }).click();
    const shown = (await row.innerText()).replace(/[⁦-⁩]/g, "");
    check("c. cancel shows the saved number again", /\+966 50 000 0177/.test(shown), shown.slice(0, 200));
    await sleep(1500);
    check("c. Postgres still has the new number", compact(primaryPhone(farm)) === NEW_NUMBER, masked(compact(primaryPhone(farm))));
    check("c. the edited-away number was never approved", !approvedList().includes(OTHER_VALID) && auditLines().length === auditBefore + 1);

    // f. A number written without approval (an old or onboarding save) can't be called.
    sql(`update workers set phone = ${q(UNAPPROVED)} where id = (select primary_worker_id from farms where id = ${q(farm)}); update farms set revision = revision + 1 where id = ${q(farm)}`);
    await page.goto(`${ready.app}/ar/app`);
    const dashButton = page.getByRole("button", { name: "اتصال حقيقي", exact: true });
    await dashButton.waitFor({ timeout: 20_000 });
    const reasonText = await waitFor(async () => { const text = await page.locator("#call-now-reason").innerText().catch(() => ""); return /مو معتمد/.test(text) ? text : null; }, "the not-approved reason", 15_000).catch(() => page.locator("#call-now-reason").innerText().catch(() => ""));
    evidence("fReason", reasonText);
    check("f. the Dashboard says the saved number is not approved", /مو معتمد/.test(reasonText), reasonText);
    check("f. the reason lists approved numbers masked only", !/0177|0001/.test(reasonText.replace(/[⁦-⁩]/g, "").replace(/\s/g, "")) && /•••••/.test(reasonText), reasonText);
    check("f. «اتصال حقيقي» is disabled", await dashButton.isDisabled());
    await page.screenshot({ path: join(OUT, "number-change-not-approved.png"), fullPage: false });
    const refused = await callViaApi(await demoCookie());
    evidence("fApi", refused.json);
    check("f. the callNow op itself refuses (not_allowed), no run opened, no Twilio request", refused.json?.data?.status === "blocked" && refused.json.data.reason === "not_allowed"
      && runCount(farm) === runsBefore && (await mockState()).requests.length === 0, { api: refused.json, runs: runCount(farm) });
    sql(`update workers set phone = ${q(stored ?? "+966 50 000 0177")} where id = (select primary_worker_id from farms where id = ${q(farm)}); update farms set revision = revision + 1 where id = ${q(farm)}`);

    // d. The Dashboard calls exactly the new number, and the natural call saves one report.
    const reportsBefore = counts(farm).reports;
    await page.goto(`${ready.app}/ar/app`);
    await dashButton.waitFor({ timeout: 20_000 });
    const enabled = await waitFor(async () => dashButton.isEnabled(), "«اتصال حقيقي» to be enabled", 20_000).catch(() => false);
    check("d. «اتصال حقيقي» is enabled for the approved new number", enabled, await page.locator("#call-now-reason").innerText().catch(() => null));
    await dashButton.click();
    const dialog = page.getByRole("dialog");
    const dialogText = (await dialog.innerText()).replace(/[⁦-⁩]/g, "");
    evidence("dDialog", dialogText.replace(/0177/g, "•177"));
    check("d. the dialog shows the new destination (…177), not the old one", /\+966 50 000 0177/.test(dialogText) && !/0001/.test(dialogText), dialogText.replace(/0177/g, "•177"));
    await dialog.getByRole("button", { name: "اتصل الآن", exact: true }).click();
    await waitFor(async () => (await mockState()).requests.length > 0, "the call to reach mock Twilio", 20_000);
    const state = await finishedCall();
    await sleep(1000);
    const finalState = await mockState();
    const tos = finalState.requests.map((request) => request.To);
    evidence("dTwilioTo", tos.map(masked));
    check("d. mock Twilio got exactly ONE call, To +966500000177", tos.length === 1 && tos[0] === NEW_NUMBER, tos.map(masked));
    check("d. the old number (+966500000001) was never dialled", !tos.includes(WORKER));
    const call = state.calls[0];
    writeFileSync(join(OUT, "natural-number-change-call.json"), JSON.stringify(call, null, 2));
    check("d. the natural call ran: submit_report then confirm_report saved", call.finished && !call.error && JSON.stringify(call.toolResults.map((entry) => entry.name)) === JSON.stringify(["submit_report", "confirm_report"]) && call.confirm?.output?.status === "saved", { error: call.error, tools: call.toolResults?.map((entry) => entry.name), confirm: call.confirm?.output });
    check("d. only the ranch's enabled topics were asked", JSON.stringify((call.scenarioLog?.asked ?? []).filter((item) => item.kind !== "task").map((item) => item.id).filter((id) => !id.startsWith("open_note_"))) === JSON.stringify(["herd_health", "feed_level", "water_level", "fences_condition", plan.other]));
    const runRow = run(farm);
    evidence("dRun", runRow);
    check("d. exactly ONE new report, run completed, manual, linked", counts(farm).reports === reportsBefore + 1 && runRow?.state === "completed" && runRow.trigger === "manual" && Boolean(runRow.report_id), { reports: counts(farm).reports, reportsBefore, runRow });
    const attempts = json(`select coalesce(json_agg(a), '[]') from report_call_runs r, jsonb_array_elements(r.attempts) a where r.id = ${q(runRow?.id)}`) ?? [];
    evidence("dAttempts", attempts);

    // e. Previously approved numbers stay approved; a new one beyond the limit is refused and nothing is saved.
    const list = approvedList();
    check("e. earlier approved numbers are still approved (…001, …002, …010) next to …177", [WORKER, "+966500000002", "+966500000010", NEW_NUMBER].every((number) => list.includes(number)), list.map(masked));
    const filled = [...list];
    for (const filler of [FILLER, "+966500000187", "+966500000186"]) if (filled.length < MAX_APPROVED_NUMBERS && !filled.includes(filler)) filled.push(filler);
    writeFileSync(APPROVED_FILE, `${filled.join("\n")}\n`, { mode: 0o600 });
    evidence("eFilled", filled.map(masked));
    check(`e. pre: the local approved list is full (${MAX_APPROVED_NUMBERS})`, approvedList().length === MAX_APPROVED_NUMBERS, approvedList().length);
    const auditBeforeE = auditLines().length;
    row = await teamRow(page);
    await typeNumber(row, "50 000 0199");
    await row.getByRole("button", { name: "احفظ الرقم", exact: true }).click();
    await checkCard(row).getByRole("checkbox").check();
    await checkCard(row).getByRole("button", { name: "إيه، احفظه", exact: true }).click();
    const alert = await waitFor(async () => { const text = await row.getByRole("alert").innerText().catch(() => ""); return text || null; }, "the limit message", 10_000).catch(() => "");
    evidence("eAlert", alert);
    await page.screenshot({ path: join(OUT, "number-change-limit.png"), fullPage: false });
    check("e. the limit message «…للحد الأعلى… ما انحفظ شي» is shown", /حد الأعلى/.test(alert) && /ما انحفظ شي/.test(alert), alert);
    await sleep(2000);
    check("e. nothing saved: Postgres keeps …177", compact(primaryPhone(farm)) === NEW_NUMBER, masked(compact(primaryPhone(farm))));
    check("e. nothing approved: the list is unchanged and has no …199", JSON.stringify(approvedList()) === JSON.stringify(filled) && !approvedList().includes(OVER_LIMIT), approvedList().map(masked));
    check("e. no audit line for the refused number", auditLines().length === auditBeforeE);
    // A number approved before can still be chosen at the limit.
    await row.getByRole("button", { name: "إلغاء", exact: true }).click().catch(async () => { await checkCard(row).getByRole("button", { name: "تعديل", exact: true }).click(); await row.getByRole("button", { name: "إلغاء", exact: true }).click(); });
    row = await teamRow(page);
    await typeNumber(row, "50 000 0002");
    await row.getByRole("button", { name: "احفظ الرقم", exact: true }).click();
    await checkCard(row).getByRole("checkbox").check();
    await checkCard(row).getByRole("button", { name: "إيه، احفظه", exact: true }).click();
    const back = await waitFor(() => compact(primaryPhone(farm)) === "+966500000002", "the earlier number to save", 15_000).catch(() => false);
    check("e. an already-approved number (…002) can still be saved at the limit", back && approvedList().length === MAX_APPROVED_NUMBERS, { phone: masked(compact(primaryPhone(farm))), list: approvedList().map(masked) });
    check("e. still no Twilio request beyond the one call in d", (await mockState()).requests.length === 1, (await mockState()).requests.length);

    // The browser logs the refused approval in e (409 from /api/test-number) as a console error: expected, once.
    const expected = errors.filter((line) => /status of 409/.test(line));
    const unexpected = errors.filter((line) => !/status of 409/.test(line));
    evidence("browserErrors", errors);
    check("the only console error is the one expected 409 from the refused approval in e", expected.length === 1 && unexpected.length === 0, errors);
  } finally {
    // Leave the approved list as the runner wrote it plus …177, so a later scenario is not at the limit.
    const keep = approvedList().filter((number) => ![FILLER, "+966500000187", "+966500000186"].includes(number));
    writeFileSync(APPROVED_FILE, `${keep.join("\n")}\n`, { mode: 0o600 });
    await context.close();
  }
}

/* ─────────────────── scenario 7: «اتصال حقيقي» rate limit ─────────────────── */

async function scenarioRateLimit() {
  section(7, "Rate limit: 3 placed calls an hour per ranch, the 4th is refused before Twilio");
  const farm = seedRanch();
  ensurePlan(farm);
  await control({ reset: true, outcome: "no-answer", twilioError: null, dwellMs: 100, natural: null });
  const cookie = await demoCookie();
  const results = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const placed = await callViaApi(cookie);
    results.push(placed.json?.data ?? placed);
    await waitFor(async () => (await mockState()).calls.filter((entry) => entry.finished).length >= attempt, `call ${attempt} to end`, 30_000).catch(() => {});
    await waitFor(() => !["calling", "queued", "ringing", "in_progress"].includes(run(farm)?.state), `run ${attempt} to end`, 15_000).catch(() => {});
    await sleep(500);
  }
  const fourth = await callViaApi(cookie);
  results.push(fourth.json?.data ?? fourth);
  evidence("results", results);
  evidence("runs", json(`select json_agg(state order by created_at) from report_call_runs where farm_id = ${q(farm)}`));
  check("calls 1–3 were placed (each unanswered, so nothing blocks the next)", results.slice(0, 3).every((result) => result.status === "placed"), results);
  check("the 4th within the hour is refused: rate_limited", fourth.json?.data?.status === "blocked" && fourth.json.data.reason === "rate_limited", fourth.json);
  const requests = (await mockState()).requests;
  check("mock Twilio received exactly 3 requests, all to the worker", requests.length === 3 && requests.every((request) => request.To === WORKER), requests.map((request) => masked(request.To)));
  check("no 4th run was opened", runCount(farm) === 3, runCount(farm));
}

/* ─────────────────── scenario 8: repeat demo calls ─────────────────── */

/** Report #2 differs from #1: feed about half («متوسط»), a new note for مزون and new words for «فيه شي ثاني». */
const SECOND = {
  ...BASE,
  say: "مزون أحسن شوي بس للحين تعبانة، ووضحة ما تاكل زين، والباقي بخير. العلف نص، الماي يكفي، ما فيه شي خربان، وجبت تبن اليوم",
  answers: {
    ...BASE.answers,
    herd_health: { ...BASE.answers.herd_health, camels: [{ name: "مزون", status: "sick", note: "مزون أحسن شوي بس للحين تعبانة" }, BASE.answers.herd_health.camels[1]] },
    feed_level: { value: "medium" },
    custom: { text: "جبت تبن اليوم" },
  },
};
const ALREADY = "تقرير هذي الفترة وصل";
const reportAnswers = (report) => json(`select coalesce(json_agg(row_to_json(a) order by a.sort_order), '[]') from (select question_id, answer, answer_ar, certainty, sort_order from report_answers where report_id = ${q(report)}) a`) ?? [];

/** Opens the Dashboard and returns the button, its reason line and the owner's GET /api/report-call-now detail. */
async function dashboardCallState(page) {
  const detail = page.waitForResponse((response) => /\/api\/report-call-now$/.test(new URL(response.url()).pathname) && !response.url().includes("preflight") && response.request().method() === "GET", { timeout: 20_000 })
    .then((response) => response.json()).catch(() => null);
  await page.goto(`${ready.app}/ar/app`);
  const button = page.getByRole("button", { name: "اتصال حقيقي", exact: true });
  await button.waitFor({ timeout: 20_000 });
  const body = await detail;
  await sleep(2500); // the component asks once more after 2 s
  const reason = await page.locator("#call-now-reason").innerText().catch(() => "");
  return { button, body, reason, enabled: await button.isEnabled() };
}

async function scenarioRepeat(browser) {
  section(8, "Repeat demo call: the presentation ranch takes a second report call today; other ranches and limits unchanged");
  // The ranch first, then a runner restart, so its new id is on the runner's repeat list (computed at start).
  const farm = seedRanch();
  const plan = ensurePlan(farm);
  evidence("farm", farm);
  const open = await stopRunner();
  check("the runner stopped before the restart", open.length === 0, open);
  await startRunner({ restart: true });
  const log = readFileSync(join(OUT, "natural-report-runner-repeat.log"), "utf8");
  evidence("runnerRepeatLine", log.match(/Repeat demo calls:[^\n]*/)?.[0] ?? null);
  check("the restarted runner put one presentation ranch on the repeat list", /Repeat demo calls: on for 1 presentation ranch/.test(log), log.match(/Repeat demo calls:[^\n]*/)?.[0]);
  check("the restart kept the data: the same ranch id, the test ranch still there", sql(`select id from farms where name = ${q(RANCH)}`) === farm && sql(`select count(*) from farms where id = ${q(TEST_FARM)}`) === "1");

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-SA" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.route("**/api/report-call-now?preflight=1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ready: true, checks: [], message: null }) }));
  try {
    // a. Report #1 from the Dashboard.
    await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: BASE });
    await signInAfterStart(page);
    let state = await dashboardCallState(page);
    evidence("aBefore", { detail: state.body, reason: state.reason });
    check("a. before any report: «اتصال حقيقي» enabled and GET says repeatReports true", state.enabled && state.body?.repeatReports === true, { enabled: state.enabled, body: state.body, reason: state.reason });
    await state.button.click();
    await page.getByRole("dialog").getByRole("button", { name: "اتصل الآن", exact: true }).click();
    await waitFor(async () => (await mockState()).requests.length > 0, "call 1 to reach mock Twilio", 20_000);
    const first = (await finishedCall()).calls[0];
    writeFileSync(join(OUT, "natural-repeat-call-1.json"), JSON.stringify(first, null, 2));
    check("a. call 1 ran: submit_report then confirm_report saved", first.finished && !first.error && first.confirm?.output?.status === "saved"
      && JSON.stringify(first.toolResults.map((entry) => entry.name)) === JSON.stringify(["submit_report", "confirm_report"]), { error: first.error, confirm: first.confirm?.output });
    const run1 = run(farm);
    const todayReports = () => json(`select coalesce(json_agg(row_to_json(r) order by r.at), '[]') from (select id, at, call_id from reports where farm_id = ${q(farm)}
      and (at at time zone 'Asia/Riyadh')::date = (now() at time zone 'Asia/Riyadh')::date) r`) ?? [];
    check("a. report #1 saved today, run completed and linked", todayReports().length === 1 && run1?.state === "completed" && run1.report_id === todayReports()[0]?.id, { reports: todayReports(), run1 });
    const report1 = run1?.report_id;
    const answers1 = reportAnswers(report1);
    const answers1Text = JSON.stringify(answers1);

    // b. Still callable on the Dashboard after today's report.
    state = await dashboardCallState(page);
    evidence("bAfterReport1", { detail: state.body, reason: state.reason });
    await page.screenshot({ path: join(OUT, "natural-repeat-after-report-1.png"), fullPage: true });
    check("b. GET /api/report-call-now has repeatReports true", state.body?.ok === true && state.body.repeatReports === true, state.body);
    check("b. «اتصال حقيقي» is STILL enabled after report #1", state.enabled, state.reason);
    check(`b. no «${ALREADY}» reason on the Dashboard`, !state.reason.includes(ALREADY) && !(await page.locator("body").innerText()).includes(ALREADY), state.reason);

    // c. Report #2 from the Dashboard; meanwhile a second press is refused as in progress (f).
    await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: SECOND });
    await state.button.click();
    await page.getByRole("dialog").getByRole("button", { name: "اتصل الآن", exact: true }).click();
    await waitFor(async () => (await mockState()).requests.length > 0, "call 2 to reach mock Twilio", 20_000);
    const runState = run(farm)?.state;
    const during = await callViaApi(await demoCookie());
    evidence("fDuring", { api: during.json, runStateWhenAsked: runState });
    check("f. a call while call 2 is live is refused: in_progress, no Twilio request", during.json?.data?.status === "blocked" && during.json.data.reason === "in_progress", { api: during.json, runState });
    const stateAfter2 = await finishedCall();
    const second = stateAfter2.calls[0];
    writeFileSync(join(OUT, "natural-repeat-call-2.json"), JSON.stringify(second, null, 2));
    const tos = stateAfter2.requests.map((request) => request.To);
    check("c. mock Twilio got exactly ONE more request, to the saved worker number", tos.length === 1 && tos[0] === WORKER && compact(primaryPhone(farm)) === WORKER, tos.map(masked));
    callBasics(second, plan.other);
    check("c. call 2 ran: submit_report then confirm_report saved", second.finished && !second.error && second.confirm?.output?.status === "saved"
      && JSON.stringify(second.toolResults.map((entry) => entry.name)) === JSON.stringify(["submit_report", "confirm_report"]), { error: second.error, confirm: second.confirm?.output });
    check("c. the goodbye says it was saved", SAVED_WORDS.test((second.provider?.spoken ?? []).at(-1) ?? ""), second.provider?.spoken?.slice(-1));
    const reports = todayReports();
    const runs = json(`select coalesce(json_agg(row_to_json(r) order by r.created_at), '[]') from (select id, state, report_id, trigger, created_at from report_call_runs where farm_id = ${q(farm)}) r`) ?? [];
    const callRows = json(`select coalesce(json_agg(row_to_json(c) order by c.at), '[]') from (select id, kind, outcome, report_id, at from calls where farm_id = ${q(farm)}
      and (at at time zone 'Asia/Riyadh')::date = (now() at time zone 'Asia/Riyadh')::date) c`) ?? [];
    evidence("cReports", reports);
    evidence("cRuns", runs);
    evidence("cCalls", callRows);
    check("c. Postgres: 2 reports today for this ranch, different ids", reports.length === 2 && reports[0].id !== reports[1].id && reports[0].id === report1, reports);
    check("c. 2 report_call_runs, both completed, manual, each linked to its own report", runs.length === 2 && runs.every((r) => r.state === "completed" && r.trigger === "manual")
      && runs[0].report_id === reports[0]?.id && runs[1].report_id === reports[1]?.id, runs);
    check("c. 2 completed calls rows today, each linked to its own report", callRows.length === 2 && callRows.every((c) => c.outcome === "completed")
      && callRows[0].report_id === reports[0]?.id && callRows[1].report_id === reports[1]?.id, callRows);
    check("c. report #1's answers are unchanged (nothing deleted or overwritten)", JSON.stringify(reportAnswers(report1)) === answers1Text, { before: answers1, after: reportAnswers(report1) });
    const answers2 = reportAnswers(reports[1]?.id);
    evidence("cAnswers", { first: answers1, second: answers2 });
    const feedOf = (rows) => rows.find((row) => row.question_id === "feed_level");
    check("c. report #1 says feed low, report #2 says feed about half («متوسط»)", feedOf(answers1)?.answer === "Running low" && feedOf(answers2)?.answer === "About half" && /متوسط/.test(feedOf(answers2)?.answer_ar ?? ""), { first: feedOf(answers1), second: feedOf(answers2) });
    check("c. report #2 keeps the worker's new words for «فيه شي ثاني»", answers2.find((row) => row.question_id === plan.other)?.answer === SECOND.answers.custom.text, answers2.find((row) => row.question_id === plan.other));
    check("c. resources.feed is now medium (from report #2)", sql(`select level from resources where farm_id = ${q(farm)} and kind = 'feed'`) === "medium");

    // d. The Dashboard shows the latest report; the Calls page lists both.
    await page.goto(`${ready.app}/ar/app`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(1500);
    await page.screenshot({ path: join(OUT, "natural-repeat-dashboard.png"), fullPage: true });
    const dash = await page.locator("body").innerText();
    evidence("dDashboard", dash.slice(0, 3000));
    check("d. the Dashboard shows report #2's feed («متوسط») and not report #1's («قارب على النفاد»)", dash.includes(feedOf(answers2)?.answer_ar ?? "∅") && !dash.includes("قارب على النفاد"),
      dash.split("\n").filter((line) => /العلف|متوسط|قارب/.test(line)).slice(0, 6));
    check("d. the Dashboard shows report #2's note for مزون", /مزون أحسن شوي بس للحين تعبانة/.test(dash), dash.match(/مزون[^\n]*/g)?.slice(0, 5));
    await page.goto(`${ready.app}/ar/app/calls`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(1500);
    await page.screenshot({ path: join(OUT, "natural-repeat-calls.png"), fullPage: true });
    const calls = await page.locator("body").innerText();
    const today = sql("select to_char(now() at time zone 'Asia/Riyadh', 'FMDD')");
    const card = calls.split(/\n(?=(?:السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)، )/).find((block) => new RegExp(`^(?:السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)، ${today} `).test(block)) ?? "";
    evidence("dTodayCard", card.slice(0, 1200));
    check("d. the Calls page lists both of today's report calls", (card.match(/اعرض التقرير/g) ?? []).length === 2 && (card.match(/انحفظ التقرير/g) ?? []).length === 2, card.slice(0, 800));
    check("d. both calls' notes are there (report #1 and report #2)", /مزون للحين تعبانة/.test(card) && /مزون أحسن شوي بس للحين تعبانة/.test(card), card.slice(0, 800));

    // f. The hourly limit still applies: call 3 (unanswered) is placed, call 4 is refused before Twilio.
    await control({ reset: true, outcome: "no-answer", twilioError: null, dwellMs: 100, natural: null });
    const cookie = await demoCookie();
    const third = await callViaApi(cookie);
    await waitFor(async () => (await mockState()).calls.some((entry) => entry.finished), "call 3 to end", 30_000).catch(() => {});
    await waitFor(() => !["calling", "queued", "ringing", "in_progress", "answered"].includes(run(farm)?.state), "run 3 to end", 15_000).catch(() => {});
    await sleep(500);
    const fourth = await callViaApi(cookie);
    evidence("fLimit", { third: third.json, fourth: fourth.json });
    check("f. call 3 within the hour is placed", third.json?.data?.status === "placed", third.json);
    check("f. call 4 within the hour is refused: rate_limited, no 4th Twilio request or run", fourth.json?.data?.status === "blocked" && fourth.json.data.reason === "rate_limited"
      && (await mockState()).requests.length === 1 && runCount(farm) === 3, { api: fourth.json, requests: (await mockState()).requests.length, runs: runCount(farm) });
    // The Dashboard shows the refusal with its reason after a press.
    state = await dashboardCallState(page);
    let notice = "";
    if (state.enabled) {
      await state.button.click();
      await page.getByRole("dialog").getByRole("button", { name: "اتصل الآن", exact: true }).click();
      notice = await waitFor(async () => { const text = await page.getByRole("status").allInnerTexts().then((all) => all.join(" ")).catch(() => ""); return /حد المكالمات/.test(text) ? text : null; }, "the rate-limit notice", 15_000).catch(() => "");
      await page.screenshot({ path: join(OUT, "natural-repeat-rate-limited.png"), fullPage: false });
    }
    evidence("fNotice", notice);
    check("f. pressing «اتصال حقيقي» again shows a clear reason («…3 بالساعة و10 باليوم…»)", /3 بالساعة و10 باليوم/.test(notice), { enabled: state.enabled, reason: state.reason, notice });
    check("f. still no 4th Twilio request", (await mockState()).requests.length === 1 && runCount(farm) === 3, (await mockState()).requests.length);
    evidence("browserErrors", errors);
    check("no console errors or page errors on the demo ranch", errors.length === 0, errors);
  } finally {
    await context.close();
  }

  // e. A ranch NOT on the repeat list, with a report today, stays blocked.
  const testWorker = "+966500000002"; // approved, so the refusal can only be the period's report
  sql(`begin;
    update workers set phone = ${q(testWorker)} where id = (select primary_worker_id from farms where id = ${q(TEST_FARM)});
    with c as (insert into calls (farm_id, kind, direction, party, at, outcome, attempt, summary_ar, summary_en)
      values (${q(TEST_FARM)}, 'worker_report', 'outbound', 'worker', now() - interval '5 minutes', 'completed', 1, 'تقرير اليوم (تحقق)', 'Today''s report (verify)') returning id)
    insert into reports (farm_id, call_id, at, herd_count_reported) select ${q(TEST_FARM)}, id, now() - interval '5 minutes', 20 from c;
    update farms set last_update_at = now() - interval '5 minutes', revision = revision + 1 where id = ${q(TEST_FARM)};
    commit;`);
  const testRuns = runCount(TEST_FARM);
  await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: null });
  const testContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-SA" });
  const testPage = await testContext.newPage();
  try {
    await signInAfterStart(testPage, TESTER);
    const state = await dashboardCallState(testPage);
    await testPage.screenshot({ path: join(OUT, "natural-repeat-test-ranch-blocked.png"), fullPage: true });
    evidence("eTestRanch", { detail: state.body, reason: state.reason, enabled: state.enabled });
    check("e. test ranch: GET /api/report-call-now has repeatReports false", state.body?.ok === true && state.body.repeatReports === false, state.body);
    check(`e. test ranch: the Dashboard shows «${ALREADY}» and «اتصال حقيقي» is disabled`, state.reason.includes(ALREADY) && !state.enabled, state);
    const refused = await callViaApi(await demoCookie(TESTER));
    evidence("eApi", refused.json);
    check("e. test ranch: callNow returns blocked already_reported, no run, no Twilio request", refused.json?.data?.status === "blocked" && refused.json.data.reason === "already_reported"
      && runCount(TEST_FARM) === testRuns && (await mockState()).requests.length === 0, { api: refused.json, runs: runCount(TEST_FARM), requests: (await mockState()).requests.length });
  } finally {
    await testContext.close();
  }
}

/* ─────────────────── scenario 9: the feed amount ─────────────────── */

const FEED_QUESTION = "كم باقي من العلف عندكم؟";
const OLD_FEED_QUESTION = "كيف العلف، يكفي ولا ناقص؟";
const FEED_CASES = [
  { id: "a", words: "باقي 25 كيس", feed: { number: 25, unit: "كيس" } },
  { id: "b", words: "عندنا 10 بالات", feed: { number: 10, unit: "بالات" } },
  { id: "c", words: "باقي شوي", feed: { value: "low" } },
  { id: "d", words: "ما أدري", feed: { value: "unknown" } },
  // A number with no unit: one short question for the unit, then the worker's word, «ما أدري», or the number alone.
  { id: "e", words: "باقي 25", feed: { number: 25 }, clarify: [{ say: "أكياس", answers: { feed_level: { number: 25, unit: "أكياس" } } }], saved: ["25 أكياس", "25 bags"] },
  { id: "f", words: "باقي 25", feed: { number: 25 }, clarify: [{ say: "والله ما أدري", answers: { feed_level: { number: 25, unit: "unknown" } } }], saved: ["25 (الوحدة غير محددة)", "25 (unit not given)"] },
  { id: "g", words: "باقي 25", feed: { number: 25 }, clarify: [{ say: "خمسة وعشرين بس", answers: { feed_level: { number: 25 } } }, { say: "-", answers: {} }], saved: ["25 (الوحدة غير محددة)", "25 (unit not given)"] },
];

async function scenarioFeed(browser) {
  section(9, "Feed amount: «كم باقي من العلف عندكم؟», amount and unit kept, nothing invented");
  for (const feedCase of FEED_CASES) {
    const label = feedCase.id.toUpperCase();
    const farm = seedRanch();
    const plan = ensurePlan(farm);
    const say = BASE.say.replace("العلف ناقص شوي", feedCase.words);
    await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: { ...BASE, say, answers: { ...BASE.answers, feed_level: feedCase.feed }, unitClarifications: feedCase.clarify } });
    const placed = await callViaApi(await demoCookie());
    check(`${label}. callNow placed the call («${feedCase.words}»)`, placed.json?.data?.status === "placed", placed);
    const call = (await finishedCall()).calls[0];
    writeFileSync(join(OUT, `natural-feed-${feedCase.id}.json`), JSON.stringify(call, null, 2));
    callBasics(call, plan.other);
    check(`${label}. confirm_report returned saved`, call.confirm?.output?.status === "saved", call.confirm);
    if (feedCase.id === "a") check("A. the worker's words include «باقي 25 كيس»", say.includes("باقي 25 كيس"), say);
    const instructions = call.provider?.sessionUpdate?.instructions ?? "";
    check(`${label}. the model asks «${FEED_QUESTION}», not «${OLD_FEED_QUESTION}»`, instructions.includes(FEED_QUESTION) && !instructions.includes(OLD_FEED_QUESTION), instructions.match(/[^\n]*العلف[^\n]*/g)?.slice(0, 4));
    const submit = (call.provider?.sessionUpdate?.tools ?? []).find((tool) => tool.name === "submit_report");
    check(`${label}. submit_report's answer items accept a unit`, Boolean(submit?.parameters?.properties?.answers?.items?.properties?.unit), Object.keys(submit?.parameters?.properties?.answers?.items?.properties ?? {}));
    const runRow = run(farm);
    const feed = json(`select row_to_json(a) from (select answer, answer_ar, certainty, question_ar from report_answers where report_id = ${q(runRow?.report_id)} and question_id = 'feed_level') a`);
    const resource = json(`select row_to_json(r) from (select level, quantity, certainty from resources where farm_id = ${q(farm)} and kind = 'feed') r`);
    const summary = call.scenarioLog?.summaries?.at(-1)?.text ?? "";
    evidence(`${feedCase.id}Feed`, { answer: feed, resource, summary });
    check(`${label}. the feed answer keeps the question «${FEED_QUESTION}»`, feed?.question_ar === FEED_QUESTION, feed);
    const refusals = call.unitRefusals ?? [];
    evidence(`${feedCase.id}UnitRefusals`, refusals);
    if (feedCase.clarify) {
      check(`${label}. a number with no unit: the server asked for the unit exactly once (unit_missing on feed_level), nothing saved before`,
        refusals.length === 1 && JSON.stringify(refusals[0].questions) === JSON.stringify(["feed_level"]) && /وحدة|unit/.test(refusals[0].message ?? ""), refusals);
    } else {
      check(`${label}. no unit question was needed`, refusals.length === 0, refusals);
    }
    if (feedCase.saved) {
      const [ar, en] = feedCase.saved;
      check(`${label}. report_answers keeps «${ar}» / ${en} («كيس» never assumed)`, feed?.answer_ar === ar && feed?.answer === en, feed);
      check(`${label}. resources.feed: quantity «${ar}», level unknown, approximate`, resource?.quantity === ar && resource?.level === "unknown" && resource?.certainty === "approximate", resource);
      check(`${label}. the summary read to the worker says «${ar}»`, summary.includes(ar), summary);
    } else if (feedCase.id === "a" || feedCase.id === "b") {
      const [ar, en] = feedCase.id === "a" ? ["25 كيس", "25 bags"] : ["10 بالات", "10 bales"];
      check(`${label}. report_answers keeps «${ar}» / ${en}`, feed?.answer_ar === ar && feed?.answer === en, feed);
      check(`${label}. resources.feed: quantity «${ar}», level unknown (not guessed), approximate`, resource?.quantity === ar && resource?.level === "unknown" && resource?.certainty === "approximate", resource);
      check(`${label}. the summary read to the worker says «${ar}»`, summary.includes(ar), summary);
    } else if (feedCase.id === "c") {
      check("C. report_answers: Running low («قارب على النفاد»)", feed?.answer === "Running low" && /قارب على النفاد/.test(feed?.answer_ar ?? ""), feed);
      check("C. resources.feed: level low, no quantity, reported", resource?.quantity === null && resource?.level === "low" && resource?.certainty === "reported", resource);
      check("C. no number invented in the feed answer", !/[0-9٠-٩]/.test(feed?.answer_ar ?? ""), feed?.answer_ar);
    } else {
      check("D. resources.feed: level unknown, no quantity, certainty unknown", resource?.quantity === null && resource?.level === "unknown" && resource?.certainty === "unknown", resource);
      check("D. the feed answer is labelled unknown", feed?.certainty === "unknown", feed);
      check("D. no number invented in the feed answer", !/[0-9٠-٩]/.test(feed?.answer_ar ?? ""), feed?.answer_ar);
    }
    if (feedCase.id !== "a") continue;

    // A on screen: the Dashboard's feed line and today's card on the Calls page.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-SA" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    try {
      await signIn(page);
      await page.goto(`${ready.app}/ar/app`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1500);
      await page.screenshot({ path: join(OUT, "natural-feed-dashboard.png"), fullPage: true });
      const dash = await page.locator("body").innerText();
      const lines = dash.split("\n");
      const feedLines = lines.flatMap((line, index) => (line.includes("العلف") ? [`${line} ⏎ ${lines[index + 1] ?? ""}`] : []));
      evidence("aDashboardFeedLines", feedLines);
      check("A. the Dashboard shows «25 كيس»", dash.includes("25 كيس"), feedLines);
      check("A. the Dashboard's feed line doesn't say «غير معروف»", feedLines.length > 0 && !feedLines.some((line) => line.includes("غير معروف")), feedLines);
      await page.goto(`${ready.app}/ar/app/calls`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(1500);
      await page.screenshot({ path: join(OUT, "natural-feed-calls.png"), fullPage: true });
      const calls = await page.locator("body").innerText();
      const today = sql("select to_char(now() at time zone 'Asia/Riyadh', 'FMDD')");
      const card = calls.split(/\n(?=(?:السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)، )/).find((block) => new RegExp(`^(?:السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)، ${today} `).test(block)) ?? "";
      evidence("aTodayCard", card.slice(0, 800));
      check("A. today's call is on the Calls page with «اعرض التقرير»", /تقرير أحمد/.test(card) && /اعرض التقرير/.test(card), card.slice(0, 400));
      // The card lists only the important notes; the full report, with the supplies, opens from «اعرض التقرير».
      await page.getByRole("button", { name: "اعرض التقرير" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor({ timeout: 10_000 });
      const sheetText = await sheet.innerText();
      await page.screenshot({ path: join(OUT, "natural-feed-calls-report.png"), fullPage: false });
      evidence("aReportSheet", sheetText.slice(0, 1200));
      check("A. the report opened from the Calls page shows «25 كيس» for the feed", sheetText.includes("25 كيس") && !/العلف\s*\n?\s*غير معروف/.test(sheetText), sheetText.slice(0, 600));
    } finally {
      await context.close();
    }
    evidence("browserErrors", errors);
    check("A. no console errors or page errors (sign-in, Dashboard, Calls)", errors.length === 0, errors);
  }
}

/* ─────────────────── main ─────────────────── */

let happyEventDelta = null;
let exitCode = 1;
let browser = null;
try {
  await startRunner();
  browser = await chromium.launch();
  // --only 1,9: run just those scenarios (1 includes 5).
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",").map(Number) : null;
  const steps = [
    async () => {
      const happy = await scenarioHappy(browser);
      happyEventDelta = happy.report ? Number(sql(`select count(*) from events where farm_id = ${q(happy.farm)} and at >= ${q(happy.started)}::timestamptz`)) : null;
      await scenarioDisplay(browser, happy);
    },
    scenarioCorrection,
    scenarioDuplicates,
    scenarioFailedSave,
    () => scenarioNumberChange(browser),
    scenarioRateLimit,
    () => scenarioFeed(browser),
    () => scenarioRepeat(browser), // last: it restarts the runner
  ];
  const ids = [1, 2, 3, 4, 6, 7, 9, 8];
  for (const [index, step] of steps.entries()) {
    if (only && !only.includes(ids[index])) continue;
    try { await step(); } catch (error) {
      console.error(`  ERROR ${error.stack ?? error}`);
      if (current) { current.error = String(error.message ?? error); current.checks.push({ name: "scenario ran to the end", passed: false, detail: current.error }); }
    }
  }
  exitCode = results.some((entry) => entry.checks.some((item) => !item.passed)) ? 1 : 0;
} catch (error) {
  console.error(`\nERROR ${error.stack ?? error}`);
  results.push({ id: 0, title: "setup", checks: [{ name: "setup", passed: false, detail: String(error.message ?? error) }], evidence: {} });
} finally {
  await browser?.close().catch(() => {});
  const open = await stopRunner().catch(() => []);
  if (open.length) results.push({ id: 0, title: "teardown", checks: [{ name: "the runner stopped everything it started", passed: false, detail: open }], evidence: {} });
}

const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
results.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const rows = results.map((entry) => {
  const failed = entry.checks.filter((item) => !item.passed).length;
  const verdict = entry.error ? "ERROR" : failed ? "FAIL" : "PASS";
  return `${verdict.padEnd(6)} ${String(entry.id).padEnd(2)} ${entry.title}  [${entry.checks.length - failed}/${entry.checks.length}]`;
});
console.log(`\n=== verify-natural-report ===\n${rows.join("\n")}`);
for (const entry of results) for (const item of entry.checks.filter((c) => !c.passed)) console.log(`  FAIL ${entry.id}: ${item.name}`);
console.log("\nThis was a mock: fake Twilio, a scripted model and a local database. It proves wiring and saved data only, not the real model's Arabic or real telephony.");
writeFileSync(join(OUT, "natural-report.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`Results: ${join(OUT, "natural-report.json")}`);
process.exit(exitCode ?? 1);
