import { describe, expect, it } from "vitest";
import { farmAlerts, farmInstructions } from "./alerts";
import { createEmptyWorkspace } from "./seed";

const now = new Date("2026-11-08T09:00:00.000Z");

describe("owner read models", () => {
  it("lists findings from the latest report only, with open tickets and overdue tasks", () => {
    const ws = createEmptyWorkspace("ultimate");
    const text = { ar: "ن", en: "n" };
    ws.reports.push(
      { id: "r1", at: "2026-11-01T09:00:00.000Z", callId: "c1", answers: [], findings: [{ id: "old", criterionId: "x", text }] },
      { id: "r2", at: "2026-11-07T09:00:00.000Z", callId: "c2", answers: [], findings: [{ id: "new", criterionId: "x", text }] },
    );
    ws.noAnswerTickets.push({ id: "n1", createdAt: "2026-11-08T08:00:00.000Z", purpose: "instruction", message: "m", taskTicketId: null, status: "open", closedAt: null });
    ws.noAnswerTickets.push({ id: "n2", createdAt: "2026-11-08T08:00:00.000Z", purpose: "instruction", message: "m", taskTicketId: null, status: "closed", closedAt: "2026-11-08T08:30:00.000Z" });
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
