#!/usr/bin/env node
/**
 * LOCAL ONLY. The whole milestone in a real browser against supabase/local-validation/run-stack.sh:
 * an owner signs in and sets up a farm, mocked signed Twilio webhooks run a worker call, and the
 * report appears on that owner's dashboard. Only Twilio and the Auth server are stand-ins.
 *
 *   node scripts/verify-account.mjs --base http://127.0.0.1:3460 --gateway http://127.0.0.1:54352 --token <test auth token>
 */
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const BASE = arg("base", "http://127.0.0.1:3460");
const GATEWAY = arg("gateway", "http://127.0.0.1:54352");
const TOKEN = arg("token", "local-test-auth-token");
const DB = arg("db", "naqah_live");
const SHOTS = arg("shots", "/tmp/naqah-live-tools/shots");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE) || !/127\.0\.0\.1|localhost/.test(GATEWAY)) throw new Error("local addresses only");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, passed, detail = "") => {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${!passed && detail ? ` :: ${String(detail).slice(0, 300)}` : ""}`);
  if (!passed) failures += 1;
};
const sql = (query) => execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], { input: query, encoding: "utf8" }).trim();
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const phone = () => `+9665${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`;

async function createOwner() {
  const email = `owner-${randomBytes(4).toString("hex")}@example.test`;
  const password = "local-test-password";
  const made = await fetch(`${GATEWAY}/__test/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (made.status !== 201) throw new Error(`user: ${made.status}`);
  const { id } = await made.json();
  return { id, email, password };
}
async function session(owner) {
  const response = await fetch(`${GATEWAY}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: owner.email, password: owner.password }) });
  return response.json();
}
async function signIn(context, owner) {
  const token = await session(owner);
  await context.addCookies([{
    name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(token)).toString("base64url")}`,
    domain: "127.0.0.1", path: "/", sameSite: "Lax", secure: true,
  }]);
  return token;
}

const signature = (url, fields) => {
  let value = url;
  for (const key of Object.keys(fields).sort()) value += key + fields[key];
  return createHmac("sha1", TOKEN).update(value, "utf8").digest("base64");
};
async function webhook(path, fields) {
  const url = new URL(path, BASE).toString();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature(url, fields) },
    body: new URLSearchParams(fields),
  });
  return { status: response.status, xml: await response.text() };
}
const decode = (text) => text.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
const say = (xml) => decode(xml.match(/<Say\b[^>]*>([\s\S]*?)<\/Say>/)?.[1] ?? "");
const action = (xml) => {
  const raw = xml.match(/<Gather\b[^>]*\baction="([^"]+)"/)?.[1];
  return raw ? decode(raw) : null;
};

/** One worker call. `answers` maps a question to speech; anything else takes the first choice. */
async function workerCall(from, answers) {
  const CallSid = `CA${randomBytes(16).toString("hex")}`;
  let reply = await webhook("/api/voice/inbound", { CallSid, From: from });
  const script = [say(reply.xml)];
  for (let turn = 0; turn < 25 && action(reply.xml); turn += 1) {
    const text = say(reply.xml);
    const custom = Object.entries(answers).find(([question]) => text.includes(question));
    const fields = { CallSid, From: from };
    if (custom) fields.SpeechResult = custom[1];
    else if (!/اضغط|Press/.test(text)) fields.SpeechResult = "12";
    else fields.Digits = "1";
    reply = await webhook(action(reply.xml), fields);
    script.push(say(reply.xml));
  }
  await webhook("/api/voice/status", { CallSid, CallStatus: "completed" });
  return { CallSid, script, last: script.at(-1) };
}

const settled = (page) => page.waitForFunction(() => ![...document.querySelectorAll('[role="status"][aria-label]')].some((el) => el.checkVisibility()), null, { timeout: 15_000 });
const next = (page, label) => page.getByRole("button", { name: label, exact: false }).first().click();
const storedText = (page) => page.evaluate(() => JSON.stringify({ ...localStorage }));

