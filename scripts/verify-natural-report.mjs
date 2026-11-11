#!/usr/bin/env node
/**
 * LOCAL ONLY, free. Natural report calls on the presentation ranch «عزبة الوسم (عرض تجريبي)», end to end: real Next
 * routes, the real voice bridge and a disposable Postgres, with Twilio and the model replaced by loopback mocks
 * (scripts/mocks/test-call-twilio.mjs runs each call from a JSON scenario; see runNaturalScenario there).
 *
 *   NAQAH_TEST_CALL_ISOLATED=1 node scripts/verify-natural-report.mjs [--skip-build]
 *
 * Scenarios (each on a freshly seeded copy of the ranch, worker +966500000001, no report today):
 *   1 happy path, the worker's yes starting 300 ms before the summary's playback mark returns (placed from the
 *     Dashboard's «اتصال حقيقي» → «اتصل الآن» in Playwright)   5 the Dashboard and Calls page after scenario 1
 *   2 a correction after the summary   3 duplicate confirmations   4 a failed save (a test-only trigger refuses the
 *     report insert for that one ranch in the disposable database)
 *
 * Always run with NAQAH_TEST_CALL_ISOLATED=1 (ports +100, /tmp/naqah-test-call-iso), so the running demo is untouched.
 * A mock proves wiring only. It cannot prove the real model's Arabic or real telephony.
 * Results: /tmp/naqah-test-call-iso/verify/natural-report.json and screenshots there. Exit code 1 on any failure.
 */
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { GATEWAY, MOCK_ALLOWED, READY_FILE, ROOT } from "./test-call-local.mjs";

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

async function startRunner() {
  if (existsSync(READY_FILE)) throw new Error(`A runner already looks active (${READY_FILE}). Stop it first.`);
  runnerLog = openSync(join(OUT, "natural-report-runner.log"), "w");
  const args = [join(REPO, "scripts/test-call-local.mjs"), "--mock", "--report-path", "--natural", ...(flag("skip-build") ? ["--skip-build"] : [])];
  runner = spawn(process.execPath, args, { cwd: REPO, stdio: ["ignore", runnerLog, runnerLog], env: { ...process.env, NAQAH_TEST_CALL_ISOLATED: "1" } });
  await waitFor(() => {
    if (runner.exitCode !== null) throw Object.assign(new Error("runner exited"), { fatal: true });
    return existsSync(READY_FILE);
  }, "the runner", 420_000).catch((error) => { throw new Error(`The runner did not become ready (${error.message}); see ${join(OUT, "natural-report-runner.log")}`); });
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

async function demoCookie() {
  const session = await postJson(`${GATEWAY}/auth/v1/token?grant_type=password`, DEMO);
  if (session.status !== 200) throw new Error(`Could not sign in ${DEMO.email}: ${session.status}`);
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session.json)).toString("base64url")}`;
}

async function signIn(page) {
  await page.goto(`${ready.app}/ar/login?method=email`);
  await page.locator('input[name="email"]:visible').fill(DEMO.email);
  await page.locator('input[name="password"]:visible').fill(DEMO.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/ar/app"), { timeout: 30_000 });
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
  const asked = (call.scenarioLog?.asked ?? []).map((item) => item.id);
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

/* ─────────────────── main ─────────────────── */

let happyEventDelta = null;
let exitCode = 1;
let browser = null;
try {
  await startRunner();
  browser = await chromium.launch();
  const steps = [
    async () => {
      const happy = await scenarioHappy(browser);
      happyEventDelta = happy.report ? Number(sql(`select count(*) from events where farm_id = ${q(happy.farm)} and at >= ${q(happy.started)}::timestamptz`)) : null;
      await scenarioDisplay(browser, happy);
    },
    scenarioCorrection,
    scenarioDuplicates,
    scenarioFailedSave,
  ];
  for (const step of steps) {
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

const order = [1, 2, 3, 4, 5, 0];
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
