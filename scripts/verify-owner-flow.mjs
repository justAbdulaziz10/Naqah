#!/usr/bin/env node
/**
 * LOCAL ONLY. The owner flow in a real browser against supabase/local-validation/run-stack.sh and a
 * production build: sign in, the four setup steps, reload, a Settings edit, then one scheduled report
 * call through the signed Twilio webhooks (Twilio itself is not called), and the report on the
 * dashboard. A second owner checks isolation on a 375px Arabic screen.
 *
 *   . /tmp/naqah-live-tools/stack.env && NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1 npm run build
 *   NAQAH_VOICE_MODE=farm NAQAH_VOICE_SECRET=local-only-… TWILIO_AUTH_TOKEN=local-test-auth-token \
 *     NAQAH_PUBLIC_BASE_URL=http://localhost:3460 npx next start -p 3460
 *   node scripts/verify-owner-flow.mjs --secret local-only-… --token local-test-auth-token
 *   Add --input keypad to enter quantities with #, or --review keep to retain the owner's count.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3460");
const GATEWAY = arg("gateway", "http://127.0.0.1:54352");
const TOKEN = arg("token", "local-test-auth-token");
const SECRET = arg("secret", "");
const DB = arg("db", "naqah_live");
const SHOTS = arg("shots", "/tmp/naqah-live-tools/shots");
const INPUT = arg("input", "speech");
const REVIEW = arg("review", "accept");
assert(["speech", "keypad"].includes(INPUT), "--input must be speech or keypad");
assert(["accept", "keep"].includes(REVIEW), "--review must be accept or keep");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE) || !/127\.0\.0\.1|localhost/.test(GATEWAY)) throw new Error("local addresses only");
if (!SECRET.startsWith("local-only-")) throw new Error("--secret must be the server's local-only NAQAH_VOICE_SECRET");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, passed, detail = "") => {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${!passed && detail ? ` :: ${String(detail).slice(0, 400)}` : ""}`);
  if (!passed) failures += 1;
};
const sql = (query) => execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], { input: query, encoding: "utf8" }).trim();
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const phone = () => `05${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`;
const e164 = (local) => `+966${local.slice(1)}`;
const waitFor = async (probe, tries = 60) => {
  for (let index = 0; index < tries; index += 1) {
    if (probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

async function createOwner() {
  const email = `owner-${randomBytes(4).toString("hex")}@example.test`;
  const password = "local-test-password";
  const made = await fetch(`${GATEWAY}/__test/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (made.status !== 201) throw new Error(`user: ${made.status}`);
  return { ...(await made.json()), email, password };
}

// ── Signed webhooks, exactly as Twilio would send them ──
const twilioSignature = (url, fields) => {
  let value = url;
  for (const key of Object.keys(fields).sort()) value += key + fields[key];
  return createHmac("sha1", TOKEN).update(value, "utf8").digest("base64");
};
async function webhook(path, fields) {
  const url = new URL(path, BASE).toString();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSignature(url, fields) },
    body: new URLSearchParams(fields),
  });
  return { status: response.status, xml: await response.text() };
}
const callToken = (token) => {
  const payload = Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
  return `${payload}.${createHmac("sha256", SECRET).update(`naqah-call:${payload}`).digest("base64url")}`;
};
const decode = (text) => text.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
const says = (xml) => [...xml.matchAll(/<Say\b[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => decode(m[1])).join(" ");
const action = (xml) => {
  const raw = xml.match(/<Gather\b[^>]*\baction="([^"]+)"/)?.[1];
  return raw ? decode(raw) : null;
};

/** The worker answers NAQAH's report call with speech or a sequence of keypad presses. */
async function reportCall(farmId, runId, answer) {
  const CallSid = `CA${randomBytes(16).toString("hex")}`;
  const s = callToken({ k: "report", f: farmId, r: runId, n: 1, l: "ar", t: Date.now() });
  let reply = await webhook(`/api/voice/outbound?s=${encodeURIComponent(s)}`, { CallSid, CallStatus: "in-progress" });
  const script = [says(reply.xml)];
  for (let turn = 0; turn < 30 && action(reply.xml); turn += 1) {
    const { keys, ...fields } = answer(says(reply.xml), reply.xml);
    if (keys) {
      const finishKey = reply.xml.match(/<Gather\b[^>]*\bfinishOnKey="([^"]+)"/)?.[1];
      assert(finishKey && keys.endsWith(finishKey), "keypad quantities must end with the requested finish key");
      fields.Digits = keys.slice(0, -finishKey.length);
      assert(/^\d+$/.test(fields.Digits), "the webhook receives digits without the finish key");
    }
    reply = await webhook(action(reply.xml), { CallSid, ...fields });
    assert.equal(reply.status, 200, "report turn webhook succeeds");
    script.push(says(reply.xml));
  }
  await webhook(`/api/voice/outbound/status?s=${encodeURIComponent(s)}`, { CallSid, CallStatus: "completed" });
  return { CallSid, script, status: reply.status };
}

