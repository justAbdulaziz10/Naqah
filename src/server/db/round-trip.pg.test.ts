import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { completeWorkerCallback, completeWorkerReport, confirmTask, recordOwnerInquiry, recordOwnerNotification, resolveWorkerCallAttempt, submitOwnerInstruction } from "@/domain/actions";
import { createDemoWorkspace } from "@/domain/seed";
import { heatWaterFinding } from "@/domain/weather";
import type { Workspace } from "@/domain/types";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { diffWorkspace } from "./diff";
import { toDbId } from "./ids";
import { workspaceFromRows } from "./mappers";
import type { FarmRows } from "./rows";

/**
 * LOCAL ONLY. Runs real domain flows through the real migrations on a throwaway Postgres, so a
 * column or constraint that disagrees with the domain fails here. Skipped without
 * NAQAH_TEST_DB; run through supabase/local-validation/run-owner-runs.sh.
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
  const reports = json<FarmRows["reports"]>(`select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'report_answers', (select coalesce(json_agg(a), '[]') from report_answers a where a.report_id = r.id),
      'findings', (select coalesce(json_agg(f), '[]') from findings f where f.report_id = r.id))), '[]')
    from reports r where r.farm_id = ${quote(farmId)}`);
  const pending = json<FarmRows["pendingWorkerCalls"]>(`select coalesce(json_agg(to_jsonb(p) || jsonb_build_object(
      'worker_call_attempts', (select coalesce(json_agg(a), '[]') from worker_call_attempts a where a.pending_call_id = p.id),
      'pending_worker_call_tasks', (select coalesce(json_agg(t), '[]') from pending_worker_call_tasks t where t.pending_call_id = p.id))), '[]')
    from pending_worker_calls p where p.farm_id = ${quote(farmId)}`);
  return {
    revision: farm.revision,
    rows: {
      farm,
      workers: all("workers", farmId),
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
      reportCallRuns: all("report_call_runs", farmId),
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
      mode: "open",
      coverage: [{ questionId: "herd_health", status: "reported" }, { questionId: "feed_level", status: "reported" }, { questionId: "water_level", status: "not_reported" }, { questionId: "shelter_condition", status: "unknown" }],
      urgentNote: "She is limping",
      answers: [
        { questionId: "herd_health", question: { ar: "س", en: "q" }, answer: "One is limping", certainty: "reported", followUp: false },
        { questionId: "feed_level", question: { ar: "س", en: "q" }, answer: "low", answerText: { ar: "قليل", en: "Low" }, certainty: "approximate", followUp: true },
        { questionId: "shelter_condition", question: { ar: "س", en: "q" }, answer: "I don't know", certainty: "unknown", followUp: false },
      ],
      camelUpdates: [{ camelId: camel.id, health: "sick", note: "Limping", certainty: "reported" }],
      resourceUpdates: [{ kind: "feed", level: "low", quantity: "about 3 bags", note: null, certainty: "approximate" }],
      herdAccountedFor: false,
      taskConfirmations: [],
    });
    save(ws, "CA-report");
    expect(current.reports[0].answers.map((a) => a.questionId)).toEqual(["herd_health", "feed_level", "shelter_condition"]);
    expect(current.reports[0].findings.length).toBeGreaterThan(0);
    expect(current.reports[0]).toMatchObject({ mode: "open", coverage: [{ questionId: "herd_health", status: "reported" }, { questionId: "feed_level", status: "reported" }, { questionId: "water_level", status: "not_reported" }, { questionId: "shelter_condition", status: "unknown" }] });
    expect(current.reports[0].findings.filter((finding) => finding.criterionId === "worker_urgent")).toHaveLength(1);
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

  it("stops after three worker attempts and still closes a historical No Answer ticket", () => {
    const instruction = submitOwnerInstruction(current, minutes(4), { message: "Check the east fence", actionable: true, scheduledFor: null });
    save(instruction.ws, "CA-instruction");
    const pendingId = current.pendingWorkerCalls[0].id;
    for (let attempt = 0; attempt < 3; attempt++) {
      save(resolveWorkerCallAttempt(current, minutes(5 + attempt * 20), pendingId, "unanswered").ws, `CA-attempt-${attempt}`);
    }
    expect(current.pendingWorkerCalls[0].attempts).toHaveLength(3);
    expect(current.pendingWorkerCalls[0].state).toBe("no_answer_ticket");
    expect(current.noAnswerTickets).toHaveLength(0);

    const call = current.pendingWorkerCalls[0];
    const withHistory = {
      ...current,
      noAnswerTickets: [...current.noAnswerTickets, {
        id: "nat_aabbccddee",
        createdAt: call.attempts.at(-1)!.at,
        purpose: "instruction" as const,
        message: call.message,
        taskTicketId: call.taskTicketId,
        status: "open" as const,
        closedAt: null,
      }],
    };
    save(withHistory, "CA-historical");
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

  it("takes a report call through a missed attempt to an answered report with a herd count", () => {
    const day = (n: number) => minutes(24 * 60 + n);
    const started = startReportCall(current, day(0), "schedule");
    expect(started.blocked).toBeNull();
    save(started.ws, "CA-run-start");
    const runId = current.reportCalls![0].id;
    save(placeReportCallAttempt(current, day(0), runId).ws, "CA-run-1");
    save(resolveReportCallAttempt(current, day(1), runId, false).ws, "CA-run-1-status");
    expect(current.reportCalls![0]).toMatchObject({ state: "calling", attempts: [{ result: "no_answer" }] });
    expect(current.calls.at(-1)?.kind).toBe("worker_report_missed");

    save(placeReportCallAttempt(current, day(21), runId).ws, "CA-run-2");
    save(resolveReportCallAttempt(current, day(21), runId, true).ws, "CA-run-2-status");
    const report = completeWorkerReport(current, day(25), {
      answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [], herdCount: 40,
    }, runId);
    save(report.ws, "CA-run-2");
    expect(current.reportCalls![0]).toMatchObject({ state: "completed", reportId: current.reports.at(-1)!.id });
    expect(current.reports.at(-1)!.herdCountReported).toBe(40);
    expect(current.settings.herdCount ?? null).toBeNull(); // A worker's count never becomes the official one.
    expect(startReportCall(current, day(30), "manual", day(0)).blocked).not.toBeNull();
  });

  it("stores no audio or transcript column", () => {
    const columns = sql(`select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public'`);
    expect(columns).not.toMatch(/audio|recording|transcript/);
  });

  it("keeps the worker-claims wrapper as the public save entry point", () => {
    expect(sql(`select pg_get_functiondef('public.apply_farm_changes(uuid,bigint,jsonb,text,jsonb)'::regprocedure)`))
      .toContain("private.apply_farm_changes_before_worker_claims(");
  });

  it("keeps the save RPC invoker-only, with an empty search path and service-only execution", () => {
    const signature = "public.apply_farm_changes(uuid,bigint,jsonb,text,jsonb)";
    expect(json(`select json_build_object('definer', prosecdef, 'config', proconfig) from pg_proc where oid = '${signature}'::regprocedure`))
      .toEqual({ definer: false, config: ['search_path=""'] });
    for (const role of ["anon", "authenticated"]) {
      expect(sql(`select has_function_privilege('${role}', '${signature}', 'execute')`)).toBe("f");
    }
    expect(sql(`select has_function_privilege('service_role', '${signature}', 'execute')`)).toBe("t");
    expect(sql(`select count(*) from pg_proc function, lateral aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) permission
      where function.oid = '${signature}'::regprocedure and permission.privilege_type = 'EXECUTE'
      and permission.grantee not in (function.proowner, (select oid from pg_roles where rolname = 'service_role'))`)).toBe("0");
  });

  it("round-trips a dial claim together with every earlier save-wrapper write", () => {
    const now = minutes(2 * 24 * 60);
    const instruction = submitOwnerInstruction(current, now, { message: "Check the west fence", actionable: true, scheduledFor: null });
    const report = completeWorkerReport(instruction.ws, now, {
      mode: "open", coverage: [{ questionId: "water_level", status: "not_reported" }],
      answers: [{ questionId: "herd_health", question: { ar: "س", en: "q" }, answer: "All healthy", certainty: "reported", followUp: false }],
      camelUpdates: [{ camelId: current.camels[0].id, health: "healthy", note: null, certainty: "reported" }],
      resourceUpdates: [{ kind: "water", level: "low", quantity: null, note: "Refill", certainty: "reported" }],
      herdAccountedFor: true, taskConfirmations: [],
    }).ws;
    const pending = report.pendingWorkerCalls.find((call) => !current.pendingWorkerCalls.some((previous) => previous.id === call.id))!;
    const next: Workspace = {
      ...report,
      ownerCallRun: { id: "ocr_00000000ab", occurrence: now.toISOString(), reportId: report.reports.at(-1)!.id, attempts: [], nextAttemptAt: now.toISOString(), state: "calling" },
      pendingWorkerCalls: report.pendingWorkerCalls.map((call) => call.id === pending.id
        ? { ...call, dialClaimedAt: now.toISOString(), retryBase: 1, batchId: "save-chain-guard", coveredTaskIds: [call.taskTicketId!] }
        : call),
    };
    const revision = loadRows(farmId).revision;
    save(next, "CA-save-chain");
    expect(loadRows(farmId).revision).toBe(revision + 1);
    expect(comparable(current.pendingWorkerCalls.find((call) => call.id === toDbId(farmId, pending.id)), farmId))
      .toMatchObject({ dialClaimedAt: now.toISOString(), retryBase: 1, batchId: "save-chain-guard", coveredTaskIds: [toDbId(farmId, pending.taskTicketId!)] });
    expect(current.reports.at(-1)).toMatchObject({ mode: "open", coverage: [{ questionId: "water_level", status: "not_reported" }] });
    expect(current.ownerCallRun).toMatchObject({ reportId: current.reports.at(-1)!.id });

    const claimed = current.pendingWorkerCalls.find((call) => call.id === toDbId(farmId, pending.id))!;
    const changes = diffWorkspace(current, {
      ...current,
      pendingWorkerCalls: current.pendingWorkerCalls.map((call) => call.id === claimed.id ? { ...call, nextAttemptAt: minutes(2 * 24 * 60 + 20).toISOString() } : call),
    }, farmId);
    delete (changes.pending_worker_calls![0] as Record<string, unknown>).dial_claimed_at;
    sql(`set role service_role; select public.apply_farm_changes(${quote(farmId)}, ${revision + 1}, ${quote(JSON.stringify(changes))}::jsonb)`);
    current = workspaceFromRows(loadRows(farmId).rows);
    expect(comparable(current.pendingWorkerCalls.find((call) => call.id === claimed.id)?.dialClaimedAt, farmId)).toBe(now.toISOString());
    const clear = diffWorkspace(current, {
      ...current,
      pendingWorkerCalls: current.pendingWorkerCalls.map((call) => call.id === claimed.id ? { ...call, dialClaimedAt: null } : call),
    }, farmId);
    sql(`set role service_role; select public.apply_farm_changes(${quote(farmId)}, ${revision + 2}, ${quote(JSON.stringify(clear))}::jsonb)`);
    expect(sql(`select dial_claimed_at is null from public.pending_worker_calls where id = ${quote(claimed.id)} and farm_id = ${quote(farmId)}`)).toBe("t");
  });
});
