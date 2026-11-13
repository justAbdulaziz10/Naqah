import { describe, expect, it } from "vitest";
import { completeWorkerReport, completeWorkerCallback, resolveWorkerCallAttempt, submitOwnerInstruction } from "@/domain/actions";
import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import { fromRiyadh } from "@/domain/clock";
import { reportDoneThisPeriod } from "@/domain/rules";
import type { Workspace } from "@/domain/types";
import { diffWorkspace, hasChanges } from "./diff";
import { isUuid, toDbId } from "./ids";
import { historyRows, workspaceFromRows } from "./mappers";
import { allPages } from "./queries";
import type { FarmRows } from "./rows";

const farmId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-08T09:00:00.000Z");

/** A workspace as it comes back from the database: every id is already a UUID. */
function stored(ws: Workspace): Workspace {
  const raw = JSON.stringify(ws).replace(/"([a-z]{2,5}_[0-9a-f]{10})"/g, (_m, id) => `"${toDbId(farmId, id)}"`);
  return JSON.parse(raw) as Workspace;
}

const draft = { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [] };

describe("ids", () => {
  it("keeps UUIDs and maps domain ids to the same UUID every time", () => {
    expect(toDbId(farmId, farmId)).toBe(farmId);
    expect(isUuid(toDbId(farmId, "tsk_abc"))).toBe(true);
    expect(toDbId(farmId, "tsk_abc")).toBe(toDbId(farmId, "tsk_abc"));
  });
  it("never shares an id between farms", () => {
    expect(toDbId(farmId, "tsk_abc")).not.toBe(toDbId("22222222-2222-4222-8222-222222222222", "tsk_abc"));
  });
});

