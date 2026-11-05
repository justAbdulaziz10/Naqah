import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";
import { eventAllowed, parseVoiceEvent, tasksToVerify, voiceStep, type VoiceEvent } from "./contract";

const uuid = "11111111-1111-4111-8111-111111111111";
const base = { version: 1, eventId: "CA1:report", providerCallId: "CA1" };
const draft = { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [] };
const now = new Date("2026-11-08T09:00:00.000Z");

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
  it("accepts a herd larger than one call's answers", () => {
    const camelUpdates = Array.from({ length: 1_000 }, () => ({ camelId: uuid, health: "healthy", certainty: "reported" }));
    expect(parseVoiceEvent({ ...base, type: "worker_report", draft: { ...draft, camelUpdates } }).type).toBe("worker_report");
  });
  it("builds the heat-day finding on the server, so it reaches the owner", () => {
    const event = parseVoiceEvent({ ...base, type: "worker_report", draft: { ...draft, heatWaterNeeded: true } });
    const step = voiceStep(createEmptyWorkspace("ultimate"), now, event);
    expect(step.ws.reports[0].findings.map((f) => f.criterionId)).toEqual(["weather_heat_day"]);
  });
  it("ignores findings written by the voice layer", () => {
    const event = parseVoiceEvent({ ...base, type: "worker_report", draft: { ...draft, extraFindings: [{ id: "x", criterionId: "y", text: { ar: "a", en: "b" } }] } });
    expect(voiceStep(createEmptyWorkspace("ultimate"), now, event).ws.reports[0].findings).toEqual([]);
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

  it("saves a first report of the day and refuses a second", () => {
    const ws = createEmptyWorkspace("ultimate");
    const first = voiceStep(ws, now, event({ type: "worker_report", draft }));
    expect(first.result).toEqual({ status: "saved" });
    const second = voiceStep(first.ws, now, event({ type: "worker_report", draft }));
    expect(second.result).toEqual({ status: "rejected", reason: "daily_done" });
    expect(second.ws.reports).toHaveLength(1);
  });
  it("refuses Basic reporting without a window", () => {
    expect(voiceStep(createEmptyWorkspace("basic"), now, event({ type: "worker_report", draft })).result).toEqual({ status: "rejected", reason: "no_window" });
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