const browser = await chromium.launch();
const errors = [];
const open = async (viewport) => {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page };
};
const settled = (page) => page.waitForFunction(() => ![...document.querySelectorAll('[role="status"][aria-label]')].some((el) => el.checkVisibility()), null, { timeout: 20_000 });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function signIn(page, locale, owner) {
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[type="email"]').fill(owner.email);
  await page.locator('input[type="password"]').fill(owner.password);
  await page.locator('form button[type="submit"]').click();
}

async function chooseBasic(page, locale) {
  await page.waitForURL(`**/${locale}/choose-plan*`, { timeout: 20_000 });
  const radios = page.locator('input[name="plan"]');
  check(`${locale}: plan choice is not preselected`, await radios.evaluateAll((items) => items.every((item) => !item.checked)));
  const continueButton = page.getByRole("button", { name: locale === "ar" ? "كمّل على هذي الباقة" : "Continue with this plan", exact: true });
  check(`${locale}: continuation waits for an explicit choice`, await continueButton.isDisabled());
  await radios.nth(0).check();
  await continueButton.click();
  await page.waitForURL(`**/${locale}/start`, { timeout: 20_000 });
  check(`${locale}: explicit Basic choice opens the first setup step`, await page.getByRole("heading", { name: locale === "ar" ? "عزبتك" : "Your ranch", exact: true }).isVisible());
}

// ── Owner A: English, desktop. New owner → setup → dashboard ──
const ownerA = await createOwner();
const A = await open({ width: 1440, height: 900 });
const RANCH = `Al Nakheel ${randomBytes(2).toString("hex")}`;
const ownerPhone = phone(), yousefPhone = phone(), ahmedPhone = phone();
await signIn(A.page, "en", ownerA);
await chooseBasic(A.page, "en");
check("a new owner must choose a plan before setup", true);
await settled(A.page);
check("setup offers no sample data to a real owner", await A.page.getByText(/sample/i).count() === 0);
check("setup has four steps", await A.page.getByRole("button", { name: /^(Ranch|Workers and herd|Report call|Ready)$/ }).count() === 4);

await A.page.getByLabel("Ranch name").fill(RANCH);
await A.page.getByLabel("Your name").fill("Abdullah");
await A.page.getByLabel("Your mobile").fill(ownerPhone);
await A.page.getByRole("button", { name: "Continue" }).click();

await A.page.getByLabel("Name", { exact: true }).first().fill("Yousef");
await A.page.getByLabel("Mobile", { exact: true }).first().fill(yousefPhone);
await A.page.getByRole("button", { name: "Add a worker" }).click();
await A.page.getByLabel("Name", { exact: true }).nth(1).fill("Ahmed");
await A.page.getByLabel("Mobile", { exact: true }).nth(1).fill(ahmedPhone);
await A.page.locator('input[name="primary-worker"]').nth(1).check();
await A.page.getByLabel("Total camels").fill("42");
await A.page.getByRole("button", { name: "Continue" }).click();

