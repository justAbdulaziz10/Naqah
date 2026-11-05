/**
 * Business rules from the NAQAH MVP workflow (Phases 1–10).
 * Pure functions, no side effects. Covered by `src/domain/rules.test.ts`.
 */
import { PLAN_LIMITS, PREDEFINED_QUESTIONS } from "./catalog";
import { isValidWindow, isWithinWindow, sameDay, sameWeek } from "./clock";
import type { PredefinedQuestion, Workspace } from "./types";

/** Phase 1: applicable predefined questions are mandatory; absent resources are skipped. */
export function applicableQuestions(ws: Workspace): PredefinedQuestion[] {
  const present = new Set(ws.resources.filter((r) => r.present).map((r) => r.kind));
  return PREDEFINED_QUESTIONS.filter((q) => q.requires === null || present.has(q.requires));
}

export function customQuestionLimit(ws: Workspace): number {
  return PLAN_LIMITS[ws.settings.plan].customQuestions;
}

export function canAddCustomQuestion(ws: Workspace): boolean {
  return ws.settings.customQuestions.length < customQuestionLimit(ws);
}

export const taskTicketsEnabled = (ws: Workspace) => ws.settings.plan === "ultimate";

export type WorkerInboundRoute =
  | { kind: "callback"; ticketIds: string[] }
  | { kind: "report" }
  | { kind: "rejected"; reason: "outside_window" | "weekly_done" | "daily_done" | "no_window" };

/** The most recent successful farm report, if any. */
export function lastReportAt(ws: Workspace): string | null {
  return ws.reports.length ? ws.reports[ws.reports.length - 1].at : null;
}

/**
 * Phase 2: what happens when the worker calls the AI number.
 * An open No Answer Ticket takes priority: the callback is always answered
 * (even outside Basic's window) but is NOT a farm report.
 */
export function routeWorkerInboundCall(ws: Workspace, now: Date): WorkerInboundRoute {
  const open = ws.noAnswerTickets.filter((t) => t.status === "open");
  if (open.length) return { kind: "callback", ticketIds: open.map((t) => t.id) };

  const last = lastReportAt(ws);
  if (ws.settings.plan === "basic") {
    const w = ws.settings.window;
    if (!w || !isValidWindow(w)) return { kind: "rejected", reason: "no_window" };
    if (!isWithinWindow(now, w)) return { kind: "rejected", reason: "outside_window" };
    if (last && sameWeek(last, now)) return { kind: "rejected", reason: "weekly_done" };
    return { kind: "report" };
  }
  if (last && sameDay(last, now)) return { kind: "rejected", reason: "daily_done" };
  return { kind: "report" };
}

export type OwnerInboundRoute =
  | { kind: "inquiry"; mode: "unlimited" | "weekly" | "missed_callback" }
  | { kind: "rejected"; reason: "allowance_used" };

/**
 * Phase 5 + missed-notification callback.
 * Basic: one owner call per week. An answered notification call consumes it;
 * a missed notification leaves it available and allows one callback.
 * OPEN DECISION: whether that callback consumes the allowance is unspecified —
 * this MVP treats it as the week's one owner call.
 */
export function routeOwnerInboundCall(ws: Workspace, now: Date): OwnerInboundRoute {
  if (ws.settings.plan === "ultimate") return { kind: "inquiry", mode: "unlimited" };
  if (ownerAllowanceUsed(ws, now)) return { kind: "rejected", reason: "allowance_used" };
  const missed = ws.missedNotificationAt && sameWeek(ws.missedNotificationAt, now);
  return { kind: "inquiry", mode: missed ? "missed_callback" : "weekly" };
}

export function ownerAllowanceUsed(ws: Workspace, now: Date): boolean {
  return !!ws.ownerAllowanceUsedAt && sameWeek(ws.ownerAllowanceUsedAt, now);
}

/** Has the worker already reported in the current period (week for Basic, day for Ultimate)? */
export function reportDoneThisPeriod(ws: Workspace, now: Date): boolean {
  const last = lastReportAt(ws);
  if (!last) return false;
  return ws.settings.plan === "basic" ? sameWeek(last, now) : sameDay(last, now);
}

export const openTaskTickets = (ws: Workspace) => ws.taskTickets.filter((t) => t.status === "open");
export const openNoAnswerTickets = (ws: Workspace) => ws.noAnswerTickets.filter((t) => t.status === "open");

/** Open scheduled tasks whose time has come, whether or not a verification was attempted. */
export function overdueScheduledTasks(ws: Workspace, now: Date) {
  return openTaskTickets(ws).filter(
    (task) => task.scheduledFor !== null && new Date(task.scheduledFor).getTime() <= now.getTime(),
  );
}

/** Ultimate: scheduled tasks ready for a verification call, except those with a pending call. */
export function dueTaskVerifications(ws: Workspace, now: Date) {
  const pendingTaskIds = new Set(
    ws.pendingWorkerCalls
      .filter((call) => call.purpose === "task_verification" && call.state === "pending")
      .map((call) => call.taskTicketId),
  );
  return overdueScheduledTasks(ws, now).filter((task) => !pendingTaskIds.has(task.id));
}

/** Worker calls with a retry due at or before `now`. */
export function dueWorkerCalls(ws: Workspace, now: Date) {
  return ws.pendingWorkerCalls.filter(
    (c) => c.state === "pending" && c.nextAttemptAt && new Date(c.nextAttemptAt).getTime() <= now.getTime(),
  );
}
