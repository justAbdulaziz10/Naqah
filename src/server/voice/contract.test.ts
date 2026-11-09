import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";
import { eventAllowed, parseVoiceEvent, tasksToVerify, voiceStep, type VoiceEvent } from "./contract";

const uuid = "11111111-1111-4111-8111-111111111111";
const base = { version: 1, eventId: "CA1:report", providerCallId: "CA1" };
const draft = { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [] };
const now = new Date("2026-11-08T09:00:00.000Z");
const runId = "22222222-2222-4222-8222-222222222222";

/** A farm whose worker has just picked up NAQAH's report call. */
function answered(plan: "basic" | "ultimate" = "ultimate") {
  const ws = createEmptyWorkspace(plan);
  ws.settings.worker.phone = "+966501234567";
  ws.reportCalls = [{ id: runId, occurrence: now.toISOString(), trigger: "schedule", attempts: [{ at: now.toISOString(), result: "answered" }], nextAttemptAt: null, state: "answered", reportId: null }];
  return ws;
}

describe("voice event validation", () => {
  it("accepts a valid report", () => {
    expect(parseVoiceEvent({ ...base, type: "worker_report", draft }).type).toBe("worker_report");
  });
  it("ignores a farm id or time sent by the voice layer", () => {
    const event = parseVoiceEvent({ ...base, type: "owner_inquiry", farmId: uuid, at: "2020-01-01" });
    expect(event).toEqual({ version: 1, eventId: "CA1:report", providerCallId: "CA1", type: "owner_inquiry" });
  });
  it.each([
    [{ ...base, version: 2, type: "owner_inquiry" }],
    [{ ...base, type: "delete_farm" }],
    [{ version: 1, providerCallId: "CA1", type: "owner_inquiry" }],
    [{ ...base, eventId: "", type: "owner_inquiry" }],
    [{ ...base, type: "worker_report", draft: { ...draft, answers: "none" } }],
    [{ ...base, type: "worker_report", draft: { ...draft, camelUpdates: [{ camelId: "c1", health: "sick", certainty: "reported" }] } }],
    [{ ...base, type: "worker_report", draft: { ...draft, resourceUpdates: [{ kind: "gold", level: "low", certainty: "reported" }] } }],
    [{ ...base, type: "owner_instruction", message: "", actionable: true }],
    [{ ...base, type: "owner_instruction", message: "m", actionable: true, scheduledFor: "soon" }],
    [{ ...base, type: "task_confirmation", taskId: uuid, done: true, via: "owner_inquiry" }],
  ])("rejects %j", (input) => expect(() => parseVoiceEvent(input)).toThrow());
});

describe("events are bound to who is on the call", () => {
  const event = (extra: object) => parseVoiceEvent({ ...base, ...extra });
  const confirmation = event({ type: "task_confirmation", taskId: uuid, done: true, via: "worker_report" });
  const instruction = event({ type: "owner_instruction", message: "m", actionable: true });
  it("lets only the worker close a task", () => {
    expect(eventAllowed({ party: "worker" }, confirmation)).toBe(true);
    expect(eventAllowed({ party: "owner", call: "notification" }, confirmation)).toBe(false);
    expect(eventAllowed({ party: "system" }, confirmation)).toBe(false);
  });
  it("takes instructions on the post-update call only", () => {
    expect(eventAllowed({ party: "owner", call: "notification" }, instruction)).toBe(true);
    expect(eventAllowed({ party: "owner", call: "inquiry" }, instruction)).toBe(false);
    expect(eventAllowed({ party: "worker" }, instruction)).toBe(false);
  });
  it("keeps call results to the system", () => {
    const attempt = event({ type: "worker_call_attempt", pendingCallId: uuid, answered: false });
    expect(eventAllowed({ party: "system" }, attempt)).toBe(true);
    expect(eventAllowed({ party: "worker" }, attempt)).toBe(false);
  });
  it("does not let a worker file an owner inquiry", () => {
    expect(eventAllowed({ party: "worker" }, event({ type: "owner_inquiry" }))).toBe(false);
  });
});

