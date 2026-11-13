import { beforeEach, describe, expect, it } from "vitest";
import { completeWorkerReport } from "./actions";
import { fromRiyadh, MINUTE, RETRY_DELAY_MS } from "./clock";
import { routeOwnerInboundCall } from "./rules";
import {
  abandonOwnerCallAttempt, claimDueOwnerCall, dueOwnerCallSlot, markOwnerCallAnswered, newestUnsummarizedReport, openOwnerCallNow,
  resolveOwnerCallAttempt, OWNER_CALL_ATTEMPTS,
} from "./ownerCalls";
import { createEmptyWorkspace } from "./seed";
import type { Plan, ReportCallRun, Workspace } from "./types";

const THU_1800 = new Date("2026-11-12T15:00:00.000Z"); // Thursday 18:00 Riyadh
const at = (minutes: number) => new Date(THU_1800.getTime() + minutes * MINUTE);
const draft = { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [] };

function farm(plan: Plan = "basic"): Workspace {
  const ws = createEmptyWorkspace(plan);
  ws.setupComplete = true;
  ws.settings.owner = { name: "Abdullah", phone: "+966 55 012 3344" };
  ws.settings.worker = { ...ws.settings.worker, name: "Ahmed", phone: "+966501234567" };
  ws.settings.ownerCallSchedule = { day: plan === "basic" ? 4 : null, time: "18:00" };
  return ws;
}

const claim = (ws: Workspace, minutes: number) => claimDueOwnerCall(ws, at(minutes));
const liveWorkerRun = (state: ReportCallRun["state"] = "calling"): ReportCallRun => ({
  id: "rcl_1", occurrence: at(-5).toISOString(), trigger: "schedule", attempts: [{ at: at(-5).toISOString(), result: "no_answer" }],
  nextAttemptAt: at(15).toISOString(), state, reportId: null,
});
const notifications = (ws: Workspace) => ws.calls.filter((call) => call.kind === "owner_notification");

describe("missed owner notification periods", () => {
  it("keeps a Saturday slot in its own week when its final attempt ends on Sunday", () => {
    const slot = fromRiyadh(2026, 11, 7, 23, 50);
    const input = farm();
    input.settings.ownerCallSchedule = { day: 6, time: "23:50" };
    let ws = input;
    let endedAt = slot;
    let now = slot;
    for (let attempt = 1; attempt <= OWNER_CALL_ATTEMPTS; attempt++) {
      const claimed = claimDueOwnerCall(ws, now);
      expect(claimed.claim?.attempt).toBe(attempt);
      endedAt = new Date(now.getTime() + MINUTE);
      ws = resolveOwnerCallAttempt(claimed.ws, endedAt, claimed.claim!.runId, attempt, "unanswered");
      now = new Date(endedAt.getTime() + RETRY_DELAY_MS);
    }
    expect(ws.missedNotificationAt).toBe(slot.toISOString());
    expect(notifications(ws)[0].at).toBe(endedAt.toISOString());
    expect(routeOwnerInboundCall(ws, fromRiyadh(2026, 11, 7, 23, 59))).toEqual({ kind: "inquiry", mode: "missed_callback" });
    expect(routeOwnerInboundCall(ws, endedAt)).toEqual({ kind: "inquiry", mode: "weekly" });
  });
});

