import { describe, expect, it } from "vitest";
import { completeWorkerReport } from "./actions";
import { fromRiyadh, MINUTE, RETRY_DELAY_MS } from "./clock";
import { acceptHerdCountProposal, dismissHerdCountProposal, herdCountProposal } from "./herd";
import {
  activeReportCall,
  dueReportCallAttempts,
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
  it("finds the latest slot at or before now", () => {
    const schedule = { day: 4 as const, time: "17:00" };
    expect(previousScheduledCall(fromRiyadh(2026, 11, 5, 17, 0), "basic", schedule)?.toISOString()).toBe(THU_1700.toISOString());
    expect(previousScheduledCall(fromRiyadh(2026, 11, 5, 16, 59), "basic", schedule)?.toISOString()).toBe(fromRiyadh(2026, 10, 29, 17, 0).toISOString());
    expect(previousScheduledCall(fromRiyadh(2026, 11, 6, 9, 0), "ultimate", schedule)?.toISOString()).toBe(THU_1700.toISOString());
    expect(previousScheduledCall(THU_1700, "basic", { day: null, time: "17:00" })).toBeNull();
  });
});

describe("scheduled report calls", () => {
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
    let { ws, run } = startReportCall(farm(), THU_1700, "schedule");
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

  it("answered → the saved report completes the run once", () => {
    let { ws, run } = startReportCall(farm(), THU_1700, "manual");
    ws = placeReportCallAttempt(ws, THU_1700, run!.id).ws;
    ws = resolveReportCallAttempt(ws, THU_1700, run!.id, true).ws;
    expect(resolveReportCallAttempt(ws, THU_1700, run!.id, true).outcome).toBe("ignored");
    const { ws: saved, report } = completeWorkerReport(ws, fromRiyadh(2026, 11, 5, 17, 6), { ...draft, herdCount: 40 }, run!.id);
    expect(saved.reportCalls?.[0]).toMatchObject({ state: "completed", reportId: report.id });
    expect(saved.calls.at(-1)).toMatchObject({ kind: "worker_report", direction: "outbound" });
    expect(startReportCall(saved, fromRiyadh(2026, 11, 5, 19, 0), "manual").blocked).toBe("already_reported");
  });

  it("an answered call that ends without a report is not retried automatically", () => {
    let { ws, run } = startReportCall(farm("ultimate"), THU_1700, "schedule");
    ws = placeReportCallAttempt(ws, THU_1700, run!.id).ws;
    ws = resolveReportCallAttempt(ws, THU_1700, run!.id, true).ws;
    ws = endReportCallWithoutReport(ws, fromRiyadh(2026, 11, 5, 17, 3), run!.id);
    expect(ws.reportCalls?.[0].state).toBe("missed");
    expect(dueReportCallAttempts(ws, fromRiyadh(2026, 11, 5, 18, 0))).toHaveLength(0);
    expect(startReportCall(ws, fromRiyadh(2026, 11, 5, 18, 0), "manual").blocked).toBeNull();
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
