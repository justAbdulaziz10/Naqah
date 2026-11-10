import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";
import type { PendingWorkerCall, Plan, ReportCallRun, Workspace } from "@/domain/types";
import { eventAllowed, parseVoiceEvent, voiceStep } from "./contract";

const base = { version: 1, eventId: "e1", providerCallId: "CA1" };
const now = new Date("2026-11-08T12:00:00.000Z");
const later = new Date(now.getTime() + 20 * 60_000);
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const CALL = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const event = (extra: object) => parseVoiceEvent({ ...base, ...extra });

function farm(plan: Plan = "ultimate", purpose: PendingWorkerCall["purpose"] = "task_verification"): Workspace {
  const ws = createEmptyWorkspace(plan);
  for (const id of [T1, T2]) {
    ws.taskTickets.push({ id, instruction: "i", createdAt: now.toISOString(), scheduledFor: now.toISOString(), status: "open", closedAt: null, closedVia: null });
  }
  ws.pendingWorkerCalls.push({ id: CALL, purpose, message: "m", taskTicketId: null, relayId: null, attempts: [], nextAttemptAt: now.toISOString(), state: "pending", coveredTaskIds: [T1, T2] });
  return ws;
}

function run(state: ReportCallRun["state"], attempts: ReportCallRun["attempts"], trigger: ReportCallRun["trigger"] = "schedule"): Workspace {
  const ws = createEmptyWorkspace("ultimate");
  ws.reportCalls = [{ id: RUN, occurrence: now.toISOString(), trigger, attempts, nextAttemptAt: state === "calling" ? later.toISOString() : null, state, reportId: null }];
  return ws;
}

const attempt = (extra: object) => event({ type: "worker_call_attempt", pendingCallId: CALL, answered: true, ...extra });
const status = (ws: Workspace, id: string) => ws.taskTickets.find((task) => task.id === id)?.status;

describe("grouped verification events", () => {
  it("lets a task be confirmed mid-call only from the worker's call", () => {
    const yes = event({ type: "task_confirmation", taskId: T1, done: true, via: "worker_task_verification" });
    expect(eventAllowed({ party: "worker" }, yes)).toBe(true);
    expect(eventAllowed({ party: "system" }, yes)).toBe(false);
    const step = voiceStep(farm(), now, yes);
    expect(status(step.ws, T1)).toBe("closed");
    expect(step.ws.pendingWorkerCalls[0]).toMatchObject({ state: "pending", attempts: [] });
  });

  it("delivers when every covered open task was answered, and saves the last answer with it", () => {
    const step = voiceStep(farm(), now, attempt({ completed: true, answeredTaskIds: [T1], taskId: T2, taskDone: false }));
    expect(step.result).toEqual({ status: "saved", detail: "delivered" });
    expect(step.ws.pendingWorkerCalls[0].state).toBe("delivered");
    expect(status(step.ws, T2)).toBe("open");
  });

  it("refuses to deliver when a covered open task has no answer", () => {
    const step = voiceStep(farm(), now, attempt({ completed: true, taskId: T2, taskDone: true }));
    expect(step.result).toEqual({ status: "saved", detail: "retry_scheduled" });
    expect(step.ws.pendingWorkerCalls[0]).toMatchObject({ state: "pending", attempts: [{ answered: true }], nextAttemptAt: later.toISOString() });
    expect(status(step.ws, T2)).toBe("closed");
    expect(status(step.ws, T1)).toBe("open");
  });

  it("counts a call that ended partway as interrupted, and keeps what was said", () => {
    const partway = voiceStep(farm(), now, event({ type: "task_confirmation", taskId: T1, done: true, via: "worker_task_verification" })).ws;
    const step = voiceStep(partway, now, attempt({ attempt: 1 }));
    expect(step.result).toEqual({ status: "saved", detail: "retry_scheduled" });
    expect(status(step.ws, T1)).toBe("closed");
    expect(step.ws.pendingWorkerCalls[0].attempts).toHaveLength(1);
  });

  it("never closes a task the call does not cover", () => {
    const outside = "55555555-5555-4555-8555-555555555555";
    const ws = farm();
    ws.taskTickets.push({ id: outside, instruction: "x", createdAt: now.toISOString(), scheduledFor: null, status: "open", closedAt: null, closedVia: null });
    const step = voiceStep(ws, now, attempt({ completed: false, taskId: outside, taskDone: true }));
    expect(status(step.ws, outside)).toBe("open");
  });

  it("ignores a late status for an earlier attempt", () => {
    const first = voiceStep(farm(), now, attempt({ attempt: 1 })).ws;
    const late = voiceStep(first, later, event({ type: "worker_call_attempt", pendingCallId: CALL, answered: false, attempt: 1 }));
    expect(late.result).toEqual({ status: "saved", detail: "ignored" });
    expect(late.ws.pendingWorkerCalls[0].attempts).toHaveLength(1);
  });

  it("changes nothing for a status that arrives after delivery", () => {
    const done = voiceStep(farm("ultimate", "instruction"), now, attempt({ completed: true })).ws;
    const late = voiceStep(done, later, attempt({ attempt: 1 }));
    expect(late.ws.pendingWorkerCalls[0]).toMatchObject({ state: "delivered" });
    expect(late.ws.pendingWorkerCalls[0].attempts).toHaveLength(1);
  });

  it("delivers an instruction call on the worker's receipt, three attempts total and never a ticket", () => {
    expect(voiceStep(farm("ultimate", "instruction"), now, attempt({ completed: true })).ws.pendingWorkerCalls[0].state).toBe("delivered");
    let ws = farm("ultimate", "instruction");
    let at = now;
    for (const answered of [false, true, false]) {
      ws = voiceStep(ws, at, event({ type: "worker_call_attempt", pendingCallId: CALL, answered })).ws;
      at = new Date(at.getTime() + 20 * 60_000);
    }
    expect(ws.pendingWorkerCalls[0]).toMatchObject({ state: "no_answer_ticket", nextAttemptAt: null });
    expect(ws.noAnswerTickets).toEqual([]);
  });
});

