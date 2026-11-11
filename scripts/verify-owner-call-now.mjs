#!/usr/bin/env node
/**
 * LOCAL ONLY, free. The Dashboard's «العامل / المالك» owner call on the presentation ranch «عزبة الوسم (عرض تجريبي)», end
 * to end: real Next routes, the real voice bridge and a disposable Postgres, with Twilio and the model replaced by
 * loopback mocks (scripts/mocks/test-call-twilio.mjs; the owner's side is runOwnerConversation there).
 *
 *   NAQAH_TEST_CALL_ISOLATED=4 node scripts/verify-owner-call-now.mjs [--skip-build]
 *
 * The runner is started with --mock --report-path --natural --owner-approves --keep-data --repeat-demo-reports
 * --owner-call-now, then restarted after seeding so the ranch is on the repeat list (see verify-natural-report.mjs).
 *   1 the switch: «العامل» chosen by default; «المالك» with an unapproved owner number is disabled with the reason, and
 *     the callOwnerNow op refuses it with no run and no Twilio request
 *   2 the owner approves their own number in Settings: one confirmation, consent required, audit line, no call
 *   3 «العامل» (default) still places the worker's natural report call to the worker only, exactly as before
 *   4 «المالك» → the dialog names the owner and their number → one mock call to the owner's number only → the briefing
 *     of that report → one instruction → read-back → confirmed → task ticket → completed and on the Calls page;
 *     report call runs, reports and the worker untouched
 *   5 gates: a second press while the owner's phone rings is refused (call_live); an unanswered manual call ends
 *     missed with no retry; a call Twilio refuses is undone; the test ranch (not the presentation ranch) is refused
 * A mock proves wiring only. It cannot prove the real model's Arabic or real telephony.
 */
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APPROVED_FILE, GATEWAY, MOCK_ALLOWED, READY_FILE, ROOT, TESTER } from "./test-call-local.mjs";

if (!/^[1-5]$/.test(process.env.NAQAH_TEST_CALL_ISOLATED ?? "")) {
  console.error("Run with NAQAH_TEST_CALL_ISOLATED=1 (or 2–5): this verifier only uses an isolated stack.");
  process.exit(2);
}

