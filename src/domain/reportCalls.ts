/**
 * Scheduled report calls: NAQAH calls the primary worker, the worker does not call NAQAH to report.
 * Basic: one slot a week. Ultimate: one slot a day. Unanswered: retry after 20 minutes, up to 2 retries,
 * then the run is "missed" and the owner is told. Pure functions; the scheduler, the Twilio status
 * callback and the Call Lab all go through them.
 */
import { pushCall, pushEvent } from "./actions";
import { REPORT_CALL_GRACE_MS, REPORT_CALL_RETRIES, RETRY_DELAY_MS } from "./clock";
import { uid } from "./id";
import { reportDoneThisPeriod } from "./rules";
import { previousScheduledCall } from "./schedule";
import type { ReportCallRun, Workspace } from "./types";

const iso = (d: Date) => d.toISOString();

const isActive = (run: ReportCallRun) => run.state === "calling" || run.state === "answered";

export const reportCallRuns = (ws: Workspace): ReportCallRun[] => ws.reportCalls ?? [];

/** The report call currently ringing, waiting for a retry or in conversation. */
export function activeReportCall(ws: Workspace): ReportCallRun | null {
  return reportCallRuns(ws).find(isActive) ?? null;
}

export function latestReportCall(ws: Workspace): ReportCallRun | null {
  const runs = reportCallRuns(ws);
  return runs.length ? runs[runs.length - 1] : null;
}

