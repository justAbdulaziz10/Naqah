import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";
import type { CallSchedule, FarmReport, ReportCallRun, Workspace } from "@/domain/types";
import { latestReportIsOld, nextOwnerCall, noVerifiedReport, ownerCallStatus, ownerCallsBeforeWorker, workerCallStatus } from "./callStatus";

const now = new Date("2026-11-10T14:30:00.000Z"); // Tuesday 17:30 Riyadh.
const occurrence = "2026-11-10T14:00:00.000Z"; // Tuesday 17:00 Riyadh.
const at = (minutes: number) => new Date(Date.parse(occurrence) + minutes * 60_000).toISOString();

type Run = NonNullable<Workspace["ownerCallRun"]>;

function workspace(plan: "basic" | "ultimate" = "ultimate", extra: Partial<Workspace> = {}): Workspace {
  return { ...createEmptyWorkspace(plan), ...extra };
}
function workerRun(extra: Partial<ReportCallRun>): ReportCallRun {
  return { id: "r", occurrence, trigger: "schedule", attempts: [], nextAttemptAt: null, state: "calling", reportId: null, ...extra };
}
function ownerRun(extra: Partial<Run>): Run {
  return { id: "o", occurrence, reportId: null, attempts: [], nextAttemptAt: null, state: "calling", ...extra };
}
const report = (reportAt: string): FarmReport => ({ id: "rep", at: reportAt, callId: "c", answers: [], findings: [] });
const schedule = (time: string, day: CallSchedule["day"] = null): CallSchedule => ({ day, time });

describe("workerCallStatus", () => {
  it("is null with no call", () => expect(workerCallStatus(workspace(), now)).toBeNull());

  it("says a call is ringing", () => {
    const ws = workspace("ultimate", { reportCalls: [workerRun({ attempts: [{ at: at(29), result: "pending" }] })] });
    expect(workerCallStatus(ws, now)).toEqual({ kind: "ringing", at: at(29) });
  });

  it("gives the retry time and the next attempt number", () => {
    const ws = workspace("ultimate", { reportCalls: [workerRun({ attempts: [{ at: at(10), result: "no_answer" }], nextAttemptAt: at(30) })] });
    expect(workerCallStatus(ws, now)).toEqual({ kind: "retry", at: at(30), attempt: 2, of: 3, connected: false });
  });

  it("marks a retry after a cut-off call as connected", () => {
    const ws = workspace("ultimate", { reportCalls: [workerRun({ attempts: [{ at: at(10), result: "answered" }], nextAttemptAt: at(30) })] });
    expect(workerCallStatus(ws, now)).toMatchObject({ kind: "retry", connected: true });
  });

  it("reports a missed run as no verified report", () => {
    const attempts = [at(0), at(20), at(40)].map((time) => ({ at: time, result: "no_answer" as const }));
    const status = workerCallStatus(workspace("ultimate", { reportCalls: [workerRun({ attempts, state: "missed" })] }), now);
    expect(status).toEqual({ kind: "missed", at: at(40), attempts: 3, connected: false });
    expect(noVerifiedReport(status)).toBe(true);
  });

  it("clears a missed run once a later report is saved", () => {
    const ws = workspace("ultimate", { reports: [report(at(50))], reportCalls: [workerRun({ attempts: [{ at: at(0), result: "no_answer" }], state: "missed" })] });
    expect(workerCallStatus(ws, now)).toBeNull();
  });

  it("does not let an older report hide a missed run", () => {
    const ws = workspace("ultimate", { reports: [report("2026-11-09T14:00:00.000Z")], reportCalls: [workerRun({ attempts: [{ at: at(0), result: "no_answer" }], state: "missed" })] });
    expect(noVerifiedReport(workerCallStatus(ws, now))).toBe(true);
  });
});