async function runWizard(page, locale, { owner, farm, worker, workerName, ownerPhone, workerPhone }) {
  const go = locale === "ar" ? "متابعة" : "Continue";
  await page.goto(`${BASE}/${locale}/start`);
  await settled(page);
  await page.locator("[data-step-next]").waitFor();
  check(`${locale}: setup offers no sample data to a real owner`, await page.getByText(locale === "ar" ? /بيانات تجريبية|نموذج/ : /sample/i).count() === 0);
  await page.getByLabel(locale === "ar" ? "اسم العزبة" : "Ranch name").fill(farm);
  await page.getByLabel(locale === "ar" ? "اسمك" : "Your name").fill(owner);
  await page.getByLabel(locale === "ar" ? "جوالك" : "Your mobile").fill(ownerPhone);
  await next(page, go);
  await page.getByLabel(locale === "ar" ? "الاسم" : "Name", { exact: true }).fill(workerName ?? worker);
  await page.getByLabel(locale === "ar" ? "الجوال" : "Mobile", { exact: true }).fill(workerPhone);
  await next(page, go);
  await page.getByLabel(locale === "ar" ? "اليوم" : "Day", { exact: true }).selectOption("4");
  await page.getByLabel(locale === "ar" ? "الوقت" : "Time", { exact: true }).fill("17:00");
  await next(page, go);
  await page.getByRole("button", { name: locale === "ar" ? "افتح لوحة العزبة" : "Open dashboard" }).click();
  await page.waitForURL(`**/${locale}/app`, { timeout: 15_000 });
  await settled(page);
  await page.locator("main").getByText(farm).first().waitFor({ timeout: 10_000 }); // Proves the page below checks a rendered farm.
}