const flag = (name) => process.argv.includes(`--${name}`);
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "verify");
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const DB = "naqah_test_call";
const ISOLATED = process.env.NAQAH_TEST_CALL_ISOLATED;
const SHIFT = Number(ISOLATED) * 100;
const PG_PORT = String(54350 + SHIFT);
const STOP_PORTS = [54350, 54351, 54352, 3310, 3311, 3313].map((port) => port + SHIFT);
const WORKER = MOCK_ALLOWED[0]; // +966500000001
const OWNER = "+966500000201"; // the presentation ranch's owner, فهد العتيبي (scripts/demo/presentation-ranch.ts)
const OWNER_NAME = "فهد العتيبي";
const DEMO = { email: "demo@naqah.demo", password: "naqah-demo-2026" };
const RANCH = "عزبة الوسم (عرض تجريبي)";
const AUDIT_FILE = `${APPROVED_FILE.replace(/\.txt$/, "")}.audit.jsonl`;
mkdirSync(OUT, { recursive: true });
if (GATEWAY !== `http://127.0.0.1:${54352 + SHIFT}`) throw new Error(`Unexpected gateway ${GATEWAY}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pgEnv = { PATH: `${PG_BIN}:${process.env.PATH}`, LC_ALL: "en_US.UTF-8", PGHOST: "127.0.0.1", PGPORT: PG_PORT, PGUSER: "postgres" };
const sql = (query) => execFileSync(join(PG_BIN, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], { input: query, encoding: "utf8", env: pgEnv, maxBuffer: 1 << 26 }).trim();
const json = (query) => JSON.parse(sql(query) || "null");
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const isolate = (text) => text.replace(/[⁦-⁩]/g, "");
const approvedList = () => (existsSync(APPROVED_FILE) ? readFileSync(APPROVED_FILE, "utf8").split("\n").map((line) => line.trim()).filter(Boolean) : []);
const auditLines = () => (existsSync(AUDIT_FILE) ? readFileSync(AUDIT_FILE, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
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

async function startRunner({ restart = false } = {}) {
  if (existsSync(READY_FILE)) throw new Error(`A runner already looks active (${READY_FILE}). Stop it first.`);
  if (!restart) {
    if (await portOpen(Number(PG_PORT))) throw new Error(`Port ${PG_PORT} is in use: another isolated stack is running.`);
    rmSync(join(ROOT, "pg"), { recursive: true, force: true });
  }
  const logName = restart ? "owner-call-runner-restart.log" : "owner-call-runner.log";
  runnerLog = openSync(join(OUT, logName), "w");
  const args = [join(REPO, "scripts/test-call-local.mjs"), "--mock", "--report-path", "--natural", "--owner-approves", "--keep-data", "--repeat-demo-reports", "--owner-call-now",
    ...(restart || flag("skip-build") ? ["--skip-build"] : [])];
  runner = spawn(process.execPath, args, { cwd: REPO, stdio: ["ignore", runnerLog, runnerLog], env: { ...process.env, NAQAH_TEST_CALL_ISOLATED: ISOLATED } });
  await waitFor(() => {
    if (runner.exitCode !== null) throw Object.assign(new Error("runner exited"), { fatal: true });
    return existsSync(READY_FILE);
  }, "the runner", 420_000).catch((error) => { throw new Error(`The runner did not become ready (${error.message}); see ${join(OUT, logName)}`); });
  ready = JSON.parse(readFileSync(READY_FILE, "utf8"));
  if (ready.app !== `http://127.0.0.1:${3311 + SHIFT}` || ready.provider !== `http://127.0.0.1:${3313 + SHIFT}`) throw new Error(`Not the isolated stack: ${JSON.stringify(ready)}`);
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

function seedRanch() {
  const seedArgs = [join(REPO, "scripts/demo/seed-presentation.mjs"), "--db", DB, "--gateway", GATEWAY];
  const env = { ...process.env, ...pgEnv };
  execFileSync(process.execPath, [...seedArgs, "--reset"], { cwd: REPO, env, stdio: "ignore" });
  const out = execFileSync(process.execPath, [...seedArgs, "--worker-phone", WORKER, "--end-yesterday"], { cwd: REPO, env, encoding: "utf8" });
  const farm = sql(`select id from farms where name = ${q(RANCH)}`);
  if (!/^[0-9a-f-]{36}$/.test(farm)) throw new Error(`The demo ranch was not seeded: ${out}`);
  return farm;
}

async function cookieFor(account) {
  const session = await postJson(`${GATEWAY}/auth/v1/token?grant_type=password`, account);
  if (session.status !== 200) throw new Error(`Could not sign in ${account.email}: ${session.status}`);
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session.json)).toString("base64url")}`;
}
const op = async (name, account = DEMO) => postJson(`${ready.app}/api/account`, { op: name }, { Origin: ready.app, Cookie: await cookieFor(account) });

async function signIn(page) {
  for (const path of ["/ar/login?method=email", "/ar/app", "/ar/app/calls", "/ar/app/settings"]) await fetch(`${ready.app}${path}`).catch(() => {});
  const attempt = async () => {
    await page.goto(`${ready.app}/ar/login?method=email`);
    await page.locator('input[name="email"]:visible').fill(DEMO.email);
    await page.locator('input[name="password"]:visible').fill(DEMO.password);
    await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/ar/app"), { timeout: 30_000 });
  };
  try { await attempt(); } catch { await attempt(); }
}

async function newPage(browser, errors) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-SA" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  // The free preflights ask the public bridge URL and OpenAI, which a mock stack can't reach; only they are stubbed.
  const fine = (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ready: true, checks: [], message: null }) });
  await page.route("**/api/report-call-now?preflight=1", fine);
  await page.route("**/api/owner-call-now?preflight=1", fine);
  return { context, page };
}

const ownerRun = (farm) => json(`select owner_call_run from farms where id = ${q(farm)}`);
const ownerPhone = (farm) => sql(`select owner_phone from farms where id = ${q(farm)}`);
/** Everything the worker's flow owns, as text, so "untouched" means byte-identical. */
const workerSide = (farm) => sql(`select concat_ws(E'\\n=====\\n',
  (select coalesce(string_agg(r::text, E'\\n' order by r::text), '') from report_call_runs r where farm_id = ${q(farm)}),
  (select coalesce(string_agg(r::text, E'\\n' order by r::text), '') from reports r where farm_id = ${q(farm)}),
  (select coalesce(string_agg(r::text, E'\\n' order by r::text), '') from workers r where farm_id = ${q(farm)}),
  (select coalesce(string_agg(r::text, E'\\n' order by r::text), '') from camels r where farm_id = ${q(farm)}),
  (select coalesce(string_agg(r::text, E'\\n' order by r::text), '') from resources r where farm_id = ${q(farm)}))`);

async function finishedCall(index = 0) {
  const state = await waitFor(async () => {
    const s = await mockState();
    return s.calls[index]?.finished ? s : null;
  }, "the mock call to finish", 120_000);
  await sleep(1500); // the final status callback and its writes
  return state;
}

/** The worker's base answers (scripts/verify-natural-report.mjs scenario 1): Mazoon sick, Wadha watched, feed low. */
const WORKER_REPORT = {
  say: "مزون للحين تعبانة، ووضحة ما تاكل زين، والباقي بخير. العلف ناقص شوي، الماي يكفي، ما فيه شي خربان، ولا فيه شي ثاني",
  answers: {
    herd_health: { value: "no", camels: [{ name: "مزون", status: "sick", note: "مزون للحين تعبانة" }, { name: "وضحة", status: "watch", note: "وضحة ما تاكل زين" }], rest_well: true },
    feed_level: { value: "low" }, water_level: { value: "good" }, fences_condition: { value: "good" },
    custom: { text: "لا ما فيه شي ثاني" }, task: { value: "no" }, weather_heat_day: { value: "unknown" },
  },
  confirm: { say: "كل شيء تمام، لا تعدل" },
};
const INSTRUCTION = { message: "يعزل مزون عن الحلال", kind: "task", due: "any_time", evidence: "يعزل مزون عن الحلال بأي وقت" };
const OWNER_SCRIPT = { owner: { say: "إيه، قل لأحمد يعزل مزون عن الحلال بأي وقت", items: [INSTRUCTION], confirm: "إيه احفظها" } };

/* ─────────────────── scenarios ─────────────────── */

const ownerSwitch = (page) => page.getByRole("radiogroup", { name: "ناقة تتصل على" });
const callButton = (page) => page.getByRole("button", { name: "اتصال حقيقي", exact: true });

async function scenarioSwitch(browser, farm) {
  section(1, "The switch: worker by default; «المالك» with an unapproved number is refused, in the UI and the op");
  const errors = [];
  const { context, page } = await newPage(browser, errors);
  try {
    check("pre: the owner's number is not approved", !approvedList().includes(OWNER), approvedList());
    await signIn(page);
    await page.goto(`${ready.app}/ar/app`);
    const radios = ownerSwitch(page);
    await radios.waitFor({ timeout: 20_000 });
    const worker = radios.getByRole("radio", { name: "العامل", exact: true });
    const owner = radios.getByRole("radio", { name: "المالك", exact: true });
    check("«العامل / المالك» is shown, «العامل» chosen", await worker.getAttribute("aria-checked") === "true" && await owner.getAttribute("aria-checked") === "false");
    const switchBox = await radios.boundingBox();
    const buttonBox = await callButton(page).boundingBox();
    check("the switch sits above «اتصال حقيقي»", switchBox && buttonBox && switchBox.y + switchBox.height <= buttonBox.y + 1, { switchBox, buttonBox });
    check("both options are at least 44px tall", (await worker.boundingBox()).height >= 44 && (await owner.boundingBox()).height >= 44);
    await page.screenshot({ path: join(OUT, "owner-switch-worker.png"), fullPage: false });
    await owner.click();
    const reason = await waitFor(async () => { const text = await page.locator("#owner-call-now-reason").innerText().catch(() => ""); return /مو معتمد/.test(text) ? text : null; }, "the not-approved reason", 15_000).catch(() => "");
    evidence("reason", reason);
    check("«المالك»: the reason says the owner's number isn't approved", /رقمك مو معتمد/.test(reason), reason);
    check("«المالك»: «اتصال حقيقي» is disabled", await callButton(page).isDisabled());
    await page.screenshot({ path: join(OUT, "owner-switch-not-approved.png"), fullPage: false });
    await worker.click();
    check("back to «العامل»: the worker's button is enabled again", await waitFor(async () => callButton(page).isEnabled(), "worker button", 15_000).catch(() => false));
  } finally { await context.close(); }
  const before = ownerRun(farm);
  const refused = await op("callOwnerNow");
  evidence("api", refused.json);
  check("the callOwnerNow op refuses: not_approved", refused.json?.ok === true && refused.json.data?.status === "blocked" && refused.json.data.reason === "not_approved", refused.json);
  check("no owner run opened and no Twilio request", JSON.stringify(ownerRun(farm)) === JSON.stringify(before) && (await mockState()).requests.length === 0);
  check("no console errors", errors.length === 0, errors);
}

async function scenarioApprove(browser, farm) {
  section(2, "The owner approves their own number in Settings: one confirmation, consent, audit, no call");
  const errors = [];
  const { context, page } = await newPage(browser, errors);
  try {
    const auditBefore = auditLines().length;
    await signIn(page);
    await page.goto(`${ready.app}/ar/app/settings#settings-ranch`);
    const ranch = page.locator("#settings-ranch section").first();
    const change = ranch.getByRole("button", { name: "تغيير الرقم", exact: true });
    await change.waitFor({ timeout: 20_000 });
    check("the owner's number shows with «تغيير الرقم»", /\+966 50 000 0201/.test(isolate(await ranch.innerText())));
    await change.click();
    await ranch.locator('input[type="tel"]').fill("50 000 0201");
    await ranch.getByRole("button", { name: "احفظ الرقم", exact: true }).click();
    const card = ranch.locator(`div[role="group"][aria-label^="ناقة بتتصل على ${OWNER_NAME}"]`);
    await card.waitFor({ timeout: 5_000 });
    const cardText = isolate(await card.innerText());
    check("the check card names the owner and shows the full number", cardText.includes(OWNER_NAME) && /\+966 50 000 0201/.test(cardText), cardText);
    check("the card asks for consent", /صاحب الرقم موافق يستقبل مكالمات تجريبية من ناقة/.test(cardText), cardText);
    const confirm = card.getByRole("button", { name: "إيه، احفظه", exact: true });
    check("«إيه، احفظه» is disabled before consent", await confirm.isDisabled());
    await card.getByRole("checkbox").check();
    await page.screenshot({ path: join(OUT, "owner-number-consent.png"), fullPage: false });
    await confirm.click();
    await ranch.getByRole("status").filter({ hasText: "انحفظ" }).waitFor({ timeout: 10_000 }).catch(() => {});
    check("Settings says it was saved", await ranch.getByRole("status").filter({ hasText: "انحفظ" }).isVisible().catch(() => false));
    check("the owner's number is now approved on this computer", approvedList().includes(OWNER), approvedList());
    const added = auditLines().slice(auditBefore);
    evidence("audit", added);
    check("one audit line: consent, this farm, the number masked", added.length === 1 && added[0].consent === true && added[0].farm === farm && added[0].number === "+96650•••••201"
      && !readFileSync(AUDIT_FILE, "utf8").includes(OWNER), added);
    await sleep(1500);
    check("farms.owner_phone is unchanged (same number, formatted)", ownerPhone(farm).replace(/[\s-]/g, "") === OWNER, ownerPhone(farm));
    check("approving placed no call", (await mockState()).requests.length === 0);
  } finally { await context.close(); }
  check("no console errors", errors.length === 0, errors);
}

