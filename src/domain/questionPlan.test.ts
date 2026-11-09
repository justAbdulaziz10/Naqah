import { describe, expect, it } from "vitest";
import { PREDEFINED_QUESTIONS } from "./catalog";
import { fromRiyadh } from "./clock";
import { claimDueReportCall, placeReportCallAttempt, reportCallBlock, resolveReportCallAttempt, startReportCall } from "./reportCalls";
import { moveQuestionInPlan, plannedQuestions, questionPlanRows, reportModeOf, reportPlanHasContent } from "./rules";
import { createDemoWorkspace, createEmptyWorkspace } from "./seed";
import type { QuestionPlanEntry, Settings, TaskTicket, Workspace } from "./types";

const now = fromRiyadh(2026, 11, 9, 12, 0);
const ids = (ws: Workspace) => plannedQuestions(ws).map((planned) => planned.question.id);
const off = (id: string): QuestionPlanEntry => ({ id, enabled: false, required: true });
const on = (id: string, required = true): QuestionPlanEntry => ({ id, enabled: true, required });
const allOff = () => PREDEFINED_QUESTIONS.map((question) => off(question.id));

function ranch(settings: Partial<Settings> = {}, edit: (ws: Workspace) => void = () => undefined): Workspace {
  const ws = createDemoWorkspace("en", "basic");
  ws.resources.forEach((resource) => { resource.present = true; });
  ws.settings = { ...ws.settings, customQuestions: [{ id: "cq_a", text: "A?", createdAt: "x" }, { id: "cq_b", text: "B?", createdAt: "x" }], ...settings };
  edit(ws);
  return ws;
}

const task = (over: Partial<TaskTicket>): TaskTicket => ({
  id: "tsk_1", instruction: "Fix the gate", createdAt: now.toISOString(), scheduledFor: null, status: "open", closedAt: null, closedVia: null, ...over,
});

describe("plannedQuestions", () => {
  it("with no plan keeps today's order, everything on and required", () => {
    const ws = ranch();
    expect(ids(ws)).toEqual([...PREDEFINED_QUESTIONS.map((q) => q.id), "cq_a", "cq_b"]);
    expect(plannedQuestions(ws).every((planned) => planned.required)).toBe(true);
  });
  it("treats a workspace stored before plans existed the same way", () => {
    const ws = ranch();
    delete (ws.settings as Partial<Settings>).questionPlan;
    delete (ws.settings as Partial<Settings>).reportMode;
    expect(ids(ws)).toEqual([...PREDEFINED_QUESTIONS.map((q) => q.id), "cq_a", "cq_b"]);
    expect(reportModeOf(ws)).toBe("guided");
    expect(reportPlanHasContent(ws, now)).toBe(true);
  });
  it("follows the owner's order and required flags, across NAQAH's and custom questions", () => {
    const ws = ranch({ questionPlan: [on("cq_b", false), on("water_level"), on("herd_health"), on("cq_a")] });
    expect(ids(ws).slice(0, 4)).toEqual(["cq_b", "water_level", "herd_health", "cq_a"]);
    expect(plannedQuestions(ws)[0]).toMatchObject({ kind: "custom", required: false });
  });
  it("leaves out what is switched off, camel health included", () => {
    expect(ids(ranch({ questionPlan: [off("herd_health"), off("cq_a")] }))).not.toEqual(expect.arrayContaining(["herd_health"]));
    expect(ids(ranch({ questionPlan: [off("cq_a")] }))).not.toContain("cq_a");
  });
  it("skips a resource the ranch doesn't have, without losing its place", () => {
    const ws = ranch({ questionPlan: [on("feed_level"), on("herd_health")] }, (w) => { w.resources.find((r) => r.kind === "feed")!.present = false; });
    expect(ids(ws)).not.toContain("feed_level");
    expect(questionPlanRows(ws)[0]).toMatchObject({ applicable: false, question: { id: "feed_level" } });
  });
  it("skips the herd check until a herd size is known", () => {
    const empty = createEmptyWorkspace("basic");
    expect(ids(empty)).not.toContain("herd_count");
    expect(ids({ ...empty, settings: { ...empty.settings, herdCount: 12 } })).toContain("herd_count");
  });
  it("puts new custom questions last, on and required", () => {
    const ws = ranch({ questionPlan: PREDEFINED_QUESTIONS.map((q) => on(q.id)) });
    expect(ids(ws).slice(-2)).toEqual(["cq_a", "cq_b"]);
    expect(plannedQuestions(ws).at(-1)).toMatchObject({ required: true });
  });
  it("adds predefined questions the plan doesn't know in catalog order, before new custom ones", () => {
    const ws = ranch({ questionPlan: [on("cq_a"), on("water_level")] });
    expect(ids(ws)).toEqual(["cq_a", "water_level", ...PREDEFINED_QUESTIONS.map((q) => q.id).filter((id) => id !== "water_level"), "cq_b"]);
  });
  it("ignores ids that no longer exist and repeated ids", () => {
    const ws = ranch({ questionPlan: [on("gone"), on("cq_a"), off("cq_a")] });
    expect(ids(ws)).toContain("cq_a");
    expect(questionPlanRows(ws).some((row) => row.question.id === "gone")).toBe(false);
  });
});