describe("latestReportIsOld", () => {
  const ws = workspace("ultimate");
  ws.settings.callSchedule = schedule("17:00");
  it("is true for a report before the latest slot", () => expect(latestReportIsOld(ws, now, "2026-11-09T14:10:00.000Z")).toBe(true));
  it("is false for a report after the latest slot", () => expect(latestReportIsOld(ws, now, at(4))).toBe(false));
  it("is false with no report", () => expect(latestReportIsOld(ws, now, null)).toBe(false));
});

describe("ownerCallStatus", () => {
  const withRun = (run: Run) => {
    const ws = workspace("ultimate", { ownerCallRun: run });
    ws.settings.ownerCallSchedule = schedule("17:00");
    return ws;
  };

  it("is null without a run", () => expect(ownerCallStatus(workspace(), now)).toBeNull());

  it("gives the owner's retry time", () => {
    const ws = withRun(ownerRun({ attempts: [{ at: at(10), result: "unanswered" }], nextAttemptAt: at(30) }));
    expect(ownerCallStatus(ws, now)).toEqual({ kind: "retry", at: at(30), attempt: 2, of: 3, connected: false });
  });

  it("marks an interrupted attempt as connected", () => {
    const ws = withRun(ownerRun({ attempts: [{ at: at(10), result: "interrupted" }], nextAttemptAt: at(30) }));
    expect(ownerCallStatus(ws, now)).toMatchObject({ kind: "retry", connected: true });
  });

  it("keeps a completed no-report call distinct", () => {
    const ws = withRun(ownerRun({ attempts: [{ at: at(2), result: "completed" }], state: "completed", reportId: null }));
    expect(ownerCallStatus(ws, now)).toEqual({ kind: "completed", at: at(2), reportId: null });
  });

  it("reports a missed run", () => {
    const ws = withRun(ownerRun({ attempts: [{ at: at(0), result: "unanswered" }, { at: at(20), result: "unanswered" }, { at: at(29), result: "unanswered" }], state: "missed" }));
    expect(ownerCallStatus(ws, now)).toEqual({ kind: "missed", at: at(29), attempts: 3 });
  });

  it("treats a run from before the latest slot as old news", () => {
    const ws = withRun(ownerRun({ occurrence: "2026-11-09T14:00:00.000Z", state: "completed", attempts: [{ at: "2026-11-09T14:02:00.000Z", result: "completed" }] }));
    expect(ownerCallStatus(ws, now)).toBeNull();
  });
});

describe("nextOwnerCall", () => {
  it("is null until the owner's time is set", () => expect(nextOwnerCall(workspace(), now)).toBeNull());
  it("is the next owner slot", () => {
    const ws = workspace();
    ws.settings.ownerCallSchedule = schedule("19:00");
    expect(nextOwnerCall(ws, now)?.toISOString()).toBe("2026-11-10T16:00:00.000Z");
  });
});

describe("ownerCallsBeforeWorker", () => {
  const set = (plan: "basic" | "ultimate", worker: CallSchedule, owner: CallSchedule) => {
    const ws = workspace(plan);
    ws.settings.callSchedule = worker;
    ws.settings.ownerCallSchedule = owner;
    return ownerCallsBeforeWorker(ws);
  };
  it("flags an earlier time on Ultimate", () => expect(set("ultimate", schedule("17:00"), schedule("16:00"))).toBe(true));
  it("is quiet when the owner is later", () => expect(set("ultimate", schedule("17:00"), schedule("19:00"))).toBe(false));
  it("is quiet at the same time", () => expect(set("ultimate", schedule("17:00"), schedule("17:00"))).toBe(false));
  it("flags Basic only on the same day", () => {
    expect(set("basic", schedule("17:00", 4), schedule("16:00", 4))).toBe(true);
    expect(set("basic", schedule("17:00", 4), schedule("16:00", 5))).toBe(false);
  });
  it("is quiet with an unfinished schedule", () => expect(set("basic", schedule("17:00", 4), schedule("16:00"))).toBe(false));
});