describe("workspace rows", () => {
  const farm: FarmRows["farm"] = {
    id: farmId, owner_id: "o", plan: "basic", plan_selected_at: null, setup_complete: false, owner_name: "", owner_phone: "", name: "", location: "",
    latitude: null, longitude: null, supplier_name: "", supplier_phone: "", window_day: 4, window_start: "17:00:00",
    window_end: null, last_update_at: null, owner_allowance_used_at: null, missed_notification_at: null,
    call_day: null, call_time: null, herd_count: null, herd_count_reviewed_at: null, primary_worker_id: null,
    created_at: "2026-11-01T00:00:00+00:00", revision: 3,
  };
  const empty: FarmRows = {
    farm, workers: [], camels: [], resources: [], customQuestions: [], criteria: [], emergencies: [], reports: [], calls: [],
    taskTickets: [], noAnswerTickets: [], pendingWorkerCalls: [], reportCallRuns: [], relays: [], events: [],
  };
  const worker = (id: string, name: string, at: string) => ({ id, farm_id: farmId, name, phone: "", language: "ar" as const, created_at: at });
  it.each([
    ["ultimate", true], ["basic", true], ["ultimate", false], ["basic", false],
  ] as const)("round-trips %s cross-midnight report periods (scheduled: %s)", (plan, scheduled) => {
    const occurrence = fromRiyadh(2026, 11, 7, 23, 50);
    const savedAt = fromRiyadh(2026, 11, 8, 0, 10);
    const input = createEmptyWorkspace(plan);
    const runId = "rcl_1234567890";
    input.reportCalls = [{
      id: runId, trigger: "schedule", occurrence: occurrence.toISOString(), state: "answered", nextAttemptAt: null, reportId: null,
      attempts: [{ at: occurrence.toISOString(), result: "no_answer" }, { at: savedAt.toISOString(), result: "answered" }],
    }];
    const ws = completeWorkerReport(input, savedAt, draft, scheduled ? runId : undefined).ws;
    const rows = historyRows(ws, farmId);
    const loaded = workspaceFromRows({
      ...empty,
      farm: { ...farm, plan },
      reports: rows.reports.map((report) => ({ ...report, report_answers: [], findings: [] })),
      calls: rows.calls,
      reportCallRuns: rows.reportCallRuns,
    });
    expect(loaded.reportCalls?.[0].reportId).toBe(loaded.reports[0].id);
    expect(loaded.reports[0].at).toBe(savedAt.toISOString());
    // Saved on NAQAH's call or on the worker's returned call, the report answers the run's slot.
    expect(reportDoneThisPeriod(loaded, occurrence)).toBe(true);
    expect(reportDoneThisPeriod(loaded, savedAt)).toBe(false);
  });
  it("loads reports before the metadata columns exist and preserves them once present", () => {
    const legacy = { id: "report", farm_id: farmId, call_id: null, at: now.toISOString(), herd_count_reported: null, report_answers: [], findings: [] };
    const oldReport = workspaceFromRows({ ...empty, reports: [legacy] }).reports[0];
    expect(oldReport).not.toHaveProperty("mode");
    expect(oldReport).not.toHaveProperty("coverage");
    const coverage = [{ questionId: "feed_level", status: "not_reported" as const }];
    expect(workspaceFromRows({ ...empty, reports: [{ ...legacy, mode: "open", coverage }] }).reports[0]).toMatchObject({ mode: "open", coverage });
  });
  it("tells an absent owner-run column from an empty one, and drops a malformed run", () => {
    expect(workspaceFromRows(empty)).not.toHaveProperty("ownerCallRun");
    expect(workspaceFromRows({ ...empty, farm: { ...farm, owner_call_run: null } }).ownerCallRun).toBeNull();
    expect(workspaceFromRows({ ...empty, farm: { ...farm, owner_call_run: { id: 1 } } }).ownerCallRun).toBeNull();
    const run = { id: "r", occurrence: "2026-11-08T09:00:00+00:00", reportId: null, attempts: [{ at: "2026-11-08T09:00:00.000Z", result: "pending" }], nextAttemptAt: null, state: "calling" };
    expect(workspaceFromRows({ ...empty, farm: { ...farm, owner_call_run: run } }).ownerCallRun).toEqual({ ...run, occurrence: "2026-11-08T09:00:00.000Z" });
  });
  it("round-trips placement-unknown owner attempts through the existing JSON column", () => {
    const ws = workspaceFromRows(empty);
    const run = { id: "ocr_0123456789", occurrence: now.toISOString(), reportId: null, attempts: [{ at: now.toISOString(), result: "unanswered" as const, placementUnknown: true }], nextAttemptAt: null, state: "missed" as const };
    const changes = diffWorkspace(ws, { ...ws, ownerCallRun: run }, farmId);
    const saved = changes.farm!.owner_call_run;
    expect(saved).toEqual({ ...run, id: toDbId(farmId, run.id) });
    const loaded = workspaceFromRows({ ...empty, farm: { ...farm, owner_call_run: saved } });
    expect(loaded.ownerCallRun!.attempts).toEqual(run.attempts);
    expect(hasChanges(diffWorkspace(loaded, structuredClone(loaded), farmId))).toBe(false);
  });
  it("defaults the report mode and plan before the columns exist, and drops a malformed plan", () => {
    expect(workspaceFromRows(empty).settings).toMatchObject({ reportMode: "guided", questionPlan: [] });
    const entry = { id: "herd_health", enabled: false, required: true };
    expect(workspaceFromRows({ ...empty, farm: { ...farm, report_mode: "open", question_plan: [entry, { id: 1 }, null] } }).settings)
      .toMatchObject({ reportMode: "open", questionPlan: [entry] });
    expect(workspaceFromRows({ ...empty, farm: { ...farm, report_mode: "x" as never, question_plan: "x" } }).settings)
      .toMatchObject({ reportMode: "guided", questionPlan: [] });
  });
  it("reads the call schedule, herd count and the chosen primary worker", () => {
    const ws = workspaceFromRows({
      ...empty,
      farm: { ...farm, call_day: 4, call_time: "17:30:00", herd_count: 42, primary_worker_id: "w2" },
      workers: [worker("w1", "Salem", "2026-11-01T00:00:00Z"), worker("w2", "Ahmed", "2026-11-02T00:00:00Z")],
    });
    expect(ws.settings.callSchedule).toEqual({ day: 4, time: "17:30" });
    expect(ws.settings.herdCount).toBe(42);
    expect(ws.settings.worker.name).toBe("Ahmed");
    expect(ws.settings.otherWorkers?.map((w) => w.name)).toEqual(["Salem"]);
  });
  it("calls the oldest worker when no primary is chosen", () => {
    const ws = workspaceFromRows({ ...empty, workers: [worker("w1", "Salem", "2026-11-01T00:00:00Z"), worker("w2", "Ahmed", "2026-11-02T00:00:00Z")] });
    expect(ws.settings.worker.name).toBe("Salem");
  });
  it("matches report-call slots by their exact ISO time", () => {
    const ws = workspaceFromRows({
      ...empty,
      reportCallRuns: [{
        id: "r1", farm_id: farmId, occurrence: "2026-11-12 14:30:00+00", trigger: "schedule", attempts: [], next_attempt_at: null,
        state: "missed", report_id: null, provider_call_id: null,
      }],
    });
    expect(ws.reportCalls?.[0].occurrence).toBe("2026-11-12T14:30:00.000Z");
  });
  it("reads Postgres times and a half-chosen window", () => {
    expect(workspaceFromRows(empty).settings.window).toEqual({ day: 4, start: "17:00", end: "" });
  });
  it("defaults a missing worker instead of failing", () => {
    expect(workspaceFromRows(empty).settings.worker).toEqual({ name: "", phone: "", language: "ar" });
  });
  it("never carries the demo clock into production", () => {
    expect(workspaceFromRows(empty).clockOffsetMs).toBe(0);
  });
  it("keeps the heat-day finding without a criterion row", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    ws.reports.at(-1)!.findings.push({ id: "fnd_heat", criterionId: "weather_heat_day", text: { ar: "حر", en: "Heat" } });
    const row = historyRows(ws, farmId).findings.at(-1);
    expect(row).toMatchObject({ criterion_id: null, source: "weather_heat_day" });
  });
  it("sends a No Answer ticket on a call to its own column", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.noAnswerTickets.push({ id: "nat_1", createdAt: now.toISOString(), purpose: "instruction", message: "m", taskTicketId: null, status: "open", closedAt: null });
    const row = historyRows(completeWorkerCallback(ws, now), farmId).calls[0];
    expect(row.no_answer_ticket_id).toBe(toDbId(farmId, "nat_1"));
    expect(row.task_ticket_id).toBeNull();
  });
});