async function scenarioWorker(browser, farm) {
  section(3, "«العامل» (default) still places the worker's natural report call, to the worker only");
  await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: WORKER_REPORT });
  const reportsBefore = Number(sql(`select count(*) from reports where farm_id = ${q(farm)}`));
  const ownerBefore = JSON.stringify(ownerRun(farm));
  const errors = [];
  const { context, page } = await newPage(browser, errors);
  try {
    await signIn(page);
    await page.goto(`${ready.app}/ar/app`);
    await ownerSwitch(page).waitFor({ timeout: 20_000 });
    check("«العامل» is chosen", await ownerSwitch(page).getByRole("radio", { name: "العامل", exact: true }).getAttribute("aria-checked") === "true");
    await waitFor(async () => callButton(page).isEnabled(), "«اتصال حقيقي»", 20_000);
    await callButton(page).click();
    const dialog = page.getByRole("dialog");
    const text = isolate(await dialog.innerText());
    check("the dialog is the worker's, unchanged («لأخذ التقرير»)", /لأخذ التقرير/.test(text) && /\+966 50 000 0001/.test(text), text);
    await dialog.getByRole("button", { name: "اتصل الآن", exact: true }).click();
  } finally { /* closed below */ }
  const state = await finishedCall();
  const call = state.calls[0];
  writeFileSync(join(OUT, "owner-scenario-worker-call.json"), JSON.stringify(call, null, 2));
  check("one Twilio request, to the worker, on the report route", state.requests.length === 1 && state.requests[0].To === WORKER && new URL(state.requests[0].Url).pathname === "/api/voice/outbound", state.requests.map((r) => [r.To, r.Url]));
  check("the call finished without a harness error, saved", call.finished && !call.error && call.confirm?.output?.status === "saved", call.error ?? call.confirm);
  check("exactly one new report", Number(sql(`select count(*) from reports where farm_id = ${q(farm)}`)) === reportsBefore + 1);
  const run = json(`select row_to_json(r) from (select state, trigger, report_id from report_call_runs where farm_id = ${q(farm)} order by created_at desc limit 1) r`);
  check("the report call run is manual and completed", run?.state === "completed" && run.trigger === "manual" && run.report_id, run);
  check("the owner's run was not touched by the worker's call", JSON.stringify(ownerRun(farm)) === ownerBefore);
  await context.close();
  check("no console errors", errors.length === 0, errors);
  return run?.report_id ?? null;
}

