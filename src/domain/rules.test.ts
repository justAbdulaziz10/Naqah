import { describe, expect, it } from "vitest";
import {
  completeWorkerCallback,
  completeWorkerReport,
  confirmTask,
  recordOwnerInquiry,
  recordOwnerNotification,
  resolveWorkerCallAttempt,
  startTaskVerification,
  submitOwnerInstruction,
} from "./actions";
import { fromRiyadh, isValidWindow, isWithinWindow, nextWindowStart, RETRY_DELAY_MS, weekKey } from "./clock";
import type { ReportDraft } from "./findings";
import { evaluateFindings, ownerBriefing } from "./findings";
import {
  applicableQuestions,
  canAddCustomQuestion,
  dueTaskVerifications,
  dueWorkerCalls,
  overdueScheduledTasks,
  routeOwnerInboundCall,
  routeWorkerInboundCall,
} from "./rules";
import { createDemoWorkspace, createEmptyWorkspace } from "./seed";
import type { Workspace } from "./types";

// Thursday 5 Nov 2026, 17:10 Riyadh.
const THU_1710 = fromRiyadh(2026, 11, 5, 17, 10);
const THU_1830 = fromRiyadh(2026, 11, 5, 18, 30);

const emptyDraft = (over: Partial<ReportDraft> = {}): ReportDraft => ({
  answers: [],
  camelUpdates: [],
  resourceUpdates: [],
  herdAccountedFor: true,
  taskConfirmations: [],
  ...over,
});

function basic(): Workspace {
  const ws = createDemoWorkspace("en", "basic", fromRiyadh(2026, 11, 3, 9, 0));
  ws.settings.window = { day: 4, start: "17:00", end: "18:00" };
  return ws;
}

function ultimate(): Workspace {
  return createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 5, 9, 0));
}

describe("clock", () => {
  it("evaluates the weekly window in Riyadh time", () => {
    const w = { day: 4 as const, start: "17:00", end: "18:00" };
    expect(isWithinWindow(THU_1710, w)).toBe(true);
    expect(isWithinWindow(THU_1830, w)).toBe(false);
    expect(nextWindowStart(THU_1830, w).toISOString()).toBe(fromRiyadh(2026, 11, 12, 17, 0).toISOString());
  });
  it("treats a window with a missing or malformed time as no window", () => {
    expect(isValidWindow({ day: 4, start: "17:00", end: "18:00" })).toBe(true);
    expect(isValidWindow({ day: 4, start: "", end: "18:00" })).toBe(false);
    expect(isValidWindow({ day: 4, start: "17:00", end: "" })).toBe(false);
    expect(isValidWindow({ day: 4, start: "18:00", end: "17:00" })).toBe(false);
    expect(isValidWindow({ day: 4, start: "17:00", end: "17:00" })).toBe(false);
    expect(isValidWindow({ day: 4, start: "17:00", end: "25:00" })).toBe(false);
  });

  it("weeks start on Sunday", () => {
    expect(weekKey(fromRiyadh(2026, 11, 7, 23, 59))).toBe("2026-11-01");
    expect(weekKey(fromRiyadh(2026, 11, 8, 0, 0))).toBe("2026-11-08");
  });
});

describe("setup rules", () => {
  it("skips predefined questions about absent resources", () => {
    const ws = createEmptyWorkspace();
    ws.resources = ws.resources.map((r) => ({ ...r, present: r.kind === "feed" }));
    const ids = applicableQuestions(ws).map((q) => q.id);
    expect(ids).toContain("feed_level");
    expect(ids).toContain("herd_health");
    expect(ids).not.toContain("water_level");
  });
  it("limits Basic to 5 custom questions, Ultimate unlimited", () => {
    const b = createEmptyWorkspace("basic");
    b.settings.customQuestions = Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, text: "x", createdAt: "" }));
    expect(canAddCustomQuestion(b)).toBe(false);
    const u = { ...b, settings: { ...b.settings, plan: "ultimate" as const } };
    expect(canAddCustomQuestion(u)).toBe(true);
  });
});

