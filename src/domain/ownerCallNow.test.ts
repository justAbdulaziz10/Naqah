import { describe, expect, it } from "vitest";
import { completeWorkerReport } from "./actions";
import { MINUTE } from "./clock";
import {
  abandonOwnerCallAttempt, anyCallLive, claimDueOwnerCall, markOwnerCallAnswered, openOwnerCallNow, resolveOwnerCallAttempt,
} from "./ownerCalls";
import { createEmptyWorkspace } from "./seed";
import type { ReportCallRun, Workspace } from "./types";

const NOW = new Date("2026-11-11T13:00:00.000Z"); // Wednesday 16:00 Riyadh, no owner slot
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
const draft = { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [] };

function farm(): Workspace {
  const ws = createEmptyWorkspace("ultimate");
  ws.setupComplete = true;
  ws.settings.owner = { name: "Abdullah", phone: "+966 55 012 3344" };
  ws.settings.worker = { ...ws.settings.worker, name: "Ahmed", phone: "+966501234567" };
  ws.settings.ownerCallSchedule = { day: null, time: "19:00" };
  return ws;
}
const notifications = (ws: Workspace) => ws.calls.filter((call) => call.kind === "owner_notification");
const workerRun = (state: ReportCallRun["state"], result: ReportCallRun["attempts"][number]["result"] = "pending"): ReportCallRun => ({
  id: "rcl_1", occurrence: at(-2).toISOString(), trigger: "manual", attempts: [{ at: at(-2).toISOString(), result }],
  nextAttemptAt: null, state, reportId: null,
});

describe("owner call now (local demo)", () => {
  it("opens a manual run for the newest report, recorded as a placed attempt before anything is dialled", () => {
    const { ws: reported, report } = completeWorkerReport(farm(), at(-30), draft);
    const opened = openOwnerCallNow(reported, NOW);
    expect(opened.blocked).toBeNull();
    expect(opened.claim).toEqual({ runId: opened.ws.ownerCallRun!.id, attempt: 1, phone: "+966550123344", reportId: report.id });
    expect(opened.ws.ownerCallRun).toMatchObject({ occurrence: NOW.toISOString(), state: "calling", nextAttemptAt: null, trigger: "manual", reportId: report.id });
    expect(opened.ws.ownerCallRun!.attempts).toEqual([{ at: NOW.toISOString(), result: "pending" }]);
  });

  it("with no new report it opens the 'no verified report' briefing, as the scheduled call does", () => {
    const opened = openOwnerCallNow(farm(), NOW);
    expect(opened.claim?.reportId).toBeNull();
    const done = resolveOwnerCallAttempt(opened.ws, at(2), opened.claim!.runId, 1, "completed");
    expect(notifications(done)).toMatchObject([{ outcome: "completed", reportId: null }]);
  });

  it("never touches report call runs, reports or the worker", () => {
    const { ws: reported } = completeWorkerReport(farm(), at(-30), draft);
    reported.reportCalls = [{ ...workerRun("completed", "answered"), reportId: reported.reports[0].id }];
    const opened = openOwnerCallNow(reported, NOW);
    expect(opened.ws.reportCalls).toEqual(reported.reportCalls);
    expect(opened.ws.reports).toEqual(reported.reports);
    expect(opened.ws.settings).toEqual(reported.settings);
    expect(opened.ws.pendingWorkerCalls).toEqual(reported.pendingWorkerCalls);
    expect(opened.ws.taskTickets).toEqual(reported.taskTickets);
  });

  it("is refused without a finished setup or a dialable owner number", () => {
    expect(openOwnerCallNow({ ...farm(), setupComplete: false }, NOW).blocked).toBe("setup_incomplete");
    const bad = farm();
    bad.settings.owner.phone = "0501234567";
    const refused = openOwnerCallNow(bad, NOW);
    expect(refused).toMatchObject({ blocked: "no_owner_phone", claim: null });
    expect(refused.ws).toBe(bad);
  });

  it("is refused while a worker report call or an owner call is live", () => {
    const ringing = farm();
    ringing.reportCalls = [workerRun("calling")];
    expect(openOwnerCallNow(ringing, NOW).blocked).toBe("call_live");
    const talking = farm();
    talking.reportCalls = [workerRun("answered", "answered")];
    expect(anyCallLive(talking, NOW)).toBe(true);
    expect(openOwnerCallNow(talking, NOW).blocked).toBe("call_live");

    const first = openOwnerCallNow(farm(), NOW);
    expect(openOwnerCallNow(first.ws, at(1)).blocked).toBe("call_live");
    const answered = markOwnerCallAnswered(first.ws, at(1), first.claim!.runId);
    expect(openOwnerCallNow(answered, at(3)).blocked).toBe("call_live");
  });

  it("answered and completed: recorded once, as the scheduled call is", () => {
    const opened = openOwnerCallNow(farm(), NOW);
    const answered = markOwnerCallAnswered(opened.ws, at(1), opened.claim!.runId);
    expect(answered.ownerCallRun!.state).toBe("answered");
    const done = resolveOwnerCallAttempt(answered, at(3), opened.claim!.runId, 1, "completed");
    expect(done.ownerCallRun!.state).toBe("completed");
    expect(notifications(done)).toHaveLength(1);
    expect(resolveOwnerCallAttempt(done, at(4), opened.claim!.runId, 1, "interrupted")).toBe(done);
    // A later press after it ended is allowed again.
    expect(openOwnerCallNow(done, at(5)).blocked).toBeNull();
  });

  it("one attempt: unanswered or interrupted ends it as missed, never a retry", () => {
    for (const result of ["unanswered", "interrupted"] as const) {
      const opened = openOwnerCallNow(farm(), NOW);
      const ended = resolveOwnerCallAttempt(opened.ws, at(1), opened.claim!.runId, 1, result);
      expect(ended.ownerCallRun).toMatchObject({ state: "missed", nextAttemptAt: null });
      expect(notifications(ended)).toMatchObject([{ outcome: "no_answer" }]);
      expect(claimDueOwnerCall(ended, at(25)).claim).toBeNull();
    }
  });

  it("a call the provider never placed is undone without a retry or a missed notification", () => {
    const opened = openOwnerCallNow(farm(), NOW);
    const undone = abandonOwnerCallAttempt(opened.ws, NOW, opened.claim!.runId, 1);
    expect(undone.ownerCallRun).toMatchObject({ state: "missed", attempts: [], nextAttemptAt: null });
    expect(notifications(undone)).toHaveLength(0);
    expect(undone.missedNotificationAt).toBe(opened.ws.missedNotificationAt);
  });

  it("settles a ringing attempt whose status was lost, then calls again", () => {
    const opened = openOwnerCallNow(farm(), NOW);
    const again = openOwnerCallNow(opened.ws, at(16));
    expect(again.blocked).toBeNull();
    expect(notifications(again.ws)).toEqual([]);
    expect(again.ws.missedNotificationAt).toBeNull();
    expect(again.ws.ownerCallRun!.id).not.toBe(opened.claim!.runId);
  });

  it("scheduled runs keep their three attempts", () => {
    const ws = farm();
    ws.settings.ownerCallSchedule = { day: null, time: "16:00" };
    const scheduled = claimDueOwnerCall(ws, NOW);
    expect(scheduled.ws.ownerCallRun!.trigger).toBeUndefined();
    const retry = resolveOwnerCallAttempt(scheduled.ws, at(1), scheduled.claim!.runId, 1, "unanswered");
    expect(retry.ownerCallRun).toMatchObject({ state: "calling", nextAttemptAt: at(21).toISOString() });
  });
});
