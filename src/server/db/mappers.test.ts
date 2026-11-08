import { describe, expect, it } from "vitest";
import { completeWorkerReport, completeWorkerCallback, resolveWorkerCallAttempt, submitOwnerInstruction } from "@/domain/actions";
import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
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
  it("is empty when nothing changed", () => {
    const ws = stored(createDemoWorkspace("en", "ultimate"));
    expect(hasChanges(diffWorkspace(ws, ws, farmId))).toBe(false);
  });
  it("carries one report with its call, event and bookkeeping", () => {
    const ws = stored(createDemoWorkspace("en", "ultimate"));
    const changes = diffWorkspace(ws, completeWorkerReport(ws, now, draft).ws, farmId, { providerCallId: "CA1" });
    expect(changes.reports).toHaveLength(1);
    expect(changes.calls).toEqual([expect.objectContaining({ kind: "worker_report", provider_call_id: "CA1" })]);
    expect(changes.farm).toEqual({ last_update_at: now.toISOString() });
    expect(changes.events?.length).toBeGreaterThan(0);
  });
  it("sends only new attempts", () => {
    const ws = stored(createEmptyWorkspace("ultimate"));
    const first = stored(submitOwnerInstruction(ws, now, { message: "m", actionable: true, scheduledFor: null }).ws);
    const pendingId = first.pendingWorkerCalls[0].id;
    const once = resolveWorkerCallAttempt(first, now, pendingId, false).ws;
    const twice = resolveWorkerCallAttempt(once, new Date(now.getTime() + 1_200_000), pendingId, false).ws;
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
