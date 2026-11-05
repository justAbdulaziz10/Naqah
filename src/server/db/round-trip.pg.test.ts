import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { completeWorkerCallback, completeWorkerReport, confirmTask, recordOwnerInquiry, recordOwnerNotification, resolveWorkerCallAttempt, submitOwnerInstruction } from "@/domain/actions";
import { createDemoWorkspace } from "@/domain/seed";
import { heatWaterFinding } from "@/domain/weather";
import type { Workspace } from "@/domain/types";
import { diffWorkspace } from "./diff";
import { toDbId } from "./ids";
import { workspaceFromRows } from "./mappers";
import type { FarmRows } from "./rows";

/**
 * LOCAL ONLY. Runs real domain flows through the real migrations on a throwaway Postgres, so a
 * column or constraint that disagrees with the domain fails here. Skipped without
 * NAQAH_TEST_DB; run through supabase/local-validation/run-foundation.sh.
 */
const database = process.env.NAQAH_TEST_DB;
const ownerId = "00000000-0000-0000-0000-0000000000aa";
const start = new Date("2026-11-08T06:00:00.000Z");
const minutes = (n: number) => new Date(start.getTime() + n * 60_000);

function sql(query: string): string {
  return execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database!], {
    input: query,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = <T>(query: string): T => JSON.parse(sql(query) || "null") as T;
const all = <T>(table: string, farmId: string) => json<T[]>(`select coalesce(json_agg(t), '[]') from ${table} t where farm_id = ${quote(farmId)}`);

function loadRows(farmId: string): { rows: FarmRows; revision: number } {
  const farm = json<FarmRows["farm"]>(`select row_to_json(f) from farms f where id = ${quote(farmId)}`);
  const reports = json<FarmRows["reports"]>(`select coalesce(json_agg(json_build_object(
      'id', r.id, 'farm_id', r.farm_id, 'call_id', r.call_id, 'at', r.at,
      'report_answers', (select coalesce(json_agg(a), '[]') from report_answers a where a.report_id = r.id),
      'findings', (select coalesce(json_agg(f), '[]') from findings f where f.report_id = r.id))), '[]')
    from reports r where r.farm_id = ${quote(farmId)}`);
  const pending = json<FarmRows["pendingWorkerCalls"]>(`select coalesce(json_agg(to_jsonb(p) || jsonb_build_object(
      'worker_call_attempts', (select coalesce(json_agg(a), '[]') from worker_call_attempts a where a.pending_call_id = p.id))), '[]')
    from pending_worker_calls p where p.farm_id = ${quote(farmId)}`);
  return {
    revision: farm.revision,
    rows: {
      farm,
      worker: all<NonNullable<FarmRows["worker"]>>("workers", farmId)[0] ?? null,
      camels: all("camels", farmId),
      resources: all("resources", farmId),
      customQuestions: all("custom_questions", farmId),
      criteria: all("criteria", farmId),
      emergencies: all("emergency_categories", farmId),
      reports,
      calls: all("calls", farmId),
      taskTickets: all("task_tickets", farmId),
      noAnswerTickets: all("no_answer_tickets", farmId),
      pendingWorkerCalls: pending,
      relays: all("relays", farmId),
      events: all("events", farmId),
    },
  };
}

const DOMAIN_ID = /^[a-z]{2,5}_[0-9a-f]{10}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Compares meaning, not storage: ids as stored, instants as instants, id-keyed lists in id order. */
function comparable(value: unknown, farmId: string): unknown {
  if (typeof value === "string") {
    if (DOMAIN_ID.test(value)) return toDbId(farmId, value);
    return ISO.test(value) ? new Date(value).toISOString() : value;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => comparable(item, farmId));
    const keyed = items.every((item) => typeof (item as { id?: unknown })?.id === "string");
    return keyed ? items.sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id))) : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, comparable(v, farmId)]));
  }
  return value;
}

