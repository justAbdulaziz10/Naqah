import { describe, expect, it } from "vitest";
import { completeWorkerReport } from "./actions";
import { fromRiyadh, MINUTE, RETRY_DELAY_MS } from "./clock";
import { acceptHerdCountProposal, dismissHerdCountProposal, herdCountProposal } from "./herd";
import {
  abandonReportCallAttempt,
  activeReportCall,
  claimDueReportCall,
  dueReportCallAttempts,
  REPORT_CALL_GIVE_UP_MS,
  dueScheduledReportCall,
  endReportCallWithoutReport,
  placeReportCallAttempt,
  resolveReportCallAttempt,
  startReportCall,
} from "./reportCalls";
import { previousScheduledCall } from "./schedule";
import { createEmptyWorkspace } from "./seed";
import type { Plan, Workspace } from "./types";
import { allWorkers, canAddWorker, newWorker, setWorkers, workerLimit } from "./workers";

// Thursday 5 Nov 2026, Riyadh.
const THU_1700 = fromRiyadh(2026, 11, 5, 17, 0);
const draft = { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [] };

function farm(plan: Plan = "basic"): Workspace {
  const ws = createEmptyWorkspace(plan);
  ws.setupComplete = true;
  ws.settings.worker = { id: "w1", name: "Ahmed", phone: "+966501234567", language: "ar" };
  ws.settings.callSchedule = { day: plan === "basic" ? 4 : null, time: "17:00" };
  return ws;
}

describe("schedule slots", () => {
  it("counts silence after pickup as unanswered, with two capped retries and duplicate safety", () => {
    const opened = startReportCall(farm(), THU_1700, "schedule");
    let workspace = opened.ws;
    let at = THU_1700;
    for (const attempt of [1, 2, 3]) {
      workspace = placeReportCallAttempt(workspace, at, opened.run!.id).ws;
      workspace = resolveReportCallAttempt(workspace, at, opened.run!.id, true).ws;
      workspace = resolveReportCallAttempt(workspace, at, opened.run!.id, false).ws;
      const run = workspace.reportCalls![0];
      expect(run.attempts).toHaveLength(attempt);
      expect(run.attempts.at(-1)?.result).toBe("no_answer");
      expect(resolveReportCallAttempt(workspace, at, run.id, false).ws).toBe(workspace);
      at = new Date(at.getTime() + RETRY_DELAY_MS);
      expect(run.state).toBe(attempt < 3 ? "calling" : "missed");
      expect(run.nextAttemptAt).toBe(attempt < 3 ? at.toISOString() : null);
    }
  });

  it("does not retry an unsaved manual pickup or reclassify a saved report", () => {
    const opened = startReportCall(farm(), THU_1700, "manual");
    const placed = placeReportCallAttempt(opened.ws, THU_1700, opened.run!.id).ws;
    const answered = resolveReportCallAttempt(placed, THU_1700, opened.run!.id, true).ws;
    const missed = resolveReportCallAttempt(answered, THU_1700, opened.run!.id, false).ws;
    expect(missed.reportCalls![0]).toMatchObject({ state: "missed", nextAttemptAt: null });
    answered.reportCalls![0].state = "completed";
    answered.reportCalls![0].reportId = "saved-report";
    expect(resolveReportCallAttempt(answered, THU_1700, opened.run!.id, false).ws).toBe(answered);
  });
  it("finds the latest slot at or before now", () => {
    const schedule = { day: 4 as const, time: "17:00" };
    expect(previousScheduledCall(fromRiyadh(2026, 11, 5, 17, 0), "basic", schedule)?.toISOString()).toBe(THU_1700.toISOString());
    expect(previousScheduledCall(fromRiyadh(2026, 11, 5, 16, 59), "basic", schedule)?.toISOString()).toBe(fromRiyadh(2026, 10, 29, 17, 0).toISOString());
    expect(previousScheduledCall(fromRiyadh(2026, 11, 6, 9, 0), "ultimate", schedule)?.toISOString()).toBe(THU_1700.toISOString());
    expect(previousScheduledCall(THU_1700, "basic", { day: null, time: "17:00" })).toBeNull();
  });
});