async function addCamel(page, locale, name) {
  await page.goto(`${BASE}/${locale}/app/herd`);
  await settled(page);
  await page.getByRole("button", { name: locale === "ar" ? "إضافة ناقة أو جمل" : "Add camel" }).first().click();
  await page.getByLabel(locale === "ar" ? "الاسم" : "Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: locale === "ar" ? "حفظ" : "Save", exact: true }).click();
  await page.getByText(name).first().waitFor();
}

async function addQuestion(page, locale, text) {
  await page.goto(`${BASE}/${locale}/app/settings`);
  await settled(page);
  await page.getByLabel(locale === "ar" ? "أضف سؤال" : "Add a question").fill(text);
  await page.keyboard.press("Enter");
}
const waitFor = async (probe, label, tries = 40) => {
  for (let index = 0; index < tries; index += 1) {
    if (probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(`  (timed out waiting for ${label})`);
  return false;
};

const browser = await chromium.launch();
const errors = [];
const open = async (viewport = { width: 1280, height: 900 }) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page };
};

// ── Owner A: Arabic, Basic ──────────────────────────────────────────────────────────────
const ownerA = await createOwner();
const workerA = phone();
const ownerPhoneA = phone();
const FARM_A = `مزرعة النخيل ${randomBytes(2).toString("hex")}`;
const A = await open();
await signIn(A.context, ownerA);
await runWizard(A.page, "ar", { owner: "سالم", farm: FARM_A, worker: "يوسف", ownerPhone: ownerPhoneA, workerPhone: workerA });
const farmA = sql(`select id from farms where owner_id = ${q(ownerA.id)}`);
check("sign-in creates one farm for the owner", Boolean(farmA));
check("setup reaches Supabase and starts on Basic", sql(`select plan || ':' || setup_complete || ':' || name from farms where id = ${q(farmA)}`) === `basic:true:${FARM_A}`, sql(`select plan, setup_complete, name from farms where id = ${q(farmA)}`));
check("worker and phone saved", sql(`select name || ':' || phone from workers where farm_id = ${q(farmA)}`) === `يوسف:${workerA}`);
check("dashboard shows the real farm, with no demo notice", (await A.page.locator("body").innerText()).includes("سالم") && await A.page.getByRole("note").count() === 0);
check("no Call Lab for a real farm", await A.page.locator('a[href$="/app/lab"]').count() === 0);
check("the real farm never reaches this browser's storage", !(await storedText(A.page)).includes(FARM_A));
await A.page.goto(`${BASE}/ar/app/lab`);
await A.page.waitForURL("**/ar/app");
check("the Call Lab address sends a real owner to the dashboard", true);

await addCamel(A.page, "ar", "نورة");
await waitFor(() => sql(`select count(*) from camels where farm_id = ${q(farmA)} and name = 'نورة'`) === "1", "camel");
check("camel saved, with who confirmed it", sql(`select certainty from camels where farm_id = ${q(farmA)} and name = 'نورة'`) === "verified");
const QUESTION = "هل زار أحد المزرعة؟";
await addQuestion(A.page, "ar", QUESTION);
await waitFor(() => sql(`select count(*) from custom_questions where farm_id = ${q(farmA)}`) === "1", "question");
check("custom question saved", sql(`select text from custom_questions where farm_id = ${q(farmA)}`) === QUESTION);

await A.page.reload();
await settled(A.page);
check("refresh keeps saved data", (await A.page.getByLabel("أضف سؤال").count()) === 1 && (await A.page.getByText(QUESTION).count()) > 0);

// A failed save must say so, keep the edit, and recover.
await A.page.route("**/api/account", (route) => route.abort());
await A.page.getByLabel("أضف سؤال").fill("سؤال لم يُحفظ");
await A.page.keyboard.press("Enter");
await A.page.getByRole("alert").filter({ hasText: "ما انحفظ" }).waitFor({ timeout: 8_000 });
check("a failed save tells the owner, and shows no saved state", await A.page.getByText("سؤال لم يُحفظ").count() > 0);
await A.page.unroute("**/api/account");
await A.page.getByRole("button", { name: "حاول مرة ثانية" }).click();
await waitFor(() => sql(`select count(*) from custom_questions where farm_id = ${q(farmA)}`) === "2", "retry");
check("retry saves it once", sql(`select count(*) from custom_questions where farm_id = ${q(farmA)} and text = 'سؤال لم يُحفظ'`) === "1");
await A.page.getByRole("alert").filter({ hasText: "ما انحفظ" }).waitFor({ state: "detached", timeout: 8_000 }).catch(() => undefined);

// Plan is not the owner's to set.
await A.page.getByRole("radio").nth(1).click();
await A.page.getByRole("alert").filter({ hasText: "الباقة" }).waitFor({ timeout: 5_000 });
check("a plan change is refused out loud", sql(`select plan from farms where id = ${q(farmA)}`) === "basic");

// Basic only reports inside its window, so open one around now through the service.
const riyadhDay = new Date(Date.now() + 3 * 3600_000).getUTCDay();
sql(`update farms set window_day = ${riyadhDay}, window_start = '00:00', window_end = '23:59' where id = ${q(farmA)}`);
const ANSWER = "زارنا البيطري اليوم";
await A.page.goto(`${BASE}/ar/app/calls`);
await settled(A.page);
const callA = await workerCall(workerA, { [QUESTION]: ANSWER, "سؤال لم يُحفظ": "لا شيء" });
check("worker call saves", /تم حفظ التحديث/.test(callA.last), callA.script.join(" | "));
check("the farm's real names are spoken", callA.script[0].includes("يوسف"), callA.script[0]);
check("one report in Supabase, on the right call", sql(`select count(*) from reports r join calls c on c.id = r.call_id where r.farm_id = ${q(farmA)} and c.provider_call_id = ${q(callA.CallSid)}`) === "1");
await A.page.evaluate(() => window.dispatchEvent(new Event("focus")));
let shown = await A.page.getByText(ANSWER).count();
for (let index = 0; index < 30 && !shown; index += 1) {
  await A.page.waitForTimeout(300);
  const toggle = A.page.locator("main button[aria-expanded='false']").first();
  if (await toggle.count()) await toggle.click().catch(() => undefined);
  shown = await A.page.getByText(ANSWER).count();
}
check("the report appears on the open dashboard without a reload", shown > 0, (await A.page.locator("main").innerText()).slice(0, 300));
await A.page.screenshot({ path: `${SHOTS}/ar-calls-report-1280.png`, fullPage: true });

const second = await workerCall(workerA, {});
check("a second report in the same period is refused", second.script.length === 1 && sql(`select count(*) from reports where farm_id = ${q(farmA)}`) === "1", second.script.join(" | "));

await A.page.goto(`${BASE}/ar/app/settings`);
await settled(A.page);
await A.page.getByRole("button", { name: /تسجيل الخروج|خروج/ }).click();
await A.page.waitForURL("**/ar/login");
await A.page.goto(`${BASE}/ar/app`);
await A.page.getByText("ما فيه عزبة هنا للحين").waitFor();
check("signing out leaves no farm data on screen or in storage", !(await A.page.locator("body").innerText()).includes(FARM_A) && !(await storedText(A.page)).includes(FARM_A));
await signIn(A.context, ownerA);
await A.page.goto(`${BASE}/ar/app/calls`);
await settled(A.page);
const toggle = A.page.locator("main button[aria-expanded='false']").first();
if (await toggle.count()) await toggle.click();
await A.page.getByText(ANSWER).first().waitFor({ state: "attached", timeout: 8_000 });
check("signing in again brings the report back", true);

// ── Owner B: English, Ultimate ──────────────────────────────────────────────────────────
const ownerB = await createOwner();
const workerB = phone();
const B = await open({ width: 390, height: 844 });
const tokenB = await signIn(B.context, ownerB);
await B.page.goto(`${BASE}/en/start`);
await settled(B.page);
const farmB = sql(`select id from farms where owner_id = ${q(ownerB.id)}`);
sql(`update farms set plan = 'ultimate' where id = ${q(farmB)}`); // No billing yet: the service sets a plan.
await runWizard(B.page, "en", { owner: "Faisal", farm: "Rawdah Farm", worker: "Hamid", ownerPhone: phone(), workerPhone: workerB });
sql(`update workers set language = 'en' where farm_id = ${q(farmB)}`);
check("Ultimate farm loads as Ultimate", (await B.page.locator("body").innerText()).includes("Rawdah Farm") && sql(`select plan from farms where id = ${q(farmB)}`) === "ultimate", (await B.page.locator("body").innerText()).slice(0, 240) + " :: " + sql(`select plan, owner_name, setup_complete from farms where id = ${q(farmB)}`));
const body = await B.page.locator("body").innerText();
check("owner B sees nothing of owner A", !body.includes(FARM_A) && !body.includes(ANSWER));
const rest = (path, token) => fetch(`${GATEWAY}/rest/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json());
check("direct API: owner B reads none of owner A's reports", (await rest(`reports?farm_id=eq.${farmA}`, tokenB.access_token)).length === 0);
check("direct API: owner B reads none of owner A's farm", (await rest(`farms?id=eq.${farmA}`, tokenB.access_token)).length === 0);
const write = await fetch(`${GATEWAY}/rest/v1/camels?farm_id=eq.${farmA}`, { method: "PATCH", headers: { Authorization: `Bearer ${tokenB.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ name: "hacked" }) });
check("direct API: owner B changes none of owner A's camels", (await write.json()).length === 0 && sql(`select count(*) from camels where name = 'hacked'`) === "0");
const removed = await fetch(`${GATEWAY}/rest/v1/farms?id=eq.${farmB}`, { method: "DELETE", headers: { Authorization: `Bearer ${tokenB.access_token}` } });
check("direct API: an owner can't delete their farm's history", removed.status === 403 || removed.status === 401, removed.status);
const task = sql(`insert into task_tickets (farm_id, instruction) values (${q(farmB)}, 'Fix the east gate') returning id`).split("\n")[0];
await B.page.goto(`${BASE}/en/app/tickets`);
await settled(B.page);
await B.page.getByText("Fix the east gate").first().waitFor();
check("open task appears on the dashboard", true);
const callB = await workerCall(workerB, {});
check("Ultimate worker call saves", /saved/i.test(callB.last), callB.script.join(" | "));
check("the task closes on the worker's confirmation", sql(`select status from task_tickets where id = ${q(task)}`) === "closed");
await B.page.evaluate(() => window.dispatchEvent(new Event("focus")));
await B.page.waitForTimeout(1_500);
await B.page.screenshot({ path: `${SHOTS}/en-tickets-390.png`, fullPage: true });
await B.page.goto(`${BASE}/en/app`);
await settled(B.page);
await B.page.locator("main").getByText("Rawdah Farm").first().waitFor();
check("overview updates after the call, on a phone screen", !/no update|not reported/i.test(await B.page.locator("main").innerText()), (await B.page.locator("main").innerText()).slice(0, 200));
check("no sideways scroll on a phone", await B.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await B.page.screenshot({ path: `${SHOTS}/en-overview-390.png`, fullPage: true });

// ── A visitor stays in the demo ─────────────────────────────────────────────────────────
const V = await open();
await V.page.goto(`${BASE}/en`);
await V.page.getByRole("button", { name: /explore the demo/i }).first().click();
await V.page.waitForURL("**/en/app");
await V.page.getByRole("note").first().waitFor();
check("a signed-out visitor gets the browser demo with its notice", (await storedText(V.page)).includes("naqah-workspace-v1"));
check("the demo keeps its Call Lab", await V.page.locator('a[href$="/app/lab"]').count() > 0);
check("the demo wrote nothing to Supabase", sql("select count(*) from farms") === "2");
check("no uncaught browser errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
