/**
 * Business rules from the NAQAH MVP workflow (Phases 1–10).
 * Pure functions, no side effects. Covered by `src/domain/rules.test.ts`.
 */
import { PLAN_LIMITS, PREDEFINED_QUESTIONS } from "./catalog";
import { DAY, sameDay, sameWeek } from "./clock";
import { isHerdCount } from "./herd";
import { nextScheduledCall } from "./schedule";
import type { CustomQuestion, PendingWorkerCall, PredefinedQuestion, QuestionPlanEntry, ReportCallRun, ReportMode, Workspace } from "./types";

/** Phase 1: predefined questions that apply to this ranch; absent resources are skipped. */
export function applicableQuestions(ws: Workspace): PredefinedQuestion[] {
  const present = new Set(ws.resources.filter((r) => r.present).map((r) => r.kind));
  return PREDEFINED_QUESTIONS.filter((q) => q.requires === null || present.has(q.requires));
}

export type PlannedQuestion =
  | { kind: "predefined"; question: PredefinedQuestion; required: boolean }
  | { kind: "custom"; question: CustomQuestion; required: boolean };

/** A question as the owner arranges it: on or off, and whether this ranch can be asked it at all. */
export type QuestionPlanRow = PlannedQuestion & { enabled: boolean; applicable: boolean };

/** Older stored demo workspaces have neither field. */
export const reportModeOf = (ws: Workspace): ReportMode => ws.settings.reportMode ?? "guided";
const storedPlan = (ws: Workspace): QuestionPlanEntry[] => ws.settings.questionPlan ?? [];

/**
 * Every question in ask order, on or off. Ids the plan doesn't know keep their defaults: on and
 * required, new predefined questions in catalog order, then new custom questions last. Plan ids
 * that no longer exist are dropped, so an empty plan is today's order.
 */
export function questionPlanRows(ws: Workspace): QuestionPlanRow[] {
  const predefined = new Map(PREDEFINED_QUESTIONS.map((question) => [question.id, question]));
  const custom = new Map(ws.settings.customQuestions.map((question) => [question.id, question]));
  const applicable = new Set(applicableQuestions(ws).map((question) => question.id));
  // Mirrors the call: the herd check needs a size to compare the worker's count with.
  const herdKnown = isHerdCount(ws.settings.herdCount) || ws.camels.length > 0;
  const seen = new Set<string>();
  const rows: QuestionPlanRow[] = [];
  const add = (id: string, entry?: QuestionPlanEntry) => {
    if (seen.has(id)) return;
    const flags = { enabled: entry?.enabled ?? true, required: entry?.required ?? true };
    const own = custom.get(id);
    const ours = predefined.get(id);
    if (ours) rows.push({ kind: "predefined", question: ours, ...flags, applicable: applicable.has(id) && (id !== "herd_count" || herdKnown) });
    else if (own) rows.push({ kind: "custom", question: own, ...flags, applicable: true });
    else return;
    seen.add(id);
  };
  for (const entry of storedPlan(ws)) add(entry.id, entry);
  for (const question of PREDEFINED_QUESTIONS) add(question.id);
  for (const question of ws.settings.customQuestions) add(question.id);
  return rows;
}

/** Enabled, applicable questions in the owner's order: exactly what the call asks. */
export function plannedQuestions(ws: Workspace): PlannedQuestion[] {
  return questionPlanRows(ws)
    .filter((row) => row.enabled && row.applicable)
    .map((row): PlannedQuestion => (row.kind === "predefined"
      ? { kind: "predefined", question: row.question, required: row.required }
      : { kind: "custom", question: row.question, required: row.required }));
}

/** At least one enabled question, or a follow-up task the worker can confirm on this call. */
export function reportPlanHasContent(ws: Workspace, now: Date): boolean {
  return plannedQuestions(ws).length > 0 || confirmableTasks(ws, now).length > 0;
}

export const planEntriesFromRows = (rows: QuestionPlanRow[]): QuestionPlanEntry[] =>
  rows.map((row) => ({ id: row.question.id, enabled: row.enabled, required: row.required }));

/**
 * Swap a question with its neighbour among the questions this ranch can be asked. Questions that
 * don't apply today keep their place, so they return there if the resource comes back.
 */
