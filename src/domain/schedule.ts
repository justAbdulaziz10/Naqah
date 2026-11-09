/**
 * Scheduled report calls: NAQAH calls the worker, the worker does not call NAQAH.
 * Basic: one call a week (owner picks the day and time). Ultimate: one call every day (owner picks the time).
 * The cadence comes from the plan and is never stored. All times are Asia/Riyadh wall-clock.
 *
 * Owner-facing only for now: nothing here places a call. See docs/integrations/call-schedule.md.
 */
import { fromRiyadh, riyadhParts, sameDay, sameWeek, toMinutes } from "./clock";
import { reportDoneThisPeriod } from "./rules";
import type { CallSchedule, Plan, Weekday, Workspace } from "./types";

export const CALL_SCHEDULE_TIME_ZONE = "Asia/Riyadh";

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isCallTime(value: string): boolean {
  return CLOCK_TIME.test(value);
}

/** Basic needs a day and a time; Ultimate needs only the time. */
export function isCompleteCallSchedule(plan: Plan, schedule: CallSchedule | null | undefined): boolean {
  if (!schedule || !isCallTime(schedule.time)) return false;
  return plan === "ultimate" || schedule.day !== null;
}

/** The next scheduled call strictly after `now`, or null while the schedule is unfinished. */
export function nextScheduledCall(now: Date, plan: Plan, schedule: CallSchedule | null | undefined): Date | null {
  if (!schedule || !isCompleteCallSchedule(plan, schedule)) return null;
  const p = riyadhParts(now);
  const minutes = toMinutes(schedule.time);
  const at = (addDays: number) => fromRiyadh(p.year, p.month, p.day + addDays, Math.floor(minutes / 60), minutes % 60);
  for (let add = 0; add <= 7; add++) {
    const weekday = ((p.weekday + add) % 7) as Weekday;
    if (plan === "basic" && weekday !== schedule.day) continue;
    const candidate = at(add);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return null; // Unreachable: day 7 always matches and is in the future.
}

/**
 * When the owner summary for a report saved at `now` may be dialed.
 * A slot still ahead in this period waits. A slot that already passed is due now,
 * because the summary cannot be spoken before the report exists.
 * Returns null until the owner has chosen a complete schedule.
 */
export function ownerSummaryDueAt(now: Date, plan: Plan, schedule: CallSchedule | null | undefined): Date | null {
  if (!isCompleteCallSchedule(plan, schedule)) return null;
  const upcoming = nextScheduledCall(now, plan, schedule);
  const previous = previousScheduledCall(now, plan, schedule);
  const samePeriod = (at: Date) => (plan === "basic" ? sameWeek(at, now) : sameDay(at, now));
  if (upcoming && samePeriod(upcoming)) return upcoming;
  if (previous && samePeriod(previous)) return new Date(now.getTime());
  return upcoming;
}

/** The latest scheduled call at or before `now`, or null while the schedule is unfinished. */
export function previousScheduledCall(now: Date, plan: Plan, schedule: CallSchedule | null | undefined): Date | null {
  if (!schedule || !isCompleteCallSchedule(plan, schedule)) return null;
  const p = riyadhParts(now);
  const minutes = toMinutes(schedule.time);
  for (let back = 0; back <= 7; back++) {
    const weekday = (((p.weekday - back) % 7) + 7) % 7;
    if (plan === "basic" && weekday !== schedule.day) continue;
    const candidate = fromRiyadh(p.year, p.month, p.day - back, Math.floor(minutes / 60), minutes % 60);
    if (candidate.getTime() <= now.getTime()) return candidate;
  }
  return null; // Unreachable: day -7 always matches and is in the past.
}

/** The next report call NAQAH will place, skipping a period already completed. */
export function upcomingReportCall(ws: Workspace, now: Date): Date | null {
  const { plan, callSchedule } = ws.settings;
  const next = nextScheduledCall(now, plan, callSchedule);
  if (!next || !reportDoneThisPeriod(ws, now)) return next;
  const samePeriod = plan === "basic" ? sameWeek(next, now) : sameDay(next, now);
  return samePeriod ? nextScheduledCall(next, plan, callSchedule) : next;
}