function seedFarm(): { farmId: string; ws: Workspace } {
  const demo = createDemoWorkspace("en", "ultimate");
  sql(`insert into auth.users values (${quote(ownerId)}) on conflict do nothing`);
  const farmId = sql(`insert into farms (owner_id, plan, setup_complete, owner_name, owner_phone, name, location, created_at)
    values (${quote(ownerId)}, 'ultimate', true, 'Abdullah', '+966501112222', 'Al Nakheel', 'Qassim', ${quote(demo.createdAt)}) returning id`).split("\n")[0];
  const ws: Workspace = {
    ...demo,
    reports: [], calls: [], taskTickets: [], noAnswerTickets: [], pendingWorkerCalls: [], relays: [], events: [],
    lastUpdateAt: null, ownerAllowanceUsedAt: null, missedNotificationAt: null, clockOffsetMs: 0, weather: undefined,
    settings: {
      ...demo.settings,
      owner: { name: "Abdullah", phone: "+966501112222" },
      farm: { name: "Al Nakheel", location: "Qassim", coords: null },
      worker: { ...demo.settings.worker, phone: "+966503334444" },
      window: null,
      integrations: undefined,
    },
  };
  const id = (value: string) => toDbId(farmId, value);
  sql(`insert into workers (farm_id, name, phone, language) values (${quote(farmId)}, ${quote(ws.settings.worker.name)}, ${quote(ws.settings.worker.phone)}, ${quote(ws.settings.worker.language)})`);
  for (const c of ws.camels) {
    sql(`insert into camels (id, farm_id, name, tag, sex, age_years, health, health_note, certainty, updated_at)
      values (${quote(id(c.id))}, ${quote(farmId)}, ${quote(c.name)}, ${quote(c.tag)}, ${quote(c.sex)}, ${c.ageYears ?? "null"}, ${quote(c.health)},
      ${c.healthNote === null ? "null" : quote(c.healthNote)}, ${quote(c.certainty)}, ${c.updatedAt === null ? "null" : quote(c.updatedAt)})`);
  }
  for (const r of ws.resources) {
    sql(`insert into resources (farm_id, kind, present, level, quantity, note, certainty, updated_at)
      values (${quote(farmId)}, ${quote(r.kind)}, ${r.present}, ${quote(r.level)}, ${r.quantity === null ? "null" : quote(r.quantity)},
      ${r.note === null ? "null" : quote(r.note)}, ${quote(r.certainty)}, ${r.updatedAt === null ? "null" : quote(r.updatedAt)})`);
  }
  for (const c of ws.settings.criteria) {
    sql(`insert into criteria (id, farm_id, kind, label, enabled) values (${quote(id(c.id))}, ${quote(farmId)}, ${quote(c.kind)}, ${c.label === null ? "null" : quote(c.label)}, ${c.enabled})`);
  }
  for (const e of ws.settings.emergencies) {
    sql(`insert into emergency_categories (id, farm_id, kind, label) values (${quote(id(e.id))}, ${quote(farmId)}, ${quote(e.kind)}, ${e.label === null ? "null" : quote(e.label)})`);
  }
  for (const q of ws.settings.customQuestions) {
    sql(`insert into custom_questions (id, farm_id, text, created_at) values (${quote(id(q.id))}, ${quote(farmId)}, ${quote(q.text)}, ${quote(q.createdAt)})`);
  }
  return { farmId, ws };
}

