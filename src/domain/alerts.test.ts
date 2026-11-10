import { describe, expect, it } from "vitest";
import { farmAlerts, farmInstructions, undeliveredCalls } from "./alerts";
import { createEmptyWorkspace } from "./seed";
import type { PendingWorkerCall, Workspace } from "./types";

const now = new Date("2026-11-08T09:00:00.000Z");
const LAST_ATTEMPT = "2026-11-08T08:00:00.000Z";

function exhausted(id: string, extra: Partial<PendingWorkerCall> = {}): PendingWorkerCall {
  return {
    id,
    purpose: "instruction",
    message: "m",
    taskTicketId: null,
    relayId: null,
    attempts: [{ at: "2026-11-08T07:20:00.000Z", answered: false }, { at: "2026-11-08T07:40:00.000Z", answered: false }, { at: LAST_ATTEMPT, answered: false }],
    nextAttemptAt: null,
    state: "no_answer_ticket",
    ...extra,
  };
}

function task(id: string, status: "open" | "closed" = "open"): Workspace["taskTickets"][number] {
  return { id, instruction: "i", createdAt: "2026-11-08T06:00:00.000Z", scheduledFor: null, status, closedAt: null, closedVia: null };
}

describe("owner read models", () => {
  it("lists findings from the latest report only, with undelivered calls and overdue tasks", () => {
    const ws = createEmptyWorkspace("ultimate");
    const text = { ar: "ن", en: "n" };
    ws.reports.push(
      { id: "r1", at: "2026-11-01T09:00:00.000Z", callId: "c1", answers: [], findings: [{ id: "old", criterionId: "x", text }] },
      { id: "r2", at: "2026-11-07T09:00:00.000Z", callId: "c2", answers: [], findings: [{ id: "new", criterionId: "x", text }] },
    );
    ws.pendingWorkerCalls.push(exhausted("n1"));
    ws.taskTickets.push({ id: "t1", instruction: "fix", createdAt: "2026-11-01T00:00:00.000Z", scheduledFor: "2026-11-02T00:00:00.000Z", status: "open", closedAt: null, closedVia: null });
    expect(farmAlerts(ws, now).map((a) => a.id)).toEqual(["n1", "new", "t1"]);
  });
  it("shows relays and tasks together, newest first", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.relays.push({ id: "r", at: "2026-11-01T00:00:00.000Z", message: "m", delivered: true });
    ws.taskTickets.push({ id: "t", instruction: "i", createdAt: "2026-11-02T00:00:00.000Z", scheduledFor: null, status: "open", closedAt: null, closedVia: null });
    expect(farmInstructions(ws).map((i) => [i.id, i.status])).toEqual([["t", "open"], ["r", "delivered"]]);
  });
});

describe("undeliveredCalls", () => {
  it("reports an exhausted call with the open tasks it carried", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.taskTickets.push(task("t1"), task("t2", "closed"));
    ws.pendingWorkerCalls.push(exhausted("c", { coveredTaskIds: ["t1", "t2"] }));
    expect(undeliveredCalls(ws)).toEqual([{ id: "c", purpose: "instruction", message: "m", attempts: 3, lastAttemptAt: LAST_ATTEMPT, taskIds: ["t1"], relayId: null }]);
  });

  it("is empty on Basic even with old rows", () => {
    const ws = createEmptyWorkspace("basic");
    ws.pendingWorkerCalls.push(exhausted("c"));
    expect(undeliveredCalls(ws)).toEqual([]);
  });

  it("drops a call whose tasks are all closed", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.taskTickets.push(task("t1", "closed"));
    ws.pendingWorkerCalls.push(exhausted("c", { taskTicketId: "t1" }));
    expect(undeliveredCalls(ws)).toEqual([]);
  });

  it("drops a call whose relay has since been delivered", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.relays.push({ id: "r", at: LAST_ATTEMPT, message: "m", delivered: true });
    ws.pendingWorkerCalls.push(exhausted("c", { relayId: "r" }));
    expect(undeliveredCalls(ws)).toEqual([]);
  });

  it("drops an old row whose No Answer Ticket the worker closed by calling back", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.pendingWorkerCalls.push(exhausted("c"));
    ws.noAnswerTickets.push({ id: "n", createdAt: LAST_ATTEMPT, purpose: "instruction", message: "m", taskTicketId: null, status: "closed", closedAt: "2026-11-08T08:30:00.000Z" });
    expect(undeliveredCalls(ws)).toEqual([]);
  });

  it("tolerates a stored workspace without the old tickets array", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.pendingWorkerCalls.push(exhausted("c"));
    expect(undeliveredCalls({ ...ws, noAnswerTickets: undefined } as unknown as Workspace)).toHaveLength(1);
  });

  it("drops a call replaced by a later one for the same task", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.taskTickets.push(task("t1"));
    ws.pendingWorkerCalls.push(
      exhausted("old", { taskTicketId: "t1" }),
      { ...exhausted("new", { taskTicketId: "t1" }), state: "pending", attempts: [], nextAttemptAt: "2026-11-08T10:00:00.000Z" },
    );
    expect(undeliveredCalls(ws)).toEqual([]);
  });
});
