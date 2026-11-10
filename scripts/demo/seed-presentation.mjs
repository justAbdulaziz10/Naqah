#!/usr/bin/env node
/**
 * LOCAL DEMO ONLY. Adds (or with --reset removes) the fictional presentation ranch «عزبة الوسم (عرض تجريبي)»
 * on a local stand-in stack. Refuses anything that isn't loopback.
 *
 *   PGHOST=127.0.0.1 PGPORT=54600 node scripts/demo/seed-presentation.mjs --db naqah_staging --gateway http://127.0.0.1:54602
 *   … --reset        removes the demo ranch (cascades to all its rows); the login stays
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const DB = arg("db", "naqah_staging");
const GATEWAY = arg("gateway", "http://127.0.0.1:54602");
const EMAIL = arg("email", "demo@naqah.demo");
const PASSWORD = arg("password", "naqah-demo-2026");
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(GATEWAY) || !/^(127\.0\.0\.1|localhost)$/.test(process.env.PGHOST ?? "")) {
  throw new Error("Local stand-in stack only (PGHOST and --gateway must be loopback)");
}

const PSQL = "/opt/homebrew/opt/postgresql@17/bin/psql";
const sql = (query) => execFileSync(PSQL, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], { input: query, encoding: "utf8", maxBuffer: 1 << 26 }).trim();
const quote = (value) => (value === null || value === undefined ? "null" : `'${String(value).replaceAll("'", "''")}'`);

const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src") } });
const { demoSettings, demoHistory, DEMO_RANCH_NAME } = await jiti.import(join(ROOT, "scripts/demo/presentation-ranch.ts"));
const { diffWorkspace } = await jiti.import(join(ROOT, "src/server/db/diff.ts"));
const { toDbId } = await jiti.import(join(ROOT, "src/server/db/ids.ts"));

const existing = sql(`select id from farms where name = ${quote(DEMO_RANCH_NAME)}`);
if (process.argv.includes("--reset")) {
  if (existing) sql(`delete from farms where name = ${quote(DEMO_RANCH_NAME)}`);
  console.log(existing ? "Removed the demo ranch." : "No demo ranch to remove.");
  process.exit(0);
}
if (existing) throw new Error("The demo ranch already exists. Run with --reset first.");

// The demo owner's login on the stand-in Auth. Reused when it already exists.
let ownerId;
const made = await fetch(`${GATEWAY}/__test/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
if (made.status === 201) ownerId = (await made.json()).id;
else {
  const token = await fetch(`${GATEWAY}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!token.ok) throw new Error(`Could not create or sign in the demo owner (${made.status}/${token.status})`);
  ownerId = (await token.json()).user.id;
}
if (sql(`select count(*) from farms where owner_id = ${quote(ownerId)}`) !== "0") throw new Error("The demo owner already has another ranch");

const now = new Date();
const ws = demoSettings(now);
const s = ws.settings;
const farmId = sql(`insert into farms (owner_id, plan, plan_selected_at, setup_complete, name, owner_name, owner_phone, location, herd_count,
    call_time, owner_call_time, report_mode, created_at)
  values (${quote(ownerId)}, 'ultimate', now(), true, ${quote(s.farm.name)}, ${quote(s.owner.name)}, ${quote(s.owner.phone)}, ${quote(s.farm.location)}, 20,
    '17:00', '19:00', 'guided', ${quote(ws.createdAt)}) returning id`).split("\n")[0];
const id = (value) => toDbId(farmId, value);
const workerIds = [];
for (const w of [s.worker, ...(s.otherWorkers ?? [])]) {
  workerIds.push(sql(`insert into workers (farm_id, name, phone, language) values (${quote(farmId)}, ${quote(w.name)}, ${quote(w.phone)}, ${quote(w.language)}) returning id`).split("\n")[0]);
}
sql(`update farms set primary_worker_id = ${quote(workerIds[0])} where id = ${quote(farmId)}`);
for (const c of ws.camels) {
  sql(`insert into camels (id, farm_id, name, tag, sex, age_years, health, health_note, certainty, updated_at)
    values (${quote(id(c.id))}, ${quote(farmId)}, ${quote(c.name)}, ${quote(c.tag)}, ${quote(c.sex)}, ${c.ageYears ?? "null"}, ${quote(c.health)}, ${quote(c.healthNote)}, ${quote(c.certainty)}, ${quote(c.updatedAt)})`);
}
for (const r of ws.resources) {
  sql(`insert into resources (farm_id, kind, present, level, quantity, note, certainty, updated_at)
    values (${quote(farmId)}, ${quote(r.kind)}, ${r.present}, ${quote(r.level)}, ${quote(r.quantity)}, ${quote(r.note)}, ${quote(r.certainty)}, ${quote(r.updatedAt)})`);
}
for (const c of s.criteria) sql(`insert into criteria (id, farm_id, kind, label, enabled) values (${quote(id(c.id))}, ${quote(farmId)}, ${quote(c.kind)}, ${quote(c.label)}, ${c.enabled})`);
for (const e of s.emergencies) sql(`insert into emergency_categories (id, farm_id, kind, label) values (${quote(id(e.id))}, ${quote(farmId)}, ${quote(e.kind)}, ${quote(e.label)})`);
for (const q of s.customQuestions) sql(`insert into custom_questions (id, farm_id, text, created_at) values (${quote(id(q.id))}, ${quote(farmId)}, ${quote(q.text)}, ${quote(q.createdAt)})`);

// History through the same path the voice service uses.
const history = demoHistory(ws, now);
const changes = diffWorkspace(ws, history, farmId);
const revision = sql(`select revision from farms where id = ${quote(farmId)}`);
sql(`select public.apply_farm_changes(${quote(farmId)}, ${revision}, ${quote(JSON.stringify(changes))}::jsonb)`);

const count = (table) => sql(`select count(*) from ${table} where farm_id = ${quote(farmId)}`);
console.log(`Demo ranch ready: ${DEMO_RANCH_NAME}
  camels ${count("camels")}, workers ${count("workers")}, reports ${count("reports")}, findings ${sql(`select count(*) from findings f join reports r on r.id = f.report_id where r.farm_id = ${quote(farmId)}`)},
  calls ${count("calls")}, tasks ${count("task_tickets")}, pending worker calls ${count("pending_worker_calls")}
  Login: ${EMAIL} / ${PASSWORD}`);