describe("report details", () => {
  it("parses and saves optional mode, coverage and an urgent note", () => {
    const details = { mode: "open", coverage: [
      { questionId: "feed_level", status: "not_reported" },
      { questionId: "water_level", status: "unknown" },
      { questionId: "herd_count", status: "reported" },
    ], urgentNote: "Check the gate" };
    const event = parseVoiceEvent({ ...base, type: "worker_report", reportCallId: runId, draft: { ...draft, ...details } });
    expect(event).toMatchObject({ draft: details });
    const report = voiceStep(answered(), now, event).ws.reports[0];
    expect(report).toMatchObject({ mode: "open", coverage: details.coverage });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].text.en).toBe("Urgent concern reported by the worker: Check the gate");
  });
  it.each([
    { mode: "worker_choice" }, { mode: null }, { coverage: null }, { coverage: {} },
    { coverage: [{ questionId: "feed_level", status: "healthy" }] },
    { coverage: [{ questionId: "", status: "reported" }] },
    { coverage: [{ questionId: "x".repeat(101), status: "reported" }] },
    { coverage: Array.from({ length: 201 }, () => ({ questionId: "feed_level", status: "reported" })) },
    { urgentNote: "x".repeat(501) }, { urgentNote: 5 }, { urgentNote: " " },
  ])("strictly rejects invalid report metadata %j", (metadata) => {
    expect(() => parseVoiceEvent({ ...base, type: "worker_report", draft: { ...draft, ...metadata } })).toThrow();
  });
  it("accepts a null urgent note and a guided report", () => {
    expect(parseVoiceEvent({ ...base, type: "worker_report", draft: { ...draft, mode: "guided", urgentNote: null } })).toMatchObject({ draft: { mode: "guided", urgentNote: null } });
  });
  it("rejects duplicate coverage at save time, including trusted typed events", () => {
    const event: VoiceEvent = { ...base, version: 1, type: "worker_report", reportCallId: runId, draft: { ...draft, coverage: [
      { questionId: "feed_level", status: "reported" }, { questionId: "feed_level", status: "unknown" },
    ] } };
    expect(() => voiceStep(answered(), now, event)).toThrow("coverage");
  });
  it("rejects contradictory duplicate resource updates at save time", () => {
    const event = parseVoiceEvent({ ...base, type: "worker_report", reportCallId: runId, draft: { ...draft, resourceUpdates: [
      { kind: "feed", level: "critical", certainty: "reported" },
      { kind: "feed", level: "good", certainty: "reported" },
    ] } });
    expect(() => voiceStep(answered(), now, event)).toThrow("resourceUpdates");
  });
  it("accepts a herd larger than one call's answers", () => {
    const camelUpdates = Array.from({ length: 1_000 }, () => ({ camelId: uuid, health: "healthy", certainty: "reported" }));
    expect(parseVoiceEvent({ ...base, type: "worker_report", draft: { ...draft, camelUpdates } }).type).toBe("worker_report");
  });
  it("builds the heat-day finding on the server, so it reaches the owner", () => {
    const event = parseVoiceEvent({ ...base, type: "worker_report", reportCallId: runId, draft: { ...draft, heatWaterNeeded: true } });
    const step = voiceStep(answered(), now, event);
    expect(step.ws.reports[0].findings.map((f) => f.criterionId)).toEqual(["weather_heat_day"]);
  });
  it("ignores findings written by the voice layer", () => {
    const event = parseVoiceEvent({ ...base, type: "worker_report", reportCallId: runId, draft: { ...draft, extraFindings: [{ id: "x", criterionId: "y", text: { ar: "a", en: "b" } }] } });
    expect(voiceStep(answered(), now, event).ws.reports[0].findings).toEqual([]);
  });
  it("keeps the worker's herd count as a proposal on the report", () => {
    const event = parseVoiceEvent({ ...base, type: "worker_report", reportCallId: runId, draft: { ...draft, herdCount: 41 } });
    const step = voiceStep(answered(), now, event);
    expect(step.ws.reports[0].herdCountReported).toBe(41);
    expect(step.ws.settings.herdCount).toBeNull();
  });
  it.each([-1, 1.5, "40", 100_001])("rejects a herd count of %j", (herdCount) => {
    expect(() => parseVoiceEvent({ ...base, type: "worker_report", draft: { ...draft, herdCount } })).toThrow();
  });
});