describe.skipIf(!database)("domain flows through the real schema", () => {
  let farmId: string;
  let current: Workspace;

  /** Save one action exactly as runFarmAction does, reload it, and require the same workspace. */
  function save(next: Workspace, providerCallId: string) {
    const { revision } = loadRows(farmId);
    const changes = diffWorkspace(current, next, farmId, { providerCallId });
    sql(`set role service_role; select apply_farm_changes(${quote(farmId)}, ${revision}, ${quote(JSON.stringify(changes))}::jsonb)`);
    const reloaded = workspaceFromRows(loadRows(farmId).rows);
    expect(comparable(reloaded, farmId)).toEqual(comparable(next, farmId));
    current = reloaded;
  }

  beforeAll(() => {
    const seeded = seedFarm();
    farmId = seeded.farmId;
    current = JSON.parse(JSON.stringify(workspaceFromRows(loadRows(farmId).rows))) as Workspace;
  });

  it("loads the seeded settings unchanged", () => {
    expect(current.settings.plan).toBe("ultimate");
    expect(current.camels.length).toBeGreaterThan(0);
    expect(current.resources.map((r) => r.kind)).toEqual(["feed", "water", "fences", "shelter", "medicine"]);
  });

  it("saves a report with answers, findings, camel and resource updates", () => {
    const camel = current.camels[0];
    const { ws } = completeWorkerReport(current, minutes(0), {
      answers: [
        { questionId: "herd_health", question: { ar: "س", en: "q" }, answer: "One is limping", certainty: "reported", followUp: false },
        { questionId: "feed_level", question: { ar: "س", en: "q" }, answer: "low", answerText: { ar: "قليل", en: "Low" }, certainty: "approximate", followUp: true },
      ],
      camelUpdates: [{ camelId: camel.id, health: "sick", note: "Limping", certainty: "reported" }],
      resourceUpdates: [{ kind: "feed", level: "low", quantity: "about 3 bags", note: null, certainty: "approximate" }],
      herdAccountedFor: false,
      taskConfirmations: [],
    });
    save(ws, "CA-report");
    expect(current.reports[0].answers.map((a) => a.questionId)).toEqual(["herd_health", "feed_level"]);
    expect(current.reports[0].findings.length).toBeGreaterThan(0);
    expect(current.lastUpdateAt).not.toBeNull();
  });

  it("keeps a heat-day finding that has no criterion row", () => {
    const report = completeWorkerReport(current, minutes(1), {
      answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [],
      extraFindings: [heatWaterFinding("fnd_00000000aa")],
    });
    save(report.ws, "CA-heat");
    expect(current.reports.flatMap((r) => r.findings).some((f) => f.criterionId === "weather_heat_day")).toBe(true);
  });

  it("records the owner notification and an inquiry", () => {
    save(recordOwnerNotification(current, minutes(2), current.reports[0].id, true), "CA-notify");
    save(recordOwnerInquiry(current, minutes(3), "unlimited"), "CA-inquiry");
    expect(current.calls.map((c) => c.kind)).toEqual(expect.arrayContaining(["owner_notification", "owner_inquiry"]));
  });

  it("takes an instruction through every retry to a No Answer ticket and back", () => {
    const instruction = submitOwnerInstruction(current, minutes(4), { message: "Check the east fence", actionable: true, scheduledFor: null });
    save(instruction.ws, "CA-instruction");
    const pendingId = current.pendingWorkerCalls[0].id;
    for (let attempt = 0; attempt < 4; attempt++) {
      save(resolveWorkerCallAttempt(current, minutes(5 + attempt * 20), pendingId, false).ws, `CA-attempt-${attempt}`);
    }
    expect(current.pendingWorkerCalls[0].attempts).toHaveLength(4);
    expect(current.noAnswerTickets.filter((t) => t.status === "open")).toHaveLength(1);

    save(completeWorkerCallback(current, minutes(100)), "CA-callback");
    expect(current.noAnswerTickets[0].status).toBe("closed");
    const log = current.calls.find((c) => c.kind === "worker_callback");
    expect(log?.ticketId).toBe(current.noAnswerTickets[0].id);
  });

  it("closes a task only on the worker's confirmation", () => {
    const task = current.taskTickets[0];
    save(confirmTask(current, minutes(120), task.id, false, "worker_report"), "CA-not-done");
    expect(current.taskTickets[0].status).toBe("open");
    save(confirmTask(current, minutes(130), task.id, true, "worker_report"), "CA-done");
    expect(current.taskTickets[0]).toMatchObject({ status: "closed", closedVia: "worker_report" });
  });

  it("stores no audio or transcript column", () => {
    const columns = sql(`select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public'`);
    expect(columns).not.toMatch(/audio|recording|transcript/);
  });
});