async function scenarioOwner(browser, farm, reportId) {
  section(4, "«المالك»: dialog names the owner → one call to the owner only → briefing → instruction → saved → Calls page");
  await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 200, natural: OWNER_SCRIPT });
  const workerBefore = workerSide(farm);
  const callsBefore = Number(sql(`select count(*) from calls where farm_id = ${q(farm)}`));
  const ticketsBefore = Number(sql(`select count(*) from task_tickets where farm_id = ${q(farm)}`));
  const started = sql("select now()");
  const errors = [];
  const { context, page } = await newPage(browser, errors);
  let placedFromUi = false;
  try {
    await signIn(page);
    await page.goto(`${ready.app}/ar/app`);
    await ownerSwitch(page).waitFor({ timeout: 20_000 });
    await ownerSwitch(page).getByRole("radio", { name: "المالك", exact: true }).click();
    const enabled = await waitFor(async () => callButton(page).isEnabled(), "«اتصال حقيقي» for the owner", 20_000).catch(() => false);
    check("«المالك»: «اتصال حقيقي» is enabled once the number is approved", enabled, await page.locator("#owner-call-now-reason").innerText().catch(() => null));
    await callButton(page).click();
    const dialog = page.getByRole("dialog");
    const text = isolate(await dialog.innerText());
    evidence("dialog", text);
    check("the dialog names the owner and their number, and says it is real", text.includes(OWNER_NAME) && /\+966 50 000 0201/.test(text) && /مكالمة حقيقية/.test(text) && !/لأخذ التقرير/.test(text), text);
    await page.screenshot({ path: join(OUT, "owner-call-dialog.png"), fullPage: false });
    await dialog.getByRole("button", { name: "اتصل الآن", exact: true }).click();
    await waitFor(async () => (await mockState()).requests.length > 0, "the owner call to reach mock Twilio", 20_000);
    placedFromUi = true;
    const notice = await page.getByRole("status").filter({ hasText: "ناقة تتصل على" }).innerText({ timeout: 5_000 }).catch(() => "");
    check("the Dashboard says NAQAH is calling the owner", notice.includes(OWNER_NAME), notice);
  } catch (error) {
    evidence("uiError", error.message);
    await page.screenshot({ path: join(OUT, "owner-call-ui-failure.png"), fullPage: true }).catch(() => {});
  }
  check("placed from the Dashboard's «المالك» → «اتصل الآن»", placedFromUi, current.evidence.uiError);
  const state = await finishedCall();
  const call = state.calls[0];
  writeFileSync(join(OUT, "owner-call.json"), JSON.stringify(call, null, 2));
  check("exactly one Twilio request, to the owner's approved number only", state.requests.length === 1 && state.requests[0].To === OWNER && !state.requests.some((r) => r.To === WORKER), state.requests.map((r) => r.To));
  const placedUrl = new URL(state.requests[0]?.Url ?? "http://x/");
  check("on the signed owner route, recording off", placedUrl.pathname === "/api/voice/owner" && placedUrl.searchParams.has("s") && state.requests[0].Record === "false"
    && new URL(state.requests[0].StatusCallback).pathname === "/api/voice/owner/status", state.requests[0]);
  check("the call finished without a harness error", call.finished && !call.error, call.error);
  check("the realtime session got the owner's tools", JSON.stringify(call.owner?.tools) === JSON.stringify(["propose_instructions", "no_instructions", "confirm_instructions", "correct_instruction", "remove_instruction", "repeat_or_clarify", "end_call"]), call.owner?.tools);
  const opening = call.owner?.opening ?? "";
  evidence("briefing", opening);
  check("the briefing was spoken first and is about this report (مزون, the feed)", /مزون/.test(opening) && /(العلف|الأعلاف)/.test(opening), opening);
  check("the briefing then asks for instructions", call.owner?.stepAtStart === "instruction_yesno", call.owner?.stepAtStart);
  const [proposed, confirmed] = call.owner?.steps ?? [];
  check("the instruction was taken and read back in full", proposed?.output?.status === "ok" && call.owner.review?.readInFull && /يعزل مزون/.test(call.owner.review?.text ?? ""), { proposed: proposed?.output, review: call.owner?.review });
  check("the owner's yes saved it", confirmed?.output?.status === "saved", confirmed?.output);
  check("the bridge closed the stream; /after only hangs up", call.streamClosed && call.after?.http === 200 && call.after.hangup && !call.after.speaks, call.after);

  const run = ownerRun(farm);
  evidence("ownerRun", run);
  check("owner_call_run: manual, completed, one attempt, the worker's new report", run?.trigger === "manual" && run.state === "completed" && run.attempts?.length === 1 && run.attempts[0].result === "completed" && run.reportId === reportId && run.nextAttemptAt === null, run);
  const rows = json(`select coalesce(json_agg(row_to_json(c) order by c.at), '[]') from (select kind, direction, party, outcome, report_id, summary_ar, at from calls where farm_id = ${q(farm)} and at >= ${q(started)}::timestamptz) c`);
  evidence("calls", rows);
  check("one calls row: the owner notification, completed, for that report", rows.length === 1 && rows[0].kind === "owner_notification" && rows[0].outcome === "completed" && rows[0].report_id === reportId
    && Number(sql(`select count(*) from calls where farm_id = ${q(farm)}`)) === callsBefore + 1, rows);
  const tickets = json(`select coalesce(json_agg(row_to_json(t)), '[]') from (select instruction, status, scheduled_for from task_tickets where farm_id = ${q(farm)} and created_at >= ${q(started)}::timestamptz) t`);
  evidence("tickets", tickets);
  check("Ultimate: the actionable instruction opened one task ticket, «any time»", tickets.length === 1 && /يعزل مزون/.test(tickets[0].instruction) && tickets[0].status === "open" && tickets[0].scheduled_for === null
    && Number(sql(`select count(*) from task_tickets where farm_id = ${q(farm)}`)) === ticketsBefore + 1, tickets);
  check("report call runs, reports, workers, camels and resources are byte-identical", workerSide(farm) === workerBefore);
  check("the voice session row is removed", Number(sql(`select count(*) from voice_call_sessions where call_sid = ${q(call.sid)}`)) === 0);
  check("NAQAH_CALL_OWNER is off: the scheduler would not call the owner (no scheduled owner run appeared)", ownerRun(farm)?.id === run?.id);

  try {
    await page.goto(`${ready.app}/ar/app/calls`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(1500);
    await page.screenshot({ path: join(OUT, "owner-call-calls-page.png"), fullPage: true });
    const text = await page.locator("body").innerText();
    evidence("callsPage", text.slice(0, 1500));
    // The owner's call is shown inside the report's card it briefed: «أنت · بلّغتك الساعة …».
    const today = sql("select to_char(now() at time zone 'Asia/Riyadh', 'FMDD')");
    const card = text.split(/\n(?=(?:السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)، )/).find((block) => new RegExp(`^(?:السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة)، ${today} `).test(block)) ?? "";
    evidence("todayCard", card.slice(0, 800));
    check("the Calls page shows the owner's briefing in today's report card («أنت · بلّغتك الساعة»)", /تقرير أحمد/.test(card) && /أنت\s*\n+\s*بلّغتك الساعة/.test(card), card.slice(0, 600));
  } finally { await context.close(); }
  check("no console errors", errors.length === 0, errors);
}