describe("scheduled report calls", () => {
  it("frees the line when a ringing call never got its final status", () => {
    const { ws } = startReportCall(farm(), THU_1700, "manual");
    ws.reportCalls![0].nextAttemptAt = null;
    ws.reportCalls![0].attempts = [{ at: THU_1700.toISOString(), result: "pending" }];
    expect(startReportCall(ws, new Date(THU_1700.getTime() + 60 * MINUTE), "manual").blocked).toBe("in_progress");
    const later = startReportCall(ws, new Date(THU_1700.getTime() + 121 * MINUTE), "manual");
    expect(later.blocked).toBeNull();
    expect(later.ws.reportCalls!.map((run) => run.state)).toEqual(["missed", "calling"]);
  });

  it("frees the line when an answered call never got its final status", () => {
    const { ws } = startReportCall(farm(), THU_1700, "manual");
    ws.reportCalls![0].state = "answered";
    ws.reportCalls![0].attempts = [{ at: THU_1700.toISOString(), result: "answered" }];
    expect(startReportCall(ws, new Date(THU_1700.getTime() + 60 * MINUTE), "manual").blocked).toBe("in_progress");
    const later = startReportCall(ws, new Date(THU_1700.getTime() + 121 * MINUTE), "manual");
    expect(later.blocked).toBeNull();
    expect(later.ws.reportCalls!.map((run) => run.state)).toEqual(["missed", "calling"]);
  });

  it("is due once at the slot, within the grace period, and never twice", () => {
    const ws = farm();
    expect(dueScheduledReportCall(ws, fromRiyadh(2026, 11, 5, 16, 59))).toBeNull();
    const slot = dueScheduledReportCall(ws, fromRiyadh(2026, 11, 5, 17, 2));
    expect(slot?.toISOString()).toBe(THU_1700.toISOString());
    const started = startReportCall(ws, fromRiyadh(2026, 11, 5, 17, 2), "schedule", slot!);
    expect(started.run?.state).toBe("calling");
    expect(dueScheduledReportCall(started.ws, fromRiyadh(2026, 11, 5, 17, 5))).toBeNull();
    expect(startReportCall(started.ws, fromRiyadh(2026, 11, 5, 17, 5), "schedule", slot!).blocked).toBe("in_progress");
    expect(dueScheduledReportCall(ws, fromRiyadh(2026, 11, 5, 18, 30))).toBeNull(); // past grace
  });

  it("needs a dialable worker phone", () => {
    const ws = farm();
    ws.settings.worker.phone = "0501234567";
    expect(dueScheduledReportCall(ws, THU_1700)).toBeNull();
    expect(startReportCall(ws, THU_1700, "manual").blocked).toBe("no_worker_phone");
  });

  it("retries twice, 20 minutes apart, then marks the call missed", () => {
    const started = startReportCall(farm(), THU_1700, "schedule");
    const run = started.run;
    let ws = started.ws;
    const id = run!.id;
    const outcomes: string[] = [];
    let at = THU_1700;
    for (let i = 0; i < 3; i++) {
      expect(dueReportCallAttempts(ws, at).map((r) => r.id)).toEqual([id]);
      ws = placeReportCallAttempt(ws, at, id).ws;
      expect(placeReportCallAttempt(ws, at, id).attempt).toBeNull(); // never placed twice
      expect(dueReportCallAttempts(ws, at)).toHaveLength(0);
      const res = resolveReportCallAttempt(ws, at, id, false);
      ws = res.ws;
      outcomes.push(res.outcome);
      at = new Date(at.getTime() + RETRY_DELAY_MS);
      if (i < 2) expect(dueReportCallAttempts(ws, new Date(at.getTime() - MINUTE))).toHaveLength(0);
    }
    expect(outcomes).toEqual(["retry_scheduled", "retry_scheduled", "missed"]);
    expect(ws.reportCalls?.[0].attempts).toHaveLength(3);
    expect(ws.calls.filter((c) => c.kind === "worker_report_missed")).toHaveLength(3);
    expect(activeReportCall(ws)).toBeNull();
    expect(ws.events.at(-1)?.tone).toBe("attention");
  });

  it("ends an unanswered manual call after one attempt without an unattended retry", () => {
    const started = startReportCall(farm(), THU_1700, "manual");
    const id = started.run!.id;
    const ringing = placeReportCallAttempt(started.ws, THU_1700, id).ws;
    const result = resolveReportCallAttempt(ringing, THU_1700, id, false);
    expect(result.outcome).toBe("missed");
    expect(result.ws.reportCalls?.[0]).toMatchObject({ trigger: "manual", state: "missed", nextAttemptAt: null });
    expect(dueReportCallAttempts(result.ws, new Date(THU_1700.getTime() + RETRY_DELAY_MS))).toHaveLength(0);
    expect(startReportCall(result.ws, new Date(THU_1700.getTime() + RETRY_DELAY_MS), "manual").run).not.toBeNull();
  });

  it("answered → the saved report completes the run once", () => {
    const started = startReportCall(farm(), THU_1700, "manual");
    const run = started.run;
    let ws = started.ws;
    ws = placeReportCallAttempt(ws, THU_1700, run!.id).ws;
    ws = resolveReportCallAttempt(ws, THU_1700, run!.id, true).ws;
    expect(resolveReportCallAttempt(ws, THU_1700, run!.id, true).outcome).toBe("ignored");
    const { ws: saved, report } = completeWorkerReport(ws, fromRiyadh(2026, 11, 5, 17, 6), { ...draft, herdCount: 40 }, run!.id);
    expect(saved.reportCalls?.[0]).toMatchObject({ state: "completed", reportId: report.id });
    expect(saved.calls.at(-1)).toMatchObject({ kind: "worker_report", direction: "outbound" });
    expect(startReportCall(saved, fromRiyadh(2026, 11, 5, 19, 0), "manual").blocked).toBe("already_reported");
  });

  function interrupted(trigger: "schedule" | "manual") {
    const started = startReportCall(farm("ultimate"), THU_1700, trigger);
    let ws = placeReportCallAttempt(started.ws, THU_1700, started.run!.id).ws;
    ws = resolveReportCallAttempt(ws, THU_1700, started.run!.id, true).ws;
    return { ws: endReportCallWithoutReport(ws, fromRiyadh(2026, 11, 5, 17, 3), started.run!.id), runId: started.run!.id };
  }

  it("retries a scheduled call that ended unsaved, consuming the attempt", () => {
    const { ws } = interrupted("schedule");
    expect(ws.reportCalls?.[0]).toMatchObject({ state: "calling", nextAttemptAt: fromRiyadh(2026, 11, 5, 17, 23).toISOString() });
    expect(ws.reportCalls?.[0].attempts).toHaveLength(1);
    expect(dueReportCallAttempts(ws, fromRiyadh(2026, 11, 5, 17, 22))).toHaveLength(0);
    expect(dueReportCallAttempts(ws, fromRiyadh(2026, 11, 5, 17, 23))).toHaveLength(1);
    expect(startReportCall(ws, fromRiyadh(2026, 11, 5, 17, 5), "manual").blocked).toBe("in_progress");
  });

  it("stops after the third interrupted attempt and is missed", () => {
    const { runId, ws: first } = interrupted("schedule");
    let ws = first;
    for (const minute of [23, 43]) {
      const at = fromRiyadh(2026, 11, 5, 17, minute);
      ws = placeReportCallAttempt(ws, at, runId).ws;
      ws = resolveReportCallAttempt(ws, at, runId, true).ws;
      ws = endReportCallWithoutReport(ws, new Date(at.getTime() + MINUTE), runId);
    }
    expect(ws.reportCalls?.[0]).toMatchObject({ state: "missed", nextAttemptAt: null });
    expect(ws.reportCalls?.[0].attempts).toHaveLength(3);
    expect(ws.events.at(-1)?.text.en).toContain("no report for this period");
  });

  it("does not retry a manual call that ended unsaved", () => {
    const { ws } = interrupted("manual");
    expect(ws.reportCalls?.[0]).toMatchObject({ state: "missed", nextAttemptAt: null });
    expect(startReportCall(ws, fromRiyadh(2026, 11, 5, 18, 0), "manual").blocked).toBeNull();
  });

  it("gives up a retry that is left too long after its slot", () => {
    const { ws } = interrupted("schedule");
    const result = claimDueReportCall(ws, new Date(THU_1700.getTime() + REPORT_CALL_GIVE_UP_MS + MINUTE));
    expect(result.claim).toBeNull();
    expect(result.ws.reportCalls?.[0]).toMatchObject({ state: "missed", nextAttemptAt: null });
  });

  it("leaves a saved report alone when the call's end arrives afterwards", () => {
    const started = startReportCall(farm("ultimate"), THU_1700, "schedule");
    let ws = placeReportCallAttempt(started.ws, THU_1700, started.run!.id).ws;
    ws = resolveReportCallAttempt(ws, THU_1700, started.run!.id, true).ws;
    ws = completeWorkerReport(ws, fromRiyadh(2026, 11, 5, 17, 6), { ...draft, herdCount: 40 }, started.run!.id).ws;
    const late = endReportCallWithoutReport(ws, fromRiyadh(2026, 11, 5, 17, 7), started.run!.id);
    expect(late).toBe(ws);
    expect(late.reportCalls?.[0].state).toBe("completed");
  });
});