describe("worker inbound calls (Phase 2)", () => {
  it("Basic: rejects outside the window, accepts inside, then blocks a second weekly report", () => {
    const ws = basic();
    expect(routeWorkerInboundCall(ws, THU_1830)).toEqual({ kind: "rejected", reason: "outside_window" });
    expect(routeWorkerInboundCall(ws, THU_1710)).toEqual({ kind: "report" });
    const after = completeWorkerReport(ws, THU_1710, emptyDraft()).ws;
    expect(routeWorkerInboundCall(after, fromRiyadh(2026, 11, 5, 17, 40))).toEqual({ kind: "rejected", reason: "weekly_done" });
  });
  it("Basic: a draft window with only an end time does not accept reports", () => {
    const ws = createDemoWorkspace("en", "basic");
    ws.reports = [];
    ws.settings.window = { day: 4, start: "", end: "23:00" };
    expect(routeWorkerInboundCall(ws, new Date("2026-11-05T12:00:00Z"))).toEqual({ kind: "rejected", reason: "no_window" });
  });

  it("Ultimate: one report per day", () => {
    const ws = ultimate();
    expect(routeWorkerInboundCall(ws, THU_1710).kind).toBe("report");
    const after = completeWorkerReport(ws, THU_1710, emptyDraft()).ws;
    expect(routeWorkerInboundCall(after, THU_1830)).toEqual({ kind: "rejected", reason: "daily_done" });
    expect(routeWorkerInboundCall(after, fromRiyadh(2026, 11, 6, 17, 0)).kind).toBe("report");
  });
  it("routes to callback when a No Answer Ticket is open, even outside Basic's window", () => {
    const sub = submitOwnerInstruction(basic(), THU_1830, { message: "Fix the gate", actionable: true, scheduledFor: null });
    let ws = sub.ws;
    const id = sub.pendingCallId;
    for (let i = 0; i < 4; i++) ws = resolveWorkerCallAttempt(ws, new Date(THU_1830.getTime() + i * RETRY_DELAY_MS), id, false).ws;
    expect(ws.noAnswerTickets).toHaveLength(1);
    expect(routeWorkerInboundCall(ws, fromRiyadh(2026, 11, 6, 9, 0)).kind).toBe("callback");
    const reportsBefore = ws.reports.length;
    ws = completeWorkerCallback(ws, fromRiyadh(2026, 11, 6, 9, 0));
    expect(ws.noAnswerTickets[0].status).toBe("closed");
    expect(ws.reports.length).toBe(reportsBefore); // callback is not a farm update
    expect(ws.relays[0].delivered).toBe(true);
  });
});

describe("AI → worker calls (Phase 7)", () => {
  it("retries 3 times, 20 minutes apart, then opens a No Answer Ticket", () => {
    const sub = submitOwnerInstruction(ultimate(), THU_1710, { message: "Refill water", actionable: true, scheduledFor: null });
    let ws = sub.ws;
    const id = sub.pendingCallId;
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = resolveWorkerCallAttempt(ws, new Date(THU_1710.getTime() + i * RETRY_DELAY_MS), id, false);
      ws = r.ws;
      outcomes.push(r.outcome);
    }
    expect(outcomes).toEqual(["retry_scheduled", "retry_scheduled", "retry_scheduled", "no_answer_ticket"]);
    expect(ws.noAnswerTickets[0].status).toBe("open");
    expect(ws.taskTickets.find((t) => t.instruction === "Refill water")?.status).toBe("open");
  });
});

