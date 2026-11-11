#!/usr/bin/env node
/**
 * LOCAL DEMO ONLY. Adds the weeks of history before the first day on record to the EXISTING presentation ranch
 * «عزبة الوسم (عرض تجريبي)»: daily reports and findings, briefings, instructions with retries, a missed report call
 * the worker returned, a No Answer ticket closed by a callback, closed tasks and two owner inquiries
 * (addEarlierHistory in presentation-ranch.ts, the same rows a fresh seed writes).
 *
 *   node scripts/demo/enrich-presentation.mjs --db-url postgresql://postgres@127.0.0.1:54350/naqah_test_call --dry-run
 *   node scripts/demo/enrich-presentation.mjs --db-url postgresql://postgres@127.0.0.1:54350/naqah_test_call
 *
 * Only adds rows, only for that one ranch, through apply_farm_changes (the voice service's path). Nothing is deleted
 * or updated: users, workers, settings, camels, resources, approved numbers and today's report stay as they are.
 * Every row has a fixed id, so running it again adds nothing. Loopback databases only. Take a backup first.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const DB_URL = arg("db-url");
const DRY_RUN = process.argv.includes("--dry-run");
if (!DB_URL) throw new Error("--db-url postgresql://user@127.0.0.1:<port>/<database> is required");
const host = (() => {
  try { return new URL(DB_URL).hostname; } catch { throw new Error("--db-url must be a postgresql:// URL"); }
})();
if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(host)) throw new Error("Local databases only (the --db-url host must be loopback)");

const PSQL = "/opt/homebrew/opt/postgresql@17/bin/psql";
const sql = (query) => execFileSync(PSQL, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB_URL], { input: query, encoding: "utf8", maxBuffer: 1 << 26 }).trim();
const quote = (value) => (value === null || value === undefined ? "null" : `'${String(value).replaceAll("'", "''")}'`);
const json = (query) => JSON.parse(sql(query) || "null");

const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src") } });
const { addEarlierHistory, DEMO_RANCH_NAME } = await jiti.import(join(ROOT, "scripts/demo/presentation-ranch.ts"));
const { createEmptyWorkspace } = await jiti.import(join(ROOT, "src/domain/seed.ts"));
const { diffWorkspace } = await jiti.import(join(ROOT, "src/server/db/diff.ts"));

const farms = json(`select coalesce(json_agg(json_build_object('id', id, 'revision', revision, 'created_at', created_at, 'plan', plan)), '[]') from farms where name = ${quote(DEMO_RANCH_NAME)}`);
if (farms.length !== 1) throw new Error(`Expected exactly one ranch named ${DEMO_RANCH_NAME}, found ${farms.length}`);
const farm = farms[0];
const f = quote(farm.id);
const worker = sql(`select w.name from farms f join workers w on w.id = f.primary_worker_id where f.id = ${f}`);
if (!worker) throw new Error("The ranch has no primary worker");
const criteria = json(`select coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'label', label, 'enabled', enabled)), '[]') from criteria where farm_id = ${f}`);
const customQuestions = json(`select coalesce(json_agg(json_build_object('id', id, 'text', text, 'createdAt', created_at)), '[]') from custom_questions where farm_id = ${f}`);
const firstReport = sql(`select min(at) from reports where farm_id = ${f}`);
const firstDay = firstReport ? new Date(firstReport) : new Date();

// The ranch as the generator needs it: its worker, criteria and questions, with no history.
const before = createEmptyWorkspace(farm.plan);
before.settings.worker = { ...before.settings.worker, name: worker };
before.settings.criteria = criteria;
before.settings.customQuestions = customQuestions;
const after = addEarlierHistory(before, firstDay, { notBefore: new Date(farm.created_at) });
const changes = diffWorkspace(before, after, farm.id);
for (const key of ["relays", "pending_worker_calls", "worker_call_attempts", "report_call_runs", "camels", "resources"]) {
  if (changes[key]?.length) throw new Error(`Unexpected ${key} changes`);
}
if (changes.farm) throw new Error("Unexpected farm changes");

// Idempotent: rows already present (by their fixed ids) are left alone.
const existing = (table, rows, scope = `farm_id = ${f}`) => {
  if (!rows.length) return new Set();
  const ids = rows.map((row) => quote(row.id)).join(",");
  return new Set(sql(`select id from ${table} where ${scope} and id in (${ids})`).split("\n").filter(Boolean));
};
const fresh = (table, rows, scope) => {
  const seen = existing(table, rows, scope);
  return rows.filter((row) => !seen.has(row.id));
};
const reports = fresh("reports", changes.reports);
const reportIds = new Set(reports.map((row) => row.id));
const add = {
  task_tickets: fresh("task_tickets", changes.task_tickets),
  no_answer_tickets: fresh("no_answer_tickets", changes.no_answer_tickets),
  reports,
  calls: fresh("calls", changes.calls),
  report_answers: changes.report_answers.filter((row) => reportIds.has(row.report_id)),
  findings: changes.findings.filter((row) => reportIds.has(row.report_id)),
  events: fresh("events", changes.events),
};
const total = Object.values(add).reduce((sum, rows) => sum + rows.length, 0);
const times = [...add.reports.map((row) => row.at), ...add.calls.map((row) => row.at)].sort();
console.log(`${DEMO_RANCH_NAME} (${farm.id})
  first day on record: ${firstReport ?? "none (anchored to today)"}
  to add: ${Object.entries(add).map(([table, rows]) => `${table} ${rows.length}`).join(", ")}
  ${times.length ? `from ${times[0]} to ${times.at(-1)}` : ""}`);
if (!total) {
  console.log("Nothing to add: this history is already there.");
  process.exit(0);
}
if (DRY_RUN) {
  console.log("Dry run: nothing written.");
  process.exit(0);
}
const revision = sql(`select public.apply_farm_changes(${f}, ${farm.revision}, ${quote(JSON.stringify(add))}::jsonb)`);
console.log(`Added ${total} rows (farm revision ${farm.revision} → ${revision}).`);