describe("moving a question", () => {
  it("swaps neighbours among the questions this ranch is asked", () => {
    const ws = ranch({ questionPlan: [on("herd_health"), on("feed_level"), on("water_level")] }, (w) => { w.resources.find((r) => r.kind === "feed")!.present = false; });
    const moved = moveQuestionInPlan(questionPlanRows(ws), "water_level", -1).map((row) => row.question.id);
    expect(moved.slice(0, 3)).toEqual(["water_level", "feed_level", "herd_health"]);
  });
  it("stops at the ends of the list", () => {
    const rows = questionPlanRows(ranch());
    expect(moveQuestionInPlan(rows, rows[0].question.id, -1)).toBe(rows);
    expect(moveQuestionInPlan(rows, rows.at(-1)!.question.id, 1)).toBe(rows);
  });
});

describe("a call with nothing to ask", () => {
  const silent = ranch({ customQuestions: [], questionPlan: allOff() });
  it("has no content with every question off", () => {
    expect(reportPlanHasContent(silent, now)).toBe(false);
    expect(reportPlanHasContent(ranch({ customQuestions: [], questionPlan: [on("herd_health"), ...allOff().slice(1)] }), now)).toBe(true);
  });
  it("counts a follow-up task only on Ultimate, and only once its time has come", () => {
    const withTask = (plan: Settings["plan"], over: Partial<TaskTicket>) => ({ ...silent, settings: { ...silent.settings, plan }, taskTickets: [task(over)] });
    expect(reportPlanHasContent(withTask("ultimate", {}), now)).toBe(true);
    expect(reportPlanHasContent(withTask("basic", {}), now)).toBe(false);
    expect(reportPlanHasContent(withTask("ultimate", { scheduledFor: new Date(now.getTime() - 60_000).toISOString() }), now)).toBe(true);
    expect(reportPlanHasContent(withTask("ultimate", { scheduledFor: new Date(now.getTime() + 60_000).toISOString() }), now)).toBe(false);
    expect(reportPlanHasContent(withTask("ultimate", { status: "closed" }), now)).toBe(false);
  });
  it("blocks the report call, and the scheduler places nothing", () => {
    const ws: Workspace = { ...silent, reports: [], settings: { ...silent.settings, worker: { ...silent.settings.worker, phone: "+966501234567" }, plan: "ultimate", callSchedule: { day: null, time: "11:58" } } };
    expect(reportCallBlock(ws, now)).toBe("no_questions");
    expect(claimDueReportCall(ws, now).claim).toBeNull();
  });
  it("says already reported first when the period's report is in", () => {
    const ws = ranch({ customQuestions: [], questionPlan: allOff() }, (w) => {
      w.settings.worker.phone = "+966501234567";
      w.reports = [{ id: "r1", at: now.toISOString(), callId: "", answers: [], findings: [] }];
    });
    expect(reportCallBlock(ws, now)).toBe("already_reported");
  });
});

describe("catalog", () => {
  it("shows the herd question the call actually asks", () => {
    expect(PREDEFINED_QUESTIONS.find((q) => q.id === "herd_count")?.text).toEqual({ en: "How many camels are there in total today?", ar: "كم عدد الحلال كله اليوم؟" });
  });
});

describe("a retry left waiting while every question was off", () => {
  it("is given up instead of ringing for an old slot", () => {
    const start = fromRiyadh(2026, 11, 5, 17, 0);
    const ws = createDemoWorkspace("ar", "ultimate", start);
    ws.reports = [];
    const opened = startReportCall(ws, start, "schedule", start);
    const placed = placeReportCallAttempt(opened.ws, start, opened.run!.id).ws;
    const waiting = resolveReportCallAttempt(placed, start, opened.run!.id, false).ws;
    const later = new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000);
    const { ws: next, claim } = claimDueReportCall(waiting, later);
    expect(claim).toBeNull();
    expect(next.reportCalls?.find((run) => run.id === opened.run!.id)?.state).toBe("missed");
  });
});