describe("scheduled task verification", () => {
  const start = (ws: ReturnType<typeof createEmptyWorkspace>) =>
    voiceStep(ws, now, parseVoiceEvent({ ...base, type: "task_verification_start", taskId: uuid }));
  const withTask = () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.taskTickets.push({ id: uuid, instruction: "i", createdAt: "2026-11-01T00:00:00.000Z", scheduledFor: "2026-11-02T00:00:00.000Z", status: "open", closedAt: null, closedVia: null });
    return ws;
  };
  it("creates the call that attempts and retries then act on", () => {
    expect(start(withTask()).ws.pendingWorkerCalls).toEqual([expect.objectContaining({ purpose: "task_verification", taskTicketId: uuid })]);
  });
  it("rings the worker once per task, not on every scheduler run", () => {
    const once = start(withTask()).ws;
    once.pendingWorkerCalls[0].state = "delivered";
    expect(tasksToVerify(once, now)).toEqual([]);
    expect(start(once).ws.pendingWorkerCalls).toHaveLength(1);
  });
  it("ignores a task that is not due", () => {
    const ws = withTask();
    ws.taskTickets[0].scheduledFor = "2027-01-01T00:00:00.000Z";
    expect(start(ws).ws.pendingWorkerCalls).toHaveLength(0);
  });
});

describe("voice steps follow the domain rules", () => {
  const event = (extra: object) => parseVoiceEvent({ ...base, ...extra }) as VoiceEvent;

  it("saves the report on the answered report call and refuses a second", () => {
    const first = voiceStep(answered(), now, event({ type: "worker_report", reportCallId: runId, draft }));
    expect(first.result).toEqual({ status: "saved" });
    expect(first.ws.reportCalls?.[0]).toMatchObject({ state: "completed", reportId: first.ws.reports[0].id });
    expect(first.ws.calls[0].direction).toBe("outbound");
    const second = voiceStep(first.ws, now, event({ type: "worker_report", reportCallId: runId, draft }));
    expect(second.result).toEqual({ status: "rejected", reason: "call_not_active" });
    expect(second.ws.reports).toHaveLength(1);
  });
  it("refuses a report on a run that isn't in conversation", () => {
    const ws = answered();
    ws.reportCalls![0].state = "missed";
    expect(voiceStep(ws, now, event({ type: "worker_report", reportCallId: runId, draft })).result).toEqual({ status: "rejected", reason: "call_not_active" });
  });
  it("never turns a call refused at the start into an empty report", () => {
    const refused = event({ type: "worker_report", draft, refusedAtStart: true });
    const step = voiceStep(createEmptyWorkspace("ultimate"), now, refused);
    expect(step.result).toEqual({ status: "rejected", reason: "wait_for_call" });
    expect(step.ws.reports).toHaveLength(0);
    expect(step.ws.calls.at(-1)?.kind).toBe("worker_report_rejected");
  });
  it("tells a worker who calls in to wait for NAQAH's call", () => {
    expect(voiceStep(createEmptyWorkspace("basic"), now, event({ type: "worker_report", draft })).result).toEqual({ status: "rejected", reason: "wait_for_call" });
  });
  it("takes a report from a worker returning a missed report call", () => {
    const ws = answered();
    ws.reportCalls![0].state = "missed";
    ws.reportCalls![0].attempts = [{ at: now.toISOString(), result: "no_answer" }];
    const step = voiceStep(ws, now, event({ type: "worker_report", draft }));
    expect(step.result).toEqual({ status: "saved" });
    expect(step.ws.calls[0].direction).toBe("inbound");
  });
  it("treats a returned missed call as a callback, not a report", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.noAnswerTickets.push({ id: "n", createdAt: now.toISOString(), purpose: "instruction", message: "m", taskTicketId: null, status: "open", closedAt: null });
    const step = voiceStep(ws, now, event({ type: "worker_report", draft }));
    expect(step.result).toEqual({ status: "rejected", reason: "callback_required" });
    expect(step.ws).toBe(ws);
  });
  it("logs nothing for a callback with no missed message", () => {
    const ws = createEmptyWorkspace("ultimate");
    expect(voiceStep(ws, now, event({ type: "worker_callback" })).ws).toBe(ws);
  });
  it("relays on Basic and opens a ticket on Ultimate", () => {
    const instruction = event({ type: "owner_instruction", message: "m", actionable: true });
    expect(voiceStep(createEmptyWorkspace("basic"), now, instruction).ws.taskTickets).toHaveLength(0);
    expect(voiceStep(createEmptyWorkspace("ultimate"), now, instruction).ws.taskTickets).toHaveLength(1);
  });
  it("never closes a task on a worker's no", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.taskTickets.push({ id: uuid, instruction: "i", createdAt: now.toISOString(), scheduledFor: null, status: "open", closedAt: null, closedVia: null });
    const step = voiceStep(ws, now, event({ type: "task_confirmation", taskId: uuid, done: false, via: "worker_report" }));
    expect(step.ws.taskTickets[0].status).toBe("open");
  });
});