await A.page.getByLabel("Day").selectOption({ label: "Thursday" });
await A.page.getByLabel("Time").fill("17:30");
await A.page.getByText(/NAQAH will call Ahmed every Thursday at (17:30|5:30 pm)/i).first().waitFor({ timeout: 5_000 })
  .then(() => check("the call time reads as a sentence with the chosen worker", true))
  .catch(() => check("the call time reads as a sentence with the chosen worker", false));
const questionBox = A.page.getByPlaceholder("e.g. Did the vet visit today?");
await questionBox.fill("Did the vet visit today?");
await questionBox.press("Enter");
await A.page.getByRole("button", { name: "Continue" }).click();
await A.page.screenshot({ path: `${SHOTS}/flow-en-ready.png`, fullPage: true });
await A.page.getByRole("button", { name: "Open dashboard" }).click();
await A.page.waitForURL("**/en/app", { timeout: 20_000 });
await settled(A.page);

const farmA = sql(`select id from farms where owner_id = ${q(ownerA.id)}`);
await waitFor(() => sql(`select setup_complete from farms where id = ${q(farmA)}`) === "t");
check("explicit Basic choice persisted with its confirmation marker", sql(`select plan || ':' || (plan_selected_at is not null) from farms where id = ${q(farmA)}`) === "basic:true");
const farmRow = sql(`select name || '|' || owner_name || '|' || owner_phone || '|' || coalesce(herd_count::text, '-') || '|' || coalesce(call_day::text, '-') || '|' || coalesce(to_char(call_time, 'HH24:MI'), '-') || '|' || setup_complete from farms where id = ${q(farmA)}`);
check("ranch, owner, herd count and call time saved to Supabase", farmRow === `${RANCH}|Abdullah|${e164(ownerPhone)}|42|4|17:30|true`, farmRow);
const workers = sql(`select string_agg(w.name || ':' || w.phone || ':' || (w.id = f.primary_worker_id), ',' order by w.name) from workers w join farms f on f.id = w.farm_id where f.id = ${q(farmA)}`);
check("two workers saved, Ahmed is the one NAQAH calls", workers === `Ahmed:${e164(ahmedPhone)}:true,Yousef:${e164(yousefPhone)}:false`, workers);
check("custom question saved", sql(`select string_agg(text, ',') from custom_questions where farm_id = ${q(farmA)}`) === "Did the vet visit today?");

await A.page.reload();
await settled(A.page);
const overview = await A.page.locator("main").innerText();
check("after a reload the dashboard shows the real ranch", overview.includes(RANCH) || (await A.page.locator("body").innerText()).includes(RANCH));
check("the dashboard names the next call and the herd count", /Ahmed/.test(overview) && /42/.test(overview), overview.slice(0, 400));
check("no Call Lab link for a real owner", await A.page.locator('a[href$="/app/lab"]').count() === 0);
check("the real farm never reaches browser storage", !(await A.page.evaluate(() => JSON.stringify({ ...localStorage }))).includes(RANCH));
await A.page.screenshot({ path: `${SHOTS}/flow-en-dashboard.png`, fullPage: true });

// Settings: same fields, saved on change.
await A.page.goto(`${BASE}/en/app/settings`);
await settled(A.page);
await A.page.getByLabel("Total camels").fill("45");
await A.page.getByLabel("Time").first().fill("18:15");
await A.page.locator("main h1, main h2").first().click(); // Leave the field.
check("a Settings edit saves", await waitFor(() => sql(`select herd_count || '|' || to_char(call_time, 'HH24:MI') from farms where id = ${q(farmA)}`) === "45|18:15"),
  sql(`select herd_count || '|' || to_char(call_time, 'HH24:MI') from farms where id = ${q(farmA)}`));
await A.page.reload();
await settled(A.page);
check("a Settings edit survives a reload", await A.page.getByLabel("Total camels").inputValue() === "45");