describe("report call endings stay idempotent", () => {
  const ended = (attemptNumber?: number) => event({ type: "report_call_ended", reportCallId: RUN, ...(attemptNumber === undefined ? {} : { attempt: attemptNumber }) });

  it("consumes the attempt and retries a scheduled run", () => {
    const step = voiceStep(run("answered", [{ at: now.toISOString(), result: "answered" }]), now, ended(1));
    expect(step.ws.reportCalls?.[0]).toMatchObject({ state: "calling", nextAttemptAt: later.toISOString() });
  });

  it("ends a manual run after one attempt", () => {
    const step = voiceStep(run("answered", [{ at: now.toISOString(), result: "answered" }], "manual"), now, ended(1));
    expect(step.ws.reportCalls?.[0]).toMatchObject({ state: "missed", nextAttemptAt: null });
  });

  it("does not let a late status for an earlier attempt end the one in conversation", () => {
    const ws = run("answered", [{ at: now.toISOString(), result: "answered" }, { at: later.toISOString(), result: "answered" }]);
    const step = voiceStep(ws, later, ended(1));
    expect(step.result).toEqual({ status: "saved", detail: "ignored" });
    expect(step.ws.reportCalls?.[0].state).toBe("answered");
  });

  it("does not change a run already waiting for its retry", () => {
    const ws = run("calling", [{ at: now.toISOString(), result: "answered" }]);
    expect(voiceStep(ws, now, ended(1)).ws).toBe(ws);
  });

  it("leaves a completed run alone", () => {
    const ws = run("completed", [{ at: now.toISOString(), result: "answered" }]);
    expect(voiceStep(ws, now, ended(1)).ws.reportCalls?.[0].state).toBe("completed");
  });

  it("still takes the report when the line ended a moment before the save arrived", () => {
    const answer = { questionId: "q", question: { ar: "س", en: "q" }, answer: "a", certainty: "reported", followUp: false };
    const draft = { answers: [answer], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] };
    const report = event({ type: "worker_report", reportCallId: RUN, draft });
    const step = voiceStep(run("calling", [{ at: now.toISOString(), result: "answered" }]), now, report);
    expect(step.result).toEqual({ status: "saved" });
    expect(step.ws.reportCalls?.[0]).toMatchObject({ state: "completed", nextAttemptAt: null });
    const ringing = voiceStep(run("calling", [{ at: now.toISOString(), result: "pending" }]), now, report);
    expect(ringing.result).toEqual({ status: "rejected", reason: "call_not_active" });
  });
});

describe("Basic rejects the follow-up events", () => {
  it.each([
    { type: "owner_instruction", message: "m", actionable: true, scheduledFor: null },
    { type: "owner_instruction", message: "m", actionable: false, scheduledFor: null, items: [{ message: "m", actionable: false, scheduledFor: null }] },
    { type: "task_verification_start", taskId: T1 },
    { type: "worker_call_attempt", pendingCallId: CALL, answered: false },
    { type: "task_confirmation", taskId: T1, done: true, via: "worker_task_verification" },
  ])("$type", (input) => {
    const ws = farm("basic");
    const step = voiceStep(ws, now, event(input));
    expect(step.result).toEqual({ status: "rejected", reason: "not_allowed" });
    expect(step.ws).toBe(ws);
  });
});