/** A worker number NAQAH can dial: E.164 after removing spaces and dashes. */
export function dialableWorkerPhone(ws: Workspace): string | null {
  const phone = ws.settings.worker.phone.replace(/[\s-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export type ReportCallBlock = "no_worker_phone" | "already_reported" | "in_progress";

/** Why a report call can't start now, or null when it can. Shared by "Call now" and the scheduler. */
export function reportCallBlock(ws: Workspace, now: Date): ReportCallBlock | null {
  if (!dialableWorkerPhone(ws)) return "no_worker_phone";
  if (activeReportCall(ws)) return "in_progress";
  if (reportDoneThisPeriod(ws, now)) return "already_reported";
  return null;
}

/**
 * The scheduled slot that should be called now, or null. A slot is called once (its occurrence is
 * recorded), only within the grace period after its time, and never after the period's report is in.
 */
export function dueScheduledReportCall(ws: Workspace, now: Date): Date | null {
  const slot = previousScheduledCall(now, ws.settings.plan, ws.settings.callSchedule);
  if (!slot || now.getTime() - slot.getTime() > REPORT_CALL_GRACE_MS) return null;
  if (reportCallRuns(ws).some((run) => run.occurrence === iso(slot))) return null;
  if (reportCallBlock(ws, now)) return null;
  return slot;
}

/**
 * Open a report-call run. The first attempt is due immediately. Returns the unchanged workspace and
 * the blocking reason when a call can't start, so callers never place a second call for one slot.
 */
export function startReportCall(
  input: Workspace,
  now: Date,
  trigger: ReportCallRun["trigger"],
  occurrence: Date = now,
): { ws: Workspace; run: ReportCallRun | null; blocked: ReportCallBlock | "duplicate" | null } {
  const blocked = reportCallBlock(input, now);
  if (blocked) return { ws: input, run: null, blocked };
  if (reportCallRuns(input).some((r) => r.occurrence === iso(occurrence))) return { ws: input, run: null, blocked: "duplicate" };
  const ws = structuredClone(input);
  const run: ReportCallRun = {
    id: uid("rcl"),
    occurrence: iso(occurrence),
    trigger,
    attempts: [],
    nextAttemptAt: iso(now),
    state: "calling",
    reportId: null,
  };
  ws.reportCalls = [...reportCallRuns(ws), run];
  pushEvent(ws, now, "neutral", {
    ar: trigger === "manual" ? `طلبت مكالمة التقرير الآن — ناقة تتصل بـ${ws.settings.worker.name}` : `حان موعد التقرير — ناقة تتصل بـ${ws.settings.worker.name}`,
    en: trigger === "manual" ? `You asked for the report call now — NAQAH is calling ${ws.settings.worker.name}` : `Report time — NAQAH is calling ${ws.settings.worker.name}`,
  });
  return { ws, run, blocked: null };
}

/** Runs whose next attempt is due: the scheduler places these calls. */
export function dueReportCallAttempts(ws: Workspace, now: Date): ReportCallRun[] {
  return reportCallRuns(ws).filter(
    (run) => run.state === "calling" && run.nextAttemptAt !== null && new Date(run.nextAttemptAt).getTime() <= now.getTime(),
  );
}

/** Record that an attempt was dialled. Idempotent: an attempt already ringing is not placed twice. */
export function placeReportCallAttempt(input: Workspace, now: Date, runId: string): { ws: Workspace; attempt: number | null } {
  const current = reportCallRuns(input).find((r) => r.id === runId);
  if (!current || current.state !== "calling" || current.nextAttemptAt === null) return { ws: input, attempt: null };
  const ws = structuredClone(input);
  const run = reportCallRuns(ws).find((r) => r.id === runId)!;
  run.attempts.push({ at: iso(now), result: "pending" });
  run.nextAttemptAt = null;
  return { ws, attempt: run.attempts.length };
}

export type ReportCallOutcome = "answered" | "retry_scheduled" | "missed" | "ignored";

/** The phone stopped ringing. Answered → the conversation runs; otherwise retry or mark missed. */
export function resolveReportCallAttempt(
  input: Workspace,
  now: Date,
  runId: string,
  answered: boolean,
): { ws: Workspace; outcome: ReportCallOutcome } {
  const current = reportCallRuns(input).find((r) => r.id === runId);
  const pending = current?.attempts[current.attempts.length - 1];
  if (!current || current.state !== "calling" || pending?.result !== "pending") return { ws: input, outcome: "ignored" };
  const ws = structuredClone(input);
  const run = reportCallRuns(ws).find((r) => r.id === runId)!;
  const attempt = run.attempts.length;
  run.attempts[attempt - 1].result = answered ? "answered" : "no_answer";
  const name = ws.settings.worker.name;

  if (answered) {
    run.state = "answered";
    return { ws, outcome: "answered" };
  }

  pushCall(ws, {
    kind: "worker_report_missed",
    direction: "outbound",
    party: "worker",
    at: iso(now),
    outcome: "no_answer",
    attempt,
    summary: { ar: `لم يرد ${name} على مكالمة التقرير (المحاولة ${attempt})`, en: `${name} didn't answer the report call (attempt ${attempt})` },
    ticketId: null,
    reportId: null,
  });

  if (attempt <= REPORT_CALL_RETRIES) {
    run.nextAttemptAt = new Date(now.getTime() + RETRY_DELAY_MS).toISOString();
    pushEvent(ws, now, "neutral", {
      ar: `لم يرد ${name} — ناقة تعيد الاتصال بعد ٢٠ دقيقة (${attempt}/${REPORT_CALL_RETRIES + 1})`,
      en: `${name} didn't answer — NAQAH will try again in 20 minutes (${attempt}/${REPORT_CALL_RETRIES + 1})`,
    });
    return { ws, outcome: "retry_scheduled" };
  }

  run.state = "missed";
  run.nextAttemptAt = null;
  pushEvent(ws, now, "attention", {
    ar: `لم يرد ${name} على مكالمة التقرير بعد ${attempt} محاولات. لا يوجد تقرير لهذه الفترة بعد.`,
    en: `${name} didn't answer the report call after ${attempt} attempts. There is no report for this period yet.`,
  });
  return { ws, outcome: "missed" };
}

/**
 * The worker picked up but the conversation ended before a report was saved (hung up, line dropped).
 * The slot is not retried automatically: calling again is the owner's choice ("Call now").
 */
export function endReportCallWithoutReport(input: Workspace, now: Date, runId: string): Workspace {
  const current = reportCallRuns(input).find((r) => r.id === runId);
  if (!current || current.state !== "answered") return input;
  const ws = structuredClone(input);
  const run = reportCallRuns(ws).find((r) => r.id === runId)!;
  run.state = "missed";
  pushEvent(ws, now, "attention", {
    ar: `انتهت مكالمة التقرير مع ${ws.settings.worker.name} قبل حفظ التقرير`,
    en: `The report call with ${ws.settings.worker.name} ended before the report was saved`,
  });
  return ws;
}