describe("change sets", () => {
  it("includes report metadata only when supplied, so old writes and rows stay valid", () => {
    const ws = stored(createDemoWorkspace("en", "ultimate"));
    const oldReport = completeWorkerReport(ws, now, draft).ws;
    expect(diffWorkspace(ws, oldReport, farmId).reports![0]).not.toHaveProperty("mode");
    expect(diffWorkspace(ws, oldReport, farmId).reports![0]).not.toHaveProperty("coverage");
    const coverage = [{ questionId: "feed_level", status: "not_reported" as const }];
    const next = completeWorkerReport(ws, now, { ...draft, mode: "open", coverage }).ws;
    expect(diffWorkspace(ws, next, farmId).reports![0]).toMatchObject({ mode: "open", coverage });
  });
  it("is empty when nothing changed", () => {
    const ws = stored(createDemoWorkspace("en", "ultimate"));
    expect(hasChanges(diffWorkspace(ws, ws, farmId))).toBe(false);
  });
  it("carries one report with its call, event and bookkeeping", () => {
    const ws = stored(createDemoWorkspace("en", "ultimate"));
    const saved = completeWorkerReport(ws, now, draft);
    const changes = diffWorkspace(ws, saved.ws, farmId, { providerCallId: "CA1" });
    expect(changes.reports).toHaveLength(1);
    expect(changes.calls).toEqual([expect.objectContaining({ kind: "worker_report", provider_call_id: "CA1" })]);
    expect(changes.farm).toEqual({ last_update_at: now.toISOString() });
    expect(changes.events?.length).toBeGreaterThan(0);
  });
  it("writes an owner run with database ids, and nothing when it didn't change", () => {
    const ws = { ...stored(createDemoWorkspace("en", "ultimate")), ownerCallRun: null };
    const reportId = toDbId(farmId, "rep_0123456789");
    const run = { id: "ocr_0123456789", occurrence: now.toISOString(), reportId, attempts: [{ at: now.toISOString(), result: "pending" as const }], nextAttemptAt: null, state: "calling" as const };
    expect(diffWorkspace(ws, { ...ws, ownerCallRun: run }, farmId).farm).toEqual({ owner_call_run: { ...run, id: toDbId(farmId, run.id), reportId } });
    expect(hasChanges(diffWorkspace({ ...ws, ownerCallRun: run }, { ...ws, ownerCallRun: run }, farmId))).toBe(false);
  });
  it("sends only new attempts", () => {
    const ws = stored(createEmptyWorkspace("ultimate"));
    const first = stored(submitOwnerInstruction(ws, now, { message: "m", actionable: true, scheduledFor: null }).ws);
    const pendingId = first.pendingWorkerCalls[0].id;
    const once = resolveWorkerCallAttempt(first, now, pendingId, "unanswered").ws;
    const twice = resolveWorkerCallAttempt(once, new Date(now.getTime() + 1_200_000), pendingId, "unanswered").ws;
    expect(diffWorkspace(once, twice, farmId).worker_call_attempts).toHaveLength(1);
  });
  it("refuses an action that edits settings or the herd", () => {
    const ws = stored(createDemoWorkspace("en", "ultimate"));
    expect(() => diffWorkspace(ws, { ...ws, settings: { ...ws.settings, plan: "basic" } }, farmId)).toThrow();
    expect(() => diffWorkspace(ws, { ...ws, camels: ws.camels.slice(1) }, farmId)).toThrow();
  });
  it("does not delete events the domain trimmed", () => {
    const ws = stored(createDemoWorkspace("en", "ultimate"));
    expect(diffWorkspace(ws, { ...ws, events: ws.events.slice(1) }, farmId).events).toEqual([]);
  });
});

describe("paged reads", () => {
  it("reads past the response cap and stops at the last page", async () => {
    const herd = Array.from({ length: 1_203 }, (_, id) => ({ id }));
    const pages: [number, number][] = [];
    const loaded = await allPages<{ id: number }>(async (from, to) => {
      pages.push([from, to]);
      return { data: herd.slice(from, to + 1), error: null };
    });
    expect(loaded).toHaveLength(1_203);
    expect(pages).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });
  it("surfaces a failed page instead of returning a short herd", async () => {
    await expect(allPages(async () => ({ data: null, error: { code: "XX000" } }))).rejects.toMatchObject({ code: "unavailable" });
  });
});