describe("tickets (Phases 6 & 8)", () => {
  it("Basic relays instructions without a Task Ticket", () => {
    const { ws, taskId } = submitOwnerInstruction(basic(), THU_1710, { message: "Fix the gate", actionable: true, scheduledFor: null });
    expect(taskId).toBeNull();
    expect(ws.taskTickets).toHaveLength(0);
    expect(ws.relays).toHaveLength(1);
  });
  it("Ultimate actionable instruction opens a ticket; only explicit confirmation closes it", () => {
    const at = fromRiyadh(2026, 11, 5, 19, 0).toISOString();
    const sub = submitOwnerInstruction(ultimate(), THU_1710, { message: "Fix the gate", actionable: true, scheduledFor: at });
    let ws = sub.ws;
    const taskId = sub.taskId!;
    const afterDeadline = fromRiyadh(2026, 11, 6, 9, 0);
    expect(ws.taskTickets.find((t) => t.id === taskId)?.status).toBe("open");
    expect(overdueScheduledTasks(ws, afterDeadline).map((t) => t.id)).toContain(taskId);
    expect(dueTaskVerifications(ws, afterDeadline).map((t) => t.id)).not.toContain(taskId);
    ws = resolveWorkerCallAttempt(ws, THU_1710, sub.pendingCallId, true).ws;
    expect(dueTaskVerifications(ws, afterDeadline).map((t) => t.id)).toContain(taskId);
    ws = confirmTask(ws, THU_1830, taskId, false, "worker_task_verification");
    expect(ws.taskTickets.find((t) => t.id === taskId)?.status).toBe("open");
    ws = confirmTask(ws, THU_1830, taskId, true, "worker_task_verification");
    expect(ws.taskTickets.find((t) => t.id === taskId)?.status).toBe("closed");
  });
  it("Ultimate information-only message creates no ticket", () => {
    const { taskId } = submitOwnerInstruction(ultimate(), THU_1710, { message: "Guests arrive Friday", actionable: false, scheduledFor: null });
    expect(taskId).toBeNull();
  });
  it("keeps an overdue task open for follow-up without another verification cycle", () => {
    const ws = ultimate();
    const task = "scheduled-review";
    const withDeliveredCall = {
      ...ws,
      taskTickets: [...ws.taskTickets, {
        id: task,
        instruction: "Check the shade net",
        createdAt: THU_1710.toISOString(),
        scheduledFor: fromRiyadh(2026, 11, 5, 18, 0).toISOString(),
        status: "open" as const,
        closedAt: null,
        closedVia: null,
      }],
      pendingWorkerCalls: [{
        id: "verification-delivered",
        purpose: "task_verification" as const,
        message: "Check the shade net",
        taskTicketId: task,
        relayId: null,
        attempts: [{ at: THU_1710.toISOString(), answered: true }],
        nextAttemptAt: null,
        state: "delivered" as const,
      }],
    };
    const tomorrow = fromRiyadh(2026, 11, 6, 9, 0);
    expect(dueTaskVerifications(withDeliveredCall, tomorrow).map((item) => item.id)).not.toContain(task);
    expect(overdueScheduledTasks(withDeliveredCall, tomorrow).map((item) => item.id)).toContain(task);

    const withPendingCall = {
      ...withDeliveredCall,
      pendingWorkerCalls: [{
        ...withDeliveredCall.pendingWorkerCalls[0],
        state: "pending" as const,
        nextAttemptAt: THU_1710.toISOString(),
      }],
    };
    expect(dueTaskVerifications(withPendingCall, tomorrow).map((item) => item.id)).not.toContain(task);
    expect(dueWorkerCalls(withPendingCall, tomorrow).map((call) => call.id)).toContain("verification-delivered");

    const withNoAnswerTicket = {
      ...withDeliveredCall,
      pendingWorkerCalls: [{
        ...withDeliveredCall.pendingWorkerCalls[0],
        id: "verification-no-answer",
        state: "no_answer_ticket" as const,
      }],
    };
    expect(dueTaskVerifications(withNoAnswerTicket, tomorrow).map((item) => item.id)).not.toContain(task);
    expect(overdueScheduledTasks(withNoAnswerTicket, tomorrow).map((item) => item.id)).toContain(task);
  });
});

