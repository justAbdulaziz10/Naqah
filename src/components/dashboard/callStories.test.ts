import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";
import type { CallKind, CallLog } from "@/domain/types";
import { callEntries } from "./callStories";

let n = 0;
const call = (kind: CallKind, minute: number, over: Partial<CallLog> = {}): CallLog => ({
  id: `c${++n}`,
  kind,
  direction: kind.startsWith("owner_inquiry") ? "inbound" : "outbound",
  party: kind.startsWith("owner") ? "owner" : "worker",
  at: new Date(Date.UTC(2026, 10, 7, 14, minute)).toISOString(),
  outcome: "completed",
  attempt: null,
  summary: { ar: "", en: "" },
  ticketId: null,
  reportId: null,
  ...over,
});

describe("callEntries", () => {
  it("tells a report as one story: the report, the owner's briefing and the instruction passed back", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.reports.push({ id: "r1", at: new Date(Date.UTC(2026, 10, 7, 14, 0)).toISOString(), callId: "x", answers: [], findings: [] });
    ws.calls = [
      call("worker_report", 0, { reportId: "r1" }),
      call("owner_notification", 2, { reportId: "r1" }),
      call("worker_instruction", 5, { attempt: 1, outcome: "no_answer", ticketId: "t1" }),
      call("worker_instruction", 25, { attempt: 2, ticketId: "t1" }),
      call("owner_inquiry", 50),
    ];
    const entries = callEntries(ws);
    expect(entries.map((entry) => entry.type)).toEqual(["chain", "report"]);
    const story = entries[1];
    if (story.type !== "report") throw new Error("expected a report");
    expect(story.report?.id).toBe("r1");
    expect(story.briefings).toHaveLength(1);
    expect(story.deliveries).toHaveLength(1);
    expect(story.deliveries[0].map((item) => item.attempt)).toEqual([1, 2]);
    expect(entries[0].group).toBe("yours");
  });

  it("joins retries of the same task check and keeps other tasks apart", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.calls = [1, 2, 3, 4].map((attempt) => call("worker_task_verification", attempt * 20, { attempt, outcome: "no_answer", ticketId: "t1" }));
    ws.calls.push(call("worker_task_verification", 90, { attempt: 1, ticketId: "t2" }));
    const entries = callEntries(ws);
    expect(entries).toHaveLength(2);
    expect(entries[1].type === "chain" && entries[1].calls).toHaveLength(4);
    expect(entries[1].group).toBe("followUps");
  });

  it("keeps an instruction call that came before any briefing on its own line", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.calls = [call("worker_instruction", 0, { attempt: 1 }), call("worker_report", 10)];
    expect(callEntries(ws).map((entry) => entry.type)).toEqual(["report", "chain"]);
  });

  it("keeps Ultimate-only calls in old rows out of a Basic ranch's history", () => {
    const ws = createEmptyWorkspace("basic");
    ws.calls = [call("worker_instruction", 0, { attempt: 1 }), call("worker_report", 10)];
    expect(callEntries(ws).map((entry) => entry.type)).toEqual(["report"]);
  });
});