export function moveQuestionInPlan(rows: QuestionPlanRow[], id: string, step: -1 | 1): QuestionPlanRow[] {
  const visible = rows.filter((row) => row.applicable);
  const from = visible.findIndex((row) => row.question.id === id);
  const target = from < 0 ? undefined : visible[from + step];
  if (!target) return rows;
  const next = [...rows];
  const a = rows.indexOf(visible[from]);
  const b = rows.indexOf(target);
  [next[a], next[b]] = [next[b], next[a]];
  return next;
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
  | { kind: "rejected"; reason: "wait_for_call" | "weekly_done" | "daily_done" };

/** The most recent successful farm report, if any. */
export function lastReportAt(ws: Workspace): string | null {
  return ws.reports.length ? ws.reports[ws.reports.length - 1].at : null;
}

/**
 * What happens when the worker calls the NAQAH number. NAQAH calls the worker for the report, so an
 * inbound call is either a callback for a No Answer Ticket (always answered, not a farm report) or the
 * worker returning a report call they missed this period. Otherwise NAQAH tells them it will call.
 */
export function routeWorkerInboundCall(ws: Workspace, now: Date): WorkerInboundRoute {
  const open = ws.noAnswerTickets.filter((t) => t.status === "open");
  if (open.length) return { kind: "callback", ticketIds: open.map((t) => t.id) };

  const basic = ws.settings.plan === "basic";
  if (reportDoneThisPeriod(ws, now)) {
    return { kind: "rejected", reason: basic ? "weekly_done" : "daily_done" };
  }
  const returning = returnableReportRun(ws, now);
  return returning ? { kind: "report" } : { kind: "rejected", reason: "wait_for_call" };
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

/** Whether a missed-notification callback was used in the current Riyadh week. */
export function ownerMissedCallbackUsed(ws: Workspace, now: Date): boolean {
  return ws.calls.some(
    (call) =>
      call.kind === "owner_inquiry" &&
      sameWeek(call.at, now) &&
      (call.reason === "missed_notification_callback" ||
        (call.reason === undefined && call.summary.en === "Owner called back after a missed notification")),
  );
}

/**
 * A report call run the worker may still return: missed or still calling, its slot has come, and the
 * next scheduled slot has not started yet (or, without a schedule, the same day / Basic week).
 */
export function returnableReportRun(ws: Workspace, now: Date): ReportCallRun | undefined {
  return [...(ws.reportCalls ?? [])].reverse().find(
    (run) =>
      (run.state === "missed" || run.state === "calling") &&
      run.attempts.length > 0 &&
      Date.parse(run.occurrence) <= now.getTime() &&
      withinRunWindow(ws, run, now),
  );
}

/** Whether `at` falls between a run's slot and the next scheduled slot. */
function withinRunWindow(ws: Workspace, run: ReportCallRun, at: Date): boolean {
  const next = nextScheduledCall(new Date(run.occurrence), ws.settings.plan, ws.settings.callSchedule);
  // Without a complete schedule, the window is one period (a day, or a Basic week) from the slot.
  const end = next ? next.getTime() : Date.parse(run.occurrence) + (ws.settings.plan === "basic" ? 7 : 1) * DAY;
  return at.getTime() < end;
}

/**
 * Has the worker already reported in the current period (week for Basic, day for Ultimate)?
 * A report that answers a scheduled run, on NAQAH's call or the worker's returned call, belongs to the
 * run's slot. Any other report, or one saved after the run's window, belongs to its save time.
 */
export function reportDoneThisPeriod(ws: Workspace, now: Date): boolean {
  const runs = new Map<string, ReportCallRun>();
  for (const run of ws.reportCalls ?? []) if (run.trigger === "schedule" && run.reportId) runs.set(run.reportId, run);
  const inPeriod = (at: string) => (ws.settings.plan === "basic" ? sameWeek(at, now) : sameDay(at, now));
  return ws.reports.some((report) => {
    const run = runs.get(report.id);
    const at = run && withinRunWindow(ws, run, new Date(report.at)) ? run.occurrence : report.at;
    return inPeriod(at);
  });
}

export const openTaskTickets = (ws: Workspace) => ws.taskTickets.filter((t) => t.status === "open");
export const openNoAnswerTickets = (ws: Workspace) => ws.noAnswerTickets.filter((t) => t.status === "open");

/** Open scheduled tasks whose time has come, whether or not a verification was attempted. */
export function overdueScheduledTasks(ws: Workspace, now: Date) {
  return openTaskTickets(ws).filter(
    (task) => task.scheduledFor !== null && new Date(task.scheduledFor).getTime() <= now.getTime(),
  );
}

function instructionDelivered(ws: Workspace, call: PendingWorkerCall): boolean {
  if (call.state === "delivered") return true;
  if (call.state !== "no_answer_ticket") return false;
  const exhaustedAt = call.attempts.at(-1)?.at;
  if (!exhaustedAt) return false;
  const tickets = ws.noAnswerTickets.filter(
    (ticket) =>
      ticket.purpose === call.purpose &&
      ticket.taskTicketId === call.taskTicketId &&
      ticket.message === call.message &&
      Date.parse(ticket.createdAt) === Date.parse(exhaustedAt),
  );
  return tickets.length > 0 && tickets.every((ticket) => ticket.status === "closed");
}

/** The tasks a worker call is about. Older rows only have the single link. */
export function coveredTasks(call: PendingWorkerCall): string[] {
  return call.coveredTaskIds?.length ? call.coveredTaskIds : call.taskTicketId ? [call.taskTicketId] : [];
}

/** Covered tasks still open: what this call has left to ask. */
export function openCoveredTasks(ws: Workspace, call: PendingWorkerCall): string[] {
  const open = new Set(openTaskTickets(ws).map((task) => task.id));
  return coveredTasks(call).filter((id) => open.has(id));
}

/**
 * Picking up is not delivery. A verification attempt is delivered only when every covered open
 * task got an explicit yes or no on it; an instruction call only needs its receipt.
 */
export function workerDeliveryResult(ws: Workspace, call: PendingWorkerCall, answeredTaskIds: string[]): "delivered" | "interrupted" {
  if (call.purpose !== "task_verification") return "delivered";
  const answered = new Set(answeredTaskIds);
  return openCoveredTasks(ws, call).every((id) => answered.has(id)) ? "delivered" : "interrupted";
}

/** Tasks whose instruction call has not reached the worker yet. */
function tasksAwaitingInstruction(ws: Workspace): Set<string> {
  return new Set(
    ws.pendingWorkerCalls
      .filter((call) => call.purpose === "instruction" && !instructionDelivered(ws, call))
      .flatMap(coveredTasks),
  );
}

/**
 * Ultimate open tasks a worker can be asked about on another call: Any Time, plus scheduled tasks
 * whose time has come. Not before the worker has heard the instruction, and not while a
 * verification call is still asking about the same task.
 */
export function confirmableTasks(ws: Workspace, now: Date) {
  if (!taskTicketsEnabled(ws)) return [];
  const awaiting = tasksAwaitingInstruction(ws);
  const verifying = new Set(
    ws.pendingWorkerCalls.filter((call) => call.purpose === "task_verification" && call.state === "pending").flatMap(coveredTasks),
  );
  return openTaskTickets(ws).filter(
    (task) =>
      (task.scheduledFor === null || new Date(task.scheduledFor).getTime() <= now.getTime()) &&
      !awaiting.has(task.id) &&
      !verifying.has(task.id),
  );
}

/**
 * One verification cycle per scheduled task, once its time has come and its
 * instruction has been delivered. Any existing verification call — pending,
 * delivered, or exhausted — blocks another cycle. Retries stay on that call.
 */
export function dueTaskVerifications(ws: Workspace, now: Date) {
  if (!taskTicketsEnabled(ws)) return [];
  const started = new Set(ws.pendingWorkerCalls.filter((call) => call.purpose === "task_verification").flatMap(coveredTasks));
  const awaiting = tasksAwaitingInstruction(ws);
  return overdueScheduledTasks(ws, now).filter((task) => !started.has(task.id) && !awaiting.has(task.id));
}

/** Worker calls with a retry due at or before `now`. Basic has none, even from an older plan. */
export function dueWorkerCalls(ws: Workspace, now: Date) {
  if (!taskTicketsEnabled(ws)) return [];
  return ws.pendingWorkerCalls.filter(
    (c) => c.state === "pending" && c.nextAttemptAt && new Date(c.nextAttemptAt).getTime() <= now.getTime(),
  );
}
