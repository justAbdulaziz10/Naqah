import { describe, expect, it } from "vitest";
import { completeWorkerReport } from "./actions";
import { fromRiyadh, MINUTE, REPORT_CALL_RETRIES, RETRY_DELAY_MS } from "./clock";
import {
  claimDueReportCall,
  dueScheduledReportCall,
  placeReportCallAttempt,
  reportCallBlock,
  resolveReportCallAttempt,
  startReportCall,
} from "./reportCalls";
import { reportDoneThisPeriod, routeWorkerInboundCall } from "./rules";
import { upcomingReportCall } from "./schedule";
import { createEmptyWorkspace } from "./seed";
import type { Plan } from "./types";

const slot = fromRiyadh(2026, 11, 7, 23, 50);
const after = (minutes: number) => new Date(slot.getTime() + minutes * MINUTE);
const draft = { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [] };

function farm(plan: Plan) {
  const ws = createEmptyWorkspace(plan);
  ws.setupComplete = true;
  ws.settings.worker.phone = "+966501234567";
  ws.settings.callSchedule = { day: plan === "basic" ? 6 : null, time: "23:50" };
  return ws;
}

function retryAnswered(plan: Plan) {
  const first = claimDueReportCall(farm(plan), slot);
  const runId = first.claim!.runId;
  const missed = resolveReportCallAttempt(first.ws, slot, runId, false).ws;
  const second = claimDueReportCall(missed, after(RETRY_DELAY_MS / MINUTE));
  return { ws: resolveReportCallAttempt(second.ws, after(20), runId, true).ws, runId };
}

