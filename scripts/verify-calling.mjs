#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3463");
const OFF = arg("off", "http://localhost:3464");
const GATEWAY = arg("gateway", "http://127.0.0.1:54357");
const OUTBOUND = arg("outbound", "http://127.0.0.1:54359");
const DB = arg("db", "naqah_codex_stack");
const SHOTS = arg("shots", "artifacts/qa-codex/calling");
const LOCALE = arg("locale", "en");
assert(["ar", "en"].includes(LOCALE), "Arabic or English locale required");
for (const value of [BASE, OFF, GATEWAY, OUTBOUND]) {
  const url = new URL(value);
  assert(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/", "Loopback HTTP origins only");
}
assert(/^naqah_codex\d*_/.test(DB), "Disposable Codex database required");
mkdirSync(SHOTS, { recursive: true });
const sql = (query) => execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], { input: query, encoding: "utf8" }).trim();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const check = (name, passed, detail) => {
  assert(passed, `${name}: ${JSON.stringify(detail)}`);
  console.log(`PASS ${name}`);
};
const json = async (url, body) => (await fetch(url, body === undefined ? undefined : {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
})).json();
const waitFor = async (probe) => {
  for (let index = 0; index < 80; index += 1) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Condition did not become true");
};
const provider = () => json(`${OUTBOUND}/__test/outbound`);
const mockProvider = (status) => json(`${OUTBOUND}/__test/outbound`, { status, reset: true });
const faults = (rest) => json(`${GATEWAY}/__test/faults`, { rest });
const TOKEN = "local-test-auth-token";
async function webhook(target, fields, signature = true) {
  const publicUrl = new URL(target, BASE);
  publicUrl.protocol = "https:";
  let signed = publicUrl.toString();
  for (const key of Object.keys(fields).sort()) signed += key + fields[key];
  const transport = new URL(publicUrl.pathname + publicUrl.search, BASE);
  const response = await fetch(transport, {
    method: "POST", headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(signature ? { "X-Twilio-Signature": createHmac("sha1", signature === true ? TOKEN : signature).update(signed).digest("base64") } : {}),
    }, body: new URLSearchParams(fields),
  });
  return { status: response.status, xml: await response.text() };
}
const decode = (text) => text.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
const action = (xml) => decode(xml.match(/<Gather\b[^>]*\baction="([^"]+)"/)?.[1] ?? "");
const said = (xml) => xml.match(/<Say\b[^>]*>([\s\S]*?)<\/Say>/)?.[1] ?? "";
const email = `calling-${randomBytes(6).toString("hex")}@example.test`;
const password = "local-test-password";
const owner = await json(`${GATEWAY}/__test/users`, { email, password });
const session = await json(`${GATEWAY}/auth/v1/token?grant_type=password`, { email, password });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.addCookies([{
  name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  domain: "localhost", path: "/", sameSite: "Lax", secure: false,
}]);
const account = async (body, base = BASE) => (await context.request.post(`${base}/api/account`, { headers: { Origin: base }, data: body })).json();