// ── One report call: the run the scheduler would claim, then the worker answers ──
const runId = randomUUID();
const now = new Date().toISOString();
sql(`insert into report_call_runs (id, farm_id, occurrence, trigger, attempts, state)
  values (${q(runId)}, ${q(farmA)}, ${q(now)}, 'manual', ${q(JSON.stringify([{ at: now, result: "pending" }]))}::jsonb, 'calling')`);
let quantities = 0;
const call = await reportCall(farmA, runId, (text, xml) => {
  if (/<Gather\b[^>]*\bnumDigits="1"/.test(xml)) return { Digits: "1" };
  if (/قل العدد|Say the number/.test(text)) {
    assert(xml.includes('finishOnKey="#"') && /ثم اضغط #|then press #/.test(text), "quantity prompt explains keypad completion");
    quantities += 1;
    const amount = /أكياس|bags/.test(text) ? "30" : /باللتر|litres/.test(text) ? "150" : "40";
    if (INPUT === "keypad") return { keys: `${amount}#` };
    return { SpeechResult: amount === "40" ? "أربعين" : amount === "30" ? "ثلاثين كيس" : "مية وخمسين لتر" };
  }
  if (/مريض|تعبان|sick/.test(text)) return { SpeechResult: "لا، ما فيه مريض" };
  if (/الطبيب|البيطري|vet/i.test(text)) return { SpeechResult: "لا ما جاء" };
  return { SpeechResult: "نعم" };
});
const saved = sql(`select r.herd_count_reported || '|' || run.state || '|' || (run.report_id = r.id) from report_call_runs run join reports r on r.farm_id = run.farm_id where run.id = ${q(runId)}`);
check("the answered report call saves one report and completes its run", /\|completed\|true$/.test(saved), `${saved}\n${call.script.join("\n")}`);
check("the worker's herd count is kept as a proposal, not the official count", /^40\|/.test(saved) && sql(`select herd_count from farms where id = ${q(farmA)}`) === "45", saved);
check(`${INPUT} quantities are confirmed and saved without confusing # with a menu choice`, quantities === 3 && sql(`select count(*) from resources where farm_id = ${q(farmA)} and certainty = 'approximate' and ((kind = 'feed' and quantity = '30 bags') or (kind = 'water' and quantity = '150 litres'))`) === "2", call.script.join("\n"));
check("no recording or transcript is stored", !/audio|recording|transcript/.test(sql(`select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public'`)));

await A.page.goto(`${BASE}/en/app`);
await settled(A.page);
const afterCall = await A.page.locator("main").innerText();
check("the dashboard shows the new report", !/no report yet/i.test(afterCall), afterCall.slice(0, 500));
const use = A.page.getByRole("button", { name: "Use 40", exact: true });
const keep = A.page.getByRole("button", { name: "Keep 45", exact: true });
check("the dashboard offers the worker's count to accept", await use.count() > 0, afterCall.slice(0, 500));
check("the dashboard offers to keep the owner's count", await keep.count() > 0, afterCall.slice(0, 500));
const review = REVIEW === "accept" ? use : keep;
const expectedCount = REVIEW === "accept" ? "40" : "45";
if (await review.count()) {
  await review.click();
  check(`${REVIEW}: the official count and review persist`, await waitFor(() => sql(`select herd_count || '|' || (herd_count_reviewed_at is not null) from farms where id = ${q(farmA)}`) === `${expectedCount}|true`));
}
await A.page.screenshot({ path: `${SHOTS}/flow-en-after-call.png`, fullPage: true });
for (const locale of ["ar", "en"]) {
  for (const width of [375, 1440]) {
    await A.page.setViewportSize({ width, height: 900 });
    await A.page.goto(`${BASE}/${locale}/app`);
    await settled(A.page);
    const reportText = await A.page.locator("main").innerText();
    check(`${locale} ${width}: dashboard shows the persisted report and reviewed count`, reportText.includes(RANCH) && new RegExp(`\\b${expectedCount}\\b`).test(reportText) && !/no report yet|ما وصل.*تحديث/.test(reportText), reportText);
    check(`${locale} ${width}: the reviewed proposal stays dismissed`, await A.page.getByRole("button", { name: /^(?:Use|اعتمد)\s+40$/ }).count() === 0 && sql(`select herd_count_reported from reports where farm_id = ${q(farmA)}`) === "40");
    check(`${locale} ${width}: dashboard has no horizontal overflow`, await noSideScroll(A.page));
    await A.page.screenshot({ path: `${SHOTS}/report-${locale}-${width}.png`, fullPage: true });
  }
}

// ── Owner B: Arabic, 375px. Own empty farm, never A's ──
const ownerB = await createOwner();
const B = await open({ width: 375, height: 812 });
await signIn(B.page, "ar", ownerB);
await B.page.waitForURL("**/ar/start", { timeout: 20_000 });
await settled(B.page);
const bText = await B.page.locator("body").innerText();
check("a second owner sees none of the first owner's farm", !bText.includes(RANCH) && !bText.includes("Ahmed"));
check("Arabic setup is right-to-left", await B.page.evaluate(() => document.documentElement.dir) === "rtl");
check("Arabic setup has no sideways scroll at 375px", await noSideScroll(B.page));
await B.page.screenshot({ path: `${SHOTS}/flow-ar-375-start.png`, fullPage: true });
const farmB = sql(`select id from farms where owner_id = ${q(ownerB.id)}`);
check("each owner has exactly one farm", Boolean(farmB) && farmB !== farmA && sql(`select count(*) from farms where owner_id in (${q(ownerA.id)}, ${q(ownerB.id)})`) === "2");

// ── Unanswered, busy, then failed: two retries 20 minutes apart, then the run is missed ──
const missedRun = randomUUID();
const startedAt = new Date();
sql(`insert into report_call_runs (id, farm_id, occurrence, trigger, attempts, state)
  values (${q(missedRun)}, ${q(farmB)}, ${q(startedAt.toISOString())}, 'schedule', ${q(JSON.stringify([{ at: startedAt.toISOString(), result: "pending" }]))}::jsonb, 'calling')`);
const attemptStatus = async (n, status) => {
  const CallSid = `CA${randomBytes(16).toString("hex")}`;
  const s = encodeURIComponent(callToken({ k: "report", f: farmB, r: missedRun, n, l: "ar", t: Date.now() }));
  const first = await webhook(`/api/voice/outbound/status?s=${s}`, { CallSid, CallStatus: status });
  const again = await webhook(`/api/voice/outbound/status?s=${s}`, { CallSid, CallStatus: status }); // Twilio may retry.
  return [first.status, again.status];
};
const runRow = () => sql(`select state || '|' || jsonb_array_length(attempts) || '|' || coalesce(extract(epoch from next_attempt_at - now())::int / 60, -1) from report_call_runs where id = ${q(missedRun)}`);
const placeNext = (n) => sql(`update report_call_runs set attempts = attempts || ${q(JSON.stringify([{ at: new Date().toISOString(), result: "pending" }]))}::jsonb, next_attempt_at = null where id = ${q(missedRun)} and jsonb_array_length(attempts) = ${n - 1}`);
check("an unanswered call is accepted once, even when Twilio repeats the callback", (await attemptStatus(1, "no-answer")).every((code) => code === 204));
check("no answer → retry in 20 minutes", /^calling\|1\|(19|20)$/.test(runRow()), runRow());
placeNext(2);
await attemptStatus(2, "busy");
check("busy → second retry in 20 minutes", /^calling\|2\|(19|20)$/.test(runRow()), runRow());
placeNext(3);
await attemptStatus(3, "failed");
check("after the second retry the run is missed, with no further call", /^missed\|3\|-1$/.test(runRow()), runRow());
check("each missed attempt is logged once", sql(`select count(*) from calls where farm_id = ${q(farmB)} and kind = 'worker_report_missed'`) === "3");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);