async function scenarioGates(farm) {
  section(5, "Gates: one call at a time, no retry when unanswered, a refused placement is undone, other ranches refused");
  const workerBefore = workerSide(farm);
  await control({ reset: true, outcome: "hold", twilioError: null, dwellMs: 100, natural: OWNER_SCRIPT });
  const first = await op("callOwnerNow");
  check("a. placed (held ringing)", first.json?.data?.status === "placed", first.json);
  await waitFor(async () => (await mockState()).requests.length === 1, "the held call", 10_000);
  const second = await op("callOwnerNow");
  check("a. a second press while it rings is refused: call_live, no second request", second.json?.data?.status === "blocked" && second.json.data.reason === "call_live" && (await mockState()).requests.length === 1, second.json);
  // The mock holds the call once it has sent «initiated»; release it only then.
  await waitFor(async () => (await postJson(`${ready.provider}/__test/release`, { status: "no-answer" })).status === 200, "the held call to be released", 15_000);
  await finishedCall();
  const missed = ownerRun(farm);
  evidence("missed", missed);
  check("b. unanswered: the manual run ends missed, one attempt, no retry", missed?.state === "missed" && missed.attempts.length === 1 && missed.attempts[0].result === "unanswered" && missed.nextAttemptAt === null, missed);
  check("b. a missed owner notification is recorded", sql(`select outcome from calls where farm_id = ${q(farm)} and kind = 'owner_notification' order by at desc limit 1`) === "no_answer");

  await control({ reset: true, outcome: "full", twilioError: 21215, dwellMs: 100, natural: OWNER_SCRIPT });
  const failed = await op("callOwnerNow");
  check("c. Twilio refuses: failed / not_placed", failed.json?.data?.status === "failed" && failed.json.data.reason === "not_placed", failed.json);
  const undone = ownerRun(farm);
  check("c. the attempt is undone: no attempts, no retry, no notification", undone?.state === "missed" && undone.attempts.length === 0 && undone.nextAttemptAt === null
    && sql(`select outcome from calls where farm_id = ${q(farm)} and kind = 'owner_notification' order by at desc limit 1`) === "no_answer", undone);

  await control({ reset: true, outcome: "full", twilioError: null, dwellMs: 100, natural: OWNER_SCRIPT });
  const other = await op("callOwnerNow", TESTER);
  check("d. the test ranch (not the presentation ranch) is refused, nothing dialled", other.json?.ok === false && other.json.error === "unavailable" && (await mockState()).requests.length === 0, other.json);
  const status = await fetch(`${ready.app}/api/owner-call-now`, { headers: { Cookie: await cookieFor(TESTER) } }).then((r) => r.json()).catch(() => null);
  check("d. the test ranch's Dashboard doesn't get the switch (enabled: false)", status?.ok === true && status.enabled === false, status);
  check("worker side byte-identical through every gate", workerSide(farm) === workerBefore);
}