describe("opening an owner slot", () => {
  it("opens once per occurrence, recorded before anything is dialled", () => {
    const first = claim(farm(), 0);
    expect(first.claim).toMatchObject({ attempt: 1, phone: "+966550123344", reportId: null });
    expect(first.ws.ownerCallRun).toMatchObject({ occurrence: THU_1800.toISOString(), state: "calling", nextAttemptAt: null });
    expect(first.ws.ownerCallRun!.attempts).toEqual([{ at: THU_1800.toISOString(), result: "pending" }]);
    expect(claim(first.ws, 1).claim).toBeNull();

    const done = resolveOwnerCallAttempt(first.ws, at(1), first.claim!.runId, 1, "completed");
    expect(claim(done, 2).claim).toBeNull();
  });

  it("opens only inside the grace period", () => {
    expect(claim(farm(), 60).claim).not.toBeNull();
    expect(claim(farm(), 61).claim).toBeNull();
    expect(claim(farm(), -1).claim).toBeNull();
  });

  it("needs a finished setup, a chosen time and a dialable number", () => {
    expect(claim({ ...farm(), setupComplete: false }, 0).claim).toBeNull();
    const noSchedule = farm();
    noSchedule.settings.ownerCallSchedule = null;
    expect(claim(noSchedule, 0).claim).toBeNull();
    const badPhone = farm();
    badPhone.settings.owner.phone = "0501234567";
    expect(claim(badPhone, 0).claim).toBeNull();
  });

  it("follows the plan's cadence", () => {
    const friday = at(24 * 60);
    expect(claimDueOwnerCall(farm("basic"), friday).claim).toBeNull();
    expect(claimDueOwnerCall(farm("ultimate"), friday).claim).toMatchObject({ attempt: 1 });
    const nextWeek = at(7 * 24 * 60);
    expect(claimDueOwnerCall(farm("basic"), nextWeek).claim).toMatchObject({ attempt: 1 });
  });

  it("opens the next day's slot on Ultimate after yesterday's finished", () => {
    const today = claim(farm("ultimate"), 0);
    const done = resolveOwnerCallAttempt(today.ws, at(5), today.claim!.runId, 1, "completed");
    const tomorrow = claimDueOwnerCall(done, at(24 * 60));
    expect(tomorrow.claim).toMatchObject({ attempt: 1 });
    expect(tomorrow.claim!.runId).not.toBe(today.claim!.runId);
  });
});

describe("deferring for the worker's call", () => {
  it("waits while a worker report call is live", () => {
    const ws = { ...farm(), reportCalls: [liveWorkerRun()] };
    expect(dueOwnerCallSlot(ws, at(0))).toBeNull();
    expect(claim(ws, 5)).toMatchObject({ ws, claim: null });
  });

  it("opens once the worker's attempts have ended", () => {
    const ws = { ...farm(), reportCalls: [{ ...liveWorkerRun("missed"), nextAttemptAt: null }] };
    expect(claim(ws, 5).claim).toMatchObject({ attempt: 1 });
  });

  it("does not defer past the grace period, so a scheduler tick still reaches the owner", () => {
    const ws = { ...farm(), reportCalls: [liveWorkerRun("answered")] };
    expect(claim(ws, 49).claim).toBeNull();
    expect(claim(ws, 50).claim).toMatchObject({ attempt: 1 });
  });
});