describe("report call status events", () => {
  const event = (extra: object) => parseVoiceEvent({ ...base, ...extra }) as VoiceEvent;
  function ringing() {
    const ws = answered();
    ws.reportCalls![0] = { ...ws.reportCalls![0], state: "calling", attempts: [{ at: now.toISOString(), result: "pending" }] };
    return ws;
  }
  it("keeps attempts and endings to the system, and endings to the worker too", () => {
    const attempt = event({ type: "report_call_attempt", reportCallId: runId, attempt: 1, answered: false });
    expect(eventAllowed({ party: "system" }, attempt)).toBe(true);
    expect(eventAllowed({ party: "worker" }, attempt)).toBe(false);
    const ended = event({ type: "report_call_ended", reportCallId: runId });
    expect(eventAllowed({ party: "worker" }, ended)).toBe(true);
    expect(eventAllowed({ party: "owner", call: "inquiry" }, ended)).toBe(false);
  });
  it("schedules a retry for an unanswered attempt and ignores a late callback for another attempt", () => {
    const step = voiceStep(ringing(), now, event({ type: "report_call_attempt", reportCallId: runId, attempt: 1, answered: false }));
    expect(step.result).toEqual({ status: "saved", detail: "retry_scheduled" });
    expect(step.ws.calls[0].kind).toBe("worker_report_missed");
    const late = voiceStep(ringing(), now, event({ type: "report_call_attempt", reportCallId: runId, attempt: 2, answered: false }));
    expect(late.result).toEqual({ status: "saved", detail: "ignored" });
  });
  it("ends an answered call unsaved, and counts a completed call that never reached the questions as unanswered", () => {
    const ended = voiceStep(answered(), now, event({ type: "report_call_ended", reportCallId: runId, attempt: 1 }));
    expect(ended.ws.reportCalls?.[0].state).toBe("missed");
    const never = voiceStep(ringing(), now, event({ type: "report_call_ended", reportCallId: runId, attempt: 1 }));
    expect(never.result).toEqual({ status: "saved", detail: "retry_scheduled" });
  });
  it.each([
    { type: "report_call_attempt", reportCallId: "rcl_1", attempt: 1, answered: true },
    { type: "report_call_attempt", reportCallId: runId, attempt: 0, answered: true },
    { type: "worker_report", reportCallId: "x", draft },
  ])("rejects %j", (input) => expect(() => parseVoiceEvent({ ...base, ...input })).toThrow());
});