/* ─────────────────── main ─────────────────── */

let exitCode = 1;
let browser = null;
try {
  await startRunner();
  const farm = seedRanch();
  // The repeat list holds the ranch ids present at start: restart so the seeded ranch is the presentation ranch.
  const open = await stopRunner();
  if (open.length) throw new Error(`The runner left ports open: ${open}`);
  await startRunner({ restart: true });
  browser = await chromium.launch();
  for (const step of [
    () => scenarioSwitch(browser, farm),
    () => scenarioApprove(browser, farm),
    async () => scenarioOwner(browser, farm, await scenarioWorker(browser, farm)),
    () => scenarioGates(farm),
  ]) {
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

const rows = results.map((entry) => {
  const failed = entry.checks.filter((item) => !item.passed).length;
  const verdict = entry.error ? "ERROR" : failed ? "FAIL" : "PASS";
  return `${verdict.padEnd(6)} ${String(entry.id).padEnd(2)} ${entry.title}  [${entry.checks.length - failed}/${entry.checks.length}]`;
});
console.log(`\n=== verify-owner-call-now ===\n${rows.join("\n")}`);
for (const entry of results) for (const item of entry.checks.filter((c) => !c.passed)) console.log(`  FAIL ${entry.id}: ${item.name}`);
console.log("\nThis was a mock: fake Twilio, a scripted model and a local database. It proves wiring and saved data only, not the real model's Arabic or real telephony.");
writeFileSync(join(OUT, "owner-call-now.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`Results: ${join(OUT, "owner-call-now.json")}`);
process.exit(exitCode);