describe("each attempt's outcome", () => {
  let ws: Workspace;
  let runId: string;

  beforeEach(() => {
    const first = claim(farm(), 0);
    ws = first.ws;
    runId = first.claim!.runId;
  });

  it("retries an unanswered attempt after 20 minutes", () => {
    const next = resolveOwnerCallAttempt(ws, at(1), runId, 1, "unanswered");
    expect(next.ownerCallRun).toMatchObject({ state: "calling", nextAttemptAt: at(21).toISOString() });
    expect(claim(next, 20).claim).toBeNull();
    expect(claim(next, 21).claim).toMatchObject({ runId, attempt: 2 });
  });

  it("counts an interrupted attempt as unsuccessful", () => {
    const answered = markOwnerCallAnswered(ws, at(0), runId);
    expect(answered.ownerCallRun!.state).toBe("answered");
    const next = resolveOwnerCallAttempt(answered, at(3), runId, 1, "interrupted");
    expect(next.ownerCallRun).toMatchObject({ state: "calling", nextAttemptAt: at(23).toISOString() });
    expect(next.ownerCallRun!.attempts[0].result).toBe("interrupted");
    expect(notifications(next)).toHaveLength(0);
  });

  it("gives up after 3 attempts and records the missed call once", () => {
    let current = resolveOwnerCallAttempt(ws, at(1), runId, 1, "unanswered");
    current = claim(current, 21).ws;
    current = resolveOwnerCallAttempt(current, at(22), runId, 2, "interrupted");
    current = claim(current, 42).ws;
    current = resolveOwnerCallAttempt(current, at(43), runId, 3, "unanswered");
    expect(current.ownerCallRun).toMatchObject({ state: "missed", nextAttemptAt: null });
    expect(notifications(current)).toEqual([expect.objectContaining({ outcome: "no_answer", reportId: null })]);
    expect(current.missedNotificationAt).toBe(THU_1800.toISOString());
    expect(current.events.at(-2)?.text.en).toContain("didn't complete after 3 attempts");
    expect(claim(current, 50).claim).toBeNull();
    expect(resolveOwnerCallAttempt(current, at(44), runId, 3, "unanswered")).toBe(current);
  });

  it("stops on completion and records it once", () => {
    const answered = markOwnerCallAnswered(ws, at(0), runId);
    const done = resolveOwnerCallAttempt(answered, at(2), runId, 1, "completed");
    expect(done.ownerCallRun).toMatchObject({ state: "completed", nextAttemptAt: null });
    expect(notifications(done)).toEqual([expect.objectContaining({ outcome: "completed" })]);
    expect(done.ownerAllowanceUsedAt).toBe(at(2).toISOString());
    expect(resolveOwnerCallAttempt(done, at(3), runId, 1, "completed")).toBe(done);
  });

  it("never downgrades a completion", () => {
    const done = resolveOwnerCallAttempt(markOwnerCallAnswered(ws, at(0), runId), at(2), runId, 1, "completed");
    expect(resolveOwnerCallAttempt(done, at(3), runId, 1, "interrupted")).toBe(done);
    expect(resolveOwnerCallAttempt(done, at(3), runId, 1, "unanswered")).toBe(done);
  });

  it("ignores an outcome for another run or an earlier attempt", () => {
    expect(resolveOwnerCallAttempt(ws, at(1), "ocr_other", 1, "completed")).toBe(ws);
    const second = claim(resolveOwnerCallAttempt(ws, at(1), runId, 1, "unanswered"), 21).ws;
    expect(resolveOwnerCallAttempt(second, at(22), runId, 1, "completed")).toBe(second);
  });

  it("marks answered only while ringing, and repeating it changes nothing", () => {
    const answered = markOwnerCallAnswered(ws, at(0), runId);
    expect(markOwnerCallAnswered(answered, at(0), runId)).toBe(answered);
    expect(markOwnerCallAnswered(ws, at(0), "ocr_other")).toBe(ws);
  });

  it("does not count a call the provider refused", () => {
    const refused = abandonOwnerCallAttempt(ws, at(0), runId, 1);
    expect(refused.ownerCallRun).toMatchObject({ state: "calling", attempts: [], nextAttemptAt: at(20).toISOString() });
    expect(notifications(refused)).toHaveLength(0);
    expect(claim(refused, 20).claim).toMatchObject({ runId, attempt: 1 });
    expect(abandonOwnerCallAttempt(refused, at(1), runId, 1)).toBe(refused);
  });

  it("frees a ringing attempt whose webhook never arrives", () => {
    expect(claim(ws, 14)).toMatchObject({ claim: null });
    expect(claim(ws, 14).ws).toBe(ws);
    const lost = claim(ws, 15);
    expect(lost.claim).toBeNull();
    expect(lost.ws.ownerCallRun!.attempts[0].result).toBe("unanswered");
    expect(lost.ws.ownerCallRun!.attempts[0].placementUnknown).toBe(true);
    expect(lost.ws.ownerCallRun!.nextAttemptAt).toBe(at(35).toISOString());
  });

  it("exhausts placement-unknown attempts without recording a missed notification or granting a missed callback", () => {
    let current = ws;
    for (const minute of [15, 50, 85]) {
      if (minute > 15) current = claim(current, minute - 15).ws;
      current = claim(current, minute).ws;
    }
    expect(current.ownerCallRun).toMatchObject({ state: "missed", nextAttemptAt: null });
    expect(current.ownerCallRun!.attempts).toHaveLength(3);
    expect(current.ownerCallRun!.attempts.every((attempt) => attempt.placementUnknown)).toBe(true);
    expect(notifications(current)).toEqual([]);
    expect(current.missedNotificationAt).toBeNull();
    expect(routeOwnerInboundCall(current, at(86))).not.toMatchObject({ mode: "missed_callback" });
  });

  it("still records a missed notification when a real no-answer precedes unknown placements", () => {
    let current = resolveOwnerCallAttempt(ws, at(1), runId, 1, "unanswered");
    current = claim(current, 21).ws;
    current = claim(current, 36).ws;
    current = claim(current, 56).ws;
    current = claim(current, 71).ws;
    expect(current.ownerCallRun!.state).toBe("missed");
    expect(notifications(current)).toHaveLength(1);
    expect(current.missedNotificationAt).toBe(THU_1800.toISOString());
  });

  it("does not grant a missed notification when an unknown retry ages out", () => {
    const unknown = claim(ws, 15).ws;
    const expired = claim(unknown, 181).ws;
    expect(expired.ownerCallRun!.state).toBe("missed");
    expect(expired.missedNotificationAt).toBeNull();
    expect(notifications(expired)).toEqual([]);
  });

  it("does not grant a missed notification when a manual unknown call expires or is replaced", () => {
    const opened = openOwnerCallNow(farm(), at(0));
    const expired = claim(opened.ws, 15).ws;
    expect(expired.ownerCallRun).toMatchObject({ state: "missed", attempts: [{ result: "unanswered", placementUnknown: true }] });
    expect(expired.missedNotificationAt).toBeNull();
    expect(notifications(expired)).toEqual([]);
    const replacement = openOwnerCallNow(opened.ws, at(15));
    expect(replacement.claim).not.toBeNull();
    expect(replacement.ws.missedNotificationAt).toBeNull();
    expect(notifications(replacement.ws)).toEqual([]);
  });

  it("frees an answered attempt whose final status never arrives", () => {
    const answered = markOwnerCallAnswered(ws, at(0), runId);
    expect(claim(answered, 59).ws).toBe(answered);
    const lost = claim(answered, 60);
    expect(lost.ws.ownerCallRun!.attempts[0].result).toBe("interrupted");
    expect(lost.ws.ownerCallRun!.state).toBe("calling");
  });

  it("gives up on a retry left waiting past the slot, without ringing", () => {
    const waiting = resolveOwnerCallAttempt(ws, at(1), runId, 1, "unanswered");
    const late = claim(waiting, 181);
    expect(late.claim).toBeNull();
    expect(late.ws.ownerCallRun!.state).toBe("missed");
    expect(notifications(late.ws)).toHaveLength(1);
  });

  it("logs no missed call when the phone never rang", () => {
    const refused = abandonOwnerCallAttempt(ws, at(181), runId, 1);
    expect(refused.ownerCallRun).toMatchObject({ state: "missed", attempts: [] });
    expect(notifications(refused)).toHaveLength(0);
    expect(refused.events.at(-1)?.text.en).toContain("couldn't place");
  });
});