describe("official herd count", () => {
  it("a worker's count is a proposal the owner accepts or dismisses", () => {
    const ws = farm();
    ws.settings.herdCount = 42;
    const same = completeWorkerReport(ws, THU_1700, { ...draft, herdCount: 42 }).ws;
    expect(herdCountProposal(same)).toBeNull();
    const diff = completeWorkerReport(ws, THU_1700, { ...draft, herdCount: 41 }).ws;
    expect(diff.settings.herdCount).toBe(42); // never overwritten silently
    expect(herdCountProposal(diff)).toMatchObject({ reported: 41, official: 42 });
    const accepted = acceptHerdCountProposal(diff, fromRiyadh(2026, 11, 5, 18, 0));
    expect(accepted.settings.herdCount).toBe(41);
    expect(herdCountProposal(accepted)).toBeNull();
    const dismissed = dismissHerdCountProposal(diff, fromRiyadh(2026, 11, 5, 18, 0));
    expect(dismissed.settings.herdCount).toBe(42);
    expect(herdCountProposal(dismissed)).toBeNull();
  });
});

describe("registered workers", () => {
  it("Basic allows 3 workers, Ultimate 10, and the chosen primary is the one NAQAH calls", () => {
    expect(workerLimit("basic")).toBe(3);
    expect(workerLimit("ultimate")).toBe(10);
    const ws = farm();
    const list = [ws.settings.worker, { ...newWorker(), name: "Salem" }, { ...newWorker(), name: "Omar" }, { ...newWorker(), name: "Extra" }];
    const settings = setWorkers(ws.settings, list, 1);
    expect(settings.worker.name).toBe("Salem");
    expect(allWorkers(settings).map((w) => w.name)).toEqual(["Salem", "Ahmed", "Omar"]);
    expect(canAddWorker(settings)).toBe(false);
    expect(canAddWorker({ ...settings, plan: "ultimate" })).toBe(true);
  });
});