try {
  await faults(false);
  await mockProvider(201);
  const opened = await account({ op: "open" });
  assert(opened.ok, JSON.stringify(opened));
  const farm = opened.data.farmId;
  assert.equal(sql(`select owner_id from farms where id = ${quote(farm)}`), owner.id);
  sql(`update farms set setup_complete = true, name = 'Calling QA', owner_name = 'QA Owner', owner_phone = '+15555550102', herd_count = 1, call_day = 0, call_time = '09:00' where id = ${quote(farm)};
    update workers set name = 'QA Worker', phone = '+15555550101', language = '${LOCALE}' where farm_id = ${quote(farm)};
    update farms set primary_worker_id = (select id from workers where farm_id = ${quote(farm)}) where id = ${quote(farm)};
    update resources set present = kind in ('feed', 'water') where farm_id = ${quote(farm)};`);
  check("cron refuses a missing or incorrect secret", (await fetch(`${BASE}/api/cron/report-calls`)).status === 401 && (await fetch(`${BASE}/api/cron/report-calls`, { headers: { Authorization: "Bearer wrong" } })).status === 401);
  const cron = await (await fetch(`${BASE}/api/cron/report-calls`, { headers: { Authorization: "Bearer local-only-cron-secret" } })).json();
  check("authorized cron stays disabled and places nothing", cron.skipped === "scheduled_calls_off" && (await provider()).requests.length === 0, cron);
  const disabled = await account({ op: "callNow" }, OFF);
  check("manual calling flag off refuses a configured call", disabled.ok === false && disabled.error === "unavailable" && (await provider()).requests.length === 0, disabled);
  sql(`update workers set phone = '+15555550103' where farm_id = ${quote(farm)}`);
  const denied = await account({ op: "callNow" });
  check("number outside allowlist creates no run or provider request", denied.data?.reason === "not_allowed" && sql(`select count(*) from report_call_runs where farm_id = ${quote(farm)}`) === "0" && (await provider()).requests.length === 0, denied);
  sql(`update workers set phone = '+15555550101' where farm_id = ${quote(farm)}`);
  const fields = { CallSid: `CA${randomBytes(16).toString("hex")}`, From: "+15555550101" };
  check("unsigned and wrongly signed inbound webhooks are rejected", (await webhook("/api/voice/inbound", fields, false)).status === 403 && (await webhook("/api/voice/inbound", fields, "wrong")).status === 403);
  const clickCall = async () => {
    await page.goto(`${BASE}/en/app`);
    await page.getByRole("button", { name: "Call QA Worker now", exact: true }).click();
    await page.getByRole("button", { name: "Call now", exact: true }).click();
  };
  await mockProvider(503);
  await clickCall();
  await page.getByText("The call could not be placed. Try again later.").waitFor();
  check("provider 503 shows an honest UI failure without an unanswered attempt", sql(`select count(*) from report_call_runs where farm_id = ${quote(farm)} and state = 'missed' and attempts = '[]'::jsonb`) === "1" && sql(`select count(*) from calls where farm_id = ${quote(farm)}`) === "0");
  await page.screenshot({ path: `${SHOTS}/provider-503.png`, fullPage: true });
  await mockProvider(201);
  await clickCall();
  await waitFor(async () => (await provider()).requests.length === 1);
  const request = (await provider()).requests[0];
  check("Call now uses the saved fake worker and disables recording", request.To === "+15555550101" && request.Record === "false" && request.From === "+15555550100", request);
  let reply = await webhook(request.Url, { CallSid: request.sid });
  const firstQuestion = action(reply.xml);
  reply = await webhook(firstQuestion, { CallSid: request.sid, SpeechResult: LOCALE === "ar" ? "ايوه" : "yes", Confidence: "0.1" });
  check("low-confidence speech is accepted, with nothing saved yet", !/didn&apos;t catch|ما فهمت/.test(reply.xml) && sql(`select count(*) from reports where farm_id = ${quote(farm)}`) === "0");
  let confirmPath;
  for (let turn = 0; turn < 30 && action(reply.xml); turn += 1) {
    const text = said(reply.xml);
    const path = action(reply.xml);
    const atSummary = /Confirm and save|Shall I save it|أحفظه/.test(text);
    if (atSummary) {
      confirmPath = path;
      check("report stays unsaved until explicit final confirmation", sql(`select count(*) from reports where farm_id = ${quote(farm)}`) === "0");
    }
    const ar = LOCALE === "ar";
    let answer;
    if (atSummary) answer = { SpeechResult: ar ? "ايوه" : "yes" };
    else if (reply.xml.includes('finishOnKey="#"')) {
      check("number gather does not cut off at one digit", !reply.xml.includes("numDigits="));
      answer = { SpeechResult: ar ? "أربعين" : "forty" };
    } else if (/feed|العلف/.test(text)) answer = { SpeechResult: ar ? "ثلاثين كيس" : "thirty bags" };
    else if (/water|الماء/.test(text)) answer = { SpeechResult: ar ? "مية وخمسين لتر" : "one hundred and fifty litres" };
    else if (reply.xml.includes('numDigits="1"')) answer = { Digits: "1" };
    else answer = { SpeechResult: ar ? "ما أدري" : "I don't know" };
    reply = await webhook(path, { CallSid: request.sid, ...answer });
  }
  check("signed outbound speech turns save one report and finish its run", /Your update is saved|تم حفظ التحديث/.test(reply.xml) && sql(`select count(*) from reports where farm_id = ${quote(farm)}`) === "1" && sql(`select count(*) from report_call_runs where farm_id = ${quote(farm)} and state = 'completed'`) === "1", reply);
  check("compound speech quantities are saved as approximate", sql(`select count(*) from resources where farm_id = ${quote(farm)} and certainty = 'approximate' and ((kind = 'feed' and quantity = '30 bags') or (kind = 'water' and quantity = '150 litres'))`) === "2");
  check("spoken count stays an owner proposal, not the official herd", sql(`select herd_count_reported from reports where farm_id = ${quote(farm)}`) === "40" && sql(`select herd_count from farms where id = ${quote(farm)}`) === "1");
  assert(confirmPath);
  await webhook(confirmPath, { CallSid: request.sid, Digits: "1" });
  await waitFor(async () => (await provider()).requests.length === 2);
  const notification = (await provider()).requests[1];
  check("owner notification uses this farm's fake owner, once", notification.To === "+15555550102" && notification.Record === "false" && notification.Twiml?.includes("Response") && (await provider()).requests.length === 2, notification);
  const callbackFields = { CallSid: notification.sid, CallStatus: "completed" };
  check("owner status callback is accepted", (await webhook(notification.StatusCallback, callbackFields)).status === 204);
  await webhook(notification.StatusCallback, callbackFields);
  check("duplicate notification callback counts once and consumes Basic owner allowance", sql(`select count(*) from calls where farm_id = ${quote(farm)} and kind = 'owner_notification'`) === "1" && sql(`select owner_allowance_used_at is not null from farms where id = ${quote(farm)}`) === "t");
  const second = await account({ op: "callNow" });
  check("Basic weekly allowance blocks a second report call", second.data?.reason === "already_reported" && (await provider()).requests.length === 2, second);
  await faults(true);
  const failedLoad = await account({ op: "load" });
  check("PostgREST failure returns an error, not saved data", failedLoad.ok === false && failedLoad.error === "unavailable", failedLoad);
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "We couldn't load your ranch" }).waitFor();
  check("unavailable database shows retry, never a demo or saved claim", await page.getByRole("button", { name: "Try again", exact: true }).count() === 1 && !/Calling QA|QA Worker/.test(await page.locator("body").innerText()));
  await page.screenshot({ path: `${SHOTS}/database-unavailable.png`, fullPage: true });
  await faults(false);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("heading", { name: "Calling QA", exact: true }).waitFor();
  check("database recovery reloads the persisted farm", true);
  const revoked = await fetch(`${GATEWAY}/auth/v1/logout?scope=global`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
  assert.equal(revoked.status, 204);
  const expired = await account({ op: "save", farm, changes: [{ kind: "profile", input: { name: "MUST NOT SAVE" } }] });
  check("ended session cannot save through the account route", expired.ok === false && expired.error === "unauthenticated" && sql(`select name from farms where id = ${quote(farm)}`) === "Calling QA", expired);
  await page.reload();
  await page.waitForURL("**/en/login", { timeout: 15_000 });
  check("ended session sends the UI to sign-in without farm data", !(await page.locator("body").innerText()).includes("Calling QA"));
  check("browser has no uncaught errors", errors.length === 0, errors);
  console.log("ALL PASSED");
} finally {
  await faults(false);
  await mockProvider(201);
  await browser.close();
}
