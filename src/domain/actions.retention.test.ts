import { describe, expect, it } from "vitest";
import { DEMO_CALL_RETENTION_LIMIT, DEMO_REPORT_RETENTION_LIMIT, retainDemoHistory } from "./actions";
import { createEmptyWorkspace } from "./seed";
import type { CallLog, FarmReport } from "./types";

function call(id: string, at: string, ticketId: string | null = null, reportId: string | null = null): CallLog {
  return {
    id,
    kind: "worker_report",
    direction: "inbound",
    party: "worker",
    at,
    outcome: "completed",
    attempt: null,
    summary: { ar: "تحديث", en: "Update" },
    ticketId,
    reportId,
  };
}

function report(id: string, callId: string, at: string): FarmReport {
  return { id, callId, at, answers: [], findings: [] };
}

describe("demo history retention", () => {
  it("keeps the most recent 200 calls and 100 reports without mutating the input", () => {
    const ws = createEmptyWorkspace();
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    ws.calls = Array.from({ length: DEMO_CALL_RETENTION_LIMIT + 5 }, (_, index) =>
      call(`call-${index}`, new Date(start + index * 60_000).toISOString()),
    );
    ws.reports = Array.from({ length: DEMO_REPORT_RETENTION_LIMIT + 5 }, (_, index) =>
      report(`report-${index}`, `call-${index}`, new Date(start + index * 60_000).toISOString()),
    );

    const retained = retainDemoHistory(ws);

    expect(retained.calls).toHaveLength(DEMO_CALL_RETENTION_LIMIT);
    expect(retained.calls[0].id).toBe("call-5");
    expect(retained.calls.at(-1)?.id).toBe(`call-${DEMO_CALL_RETENTION_LIMIT + 4}`);
    expect(retained.reports).toHaveLength(DEMO_REPORT_RETENTION_LIMIT);
    expect(retained.reports[0].id).toBe("report-5");
    expect(retained.reports.at(-1)?.id).toBe(`report-${DEMO_REPORT_RETENTION_LIMIT + 4}`);
    expect(ws.calls).toHaveLength(DEMO_CALL_RETENTION_LIMIT + 5);
    expect(ws.reports).toHaveLength(DEMO_REPORT_RETENTION_LIMIT + 5);
  });

  it("preserves older calls and reports linked to open tickets or a pending call", () => {
    const ws = createEmptyWorkspace();
    const oldAt = "2020-01-01T00:00:00.000Z";
    ws.taskTickets.push({
      id: "open-task",
      instruction: "Check the water tank",
      createdAt: oldAt,
      scheduledFor: null,
      status: "open",
      closedAt: null,
      closedVia: null,
    });
    ws.noAnswerTickets.push({
      id: "open-no-answer",
      createdAt: oldAt,
      purpose: "instruction",
      message: "Check the water tank",
      taskTicketId: "open-task",
      status: "open",
      closedAt: null,
    });
    ws.pendingWorkerCalls.push({
      id: "pending-call",
      purpose: "instruction",
      message: "Check the water tank",
      taskTicketId: "open-task",
      relayId: null,
      attempts: [],
      nextAttemptAt: oldAt,
      state: "pending",
    });
    ws.calls = [
      call("old-task-call", oldAt, "open-task", "old-task-report"),
      call("old-no-answer-call", oldAt, "open-no-answer"),
      call("old-pending-call", oldAt, "open-task"),
      ...Array.from({ length: DEMO_CALL_RETENTION_LIMIT + 1 }, (_, index) =>
        call(`recent-${index}`, new Date(Date.parse(oldAt) + (index + 1) * 60_000).toISOString()),
      ),
    ];
    ws.reports = [
      report("old-task-report", "old-task-call", oldAt),
      ...Array.from({ length: DEMO_REPORT_RETENTION_LIMIT }, (_, index) =>
        report(`recent-report-${index}`, `recent-${index}`, new Date(Date.parse(oldAt) + (index + 1) * 60_000).toISOString()),
      ),
    ];

    const retained = retainDemoHistory(ws);

    expect(retained.calls.map((item) => item.id)).toContain("old-task-call");
    expect(retained.calls.map((item) => item.id)).toContain("old-no-answer-call");
    expect(retained.calls.map((item) => item.id)).toContain("old-pending-call");
    expect(retained.reports.map((item) => item.id)).toContain("old-task-report");
  });
});