describe("scheduler claims", () => {
  it("claims the due slot once, then the retry when it is due", () => {
    const first = claimDueReportCall(farm(), THU_1700);
    expect(first.claim).toMatchObject({ attempt: 1, phone: "+966501234567" });
    expect(claimDueReportCall(first.ws, THU_1700).claim).toBeNull();

    const unanswered = resolveReportCallAttempt(first.ws, THU_1700, first.claim!.runId, false).ws;
    expect(claimDueReportCall(unanswered, new Date(THU_1700.getTime() + 19 * MINUTE)).claim).toBeNull();
    const retry = claimDueReportCall(unanswered, new Date(THU_1700.getTime() + RETRY_DELAY_MS));
    expect(retry.claim).toEqual({ runId: first.claim!.runId, attempt: 2, phone: "+966501234567" });
  });

  it("claims nothing without a dialable number or outside the slot", () => {
    const noPhone = farm();
    noPhone.settings.worker.phone = "";
    expect(claimDueReportCall(noPhone, THU_1700).claim).toBeNull();
    expect(claimDueReportCall(farm(), fromRiyadh(2026, 11, 5, 16, 0)).claim).toBeNull();
  });

  it("undoes an attempt the provider never placed, without logging a missed call", () => {
    const claimed = claimDueReportCall(farm(), THU_1700);
    const abandoned = abandonReportCallAttempt(claimed.ws, THU_1700, claimed.claim!.runId, 1);
    const run = abandoned.reportCalls![0];
    expect(run.attempts).toEqual([]);
    expect(run.state).toBe("calling");
    expect(run.nextAttemptAt).toBe(new Date(THU_1700.getTime() + RETRY_DELAY_MS).toISOString());
    expect(abandoned.calls).toHaveLength(0);
    expect(abandonReportCallAttempt(abandoned, THU_1700, run.id, 1)).toBe(abandoned);

    const late = new Date(THU_1700.getTime() + 4 * 60 * MINUTE);
    const reclaimed = claimDueReportCall(abandoned, late);
    expect(abandonReportCallAttempt(reclaimed.ws, late, run.id, 1).reportCalls![0].state).toBe("missed");
  });
});