describe("scheduled verification cycle", () => {
  const dueAt = fromRiyadh(2026, 11, 5, 18, 0);

  function deliveredScheduledTask() {
    const sub = submitOwnerInstruction(ultimate(), THU_1710, {
      message: "Check the shade net",
      actionable: true,
      scheduledFor: dueAt.toISOString(),
    });
    const delivered = resolveWorkerCallAttempt(sub.ws, THU_1710, sub.pendingCallId, true);
    return { ws: delivered.ws, taskId: sub.taskId! };
  }

  it("starts one verification and does not create another for the same task", () => {
    const { ws, taskId } = deliveredScheduledTask();
    expect(dueTaskVerifications(ws, dueAt).map((task) => task.id)).toContain(taskId);
    const first = startTaskVerification(ws, dueAt, taskId);
    const verifications = (workspace: Workspace) =>
      workspace.pendingWorkerCalls.filter((call) => call.purpose === "task_verification" && call.taskTicketId === taskId);
    expect(verifications(first.ws)).toHaveLength(1);
    expect(first.pendingCallId).toBe(verifications(first.ws)[0].id);
    expect(dueTaskVerifications(first.ws, dueAt).map((task) => task.id)).not.toContain(taskId);
    const second = startTaskVerification(first.ws, dueAt, taskId);
    expect(second.pendingCallId).toBe(first.pendingCallId);
    expect(verifications(second.ws)).toHaveLength(1);
    expect(second.ws.pendingWorkerCalls).toHaveLength(first.ws.pendingWorkerCalls.length);
  });

  it("does not verify a scheduled task before its instruction is delivered", () => {
    const sub = submitOwnerInstruction(ultimate(), THU_1710, {
      message: "Check the shade net",
      actionable: true,
      scheduledFor: dueAt.toISOString(),
    });
    expect(dueTaskVerifications(sub.ws, dueAt).map((task) => task.id)).not.toContain(sub.taskId);
    let ws = sub.ws;
    for (let i = 0; i < 4; i++) {
      ws = resolveWorkerCallAttempt(ws, new Date(THU_1710.getTime() + i * RETRY_DELAY_MS), sub.pendingCallId, false).ws;
    }
    expect(ws.pendingWorkerCalls.find((call) => call.id === sub.pendingCallId)?.state).toBe("no_answer_ticket");
    expect(dueTaskVerifications(ws, new Date(dueAt.getTime() + 4 * RETRY_DELAY_MS)).map((task) => task.id)).not.toContain(sub.taskId);
    expect(overdueScheduledTasks(ws, dueAt).map((task) => task.id)).toContain(sub.taskId);
  });

  it("retries the same verification three times, then blocks another cycle", () => {
    const { ws, taskId } = deliveredScheduledTask();
    const started = startTaskVerification(ws, dueAt, taskId);
    let current = started.ws;
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const at = new Date(dueAt.getTime() + i * RETRY_DELAY_MS);
      const result = resolveWorkerCallAttempt(current, at, started.pendingCallId, false);
      current = result.ws;
      outcomes.push(result.outcome);
      if (i < 3) {
        const call = current.pendingWorkerCalls.find((item) => item.id === started.pendingCallId);
        expect(call?.state).toBe("pending");
        expect(call?.nextAttemptAt).toBe(new Date(dueAt.getTime() + (i + 1) * RETRY_DELAY_MS).toISOString());
        expect(dueWorkerCalls(current, new Date(dueAt.getTime() + (i + 1) * RETRY_DELAY_MS)).map((item) => item.id)).toContain(started.pendingCallId);
        expect(dueTaskVerifications(current, new Date(dueAt.getTime() + (i + 1) * RETRY_DELAY_MS)).map((task) => task.id)).not.toContain(taskId);
      }
    }
    expect(outcomes).toEqual(["retry_scheduled", "retry_scheduled", "retry_scheduled", "no_answer_ticket"]);
    expect(current.taskTickets.find((task) => task.id === taskId)?.status).toBe("open");
    expect(current.noAnswerTickets.some((ticket) => ticket.taskTicketId === taskId && ticket.status === "open")).toBe(true);
    const again = startTaskVerification(current, new Date(dueAt.getTime() + 4 * RETRY_DELAY_MS), taskId);
    expect(again.pendingCallId).toBe(started.pendingCallId);
    expect(again.ws.pendingWorkerCalls.filter((call) => call.purpose === "task_verification" && call.taskTicketId === taskId)).toHaveLength(1);
  });

  it("leaves the ticket open after not yet and does not start another cycle", () => {
    const { ws, taskId } = deliveredScheduledTask();
    const started = startTaskVerification(ws, dueAt, taskId);
    const answered = resolveWorkerCallAttempt(started.ws, dueAt, started.pendingCallId, true);
    const open = confirmTask(answered.ws, dueAt, taskId, false, "worker_task_verification");
    const later = fromRiyadh(2026, 11, 6, 9, 0);
    expect(open.taskTickets.find((task) => task.id === taskId)?.status).toBe("open");
    expect(dueTaskVerifications(open, later).map((task) => task.id)).not.toContain(taskId);
    expect(overdueScheduledTasks(open, later).map((task) => task.id)).toContain(taskId);
    const again = startTaskVerification(open, later, taskId);
    expect(again.pendingCallId).toBe(started.pendingCallId);
    expect(again.ws.pendingWorkerCalls.filter((call) => call.purpose === "task_verification" && call.taskTicketId === taskId)).toHaveLength(1);
  });

  it("closes only the confirmed task", () => {
    const { ws, taskId } = deliveredScheduledTask();
    const started = startTaskVerification(ws, dueAt, taskId);
    const answered = resolveWorkerCallAttempt(started.ws, dueAt, started.pendingCallId, true);
    const closed = confirmTask(answered.ws, dueAt, taskId, true, "worker_task_verification");
    expect(closed.taskTickets.find((task) => task.id === taskId)?.status).toBe("closed");
    expect(overdueScheduledTasks(closed, dueAt).map((task) => task.id)).not.toContain(taskId);
    expect(dueTaskVerifications(closed, dueAt).map((task) => task.id)).not.toContain(taskId);
  });

  it("does not schedule a verification for an Any Time task", () => {
    const sub = submitOwnerInstruction(ultimate(), THU_1710, {
      message: "Move Wadha",
      actionable: true,
      scheduledFor: null,
    });
    const delivered = resolveWorkerCallAttempt(sub.ws, THU_1710, sub.pendingCallId, true).ws;
    expect(dueTaskVerifications(delivered, dueAt).map((task) => task.id)).not.toContain(sub.taskId);
    expect(overdueScheduledTasks(delivered, dueAt).map((task) => task.id)).not.toContain(sub.taskId);
    expect(delivered.taskTickets.find((task) => task.id === sub.taskId)?.status).toBe("open");
  });
});

