import { REPORT_CALL_RETRIES, toMinutes } from "@/domain/clock";
import { latestReportCall, reportCallIsLive } from "@/domain/reportCalls";
import { isCompleteCallSchedule, nextScheduledCall, previousScheduledCall } from "@/domain/schedule";
import type { Workspace } from "@/domain/types";

/** The contract's limit: three attempts, for the worker and for the owner alike. */
export const CALL_ATTEMPTS = REPORT_CALL_RETRIES + 1;

export type WorkerCallStatus =
  | { kind: "ringing"; at: string }
  | { kind: "on_call"; at: string }
  | { kind: "retry"; at: string; attempt: number; of: number; connected: boolean }
  /** Attempts ended with no report saved after them. `connected`: the worker picked up on the last one. */
  | { kind: "missed"; at: string; attempts: number; connected: boolean };

export type OwnerCallStatus =
  | { kind: "ringing"; at: string }
  | { kind: "on_call"; at: string }
  | { kind: "retry"; at: string; attempt: number; of: number; connected: boolean }
  /** `reportId` null: NAQAH told the owner no verified report had arrived. */
  | { kind: "completed"; at: string; reportId: string | null }
  | { kind: "missed"; at: string; attempts: number };

/** Where the latest call to the worker stands. null once a report has been saved after it. */
export function workerCallStatus(ws: Workspace, now: Date): WorkerCallStatus | null {
  const run = latestReportCall(ws);
  if (!run) return null;
  const last = run.attempts.at(-1);
  const at = last?.at ?? run.occurrence;
  if (reportCallIsLive(run, now)) {
    if (run.state === "answered") return { kind: "on_call", at };
    if (run.nextAttemptAt && last?.result !== "pending") {
      return { kind: "retry", at: run.nextAttemptAt, attempt: run.attempts.length + 1, of: CALL_ATTEMPTS, connected: last?.result === "answered" };
    }
    return { kind: "ringing", at };
  }
  if (run.state === "completed") return null;
  const reportedSince = ws.reports.some((report) => Date.parse(report.at) >= Date.parse(run.occurrence));
  if (reportedSince) return null;
  return { kind: "missed", at, attempts: run.attempts.length, connected: last?.result === "answered" };
}

/** The newest attempts to reach the worker failed and nothing was saved after them. */
export const noVerifiedReport = (status: WorkerCallStatus | null) => status?.kind === "missed";

/** The worker's scheduled call has passed since the latest report, so that report is not this period's. */
export function latestReportIsOld(ws: Workspace, now: Date, reportAt: string | null): boolean {
  if (!reportAt) return false;
  const slot = previousScheduledCall(now, ws.settings.plan, ws.settings.callSchedule);
  return slot !== null && Date.parse(reportAt) < slot.getTime();
}

/** Where the owner's call stands. A run from before the owner's latest slot is old news. */
export function ownerCallStatus(ws: Workspace, now: Date): OwnerCallStatus | null {
  const run = ws.ownerCallRun;
  if (!run) return null;
  const slot = previousScheduledCall(now, ws.settings.plan, ws.settings.ownerCallSchedule);
  if (slot && Date.parse(run.occurrence) < slot.getTime()) return null;
  const last = run.attempts.at(-1);
  const at = last?.at ?? run.occurrence;
  if (run.state === "answered") return { kind: "on_call", at };
  if (run.state === "completed") return { kind: "completed", at, reportId: run.reportId };
  if (run.state === "missed") return { kind: "missed", at, attempts: run.attempts.length };
  if (run.nextAttemptAt && last?.result !== "pending") {
    return { kind: "retry", at: run.nextAttemptAt, attempt: run.attempts.length + 1, of: CALL_ATTEMPTS, connected: last?.result === "interrupted" };
  }
  return { kind: "ringing", at };
}

export const nextOwnerCall = (ws: Workspace, now: Date) => nextScheduledCall(now, ws.settings.plan, ws.settings.ownerCallSchedule);

/** On the same day, the owner's time is earlier than the worker's, so that day's report won't exist yet. */
export function ownerCallsBeforeWorker(ws: Workspace): boolean {
  const { plan, callSchedule, ownerCallSchedule } = ws.settings;
  if (!callSchedule || !ownerCallSchedule) return false;
  if (!isCompleteCallSchedule(plan, callSchedule) || !isCompleteCallSchedule(plan, ownerCallSchedule)) return false;
  if (plan === "basic" && callSchedule.day !== ownerCallSchedule.day) return false;
  return toMinutes(ownerCallSchedule.time) < toMinutes(callSchedule.time);
}