describe.each(["ultimate", "basic"] as const)("%s report periods across midnight", (plan) => {
  const nextSlot = plan === "basic" ? fromRiyadh(2026, 11, 14, 23, 50) : fromRiyadh(2026, 11, 8, 23, 50);

  it("attributes a 00:10 retry report to the 23:50 slot and keeps the next slot due", () => {
    const answered = retryAnswered(plan);
    const { ws, report } = completeWorkerReport(answered.ws, after(20), draft, answered.runId);
    expect(report.at).toBe(after(20).toISOString());
    expect(ws.reportCalls?.[0]).toMatchObject({ occurrence: slot.toISOString(), reportId: report.id, state: "completed" });
    expect(reportDoneThisPeriod(ws, slot)).toBe(true);
    expect(reportDoneThisPeriod(ws, after(20))).toBe(false);
    expect(reportCallBlock(ws, after(20))).toBeNull();
    expect(upcomingReportCall(ws, after(20))).toEqual(nextSlot);
    expect(dueScheduledReportCall(ws, nextSlot)).toEqual(nextSlot);
    expect(claimDueReportCall(ws, nextSlot).claim).toMatchObject({ attempt: 1 });
  });

  it("lets the worker return a missed report call until, but not at, the next slot", () => {
    const first = claimDueReportCall(farm(plan), slot);
    const runId = first.claim!.runId;
    let ws = first.ws;
    for (let attempt = 0; attempt <= REPORT_CALL_RETRIES; attempt++) {
      const now = after(attempt * RETRY_DELAY_MS / MINUTE);
      if (attempt) ws = placeReportCallAttempt(ws, now, runId).ws;
      ws = resolveReportCallAttempt(ws, now, runId, false).ws;
    }
    expect(ws.reportCalls?.[0].state).toBe("missed");
    expect(routeWorkerInboundCall(ws, after(55))).toEqual({ kind: "report" });
    expect(routeWorkerInboundCall(ws, new Date(nextSlot.getTime() - 1))).toEqual({ kind: "report" });
    expect(routeWorkerInboundCall(ws, nextSlot)).toEqual({ kind: "rejected", reason: "wait_for_call" });
    expect(routeWorkerInboundCall(ws, new Date(nextSlot.getTime() + MINUTE))).toEqual({ kind: "rejected", reason: "wait_for_call" });
  });

  it("expires callbacks by occurrence, not by a delayed first attempt", () => {
    const first = claimDueReportCall(farm(plan), after(15));
    const ws = resolveReportCallAttempt(first.ws, after(15), first.claim!.runId, false).ws;
    expect(ws.reportCalls?.[0].occurrence).toBe(slot.toISOString());
    expect(routeWorkerInboundCall(ws, after(55))).toEqual({ kind: "report" });
    expect(routeWorkerInboundCall(ws, nextSlot)).toEqual({ kind: "rejected", reason: "wait_for_call" });
  });

  it("counts the worker's returned call before a retry in the run's slot period", () => {
    const first = claimDueReportCall(farm(plan), slot);
    const missed = resolveReportCallAttempt(first.ws, slot, first.claim!.runId, false).ws;
    const { ws } = completeWorkerReport(missed, after(20), draft);
    expect(ws.calls.at(-1)?.direction).toBe("inbound");
    expect(ws.reportCalls?.[0]).toMatchObject({ state: "completed", reportId: ws.reports[0].id });
    expect(reportDoneThisPeriod(ws, slot)).toBe(true);
    expect(reportDoneThisPeriod(ws, after(21))).toBe(false);
    expect(dueScheduledReportCall(ws, nextSlot)).toEqual(nextSlot);
  });

  it("counts a missed run returned after midnight in the run's slot period", () => {
    const first = claimDueReportCall(farm(plan), slot);
    const runId = first.claim!.runId;
    let missed = first.ws;
    for (let attempt = 0; attempt <= REPORT_CALL_RETRIES; attempt++) {
      const now = after(attempt * (RETRY_DELAY_MS / MINUTE));
      if (attempt) missed = placeReportCallAttempt(missed, now, runId).ws;
      missed = resolveReportCallAttempt(missed, now, runId, false).ws;
    }
    expect(missed.reportCalls?.[0].state).toBe("missed");
    expect(routeWorkerInboundCall(missed, after(55))).toEqual({ kind: "report" });
    const { ws } = completeWorkerReport(missed, after(55), draft);
    expect(ws.reportCalls?.[0]).toMatchObject({ state: "completed", reportId: ws.reports[0].id });
    expect(reportDoneThisPeriod(ws, slot)).toBe(true);
    expect(dueScheduledReportCall(ws, nextSlot)).toEqual(nextSlot);
    // The slot's period is done; the new period waits for its own scheduled call.
    expect(routeWorkerInboundCall(ws, after(56))).toEqual({ kind: "rejected", reason: "wait_for_call" });
  });

  it("still blocks a second report in the same day or Basic week", () => {
    const at = fromRiyadh(2026, 11, 4, 17, 0);
    const started = startReportCall(farm(plan), at, "manual");
    let ws = placeReportCallAttempt(started.ws, at, started.run!.id).ws;
    ws = resolveReportCallAttempt(ws, at, started.run!.id, true).ws;
    ws = completeWorkerReport(ws, at, draft, started.run!.id).ws;
    const later = plan === "basic" ? fromRiyadh(2026, 11, 7, 22, 0) : fromRiyadh(2026, 11, 4, 22, 0);
    expect(reportDoneThisPeriod(ws, later)).toBe(true);
    expect(reportCallBlock(ws, later)).toBe("already_reported");
    expect(routeWorkerInboundCall(ws, later)).toEqual({ kind: "rejected", reason: plan === "basic" ? "weekly_done" : "daily_done" });
  });

  it("does not let an out-of-order old-period save hide a current-period report", () => {
    const answered = retryAnswered(plan);
    let ws = completeWorkerReport(answered.ws, after(15), draft).ws;
    ws = completeWorkerReport(ws, after(20), draft, answered.runId).ws;
    expect(reportDoneThisPeriod(ws, after(20))).toBe(true);
    expect(reportCallBlock(ws, after(21))).toBe("already_reported");
  });

  it("keeps manual-run reports in their save period", () => {
    const started = startReportCall(farm(plan), slot, "manual");
    let ws = placeReportCallAttempt(started.ws, slot, started.run!.id).ws;
    ws = resolveReportCallAttempt(ws, slot, started.run!.id, true).ws;
    ws = completeWorkerReport(ws, after(20), draft, started.run!.id).ws;
    expect(reportDoneThisPeriod(ws, slot)).toBe(false);
    expect(reportDoneThisPeriod(ws, after(20))).toBe(true);
  });

  it("uses the scheduled period when opening a delayed slot after midnight", () => {
    const reported = completeWorkerReport(farm(plan), fromRiyadh(2026, 11, 7, 12, 0), draft).ws;
    expect(dueScheduledReportCall(reported, after(15))).toBeNull();
    expect(startReportCall(reported, after(15), "schedule", slot).blocked).toBe("already_reported");
  });
});