describe("owner calls (Phases 4–5)", () => {
  it("Basic: answered notification consumes the weekly owner call", () => {
    let ws = basic();
    const { ws: w2, report } = completeWorkerReport(ws, THU_1710, emptyDraft());
    ws = recordOwnerNotification(w2, THU_1710, report.id, true);
    expect(routeOwnerInboundCall(ws, THU_1830)).toEqual({ kind: "rejected", reason: "allowance_used" });
  });
  it("Basic: missed notification leaves one callback", () => {
    let ws = basic();
    const { ws: w2, report } = completeWorkerReport(ws, THU_1710, emptyDraft());
    ws = recordOwnerNotification(w2, THU_1710, report.id, false);
    expect(routeOwnerInboundCall(ws, THU_1830)).toEqual({ kind: "inquiry", mode: "missed_callback" });
    ws = recordOwnerInquiry(ws, THU_1830, "missed_callback");
    expect(routeOwnerInboundCall(ws, THU_1830).kind).toBe("rejected");
  });
  it("Ultimate owner inquiries are unlimited", () => {
    let ws = ultimate();
    ws = recordOwnerInquiry(ws, THU_1710, "unlimited");
    expect(routeOwnerInboundCall(ws, THU_1830)).toEqual({ kind: "inquiry", mode: "unlimited" });
  });
});

describe("findings", () => {
  it("flags only enabled criteria and leads the briefing with them", () => {
    const ws = ultimate();
    const draft = emptyDraft({
      camelUpdates: [{ camelId: ws.camels[0].id, health: "sick", note: "limping", certainty: "reported" }],
      resourceUpdates: [{ kind: "feed", level: "low", quantity: "12 bags", note: null, certainty: "approximate" }],
    });
    const findings = evaluateFindings(ws, draft);
    expect(findings).toHaveLength(2);
    expect(ownerBriefing(findings).en).toContain("Wadha is sick");
    expect(ownerBriefing([]).en).toContain("nothing important");
  });
  it("matches custom criteria in either answer language and localizes the finding", () => {
    const ws = ultimate();
    ws.settings.criteria = [{ id: "custom", kind: "custom", label: "مريضة", enabled: true }];
    const findings = evaluateFindings(ws, emptyDraft({
      answers: [{
        questionId: "custom-health",
        question: { ar: "كيف حال وضحة؟", en: "How is Wadha?" },
        answer: "Sick",
        answerText: { ar: "مريضة", en: "Sick" },
        certainty: "reported",
        followUp: false,
      }],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].text).toEqual({ ar: "مريضة: «مريضة»", en: "مريضة: “Sick”" });
  });
});