describe("choosing the report", () => {
  const withReport = (ws: Workspace, minutes: number) => completeWorkerReport(ws, at(minutes), draft);

  it("is null with no report: still an owner call", () => {
    const opened = claim(farm(), 0);
    expect(opened.claim).toMatchObject({ reportId: null });
    const done = resolveOwnerCallAttempt(opened.ws, at(1), opened.claim!.runId, 1, "completed");
    expect(notifications(done)[0]).toMatchObject({ reportId: null, summary: { en: "Owner told that no verified report has arrived" } });
  });

  it("picks the newest saved report", () => {
    const first = withReport(farm("ultimate"), -120);
    const second = withReport(first.ws, -60);
    expect(claim(second.ws, 0).claim).toMatchObject({ reportId: second.report.id });
  });

  it("does not repeat a report the owner already heard", () => {
    const saved = withReport(farm("ultimate"), -60);
    const opened = claim(saved.ws, 0);
    const done = resolveOwnerCallAttempt(opened.ws, at(2), opened.claim!.runId, 1, "completed");
    expect(newestUnsummarizedReport(done)).toBeNull();
    expect(claimDueOwnerCall(done, at(24 * 60)).claim).toMatchObject({ reportId: null });
  });

  it("still tells the owner a report from a run that was never heard", () => {
    const saved = withReport(farm("ultimate"), -60);
    const opened = claim(saved.ws, 0);
    const interrupted = resolveOwnerCallAttempt(opened.ws, at(1), opened.claim!.runId, 1, "interrupted");
    expect(newestUnsummarizedReport(interrupted)?.id).toBe(saved.report.id);
  });

  it("re-picks at each attempt, so a report saved during retries is used", () => {
    const opened = claim(farm("ultimate"), 0);
    const missed = resolveOwnerCallAttempt(opened.ws, at(1), opened.claim!.runId, 1, "unanswered");
    const saved = withReport(missed, 10);
    expect(claim(saved.ws, 21).claim).toMatchObject({ attempt: 2, reportId: saved.report.id });
  });
});
